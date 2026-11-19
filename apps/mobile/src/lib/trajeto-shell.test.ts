/**
 * T-0156 (docs/desenho/tracking.md §3.2, §3.4 e §9; RN-CORE-13): a tarefa `macuxi-trajeto` ligada ao shell. Dependências
 * injetadas (captura do aparelho, condição, gravação, Diagnóstico) e a ligação nos três gatilhos (abertura depois da carga,
 * volta ao primeiro plano e cada passada da `macuxi-sync-delta`), no logout e no aparelho bloqueado.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PontoTrajeto } from '@macuxi/core/contracts';
import type { DriverSqlite } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import {
  condicaoDoTrajeto,
  criarTrajeto,
  gravarPontosDoTrajeto,
  type CapturaDoAparelho,
  type CondicaoTrajeto,
  type DiagnosticoDoTrajeto,
  type LeituraDeLocalizacao,
} from './trajeto';

const ID = '0b9a4c1e-7f3d-4a2b-9c8d-1e2f3a4b5c6d';
const AGORA = Date.parse('2026-11-19T13:00:00.000Z');
const PODE: CondicaoTrajeto = { pode: true };
const NAO_PODE: CondicaoTrajeto = { pode: false, motivo: 'fora_do_expediente' };
const LAT = -3.119027;
const LON = -60.021731;

function montar(o: { ativa?: boolean; condicao?: CondicaoTrajeto; gravar?: (p: PontoTrajeto[]) => Promise<void>; semNativo?: boolean } = {}) {
  const passos: string[] = [];
  const erros: Error[] = [];
  const gravados: PontoTrajeto[] = [];
  let diag: Partial<DiagnosticoDoTrajeto> = {};
  let ativa = o.ativa ?? false;
  const captura: CapturaDoAparelho = {
    ativa: async () => ativa,
    ligar: async () => {
      passos.push('ligar');
      ativa = true;
    },
    parar: async () => {
      passos.push('parar');
      ativa = false;
    },
  };
  const trajeto = criarTrajeto({
    captura: o.semNativo ? null : captura,
    condicao: async () => () => o.condicao ?? PODE,
    gravar:
      o.gravar ??
      (async (p) => {
        gravados.push(...p);
      }),
    novoId: () => ID,
    agora: () => AGORA,
    guardarDiagnostico: async (d) => {
      diag = { ...diag, ...d };
    },
    registrarErro: (e) => erros.push(e),
  });
  return { trajeto, passos, erros, gravados, diag: () => diag, ativa: () => ativa };
}

const leitura = (ms: number): LeituraDeLocalizacao => ({ timestamp: ms, coords: { latitude: LAT, longitude: LON, accuracy: 10, speed: 1 } });

describe('condição padrão (§2, condição 1: padrão desligado)', () => {
  it('sempre desligada, em qualquer instante: a tarefa nunca liga de fábrica', async () => {
    const c = await condicaoDoTrajeto();
    for (const ms of [0, AGORA, Date.parse('2026-11-23T12:00:00.000Z')]) expect(c(ms)).toEqual({ pode: false, motivo: 'desligado' });
    const t = montar({ condicao: await condicaoDoTrajeto().then((f) => f(AGORA)) });
    expect(await t.trajeto.atualizar()).toBe('manter');
    expect(t.passos).toEqual([]);
    expect(t.diag()).toMatchObject({ estado: 'desligada' });
  });
});

describe('ligar, desligar e manter (§3.2)', () => {
  it('liga se pode e não está ativa; mantém se já está; desliga se não pode mais', async () => {
    const liga = montar({ condicao: PODE });
    expect(await liga.trajeto.atualizar()).toBe('ligar');
    expect(liga.passos).toEqual(['ligar']);
    expect(liga.diag()).toMatchObject({ estado: 'ativa' });

    const mantem = montar({ condicao: PODE, ativa: true });
    expect(await mantem.trajeto.atualizar()).toBe('manter');
    expect(mantem.passos).toEqual([]);
    expect(mantem.diag()).toMatchObject({ estado: 'ativa' });

    const desliga = montar({ condicao: NAO_PODE, ativa: true });
    expect(await desliga.trajeto.atualizar()).toBe('desligar');
    expect(desliga.passos).toEqual(['parar']);
    expect(desliga.diag()).toMatchObject({ estado: 'fora_do_expediente' });
  });

  it('build sem os módulos nativos: nada a fazer, sem erro', async () => {
    const t = montar({ semNativo: true });
    expect(await t.trajeto.atualizar()).toBeNull();
    await t.trajeto.parar();
    await t.trajeto.tratarLote([leitura(AGORA)], null);
    expect(t.erros).toEqual([]);
  });

  it('nunca lança: o erro da captura vai ao Diagnóstico', async () => {
    const t = montar({ condicao: PODE });
    const c = criarTrajeto({
      captura: { ativa: async () => false, ligar: () => Promise.reject(new Error('serviço em primeiro plano recusado')), parar: async () => undefined },
      condicao: async () => () => PODE,
      gravar: async () => undefined,
      novoId: () => ID,
      agora: () => AGORA,
      guardarDiagnostico: async () => undefined,
      registrarErro: (e) => t.erros.push(e),
    });
    expect(await c.atualizar()).toBeNull();
    expect(t.erros.map((e) => e.message)).toEqual(['serviço em primeiro plano recusado']);
  });
});

describe('logout e aparelho bloqueado param a captura (§3.4)', () => {
  it('parar desliga a captura ativa e zera o Diagnóstico; sem captura ativa, não chama o aparelho', async () => {
    const ativa = montar({ ativa: true });
    await ativa.trajeto.parar();
    expect(ativa.passos).toEqual(['parar']);
    expect(ativa.ativa()).toBe(false);
    expect(ativa.diag()).toEqual({ estado: 'desligada', ultimo_ponto_em: null });

    const parada = montar();
    await parada.trajeto.parar();
    expect(parada.passos).toEqual([]);
  });
});

describe('lote do Android (§3.1 e §3.2)', () => {
  it('grava os pontos aceitos e guarda só a hora do último ponto no Diagnóstico', async () => {
    const t = montar();
    await t.trajeto.tratarLote([leitura(AGORA - 300_000), leitura(AGORA)], null);
    expect(t.gravados).toHaveLength(2);
    expect(t.diag()).toEqual({ ultimo_ponto_em: '2026-11-19T13:00:00.000Z' });
    expect(t.passos).toEqual([]);
  });

  it('condição desligada: descarta o lote e para a captura', async () => {
    const t = montar({ ativa: true, condicao: { pode: false, motivo: 'desligado' } });
    await t.trajeto.tratarLote([leitura(AGORA)], null);
    expect(t.gravados).toEqual([]);
    expect(t.passos).toEqual(['parar']);
  });

  it('nada de coordenada no erro: nem da gravação, nem da captura', async () => {
    const t = montar({
      gravar: () => Promise.reject(new Error(`CHECK constraint failed: ponto (${LAT}, ${LON})`)),
    });
    await t.trajeto.tratarLote([leitura(AGORA)], null);
    await t.trajeto.tratarLote([], { message: `GPS perdido em ${LAT},${LON}` });
    expect(t.erros).toHaveLength(2);
    for (const e of t.erros) {
      expect(`${e.message}\n${e.stack ?? ''}`).not.toMatch(/3\.119|60\.021/);
    }
  });
});

/** O DDL do banco-dados (docs/banco/aparelho-sqlite.md §11), para o teste não depender do módulo do Core. */
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
  return m.criarDriverNode(':memory:');
}

const ponto = (id: string, o: Partial<PontoTrajeto> = {}): PontoTrajeto => ({
  id,
  capturado_em: '2026-11-19T13:00:00.000Z',
  latitude: LAT,
  longitude: LON,
  precisao_m: 12.4,
  velocidade_ms: null,
  ...o,
});

describe('gravar no SQLite do usuário (§3.4; core__ponto_trajeto)', () => {
  it('INSERT OR IGNORE pelo id: o id repetido não duplica nem troca o ponto; enviado_em nulo (na fila)', async () => {
    const db = await driverNode();
    await db.executar(DDL);
    const outro = '1c9a4c1e-7f3d-4a2b-9c8d-1e2f3a4b5c6d';
    expect(await gravarPontosDoTrajeto(db, [ponto(ID), ponto(outro, { velocidade_ms: 2.5 })])).toBe(2);
    expect(await gravarPontosDoTrajeto(db, [ponto(ID, { latitude: 1 })])).toBe(0);
    expect(await db.todas('SELECT id, latitude, precisao_m, velocidade_ms, enviado_em FROM core__ponto_trajeto ORDER BY id')).toEqual([
      { id: ID, latitude: LAT, precisao_m: 12, velocidade_ms: null, enviado_em: null },
      { id: outro, latitude: LAT, precisao_m: 12, velocidade_ms: 2.5, enviado_em: null },
    ]);
    await db.fechar();
  });

  it('lote grande vai em partes (limite de parâmetros do SQLite)', async () => {
    const db = await driverNode();
    await db.executar(DDL);
    const muitos = Array.from({ length: 1_201 }, (_, i) => ponto(`0b9a4c1e-7f3d-4a2b-9c8d-${String(i).padStart(12, '0')}`));
    expect(await gravarPontosDoTrajeto(db, muitos)).toBe(1_201);
    await db.fechar();
  });

  it('sem a tabela (Core ainda sem as migrações do aparelho): descarta sem erro', async () => {
    const db = await driverNode();
    expect(await gravarPontosDoTrajeto(db, [ponto(ID)])).toBe(0);
    await db.fechar();
  });
});

describe('ligação no shell (§3.2): três gatilhos, logout e aparelho bloqueado', () => {
  const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const entrada = fonte('../../index.ts');
  const plataforma = fonte('../state/plataforma.tsx');
  const segundoPlano = fonte('../services/segundo-plano.ts');

  it('a tarefa é definida no escopo global, junto da macuxi-sync-delta', () => {
    expect(entrada).toMatch(/import '\.\/src\/services\/segundo-plano';\s*(\/\/[^\n]*\n\s*)*import '\.\/src\/services\/trajeto';/);
  });

  it('abertura depois da carga e volta ao primeiro plano (app aberto)', () => {
    const bloco = plataforma.slice(plataforma.indexOf('// ---------- ADR 0017'), plataforma.indexOf('// ---------- T-0145'));
    expect(bloco).toMatch(/const ligar = [\s\S]*?ligarSyncEmSegundoPlano\(\);(\s*\/\/[^\n]*)*\s*void atualizarTrajeto\(\);/);
    expect(bloco).toMatch(/if \(st !== 'active'\) return;[\s\S]*?if \(ligada\) void atualizarTrajeto\(\);/);
  });

  it('cada passada da macuxi-sync-delta', () => {
    const passada = segundoPlano.slice(segundoPlano.indexOf('export function rodarPassadaEmSegundoPlano'), segundoPlano.indexOf('async function passadaUnica'));
    expect(passada).toMatch(/await atualizarTrajeto\(\);/);
  });

  it('logout para a captura antes de fechar o banco; o aparelho bloqueado, antes de apagar os bancos', () => {
    const sair = plataforma.slice(plataforma.indexOf('const logout = useCallback('), plataforma.indexOf('/** T-0088: "Tentar de novo"'));
    expect(sair.indexOf('await pararTrajeto()')).toBeGreaterThan(-1);
    expect(sair.indexOf('await pararTrajeto()')).toBeLessThan(sair.indexOf('fecharArmazenamentoDoUsuario'));
    for (const t of [plataforma, segundoPlano]) expect(t).toMatch(/pararCaptura: pararTrajeto,(\s*\/\/[^\n]*)*\s*apagarBancos: apagarBancosDoAparelho/);
  });
});
