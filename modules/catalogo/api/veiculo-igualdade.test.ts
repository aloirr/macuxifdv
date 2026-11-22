/**
 * RN-CAT-22 / P4 (desenho `docs/desenho/filtro-veiculo.md` §4.2): a consulta do aparelho e a da API dão o MESMO resultado com veículo:
 * os itens, a ordem, a compatibilidade e o "Serve em" de `catalogo.busca_produtos@1`, e a cascata de `catalogo.veiculos@1`.
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

function aparelho() {
  const tabelas: Record<string, unknown[]> = {
    produto: LINHAS.map((l, i) => ({ id: l.id, ...base, sku: `SK-${i + 1}`, ean: null, nome: l.nome, marca: 'BAP', categoria: 'Linha', unidade: 'UN', ativo: true })),
    produto_atributo: [],
    produto_conteudo: LINHAS.map((l, i) => ({ id: uuid(1000 + i), ...base, produto_id: l.id, aplicacao: l.aplicacao || null, campanha: false })),
    produto_referencia: [],
    sinonimo: [],
  };
  return { linhas: async (e: string) => tabelas[e] ?? [], versaoLinhas: () => 1, agora: () => new Date('2026-11-06T12:00:00Z'), usuario: () => null, parametros: () => ({}) } as unknown as ContextoConsultaAparelho;
}

function api() {
  const db = {
    query: async (sql: string) => {
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: String(LINHAS.length), ate: '2026-10-01' }] };
      if (/select b\.nome/.test(sql)) return { rows: LINHAS.map((l) => ({ nome: l.nome, aplicacao: l.aplicacao || null, descricao: null })) };
      if (/select produto_id, aplicacao from/.test(sql)) return { rows: LINHAS.map((l) => ({ produto_id: l.id, aplicacao: l.aplicacao || null })) };
      if (/produto_busca/.test(sql)) return { rows: LINHAS.map((l, i) => ({ produto_id: l.id, sku: `SK-${i + 1}`, ean: null, nome: l.nome, marca: 'BAP', categoria: 'Linha', atributos: null, aplicacao: l.aplicacao || null, ativo: true })) };
      return { rows: [] };
    },
  };
  return { db, parametros: () => ({}), agora: () => new Date('2026-11-06T12:00:00Z'), fuso: () => 'America/Manaus' };
}

type Item = { veiculo: { compatibilidade: string }; aplicacao?: unknown } & Record<string, unknown>;
type Saida = { itens: Item[]; total: number; disponivel: boolean; recentes: { veiculo: unknown; rotulos: { curto: string } }[] } & Record<string, unknown>;
type Exec = { executar(e: unknown, c: unknown): Promise<Saida> };
const buscaAparelho = (e: unknown) => (consultaBuscaProdutosAparelho as unknown as Exec).executar(e, aparelho());
const buscaApi = (e: unknown) => (consultaBuscaProdutos as unknown as Exec).executar(e, api());
const cascataAparelho = (e: unknown) => (consultaVeiculosAparelho as unknown as Exec).executar(e, aparelho());
const cascataApi = (e: unknown) => (consultaVeiculos as unknown as Exec).executar(e, api());
const itens = (r: Saida) => r.itens.map(({ aplicacao: _a, ...x }) => x);

describe('RN-CAT-22 / P4: aparelho e API dão o mesmo resultado com veículo', () => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
    esquecerVeiculosRecentes();
  });

  it.each(ESCOLHAS.map((v, i) => [i, v] as const))('busca_produtos sem texto, veículo #%i: mesmos itens, ordem, compatibilidade e "Serve em"', async (_i, veiculo) => {
    const entrada = { q: '', veiculo, limite: 100 };
    const a = itens(await buscaAparelho(entrada));
    const b = itens(await buscaApi(entrada));
    expect(a).toEqual(b);
  });

  it.each(['amortecedor', 'freio', 'gol'])('busca_produtos com texto "%s" e veículo: mesmos itens', async (q) => {
    const entrada = { q, veiculo: GOL_2018, limite: 100 };
    expect(itens(await buscaAparelho(entrada))).toEqual(itens(await buscaApi(entrada)));
  });

  it('RN-CAT-22: o Gol 2018 traz os compatíveis antes dos de conferir, e o de conferir leva o trecho sem a montadora', async () => {
    const r = await buscaAparelho({ q: '', veiculo: { ...GOL_2018, motor: '1.0', versao: 'Highline' }, limite: 100 });
    const ordem = r.itens.map((i: { veiculo: { compatibilidade: string } }) => i.veiculo.compatibilidade);
    expect(ordem.indexOf('conferir')).toBeGreaterThan(ordem.lastIndexOf('compativel'));
    expect(ordem.filter((x: string) => x === 'compativel').length).toBeGreaterThan(0);
    expect(r.total).toBe(r.itens.length);
    const semAno = await buscaAparelho({ q: '', veiculo: { ...GOL_2018, ano: null }, limite: 100 });
    expect(semAno.itens.every((i: { veiculo: { compatibilidade: string } }) => i.veiculo.compatibilidade === 'conferir')).toBe(true);
  });

  it('RN-CAT-22: sem veículo a busca não traz o campo veiculo (nada muda)', async () => {
    const r = await buscaAparelho({ q: 'amortecedor', limite: 10 });
    expect(r.itens.every((i: Record<string, unknown>) => !('veiculo' in i))).toBe(true);
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
});
