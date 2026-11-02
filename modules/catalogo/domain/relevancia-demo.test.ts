/**
 * Critério da Sprint 3 (docs/produto/05-roadmap.md): relevância aprovada em 20 consultas de teste sobre a BASE DEMO.
 * Caminho completo SEM LLM, igual ao offline do app e à contingência da API: interpretar (regras) → sinônimos do tenant →
 * preço da tabela do cliente e estoque → ranking → página. Base e conteúdo proposto: `fixtures/base-demo.ts`.
 * Mudou normalização, interpretação, ranking ou a base e uma consulta mudou de resultado? Este teste mostra qual.
 * Ao descobrir um caso ruim no ensaio (termo sem resultado no BKO, RF-CAT-07), acrescente aqui.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import { idProdutoDemo, ITENS_PRECO_DEMO, PRODUTOS_DEMO, saldosDemo, SINONIMOS_DEMO, TABELA_ATACADO_DEMO, TABELA_VAREJO_DEMO } from '../fixtures/base-demo';
import { interpretarConsulta } from './consulta';
import { PARAMETROS_PADRAO } from './parametros';
import { MENSAGEM_SEM_PRECO_CLIENTE } from './preco';
import { buscarProdutos, vocabularioDe, type ContextoVitrine } from './vitrine';

const relogio = criarRelogio();
const VOCAB = vocabularioDe(PRODUTOS_DEMO);
const CLIENTE = '0000aaaa-0000-4000-8000-000000000001';

function contexto(o: Partial<ContextoVitrine> = {}): ContextoVitrine {
  const tabela = o.tabelaClienteId === undefined ? TABELA_VAREJO_DEMO : o.tabelaClienteId;
  return {
    perfil: 'vendedor',
    parametros: PARAMETROS_PADRAO,
    agora: relogio.iso(),
    clienteId: CLIENTE,
    tabelaClienteId: tabela,
    itensPreco: ITENS_PRECO_DEMO.filter((i) => i.price_table_id === tabela),
    promocoes: [],
    saldos: saldosDemo(relogio.relativo({ horas: -2 }).toISOString()),
    filiais: null,
    ...o,
  };
}

const skuDe = new Map(PRODUTOS_DEMO.map((p) => [p.id, p.sku]));
function buscar(q: string, ctx: ContextoVitrine = contexto()) {
  const r = buscarProdutos({ produtos: PRODUTOS_DEMO, contexto: ctx, filtros: interpretarConsulta(q, VOCAB), sinonimos: SINONIMOS_DEMO, limit: 20, offset: 0 });
  return { ...r, skus: r.items.map((i) => skuDe.get(i.id)!) };
}

/** [consulta, o que se espera, conferência]. `primeiro`: o 1º resultado; `topo`: os N primeiros (qualquer ordem); `exatos`: a lista toda, em ordem. */
type Esperado = { primeiro: string } | { topo: string[] } | { exatos: string[] };
const CONSULTAS: Array<[string, Esperado]> = [
  // nome, com e sem acento, singular/plural, medidas
  ['café', { primeiro: 'CAF-500' }],
  ['cafe 500g', { primeiro: 'CAF-500' }],
  ['arroz 5 kg', { primeiro: 'ARR-5K' }],
  ['feijao carioca', { primeiro: 'FEI-1K' }],
  ['açucar', { primeiro: 'ACU-1K' }],
  ['oleo de soja', { primeiro: 'OLE-900' }],
  ['farinha de mandioca', { primeiro: 'FAR-1K' }],
  ['molho de tomate', { primeiro: 'MOL-340' }],
  ['sardinha em óleo', { primeiro: 'SAR-125' }],
  ['leite integral', { primeiro: 'LEI-1L' }],
  ['biscoito recheado de chocolate', { primeiro: 'BIS-140' }],
  ['guarana lata', { primeiro: 'REF-350' }],
  ['agua mineral', { primeiro: 'AGU-500' }],
  ['suco de cupuaçu', { primeiro: 'SUC-1L' }],
  ['açaí', { primeiro: 'ACA-1K' }],
  ['desinfetante 2 litros', { primeiro: 'DES-2L' }],
  ['papel higienico', { primeiro: 'PAP-4' }],
  ['sabonete', { primeiro: 'SBN-90' }],
  ['sabão em pó', { primeiro: 'SAB-1K' }],
  // sinônimos do tenant (RF-CAT-02)
  ['refri', { topo: ['REF-2L', 'REF-350'] }],
  ['bolacha', { topo: ['BIS-400', 'BIS-140'] }],
  ['pasta de dente', { primeiro: 'CRD-90' }],
  ['massa', { primeiro: 'MAC-500' }],
  ['lava-louças', { primeiro: 'DET-500' }],
  // erro de digitação, código e atributo
  ['cafe torado', { primeiro: 'CAF-500' }],
  ['desinfetamte', { primeiro: 'DES-2L' }],
  ['CAF-500', { exatos: ['CAF-500'] }],
  ['agua sem gas', { primeiro: 'AGU-500' }],
  // filtros da frase: marca, categoria, preço, ordenação (RN-CAT-01)
  ['marca Brilho', { topo: ['DET-500', 'SAB-1K', 'DES-2L'] }],
  ['linha congelados', { exatos: ['ACA-1K'] }],
  ['bebidas até R$ 10', { topo: ['REF-2L', 'SUC-1L'] }],
  ['limpeza mais barato', { exatos: ['DET-500', 'DES-2L', 'SAB-1K'] }],
];

describe('Relevância na base demo — 20+ consultas de referência (critério da Sprint 3; RF-CAT-01, RF-CAT-02, RN-CAT-08)', () => {
  it('o conjunto tem pelo menos 20 consultas', () => {
    expect(CONSULTAS.length).toBeGreaterThanOrEqual(20);
  });

  for (const [q, esperado] of CONSULTAS) {
    it(`"${q}" → ${JSON.stringify(esperado)}`, () => {
      const { skus } = buscar(q);
      if ('primeiro' in esperado) expect(skus[0], skus.join(', ')).toBe(esperado.primeiro);
      else if ('topo' in esperado) expect(skus.slice(0, esperado.topo.length).sort(), skus.join(', ')).toEqual([...esperado.topo].sort());
      else expect(skus).toEqual(esperado.exatos);
    });
  }

  it('"bebidas até R$ 10" não traz nada acima de R$ 10 na tabela do cliente', () => {
    const r = buscar('bebidas até R$ 10');
    expect(r.items.every((i) => (i.price?.price_cents ?? Infinity) <= 1000)).toBe(true);
  });

  it('termo que não existe na base não inventa resultado ("cuscuz" vai para os termos sem resultado do BKO)', () => {
    expect(buscar('cuscuz').items).toEqual([]);
    expect(buscar('televisão 50 polegadas').items).toEqual([]);
  });

  it('RN-CAT-06: cliente do Atacado acha o suco de cupuaçu, mas "Sem preço para este cliente." e não vendável', () => {
    const atacado = contexto({ tabelaClienteId: TABELA_ATACADO_DEMO });
    const r = buscar('suco de cupuaçu', atacado);
    expect(r.skus[0]).toBe('SUC-1L');
    expect(r.items[0]!.price).toMatchObject({ sellable: false, price_cents: null, notice: MENSAGEM_SEM_PRECO_CLIENTE });
    const cafe = buscar('café', atacado).items[0]!;
    expect(cafe.price?.price_cents).toBe(Math.round(1890 * 0.93));
  });

  it('RN-CAT-05: o promotor acha os mesmos produtos (sem preço e sem estoque) e "mais barato" não ordena por preço', () => {
    const promotor = contexto({ perfil: 'promotor' });
    expect(buscar('refri', promotor).skus.slice(0, 2).sort()).toEqual(['REF-2L', 'REF-350']);
    const r = buscar('limpeza mais barato', promotor);
    expect(r.items.every((i) => i.price === null && i.availability === null)).toBe(true);
    expect(r.skus.sort()).toEqual(['DES-2L', 'DET-500', 'SAB-1K']);
  });

  it('a base demo tem ids únicos (fixture sã)', () => {
    expect(new Set(PRODUTOS_DEMO.map((p) => p.id)).size).toBe(PRODUTOS_DEMO.length);
    expect(idProdutoDemo('CAF-500')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/);
  });
});
