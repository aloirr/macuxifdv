/** T-0167 no aparelho: busca por código, descrição 1, descrição 2 e marca; paginação sobre o ranking único; código exato; 3 letras; "Você quis dizer…"; vendável do cliente. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { esquecerMemoriaLocal } from './lib/local';
import { consultaBuscaProdutosAparelho, esquecerMemoriaTextos } from './texto-consultas';

const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const id = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MARCA = '0ca00000-0000-4000-8000-0000000000a1';
const CLIENTE = '0ca00000-0000-4000-8000-0000000000c1';
const TABELA = '0ca00000-0000-4000-8000-0000000000b1';
const produto = (n: number, nome: string, sku: string, marca = 'Fremax', ean: string | null = null) => ({ id: id(n), ...base, sku, ean, nome, marca, categoria: 'Freios', unidade: 'UN', ativo: true });

// 1 = código/descrição 1; 2 = descrição 2 (aplicação); 3 = marca; 4..53 = 50 filtros para a paginação; 60 = código alternativo
const PRODUTOS = [
  produto(1, 'Pastilha dianteira', 'PF-001'),
  produto(2, 'Disco ventilado', 'DV-002'),
  produto(3, 'Amortecedor traseiro', 'AM-003', 'Monroe'),
  ...Array.from({ length: 50 }, (_, k) => produto(4 + k, `Filtro de óleo ${k}`, `FO-${100 + k}`, 'Tecfil')),
  produto(60, 'Bomba d água', 'BA-060'),
];
function montar(extra: Record<string, unknown[]> = {}) {
  const tabelas: Record<string, unknown[]> = {
    produto: PRODUTOS,
    produto_atributo: [],
    produto_conteudo: [{ id: 'c2', ...base, produto_id: id(2), aplicacao: 'Fiat Strada 2015 a 2018', campanha: false }],
    produto_referencia: [{ id: 'r60', ...base, produto_id: id(60), marca_id: MARCA, marca_nome: 'Cobreq', codigo: 'ALT 9-77', ordem: 1 }],
    sinonimo: [],
    ...extra,
  };
  const linhas = vi.fn(async (e: string) => tabelas[e] ?? []);
  return { linhas, c: { linhas, versaoLinhas: () => 1, linhasPorIds: undefined, linhasPorCampo: undefined, agora: () => new Date('2026-11-12T12:00:00Z'), usuario: () => ({ perfil: 'vendedor' }), parametros: () => ({}) } as unknown as ContextoConsultaAparelho };
}
type Saida = { itens: { produto_id: string; aplicacao?: string | null }[]; total?: number; sugestao?: string | null };
const buscar = (c: ContextoConsultaAparelho, entrada: Record<string, unknown>) =>
  (consultaBuscaProdutosAparelho as unknown as { executar(e: unknown, c: ContextoConsultaAparelho): Promise<Saida> }).executar({ limite: 100, ...entrada }, c);

describe('RF-CAT-01 (T-0167): busca pelos 4 campos', () => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
  });
  it('RF-CAT-01: acha pelo código (SKU)', async () => {
    expect((await buscar(montar().c, { q: 'DV-002' })).itens[0]!.produto_id).toBe(id(2));
  });
  it('RF-CAT-01: acha pela descrição 1 (nome)', async () => {
    expect((await buscar(montar().c, { q: 'amortecedor' })).itens.map((i) => i.produto_id)).toContain(id(3));
  });
  it('RF-CAT-01: acha pela descrição 2 (aplicação) e a devolve na mesma consulta', async () => {
    const { itens } = await buscar(montar().c, { q: 'strada 2016' });
    expect(itens[0]!.produto_id).toBe(id(2));
    expect(itens[0]!.aplicacao).toBe('Fiat Strada 2015 a 2018');
  });
  it('RF-CAT-01: acha pela marca', async () => {
    expect((await buscar(montar().c, { q: 'monroe' })).itens.map((i) => i.produto_id)).toContain(id(3));
  });
});

describe('RF-CAT-01 (T-0167): paginação, código exato, 3 letras e sugestão', () => {
  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
  });
  it('RF-CAT-01: uma consulta com lista_completa traz os 50 ranqueados e o total; 20 por vez é fatia local', async () => {
    const r = await buscar(montar().c, { q: 'filtro', lista_completa: true });
    expect(r.total).toBe(50);
    expect(r.itens).toHaveLength(50);
    expect(new Set(r.itens.map((i) => i.produto_id)).size).toBe(50);
  });
  it('RF-CAT-01: o limite corta os itens mas o total continua o do ranking', async () => {
    const r = await buscar(montar().c, { q: 'filtro', limite: 20 });
    expect(r.itens).toHaveLength(20);
    expect(r.total).toBe(50);
  });
  it('RF-CAT-01: código alternativo idêntico ao texto vem em 1º', async () => {
    expect((await buscar(montar().c, { q: 'alt 9-77' })).itens[0]!.produto_id).toBe(id(60));
  });
  it('RF-CAT-01: EAN idêntico ao texto vem em 1º', async () => {
    const ean = '7891000100103';
    const { c } = montar({ produto: [...PRODUTOS.slice(0, 2), produto(2, 'Disco ventilado', 'DV-002', 'Fremax', ean), ...PRODUTOS.slice(3)].filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i || p.ean) });
    expect((await buscar(c, { q: ean })).itens[0]!.produto_id).toBe(id(2));
  });
  it('RF-CAT-01: abaixo de 3 caracteres a consulta não roda (nem lê o catálogo)', async () => {
    const { c, linhas } = montar();
    expect(await buscar(c, { q: 'fi' })).toEqual({ itens: [], total: 0, sugestao: null });
    expect(linhas).not.toHaveBeenCalled();
  });
  it('RF-CAT-01: sem resultado sugere o termo mais próximo do vocabulário; com resultado não sugere', async () => {
    const vazio = await buscar(montar().c, { q: 'pstlha' });
    expect(vazio.itens).toEqual([]);
    expect(vazio.sugestao).toBe('pastilha');
    expect((await buscar(montar().c, { q: 'pastilha' })).sugestao).toBeNull();
  });
  it('RN-CAT-06: com cliente_id só entram os produtos com preço vigente na tabela dele, sem produto_ids', async () => {
    const preco = (n: number) => ({ id: `i${n}`, ...base, tabela_preco_id: TABELA, produto_id: id(n), preco_cents: 1000, vigencia_inicio: '2026-01-01', vigencia_fim: null });
    const extra = {
      cliente_tabela_preco: [{ id: 'v1', ...base, cliente_id: CLIENTE, tabela_preco_id: TABELA }],
      tabela_preco: [{ id: TABELA, ...base, nome: 'Atacado', ativo: true }],
      tabela_preco_item: [preco(4), preco(5), preco(6)],
    };
    const r = await buscar(montar(extra).c, { q: 'filtro', lista_completa: true, cliente_id: CLIENTE });
    expect(r.itens.map((i) => i.produto_id).sort()).toEqual([id(4), id(5), id(6)]);
    expect(r.total).toBe(3);
  });
});
