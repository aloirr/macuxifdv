/**
 * Base demo do Catálogo para testes de relevância e para a API em memória (T-0052).
 *
 * Produtos = os 24 de `db/seeds/demo/demo.ts` (`PRODUTOS`: sku, nome, marca, categoria, unidade e preço da tabela
 * Varejo; Atacado ≈ 7% menor e SEM `ACA-1K`, `SUC-1L`, `CRD-90`, RN-CAT-06). O módulo não importa o seed (fronteira):
 * se o seed mudar, atualize aqui — o teste `relevancia-demo.test.ts` mostra o que mudou.
 * Atributos, sinônimos, estoque e destaques são a PROPOSTA de conteúdo da demo pedida ao banco-dados para a migração
 * 0013 (recado da T-0052); até lá só existem aqui.
 */
import type { AtributoProduto, ItemTabelaPreco, Sinonimo, StockByBranch } from '../contracts';
import type { ProdutoCatalogo } from '../domain/vitrine';

/** UUID estável e legível por SKU (só para testes; o seed usa `idDeterministico('demo:produto:<sku>')`). */
export function idDemo(chave: string): string {
  let h = 0;
  for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  const tam = chave.length.toString(16).padStart(4, '0');
  return `${hex}-${tam}-4000-8000-${hex}${tam}`;
}

/** [sku, nome, marca, categoria, unidade, preço Varejo em centavos] — cópia de `PRODUTOS` do seed da demo. */
export const PRODUTOS_SEED_DEMO: ReadonlyArray<readonly [string, string, string, string, string, number]> = [
  ['CAF-500', 'Café torrado e moído 500 g', 'Aroma da Serra', 'Mercearia', 'UN', 1_890],
  ['ARR-5K', 'Arroz tipo 1 5 kg', 'Grão Nobre', 'Mercearia', 'UN', 2_690],
  ['FEI-1K', 'Feijão carioca 1 kg', 'Grão Nobre', 'Mercearia', 'UN', 899],
  ['ACU-1K', 'Açúcar cristal 1 kg', 'Doce Vale', 'Mercearia', 'UN', 479],
  ['OLE-900', 'Óleo de soja 900 ml', 'Campo Verde', 'Mercearia', 'UN', 749],
  ['FAR-1K', 'Farinha de mandioca 1 kg', 'Sabor do Norte', 'Mercearia', 'UN', 690],
  ['MAC-500', 'Macarrão espaguete 500 g', 'Bella Massa', 'Mercearia', 'UN', 459],
  ['MOL-340', 'Molho de tomate 340 g', 'Bella Massa', 'Mercearia', 'UN', 329],
  ['SAR-125', 'Sardinha em óleo 125 g', 'Rio Mar', 'Mercearia', 'UN', 699],
  ['LEI-1L', 'Leite UHT integral 1 L', 'Leite Bom', 'Laticínios', 'UN', 549],
  ['MAR-500', 'Margarina com sal 500 g', 'Leite Bom', 'Laticínios', 'UN', 899],
  ['BIS-400', 'Biscoito cream cracker 400 g', 'Crocante', 'Biscoitos', 'UN', 589],
  ['BIS-140', 'Biscoito recheado chocolate 140 g', 'Crocante', 'Biscoitos', 'UN', 289],
  ['REF-2L', 'Refrigerante de guaraná 2 L', 'Guaraná da Floresta', 'Bebidas', 'UN', 799],
  ['REF-350', 'Refrigerante de guaraná lata 350 ml (fardo 12)', 'Guaraná da Floresta', 'Bebidas', 'FD', 3_990],
  ['AGU-500', 'Água mineral 500 ml (fardo 12)', 'Fonte Clara', 'Bebidas', 'FD', 1_790],
  ['SUC-1L', 'Suco de cupuaçu 1 L', 'Sabor do Norte', 'Bebidas', 'UN', 899],
  ['ACA-1K', 'Polpa de açaí 1 kg', 'Sabor do Norte', 'Congelados', 'UN', 2_290],
  ['DET-500', 'Detergente líquido 500 ml', 'Brilho', 'Limpeza', 'UN', 239],
  ['SAB-1K', 'Sabão em pó 1 kg', 'Brilho', 'Limpeza', 'UN', 1_290],
  ['DES-2L', 'Desinfetante 2 L', 'Brilho', 'Limpeza', 'UN', 990],
  ['PAP-4', 'Papel higiênico folha dupla 4 rolos', 'Macio', 'Higiene', 'PC', 849],
  ['SBN-90', 'Sabonete 90 g', 'Flor da Mata', 'Higiene', 'UN', 249],
  ['CRD-90', 'Creme dental 90 g', 'Sorriso', 'Higiene', 'UN', 459],
];

/** Fora da tabela Atacado (RN-CAT-06): no cliente de atacado aparecem "Sem preço para este cliente". */
export const SEM_PRECO_NO_ATACADO_DEMO = ['ACA-1K', 'SUC-1L', 'CRD-90'] as const;

/** Proposta de atributos da demo (0013, `catalogo.produto_atributo`). */
export const ATRIBUTOS_DEMO: Readonly<Record<string, readonly AtributoProduto[]>> = {
  'CAF-500': [{ name: 'Torra', value: 'Média' }, { name: 'Moagem', value: 'Fina' }],
  'ARR-5K': [{ name: 'Grão', value: 'Longo fino' }],
  'FEI-1K': [{ name: 'Tipo', value: '1' }],
  'LEI-1L': [{ name: 'Tipo', value: 'Integral' }, { name: 'Validade', value: '120 dias' }],
  'BIS-140': [{ name: 'Sabor', value: 'Chocolate' }],
  'REF-350': [{ name: 'Embalagem', value: 'Fardo com 12 latas' }],
  'AGU-500': [{ name: 'Tipo', value: 'Sem gás' }, { name: 'Embalagem', value: 'Fardo com 12 garrafas' }],
  'SUC-1L': [{ name: 'Tipo', value: 'Néctar' }],
  'ACA-1K': [{ name: 'Conservação', value: 'Congelado a −18 °C' }, { name: 'Sabor', value: 'Tradicional sem açúcar' }],
  'DET-500': [{ name: 'Fragrância', value: 'Neutro' }],
  'DES-2L': [{ name: 'Fragrância', value: 'Lavanda' }],
  'PAP-4': [{ name: 'Metragem', value: '30 m por rolo' }],
  'SBN-90': [{ name: 'Fragrância', value: 'Erva-doce' }],
  'CRD-90': [{ name: 'Proteção', value: 'Flúor e anticáries' }],
};

/** Proposta de sinônimos do tenant demo (0013, `catalogo.sinonimo`). */
export const SINONIMOS_DEMO: readonly Sinonimo[] = [
  { id: idDemo('sinonimo:refrigerante'), term: 'refrigerante', synonyms: ['refri'], active: true },
  { id: idDemo('sinonimo:biscoito'), term: 'biscoito', synonyms: ['bolacha'], active: true },
  { id: idDemo('sinonimo:creme dental'), term: 'creme dental', synonyms: ['pasta de dente'], active: true },
  { id: idDemo('sinonimo:macarrao'), term: 'macarrão', synonyms: ['massa'], active: true },
  { id: idDemo('sinonimo:sabao em po'), term: 'sabão em pó', synonyms: ['lava-roupas'], active: true },
  { id: idDemo('sinonimo:detergente'), term: 'detergente', synonyms: ['lava-louças'], active: true },
  { id: idDemo('sinonimo:papel higienico'), term: 'papel higiênico', synonyms: ['papel de banho'], active: true },
];

/** Proposta de destaques/campanha e vendas recentes da demo (boosts do ranking, RN-CAT-08). */
export const CAMPANHA_DEMO = ['CAF-500', 'ACA-1K'] as const;
export const VENDAS_DEMO: Readonly<Record<string, number>> = { 'ARR-5K': 120, 'FEI-1K': 90, 'CAF-500': 80, 'REF-2L': 70, 'DET-500': 60, 'OLE-900': 50, 'BIS-400': 40 };

export const TABELA_VAREJO_DEMO = idDemo('tabela:VAREJO');
export const TABELA_ATACADO_DEMO = idDemo('tabela:ATACADO');
export const FILIAL_DEMO = idDemo('deposito:CD-MAO');

export const PRODUTOS_DEMO: readonly ProdutoCatalogo[] = PRODUTOS_SEED_DEMO.map(([sku, nome, marca, categoria, unidade]) => ({
  id: idDemo(`produto:${sku}`),
  sku,
  ean: null,
  nome,
  marca,
  categoria,
  unidade,
  ativo: true,
  atributos: ATRIBUTOS_DEMO[sku] ?? [],
  thumbnail_url: null,
  campanha: (CAMPANHA_DEMO as readonly string[]).includes(sku),
  vendas: VENDAS_DEMO[sku] ?? 0,
}));

/** Itens das tabelas Varejo e Atacado (vigência sem início: vale desde sempre). */
export const ITENS_PRECO_DEMO: readonly ItemTabelaPreco[] = PRODUTOS_SEED_DEMO.flatMap(([sku, , , , , preco]) => {
  const product_id = idDemo(`produto:${sku}`);
  const varejo: ItemTabelaPreco = { price_table_id: TABELA_VAREJO_DEMO, product_id, price_cents: preco, valid_from: null, valid_to: null };
  if ((SEM_PRECO_NO_ATACADO_DEMO as readonly string[]).includes(sku)) return [varejo];
  return [varejo, { price_table_id: TABELA_ATACADO_DEMO, product_id, price_cents: Math.round(preco * 0.93), valid_from: null, valid_to: null }];
});

/** Saldo por produto no CD (proposta): tudo com estoque, menos o açaí (zerado) e o biscoito recheado (baixo). */
export function saldosDemo(atualizadoEm: string): Map<string, StockByBranch[]> {
  const qtd = (sku: string) => (sku === 'ACA-1K' ? 0 : sku === 'BIS-140' ? 6 : 80);
  return new Map(PRODUTOS_SEED_DEMO.map(([sku]) => [idDemo(`produto:${sku}`), [{ branch_id: FILIAL_DEMO, branch_name: 'CD Manaus', quantity: qtd(sku), updated_at: atualizadoEm }]]));
}

export const idProdutoDemo = (sku: string) => idDemo(`produto:${sku}`);
