/**
 * RN-CAT-22 / P4 (desenho `docs/desenho/filtro-veiculo.md` §4.2): a consulta do aparelho e a da API dão o MESMO resultado com veículo:
 * os itens e a ordem de `catalogo.busca_produtos@1`, e a cascata de `catalogo.veiculos@1`.
 * O aparelho lê as linhas locais; a API, o banco falso por SQL. O ponta a ponta com Postgres é do agente testes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import type { VeiculoEscolhido } from '../contracts';
import { esquecerMemoriaLocal } from '../app/lib/local';
import { esquecerMemoriaTextos, consultaBuscaProdutosAparelho } from '../app/texto-consultas';
import { consultaVeiculosAparelho, esquecerVeiculosRecentes } from '../app/veiculos-consulta';
import { consultaBuscaProdutos, consultaVeiculos } from './consultas-texto';

const uuid = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const NOMES = ['Amortecedor dianteiro', 'Amortecedor traseiro', 'Pastilha de freio', 'Disco de freio', 'Coxim do motor', 'Bucha da bandeja', 'Terminal de direção', 'Barra axial', 'Pivô da suspensão', 'Kit de embreagem', 'Correia dentada', 'Bomba de combustível', 'Filtro de ar', 'Vela de ignição', 'Junta do cabeçote', 'Fluido de freio'];
const APLICACOES = [
  ...Array(4).fill('VW Gol 2017–2019 1.0/1.6 Highline'),
  ...Array(3).fill('Volkswagen Gol 2018 1.0 Trendline'),
  'VW Gol',
  'Gol 2020>',
  ...Array(3).fill('Ford EcoSport 2012–2016 1.6'),
  ...Array(3).fill('Civic 07–11 · Fit 2003>'),
  '',
] as string[];
const LINHAS = NOMES.map((nome, i) => ({ id: uuid(i + 1), nome, aplicacao: APLICACOES[i]! }));

const GOL_2018: VeiculoEscolhido = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: null, versao: null };
const ESCOLHAS: VeiculoEscolhido[] = [
  GOL_2018,
  { ...GOL_2018, motor: '1.0', versao: 'Highline' },
  { ...GOL_2018, ano: null },
  { ...GOL_2018, ano: 2020 },
  { montadora: null, modelo: 'Civic', ano: 2009, motor: null, versao: null },
  { montadora: 'Ford', modelo: 'EcoSport', ano: 2014, motor: '1.6', versao: null },
];

const CLIENTE = '0ca00000-0000-4000-8000-0000000c1e01';
const TABELA = '0ca00000-0000-4000-8000-0000000007ab';
/** Os produtos que o cliente pode comprar (têm preço na tabela dele): Gol Highline (2), Civic (1) e o fluido universal (1). */
const VENDAVEIS = [0, 1, 12, 15].map((i) => LINHAS[i]!.id);

function aparelho(escopo = false) {
  const tabelas: Record<string, unknown[]> = {
    ...(escopo
      ? {
          cliente_tabela_preco: [{ id: uuid(2001), ...base, cliente_id: CLIENTE, tabela_preco_id: TABELA }],
          tabela_preco: [{ id: TABELA, ...base, codigo: 'T1', nome: 'Tabela 1', ativo: true }],
          tabela_preco_item: VENDAVEIS.map((produto_id, k) => ({ id: uuid(3000 + k), ...base, tabela_preco_id: TABELA, produto_id, preco_cents: 1000, vigencia_inicio: null, vigencia_fim: null })),
        }
      : {}),
    produto: LINHAS.map((l, i) => ({ id: l.id, ...base, sku: `SK-${i + 1}`, ean: null, nome: l.nome, marca: 'BAP', categoria: 'Linha', unidade: 'UN', ativo: true })),
    produto_atributo: [],
    produto_conteudo: LINHAS.map((l, i) => ({ id: uuid(1000 + i), ...base, produto_id: l.id, aplicacao: l.aplicacao || null, campanha: false })),
    produto_referencia: [],
    sinonimo: [],
  };
  return { linhas: async (e: string) => tabelas[e] ?? [], versaoLinhas: () => 1, agora: () => new Date('2026-11-06T12:00:00Z'), usuario: () => (escopo ? { perfil: 'vendedor', fuso: 'America/Manaus' } : null), parametros: () => ({}) } as unknown as ContextoConsultaAparelho;
}

function api() {
  const db = {
    query: async (sql: string) => {
      if (/from catalogo\.cliente_tabela_preco/.test(sql)) return { rows: [{ tabela_preco_id: TABELA }] };
      if (/from catalogo\.tabela_preco_item/.test(sql)) return { rows: VENDAVEIS.map((produto_id) => ({ produto_id, preco_cents: 1000, vigencia_inicio: null, vigencia_fim: null })) };
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: String(LINHAS.length), ate: '2026-10-01' }] };
      if (/select b\.nome/.test(sql)) return { rows: LINHAS.map((l) => ({ nome: l.nome, aplicacao: l.aplicacao || null, descricao: null })) };
      if (/select produto_id, aplicacao from/.test(sql)) return { rows: LINHAS.map((l) => ({ produto_id: l.id, aplicacao: l.aplicacao || null })) };
      if (/produto_busca/.test(sql)) return { rows: LINHAS.map((l, i) => ({ produto_id: l.id, sku: `SK-${i + 1}`, ean: null, nome: l.nome, marca: 'BAP', categoria: 'Linha', atributos: null, aplicacao: l.aplicacao || null, ativo: true })) };
      return { rows: [] };
    },
  };
  const consultar = async () => ({ padrao_id: uuid(9), filiais: [], clientes: [] });
  return { db, consultar, usuario: { perfil: 'vendedor' }, parametros: () => ({}), agora: () => new Date('2026-11-06T12:00:00Z'), fuso: () => 'America/Manaus' };
}

type Item = { produto_id: string; aplicacao?: unknown } & Record<string, unknown>;
type Saida = { itens: Item[]; total: number; disponivel: boolean; recentes: { veiculo: unknown; rotulos: { curto: string } }[] } & Record<string, unknown>;
type Exec = { executar(e: unknown, c: unknown): Promise<Saida> };
const buscaAparelho = (e: unknown) => (consultaBuscaProdutosAparelho as unknown as Exec).executar(e, aparelho());
const buscaApi = (e: unknown) => (consultaBuscaProdutos as unknown as Exec).executar(e, api());
const cascataAparelho = (e: unknown, escopo = false) => (consultaVeiculosAparelho as unknown as Exec).executar(e, aparelho(escopo));
const cascataApi = (e: unknown) => (consultaVeiculos as unknown as Exec).executar(e, api());
const itens = (r: Saida) => r.itens.map(({ aplicacao: _a, ...x }) => x);

describe('RN-CAT-22 / P4: aparelho e API dão o mesmo resultado com veículo', () => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
    esquecerVeiculosRecentes();
  });

  it.each(ESCOLHAS.map((v, i) => [i, v] as const))('busca_produtos sem texto, veículo #%i: mesmos itens e mesma ordem', async (_i, veiculo) => {
    const entrada = { q: '', veiculo, limite: 100 };
    const a = itens(await buscaAparelho(entrada));
    const b = itens(await buscaApi(entrada));
    expect(a).toEqual(b);
  });

  it.each(['amortecedor', 'freio', 'gol'])('busca_produtos com texto "%s" e veículo: mesmos itens', async (q) => {
    const entrada = { q, veiculo: GOL_2018, limite: 100 };
    expect(itens(await buscaAparelho(entrada))).toEqual(itens(await buscaApi(entrada)));
  });

  it('RN-CAT-22 (D4): com ano só entram as peças com o ano; sem ano entram todas as do modelo, inclusive a sem ano (aparelho = API)', async () => {
    const ids = async (veiculo: VeiculoEscolhido) => {
      const a = (await buscaAparelho({ q: '', veiculo, limite: 100 })).itens.map((i) => i.produto_id);
      expect((await buscaApi({ q: '', veiculo, limite: 100 })).itens.map((i) => i.produto_id)).toEqual(a);
      return a;
    };
    const semAno = LINHAS[7]!.id; // "VW Gol", sem ano
    const com = await ids(GOL_2018);
    expect(com).toHaveLength(7);
    expect(com).not.toContain(semAno);
    const sem = await ids({ ...GOL_2018, ano: null });
    expect(sem).toHaveLength(9);
    expect(sem).toContain(semAno);
    expect(await ids({ ...GOL_2018, motor: '1.6' })).toHaveLength(4);
    expect(await ids({ ...GOL_2018, versao: 'Trendline' })).toHaveLength(3);
    const r = await buscaAparelho({ q: '', veiculo: GOL_2018, limite: 100 });
    expect(r.total).toBe(r.itens.length);
  });

  it('RN-CAT-22: a busca não traz campo veiculo por item, com ou sem veículo', async () => {
    for (const e of [{ q: 'amortecedor', limite: 10 }, { q: '', veiculo: GOL_2018, limite: 10 }]) {
      const r = await buscaAparelho(e);
      expect(r.itens.every((i: Record<string, unknown>) => !('veiculo' in i))).toBe(true);
    }
  });

  it.each([
    [{}],
    [{ escolha: { montadora: 'Volkswagen' } }],
    [{ escolha: { montadora: 'Ford' } }],
    [{ escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 } }],
    [{ escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0' } }],
    [{ busca: 'vw' }],
    [{ busca: 'gol' }],
    [{ busca: 'xyz' }],
  ])('catalogo.veiculos@1 %j: a mesma cascata', async (entrada) => {
    const { recentes: _r1, ...a } = await cascataAparelho(entrada);
    const { recentes: r2, ...b } = await cascataApi(entrada);
    expect(a).toEqual(b);
    expect(r2).toEqual([]);
    expect(a.disponivel).toBe(true);
  });

  it('RN-CAT-22: os Recentes ficam só no aparelho (até 3, o último no topo) e a API devolve vazio', async () => {
    for (const v of ESCOLHAS.slice(0, 4)) await buscaAparelho({ q: '', veiculo: v, limite: 10 });
    const r = await cascataAparelho({});
    expect(r.recentes).toHaveLength(3);
    expect(r.recentes[0]!.veiculo).toEqual(ESCOLHAS[3]);
    expect(r.recentes[0]!.rotulos.curto).toBe('Gol 2020');
  });

  it('RN-CAT-22: tenant sem veículo nas aplicações: disponivel = false (sem o botão)', async () => {
    const vazio = { ...aparelho(), linhas: async (e: string) => (e === 'produto_conteudo' ? [] : await (aparelho() as unknown as { linhas(e: string): Promise<unknown[]> }).linhas(e)) } as unknown as ContextoConsultaAparelho;
    const r = await (consultaVeiculosAparelho as unknown as Exec).executar({}, vazio);
    expect(r).toMatchObject({ disponivel: false, opcoes: [], nivel: null });
  });

  describe('escopo do cliente em catalogo.veiculos@1', () => {
    const POR_CLIENTE = { cliente_id: CLIENTE };
    const POR_IDS = { produto_ids: [LINHAS[9]!.id, LINHAS[10]!.id, LINHAS[12]!.id] };
    const sem = ({ recentes: _r, ...x }: Saida) => x;

    it.each([
      ['cliente', POR_CLIENTE, {}],
      ['cliente', POR_CLIENTE, { escolha: { montadora: 'Volkswagen' } }],
      ['cliente', POR_CLIENTE, { escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 } }],
      ['cliente', POR_CLIENTE, { busca: 'gol' }],
      ['cliente', POR_CLIENTE, { busca: 'ecosport' }],
      ['produto_ids', POR_IDS, {}],
      ['produto_ids', POR_IDS, { busca: 'civic' }],
    ])('RN-CAT-22: escopo por %s, entrada %j: a mesma cascata no aparelho e na API', async (_n, escopo, resto) => {
      const entrada = { ...resto, ...escopo };
      const a = sem(await cascataAparelho(entrada, true));
      const b = sem(await cascataApi(entrada));
      expect(a).toEqual(b);
    });

    it('RN-CAT-22: com o cliente, só aparece o que se pode vender a ele (o Ford fora da tabela some; o Gol Highline fica)', async () => {
      const r = await cascataAparelho(POR_CLIENTE, true);
      expect(r.disponivel).toBe(true);
      expect((r.trilha as { nivel: string; valor: string; automatico: boolean }[]).map((p) => [p.nivel, p.valor, p.automatico])).toEqual([['montadora', 'Volkswagen', true], ['modelo', 'Gol', true]]);
      expect((await cascataAparelho({ ...POR_CLIENTE, busca: 'ecosport' }, true)).busca).toEqual([]);
      expect(((await cascataAparelho({ busca: 'ecosport' })).busca as unknown[]).length).toBeGreaterThan(0);
    });

    it('RN-CAT-22: cliente sem produto vendável com veículo = disponivel falso, igual no aparelho e na API', async () => {
      const so = { produto_ids: [LINHAS[15]!.id] };
      expect(sem(await cascataAparelho(so, true))).toEqual(sem(await cascataApi(so)));
      expect((await cascataAparelho(so, true)).disponivel).toBe(false);
    });

    it('RN-CAT-22: os Recentes não são filtrados pelo escopo', async () => {
      await buscaAparelho({ q: '', veiculo: { montadora: 'Ford', modelo: 'EcoSport', ano: 2014, motor: '1.6', versao: null }, limite: 10 });
      const r = await cascataAparelho(POR_CLIENTE, true);
      expect(r.recentes.map((x) => x.rotulos.curto)).toEqual(['EcoSport 2014 1.6']);
    });

    it('RN-CAT-22: produto_ids vale mais que cliente_id (a mesma regra de catalogo.busca_produtos@1)', async () => {
      const a = sem(await cascataAparelho({ ...POR_IDS, ...POR_CLIENTE }, true));
      expect(a).toEqual(sem(await cascataAparelho(POR_IDS, true)));
    });
  });
});
