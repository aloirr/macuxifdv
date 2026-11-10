/**
 * Tabela escalonada (RN-VEN-23; T-0089): faixas de preço por quantidade. O Catálogo é dono do preço (ADR 0005) e só
 * entrega as faixas VIGENTES de cada produto; quem aplica a faixa ao item (maior mínimo ≤ quantidade, menor entre a
 * tabela e a faixa) é o domain do Vendedor. Funções puras: a API (SQL) e o aparelho (linhas locais) carregam os dados e
 * chamam estas funções, então decidem igual.
 */
import type { FaixaEscalonada } from '../contracts';
import { FUSO_PADRAO_ANO } from './ano-civil';

/** Linha da tabela escalonada (API e aparelho). Vigência em data civil AAAA-MM-DD do fuso do tenant, fechada nas duas pontas. */
export interface LinhaEscalonada {
  produto_id: string;
  /** Sigla da medida; nulo = unidade base. */
  medida: string | null;
  quantidade_minima: number;
  /** Preço da UNIDADE BASE (P3). */
  preco_unidade_cents: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  /** Nulo = vale para todas as tabelas de preço. */
  tabela_preco_id: string | null;
  ativo: boolean;
  /** RN-CORE-39: filial da faixa; nulo ou ausente = vale para todas as filiais. */
  filial_id?: string | null;
}

const formatadores = new Map<string, Intl.DateTimeFormat | null>();
function formatadorDoFuso(fuso: string): Intl.DateTimeFormat | null {
  if (!formatadores.has(fuso)) {
    try {
      formatadores.set(fuso, new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }));
    } catch {
      formatadores.set(fuso, null);
    }
  }
  return formatadores.get(fuso)!;
}

/** Data civil AAAA-MM-DD do instante no `fuso`; fuso ausente ou inválido cai em America/Manaus e, sem Intl, no UTC. */
export function dataCivilNoFuso(instante: Date | string, fuso?: string | null): string {
  const data = typeof instante === 'string' ? new Date(instante) : instante;
  if (Number.isNaN(data.getTime())) throw new RangeError('Informe o instante em ISO 8601 UTC.');
  const f = formatadorDoFuso(fuso ?? FUSO_PADRAO_ANO) ?? formatadorDoFuso(FUSO_PADRAO_ANO);
  if (f) {
    const partes = Object.fromEntries(f.formatToParts(data).map((p) => [p.type, p.value]));
    if (partes.year && partes.month && partes.day) return `${partes.year}-${partes.month}-${partes.day}`;
  }
  return data.toISOString().slice(0, 10);
}

/** RN-VEN-23: vigente = ativa e `início ≤ hoje ≤ fim` (fim nulo = aberta); `hoje` é a data civil no fuso do tenant. */
export function faixaVigente(l: Pick<LinhaEscalonada, 'ativo' | 'vigencia_inicio' | 'vigencia_fim'>, hoje: string): boolean {
  return l.ativo && l.vigencia_inicio <= hoje && (l.vigencia_fim === null || l.vigencia_fim >= hoje);
}

/**
 * RN-VEN-23: faixas vigentes do produto para o cliente. Entram as da tabela do cliente e as gerais (tabela nula); na mesma
 * (medida, quantidade mínima) a da tabela do cliente vence a geral e, na mesma origem, a de início mais recente. Ordem:
 * unidade base primeiro, depois as medidas em ordem alfabética, cada uma por quantidade mínima.
 */
export function faixasDoProduto(linhas: readonly LinhaEscalonada[], e: { produtoId: string; tabelaId: string | null; hoje: string; filialId?: string | null }): FaixaEscalonada[] {
  const escolhidas = new Map<string, LinhaEscalonada>();
  const melhor = (a: LinhaEscalonada, b: LinhaEscalonada): LinhaEscalonada => {
    const aEspecifica = a.tabela_preco_id !== null;
    const bEspecifica = b.tabela_preco_id !== null;
    if (aEspecifica !== bEspecifica) return aEspecifica ? a : b;
    // RN-CORE-39: na mesma origem de tabela, a faixa da filial do preço vence a geral (filial nula = todas)
    const aFilial = (a.filial_id ?? null) !== null;
    const bFilial = (b.filial_id ?? null) !== null;
    if (aFilial !== bFilial) return aFilial ? a : b;
    if (a.vigencia_inicio !== b.vigencia_inicio) return a.vigencia_inicio > b.vigencia_inicio ? a : b;
    return a.preco_unidade_cents <= b.preco_unidade_cents ? a : b;
  };
  for (const l of linhas) {
    if (l.produto_id !== e.produtoId || !faixaVigente(l, e.hoje)) continue;
    if (l.tabela_preco_id !== null && l.tabela_preco_id !== e.tabelaId) continue;
    // RN-CORE-39: faixa de outra filial não vale; sem filial informada (chamador antigo), só as gerais
    if ((l.filial_id ?? null) !== null && l.filial_id !== (e.filialId ?? null)) continue;
    const chave = `${l.medida ?? ''}|${String(l.quantidade_minima)}`;
    const atual = escolhidas.get(chave);
    escolhidas.set(chave, atual ? melhor(atual, l) : l);
  }
  return [...escolhidas.values()]
    .sort((a, b) => (a.medida ?? '').localeCompare(b.medida ?? '') || a.quantidade_minima - b.quantidade_minima)
    .map((l) => ({ medida: l.medida, quantidade_minima: l.quantidade_minima, preco_unidade_cents: l.preco_unidade_cents }));
}

const DATA_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;
function dataValida(v: string): boolean {
  const m = DATA_CIVIL.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

export interface EntradaFaixa {
  medida: string | null;
  quantidade_minima: number;
  preco_unidade_cents: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
}
export type ResultadoFaixa = { ok: true } | { ok: false; campo: keyof EntradaFaixa; mensagem: string };

/** RN-VEN-23: o que o cadastro da faixa (BKO e API) aceita. A API revalida com esta mesma função. */
export function validarFaixa(f: EntradaFaixa): ResultadoFaixa {
  if (f.medida !== null && !/^[A-Z]{1,4}$/.test(f.medida)) return { ok: false, campo: 'medida', mensagem: 'Use a sigla da medida com 1 a 4 letras maiúsculas, ou deixe em branco para a unidade base.' };
  if (!Number.isInteger(f.quantidade_minima) || f.quantidade_minima < 1) return { ok: false, campo: 'quantidade_minima', mensagem: 'A quantidade mínima deve ser um número inteiro maior que zero.' };
  if (!Number.isInteger(f.preco_unidade_cents) || f.preco_unidade_cents < 1) return { ok: false, campo: 'preco_unidade_cents', mensagem: 'O preço da faixa deve ser maior que zero.' };
  if (!dataValida(f.vigencia_inicio)) return { ok: false, campo: 'vigencia_inicio', mensagem: 'Informe o início da vigência como data válida (AAAA-MM-DD).' };
  if (f.vigencia_fim !== null && !dataValida(f.vigencia_fim)) return { ok: false, campo: 'vigencia_fim', mensagem: 'Informe o fim da vigência como data válida (AAAA-MM-DD) ou deixe em branco.' };
  if (f.vigencia_fim !== null && f.vigencia_fim < f.vigencia_inicio) return { ok: false, campo: 'vigencia_fim', mensagem: 'O fim da vigência não pode ser anterior ao início.' };
  return { ok: true };
}

/** P4: faixa com preço maior que o da tabela não sobe o preço no pedido; o BKO avisa quem cadastrou. */
export function faixaMaisCaraQueATabela(precoFaixaCents: number, precoTabelaCents: number | null): boolean {
  return precoTabelaCents !== null && precoFaixaCents > precoTabelaCents;
}

/** Chave de unicidade da faixa viva (a mesma do índice `tabela_escalonada_faixa_uk`). */
export function chaveDaFaixa(f: { produto_id: string; medida: string | null; quantidade_minima: number; tabela_preco_id: string | null; vigencia_inicio: string }): string {
  return [f.produto_id, f.medida ?? '', String(f.quantidade_minima), f.tabela_preco_id ?? '', f.vigencia_inicio].join('|');
}

/** RN-VEN-23: mensagem de conflito quando outra faixa viva tem a mesma chave; nulo se livre. A API checa antes de gravar. */
export function conflitoDeFaixa(id: string, nova: { produto_id: string; medida: string | null; quantidade_minima: number; tabela_preco_id: string | null; vigencia_inicio: string }, existentes: readonly (typeof nova & { id: string })[]): string | null {
  const chave = chaveDaFaixa(nova);
  return existentes.some((e) => e.id !== id && chaveDaFaixa(e) === chave)
    ? 'Já existe uma faixa para este produto, medida, quantidade mínima, tabela e início de vigência. Edite a existente ou mude o início.'
    : null;
}
