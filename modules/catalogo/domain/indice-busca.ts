/**
 * Índice de pré-seleção da busca (T-0119, D-T0107b): com 20 mil produtos, ranquear o catálogo inteiro a cada pedido
 * custava ~4 s de CPU. O índice invertido (termo → produtos) devolve, antes do ranking, um SUPERCONJUNTO exato dos
 * produtos que podem ter nota textual maior que zero ou casar por código; o ranking (`rankear`) segue igual e só roda
 * neles. Termo da consulta casa termo do índice pelos mesmos critérios de `nivelDaPalavra` (exato, prefixo, digitação).
 * Função pura; o índice vale para uma lista de produtos e um ano (a aplicação expande faixas de anos).
 */
import type { FiltrosInterpretados } from '../contracts';
import { anoCivilNoFuso } from './ano-civil';
import { expandirAplicacao } from './aplicacao';
import { codigoCompacto, codigosDaConsulta, nivelDaPalavra } from './ranking';
import { chaveDeTermo, expandirSinonimos, tokensDeBusca, tokensDeBuscaSemMemo, type SinonimoDoTenant } from './texto';
import { aplicarChips, type ChipsVitrine, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';
import { filtrosParaPerfil } from './visibilidade';

/** Abaixo disto o ranking completo é barato e o índice não compensa. */
export const MINIMO_PARA_INDICE = 2000;

export interface IndiceBusca {
  produtos: readonly ProdutoCatalogo[];
  anoAtual: number;
  /** Termos de texto (nome, código, marca, categoria, atributos, aplicação) → posições em `produtos`. */
  porTermo: ReadonlyMap<string, readonly number[]>;
  /** Vocabulário do índice, ordenado por tamanho (para varrer só os termos de tamanho compatível com a consulta). */
  termos: readonly string[];
  /** Códigos exatos (EAN cru, SKU e referências compactados) → posições. */
  porCodigo: ReadonlyMap<string, readonly number[]>;
}

function acrescentar(m: Map<string, number[]>, termo: string, i: number): void {
  if (!termo) return;
  const l = m.get(termo);
  if (!l) m.set(termo, [i]);
  else if (l[l.length - 1] !== i) l.push(i);
}

export function construirIndiceBusca(produtos: readonly ProdutoCatalogo[], anoAtual: number): IndiceBusca {
  const porTermo = new Map<string, number[]>();
  const porCodigo = new Map<string, number[]>();
  produtos.forEach((p, i) => {
    const texto = (t: string | null | undefined) => {
      for (const x of tokensDeBuscaSemMemo(t ?? '')) acrescentar(porTermo, x, i);
    };
    const termos = (t: string | null | undefined) => {
      for (const x of tokensDeBusca(t ?? '')) acrescentar(porTermo, x, i);
    };
    termos(p.nome);
    termos(`${p.sku} ${p.ean ?? ''}`.trim());
    acrescentar(porTermo, chaveDeTermo(p.sku), i);
    acrescentar(porTermo, chaveDeTermo(p.ean ?? ''), i);
    acrescentar(porTermo, codigoCompacto(p.sku), i);
    termos(p.marca);
    termos(p.categoria);
    termos(p.atributos.map((x) => `${x.name} ${x.value}`).join(' '));
    for (const r of p.referencias ?? []) {
      termos(r.codigo);
      acrescentar(porTermo, codigoCompacto(r.codigo), i);
      acrescentar(porCodigo, codigoCompacto(r.codigo), i);
    }
    const apl = p.aplicacao ?? '';
    if (apl !== '') {
      texto(apl);
      texto(expandirAplicacao(apl, { anoAtual }).textoIndice);
    }
    acrescentar(porCodigo, codigoCompacto(p.sku), i);
    if (p.ean) acrescentar(porCodigo, p.ean, i);
  });
  const termos = [...porTermo.keys()].sort((a, b) => a.length - b.length);
  return { produtos, anoAtual, porTermo, termos, porCodigo };
}

/** Posições dos produtos que têm algum termo que a palavra casa (exato, prefixo ou erro de digitação). */
export function posicoesDaPalavra(indice: IndiceBusca, palavra: string, destino: Set<number>): void {
  const exato = indice.porTermo.get(palavra);
  if (exato) for (const i of exato) destino.add(i);
  // medidas e códigos (com dígito) só casam exatos; palavras curtas só exatas (ver `nivelDaPalavra`)
  if (/\d/.test(palavra) || palavra.length < 3) return;
  const tolerancia = palavra.length >= 8 ? 2 : palavra.length >= 4 ? 1 : 0;
  const menor = palavra.length - tolerancia;
  // termos de tamanho >= menor; o prefixo exige termo maior que a palavra, a digitação até `+ tolerancia`
  let ini = 0;
  let fim = indice.termos.length;
  while (ini < fim) {
    const m = (ini + fim) >> 1;
    if (indice.termos[m]!.length < menor) ini = m + 1;
    else fim = m;
  }
  for (let k = ini; k < indice.termos.length; k++) {
    const t = indice.termos[k]!;
    if (t.length > palavra.length + tolerancia && !t.startsWith(palavra)) {
      // acima do alcance da digitação só o prefixo conta; sem prefixo não há como casar
      continue;
    }
    if (nivelDaPalavra(palavra, t) > 0) for (const i of indice.porTermo.get(t)!) destino.add(i);
  }
}

const indices = new WeakMap<readonly ProdutoCatalogo[], IndiceBusca>();

/** Índice da lista (guardado enquanto a lista for o mesmo objeto; o repositório troca a lista quando o cadastro muda). */
export function indiceDe(produtos: readonly ProdutoCatalogo[], anoAtual: number): IndiceBusca {
  const i = indices.get(produtos);
  if (i && i.anoAtual === anoAtual) return i;
  const novo = construirIndiceBusca(produtos, anoAtual);
  indices.set(produtos, novo);
  return novo;
}

export interface EntradaCandidatos {
  produtos: readonly ProdutoCatalogo[];
  contexto: Pick<ContextoVitrine, 'perfil' | 'parametros' | 'agora'>;
  filtros: FiltrosInterpretados;
  chips?: ChipsVitrine;
  sinonimos: readonly SinonimoDoTenant[];
  semantica?: ReadonlyMap<string, number>;
  anoAtual?: number;
  fuso?: string;
  /** Padrão `MINIMO_PARA_INDICE`. */
  minimo?: number;
}

export interface Candidatos {
  produtos: ProdutoCatalogo[];
  /** Maior `vendas` entre os candidatos do ranking completo (normaliza o boost; não pode mudar com a pré-seleção). */
  maxVendas: number;
}

const passaCadastro = (p: ProdutoCatalogo, f: FiltrosInterpretados) => (f.brand === null || chaveDeTermo(p.marca) === chaveDeTermo(f.brand)) && (f.line === null || chaveDeTermo(p.categoria) === chaveDeTermo(f.line));

/**
 * Pré-seleção da busca (T-0119): os produtos ativos que podem aparecer no resultado e o `maxVendas` do ranking completo.
 * `null` = não vale pré-selecionar (catálogo pequeno, sem texto nem código, nota semântica, filtro de preço ou de estoque,
 * ou "só vendáveis", que dependem do cartão de cada produto): o chamador usa a lista inteira, como antes.
 * Invariante (testada contra `buscarProdutos` sobre a lista inteira): mesmos itens, mesma ordem, mesmo `total`.
 */
export function candidatosDaBusca(e: EntradaCandidatos): Candidatos | null {
  if (e.produtos.length < (e.minimo ?? MINIMO_PARA_INDICE)) return null;
  if ((e.semantica?.size ?? 0) > 0 || e.chips?.only_sellable) return null;
  const filtros = filtrosParaPerfil(aplicarChips(e.filtros, e.chips ?? {}), e.contexto.perfil, e.contexto.parametros);
  if (filtros.min_price_cents !== null || filtros.max_price_cents !== null || filtros.stock !== null) return null;
  const grupos = expandirSinonimos(filtros.text, e.sinonimos);
  if (grupos.length === 0 && !filtros.code) return null;
  const anoAtual = e.anoAtual ?? anoCivilNoFuso(e.contexto.agora, e.fuso);
  const indice = indiceDe(e.produtos, anoAtual);
  const noArvore = e.chips?.only_product_ids;
  const entra = (i: number) => {
    const p = e.produtos[i]!;
    return p.ativo && !(e.chips?.campaign && !p.campanha) && (!noArvore || noArvore.has(p.id)) && passaCadastro(p, filtros);
  };
  const saida = (posicoes: Iterable<number>): Candidatos => {
    const ordenadas = [...posicoes].sort((a, b) => a - b);
    return { produtos: ordenadas.map((i) => e.produtos[i]!), maxVendas: 0 };
  };

  // código exato (SKU, EAN, referência): se achou, só eles entram (igual ao `rankear`)
  if (filtros.code) {
    const v = codigoCompacto(filtros.code.value);
    const achados = new Set<number>();
    for (const i of indice.porCodigo.get(filtros.code.value) ?? []) if (e.produtos[i]!.ean === filtros.code.value) achados.add(i);
    if (filtros.code.type !== 'ean' && v !== '') for (const i of indice.porCodigo.get(v) ?? []) achados.add(i);
    const validos = [...achados].filter(entra);
    if (validos.length > 0) {
      const r = saida(validos);
      return { ...r, maxVendas: r.produtos.reduce((m, p) => Math.max(m, p.vendas), 0) };
    }
    if (grupos.length === 0) return { produtos: [], maxVendas: 0 };
  }

  // maior venda do universo que o ranking completo enxergaria (todo ativo que passa nos filtros de cadastro)
  let maxVendas = 0;
  for (let i = 0; i < e.produtos.length; i++) if (e.produtos[i]!.vendas > maxVendas && entra(i)) maxVendas = e.produtos[i]!.vendas;

  const alvo = new Set<number>();
  const palavras = new Set<string>();
  for (const g of grupos) for (const alt of g) for (const w of alt.split(' ')) if (w) palavras.add(w);
  for (const w of palavras) posicoesDaPalavra(indice, w, alvo);
  // n-gramas de código ("cb 3401" → "cb3401") e o código do filtro
  for (const c of codigosDaConsulta(filtros.text)) for (const i of indice.porCodigo.get(c) ?? []) alvo.add(i);
  const r = saida([...alvo].filter(entra));
  return { ...r, maxVendas };
}
