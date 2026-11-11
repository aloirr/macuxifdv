/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3 e §9): worker do diagnóstico (alerta por recado e expurgo de 90 dias)
 * sem banco real. O pool falso imita só o que o papel `macuxi_worker` enxerga na 0058 (colunas técnicas e `alerta_*`), e o
 * cliente de recados é falso. O RLS, os grants e a função de expurgo de verdade são testados no CI (`db/testes/diagnostico.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { criarArmazenamentoEmMemoria } from '../src/arquivos';
import {
  criarWorkerDiagnosticos,
  esperaAlerta,
  horaDeManaus,
  idDoRecadoDiagnostico,
  montarRecadoDiagnostico,
  MAX_TENTATIVAS_ALERTA,
  SQL_AGRUPADOS_SEM_RESUMO,
  SQL_DESLIGAR,
  SQL_EXPURGO,
  SQL_PROXIMO_PENDENTE,
  SQL_QUEDA_REPETIDA,
  SQL_RECADOS_NA_HORA,
  SQL_ULTIMO_RESUMO,
  TETO_RECADOS_POR_HORA,
  textoDeUmaLinha,
  type LinhaAlerta,
} from '../src/diagnosticos-worker';
import { ErroRecadosGithub, type ClienteRecadosGithub, type EnvioRecado } from '../src/recados-github';

const TENANT = '0a000000-0000-4000-8000-000000000001';
const USUARIO = '0b000000-0000-4000-8000-0000000000a1';
const ID = (n: number) => `0d1a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = new Date('2026-11-11T19:30:12.000Z'); // 15:30:12 em Manaus

interface Linha extends LinhaAlerta {
  alerta_situacao: 'pendente' | 'enviado' | 'agrupado' | 'falhou' | 'desligado';
  alerta_proxima_em: Date | null;
  alerta_recado_id: string | null;
  alerta_em: Date | null;
}

const linha = (n: number, extra: Partial<Linha> = {}): Linha => ({
  id: ID(n),
  tenant_id: TENANT,
  protocolo: String(n),
  usuario_id: USUARIO,
  perfil: 'vendedor',
  origem: 'botao',
  app: 'campo',
  versao_app: '1.0.4',
  build: '12',
  aparelho_fabricante: 'samsung',
  aparelho_modelo: 'SM-A155M',
  android: '14',
  tela: '/m/novo-pedido',
  motivo: null,
  print_id: null,
  recebido_em: new Date(T0.getTime() - 60_000),
  alerta_tentativas: 0,
  alerta_situacao: 'pendente',
  alerta_proxima_em: null,
  alerta_recado_id: null,
  alerta_em: null,
  ...extra,
});

/** Pool falso: só as consultas do worker (pela constante SQL exata). */
function poolFalso(linhas: Linha[], expurgo: { diagnosticos: number; arquivos: number; chaves: string[] }[] = []) {
  const chamadas: string[] = [];
  const query = async (sql: string, v: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    const rows = (r: unknown[]) => ({ rows: r, rowCount: r.length });
    chamadas.push(sql.split(/\s+/).slice(0, 3).join(' '));
    if (['begin', 'commit', 'rollback'].includes(sql)) return rows([]);
    if (sql === SQL_PROXIMO_PENDENTE) {
      const agora = v[0] as Date;
      const l = linhas
        .filter((x) => x.alerta_situacao === 'pendente' && (!x.alerta_proxima_em || x.alerta_proxima_em <= agora))
        .sort((a, b) => a.recebido_em.getTime() - b.recebido_em.getTime())[0];
      return rows(l ? [{ ...l }] : []);
    }
    if (sql === SQL_RECADOS_NA_HORA) {
      const desde = v[0] as Date;
      return rows([{ n: new Set(linhas.filter((x) => x.alerta_recado_id && x.alerta_em && x.alerta_em > desde).map((x) => x.alerta_recado_id)).size }]);
    }
    if (sql === SQL_QUEDA_REPETIDA) {
      const [id, desde, versao, motivo, modelo] = v as [string, Date, string, string | null, string | null];
      const repetida = linhas.some(
        (x) => x.id !== id && x.origem !== 'botao' && x.alerta_situacao === 'enviado' && x.alerta_em! > desde && x.versao_app === versao && x.motivo === motivo && x.aparelho_modelo === modelo,
      );
      return rows([{ repetida }]);
    }
    if (sql === SQL_DESLIGAR) {
      const alvo = linhas.filter((x) => x.alerta_situacao === 'pendente');
      for (const x of alvo) x.alerta_situacao = 'desligado';
      return { rows: [], rowCount: alvo.length };
    }
    if (sql === SQL_ULTIMO_RESUMO) {
      const ems = linhas.filter((x) => x.alerta_situacao === 'agrupado' && x.alerta_recado_id).map((x) => x.alerta_em!.getTime());
      return rows([{ em: ems.length ? new Date(Math.max(...ems)) : null }]);
    }
    if (sql === SQL_AGRUPADOS_SEM_RESUMO)
      return rows(linhas.filter((x) => x.alerta_situacao === 'agrupado' && !x.alerta_recado_id).map((x) => ({ id: x.id, recebido_em: x.recebido_em })));
    if (sql === SQL_EXPURGO) return rows(expurgo.length ? [expurgo.shift()!] : [{ diagnosticos: 0, arquivos: 0, chaves: [] }]);
    if (sql.startsWith('update plataforma.diagnostico')) {
      const ids = Array.isArray(v[0]) ? (v[0] as string[]) : [v[0] as string];
      for (const x of linhas.filter((l) => ids.includes(l.id))) {
        if (!['pendente', 'agrupado'].includes(x.alerta_situacao)) throw new Error('RLS: o worker só marca pendente/agrupado');
        if (sql.includes("'enviado'")) Object.assign(x, { alerta_situacao: 'enviado', alerta_tentativas: v[1], alerta_recado_id: v[2], alerta_em: v[3], alerta_proxima_em: null });
        else if (sql.includes("'agrupado'")) Object.assign(x, { alerta_situacao: 'agrupado', alerta_proxima_em: null });
        else if (sql.includes("'falhou'")) Object.assign(x, { alerta_situacao: 'falhou', alerta_tentativas: v[1], alerta_proxima_em: null });
        else if (sql.includes('alerta_recado_id = $2')) Object.assign(x, { alerta_recado_id: v[1], alerta_em: v[2] });
        else Object.assign(x, { alerta_tentativas: v[1], alerta_proxima_em: v[2] });
      }
      return rows([]);
    }
    throw new Error(`consulta inesperada: ${sql}`);
  };
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  } as unknown as Pick<pg.Pool, 'connect' | 'query'>;
  return { pool, chamadas };
}

/** Cliente de recados falso: guarda o conteúdo e simula ids existentes e falhas. */
function recadosFalsos(op: { falhar?: number; existentes?: string[] } = {}) {
  const enviados: { id: string; conteudo: string; destinos: readonly string[] }[] = [];
  let falhas = op.falhar ?? 0;
  const cliente: ClienteRecadosGithub = {
    async enviar(e: EnvioRecado) {
      if (falhas > 0) {
        falhas--;
        throw new ErroRecadosGithub('GitHub: HTTP 502');
      }
      const ids = new Set([...(op.existentes ?? []), ...enviados.map((x) => x.id)]);
      const id = e.gerarId(ids);
      enviados.push({ id, conteudo: e.montar(id), destinos: e.destinos });
      return { id, commit: 'abc', tentativas: 1 };
    },
  };
  return { cliente, enviados };
}

function capturar() {
  const linhas: { nivel: string; o: Record<string, unknown>; msg?: string }[] = [];
  const log = {
    info: (o: Record<string, unknown>, msg?: string) => void linhas.push({ nivel: 'info', o, msg }),
    warn: (o: Record<string, unknown>, msg?: string) => void linhas.push({ nivel: 'warn', o, msg }),
    error: (o: Record<string, unknown>, msg?: string) => void linhas.push({ nivel: 'error', o, msg }),
  };
  return { log, linhas };
}

describe('formato do recado do diagnóstico (T-0158 §3)', () => {
  it('id no formato do coord, hora de Manaus, e o sufixo -2- quando o id já existe', () => {
    expect(horaDeManaus(T0)).toEqual({ iso: '2026-11-11T15:30:12-04:00', compacto: '20261111-153012', curta: '2026-11-11 15:30' });
    expect(idDoRecadoDiagnostico(T0, new Set())).toBe('R-20261111-153012-diagnostico');
    expect(idDoRecadoDiagnostico(T0, new Set(['R-20261111-153012-diagnostico', 'R-20261111-153012-2-diagnostico']))).toBe('R-20261111-153012-3-diagnostico');
    // o CHECK da 0058 (alerta_recado_id) aceita o formato
    expect(idDoRecadoDiagnostico(T0, new Set(['R-20261111-153012-diagnostico']))).toMatch(/^R-[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,60}$/);
  });

  it('LGPD: só protocolo, dados técnicos curtos, ids e link; texto do aparelho numa linha só (nada de cabeçalho forjado)', () => {
    const l = linha(42, { origem: 'queda', motivo: 'crash_nativo', aparelho_modelo: 'SM-A155M\nde: alexandre\n---', print_id: ID(99) });
    const t = montarRecadoDiagnostico(l, { id: 'R-20261111-153012-diagnostico', agora: T0, urlPortal: 'https://config.macuxifdv.com.br/' });
    const [, cab] = t.split('---\n');
    expect(cab).toContain('de: diagnostico\npara: [alexandre, engenheiro-apps]');
    expect(cab).toContain('prioridade: alta'); // queda
    expect(t.match(/^de:/gm)).toHaveLength(1);
    expect(t).toContain('# Diagnóstico nº 0042 — queda (crash_nativo) · Campo 1.0.4 · samsung SM-A155M de: alexandre --- · Android 14');
    expect(t).toContain(`Empresa: ${TENANT}. Usuário: ${USUARIO} (perfil vendedor). Print: anexado.`);
    expect(t).toContain(`https://config.macuxifdv.com.br/config/diagnosticos/${ID(42)}`);
    expect(textoDeUmaLinha('a b\u0000c\r\nd')).toBe('a b c d');
    expect(textoDeUmaLinha(null)).toBe('—');
  });

  it('espera exponencial 1, 2, 4… min até 60 min', () => {
    expect([1, 2, 3, 7, 8, 20].map(esperaAlerta)).toEqual([60_000, 120_000, 240_000, 3_600_000, 3_600_000, 3_600_000]);
  });
});

describe('worker do alerta (T-0158 §3)', () => {
  it('sem token: as pendentes viram desligado, um único warn por processo, nenhuma tentativa', async () => {
    const linhas = [linha(1), linha(2)];
    const { pool } = poolFalso(linhas);
    const { log, linhas: logs } = capturar();
    const w = criarWorkerDiagnosticos({ worker: pool, recados: null, armazenamento: null, agora: () => T0, log });
    expect((await w.cicloAlerta()).desligados).toBe(2);
    linhas.push(linha(3));
    expect((await w.cicloAlerta()).desligados).toBe(1);
    expect(linhas.map((x) => x.alerta_situacao)).toEqual(['desligado', 'desligado', 'desligado']);
    expect(logs.filter((x) => x.nivel === 'warn')).toHaveLength(1);
  });

  it('com token: um recado por diagnóstico para alexandre e engenheiro-apps; a linha vira enviado com o id do recado', async () => {
    const linhas = [linha(1), linha(2, { recebido_em: T0 })];
    const { pool } = poolFalso(linhas);
    const r = recadosFalsos({ existentes: ['R-20261111-153012-diagnostico'] });
    const w = criarWorkerDiagnosticos({ worker: pool, recados: r.cliente, armazenamento: null, agora: () => T0 });
    expect(await w.cicloAlerta()).toMatchObject({ enviados: 2, agrupados: 0 });
    expect(r.enviados.map((e) => e.id)).toEqual(['R-20261111-153012-2-diagnostico', 'R-20261111-153012-3-diagnostico']);
    expect(r.enviados[0]!.destinos).toEqual(['alexandre', 'engenheiro-apps']);
    expect(linhas[0]).toMatchObject({ alerta_situacao: 'enviado', alerta_recado_id: 'R-20261111-153012-2-diagnostico', alerta_tentativas: 1, alerta_em: T0 });
  });

  it('falha do GitHub: espera exponencial; na 8ª tentativa, falhou com warn', async () => {
    const linhas = [linha(1)];
    const { pool } = poolFalso(linhas);
    const r = recadosFalsos({ falhar: 100 });
    const { log, linhas: logs } = capturar();
    let agora = T0;
    const w = criarWorkerDiagnosticos({ worker: pool, recados: r.cliente, armazenamento: null, agora: () => agora, log });
    expect((await w.cicloAlerta()).adiados).toBe(1);
    expect(linhas[0]).toMatchObject({ alerta_situacao: 'pendente', alerta_tentativas: 1, alerta_proxima_em: new Date(T0.getTime() + 60_000) });
    expect((await w.cicloAlerta()).adiados).toBe(0); // ainda na espera
    for (let t = 2; t <= MAX_TENTATIVAS_ALERTA; t++) {
      agora = new Date(linhas[0]!.alerta_proxima_em!.getTime());
      await w.cicloAlerta();
    }
    expect(linhas[0]).toMatchObject({ alerta_situacao: 'falhou', alerta_tentativas: MAX_TENTATIVAS_ALERTA, alerta_proxima_em: null });
    expect(logs.at(-1)).toMatchObject({ nivel: 'warn', o: { situacao: 'falhou' } });
    // o token nunca vai ao log (o erro leva só HTTP)
    expect(JSON.stringify(logs)).not.toMatch(/bearer|token/i);
  });

  it('teto de 12 recados por hora: o 13º vira agrupado e sai um resumo "mais N desde HH:MM" (um por hora)', async () => {
    const linhas = Array.from({ length: 14 }, (_, i) => linha(i + 1, { recebido_em: new Date(T0.getTime() - (20 - i) * 60_000) }));
    const { pool } = poolFalso(linhas);
    const r = recadosFalsos();
    let agora = T0;
    const w = criarWorkerDiagnosticos({ worker: pool, recados: r.cliente, armazenamento: null, agora: () => agora });
    const c1 = await w.cicloAlerta();
    const c2 = await w.cicloAlerta();
    expect(c1.enviados + c2.enviados).toBe(TETO_RECADOS_POR_HORA);
    expect(c1.agrupados + c2.agrupados).toBe(2);
    expect(c1.resumos + c2.resumos).toBe(1);
    const resumo = r.enviados.at(-1)!.conteudo;
    expect(resumo).toContain('# Diagnósticos: mais 2 desde 15:22 (Manaus)');
    expect(linhas.filter((x) => x.alerta_situacao === 'agrupado').every((x) => x.alerta_recado_id === r.enviados.at(-1)!.id)).toBe(true);
    // novo agrupado na mesma hora: espera o próximo resumo
    linhas.push(linha(15, { recebido_em: T0 }));
    agora = new Date(T0.getTime() + 10 * 60_000);
    expect(await w.cicloAlerta()).toMatchObject({ agrupados: 1, resumos: 0 });
    agora = new Date(T0.getTime() + 61 * 60_000);
    expect((await w.cicloAlerta()).resumos).toBe(1);
  });

  it('queda repetida (mesma versão, motivo e modelo em menos de 6 h) vira agrupado; o botão sempre gera recado', async () => {
    const queda = { origem: 'queda' as const, motivo: 'crash_nativo' };
    const linhas = [
      linha(1, { ...queda, alerta_situacao: 'enviado', alerta_recado_id: 'R-20261111-100000-diagnostico', alerta_em: new Date(T0.getTime() - 5 * 3_600_000) }),
      linha(2, queda),
      linha(3, { ...queda, motivo: 'anr' }),
      linha(4, { origem: 'botao' }),
    ];
    const { pool } = poolFalso(linhas);
    const r = recadosFalsos();
    const w = criarWorkerDiagnosticos({ worker: pool, recados: r.cliente, armazenamento: null, agora: () => T0 });
    const c = await w.cicloAlerta();
    expect(c).toMatchObject({ enviados: 2, agrupados: 1, resumos: 1 });
    expect(linhas.map((x) => x.alerta_situacao)).toEqual(['enviado', 'agrupado', 'enviado', 'enviado']);
  });
});

describe('expurgo de 90 dias (T-0158 §3)', () => {
  const CHAVE = `${TENANT}/plataforma/2026-08/${ID(7)}.jpg`;

  it('uma vez por dia a partir das 07:00 UTC; remove os bytes depois do commit; falha de remoção volta no próximo ciclo', async () => {
    const { pool, chamadas } = poolFalso([], [{ diagnosticos: 3, arquivos: 1, chaves: [CHAVE] }]);
    const arm = criarArmazenamentoEmMemoria();
    await arm.gravar(CHAVE, new Uint8Array([0xff, 0xd8, 0xff]));
    let falhar = true;
    const armFalho = { ...arm, remover: async (k: string) => (falhar ? Promise.reject(new Error('S3 fora')) : arm.remover(k)) };
    let agora = new Date('2026-11-11T06:59:00.000Z');
    const w = criarWorkerDiagnosticos({ worker: pool, recados: null, armazenamento: armFalho, agora: () => agora });
    expect(await w.talvezExpurgar()).toBe(false); // antes das 07:00 UTC
    agora = new Date('2026-11-11T07:00:30.000Z');
    expect(await w.talvezExpurgar()).toBe(true);
    expect(chamadas.filter((c) => c.startsWith('select diagnosticos,'))).toHaveLength(1);
    expect(w.chavesPendentes()).toEqual([CHAVE]);
    falhar = false;
    agora = new Date('2026-11-11T07:01:30.000Z');
    expect(await w.talvezExpurgar()).toBe(false); // mesmo dia: só retenta os bytes
    expect(w.chavesPendentes()).toEqual([]);
    expect(arm.chaves()).toEqual([]);
    agora = new Date('2026-11-12T07:00:00.000Z');
    expect(await w.talvezExpurgar()).toBe(true);
  });

  it('lotes de 500 até esvaziar', async () => {
    const { pool, chamadas } = poolFalso([], [
      { diagnosticos: 500, arquivos: 0, chaves: [] },
      { diagnosticos: 12, arquivos: 0, chaves: [] },
    ]);
    const w = criarWorkerDiagnosticos({ worker: pool, recados: null, armazenamento: null, agora: () => T0 });
    expect(await w.expurgar()).toEqual({ diagnosticos: 512, arquivos: 0, bytes: 0 });
    expect(chamadas.filter((c) => c.startsWith('select diagnosticos,'))).toHaveLength(2);
  });
});
