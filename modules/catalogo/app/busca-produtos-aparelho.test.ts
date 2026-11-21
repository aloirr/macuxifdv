/** T-0084 C9 no aparelho: lê o produto do Core pelo contexto da consulta, sem ler o Promotor (RN-CAT-09, RN-CAT-11, RN-CAT-12). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { esquecerMemoriaLocal } from './lib/local';
import { consultaBuscaProdutosAparelho, esquecerMemoriaTextos } from './texto-consultas';

const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const P1 = '0ca00000-0000-4000-8000-000000000001';
const P2 = '0ca00000-0000-4000-8000-000000000002';
const MARCA = '0ca00000-0000-4000-8000-0000000000a1';
const produto = (id: string, nome: string, sku: string) => ({ id, ...base, sku, ean: null, nome, marca: 'Fremax', categoria: 'Freios', unidade: 'UN', ativo: true });
const TABELAS: Record<string, unknown[]> = {
  produto: [produto(P1, 'Pastilha de freio dianteira', 'PF-001'), produto(P2, 'Pastilha de freio traseira', 'PF-002')],
  produto_atributo: [],
  produto_conteudo: [
    { id: 'c1', ...base, produto_id: P1, aplicacao: 'Uno 2010 a 2013, Palio 2012', campanha: false },
    { id: 'c2', ...base, produto_id: P2, aplicacao: 'Gol 2015 a 2018', campanha: false },
  ],
  produto_referencia: [{ id: 'r1', ...base, produto_id: P1, marca_id: MARCA, marca_nome: 'Cobreq', codigo: 'N-123', ordem: 1 }],
  sinonimo: [],
};

function ctx() {
  const lidas: string[] = [];
  const linhas = vi.fn(async (entidade: string) => {
    lidas.push(entidade);
    if (entidade === 'concorrente' || entidade === 'marca_concorrente') throw new Error('a consulta não lê marcas: usa o retrato marca_nome');
    return TABELAS[entidade] ?? [];
  });
  const versaoLinhas = vi.fn(() => 1);
  return { lidas, c: { linhas, versaoLinhas, linhasPorIds: vi.fn(), linhasPorCampo: vi.fn(), agora: () => new Date('2026-11-06T12:00:00Z'), usuario: () => null, parametros: () => ({}) } as unknown as ContextoConsultaAparelho };
}
const buscar = (c: ContextoConsultaAparelho, q: string) =>
  (consultaBuscaProdutosAparelho as unknown as { executar(e: unknown, c: ContextoConsultaAparelho): Promise<{ itens: { produto_id: string; serve_em: unknown; equivale_a: unknown }[] }> }).executar({ q, limite: 20 }, c);

describe('catalogo.busca_produtos@1 no aparelho', () => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
  });

  it('RN-CAT-11: "pastilha uno 2012" acha a pastilha do Uno com "Serve em", lendo o produto do Core e sem ler o Promotor', async () => {
    const { c, lidas } = ctx();
    const { itens } = await buscar(c, 'pastilha uno 2012');
    expect(itens.map((i) => i.produto_id)).toContain(P1);
    expect(JSON.stringify(itens.find((i) => i.produto_id === P1)?.serve_em)).toMatch(/Uno/i);
    expect(lidas).toContain('produto');
    expect(lidas).not.toContain('concorrente');
    expect(lidas).not.toContain('marca_concorrente');
  });

  it('RN-CAT-11 + R-20261120-194335: "pastilha uno 2015" (aplicação só até 2013): ninguém casa tudo, lista vazia', async () => {
    const { c } = ctx();
    const { itens } = await buscar(c, 'pastilha uno 2015');
    expect(itens).toEqual([]);
  });

  it('RN-CAT-09: o "Equivale a" usa a marca do retrato da referência, sem o cadastro de marcas', async () => {
    const { c } = ctx();
    const { itens } = await buscar(c, 'N-123');
    expect(JSON.stringify(itens.find((i) => i.produto_id === P1)?.equivale_a)).toMatch(/Cobreq/);
  });

  it('RN-CAT-11: a montagem dos produtos é memorizada pela versão das linhas', async () => {
    const { c } = ctx();
    await buscar(c, 'pastilha uno');
    await buscar(c, 'pastilha gol');
    expect((c.linhas as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([e]) => e === 'produto')).toHaveLength(1);
  });
});
