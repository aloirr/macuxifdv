/**
 * RN-CAT-21 (T-0192): vitrine sem texto, só a página que aparece. O ranking sem texto depende do estoque (maior que zero), das vendas e da
 * campanha, nunca do preço; por isso ordena documentos leves (sem montar o cartão, sem ler preço) e o cartão completo (preço da tabela
 * certa, RN-VEN-01, e estoque) é montado depois só para os ids da página. A ordem é a de `listarVitrine` (mesmo `rankear`).
 * Dentro do pedido (`only_sellable`) o preço decide quem entra: aí vale `listarVitrine`.
 */
import { anoCivilNoFuso } from './ano-civil';
import { rankear, type DocBusca } from './ranking';
import { aplicarChips, docBase, entraNaVitrine, LIMITE_RESULTADOS_BUSCA, SEM_FILTRO, temEstoqueParaBusca, type ChipsVitrine, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';
import { filtrosParaPerfil } from './visibilidade';

export interface EntradaPaginaVitrine {
  produtos: readonly ProdutoCatalogo[];
  /** Só estoque (saldos e filiais) é lido; preço e promoções podem vir vazios. */
  contexto: ContextoVitrine;
  /** Sem `only_sellable` (que depende do preço). */
  chips?: ChipsVitrine;
  fuso?: string;
}

/** Documento do ranking só com o que a vitrine sem texto usa; o estoque é o mesmo de `docDeBusca` (prova em `temEstoqueParaBusca`). */
function docLeve(p: ProdutoCatalogo, ctx: ContextoVitrine): DocBusca {
  return { ...docBase(p), estoque: temEstoqueParaBusca(p, ctx) ? 1 : 0 };
}

/** Ordem completa da vitrine (ids), sem montar cartão; guardável pela quem chama enquanto estoque e filtros não mudam. */
export function ordemDaVitrine(e: EntradaPaginaVitrine): string[] {
  const ctx = e.contexto;
  const docs = e.produtos.filter((p) => entraNaVitrine(p, e.chips)).map((p) => docLeve(p, ctx));
  const filtros = filtrosParaPerfil(aplicarChips(SEM_FILTRO, e.chips ?? {}), ctx.perfil, ctx.parametros);
  const anoAtual = anoCivilNoFuso(ctx.agora, e.fuso);
  return rankear(docs, { filtros, sinonimos: [], parametros: ctx.parametros, anoAtual }).slice(0, LIMITE_RESULTADOS_BUSCA).map((r) => r.doc.id);
}
