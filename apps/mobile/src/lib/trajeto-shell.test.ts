/**
 * T-0156 (docs/desenho/tracking.md §3.2, §3.4 e §9; RN-CORE-13): a tarefa `macuxi-trajeto` ligada ao shell. Dependências
 * injetadas (captura do aparelho, condição, gravação, Diagnóstico) e a ligação nos três gatilhos (abertura depois da carga,
 * volta ao primeiro plano e cada passada da `macuxi-sync-delta`), no logout e no aparelho bloqueado.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PontoTrajeto } from '@macuxi/core/contracts';
import { comPrefixo, type ArmazenamentoSync, type DriverSqlite } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  condicaoDoTrajeto,
  criarTrajeto,
  gravarPontosDoTrajeto,
  lerEstadoLocalDoRastreamento,
  lerPontosDoDia,
  PORTAO_DO_CORE,
  type CapturaDoAparelho,
  type CondicaoTrajeto,
  type DiagnosticoDoTrajeto,
  type EstadoLocalDoRastreamento,
  type LeituraDeLocalizacao,
  type PortaoDoTrajeto,
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
    expect(PORTAO_DO_CORE).toBeNull();
    const c = await condicaoDoTrajeto();
    for (const ms of [0, AGORA, Date.parse('2026-11-23T12:00:00.000Z')]) expect(c(ms)).toEqual({ pode: false, motivo: 'desligado' });
    const t = montar({ condicao: await condicaoDoTrajeto().then((f) => f(AGORA)) });
    expect(await t.trajeto.atualizar()).toBe('manter');
    expect(t.passos).toEqual([]);
    expect(t.diag()).toMatchObject({ estado: 'desligada' });
  });

  it('RN-CORE-13: sem o portão do Core, desligada mesmo com aceite e sem pausa (nem lê o aparelho)', async () => {
    const lerLocal = vi.fn(async (): Promise<EstadoLocalDoRastreamento> => ({ aceite: { versao: 1, aceito_em: '2026-11-19T12:00:00.000Z' }, pausa: null }));
    const c = await condicaoDoTrajeto(lerLocal);
    expect(c(AGORA)).toEqual({ pode: false, motivo: 'desligado' });
    expect(lerLocal).not.toHaveBeenCalled();
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

/** As chaves do Core (`CHAVE_ACEITE_LOCAL` e `CHAVE_PAUSA_LOCAL`, `@macuxi/core/app`). */
const CHAVES = { aceite: 'rastreamento.aceite', pausa: 'rastreamento.pausa' };

describe('aceite e pausa do Core no aparelho (§4.3 e §6; RN-CORE-13)', () => {
  it('lê as chaves rastreamento.aceite e rastreamento.pausa do armazenamento do Core (mod:core:), no formato que o Core grava', async () => {
    const base = memoria();
    // como o `useRastreamento` grava: `motor.armazenamentoDoModulo('core')` = a base com o prefixo `mod:core:`
    const core = comPrefixo(base, 'mod:core:');
    await core.gravar('rastreamento.aceite', { id: ID, versao: 2, aceito_em: '2026-11-19T12:00:00.000Z' });
    await core.gravar('rastreamento.pausa', { id: ID, inicio: '2026-11-19T12:30:00.000Z' });
    expect([...base.dados.keys()].sort()).toEqual(['mod:core:rastreamento.aceite', 'mod:core:rastreamento.pausa']);
    expect(await lerEstadoLocalDoRastreamento(base, CHAVES)).toEqual({ aceite: { versao: 2, aceito_em: '2026-11-19T12:00:00.000Z' }, pausa: { inicio: '2026-11-19T12:30:00.000Z' } });
  });

  it('sem as chaves, ou fora do formato: sem aceite e sem pausa', async () => {
    const base = memoria();
    expect(await lerEstadoLocalDoRastreamento(base, CHAVES)).toEqual({ aceite: null, pausa: null });
    await base.gravar('mod:core:rastreamento.aceite', { versao: '2', aceito_em: 'ontem' });
    await base.gravar('mod:core:rastreamento.pausa', { inicio: 7 });
    // a chave de outro módulo não vale
    await base.gravar('mod:vendedor:rastreamento.aceite', { versao: 1, aceito_em: '2026-11-19T12:00:00.000Z' });
    expect(await lerEstadoLocalDoRastreamento(base, CHAVES)).toEqual({ aceite: null, pausa: null });
  });

  it('RN-CORE-13: com o portão, cada instante passa por ele com o aceite e a pausa lidos uma vez', async () => {
    const local: EstadoLocalDoRastreamento = { aceite: { versao: 3, aceito_em: '2026-11-19T12:00:00.000Z' }, pausa: { inicio: '2026-11-19T13:30:00.000Z' } };
    const lerLocal = vi.fn(async () => local);
    const vistos: EstadoLocalDoRastreamento[] = [];
    // portão de teste: sem aceite não rastreia; dentro da pausa (60 min) não rastreia
    const portao: PortaoDoTrajeto = (l, ms) => {
      vistos.push(l);
      if (!l.aceite) return { pode: false, motivo: 'sem_aceite' };
      const inicio = l.pausa ? Date.parse(l.pausa.inicio) : Number.POSITIVE_INFINITY;
      return ms >= inicio && ms < inicio + 3_600_000 ? { pode: false, motivo: 'pausa' } : { pode: true };
    };
    const c = await condicaoDoTrajeto(lerLocal, portao);
    expect(c(AGORA)).toEqual({ pode: true });
    expect(c(Date.parse('2026-11-19T14:00:00.000Z'))).toEqual({ pode: false, motivo: 'pausa' });
    expect(lerLocal).toHaveBeenCalledTimes(1);
    expect(vistos.every((v) => v === local)).toBe(true);
    const semAceite = await condicaoDoTrajeto(async () => ({ aceite: null, pausa: null }), portao);
    expect(semAceite(AGORA)).toEqual({ pode: false, motivo: 'sem_aceite' });
  });

  it('com o portão, mas sem sessão ou sem banco: desligada', async () => {
    const portao = vi.fn<PortaoDoTrajeto>(() => ({ pode: true }));
    const c = await condicaoDoTrajeto(async () => null, portao);
    expect(c(AGORA)).toEqual({ pode: false, motivo: 'desligado' });
    expect(portao).not.toHaveBeenCalled();
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

describe('pontos de hoje para "Meu trajeto" (§3.4; definirPontosLocaisDoDia do Core)', () => {
  it('só os do dia civil no fuso do tenant, em ordem, sem velocidade', async () => {
    const db = await driverNode();
    await db.executar(DDL);
    const ids = (n: number) => `0b9a4c1e-7f3d-4a2b-9c8d-${String(n).padStart(12, '0')}`;
    await gravarPontosDoTrajeto(db, [
      // 19/11 em Manaus (UTC−4) vai de 19/11 04:00Z a 20/11 04:00Z
      ponto(ids(1), { capturado_em: '2026-11-19T03:59:00.000Z' }),
      ponto(ids(2), { capturado_em: '2026-11-20T01:00:00.000Z', velocidade_ms: 3 }),
      ponto(ids(3), { capturado_em: '2026-11-19T04:00:00.000Z' }),
      ponto(ids(4), { capturado_em: '2026-11-20T04:00:00.000Z' }),
    ]);
    expect(await lerPontosDoDia(db, '2026-11-19', 'America/Manaus')).toEqual([
      { capturado_em: '2026-11-19T04:00:00.000Z', latitude: LAT, longitude: LON, precisao_m: 12 },
      { capturado_em: '2026-11-20T01:00:00.000Z', latitude: LAT, longitude: LON, precisao_m: 12 },
    ]);
    expect(await lerPontosDoDia(db, '2026-11-18', 'America/Manaus')).toEqual([{ capturado_em: '2026-11-19T03:59:00.000Z', latitude: LAT, longitude: LON, precisao_m: 12 }]);
    await db.fechar();
  });

  it('sem a tabela ou com data inválida: vazio', async () => {
    const db = await driverNode();
    expect(await lerPontosDoDia(db, '2026-11-19', 'America/Manaus')).toEqual([]);
    await db.executar(DDL);
    expect(await lerPontosDoDia(db, '19/11/2026', 'America/Manaus')).toEqual([]);
    await db.fechar();
  });

  it('erro do banco sai sem coordenada', async () => {
    const db: Pick<DriverSqlite, 'todas'> = { todas: async () => Promise.reject(new Error(`falhou em ${LAT}, ${LON}`)) };
    const e = await lerPontosDoDia(db, '2026-11-19', 'America/Manaus').catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect(`${(e as Error).message}\n${(e as Error).stack ?? ''}`).not.toMatch(/3\.119|60\.021/);
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

  it('RN-CORE-13: a tarefa lê o aceite e a pausa nas chaves do Core, no banco do usuário da sessão', () => {
    expect(servico).toMatch(/import \{ CHAVE_ACEITE_LOCAL, CHAVE_PAUSA_LOCAL[^}]*\} from '@macuxi\/core\/app';/);
    expect(servico).toMatch(/lerEstadoLocalDoRastreamento\(aberto\.armazenamento, \{ aceite: CHAVE_ACEITE_LOCAL, pausa: CHAVE_PAUSA_LOCAL \}\)/);
    expect(servico).toMatch(/condicao: \(\) => condicaoDoTrajeto\(estadoLocalDaSessao\)/);
  });

  it('os pontos de hoje vão ao Core na abertura da sessão e saem no logout e no aparelho bloqueado', () => {
    const abrir = plataforma.slice(plataforma.indexOf('motorRef.current = m;'), plataforma.indexOf('setMotor(m);'));
    expect(abrir).toMatch(/definirPontosLocaisDoDia\(abertura\.tipo === 'sqlite' \? leitorDePontosLocais\(abertura\.arquivo\) : null\);/);
    const fechar = plataforma.slice(plataforma.indexOf('const fecharSessaoLocal = useCallback('), plataforma.indexOf('const logout = useCallback('));
    expect(fechar).toMatch(/definirPontosLocaisDoDia\(null\);/);
  });
});

describe('Perfil e abertura do Campo (spec do tracking §1 e §2; RN-CORE-13)', () => {
  const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const perfil = fonte('../app/profile.tsx');
  const abas = fonte('../app/(tabs)/_layout.tsx');
  const tela = perfil.slice(perfil.indexOf('function Perfil()'));
  const blocoDoCampo = tela.indexOf('{comTrajeto ? (\n        <>');

  it('a seção Localização aparece no Campo, depois do nome e antes de "Conta"', () => {
    expect(tela).toMatch(/const comTrajeto = varianteAtual\(\) === 'campo';/);
    const nome = tela.indexOf('style={styles.who}');
    const secao = tela.indexOf('<SecaoLocalizacaoPerfil />');
    const conta = tela.indexOf('<SectionHeader title="Conta" />');
    expect(nome).toBeGreaterThan(-1);
    expect(blocoDoCampo).toBeGreaterThan(nome);
    expect(secao).toBeGreaterThan(blocoDoCampo);
    expect(conta).toBeGreaterThan(secao);
  });

  it('o alerta do termo é montado na área Alertas do Perfil, antes da seção, só no Campo', () => {
    const area = perfil.slice(perfil.indexOf('function AlertasDoPerfil()'), perfil.indexOf('export default function ProfileScreen'));
    expect(area).toMatch(/if \(situacao !== 'pendente'\) return null;/);
    expect(area).toMatch(/ALERTAS[\s\S]*<AlertaTermoRastreamento \/>/);
    expect(tela.slice(blocoDoCampo, tela.indexOf('<SecaoLocalizacaoPerfil />'))).toMatch(/<AlertasDoPerfil \/>/);
  });

  it('o termo pendente abre depois da carga (layout das abas), só no Campo', () => {
    expect(abas).toMatch(/function AbrirTermoPendente\(\) \{\s*useAbrirTermoPendente\(\);\s*return null;/);
    const corpo = abas.slice(abas.indexOf('export default function TabsLayout'));
    expect(corpo.indexOf('if (!entradaLiberadaPeloMotor(estado)) return <Redirect href="/sync" />;')).toBeGreaterThan(-1);
    expect(corpo.indexOf('if (!entradaLiberadaPeloMotor(estado)) return <Redirect href="/sync" />;')).toBeLessThan(corpo.indexOf('<AbrirTermoPendente />'));
    expect(corpo).toMatch(/\{varianteAtual\(\) === 'campo' \? <AbrirTermoPendente \/> : null\}/);
  });
});
