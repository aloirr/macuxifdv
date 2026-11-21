/**
 * RN-CAT-09 e RN-CAT-18: `catalogo.busca_produtos@1` na API acha pelo código do concorrente (lê `produto_referencia`), como o aparelho e a vitrine.
 * Banco falso por SQL; o ponta a ponta com Postgres é do agente testes.
 */
import { describe, expect, it } from 'vitest';
import { consultaBuscaProdutos } from './consultas-texto';
import { fonteDoProduto, nomesDeVeiculo } from '../domain/veiculos';

const PROD = '00000000-0000-4000-8000-000000000001';
const MARCA = '00000000-0000-4000-8000-000000000002';
const ALVO = { produto_id: '00000000-0000-4000-8000-000000000199', sku: 'B1', ean: null, nome: 'Correia', marca: null, categoria: null, atributos: null, aplicacao: 'Palios 1.0', ativo: true };
const linha = { produto_id: PROD, sku: 'FO-100', ean: null, nome: 'Filtro de óleo', marca: 'Tecfil', categoria: 'Filtros', atributos: null, aplicacao: 'Gol 1.0', ativo: true };

function contexto(o: { referencias?: unknown[]; marcas?: unknown[] } = {}) {
  const consultas: string[] = [];
  const db = {
    query: async (sql: string) => {
      consultas.push(sql);
      if (/produto_busca/.test(sql)) return { rows: [linha] };
      if (/produto_referencia/.test(sql)) return { rows: o.referencias ?? [{ produto_id: PROD, marca_id: MARCA, marca_nome: 'Mann', codigo: 'W 712/75' }] };
      if (/marca_concorrente/.test(sql)) return { rows: o.marcas ?? [] };
      return { rows: [] };
    },
  };
  return { consultas, ctx: { db, parametros: () => ({}), agora: () => new Date('2026-11-10T13:00:00Z'), fuso: () => 'America/Manaus' } };
}
const impl = consultaBuscaProdutos as unknown as { executar: (e: unknown, c: unknown) => Promise<{ itens: Array<{ produto_id: string; equivale_a: { marca_nome: string; codigo: string } | null }> }> };

describe('RN-CAT-09 e RN-CAT-18: busca_produtos na API (código do concorrente e base de veículos)', () => {
  it('RN-CAT-09: "w71275" acha o produto pela referência "Mann W 712/75" e devolve o Equivale a', async () => {
    const r = await impl.executar({ q: 'w71275', limite: 100 }, contexto().ctx);
    expect(r.itens.map((i) => i.produto_id)).toEqual([PROD]);
    expect(r.itens[0]!.equivale_a).toMatchObject({ marca_nome: 'Mann', codigo: 'W 712/75' });
  });

  it('RN-CAT-09: o nome vem do cadastro de marcas concorrentes quando a marca existe; marca inativa esconde a referência', async () => {
    const ativa = await impl.executar({ q: 'w71275', limite: 100 }, contexto({ marcas: [{ id: MARCA, nome: 'Mann-Filter', ativo: true }] }).ctx);
    expect(ativa.itens[0]!.equivale_a).toMatchObject({ marca_nome: 'Mann-Filter' });
    const inativa = await impl.executar({ q: 'w71275', limite: 100 }, contexto({ marcas: [{ id: MARCA, nome: 'Mann-Filter', ativo: false }] }).ctx);
    expect(inativa.itens).toEqual([]);
  });

  it('RN-CAT-09: com produto_ids a leitura das referências é restrita a eles (não varre o cadastro todo)', async () => {
    const { ctx, consultas } = contexto();
    await impl.executar({ q: 'filtro', limite: 10, produto_ids: [PROD] }, ctx);
    expect(consultas.filter((s) => /produto_referencia/.test(s)).every((s) => /any\(\$1::uuid\[\]\)/.test(s))).toBe(true);
  });

  it('RN-CAT-18: com produto_ids o nome de veículo vem da base ativa inteira ("palio" não traz "Palios"), com memória por tenant e versão', async () => {
    const base = ['1', '2', '3'].map((n) => ({ produto_id: `00000000-0000-4000-8000-00000000010${n}`, sku: `A${n}`, ean: null, nome: `Filtro ${n}`, marca: null, categoria: null, atributos: null, aplicacao: 'Palio 1.0', ativo: true }));
    const consultas: string[] = [];
    const db = {
      query: async (sql: string) => {
        consultas.push(sql);
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: '4', ate: '2026-11-01' }] };
        if (/select b\.nome, b\.aplicacao/.test(sql)) return { rows: [...base, ALVO] };
        if (/produto_busca/.test(sql)) return { rows: [ALVO] };
        return { rows: [] };
      },
    };
    const ctx = { db, usuario: { tenant_id: 'tenant-cat-18' }, parametros: () => ({}), agora: () => new Date('2026-11-10T13:00:00Z'), fuso: () => 'America/Manaus' };
    const r = await impl.executar({ q: 'palio', limite: 10, produto_ids: [ALVO.produto_id] }, ctx);
    expect(r.itens).toEqual([]);
    await impl.executar({ q: 'palio', limite: 10, produto_ids: [ALVO.produto_id] }, ctx);
    expect(consultas.filter((s) => /select b\.nome, b\.aplicacao/.test(s))).toHaveLength(1);
  });

  it.each([
    { caso: 'com produto_ids', produto_ids: [ALVO.produto_id] },
    { caso: 'sem produto_ids', produto_ids: undefined },
  ])('RN-CAT-18: $caso a API conta nome + descrição + aplicação na base de veículos, no mesmo conjunto do domínio', async ({ caso, produto_ids }) => {
    const linhas = ['1', '2', '3'].map((n) => ({ nome: `Filtro ${n}`, aplicacao: 'Palio 1.0', descricao: n === '1' ? 'Serve no Palio' : null }));
    const consultas: string[] = [];
    const db = {
      query: async (sql: string) => {
        consultas.push(sql);
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: '4', ate: `2026-11-02-${caso}` }] };
        if (/select b\.nome, b\.aplicacao, c\.descricao/.test(sql)) return { rows: linhas };
        if (/produto_busca/.test(sql)) return { rows: [ALVO] };
        return { rows: [] };
      },
    };
    const ctx = { db, usuario: { tenant_id: `tenant-cat-18-${caso}` }, parametros: () => ({}), agora: () => new Date('2026-11-10T13:00:00Z'), fuso: () => 'America/Manaus' };
    const r = await impl.executar({ q: 'palio', limite: 10, produto_ids }, ctx);
    const semDescricao = nomesDeVeiculo(linhas.map((l) => fonteDoProduto({ ...l, descricao: null })));
    expect([...nomesDeVeiculo(linhas.map(fonteDoProduto))]).toEqual([]);
    expect(semDescricao.has('palio')).toBe(true);
    expect(consultas.some((q) => /c\.descricao/.test(q))).toBe(true);
    expect(r.itens.map((i) => i.produto_id)).toEqual([ALVO.produto_id]);
  });
});
