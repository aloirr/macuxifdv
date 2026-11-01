/**
 * Trava de inativação em massa da carga completa (RN-INT-06; confirmada pelo Alexandre em 2026-10-31): se a carga fosse inativar
 * mais de [30%] dos ativos, nada é inativado e o operador decide no BKO. Aqui: quais ativos entram na conta, a pendência de
 * confirmação (com validade) e o que o Conector lê no resultado do último lote da sessão. A conta em si é `calcularInativacao`.
 */
import type { InativacaoLote } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';
import type { ResultadoInativacao } from './sessao';

export interface AtivoVisto {
  external_id: string;
  /** Último instante em que o Hub aceitou uma linha deste registro (qualquer lote). */
  visto_em: string;
}

/**
 * Só é candidato a inativação o ativo que NÃO foi visto depois do início da sessão: um registro criado no ERP durante a carga
 * chega pelo delta, está ativo e não está na sessão — inativá-lo seria um erro.
 */
export function filtrarAtivosElegiveis(ativos: readonly AtivoVisto[], sessaoIniciadaEm: string): string[] {
  const inicio = Date.parse(sessaoIniciadaEm);
  return ativos.filter((a) => Date.parse(a.visto_em) < inicio).map((a) => a.external_id);
}

export const AMOSTRA_MAX = 50;

export type EstadoPendencia = 'aguardando' | 'confirmada' | 'recusada' | 'expirada';

export interface Pendencia {
  id: string;
  sessao_id: string;
  entidade: string;
  conector_id: string;
  lote_id: string;
  estado: EstadoPendencia;
  candidatos: number;
  total_ativos: number;
  percentual: number;
  limite_pct: number;
  amostra: string[];
  criada_em: string;
  expira_em: string;
  decidida_em: string | null;
}

export interface ContextoPendencia {
  id: string;
  sessao_id: string;
  entidade: string;
  conector_id: string;
  lote_id: string;
  agora: string;
  totalAtivos: number;
  limitePct?: number;
  ttlDias?: number;
}

const pct = (parte: number, total: number): number => (total === 0 ? 0 : Math.round((parte / total) * 10_000) / 100);
const somarDias = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();

/** Cria a pendência a partir de um `calcularInativacao` que negou por `excede_limite_inativacao`. */
export function criarPendencia(r: ResultadoInativacao, ctx: ContextoPendencia): Pendencia {
  if (r.motivo !== 'excede_limite_inativacao' || !r.candidatos) {
    throw new Error(`Pendência de inativação só nasce de excede_limite_inativacao (motivo recebido: ${String(r.motivo)}).`);
  }
  return {
    id: ctx.id,
    sessao_id: ctx.sessao_id,
    entidade: ctx.entidade,
    conector_id: ctx.conector_id,
    lote_id: ctx.lote_id,
    estado: 'aguardando',
    candidatos: r.candidatos.length,
    total_ativos: ctx.totalAtivos,
    percentual: pct(r.candidatos.length, ctx.totalAtivos),
    limite_pct: ctx.limitePct ?? PARAMETROS_PADRAO.limiteInativacaoPct,
    amostra: r.candidatos.slice(0, AMOSTRA_MAX),
    criada_em: ctx.agora,
    expira_em: somarDias(ctx.agora, ctx.ttlDias ?? PARAMETROS_PADRAO.ttlConfirmacaoInativacaoDias),
    decidida_em: null,
  };
}

/** `aguardando` vira `expirada` quando passa a validade (padrão 7 dias). */
export function situacaoPendencia(p: Pendencia, agora: string): EstadoPendencia {
  if (p.estado === 'aguardando' && Date.parse(agora) >= Date.parse(p.expira_em)) return 'expirada';
  return p.estado;
}

export type ResultadoDecisao =
  | { ok: true; pendencia: Pendencia; reavaliarComConfirmacao: boolean }
  | { ok: false; codigo: 'pendencia_expirada' | 'pendencia_ja_decidida'; mensagem: string };

/**
 * Confirmar pede à API para reavaliar com `confirmado: true` (a lista atual de ativos, não a de quando a pendência nasceu);
 * recusar encerra sem inativar. Decidir de novo ou depois da validade é recusado.
 */
export function decidirPendencia(p: Pendencia, acao: 'confirmar' | 'recusar', agora: string): ResultadoDecisao {
  const situacao = situacaoPendencia(p, agora);
  if (situacao === 'confirmada' || situacao === 'recusada') {
    return { ok: false, codigo: 'pendencia_ja_decidida', mensagem: `Esta inativação já foi ${situacao === 'confirmada' ? 'confirmada' : 'recusada'}. Nada a fazer.` };
  }
  if (situacao === 'expirada') {
    return { ok: false, codigo: 'pendencia_expirada', mensagem: 'A confirmação venceu. Peça ao Conector uma nova carga completa da entidade (conector carga-completa) para decidir de novo.' };
  }
  const confirmar = acao === 'confirmar';
  return { ok: true, reavaliarComConfirmacao: confirmar, pendencia: { ...p, estado: confirmar ? 'confirmada' : 'recusada', decidida_em: agora } };
}

/** O que o Conector lê em `LoteResultado.inativacao` no último lote da sessão. `null` = lote delta ou parte que não fecha a sessão. */
export function resultadoInativacaoDoLote(r: ResultadoInativacao | null, totalAtivos: number): InativacaoLote {
  if (r === null) return { situacao: 'nao_aplicavel', motivo: null, candidatos: 0, percentual: 0 };
  if (r.permitido) return { situacao: 'aplicada', motivo: null, candidatos: r.inativar.length, percentual: pct(r.inativar.length, totalAtivos) };
  if (r.motivo === 'excede_limite_inativacao') {
    const n = r.candidatos?.length ?? 0;
    return { situacao: 'aguardando_confirmacao', motivo: r.motivo, candidatos: n, percentual: pct(n, totalAtivos) };
  }
  return { situacao: 'nao_aplicavel', motivo: r.motivo, candidatos: 0, percentual: 0 };
}
