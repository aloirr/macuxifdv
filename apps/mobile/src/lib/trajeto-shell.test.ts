/**
 * T-0156 (docs/desenho/tracking.md §3.2, §3.4 e §9; RN-CORE-13): a tarefa `macuxi-trajeto` ligada ao shell. Dependências
 * injetadas (captura do aparelho, condição, gravação, erro) e a ligação nos três gatilhos (abertura depois da carga,
 * volta ao primeiro plano e cada passada da `macuxi-sync-delta`), no logout e no aparelho bloqueado.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PARAMETROS_RASTREAMENTO_PADRAO, type FrequenciaRastreamento, type MotivoSemRastreio, type PontoTrajeto } from '@macuxi/core/contracts';
import type { ArmazenamentoSync, DriverSqlite } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  condicaoDoTrajeto,
  criarTrajeto,
  entradaDoRastreio,
  gravarPontosDoTrajeto,
  lerContextoDoRastreio,
  lerFrequenciaDoTrajeto,
  opcoesDoTrajeto,
  portaoDoTrajeto,
  type CapturaDoAparelho,
  type CondicaoTrajeto,
  type ContextoDoRastreio,
  type IntervalosDaCaptura,
  type LeituraDeLocalizacao,
  type OpcoesDoTrajeto,
  type SessaoDoRastreio,
} from './trajeto';

const ID = '0b9a4c1e-7f3d-4a2b-9c8d-1e2f3a4b5c6d';
const AGORA = Date.parse('2026-11-19T13:00:00.000Z');
const PODE: CondicaoTrajeto = { pode: true };
const NAO_PODE: CondicaoTrajeto = { pode: false, motivo: 'fora_do_expediente' };
const LAT = -3.119027;
const LON = -60.021731;

function montar(
  o: {
    ativa?: boolean;
    condicao?: CondicaoTrajeto;
    frequencia?: FrequenciaRastreamento;
    emUso?: Partial<IntervalosDaCaptura> | null;
    gravar?: (p: PontoTrajeto[]) => Promise<void>;
    semNativo?: boolean;
  } = {},
) {
  const passos: string[] = [];
  const ligadas: OpcoesDoTrajeto[] = [];
  let emUso: Partial<IntervalosDaCaptura> | null = o.emUso !== undefined ? o.emUso : o.ativa ? opcoesDoTrajeto() : null;
  const erros: Error[] = [];
  const gravados: PontoTrajeto[] = [];
  let ativa = o.ativa ?? false;
  const captura: CapturaDoAparelho = {
    ativa: async () => ativa,
    ligar: async (opcoes) => {
      passos.push('ligar');
      ligadas.push(opcoes);
      emUso = opcoes;
      ativa = true;
    },
    parar: async () => {
      passos.push('parar');
      emUso = null;
      ativa = false;
    },
    intervalosEmUso: async () => emUso,
  };
  const trajeto = criarTrajeto({
    captura: o.semNativo ? null : captura,
    condicao: async () => () => o.condicao ?? PODE,
    frequencia: async () => o.frequencia ?? PARAMETROS_RASTREAMENTO_PADRAO.frequencia,
    gravar:
      o.gravar ??
      (async (p) => {
        gravados.push(...p);
      }),
    novoId: () => ID,
    agora: () => AGORA,
    registrarErro: (e) => erros.push(e),
  });
  return { trajeto, passos, ligadas, erros, gravados, ativa: () => ativa };
}

const leitura = (ms: number): LeituraDeLocalizacao => ({ timestamp: ms, coords: { latitude: LAT, longitude: LON, accuracy: 10, speed: 1 } });

describe('condição padrão (§2, condição 1: padrão desligado)', () => {
  it('sem contexto do aparelho (sem sessão ou sem banco): desligada em qualquer instante; a tarefa nunca liga de fábrica', async () => {
    const c = await condicaoDoTrajeto();
    for (const ms of [0, AGORA, Date.parse('2026-11-23T12:00:00.000Z')]) expect(c(ms)).toEqual({ pode: false, motivo: 'desligado' });
    const t = montar({ condicao: c(AGORA) });
    expect(await t.trajeto.atualizar()).toBe('manter');
    expect(t.passos).toEqual([]);
  });

  it('leitura do aparelho com erro: desligada', async () => {
    const c = await condicaoDoTrajeto(() => Promise.reject(new Error('banco fechado')));
    expect(c(AGORA)).toEqual({ pode: false, motivo: 'desligado' });
  });
});

/** Quinta 19/11/2026, 09:00 em Manaus: dentro do expediente padrão (seg–sex 08:00–18:00). */
const LIGA: ContextoDoRastreio = {
  parametros: { ativo: true, expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente },
  cargo: 'vendedor',
  app: 'campo',
  feriados: [],
  ausencias: [],
  permissao: true,
  fuso: 'America/Manaus',
};

describe('RN-CORE-13: o portão é o podeRastrear do Core (§2 e §3.2)', () => {
  it('liga só com todas as condições', async () => {
    expect(portaoDoTrajeto(LIGA, AGORA)).toEqual({ pode: true });
    expect((await condicaoDoTrajeto(async () => LIGA))(AGORA)).toEqual({ pode: true });
  });

  it('a EntradaRastreio leva os campos do Core, com cargo, app e permissão para o podeRastrear decidir', () => {
    expect(Object.keys(entradaDoRastreio(LIGA, AGORA)).sort()).toEqual(
      ['app', 'ausencias', 'ativo', 'cargo', 'expediente', 'feriados', 'fuso', 'instante', 'permissao'].sort(),
    );
  });

  const casos: Array<[string, Partial<ContextoDoRastreio>, number, MotivoSemRastreio]> = [
    ['1. parâmetro rastreamento desligado (padrão de fábrica)', { parametros: { ...LIGA.parametros, ativo: false } }, AGORA, 'desligado'],
    ['RN-CORE-13, cargo pelo Core: fora do campo (supervisor)', { cargo: 'supervisor' }, AGORA, 'cargo'],
    ['RN-CORE-13, cargo pelo Core: sem cargo na sessão', { cargo: '' }, AGORA, 'cargo'],
    ['RN-CORE-13, app pelo Core: app Gestão', { app: 'gestao' }, AGORA, 'app'],
    ['4. fora do expediente (19:00 em Manaus)', {}, Date.parse('2026-11-19T23:00:00.000Z'), 'fora_do_expediente'],
    ['4. dia sem expediente (domingo)', {}, Date.parse('2026-11-22T13:00:00.000Z'), 'fora_do_expediente'],
    ['4. expediente vazio no parâmetro', { parametros: { ativo: true, expediente: { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] } } }, AGORA, 'fora_do_expediente'],
    ['4. feriado do calendário do tenant', { feriados: ['2026-11-19'] }, AGORA, 'feriado'],
    ['4. feriado nacional (20/11), mesmo sem cadastro', {}, Date.parse('2026-11-20T13:00:00.000Z'), 'feriado'],
    ['4. ausência do usuário', { ausencias: [{ de: '2026-11-18', ate: '2026-11-19' }] }, AGORA, 'ausencia'],
    ['RN-CORE-13, permissão pelo Core: sem a permissão "o tempo todo"', { permissao: false }, AGORA, 'sem_permissao'],
    ['fuso do tenant: 17:30 em Manaus é 18:30 em São Paulo', { fuso: 'America/Sao_Paulo' }, Date.parse('2026-11-19T21:30:00.000Z'), 'fora_do_expediente'],
  ];
  for (const [nome, mudanca, ms, motivo] of casos) {
    it(`desliga sozinha: ${nome}`, async () => {
      const c = { ...LIGA, ...mudanca };
      expect(portaoDoTrajeto(c, ms)).toEqual({ pode: false, motivo });
      expect((await condicaoDoTrajeto(async () => c))(ms)).toEqual({ pode: false, motivo });
    });
  }

  it('controles: o mesmo contexto liga nos instantes vizinhos; instante inválido desliga', () => {
    expect(portaoDoTrajeto(LIGA, Date.parse('2026-11-19T21:30:00.000Z'))).toEqual({ pode: true });
    expect(portaoDoTrajeto({ ...LIGA, ausencias: [{ de: '2026-11-20', ate: '2026-11-21' }] }, AGORA)).toEqual({ pode: true });
    expect(portaoDoTrajeto(LIGA, Number.NaN)).toEqual({ pode: false, motivo: 'desligado' });
  });

  it('o lote é julgado ponto a ponto: o que cai fora do expediente é descartado e a captura para', async () => {
    const passos: string[] = [];
    const gravados: PontoTrajeto[] = [];
    const t = criarTrajeto({
      captura: { ativa: async () => true, ligar: async () => undefined, parar: async () => void passos.push('parar'), intervalosEmUso: async () => null },
      condicao: () => condicaoDoTrajeto(async () => LIGA),
      frequencia: async () => PARAMETROS_RASTREAMENTO_PADRAO.frequencia,
      gravar: async (p) => void gravados.push(...p),
      novoId: () => ID,
      agora: () => Date.parse('2026-11-19T22:05:00.000Z'),
      registrarErro: () => undefined,
    });
    await t.tratarLote([leitura(Date.parse('2026-11-19T21:55:00.000Z')), leitura(Date.parse('2026-11-19T22:05:00.000Z'))], null);
    expect(gravados.map((p) => p.capturado_em)).toEqual(['2026-11-19T21:55:00.000Z']);
    expect(passos).toEqual(['parar']);
  });
});

/** Armazenamento em memória com a mesma interface do banco do usuário (chaves completas, como o SQLite `kv`). */
function memoria(): ArmazenamentoSync & { dados: Map<string, unknown> } {
  const dados = new Map<string, unknown>();
  return {
    dados,
    ler: async <T,>(c: string) => (dados.has(c) ? (dados.get(c) as T) : null),
    gravar: async (c, v) => {
      if (v === null || v === undefined) dados.delete(c);
      else dados.set(c, v);
    },
    remover: async (c) => {
      dados.delete(c);
    },
    chaves: async (p) => [...dados.keys()].filter((k) => k.startsWith(p)).sort(),
  };
}

const OUTRO = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const SESSAO: SessaoDoRastreio = { usuarioId: ID, cargo: 'promotor', app: 'campo', fuso: 'America/Manaus', permissao: true };
const vivo = { updated_at: '2026-11-18T12:00:00.000Z', deleted_at: null };
const removido = { updated_at: '2026-11-18T12:00:00.000Z', deleted_at: '2026-11-18T13:00:00.000Z' };
const porId = (xs: Array<Record<string, unknown>>) => Object.fromEntries(xs.map((x) => [String(x.id), x]));

/** O banco do usuário como o motor deixa depois do pull (chave `ent:<entidade>`, mapa id → linha). */
async function bancoDoUsuario() {
  const base = memoria();
  await base.gravar(
    'ent:parametro',
    porId([
      { id: 'p1', modulo: 'core', chave: 'rastreamento', valor: { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true }, ...vivo },
      { id: 'p2', modulo: 'core', chave: 'metas.feriados', valor: ['2026-11-24', 'x'], ...vivo },
    ]),
  );
  await base.gravar(
    'ent:ausencia_usuario',
    porId([
      { id: 'u1', usuario_id: ID, de: '2026-11-25', ate: '2026-11-26', ...vivo },
      { id: 'u2', usuario_id: ID, de: '2026-11-19', ate: '2026-11-19', ...removido },
      { id: 'u3', usuario_id: OUTRO, de: '2026-11-19', ate: '2026-11-19', ...vivo },
    ]),
  );
  return base;
}

describe('EntradaRastreio lida do aparelho (pulls do Core e sessão)', () => {
  it('parâmetro, feriados e só as ausências vivas do próprio usuário', async () => {
    const c = await lerContextoDoRastreio(await bancoDoUsuario(), SESSAO);
    expect(c).toEqual({
      parametros: { ativo: true, expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente },
      cargo: 'promotor',
      app: 'campo',
      feriados: ['2026-11-24'],
      ausencias: [{ de: '2026-11-25', ate: '2026-11-26' }],
      permissao: true,
      fuso: 'America/Manaus',
    } satisfies ContextoDoRastreio);
    expect(portaoDoTrajeto(c, AGORA)).toEqual({ pode: true });
  });

  it('sem cargo na sessão, cargo vazio', async () => {
    const c = await lerContextoDoRastreio(await bancoDoUsuario(), { ...SESSAO, cargo: null });
    expect(c.cargo).toBe('');
    expect(portaoDoTrajeto(c, AGORA)).toEqual({ pode: false, motivo: 'cargo' });
  });

  it('banco vazio (antes do 1º pull): padrão de fábrica, desligado', async () => {
    const c = await lerContextoDoRastreio(memoria(), SESSAO);
    expect(c).toMatchObject({ parametros: { ativo: false }, feriados: [], ausencias: [] });
    expect(portaoDoTrajeto(c, AGORA)).toEqual({ pode: false, motivo: 'desligado' });
  });

  it('pelas linhas do SQLite (extensão linhas), como o motor.linhas: só parametro e ausencia_usuario', async () => {
    const base = await bancoDoUsuario();
    const listar = vi.fn(async (e: string) => Object.values((await base.ler<Record<string, unknown>>(`ent:${e}`)) ?? {}));
    const comLinhas = { ...base, linhas: { listar } } as unknown as ArmazenamentoSync;
    expect(portaoDoTrajeto(await lerContextoDoRastreio(comLinhas, SESSAO), AGORA)).toEqual({ pode: true });
    expect(listar.mock.calls.map(([e]) => e).sort()).toEqual(['ausencia_usuario', 'parametro']);
  });
});

describe('frequência do parâmetro rastreamento no banco do usuário (§3.1)', () => {
  const valor = { ...PARAMETROS_RASTREAMENTO_PADRAO, frequencia: { distancia_m: 300, intervalo_min: 3, lote_min: 6 } };
  const linha = { id: ID, updated_at: '2026-11-19T12:00:00.000Z', deleted_at: null, modulo: 'core', chave: 'rastreamento', valor };

  it('lê pelas linhas da entidade parametro (SQLite)', async () => {
    const base = memoria();
    const listar = vi.fn(async () => [linha]);
    const comLinhas = { ...base, linhas: { listar } } as unknown as ArmazenamentoSync;
    expect(await lerFrequenciaDoTrajeto(comLinhas)).toEqual({ distancia_m: 300, intervalo_min: 3, lote_min: 6 });
    expect(listar).toHaveBeenCalledWith('parametro');
  });

  it('sem linhas, pela chave ent:parametro; sem o parâmetro, a do padrão do contrato', async () => {
    const base = memoria();
    expect(await lerFrequenciaDoTrajeto(base)).toEqual(PARAMETROS_RASTREAMENTO_PADRAO.frequencia);
    await base.gravar('ent:parametro', { [ID]: linha });
    expect(await lerFrequenciaDoTrajeto(base)).toEqual({ distancia_m: 300, intervalo_min: 3, lote_min: 6 });
  });
});

describe('ligar, desligar e manter (§3.2)', () => {
  it('liga se pode e não está ativa; mantém se já está; desliga se não pode mais', async () => {
    const liga = montar({ condicao: PODE });
    expect(await liga.trajeto.atualizar()).toBe('ligar');
    expect(liga.passos).toEqual(['ligar']);

    const mantem = montar({ condicao: PODE, ativa: true });
    expect(await mantem.trajeto.atualizar()).toBe('manter');
    expect(mantem.passos).toEqual([]);

    const desliga = montar({ condicao: NAO_PODE, ativa: true });
    expect(await desliga.trajeto.atualizar()).toBe('desligar');
    expect(desliga.passos).toEqual(['parar']);
  });

  it('§3.1 e §3.3: liga com a frequência do parâmetro; ela mudou, reinicia (para e liga) na próxima atualização', async () => {
    const f = { distancia_m: 500, intervalo_min: 10, lote_min: 15 };
    const liga = montar({ condicao: PODE, frequencia: f });
    expect(await liga.trajeto.atualizar()).toBe('ligar');
    expect(liga.ligadas).toEqual([opcoesDoTrajeto(f)]);

    const mudou = montar({ condicao: PODE, ativa: true, frequencia: f });
    expect(await mudou.trajeto.atualizar()).toBe('reiniciar');
    expect(mudou.passos).toEqual(['parar', 'ligar']);
    expect(mudou.ligadas).toEqual([opcoesDoTrajeto(f)]);
    // já com a nova: mantém
    expect(await mudou.trajeto.atualizar()).toBe('manter');
    expect(mudou.passos).toEqual(['parar', 'ligar']);

    // a captura não diz com que intervalos foi ligada: reinicia uma vez com os do parâmetro
    const semSaber = montar({ condicao: PODE, ativa: true, emUso: null });
    expect(await semSaber.trajeto.atualizar()).toBe('reiniciar');
    expect(semSaber.ligadas).toEqual([opcoesDoTrajeto()]);
  });

  it('sem poder rastrear, nem lê a frequência', async () => {
    const frequencia = vi.fn(async () => PARAMETROS_RASTREAMENTO_PADRAO.frequencia);
    const parar = vi.fn(async () => undefined);
    const t = criarTrajeto({
      captura: { ativa: async () => true, ligar: async () => undefined, parar, intervalosEmUso: async () => null },
      condicao: async () => () => NAO_PODE,
      frequencia,
      gravar: async () => undefined,
      novoId: () => ID,
      agora: () => AGORA,
      registrarErro: () => undefined,
    });
    expect(await t.atualizar()).toBe('desligar');
    expect(frequencia).not.toHaveBeenCalled();
    expect(parar).toHaveBeenCalledTimes(1);
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
      captura: { ativa: async () => false, ligar: () => Promise.reject(new Error('serviço em primeiro plano recusado')), parar: async () => undefined, intervalosEmUso: async () => null },
      condicao: async () => () => PODE,
      frequencia: async () => PARAMETROS_RASTREAMENTO_PADRAO.frequencia,
      gravar: async () => undefined,
      novoId: () => ID,
      agora: () => AGORA,
      registrarErro: (e) => t.erros.push(e),
    });
    expect(await c.atualizar()).toBeNull();
    expect(t.erros.map((e) => e.message)).toEqual(['serviço em primeiro plano recusado']);
  });
});

describe('logout e aparelho bloqueado param a captura (§3.4)', () => {
  it('parar desliga a captura ativa; sem captura ativa, não chama o aparelho', async () => {
    const ativa = montar({ ativa: true });
    await ativa.trajeto.parar();
    expect(ativa.passos).toEqual(['parar']);
    expect(ativa.ativa()).toBe(false);

    const parada = montar();
    await parada.trajeto.parar();
    expect(parada.passos).toEqual([]);
  });
});

describe('lote do Android (§3.1 e §3.2)', () => {
  it('grava os pontos aceitos', async () => {
    const t = montar();
    await t.trajeto.tratarLote([leitura(AGORA - 300_000), leitura(AGORA)], null);
    expect(t.gravados).toHaveLength(2);
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
  const servico = fonte('../services/trajeto.ts');

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

  it('RN-CORE-13: a tarefa monta a EntradaRastreio do banco do usuário da sessão, do cargo e do fuso da sessão, da variante e da permissão', () => {
    expect(servico).toMatch(/lerContextoDoRastreio\(aberto\.armazenamento, \{/);
    expect(servico).toMatch(/cargo: s\?\.user\?\.perfil \?\? null, app: varianteAtual\(\), fuso: s\?\.tenant\?\.fuso \|\| DEFAULT_TZ, permissao/);
    expect(servico).toMatch(/getBackgroundPermissionsAsync\(\)\s*\.then\(\(r\) => r\.granted\)\s*\.catch\(\(\) => false\)/);
    expect(servico).toMatch(/condicao: \(\) => condicaoDoTrajeto\(contextoDaSessao\)/);
  });
});

describe('Perfil e abertura do Campo: rastreamento interno (dono do produto, 19/11; RN-CORE-13)', () => {
  const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const perfil = fonte('../app/profile.tsx');
  const abas = fonte('../app/(tabs)/_layout.tsx');

  it('o vendedor não vê nada do rastreamento, nem no Diagnóstico do Perfil', () => {
    for (const t of [perfil, abas]) expect(t).not.toMatch(/[Tt]rajeto|[Rr]astre|[Ll]ocaliza/);
  });
});
