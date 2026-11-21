/**
 * T-0156 (RN-CORE-13; docs/modulos/core/rastreamento.md, "Envio dos pontos"): os pontos gravados pela tarefa `macuxi-trajeto`
 * em `core__ponto_trajeto` vão ao servidor pelo `push` do transporte, fora da fila do motor, depois de cada envio, na
 * sincronização completa e na leve; a falha da rotina não impede o sync; nenhuma coordenada (nem id) vai para o `registrar`.
 * Motor real do SDK com transporte falso, SQLite real (`node:sqlite`) e a rotina real do Core.
 */
import { ENTIDADE_PONTO_TRAJETO, type PontoTrajeto } from '@macuxi/core/contracts';
import { z } from 'zod';
import {
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  defineModule,
  definirEntidadeSync,
  type DriverSqlite,
  type ItemPush,
  type ResultadoItemPush,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';

// o índice de `@macuxi/core/app` (API pública do Core) puxa telas: os módulos nativos viram vazios e a rotina é a real
vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-safe-area-context', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-svg', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('expo-router', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('@macuxi/ui/mobile', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));

const { comPontosDoTrajeto } = await import('./envio-do-trajeto');
const { gravarPontosDoTrajeto } = await import('./trajeto');

const LAT = -3.119027;
const LON = -60.021731;
const U = (n: number) => `0b9a4c1e-7f3d-4a2b-9c8d-${String(n).padStart(12, '0')}`;

/** O DDL do banco-dados (docs/banco/aparelho-sqlite.md §11), como no `trajeto-shell.test.ts`. */
const DDL = `
  CREATE TABLE core__ponto_trajeto (
    id TEXT PRIMARY KEY, capturado_em TEXT NOT NULL,
    latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90), longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    precisao_m INTEGER CHECK (precisao_m IS NULL OR precisao_m >= 0), velocidade_ms REAL CHECK (velocidade_ms IS NULL OR velocidade_ms >= 0),
    enviado_em TEXT
  ) WITHOUT ROWID;`;

/** Driver `node:sqlite` carregado pelo NOME (o typecheck do app não puxa `node:sqlite` para o grafo; T-0008 P3). */
async function driverNode(): Promise<DriverSqlite> {
  const nome = '@macuxi/platform-sdk/sqlite-node';
  const m = (await import(/* @vite-ignore */ nome)) as { criarDriverNode(caminho?: string): DriverSqlite };
  const db = m.criarDriverNode(':memory:');
  await db.executar(DDL);
  return db;
}

const ponto = (n: number): PontoTrajeto => ({
  id: U(n),
  capturado_em: new Date(Date.UTC(2026, 10, 19, 13, 0, n)).toISOString(),
  latitude: LAT,
  longitude: LON,
  precisao_m: 12,
  velocidade_ms: null,
});

/** Padrão `esperar: true`: o envio só volta com os pontos enviados. `segurarTrajeto`: o servidor só responde aos pontos depois de `liberar()`. */
async function montar(o: { banco?: () => DriverSqlite | null; esperar?: boolean; segurarTrajeto?: boolean } = {}) {
  let liberar = (): void => undefined;
  const trava = o.segurarTrajeto ? new Promise<void>((r) => (liberar = r)) : null;
  const db = await driverNode();
  const registro = criarRegistroSync([defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['visita'] })]);
  // uma entidade da fila do motor, para conferir a ordem: o envio do motor sai antes dos pontos
  registro.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'push', conflito: 'somente_insercao', schema: z.unknown() }));
  /** Um lote por chamada do `push`. */
  const lotes: ItemPush[][] = [];
  const transporte: TransporteSync = {
    async push(itens): Promise<ResultadoItemPush[]> {
      lotes.push(itens);
      // o servidor lento só para os pontos: o envio do motor responde na hora
      if (trava && itens.some((i) => i.entidade === ENTIDADE_PONTO_TRAJETO)) await trava;
      return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
    },
    pull: async () => ({ itens: [], proximo_cursor: null }),
    novidades: async () => ({ entidades: [], cursor: 'c1', horizonte: '2026-11-19T13:00:00.000Z', modulos_mudaram: false }),
  };
  const sinal = { online: true };
  const online = () => sinal.online;
  const registrar = vi.fn<(mensagem: string) => void>();
  const motor = comPontosDoTrajeto(criarMotorSync({ registro, armazenamento: criarArmazenamentoEmMemoria(), transporte, online }), {
    banco: o.banco ?? (() => db),
    push: (itens) => transporte.push(itens),
    online,
    registrar,
    agora: () => new Date('2026-11-19T15:00:00.000Z'),
    esperar: o.esperar ?? true,
  });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core']);
  const enviados = () => lotes.flat();
  return { db, motor, lotes, enviados, sinal, registrar, liberar };
}

const pendentes = (db: DriverSqlite) => db.todas<{ id: string }>('SELECT id FROM core__ponto_trajeto WHERE enviado_em IS NULL');
const naFila = (motor: { estado(): { fila: readonly { entidade: string }[] } }) =>
  motor.estado().fila.filter((i) => i.entidade === ENTIDADE_PONTO_TRAJETO);

describe('envio dos pontos do trajeto (RN-CORE-13: o ponto gravado chega ao servidor)', () => {
  it('sincronização completa: o ponto sai pelo push do transporte, fora da fila do motor', async () => {
    const { db, motor, enviados } = await montar();
    await gravarPontosDoTrajeto(db, [ponto(1)]);
    expect(await motor.sincronizar()).toBe(true);
    expect(enviados().map((i) => i.id)).toEqual([U(1)]);
    expect(naFila(motor)).toEqual([]);
    expect(await pendentes(db)).toEqual([]);
  });

  it('sincronização leve (sincronizarNovidades): os pontos gravados depois da completa também vão', async () => {
    const { db, motor, enviados } = await montar();
    expect(await motor.sincronizar()).toBe(true);
    await gravarPontosDoTrajeto(db, [ponto(3)]);
    expect(await motor.sincronizarNovidades()).toBe(true);
    expect(enviados().map((i) => [i.entidade, i.id])).toEqual([[ENTIDADE_PONTO_TRAJETO, U(3)]]);
    expect(naFila(motor)).toEqual([]);
    expect(await pendentes(db)).toEqual([]);
  });

  it.each(['enviar', 'sincronizar', 'sincronizarNovidades'] as const)('%s: o push do motor sai antes dos pontos do trajeto', async (caminho) => {
    const { db, motor, lotes } = await montar();
    await gravarPontosDoTrajeto(db, [ponto(2)]);
    await motor.enfileirar({ id: U(20), entidade: 'visita', payload: {} });
    await motor[caminho]();
    expect(lotes.map((l) => l.map((i) => i.entidade))).toEqual([['visita'], [ENTIDADE_PONTO_TRAJETO]]);
  });

  it('envio da fila (`enviar`): o ponto sai uma vez só, mesmo com envios simultâneos', async () => {
    const { db, motor, enviados } = await montar();
    await gravarPontosDoTrajeto(db, [ponto(4)]);
    await Promise.all([motor.enviar(), motor.enviar()]);
    await motor.enviar();
    expect(enviados().map((i) => i.id)).toEqual([U(4)]);
  });

  it('sem sinal nada sai e o ponto espera; sem banco aberto (reserva no AsyncStorage) o sync segue', async () => {
    const semSinal = await montar();
    await gravarPontosDoTrajeto(semSinal.db, [ponto(6)]);
    semSinal.sinal.online = false;
    await semSinal.motor.enviar();
    expect(semSinal.lotes).toEqual([]);
    expect(await pendentes(semSinal.db)).toEqual([{ id: U(6) }]);
    semSinal.sinal.online = true;
    await semSinal.motor.enviar();
    expect(semSinal.enviados().map((i) => i.id)).toEqual([U(6)]);

    const semBanco = await montar({ banco: () => null });
    expect(await semBanco.motor.sincronizar()).toBe(true);
    expect(semBanco.lotes).toEqual([]);
    expect([...semSinal.registrar.mock.calls, ...semBanco.registrar.mock.calls]).toEqual([]);
  });

  it('falha da rotina (banco que falha ou não abre) não impede o sync e não leva coordenada nem id ao registrar', async () => {
    const quebrado = { todas: async () => Promise.reject(new Error(`disco: ${LAT},${LON} ${U(9)}`)), rodar: async () => ({ alteradas: 0 }) };
    const lendo = await montar({ banco: () => quebrado as unknown as DriverSqlite });
    expect(await lendo.motor.sincronizar()).toBe(true);
    expect(await lendo.motor.sincronizarNovidades()).toBe(true);

    const semBanco = await montar({
      banco: () => {
        throw new Error(`arquivo ${LAT}`);
      },
    });
    expect(await semBanco.motor.sincronizar()).toBe(true);

    const mensagens = [lendo, semBanco].flatMap((m) => m.registrar.mock.calls.map(([t]) => t));
    expect(mensagens.length).toBeGreaterThanOrEqual(3);
    for (const t of mensagens) {
      expect(t).not.toMatch(/-?\d+\.\d{3,}/);
      expect(t).not.toContain('0b9a4c1e');
    }
  });

  it.each(['enviar', 'sincronizar', 'sincronizarNovidades'] as const)(
    '%s com a tela: o resultado volta sem esperar os pontos (não segura o "Enviando…")',
    async (caminho) => {
      const { db, motor, enviados, liberar } = await montar({ esperar: false, segurarTrajeto: true });
      await gravarPontosDoTrajeto(db, [ponto(7)]);
      await motor[caminho]();
      expect(motor.estado().sincronizando).toBe(false);
      expect(enviados().map((i) => i.id)).toEqual([U(7)]);
      expect(await pendentes(db)).toEqual([{ id: U(7) }]);
      liberar();
      await motor.pontosDoTrajeto();
      expect(enviados().map((i) => i.id)).toEqual([U(7)]);
      expect(await pendentes(db)).toEqual([]);
    },
  );

  it('sem tela (`esperar`): o envio só volta com os pontos enviados', async () => {
    const { db, motor, liberar } = await montar({ esperar: true, segurarTrajeto: true });
    await gravarPontosDoTrajeto(db, [ponto(8)]);
    let voltou = false;
    const envio = motor.sincronizarNovidades().then(() => (voltou = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(voltou).toBe(false);
    liberar();
    await envio;
    expect(await pendentes(db)).toEqual([]);
  });
});
