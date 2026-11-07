/**
 * Núcleo puro das consultas `catalogo.busca_produtos@1` e `catalogo.textos_produto@1` (T-0084 C8/C9; RN-CAT-09, RN-CAT-12):
 * o mesmo código na API e no aparelho. A busca do seletor do Novo pedido usa o MESMO ranking da vitrine (sinônimos, faixa de
 * anos da aplicação, código do concorrente), mas sem preço: o preço segue em `precos_cliente@1`. Por isso os filtros de preço,
 * de estoque e de ordem por preço da frase são ignorados e o documento entra sem saldo (o boost de estoque não se aplica).
 */
import type { BuscaProdutosSaida, TextosProdutoSaida } from '../contracts';
import { interpretarConsulta } from './consulta';
import type { ParametrosCatalogo } from './parametros';
import { rankear } from './ranking';
import { trechoServeEm } from './serve-em';
import { expandirSinonimos, type SinonimoDoTenant } from './texto';
import { equivaleA, vocabularioDe, type ProdutoCatalogo } from './vitrine';

export interface EntradaBuscaConsulta {
  produtos: readonly ProdutoCatalogo[];
  q: string;
  /** Restringe aos produtos do seletor; ausente = todos. */
  produtoIds?: readonly string[] | undefined;
  limite: number;
  sinonimos: readonly SinonimoDoTenant[];
  parametros: ParametrosCatalogo;
  anoAtual: number;
  /** Vocabulário (marcas/linhas) do catálogo inteiro, quando `produtos` já é só o conjunto de candidatos da pré-seleção. */
  vocabulario?: ReturnType<typeof vocabularioDe> | undefined;
}

/** RN-CAT-12 / RN-CAT-09: ranking da vitrine sobre o texto, com o trecho "Serve em" e o "Equivale a" de cada item. */
export function buscarParaConsulta(e: EntradaBuscaConsulta): BuscaProdutosSaida['itens'] {
  const ids = e.produtoIds ? new Set(e.produtoIds) : null;
  const universo = e.produtos.filter((p) => p.ativo && (!ids || ids.has(p.id)));
  const interpretado = interpretarConsulta(e.q, e.vocabulario ?? vocabularioDe(universo));
  // sem preço nem estoque nesta consulta: só o que é texto, marca, linha e código
  const filtros = { ...interpretado, min_price_cents: null, max_price_cents: null, stock: null, sort: null };
  const docs = universo.map((p) => ({
    id: p.id,
    sku: p.sku,
    ean: p.ean,
    nome: p.nome,
    marca: p.marca,
    categoria: p.categoria,
    atributos: p.atributos.map((x) => `${x.name} ${x.value}`).join(' '),
    aplicacao: p.aplicacao ?? '',
    referencias: p.referencias ?? [],
    estoque: 0,
    vendas: p.vendas,
    campanha: p.campanha,
    preco_cents: null,
  }));
  const grupos = expandirSinonimos(filtros.text, e.sinonimos);
  return rankear(docs, { filtros, sinonimos: e.sinonimos, parametros: e.parametros, anoAtual: e.anoAtual })
    .slice(0, e.limite)
    .map((r) => ({
      produto_id: r.doc.id,
      nota: r.nota,
      so_aplicacao: r.so_aplicacao,
      serve_em: r.doc.aplicacao === '' ? null : trechoServeEm(r.doc.aplicacao, grupos, { anoAtual: e.anoAtual }),
      equivale_a: r.referencia_casada === null ? null : equivaleA(r.doc.referencias[r.referencia_casada]),
    }));
}

/** C8: aplicação e referências (até 3, marca ativa) por produto, na ordem pedida e sem repetir. */
export function textosParaConsulta(produtos: readonly ProdutoCatalogo[], produtoIds: readonly string[]): TextosProdutoSaida['itens'] {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const vistos = new Set<string>();
  const saida: TextosProdutoSaida['itens'] = [];
  for (const id of produtoIds) {
    const p = porId.get(id);
    if (!p || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({ produto_id: id, aplicacao: p.aplicacao ? p.aplicacao : null, referencias: [...(p.referencias ?? [])].slice(0, 3) });
  }
  return saida;
}
