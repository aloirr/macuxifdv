/**
 * Ranking híbrido da busca do Catálogo (RF-CAT-01, RF-CAT-02): pontuação textual com tolerância a erro de
 * digitação e sinônimos, combinação com a nota semântica (quando existe), boosts por estoque, mais vendido e
 * campanha, filtros estruturados e desempate determinístico. Tudo função pura: roda no app, na web e na API.
 *
 * Nota final = (nota-base) + boosts, com nota-base = (1 − w) × texto + w × semântica (w = `peso_semantico`).
 * Boost só soma quando a nota-base é maior que zero: nunca ressuscita produto sem relevância.
 */
import type { FiltrosInterpretados, Referencia } from '../contracts';
import { expandirAplicacao } from './aplicacao';
import type { ParametrosCatalogo } from './parametros';
import { chaveDeTermo, expandirSinonimos, semAcento, tokensDeBusca, tokensDeBuscaSemMemo, type SinonimoDoTenant } from './texto';

/** Documento da busca: cadastro do Core + preço/estoque já resolvidos para o usuário e sinais de venda. */
export interface DocBusca {
  id: string;
  /** Código ERP/SKU. */
  sku: string;
  ean: string | null;
  nome: string;
  marca: string;
  categoria: string;
  /** Atributos técnicos em texto livre (quanto menos peso, mais genérico). */
  atributos: string;
  /** RN-CAT-11: Aplicação (descrição 2) do cadastro; '' = sem aplicação (o ranking fica igual ao de antes). */
  aplicacao: string;
  /** RN-CAT-09: referências cruzadas ativas (até 3); marca inativa já fica de fora. */
  referencias: readonly Referencia[];
  /** Saldo visível ao usuário (filiais dele). Maior que zero = tem estoque. */
  estoque: number;
  /** Vendas recentes (qualquer escala; normalizadas pelo maior valor dos candidatos). */
  vendas: number;
  campanha: boolean;
  /** Preço na tabela do cliente; nulo = sem preço. */
  preco_cents: number | null;
  /** T-0119: termos já calculados na carga do índice (mesmo resultado de `tokensDoDoc`); ausente = calcula na hora. */
  tokens?: TokensDoDoc | undefined;
}

/** Termos de cada campo do documento (a busca tolerante compara a palavra da consulta com eles). */
export interface TokensDoDoc {
  nome: string[];
  /** SKU, EAN, chaves do SKU/EAN, código compacto e códigos das referências cruzadas. */
  codigo: string[];
  marca: string[];
  categoria: string[];
  atributos: string[];
}

/** Termos dos campos do documento. `semMemo` evita encher a memória de textos normalizados na carga de 20 mil produtos. */
export function tokensDoDoc(d: Pick<DocBusca, 'sku' | 'ean' | 'nome' | 'marca' | 'categoria' | 'atributos' | 'referencias'>, semMemo = false): TokensDoDoc {
  const tk = semMemo ? tokensDeBuscaSemMemo : tokensDeBusca;
  const referencias = d.referencias ?? [];
  const codigosRef = referencias.flatMap((r) => [...tk(r.codigo), codigoCompacto(r.codigo)]).filter(Boolean);
  return {
    nome: tk(d.nome),
    codigo: tk(`${d.sku} ${d.ean ?? ''}`.trim()).concat([d.sku, d.ean ?? ''].map((c) => chaveDeTermo(c)).filter(Boolean), codigoCompacto(d.sku) || [], codigosRef),
    marca: tk(d.marca),
    categoria: tk(d.categoria),
    atributos: tk(d.atributos),
  };
}

/** Termos já preparados por produto (carga do índice); a vida da entrada é a do objeto do produto. */
export const TOKENS_DO_PRODUTO = new WeakMap<object, TokensDoDoc>();

/** `aplicacao` é o padrão de `peso_aplicacao` (RN-CAT-12); o ranking usa o do tenant. */
const PESO_CAMPO = { nome: 1, codigo: 1, marca: 0.6, categoria: 0.4, atributos: 0.3, aplicacao: 0.5 } as const;
const ANO_RE = /^(19|20)\d{2}$/;
/** Separador de trechos da aplicação (igual ao do "Serve em"). */
const SEPARADOR_TRECHO = /[;|•\r\n]/;
/** RN-CAT-09: tamanho do código (já compactado) para casar por n-grama. */
const CODIGO_MIN = 3;
const CODIGO_MAX = 30;

/**
 * RN-CAT-09: n-gramas compactos da consulta (1 a 3 palavras seguidas, de 3 a 30 caracteres depois de compactadas) que
 * podem ser um código. Um termo só precisa de letra E dígito ("cb3401"); 2 ou 3 termos, de ao menos um dígito
 * ("cb 3401"). "3401" sozinho não conta: casa só pelo termo.
 */
export function codigosDaConsulta(texto: string): string[] {
  const palavras = String(texto ?? '').split(/\s+/).filter(Boolean);
  const achados = new Set<string>();
  for (let i = 0; i < palavras.length; i++) {
    for (let n = 1; n <= 3 && i + n <= palavras.length; n++) {
      const c = codigoCompacto(palavras.slice(i, i + n).join(''));
      if (c.length < CODIGO_MIN || c.length > CODIGO_MAX || !/\d/.test(c)) continue;
      if (n === 1 && !/[a-z]/.test(c)) continue;
      achados.add(c);
    }
  }
  return [...achados];
}
const NIVEL = { exato: 1, prefixo: 0.7, digitacao: 0.5 } as const;

/** Termos da aplicação para casar por igualdade e prefixo (sem tolerância de digitação: ela fica nos campos curtos). */
interface TermosAplicacao {
  /** Ordenados e sem repetição; as cadeias vêm do vocabulário compartilhado (cada termo existe uma vez só na memória). */
  ordenados: readonly string[];
}
/** Vocabulário compartilhado: "dianteiro" de 20 mil aplicações é uma cadeia só (a memória guarda ponteiros, não cópias). */
const VOCABULARIO = new Map<string, string>();
const LIMITE_VOCABULARIO = 50_000;
function internar(t: string): string {
  const v = VOCABULARIO.get(t);
  if (v !== undefined) return v;
  if (VOCABULARIO.size >= LIMITE_VOCABULARIO) VOCABULARIO.clear();
  VOCABULARIO.set(t, t);
  return t;
}
function termosDaAplicacao(texto: string): TermosAplicacao {
  return { ordenados: [...new Set(tokensDeBuscaSemMemo(texto))].map(internar).sort() };
}

/** Posição do primeiro termo >= q (busca binária). */
function primeiroNaoMenor(o: readonly string[], q: string): number {
  let a = 0;
  let b = o.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (o[m]! < q) a = m + 1;
    else b = m;
  }
  return a;
}

/** Mesmo critério de `nivelDaPalavra` para exato e prefixo (medidas e códigos só exatos), em O(log n) sobre os termos ordenados. */
function nivelNaAplicacao(q: string, t: TermosAplicacao): number {
  const o = t.ordenados;
  const i = primeiroNaoMenor(o, q);
  if (i < o.length && o[i] === q) return NIVEL.exato;
  if (q.length < 3 || /\d/.test(q) || MEDIDA_RE.test(q)) return 0;
  // o primeiro termo >= q é o único candidato a prefixo (um termo maior que q e que começa com q fica logo depois de q)
  return i < o.length && o[i]!.startsWith(q) ? NIVEL.prefixo : 0;
}

function melhorNivelAplicacao(alternativa: string, t: TermosAplicacao): number {
  const palavras = alternativa.split(' ').filter(Boolean);
  if (palavras.length === 0) return 0;
  let menor = 1;
  for (const q of palavras) {
    menor = Math.min(menor, nivelNaAplicacao(q, t));
    if (menor === 0) return 0;
  }
  return menor;
}

interface AnaliseAplicacao {
  /** Texto de origem: a entrada só vale enquanto o cadastro não muda (mesma função de `updated_at` do produto, sem depender dele). */
  texto: string;
  anos: number[];
  /** Termos do texto inteiro: só calculados quando a busca não precisa casar por trecho. */
  todos?: TermosAplicacao;
  segmentos: number;
  /** Só quando a consulta tem ano e a aplicação tem 2+ trechos com anos (RN-CAT-12, mesmo trecho). */
  trechos?: { anos: number[]; termos: TermosAplicacao }[];
}
type Trecho = { anos: number[]; termos: TermosAplicacao };
/**
 * Memória da análise por produto: chave curta `produto_id|ano` (T-0084 §4.5), validada pelo texto da aplicação (que só muda
 * quando o `updated_at` do produto muda). Teto de 800 entradas (2 × 400 candidatos) com LRU: sai o menos usado, nunca tudo de uma vez.
 * A chave pelo texto inteiro, com 3.000 entradas, mediu 90 MB.
 */
const MEMO_APLICACAO = new Map<string, AnaliseAplicacao>();
export const LIMITE_MEMO_APLICACAO = 800;
/** Trechos iguais se repetem entre produtos ("Fiat Uno 1.0 2010–2014"): a análise de cada trecho sai uma vez só. */
const MEMO_TRECHOS = new Map<string, Trecho>();
export const LIMITE_MEMO_TRECHOS = 2000;
export function esquecerMemoriaRanking(): void {
  MEMO_APLICACAO.clear();
  MEMO_TRECHOS.clear();
  VOCABULARIO.clear();
}

const bytesDeTermos = (t: TermosAplicacao | undefined) => (t ? 48 + 8 * t.ordenados.length : 0); // ponteiros: as cadeias são do vocabulário
/** Estimativa determinística (bytes) da memória do ranking: cadeias a 2 bytes/caractere, sobrecarga fixa por termo e por entrada. */
export function estimarMemoriaRanking(): { entradas: number; trechos: number; bytes: number } {
  let bytes = 0;
  const vistos = new Set<Trecho>();
  for (const [k, a] of MEMO_APLICACAO) {
    bytes += 200 + k.length * 2 + a.texto.length * 2 + 8 * a.anos.length + bytesDeTermos(a.todos);
    for (const t of a.trechos ?? []) if (!vistos.has(t)) { vistos.add(t); bytes += 64 + 8 * t.anos.length + bytesDeTermos(t.termos); }
  }
  for (const [k, t] of MEMO_TRECHOS) if (!vistos.has(t)) bytes += 200 + k.length * 2 + 8 * t.anos.length + bytesDeTermos(t.termos);
  for (const v of VOCABULARIO.keys()) bytes += 40 + v.length * 2;
  return { entradas: MEMO_APLICACAO.size, trechos: MEMO_TRECHOS.size, bytes };
}

function analisarTrecho(seg: string, anoAtual: number): Trecho {
  const chave = `${anoAtual}|${seg}`;
  let t = MEMO_TRECHOS.get(chave);
  if (!t) {
    const e = expandirAplicacao(seg, { anoAtual });
    t = { anos: e.anos, termos: termosDaAplicacao(e.textoIndice) };
    if (MEMO_TRECHOS.size >= LIMITE_MEMO_TRECHOS) MEMO_TRECHOS.delete(MEMO_TRECHOS.keys().next().value!);
    MEMO_TRECHOS.set(chave, t);
  }
  return t;
}
function analisarAplicacao(id: string, aplicacao: string, anoAtual: number, comTrechos: boolean): AnaliseAplicacao & { todos: TermosAplicacao } {
  const chave = `${id}|${anoAtual}`;
  let novo: ReturnType<typeof expandirAplicacao> | undefined;
  let a = MEMO_APLICACAO.get(chave);
  if (a && a.texto !== aplicacao) a = undefined; // cadastro mudou
  if (a) {
    MEMO_APLICACAO.delete(chave); // LRU: o usado agora vira o mais novo
    MEMO_APLICACAO.set(chave, a);
  } else {
    const e = expandirAplicacao(aplicacao, { anoAtual });
    novo = e;
    a = { texto: aplicacao, anos: e.anos, segmentos: aplicacao.split(SEPARADOR_TRECHO).filter((x) => x.trim() !== '').length };
    MEMO_APLICACAO.delete(chave);
    if (MEMO_APLICACAO.size >= LIMITE_MEMO_APLICACAO) MEMO_APLICACAO.delete(MEMO_APLICACAO.keys().next().value!);
    MEMO_APLICACAO.set(chave, a);
  }
  const porTrecho = comTrechos && a.segmentos >= 2 && a.anos.length > 0;
  if (porTrecho && !a.trechos) {
    a.trechos = aplicacao
      .split(SEPARADOR_TRECHO)
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .map((seg) => analisarTrecho(seg, anoAtual));
  }
  // o texto expandido não fica na memória (só os termos): reexpandir custa pouco perto de guardar ~2× o cadastro
  if (!porTrecho && !a.todos) a.todos = termosDaAplicacao(novo?.textoIndice ?? expandirAplicacao(aplicacao, { anoAtual }).textoIndice);
  return a as AnaliseAplicacao & { todos: TermosAplicacao };
}
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

/**
 * `distanciaEdicao(a, b) <= max` sem montar a matriz inteira (T-0119, D-T0107b): só a faixa |i-j| <= max e saída assim que a
 * linha e a anterior (por causa da troca de vizinhas) passam de `max`. Mesmo resultado da distância completa.
 */
export function dentroDaDistancia(a: string, b: string, max: number): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  const INF = max + 1;
  if (lb + 1 > LINHA_A.length) {
    LINHA_A = new Int32Array(lb + 1);
    LINHA_B = new Int32Array(lb + 1);
    LINHA_C = new Int32Array(lb + 1);
  }
  let ant2 = LINHA_C;
  let ant = LINHA_A;
  let atual = LINHA_B;
  for (let j = 0; j <= lb; j++) ant[j] = j <= max ? j : INF;
  let minAnt = 0;
  for (let i = 1; i <= la; i++) {
    atual.fill(INF, 0, lb + 1);
    if (i <= max) atual[0] = i;
    let minAtual = atual[0]!;
    const de = Math.max(1, i - max);
    const ate = Math.min(lb, i + max);
    for (let j = de; j <= ate; j++) {
      const custo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(ant[j]! + 1, atual[j - 1]! + 1, ant[j - 1]! + custo);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, ant2[j - 2]! + 1);
      if (v > INF) v = INF;
      atual[j] = v;
      if (v < minAtual) minAtual = v;
    }
    if (minAtual > max && minAnt > max) return false;
    const velha = ant2;
    ant2 = ant;
    ant = atual;
    atual = velha;
    minAnt = minAtual;
  }
  return ant[lb]! <= max;
}
let LINHA_A = new Int32Array(64);
let LINHA_B = new Int32Array(64);
let LINHA_C = new Int32Array(64);

/** Medidas e códigos (com dígito) só casam exatos (usado pelo ranking e pelo índice de pré-seleção). */
export const soCasaExato = (q: string): boolean => /\d/.test(q) || MEDIDA_RE.test(q);
/** Erros de digitação aceitos para a palavra (4 a 7 letras: 1; 8 ou mais: 2; menos de 4: nenhum). */
export const toleranciaDaPalavra = (q: string): number => (q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0);

/** Quanto a palavra da consulta casa com um termo do campo: exato 1; prefixo (3+ letras) 0,7; erro de digitação 0,5. */
export function nivelDaPalavra(q: string, termo: string): number {
  if (q === termo) return NIVEL.exato;
  if (soCasaExato(q)) return 0; // medidas e códigos só casam exatos
  if (q.length >= 3 && termo.length > q.length && termo.startsWith(q)) return NIVEL.prefixo;
  if (q.length >= 4) {
    const tolerancia = toleranciaDaPalavra(q);
    // T-0052-B4: a distância é no mínimo a diferença de tamanho; evita montar a matriz para quase todos os termos
    if (Math.abs(q.length - termo.length) <= tolerancia && dentroDaDistancia(q, termo, tolerancia)) return NIVEL.digitacao;
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
  /** RN-CAT-12: todo grupo que casou só casou no campo Aplicação (nenhum no nome, código, marca, categoria ou atributos). */
  so_aplicacao: boolean;
  /** RN-CAT-09: índice (em `doc.referencias`) da referência cruzada que casou com a consulta, ou nulo. */
  referencia_casada: number | null;
}

export interface OpcoesPontuacao {
  /** RN-CAT-12: `peso_aplicacao` do tenant (padrão 0,5). */
  pesoAplicacao?: number;
  /** Ano civil no fuso do tenant (relógio injetado, ADR 0015): expande as faixas da aplicação. */
  anoAtual?: number;
}

const SEM_PONTOS = (total: number): PontuacaoTextual => ({ pontos: 0, casados: 0, total, so_aplicacao: false, referencia_casada: null });

/** RN-CAT-09: primeira referência cujo código casa exato com um termo da consulta (cru ou compacto). */
function referenciaCasada(grupos: readonly (readonly string[])[], referencias: readonly Referencia[]): number | null {
  if (referencias.length === 0) return null;
  const termos = new Set<string>();
  for (const g of grupos) for (const alt of g) termos.add(alt);
  const ngramas = codigosDaConsulta(grupos.map((g) => g[0] ?? '').join(' '));
  for (let i = 0; i < referencias.length; i++) {
    const cod = codigoCompacto(referencias[i]!.codigo);
    if (cod && (termos.has(cod) || ngramas.includes(cod))) return i;
    const toks = tokensDeBusca(referencias[i]!.codigo);
    if (toks.length > 0 && (toks.every((t) => termos.has(t)) || toks.some((t) => /\d/.test(t) && termos.has(t)))) return i;
  }
  return null;
}

/** Pontuação textual de um documento para os grupos de alternativas da consulta (ver `expandirSinonimos`). */
export function pontuacaoTextual(grupos: readonly (readonly string[])[], doc: DocBusca, opcoes: OpcoesPontuacao = {}): PontuacaoTextual {
  if (grupos.length === 0) return SEM_PONTOS(0);
  const referencias = doc.referencias ?? [];
  const tk = doc.tokens ?? tokensDoDoc(doc);
  const campos: { termos: string[]; peso: number }[] = [
    { termos: tk.nome, peso: PESO_CAMPO.nome },
    { termos: tk.codigo, peso: PESO_CAMPO.codigo },
    { termos: tk.marca, peso: PESO_CAMPO.marca },
    { termos: tk.categoria, peso: PESO_CAMPO.categoria },
    { termos: tk.atributos, peso: PESO_CAMPO.atributos },
  ];
  // RN-CAT-12: sem aplicação o campo nem entra (resultado e custo iguais aos de antes)
  const aplicacao = doc.aplicacao ?? '';
  const pesoAplicacao = opcoes.pesoAplicacao ?? PESO_CAMPO.aplicacao;
  const anoAtual = opcoes.anoAtual ?? 0;
  const temAnoNaConsulta = grupos.some((g) => g.some((alt) => ANO_RE.test(alt)));
  const outros = grupos.map((g) => {
    let m = 0;
    for (const alt of g) for (const c of campos) m = Math.max(m, melhorNivel(alt, c.termos) * c.peso);
    return m;
  });
  let refMemo: number | null | undefined;
  const refCasada = () => (refMemo === undefined ? (refMemo = referenciaCasada(grupos, referencias)) : refMemo);
  const montar = (soma: number, casados: number, casadosSoAplicacao: number, casouPalavra: boolean): PontuacaoTextual => {
    // número solto ("50") não basta para o produto ser relevante quando a consulta também tem palavras
    const temPalavra = grupos.some((g) => g.some((alt) => /[a-z]/.test(alt)));
    const s = temPalavra && !casouPalavra ? 0 : soma;
    return { pontos: arred6(s / grupos.length), casados, total: grupos.length, so_aplicacao: casados > 0 && casadosSoAplicacao === casados, referencia_casada: refCasada() };
  };
  /** `termosApl` nulo = sem campo aplicação. `exigirAno`: o ano da consulta tem de cair nos anos desse trecho. */
  const avaliar = (termosApl: TermosAplicacao | null, anosApl: number[], exigirAno: boolean): PontuacaoTextual | null => {
    let soma = 0;
    let casados = 0;
    let casadosSoAplicacao = 0;
    let casouPalavra = false;
    for (let gi = 0; gi < grupos.length; gi++) {
      const grupo = grupos[gi]!;
      const melhorOutros = outros[gi]!;
      let melhor = melhorOutros;
      if (termosApl) {
        let melhorAplicacao = 0;
        for (const alt of grupo) melhorAplicacao = Math.max(melhorAplicacao, melhorNivelAplicacao(alt, termosApl) * pesoAplicacao);
        melhor = Math.max(melhor, melhorAplicacao);
        // RN-CAT-12: ano da consulta que a aplicação (com anos) não cobre tira o produto, salvo se casar em outro campo
        const anosDoGrupo = grupo.filter((alt) => ANO_RE.test(alt));
        if (exigirAno && melhorOutros === 0 && anosDoGrupo.length > 0 && !anosDoGrupo.some((a) => anosApl.includes(Number(a)))) return null;
      }
      if (melhor > 0) {
        casados++;
        if (melhorOutros === 0) casadosSoAplicacao++;
        if (grupo.some((alt) => /[a-z]/.test(alt))) casouPalavra = true;
      }
      soma += melhor;
    }
    return montar(soma, casados, casadosSoAplicacao, casouPalavra);
  };

  if (aplicacao === '') return avaliar(null, [], false)!;
  // atalho: se todo termo já casa nos outros campos com nota >= à máxima possível da aplicação (o peso), ela não muda nada
  // (nem a nota, nem `so_aplicacao`, nem o filtro de ano, que só vale onde os outros campos zeram): mesmo resultado, sem analisar
  if (outros.every((o) => o > 0 && o >= pesoAplicacao)) return avaliar(null, [], false)!;
  const analise = analisarAplicacao(doc.id, aplicacao, anoAtual, temAnoNaConsulta);
  const trechos = temAnoNaConsulta ? analise.trechos : undefined;
  if (!trechos) {
    return avaliar(analise.todos, analise.anos, analise.anos.length > 0) ?? SEM_PONTOS(grupos.length);
  }
  // RN-CAT-12 (T-0084-A4): com ano na consulta, veículo/modelo e ano têm de casar no MESMO trecho (separado por ";")
  // quais grupos cada trecho cobre: calculado uma vez (antes era refeito para cada trecho × cada outro trecho)
  const soAplicacao = grupos.map((g, gi) => outros[gi] === 0 && !g.some((alt) => ANO_RE.test(alt)));
  const casa = trechos.map((t) => grupos.map((g, gi) => soAplicacao[gi]! && g.some((alt) => melhorNivelAplicacao(alt, t.termos) > 0)));
  const emAlgumTrecho = grupos.map((_, gi) => casa.some((c) => c[gi]));
  let melhorResultado: PontuacaoTextual | null = null;
  for (let ti = 0; ti < trechos.length; ti++) {
    const t = trechos[ti]!;
    // termo que só a aplicação cobre (em algum trecho) tem de estar neste trecho, senão o texto seria montado de trechos diferentes
    if (grupos.some((_, gi) => soAplicacao[gi]! && !casa[ti]![gi]! && emAlgumTrecho[gi])) continue;
    const r = avaliar(t.termos, t.anos, true);
    if (r && (melhorResultado === null || r.pontos > melhorResultado.pontos)) melhorResultado = r;
  }
  return melhorResultado ?? SEM_PONTOS(grupos.length);
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
  /** Veio do código exato (SKU/EAN/referência cruzada). */
  exato: boolean;
  /** RN-CAT-12: casou só pela aplicação; na ordenação por relevância vem depois de quem casou pelo nome. */
  so_aplicacao: boolean;
  /** RN-CAT-09: índice da referência cruzada que casou ("Equivale a"), ou nulo. */
  referencia_casada: number | null;
}

export interface EntradaRanking {
  filtros: FiltrosInterpretados;
  sinonimos: readonly SinonimoDoTenant[];
  parametros: ParametrosCatalogo;
  /** Nota semântica 0..1 por id de produto (quando há busca vetorial). Se o mapa tem alguma nota, quem não tem leva 0. */
  semantica?: ReadonlyMap<string, number>;
  /** Ano civil no fuso do tenant (relógio injetado, ADR 0015): expande as faixas de anos da aplicação. */
  anoAtual: number;
  /** T-0119: maior `vendas` do universo completo, quando `docs` já veio pré-selecionado (normaliza o boost sem mudar a nota). */
  maxVendas?: number;
}

const mesmaChave = (a: string, b: string) => chaveDeTermo(a) === chaveDeTermo(b);

/** Forma compacta de um código (`PAS-DIA-150` → `pasdia150`): só letras e dígitos, sem acento nem caixa (T-0052-B1). */
export function codigoCompacto(s: string | null | undefined): string {
  return s ? semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

export function casaComCodigo(d: Pick<DocBusca, 'ean' | 'sku'> & { referencias?: DocBusca['referencias'] | undefined }, code: NonNullable<FiltrosInterpretados['code']>): boolean {
  if (code.type === 'ean') return d.ean === code.value;
  const v = codigoCompacto(code.value);
  return d.ean === code.value || (v !== '' && (codigoCompacto(d.sku) === v || (d.referencias ?? []).some((r) => codigoCompacto(r.codigo) === v)));
}

/** Filtros estruturados (RN-CAT-01): marca, categoria, faixa de preço e estoque. O código é tratado à parte. */
export function casaComFiltros(d: Pick<DocBusca, 'marca' | 'categoria' | 'preco_cents' | 'estoque'>, f: FiltrosInterpretados): boolean {
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

/** RN-CAT-09: referência cruzada cujo código compacto é o código/n-grama da consulta. */
function referenciaPorCodigo(doc: DocBusca, filtros: FiltrosInterpretados, ngramas: readonly string[]): number | null {
  const alvos = new Set<string>(ngramas);
  if (filtros.code) alvos.add(codigoCompacto(filtros.code.value));
  const i = (doc.referencias ?? []).findIndex((r) => alvos.has(codigoCompacto(r.codigo)));
  return i >= 0 ? i : null;
}

/** Chave do nome para o desempate; calculada uma vez por objeto (o sort comparava o mesmo nome dezenas de vezes). */
const CHAVE_DO_NOME = new WeakMap<object, string>();
export const nomeChave = (d: Pick<DocBusca, 'nome'>): string => {
  let k = CHAVE_DO_NOME.get(d);
  if (k === undefined) {
    k = semAcento(d.nome).toLowerCase();
    CHAVE_DO_NOME.set(d, k);
  }
  return k;
};
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

  // RN-CAT-09: n-grama da consulta que bate com o SKU ou com uma referência cruzada também deixa o produto exato
  const ngramas = comTexto ? codigosDaConsulta(filtros.text) : [];
  if (ngramas.length > 0) {
    for (const d of candidatos) {
      if (ngramas.includes(codigoCompacto(d.sku)) || (d.referencias ?? []).some((r) => ngramas.includes(codigoCompacto(r.codigo)))) exatos.add(d.id);
    }
  }

  const maxVendas = entrada.maxVendas ?? candidatos.reduce((m, d) => Math.max(m, d.vendas), 0);
  const itens: ItemRankeado[] = [];
  for (const doc of candidatos) {
    const pt = pontuacaoTextual(grupos, doc, { pesoAplicacao: p.peso_aplicacao, anoAtual: entrada.anoAtual });
    const textual = pt.pontos;
    const semantica = comSemantica ? (entrada.semantica!.get(doc.id) ?? 0) : null;
    const exato = exatos.has(doc.id);
    const base = exato ? 1 : comTexto || comSemantica ? combinarNotas(textual, semantica, p.peso_semantico) : 1;
    const nota = notaFinal(base, { estoque: doc.estoque, vendas_norm: maxVendas > 0 ? doc.vendas / maxVendas : 0, campanha: doc.campanha }, p);
    if (nota > 0) itens.push({ doc, nota, textual, semantica, exato, so_aplicacao: pt.so_aplicacao && !exato, referencia_casada: pt.referencia_casada ?? (exato ? referenciaPorCodigo(doc, filtros, ngramas) : null) });
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
      Number(a.so_aplicacao) - Number(b.so_aplicacao) ||
      b.nota - a.nota ||
      b.textual - a.textual ||
      Number(b.doc.estoque > 0) - Number(a.doc.estoque > 0) ||
      b.doc.vendas - a.doc.vendas ||
      cmp(nomeChave(a.doc), nomeChave(b.doc)) ||
      cmp(a.doc.id, b.doc.id)
    );
  });
}
