/**
 * Portas de IA do Catálogo (provedor de LLM e de embeddings atrás de interface, doc 04) e a orquestração pura
 * da interpretação da consulta: regras locais primeiro, LLM por cima (quando permitido e online), validação
 * do que o LLM devolveu (RN-CAT-01) e contingência para as regras em qualquer falha.
 * As implementações reais das portas ficam em `modules/catalogo/api/ia/`; nos testes entram fakes.
 */
import { FiltrosInterpretados } from '../contracts';
import { gtinValido, interpretarConsulta, type VocabularioTenant } from './consulta';
import { consomeCotaIa, type DesfechoIa } from './limite-ia';
import { chaveDeTermo, tokensDeBusca } from './texto';

// ---------- portas ----------
export interface EntradaInterpretacao {
  tenant_id: string;
  texto: string;
  /** Vocabulário do tenant que o LLM pode usar (marcas e categorias cadastradas). */
  marcas: string[];
  linhas: string[];
}

/** Porta do LLM que converte a frase em filtros. Devolve JSON no formato `FiltrosInterpretados` (sempre revalidado). */
export interface PortaInterpretacaoLlm {
  /** `opcoes.signal`: cancelamento do chamador (ex.: o app desistiu); a implementação soma ao seu tempo limite. */
  interpretar(entrada: EntradaInterpretacao, opcoes?: { signal?: AbortSignal }): Promise<unknown>;
}

/** Porta do LLM do "Pergunte ao catálogo" (ver `pergunte.ts`). */
export interface PortaRespostaLlm {
  responder(entrada: { tenant_id: string; instrucao: string; mensagem: string }): Promise<unknown>;
}

/** Porta de embeddings (modelo multilíngue). A busca vetorial usa as notas devolvidas em `rankear({ semantica })`. */
export interface PortaEmbeddings {
  gerar(textos: readonly string[]): Promise<number[][]>;
}

/** Erro que a porta usa para tempo esgotado no provedor (RN-CAT-03: não consome). */
export class ErroTempoEsgotadoIa extends Error {
  constructor(mensagem = 'O provedor de IA não respondeu a tempo.') {
    super(mensagem);
    this.name = 'ErroTempoEsgotadoIa';
  }
}

/** Classifica a falha da porta (o tempo limite é da implementação em api/ia/, via AbortSignal.timeout): tempo esgotado (nosso erro, `TimeoutError`/`AbortError` do fetch) ou erro. */
export function classificarFalhaIa(erro: unknown): 'erro' | 'tempo_esgotado' {
  if (erro instanceof ErroTempoEsgotadoIa) return 'tempo_esgotado';
  const nome = erro instanceof Error ? erro.name : '';
  return nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo_esgotado' : 'erro';
}

// ---------- avisos (português, com a ação seguinte) ----------
export const AVISO_BUSCA_OFFLINE = 'A busca inteligente volta quando houver internet.';
/** Aviso discreto da aba Catálogo enquanto o aparelho refaz o índice de busca (T-0088); a busca segue por varredura. */
export const AVISO_CATALOGO_ORGANIZANDO = 'Organizando o catálogo no aparelho…';
export const AVISO_BUSCA_FALHOU = 'A busca inteligente está indisponível agora. Mostramos a busca simples; tente de novo em instantes.';

// ---------- validação e mesclagem ----------
/**
 * Valida a resposta do LLM: formato Zod; marca e categoria só valem se existirem no vocabulário do tenant
 * (volta a grafia cadastrada); EAN só com dígito verificador correto. Formato inválido ⇒ `null`.
 */
export function validarFiltrosLlm(bruto: unknown, vocabulario: VocabularioTenant): FiltrosInterpretados | null {
  const r = FiltrosInterpretados.safeParse(bruto);
  if (!r.success) return null;
  const f = r.data;
  const achar = (lista: readonly string[], valor: string | null) => (valor === null ? null : (lista.find((x) => chaveDeTermo(x) === chaveDeTermo(valor)) ?? null));
  return {
    ...f,
    text: tokensDeBusca(f.text).join(' '),
    brand: achar(vocabulario.marcas, f.brand),
    line: achar(vocabulario.linhas, f.line),
    code: f.code && (f.code.type === 'sku' || gtinValido(f.code.value)) ? f.code : null,
  };
}

/** Regras locais vencem no que a frase diz de forma explícita; o LLM completa o que faltou. */
export function mesclarFiltros(regras: FiltrosInterpretados, llm: FiltrosInterpretados): FiltrosInterpretados {
  const min = regras.min_price_cents ?? llm.min_price_cents;
  const max = regras.max_price_cents ?? llm.max_price_cents;
  const faixaOk = min === null || max === null || min <= max;
  const llmTemFiltro = llm.brand !== null || llm.line !== null || llm.stock !== null || llm.min_price_cents !== null || llm.max_price_cents !== null || llm.sort !== null;
  return FiltrosInterpretados.parse({
    text: llm.text !== '' ? llm.text : llmTemFiltro ? '' : regras.text,
    brand: regras.brand ?? llm.brand,
    line: regras.line ?? llm.line,
    min_price_cents: faixaOk ? min : regras.min_price_cents,
    max_price_cents: faixaOk ? max : regras.max_price_cents,
    stock: regras.stock ?? llm.stock,
    code: regras.code ?? llm.code,
    measures: [...new Set([...regras.measures, ...llm.measures])],
    sort: regras.sort ?? llm.sort,
  });
}

// ---------- orquestração ----------
export interface EntradaInterpretarBusca {
  tenant_id: string;
  texto: string;
  vocabulario: VocabularioTenant;
  /** `null` = sem provedor configurado (ou app offline). */
  porta: PortaInterpretacaoLlm | null;
  online: boolean;
  /** Resultado de `verificarConsultaIa` (RN-CAT-03; não consome). */
  ia: { permitido: boolean; mensagem: string | null };
  /** Cancelamento do chamador, repassado à porta (que o combina com o tempo limite). */
  signal?: AbortSignal;
}

export interface ResultadoInterpretacao {
  filtros: FiltrosInterpretados;
  origem: 'llm' | 'regras';
  /** Aviso discreto para a tela (offline, limite, falha); nulo quando tudo certo. */
  aviso: string | null;
  /** O provedor foi chamado (com ou sem resposta). */
  chamouProvedor: boolean;
  /** RN-CAT-03: o que aconteceu com a tentativa; passe para `registrarDesfechoIa`. */
  desfecho: DesfechoIa;
  /** RN-CAT-03: true só quando o provedor respondeu (`desfecho = respondida`). */
  consomeCota: boolean;
}

/**
 * Interpreta a consulta. Nunca lança por falha do provedor: cai para as regras locais e avisa.
 * Ordem na API: cache (não consome) → `verificarConsultaIa` → esta função → `registrarDesfechoIa(desfecho)`.
 */
export async function interpretarBusca(e: EntradaInterpretarBusca): Promise<ResultadoInterpretacao> {
  const regras = interpretarConsulta(e.texto, e.vocabulario);
  const semChamar = (aviso: string | null): ResultadoInterpretacao => ({ filtros: regras, origem: 'regras', aviso, chamouProvedor: false, desfecho: 'nao_chamada', consomeCota: false });
  if (!e.online) return semChamar(AVISO_BUSCA_OFFLINE);
  if (!e.ia.permitido) return semChamar(e.ia.mensagem);
  if (!e.porta) return semChamar(null);

  let bruto: unknown;
  try {
    bruto = await e.porta.interpretar({ tenant_id: e.tenant_id, texto: e.texto, marcas: [...e.vocabulario.marcas], linhas: [...e.vocabulario.linhas] }, e.signal ? { signal: e.signal } : undefined);
  } catch (erro) {
    const desfecho = classificarFalhaIa(erro);
    return { filtros: regras, origem: 'regras', aviso: AVISO_BUSCA_FALHOU, chamouProvedor: true, desfecho, consomeCota: consomeCotaIa(desfecho) };
  }
  const respondida = { chamouProvedor: true, desfecho: 'respondida' as const, consomeCota: true };
  const validado = validarFiltrosLlm(bruto, e.vocabulario);
  if (!validado) return { filtros: regras, origem: 'regras', aviso: AVISO_BUSCA_FALHOU, ...respondida };
  return { filtros: mesclarFiltros(regras, validado), origem: 'llm', aviso: null, ...respondida };
}

/**
 * Campos de `ResultadoBusca` (contrato) que vêm da interpretação: quem interpretou, se a busca está degradada
 * (offline, limite ou falha do provedor, incluindo tempo esgotado — RN-CAT-03) e o aviso discreto da tela.
 * Falha do provedor ⇒ `interpreted_by = regras`, `degraded = true` e `notice` em português; nunca erro para o usuário.
 */
export function resumoDaInterpretacao(r: Pick<ResultadoInterpretacao, 'origem' | 'aviso'>): { interpreted_by: 'llm' | 'regras'; degraded: boolean; notice: string | null } {
  return { interpreted_by: r.origem, degraded: r.aviso !== null, notice: r.aviso };
}
