/**
 * Ranking híbrido da busca do Catálogo (RF-CAT-01, RF-CAT-02): pontuação textual com tolerância a erro de
 * digitação e sinônimos, combinação com a nota semântica (quando existe), boosts por estoque, mais vendido e
 * campanha, filtros estruturados e desempate determinístico. Tudo função pura: roda no app, na web e na API.
 *
 * Nota final = (nota-base) + boosts, com nota-base = (1 − w) × texto + w × semântica (w = `peso_semantico`).
 * Boost só soma quando a nota-base é maior que zero: nunca ressuscita produto sem relevância.
 */
import type { FiltrosInterpretados } from '../contracts';
import type { ParametrosCatalogo } from './parametros';
import { chaveDeTermo, expandirSinonimos, tokensDeBusca, type SinonimoDoTenant } from './texto';

/** Documento da busca: cadastro do Core + preço/estoque já resolvidos para o usuário e sinais de venda. */
export interface DocBusca {
  id: string;
  /** Código ERP/SKU. */
  sku: string;
  ean: string | null;
  nome: string;
  marca: string;
  categoria: string;
  /** Atributos e aplicações em texto livre (quanto menos peso, mais genérico). */
  atributos: string;
  /** Saldo visível ao usuário (filiais dele). Maior que zero = tem estoque. */
  estoque: number;
  /** Vendas recentes (qualquer escala; normalizadas pelo maior valor dos candidatos). */
  vendas: number;
  campanha: boolean;
  /** Preço na tabela do cliente; nulo = sem preço. */
  preco_cents: number | null;
}

const PESO_CAMPO = { nome: 1, codigo: 1, marca: 0.6, categoria: 0.4, atributos: 0.3 } as const;
const NIVEL = { exato: 1, prefixo: 0.7, digitacao: 0.5 } as const;
const MEDIDA_RE = /^\d+(\.\d+)?(ml|g|cm|mm|un)$/;
const arred6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Distância de edição (inserção, remoção, troca e transposição de letras vizinhas). */
export function distanciaEdicao(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Quanto a palavra da consulta casa com um termo do campo: exato 1; prefixo (3+ letras) 0,7; erro de digitação 0,5. */
export function nivelDaPalavra(q: string, termo: string): number {
  if (q === termo) return NIVEL.exato;
  if (/\d/.test(q) || MEDIDA_RE.test(q)) return 0; // medidas e códigos só casam exatos
  if (q.length >= 3 && termo.length > q.length && termo.startsWith(q)) return NIVEL.prefixo;
  if (q.length >= 4) {
    const tolerancia = q.length >= 8 ? 2 : 1;
    // T-0052-B4: a distância é no mínimo a diferença de tamanho; evita montar a matriz para quase todos os termos
    if (Math.abs(q.length - termo.length) <= tolerancia && distanciaEdicao(q, termo) <= tolerancia) return NIVEL.digitacao;
  }
  return 0;
}

function melhorNivel(alternativa: string, termosDoCampo: readonly string[]): number {
  const palavras = alternativa.split(' ').filter(Boolean);
  if (palavras.length === 0) return 0;
  let menor = 1;
  for (const q of palavras) {
    let melhor = 0;
    for (const t of termosDoCampo) melhor = Math.max(melhor, nivelDaPalavra(q, t));
    menor = Math.min(menor, melhor);
    if (menor === 0) return 0;
  }
  return menor;
}

export interface PontuacaoTextual {
  /** 0..1: média, entre os termos da consulta, do melhor acerto (nível × peso do campo). */
  pontos: number;
  casados: number;
  total: number;
}

/** Pontuação textual de um documento para os grupos de alternativas da consulta (ver `expandirSinonimos`). */
export function pontuacaoTextual(grupos: readonly (readonly string[])[], doc: DocBusca): PontuacaoTextual {
  if (grupos.length === 0) return { pontos: 0, casados: 0, total: 0 };
  const campos: { termos: string[]; peso: number }[] = [
    { termos: tokensDeBusca(doc.nome), peso: PESO_CAMPO.nome },
    { termos: tokensDeBusca(`${doc.sku} ${doc.ean ?? ''}`.trim()).concat([doc.sku, doc.ean ?? ''].map((c) => chaveDeTermo(c)).filter(Boolean), codigoCompacto(doc.sku) || []), peso: PESO_CAMPO.codigo },
    { termos: tokensDeBusca(doc.marca), peso: PESO_CAMPO.marca },
    { termos: tokensDeBusca(doc.categoria), peso: PESO_CAMPO.categoria },
    { termos: tokensDeBusca(doc.atributos), peso: PESO_CAMPO.atributos },
  ];
  let soma = 0;
  let casados = 0;
  let casouPalavra = false;
  for (const grupo of grupos) {
    let melhor = 0;
    for (const alt of grupo) {
      for (const c of campos) melhor = Math.max(melhor, melhorNivel(alt, c.termos) * c.peso);
    }
    if (melhor > 0) {
      casados++;
      if (grupo.some((alt) => /[a-z]/.test(alt))) casouPalavra = true;
    }
    soma += melhor;
  }
  // número solto ("50") não basta para o produto ser relevante quando a consulta também tem palavras
  const temPalavra = grupos.some((g) => g.some((alt) => /[a-z]/.test(alt)));
  if (temPalavra && !casouPalavra) soma = 0;
  return { pontos: arred6(soma / grupos.length), casados, total: grupos.length };
}

/** Combina a nota textual com a semântica (0..1). Sem nota semântica vale só o texto. */
export function combinarNotas(textual: number, semantica: number | null, pesoSemantico: number): number {
  if (semantica === null) return textual;
  const s = Math.min(1, Math.max(0, semantica));
  return arred6((1 - pesoSemantico) * textual + pesoSemantico * s);
}

export interface SinaisDeBoost {
  estoque: number;
  /** Vendas normalizadas 0..1 (vendas ÷ maior venda dos candidatos). */
  vendas_norm: number;
  campanha: boolean;
}

/** Nota final: nota-base + boosts por estoque, mais vendido e campanha (só se a nota-base > 0). */
export function notaFinal(base: number, sinais: SinaisDeBoost, p: Pick<ParametrosCatalogo, 'peso_estoque' | 'peso_mais_vendido' | 'peso_campanha'>): number {
  if (!(base > 0)) return 0;
  const vendas = Math.min(1, Math.max(0, sinais.vendas_norm));
  return arred6(base + (sinais.estoque > 0 ? p.peso_estoque : 0) + p.peso_mais_vendido * vendas + (sinais.campanha ? p.peso_campanha : 0));
}

export interface ItemRankeado {
  doc: DocBusca;
  nota: number;
  textual: number;
  semantica: number | null;
  /** Veio do código exato (SKU/EAN). */
  exato: boolean;
}

export interface EntradaRanking {
  filtros: FiltrosInterpretados;
  sinonimos: readonly SinonimoDoTenant[];
  parametros: ParametrosCatalogo;
  /** Nota semântica 0..1 por id de produto (quando há busca vetorial). Se o mapa tem alguma nota, quem não tem leva 0. */
  semantica?: ReadonlyMap<string, number>;
}

const mesmaChave = (a: string, b: string) => chaveDeTermo(a) === chaveDeTermo(b);

/** Forma compacta de um código (`PAS-DIA-150` → `pasdia150`): só letras e dígitos, sem acento nem caixa (T-0052-B1). */
export function codigoCompacto(s: string | null | undefined): string {
  return s ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

function casaComCodigo(d: DocBusca, code: NonNullable<FiltrosInterpretados['code']>): boolean {
  if (code.type === 'ean') return d.ean === code.value;
  const v = codigoCompacto(code.value);
  return d.ean === code.value || (v !== '' && codigoCompacto(d.sku) === v);
}

/** Filtros estruturados (RN-CAT-01): marca, categoria, faixa de preço e estoque. O código é tratado à parte. */
function casaComFiltros(d: DocBusca, f: FiltrosInterpretados): boolean {
  if (f.brand !== null && !mesmaChave(d.marca, f.brand)) return false;
  if (f.line !== null && !mesmaChave(d.categoria, f.line)) return false;
  if (f.min_price_cents !== null || f.max_price_cents !== null) {
    if (d.preco_cents === null) return false;
    if (f.min_price_cents !== null && d.preco_cents < f.min_price_cents) return false;
    if (f.max_price_cents !== null && d.preco_cents > f.max_price_cents) return false;
  }
  if (f.stock === 'com' && !(d.estoque > 0)) return false;
  if (f.stock === 'sem' && d.estoque > 0) return false;
  return true;
}

const nomeChave = (d: DocBusca) => d.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Aplica código exato, filtros e ranking. Devolve a lista completa ordenada (quem corta é o chamador).
 * Desempate (nesta ordem): código exato → nota final ↓ → nota textual ↓ → tem estoque → mais vendas → nome
 * (sem acento, ordem de código) → id. Com `sort` de preço, o preço manda e o resto desempata na mesma ordem.
 */
export function rankear(docs: readonly DocBusca[], entrada: EntradaRanking): ItemRankeado[] {
  const { filtros, parametros: p } = entrada;
  const grupos = expandirSinonimos(filtros.text, entrada.sinonimos);
  const comTexto = grupos.length > 0;
  const comSemantica = (entrada.semantica?.size ?? 0) > 0;

  let candidatos = docs.filter((d) => casaComFiltros(d, filtros));
  let exatos = new Set<string>();
  if (filtros.code) {
    const achados = docs.filter((d) => casaComCodigo(d, filtros.code!) && casaComFiltros(d, filtros));
    if (achados.length > 0) {
      candidatos = achados;
      exatos = new Set(achados.map((d) => d.id));
    } else if (!comTexto) {
      return [];
    }
  }

  const maxVendas = candidatos.reduce((m, d) => Math.max(m, d.vendas), 0);
  const itens: ItemRankeado[] = [];
  for (const doc of candidatos) {
    const textual = pontuacaoTextual(grupos, doc).pontos;
    const semantica = comSemantica ? (entrada.semantica!.get(doc.id) ?? 0) : null;
    const exato = exatos.has(doc.id);
    const base = exato ? 1 : comTexto || comSemantica ? combinarNotas(textual, semantica, p.peso_semantico) : 1;
    const nota = notaFinal(base, { estoque: doc.estoque, vendas_norm: maxVendas > 0 ? doc.vendas / maxVendas : 0, campanha: doc.campanha }, p);
    if (nota > 0) itens.push({ doc, nota, textual, semantica, exato });
  }

  const preco = filtros.sort;
  return itens.sort((a, b) => {
    if (a.exato !== b.exato) return a.exato ? -1 : 1;
    if (preco) {
      const pa = a.doc.preco_cents;
      const pb = b.doc.preco_cents;
      if (pa !== pb) {
        if (pa === null) return 1;
        if (pb === null) return -1;
        return preco === 'preco_asc' ? pa - pb : pb - pa;
      }
    }
    return (
      b.nota - a.nota ||
      b.textual - a.textual ||
      Number(b.doc.estoque > 0) - Number(a.doc.estoque > 0) ||
      b.doc.vendas - a.doc.vendas ||
      cmp(nomeChave(a.doc), nomeChave(b.doc)) ||
      cmp(a.doc.id, b.doc.id)
    );
  });
}
