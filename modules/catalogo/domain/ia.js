/**
 * Portas de IA do Catálogo (provedor de LLM e de embeddings atrás de interface, doc 04) e a orquestração pura
 * da interpretação da consulta: regras locais primeiro, LLM por cima (quando permitido e online), validação
 * do que o LLM devolveu (RN-CAT-01) e contingência para as regras em qualquer falha.
 * As implementações reais das portas ficam em `modules/catalogo/api/ia/`; nos testes entram fakes.
 */
import { FiltrosInterpretados } from '../contracts';
import { gtinValido, interpretarConsulta } from './consulta';
import { consomeCotaIa } from './limite-ia';
import { chaveDeTermo, tokensDeBusca } from './texto';
/** Erro que a porta usa para tempo esgotado no provedor (RN-CAT-03: não consome). */
export class ErroTempoEsgotadoIa extends Error {
    constructor(mensagem = 'O provedor de IA não respondeu a tempo.') {
        super(mensagem);
        this.name = 'ErroTempoEsgotadoIa';
    }
}
/** Classifica a falha da porta (o tempo limite é da implementação em api/ia/, via AbortSignal.timeout): tempo esgotado (nosso erro, `TimeoutError`/`AbortError` do fetch) ou erro. */
export function classificarFalhaIa(erro) {
    if (erro instanceof ErroTempoEsgotadoIa)
        return 'tempo_esgotado';
    const nome = erro instanceof Error ? erro.name : '';
    return nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo_esgotado' : 'erro';
}
// ---------- avisos (português, com a ação seguinte) ----------
export const AVISO_BUSCA_OFFLINE = 'A busca inteligente volta quando houver internet.';
/** Aviso discreto da aba Catálogo enquanto o aparelho refaz o índice de busca (T-0088); a busca segue por varredura. */
export const AVISO_CATALOGO_ORGANIZANDO = 'Organizando o catálogo no aparelho. A busca pode demorar um pouco por alguns instantes.';
const FRASE_ORGANIZANDO_JUNTO = 'Organizando o catálogo no aparelho; a busca pode demorar um pouco.';
/**
 * Aviso final da busca (T-0088): junta numa frase só o aviso de sem sinal/falha com o de índice sendo refeito. Sem
 * `indexando` devolve o aviso como veio (some quando o índice fica pronto). Antes o "organizando" só valia com aviso nulo,
 * caso que a aba nunca produz com termo de busca (código morto).
 */
export function avisoDaBusca(aviso, indexando) {
    if (!indexando)
        return aviso;
    return aviso ? `${aviso} ${FRASE_ORGANIZANDO_JUNTO}` : AVISO_CATALOGO_ORGANIZANDO;
}
/** Ícone do aviso da aba: relógio só no 'organizando'; sem sinal = wifiOff; qualquer outro (erro) = alert. */
export function iconeDoAviso(aviso) {
    if (aviso.startsWith(AVISO_BUSCA_OFFLINE))
        return 'wifiOff';
    if (aviso === AVISO_CATALOGO_ORGANIZANDO)
        return 'clock';
    return 'alert';
}
export const AVISO_BUSCA_FALHOU = 'A busca inteligente está indisponível agora. Mostramos a busca simples; tente de novo em instantes.';
// ---------- validação e mesclagem ----------
/**
 * Valida a resposta do LLM: formato Zod; marca e categoria só valem se existirem no vocabulário do tenant
 * (volta a grafia cadastrada); EAN só com dígito verificador correto. Formato inválido ⇒ `null`.
 */
export function validarFiltrosLlm(bruto, vocabulario) {
    const r = FiltrosInterpretados.safeParse(bruto);
    if (!r.success)
        return null;
    const f = r.data;
    const achar = (lista, valor) => (valor === null ? null : (lista.find((x) => chaveDeTermo(x) === chaveDeTermo(valor)) ?? null));
    return {
        ...f,
        text: tokensDeBusca(f.text).join(' '),
        brand: achar(vocabulario.marcas, f.brand),
        line: achar(vocabulario.linhas, f.line),
        code: f.code && (f.code.type === 'sku' || gtinValido(f.code.value)) ? f.code : null,
    };
}
/** Regras locais vencem no que a frase diz de forma explícita; o LLM completa o que faltou. */
export function mesclarFiltros(regras, llm) {
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
/**
 * Interpreta a consulta. Nunca lança por falha do provedor: cai para as regras locais e avisa.
 * Ordem na API: cache (não consome) → `verificarConsultaIa` → esta função → `registrarDesfechoIa(desfecho)`.
 */
export async function interpretarBusca(e) {
    const regras = interpretarConsulta(e.texto, e.vocabulario);
    const semChamar = (aviso) => ({ filtros: regras, origem: 'regras', aviso, chamouProvedor: false, desfecho: 'nao_chamada', consomeCota: false });
    if (!e.online)
        return semChamar(AVISO_BUSCA_OFFLINE);
    if (!e.ia.permitido)
        return semChamar(e.ia.mensagem);
    if (!e.porta)
        return semChamar(null);
    let bruto;
    try {
        bruto = await e.porta.interpretar({ tenant_id: e.tenant_id, texto: e.texto, marcas: [...e.vocabulario.marcas], linhas: [...e.vocabulario.linhas] }, e.signal ? { signal: e.signal } : undefined);
    }
    catch (erro) {
        const desfecho = classificarFalhaIa(erro);
        return { filtros: regras, origem: 'regras', aviso: AVISO_BUSCA_FALHOU, chamouProvedor: true, desfecho, consomeCota: consomeCotaIa(desfecho) };
    }
    const respondida = { chamouProvedor: true, desfecho: 'respondida', consomeCota: true };
    const validado = validarFiltrosLlm(bruto, e.vocabulario);
    if (!validado)
        return { filtros: regras, origem: 'regras', aviso: AVISO_BUSCA_FALHOU, ...respondida };
    return { filtros: mesclarFiltros(regras, validado), origem: 'llm', aviso: null, ...respondida };
}
/**
 * Campos de `ResultadoBusca` (contrato) que vêm da interpretação: quem interpretou, se a busca está degradada
 * (offline, limite ou falha do provedor, incluindo tempo esgotado — RN-CAT-03) e o aviso discreto da tela.
 * Falha do provedor ⇒ `interpreted_by = regras`, `degraded = true` e `notice` em português; nunca erro para o usuário.
 */
export function resumoDaInterpretacao(r) {
    return { interpreted_by: r.origem, degraded: r.aviso !== null, notice: r.aviso };
}
