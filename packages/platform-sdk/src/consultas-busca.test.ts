/**
 * T-0084 (critério 5; R-20261106-042933 🟡 2 e o 🟡 das faixas abertas) no SDK, com um índice de TESTE (sem o Catálogo):
 * - a consulta do aparelho (`ContextoConsultaAparelho.buscarComDesfecho`) usa o MESMO índice FTS5 que a aba
 *   (`motor.buscarComDesfecho`), só nos índices do próprio módulo, com limite;
 * - gancho de reindexação marcada (`IndiceBusca.versaoDocumentos`): virada de ano NO FUSO DO TENANT, formato novo,
 *   app atualizado; a busca não espera a reindexação, o fim do sync espera;
 * - desempenho sintético: 20 mil produtos com aplicação longa, pré-seleção pela consulta do aparelho com p95 < 300 ms.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ambienteIndisponivel } from './ambiente';
import { comBuscaEmJs, definirIndiceBusca, type ConsultaTexto, type ContextoIndice, type DesfechoBusca, type IndiceBusca } from './busca';
import { definirConsulta, ehConsultaIndisponivel, implementarConsultaAparelho, type ContextoConsultaAparelho } from './consultas';
import { defineModule } from './manifesto';
import { criarArmazenamentoEmMemoria, criarMotorSync, type ArmazenamentoSync } from './motor-sync';
import { criarShell, definirModuloShell } from './shell';
import { criarArmazenamentoSqlite } from './sqlite/armazenamento';
import { criarDriverNode } from './sqlite/driver-node';
import type { MigracaoAparelho } from './sqlite/esquema';
import { criarServidorSyncSimulado } from './sync-simulado';
import { definirEntidadeSync, type LinhaSync } from './sync';

// ---------- índice de teste: nome + aplicação com faixa aberta ("2018 em diante") ----------

const MIGRACOES: MigracaoAparelho[] = [
  {
    versao: 1,
    sql: `
      CREATE TABLE catalogo__aplic_doc (rid INTEGER PRIMARY KEY, produto_id TEXT NOT NULL UNIQUE, nome TEXT, aplicacao TEXT);
      CREATE VIRTUAL TABLE catalogo__aplic USING fts5(nome, aplicacao,
        content = 'catalogo__aplic_doc', content_rowid = 'rid',
        tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    `,
  },
];

interface Produto extends LinhaSync {
  nome: string;
  aplicacao: string | null;
}

/** Um formatador por fuso: criar `Intl.DateTimeFormat` custa caro (o Catálogo deve memorizar do mesmo jeito). */
const formatadores = new Map<string, Intl.DateTimeFormat>();
const anoNoFuso = (agora: Date, fuso: string) => {
  let f = formatadores.get(fuso);
  if (!f) formatadores.set(fuso, (f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric' })));
  return Number(f.format(agora));
};
/** "Gol 2018 em diante" → "Gol 2018 2019 … <ano corrente no fuso>" (o que o Catálogo faz em `expandirAplicacao`). */
const expandir = (texto: string | null, ctx: ContextoIndice) => {
  if (!texto?.includes('em diante')) return texto ?? '';
  const ate = anoNoFuso(ctx.agora, ctx.fuso);
  return texto.replace(/(\d{4}) em diante/g, (_, de: string) => {
    const anos: number[] = [];
    for (let a = Number(de); a <= ate; a++) anos.push(a);
    return anos.join(' ');
  });
};

/** Contextos vistos por `documento()` (para provar que o fuso do tenant chega à indexação). */
const vistos: ContextoIndice[] = [];
let portao: Promise<void> | null = null;

function indice(extra: Partial<IndiceBusca<'nome' | 'aplicacao'>> = {}) {
  return definirIndiceBusca<'nome' | 'aplicacao'>({
    id: 'catalogo.aplic',
    modulo: 'catalogo',
    tabelaDoc: 'catalogo__aplic_doc',
    tabelaFts: 'catalogo__aplic',
    colunaChave: 'produto_id',
    colunas: { nome: 5, aplicacao: 2 },
    fontes: ['produto'],
    chaveDe: (_e, l) => l.id,
    async documento(id, ler, ctx) {
      if (!ctx) throw new Error('o SDK sempre passa o contexto da indexação');
      vistos.push(ctx);
      if (portao) await portao;
      const [p] = await ler.porIds<Produto>('produto', [id]);
      if (!p || p.deleted_at) return null;
      return { nome: p.nome, aplicacao: expandir(p.aplicacao, ctx) };
    },
    versaoDocumentos: (ctx) => `v1:${anoNoFuso(ctx.agora, ctx.fuso)}`,
    ...extra,
  });
}
const INDICE = indice();

const T0 = '2026-11-06T10:00:00.000Z';
const prod = (n: number, nome: string, aplicacao: string | null): Produto => ({ id: `p${n}`, updated_at: T0, deleted_at: null, nome, aplicacao });
const PRODUTOS = [
  prod(1, 'Pastilha de freio', 'Uno 1.0/1.4 2010-2014; Palio 2012-2016'),
  prod(2, 'Filtro de óleo', 'Gol G5/G6 1.0/1.6 2018 em diante'),
  prod(3, 'Correia dentada', null),
];

const q = (...grupos: string[][]): ConsultaTexto => ({ grupos, prefixoNoUltimo: false });
const chaves = (d: DesfechoBusca) => (d.buscou ? d.resultados.map((r) => r.chave).sort() : d.motivo);

// ---------- módulos de teste ----------

const PRODUTO = definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });
const PEDIDO = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'servidor_vence', schema: z.object({}) });
const BUSCA = definirConsulta({
  nome: 'catalogo.busca_produtos@1',
  entrada: z.object({ q: z.string(), indice: z.string().optional(), limite: z.number().int().max(500).optional() }),
  saida: z.object({ buscou: z.boolean(), ids: z.array(z.string()), motivo: z.string().nullable() }),
});
type Exec = (e: z.output<typeof BUSCA.entrada>, ctx: ContextoConsultaAparelho) => Promise<z.input<typeof BUSCA.saida>>;
/** A pré-seleção como a aba faz: um termo por consulta ao FTS5, com limite (lib/local.ts `preselecionar`). */
const execPadrao: Exec = async (e, ctx) => {
  const d = await ctx.buscarComDesfecho(e.indice ?? 'catalogo.aplic', { grupos: [[e.q]], prefixoNoUltimo: true, limite: e.limite ?? 150 });
  return d.buscou ? { buscou: true, ids: d.resultados.map((r) => r.chave), motivo: null } : { buscou: false, ids: [], motivo: d.motivo };
};

function montarShell(exec: Exec = execPadrao) {
  const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], apps: { campo: { abas: [] } }, sync: ['produto'] });
  const catalogo = defineModule({
    id: 'catalogo',
    versao: '1.0.0',
    depende: ['core'],
    perfis: ['vendedor'],
    apps: { campo: { abas: [] } },
    ofereceConsultas: ['catalogo.busca_produtos@1'],
  });
  const vendedor = defineModule({
    id: 'vendedor',
    versao: '1.0.0',
    depende: ['core', 'catalogo'],
    perfis: ['vendedor'],
    apps: { campo: { abas: ['Pedidos'] } },
    sync: ['pedido'],
    usaConsultas: ['catalogo.busca_produtos@1'],
  });
  return criarShell('campo', [
    definirModuloShell({ manifesto: core, entidadesSync: [PRODUTO] }),
    definirModuloShell({ manifesto: catalogo, migracoesAparelho: MIGRACOES, indicesBusca: [INDICE], consultas: [implementarConsultaAparelho(BUSCA, exec)] }),
    definirModuloShell({ manifesto: vendedor, entidadesSync: [PEDIDO] }),
  ]);
}

const ATIVOS = ['core', 'catalogo', 'vendedor'] as const;

async function sincronizado(o: { exec?: Exec; armazenamento?: (s: ReturnType<typeof montarShell>) => ArmazenamentoSync; fuso?: string; agora?: () => Date; linhas?: Produto[] } = {}) {
  const shell = montarShell(o.exec);
  const armazenamento =
    o.armazenamento?.(shell) ??
    criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
      migracoesModulos: shell.migracoesAparelho,
      indicesBusca: shell.indicesBusca,
      entidades: shell.registroSync.entidadesAtivas([...ATIVOS]).map((e) => ({ nome: e.nome, modulo: e.modulo })),
      agora: o.agora,
    });
  const servidor = criarServidorSyncSimulado(shell.registroSync, { modulosAtivos: [...ATIVOS], linhas: { produto: [...(o.linhas ?? PRODUTOS)] } });
  const ambiente = { ...ambienteIndisponivel(), online: () => true, usuario: () => ({ id: 'u1', nome: 'Vendedor', perfil: 'vendedor' as const, fuso: o.fuso }) };
  const motor = criarMotorSync({ registro: shell.registroSync, armazenamento, transporte: servidor, consultas: shell.consultas, ambiente, agora: o.agora });
  await motor.aplicarModulosAtivos([...ATIVOS]);
  expect(await motor.sincronizar()).toBe(true);
  return { motor, servidor, armazenamento };
}

describe('consulta do aparelho com o índice FTS5 do próprio módulo (T-0084, 🟡 2 de R-20261106-042933)', () => {
  it('mesmo resultado (conteúdo e ordem) que a aba (motor.buscarComDesfecho), offline, com o limite da consulta', async () => {
    const { motor, servidor } = await sincronizado();
    servidor.online = false;
    for (const termo of ['uno', 'gol', 'pastilha', 'filtro', '2012']) {
      const aba = await motor.buscarComDesfecho('catalogo.aplic', { grupos: [[termo]], prefixoNoUltimo: true, limite: 150 });
      const c = await motor.ambiente.consultar(BUSCA, { q: termo });
      expect(c).toEqual({ buscou: true, ids: aba.buscou ? aba.resultados.map((r) => r.chave) : ['?'], motivo: null });
    }
    expect((await motor.ambiente.consultar(BUSCA, { q: 'uno' })).ids).toEqual(['p1']);
    // "busquei e não achei" continua distinguível de "não consegui buscar"
    expect(await motor.ambiente.consultar(BUSCA, { q: 'inexistente' })).toEqual({ buscou: true, ids: [], motivo: null });
    expect(await motor.ambiente.consultar(BUSCA, { q: 'a' })).toEqual({ buscou: false, ids: [], motivo: 'consulta_vazia' });
    // limite da ConsultaTexto: no máximo `limite` chaves
    expect((await motor.ambiente.consultar(BUSCA, { q: 'f', limite: 1 })).ids.length).toBeLessThanOrEqual(1);
    expect((await motor.ambiente.consultar(BUSCA, { q: 'de', limite: 1 })).ids).toHaveLength(1);
  });

  it('índice de outro módulo (inclusive de depende) = erro de programação; índice do dono não registrado também', async () => {
    const { motor } = await sincronizado();
    const outro = await motor.ambiente.consultar(BUSCA, { q: 'uno', indice: 'core.produto' }).catch((e: unknown) => e as Error);
    expect(ehConsultaIndisponivel(outro)).toBe(false);
    expect((outro as Error).message).toContain('só busca nos índices de catalogo (pediu core.produto)');
    // prefixo parecido não engana
    expect(((await motor.ambiente.consultar(BUSCA, { q: 'uno', indice: 'catalogox.aplic' }).catch((e: unknown) => e)) as Error).message).toContain('só busca nos índices de catalogo');
    expect(((await motor.ambiente.consultar(BUSCA, { q: 'uno', indice: 'catalogo.outro' }).catch((e: unknown) => e)) as Error).message).toContain('não registrado');
  });

  it('armazenamento sem busca (AsyncStorage/memória): sem_busca — o módulo varre como a aba; com busca em JS, mesmo conjunto', async () => {
    const semBusca = await sincronizado({ armazenamento: () => criarArmazenamentoEmMemoria() });
    expect(await semBusca.motor.ambiente.consultar(BUSCA, { q: 'uno' })).toEqual({ buscou: false, ids: [], motivo: 'sem_busca' });
    const emJs = await sincronizado({ armazenamento: (s) => comBuscaEmJs(criarArmazenamentoEmMemoria(), s.indicesBusca) });
    expect((await emJs.motor.ambiente.consultar(BUSCA, { q: 'uno' })).ids).toEqual(['p1']);
  });
});

describe('gancho de reindexação marcada: versaoDocumentos (T-0084, faixas abertas)', () => {
  const opcoes = (agora: () => Date, extra: Partial<Parameters<typeof criarArmazenamentoSqlite>[1]> = {}) => ({
    migracoesModulos: { catalogo: MIGRACOES },
    indicesBusca: [INDICE] as IndiceBusca[],
    entidades: [{ nome: 'produto', modulo: 'core' as const }],
    agora,
    ...extra,
  });
  const buscar = (a: ArmazenamentoSync, termo: string) => a.busca!.buscarComDesfecho!('catalogo.aplic', q([termo])).then(chaves);

  it('virada de ano NO FUSO DO TENANT: só reindexa quando o ano muda no fuso; a busca de "2027" passa a achar a faixa aberta', async () => {
    let agora = new Date('2026-12-31T12:00:00.000Z');
    const a = criarArmazenamentoSqlite(criarDriverNode(':memory:'), opcoes(() => agora));
    await a.busca.conferirVersoes!({ fuso: 'America/Manaus' });
    await a.linhas.aplicar('produto', PRODUTOS, 'k');
    await a.busca.finalizar!();
    expect(await a.ler('_busca:catalogo.aplic:versao')).toBe('v1:2026');
    expect(await buscar(a, '2026')).toEqual(['p2']);
    expect(await buscar(a, '2027')).toEqual([]);
    // 23h30 de 31/12 em Manaus (UTC-4) = 03h30 de 1º/1 em UTC: ainda 2026 no fuso do tenant
    agora = new Date('2027-01-01T03:30:00.000Z');
    await a.busca.conferirVersoes!({ fuso: 'America/Manaus' });
    expect(await a.ler('_busca:catalogo.aplic:reindexar')).toBeNull();
    // em São Paulo (UTC-3) já é 00h30 de 2027: outro tenant, outra virada
    await a.busca.conferirVersoes!({ fuso: 'America/Sao_Paulo' });
    expect(await a.ler('_busca:catalogo.aplic:reindexar')).toBe('versao');
    expect(await a.ler('_busca:catalogo.aplic:versao')).toBe('v1:2027');
    await a.busca.finalizar!(); // o fim do sync espera a reindexação
    expect(await a.ler('_busca:catalogo.aplic:reindexar')).toBeNull();
    expect(await buscar(a, '2027')).toEqual(['p2']);
    // nada mudou: conferir de novo não marca nada
    await a.busca.conferirVersoes!({ fuso: 'America/Sao_Paulo' });
    expect(await a.ler('_busca:catalogo.aplic:reindexar')).toBeNull();
    expect(vistos.at(-1)).toMatchObject({ fuso: 'America/Sao_Paulo' });
  });

  it('a busca não espera a reindexação por versão: responde com os documentos antigos e a reindexação segue', async () => {
    let agora = new Date('2026-12-31T12:00:00.000Z');
    const a = criarArmazenamentoSqlite(criarDriverNode(':memory:'), opcoes(() => agora));
    await a.linhas.aplicar('produto', PRODUTOS, 'k');
    await a.busca.finalizar!();
    await a.busca.conferirVersoes!({});
    agora = new Date('2027-01-02T12:00:00.000Z');
    await a.busca.conferirVersoes!({});
    let soltar!: () => void;
    portao = new Promise<void>((r) => (soltar = r));
    try {
      // a reindexação para no portão (dentro do documento()); a busca responde mesmo assim, sem 2027 ainda
      expect(await buscar(a, 'gol')).toEqual(['p2']);
      expect(await buscar(a, '2027')).toEqual([]);
      expect(await a.ler('_busca:catalogo.aplic:reindexar')).toBe('versao');
    } finally {
      portao = null;
      soltar();
    }
    await a.busca.finalizar!();
    expect(await buscar(a, '2027')).toEqual(['p2']);
  });

  it('app atualizado (índice com documentos e sem versão guardada) reindexa uma vez; índice vazio só guarda a versão', async () => {
    const driver = criarDriverNode(':memory:');
    const agora = () => new Date(T0);
    const antigo = criarArmazenamentoSqlite(driver, opcoes(agora, { indicesBusca: [indice({ versaoDocumentos: undefined })] }));
    await antigo.linhas.aplicar('produto', PRODUTOS, 'k');
    await antigo.busca.finalizar!();
    const novo = criarArmazenamentoSqlite(driver, opcoes(agora));
    await novo.busca.conferirVersoes!({});
    expect(await novo.ler('_busca:catalogo.aplic:reindexar')).toBe('versao');
    await novo.busca.finalizar!();
    await novo.busca.conferirVersoes!({});
    expect(await novo.ler('_busca:catalogo.aplic:reindexar')).toBeNull();
    // formato novo do documento (v2) numa versão do app: reindexa de novo
    const v2 = criarArmazenamentoSqlite(driver, opcoes(agora, { indicesBusca: [indice({ versaoDocumentos: () => 'v2' })] }));
    await v2.busca.conferirVersoes!({});
    expect(await v2.ler('_busca:catalogo.aplic:reindexar')).toBe('versao');
    // índice vazio: só a versão
    const vazio = criarArmazenamentoSqlite(criarDriverNode(':memory:'), opcoes(agora));
    await vazio.busca.conferirVersoes!({});
    expect(await vazio.ler('_busca:catalogo.aplic:reindexar')).toBeNull();
    expect(await vazio.ler('_busca:catalogo.aplic:versao')).toBe('v1:2026');
  });

  it('a marca do L-1 (índice vazio, a busca espera) não é rebaixada para versao; versaoDocumentos que lança não derruba a busca', async () => {
    const driver = criarDriverNode(':memory:');
    const a = criarArmazenamentoSqlite(driver, opcoes(() => new Date(T0)));
    await a.linhas.aplicar('produto', PRODUTOS, 'k');
    await a.busca.finalizar!();
    await a.gravar('_busca:catalogo.aplic:reindexar', true);
    await a.gravar('_busca:catalogo.aplic:versao', 'velha');
    await a.busca.conferirVersoes!({});
    expect(await a.ler('_busca:catalogo.aplic:reindexar')).toBe(true);
    const erros: string[] = [];
    const ruim = criarArmazenamentoSqlite(criarDriverNode(':memory:'), opcoes(() => new Date(T0), {
      indicesBusca: [indice({ versaoDocumentos: () => { throw new Error('bug do módulo'); } })],
      registrarErro: (m) => erros.push(m),
    }));
    await ruim.linhas.aplicar('produto', PRODUTOS, 'k');
    await expect(ruim.busca.conferirVersoes!({})).resolves.toBeUndefined();
    expect(erros.join(' ')).toContain('versaoDocumentos falhou');
    expect(await buscar(ruim, 'uno')).toEqual(['p1']);
  });

  it('motor: o fuso do login chega à indexação e a conferência roda antes da busca e no fim do sync', async () => {
    vistos.length = 0;
    let agora = new Date('2026-12-31T12:00:00.000Z');
    const { motor, armazenamento } = await sincronizado({ fuso: 'America/Sao_Paulo', agora: () => agora });
    expect(await armazenamento.ler('_busca:catalogo.aplic:versao')).toBe('v1:2026');
    agora = new Date('2027-01-01T03:30:00.000Z'); // 00h30 em São Paulo
    await motor.buscarComDesfecho('catalogo.aplic', q(['gol']));
    expect(await armazenamento.ler('_busca:catalogo.aplic:versao')).toBe('v1:2027');
    expect(await motor.sincronizar()).toBe(true);
    expect((await motor.ambiente.consultar(BUSCA, { q: '2027' })).ids).toEqual(['p2']);
    expect(vistos.every((c) => c.fuso === 'America/Sao_Paulo')).toBe(true);
    // sem fuso no login (demonstração): o padrão do SDK
    const semFuso = await sincronizado({ agora: () => new Date(T0) });
    await semFuso.motor.buscarComDesfecho('catalogo.aplic', q(['gol']));
    expect(vistos.at(-1)?.fuso).toBe('America/Manaus');
  });

  it('busca em JS: documentos montados na hora com o fuso informado (nada a reindexar)', async () => {
    vistos.length = 0;
    const a = comBuscaEmJs(criarArmazenamentoEmMemoria({ 'ent:produto': Object.fromEntries(PRODUTOS.map((p) => [p.id, p])) }), [INDICE]);
    await a.busca!.conferirVersoes!({ fuso: 'America/Sao_Paulo' });
    expect(await buscar(a, 'gol')).toEqual(['p2']);
    expect(vistos.at(-1)?.fuso).toBe('America/Sao_Paulo');
  });
});

// ---------- desempenho sintético (critério 5): 20 mil produtos com aplicação longa ----------

/** Gerador determinístico (sem Math.random): mesma base em toda máquina. */
function gerador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const VEICULOS = ['Uno', 'Palio', 'Gol', 'Fox', 'Celta', 'Corsa', 'Onix', 'Prisma', 'Ka', 'Fiesta', 'Strada', 'Saveiro', 'HB20', 'Sandero', 'Logan', 'Civic', 'Corolla', 'Hilux', 'S10', 'Ranger'];
const VERSOES = ['1.0', '1.0/1.4', '1.6', 'G5/G6', '2.0 16V', 'Flex', 'Fire', 'Turbo'];
const PECAS = ['Pastilha de freio', 'Filtro de óleo', 'Filtro de ar', 'Correia dentada', 'Amortecedor', 'Vela de ignição', 'Disco de freio', 'Bomba d’água'];

function produtosSinteticos(n: number): Produto[] {
  const r = gerador(84);
  const pega = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  return Array.from({ length: n }, (_, k) => {
    const trechos: string[] = [];
    // aplicação longa: 12 a 30 trechos (~400 a 1.000 caracteres), alguns com faixa aberta
    for (let t = 0, total = 12 + Math.floor(r() * 19); t < total; t++) {
      const de = 1995 + Math.floor(r() * 28);
      const faixa = r() < 0.1 ? `${de} em diante` : `${de}-${de + Math.floor(r() * 8)}`;
      trechos.push(`${pega(VEICULOS)} ${pega(VERSOES)} ${faixa}`);
    }
    return prod(100_000 + k, `${pega(PECAS)} ${pega(VEICULOS)} ${k}`, trechos.join('; '));
  });
}

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

/**
 * Referência da máquina, FORA do código medido: um `bm25` puro sobre uma tabela FTS5 própria (20 mil linhas curtas,
 * todas casando). No PC de desenvolvimento sem carga, ~35 ms (mínimo de 75 medições, 2026-11-06); com outros agentes,
 * testes em paralelo ou runner compartilhado, sobe junto com a consulta medida. Devolve o fator (≥ 1) do momento.
 */
const REFERENCIA_NOMINAL_MS = 35;
async function calibrador(): Promise<() => Promise<number>> {
  const d = criarDriverNode(':memory:');
  await d.executar(`CREATE VIRTUAL TABLE referencia USING fts5(t, tokenize = 'unicode61 remove_diacritics 2')`);
  await d.transacaoExclusiva(async (tx) => {
    for (let k = 0; k < 20_000; k++) await tx.rodar('INSERT INTO referencia (t) VALUES (?)', [`alfa beta ${k % 97} gama ${k}`]);
  });
  const sql = `SELECT rowid, bm25(referencia) AS p FROM referencia WHERE referencia MATCH ? ORDER BY p LIMIT 150`;
  await d.todas(sql, ['"alfa"']);
  return async () => {
    const t = performance.now();
    await d.todas(sql, ['"alfa"']);
    return Math.max(1, (performance.now() - t) / REFERENCIA_NOMINAL_MS);
  };
}

describe('desempenho: 20 mil produtos com aplicação longa (T-0084 critério 5)', { timeout: 240_000 }, () => {
  it('pré-seleção da consulta do aparelho (todos os termos num MATCH; por termo só se faltar) com p95 < 300 ms', async () => {
    const shell = montarShell(async (e, ctx) => {
      // o `bm25` custa por documento que casa: termo denso ("uno", "2012") sozinho ranqueia ~13 mil linhas (~36 ms no
      // node, cada). Primeiro os termos juntos (AND: ranqueia só a interseção); a união termo a termo, como o
      // `preselecionar` de hoje, só quando o AND trouxe menos que o limite
      const grupos = e.q.split(' ').map((t) => [t]);
      const limite = 150;
      const juntos = await ctx.buscarComDesfecho('catalogo.aplic', { grupos, prefixoNoUltimo: true, limite });
      const ids = new Set(juntos.buscou ? juntos.resultados.map((x) => x.chave) : []);
      if (ids.size < limite)
        for (const g of grupos) {
          const d = await ctx.buscarComDesfecho('catalogo.aplic', { grupos: [g], prefixoNoUltimo: true, limite });
          if (d.buscou) for (const x of d.resultados) ids.add(x.chave);
        }
      return { buscou: true, ids: [...ids], motivo: null };
    });
    const agora = () => new Date(T0);
    const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
      migracoesModulos: shell.migracoesAparelho,
      indicesBusca: shell.indicesBusca,
      entidades: [{ nome: 'produto', modulo: 'core' }],
      agora,
    });
    // como no 1º sync (o motor confere antes do pull): versão guardada com o índice vazio, sem reindexar depois
    await armazenamento.busca.conferirVersoes!({});
    const produtos = produtosSinteticos(20_000);
    expect(produtos.reduce((s, p) => s + (p.aplicacao?.length ?? 0), 0) / produtos.length).toBeGreaterThan(400);
    for (let k = 0; k < produtos.length; k += 1000) await armazenamento.linhas.aplicar('produto', produtos.slice(k, k + 1000), `k${k}`);
    await armazenamento.busca.finalizar!();
    const motor = criarMotorSync({
      registro: shell.registroSync,
      armazenamento,
      transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
      consultas: shell.consultas,
      agora,
    });
    await motor.carregar();
    await motor.aplicarModulosAtivos([...ATIVOS]);

    // a última cai na união termo a termo (o AND não acha nada)
    const frases = ['pastilha uno 2012', 'filtro gol 2014', 'amortecedor palio', 'correia onix 2019', 'vela ka 1.0', 'disco hilux 2021', 'g5 g6', 'filtro ar civic 2008', 'bomba s10', 'fiesta xyzw'];
    const calibrar = await calibrador();
    for (const f of frases.slice(0, 3)) await motor.ambiente.consultar(BUSCA, { q: f }); // aquecimento (cache do SQLite, JIT)
    /** Frase → tempos das 5 voltas, já divididos pelo fator da máquina medido logo antes. */
    const tempos = new Map<string, number[]>(frases.map((f) => [f, []]));
    const fatores: number[] = [];
    for (let volta = 0; volta < 5; volta++)
      for (const f of frases) {
        const fatorMaquina = await calibrar();
        fatores.push(fatorMaquina);
        const t = performance.now();
        const r = await motor.ambiente.consultar(BUSCA, { q: f });
        tempos.get(f)!.push((performance.now() - t) / fatorMaquina);
        expect(r.buscou).toBe(true);
      }
    expect((await motor.ambiente.consultar(BUSCA, { q: 'uno' })).ids).toHaveLength(150);
    expect(await armazenamento.ler('_busca:catalogo.aplic:reindexar')).toBeNull(); // nada em segundo plano durante a medição
    // Tolerante à máquina: cada tempo é dividido pelo fator da máquina (`calibrador`, medido logo antes, ≥ 1) e a
    // mediana das 5 voltas de cada frase tira os picos que sobram; o p95 é sobre as medianas. Teto = orçamento do
    // critério (300 ms); MACUXI_FATOR_DESEMPENHO folga mais. O critério de verdade é medido no aparelho (tela de medição).
    // Base pessimista: 20 modelos de veículo, então "uno"/"gol"/"2012" casam ~65% dos 20 mil documentos.
    const folga = Number(process.env.MACUXI_FATOR_DESEMPENHO ?? '1') || 1;
    const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const medido = p95([...tempos.values()].map(mediana));
    expect(medido, `p95 das medianas = ${medido.toFixed(1)} ms (teto ${300 * folga} ms; fator da máquina mediano ${mediana(fatores).toFixed(2)})`).toBeLessThan(300 * folga);
  });
});
