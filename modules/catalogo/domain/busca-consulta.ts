/**
 * Núcleo puro das consultas `catalogo.busca_produtos@1` e `catalogo.textos_produto@1` (T-0084 C8/C9; RN-CAT-09, RN-CAT-12):
 * o mesmo código na API e no aparelho. A busca do seletor do Novo pedido usa o MESMO ranking da vitrine (sinônimos, faixa de
 * anos da aplicação, código do concorrente), mas sem preço: o preço segue em `precos_cliente@1`. Por isso os filtros de preço,
 * de estoque e de ordem por preço da frase são ignorados e o documento entra sem saldo (o boost de estoque não se aplica).
 */
import { buscaPodeRodar, MINIMO_CARACTERES_BUSCA, type BuscaProdutosSaida, type TextosProdutoSaida, type VeiculoEscolhido } from '../contracts';
import { interpretarConsulta } from './consulta';
import type { ParametrosCatalogo } from './parametros';
import { codigoCompacto, dentroDaDistancia, rankear, toleranciaDaPalavra } from './ranking';
import { trechoServeEm } from './serve-em';
import { expandirSinonimos, normalizarTexto, type SinonimoDoTenant } from './texto';
import { veiculosDe } from './veiculos';
import { filtrarPorVeiculo, produtosDoModelo } from './veiculo-filtro';
import type { IndiceVeiculos } from './veiculo-indice';
import { docDeBusca, equivaleA, vocabularioDe, type ProdutoCatalogo } from './vitrine';

export interface EntradaBuscaConsulta {
  produtos: readonly ProdutoCatalogo[];
  q: string;
  /** Restringe aos produtos do seletor; ausente = todos. */
  produtoIds?: readonly string[] | undefined;
  limite: number;
  sinonimos: readonly SinonimoDoTenant[];
  parametros: ParametrosCatalogo;
  anoAtual: number;
  /** RN-CAT-19: nomes de veículo da base inteira, quando `produtos` já é só um conjunto de candidatos; ausente = calculado de `produtos`. */
  veiculos?: ReadonlySet<string>;
  /** Vocabulário (marcas/linhas) do catálogo inteiro, quando `produtos` já é só o conjunto de candidatos da pré-seleção. */
  vocabulario?: ReturnType<typeof vocabularioDe> | undefined;
  /** RN-CAT-22: só os produtos que servem no veículo; soma com `q`, que pode ser vazio. Pede `indiceVeiculos`. */
  veiculo?: VeiculoEscolhido | undefined;
  indiceVeiculos?: IndiceVeiculos | undefined;
}

/** RF-CAT-01 (T-0167): itens por página do "+ Mostrar mais". */
export const TAMANHO_PAGINA_BUSCA = 20;
/** RF-CAT-01 (T-0167): a lista é ranqueada uma vez, até este teto; o app pagina nela sem nova consulta. */
export const TETO_RANKING_BUSCA = 400;

export { buscaPodeRodar, MINIMO_CARACTERES_BUSCA };

export interface PaginaDaBusca {
  mostrando: number;
  total: number;
  temMais: boolean;
  /** "Mostrando 20 de 87". */
  rotulo: string;
}

/** RF-CAT-01: `paginas` páginas de 20 já abertas sobre `total` itens ranqueados (o teto de 400 limita o total). */
export function paginaDaBusca(total: number, paginas: number): PaginaDaBusca {
  const t = Math.min(Math.max(0, Math.trunc(total)), TETO_RANKING_BUSCA);
  const mostrando = Math.min(t, Math.max(1, Math.trunc(paginas)) * TAMANHO_PAGINA_BUSCA);
  return { mostrando, total: t, temMais: mostrando < t, rotulo: `Mostrando ${mostrando} de ${t}` };
}

type ItemBusca = BuscaProdutosSaida['itens'][number];

/**
 * RF-CAT-01: SKU, EAN ou código alternativo (referência cruzada) idêntico ao texto vem em 1º, antes do ranking; o resto
 * mantém a ordem. Produto inativo não sobe. Comparação sem acento, caixa, hífen e espaço (`codigoCompacto`).
 */
export function codigoExatoNoTopo(itens: readonly ItemBusca[], produtos: readonly ProdutoCatalogo[], q: string): ItemBusca[] {
  const alvo = codigoCompacto(q);
  if (alvo === '') return [...itens];
  const exatos = produtos.filter((p) => p.ativo && (codigoCompacto(p.sku) === alvo || (p.ean !== null && p.ean === q.trim()) || (p.referencias ?? []).some((r) => codigoCompacto(r.codigo) === alvo)));
  if (exatos.length === 0) return [...itens];
  const topo = new Set(exatos.map((p) => p.id));
  const doRanking = new Map(itens.map((i) => [i.produto_id, i]));
  const primeiros = exatos.map((p) => doRanking.get(p.id) ?? { produto_id: p.id, nota: 1, so_aplicacao: false, serve_em: null, equivale_a: null });
  return [...primeiros, ...itens.filter((i) => !topo.has(i.produto_id))];
}

/**
 * RF-CAT-01: "Você quis dizer…". Para cada palavra (4+ letras) fora do vocabulário do índice, o termo mais próximo, até um erro a mais que
 * a tolerância do ranking (2 erros até 7 letras, 3 a partir de 8); no empate, o mais frequente. Nada a corrigir = `null`.
 * `termos`: termo normalizado → ocorrências (o vocabulário do índice, `catalogo__busca_vocab`).
 */
export function sugerirTermo(q: string, termos: ReadonlyMap<string, number>): string | null {
  let mudou = false;
  const saida = normalizarTexto(q)
    .split(' ')
    .filter(Boolean)
    .map((palavra) => {
      // sem resultado o ranking já tentou a tolerância dele: a sugestão abre uma casa a mais, só para palavras de 4+ letras
      if (toleranciaDaPalavra(palavra) === 0 || termos.has(palavra)) return palavra;
      const tolerancia = toleranciaDaPalavra(palavra) + 1;
      let melhor: { termo: string; d: number; n: number } | null = null;
      for (const [termo, n] of termos) {
        if (Math.abs(termo.length - palavra.length) > tolerancia || !dentroDaDistancia(palavra, termo, tolerancia)) continue;
        const d = [0, 1, 2, 3].find((x) => dentroDaDistancia(palavra, termo, x)) ?? tolerancia;
        if (!melhor || d < melhor.d || (d === melhor.d && n > melhor.n)) melhor = { termo, d, n };
      }
      if (!melhor) return palavra;
      mudou = true;
      return melhor.termo;
    });
  return mudou ? saida.join(' ') : null;
}

/** Os itens da consulta sem `aplicacao` (forma original, usada pela API). */
export function buscarParaConsulta(e: EntradaBuscaConsulta): BuscaProdutosSaida['itens'] {
  return buscarComTotal(e).itens.map(({ aplicacao: _aplicacao, ...resto }) => resto);
}

/**
 * RN-CAT-12 / RN-CAT-09: ranking da vitrine sobre o texto, com o trecho "Serve em" e o "Equivale a" de cada item.
 * T-0167 (RF-CAT-01): o ranking roda uma vez e vale até `limite` itens (o app pede o teto de 400 e pagina de 20 em 20);
 * `total` é quantos casaram (até o teto), e o código exato (SKU, EAN ou alternativo) sobe para o 1º lugar.
 */
export function buscarComTotal(e: EntradaBuscaConsulta): { itens: Array<BuscaProdutosSaida['itens'][number] & { aplicacao: string | null }>; total: number } {
  const ids = e.produtoIds ? new Set(e.produtoIds) : null;
  const universo = e.produtos.filter((p) => p.ativo && (!ids || ids.has(p.id)));
  const aplicacaoDe = new Map(universo.map((p) => [p.id, p.aplicacao ?? '']));
  // sem texto, a lista é a das peças que citam o modelo, por nome; o filtro de veículo corre no fim, sobre a lista já ordenada
  if (e.veiculo && e.indiceVeiculos && e.q.trim() === '') {
    const doModelo = produtosDoModelo(e.indiceVeiculos, e.veiculo);
    const lista = universo
      .filter((p) => doModelo.has(p.id))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id))
      .map((p) => ({ produto_id: p.id, nota: 0, so_aplicacao: false, serve_em: null, equivale_a: null }));
    const filtrada = filtrarPorVeiculo(lista, e.indiceVeiculos, e.veiculo).slice(0, TETO_RANKING_BUSCA);
    return { itens: filtrada.slice(0, e.limite).map((i) => ({ ...i, aplicacao: aplicacaoDe.get(i.produto_id) || null })), total: filtrada.length };
  }
  const interpretado = interpretarConsulta(e.q, e.vocabulario ?? vocabularioDe(universo));
  // sem preço nem estoque nesta consulta: só o que é texto, marca, linha e código
  const filtros = { ...interpretado, min_price_cents: null, max_price_cents: null, stock: null, sort: null };
  const docs = universo.map((p) => docDeBusca(p, null));
  const grupos = expandirSinonimos(filtros.text, e.sinonimos);
  const veiculos = e.veiculos ?? veiculosDe(e.produtos);
  const ranqueados = rankear(docs, { filtros, sinonimos: e.sinonimos, parametros: e.parametros, anoAtual: e.anoAtual, veiculos })
    .slice(0, TETO_RANKING_BUSCA)
    .map((r) => ({
      produto_id: r.doc.id,
      nota: r.nota,
      so_aplicacao: r.so_aplicacao,
      serve_em: r.doc.aplicacao === '' ? null : trechoServeEm(r.doc.aplicacao, grupos, { anoAtual: e.anoAtual, veiculos }),
      equivale_a: r.referencia_casada === null ? null : equivaleA(r.doc.referencias[r.referencia_casada]),
    }));
  const doRanking = codigoExatoNoTopo(ranqueados, universo, e.q).slice(0, TETO_RANKING_BUSCA);
  const todos = e.veiculo && e.indiceVeiculos ? filtrarPorVeiculo(doRanking, e.indiceVeiculos, e.veiculo) : doRanking;
  return { itens: todos.slice(0, e.limite).map((i) => ({ ...i, aplicacao: aplicacaoDe.get(i.produto_id) || null })), total: todos.length };
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
