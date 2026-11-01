/**
 * Trava de inativação em massa da carga completa (RN-INT-06; confirmada pelo Alexandre em 2026-10-31): se a carga fosse inativar
 * mais de [30%] dos ativos, nada é inativado e o operador decide no BKO. Aqui: quais ativos entram na conta, a pendência de
 * confirmação (com validade) e o que o Conector lê no resultado do último lote da sessão. A conta em si é `calcularInativacao`.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import type { InativacaoLote } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';
import { autorizarAcaoIntegracao } from './permissoes';
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
  /** Usuário (uuid) que confirmou ou recusou (P-3: admin ou analista). `null` enquanto aguarda. */
  decidida_por: string | null;
  /** Perfil de quem decidiu, no momento da decisão. */
  decidida_por_perfil: Perfil | null;
  /** Motivo opcional informado no BKO. */
  motivo_decisao: string | null;
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
    decidida_por: null,
    decidida_por_perfil: null,
    motivo_decisao: null,
  };
}

/** `aguardando` vira `expirada` quando passa a validade (padrão 7 dias). */
export function situacaoPendencia(p: Pendencia, agora: string): EstadoPendencia {
  if (p.estado === 'aguardando' && Date.parse(agora) >= Date.parse(p.expira_em)) return 'expirada';
  return p.estado;
}

/** Quem está decidindo no BKO (vem da sessão do usuário; a API não confia no corpo da requisição). */
export interface AutorDecisao {
  usuario_id: string;
  perfil: Perfil;
}

/**
 * Registro de auditoria de cada decisão (P-3; RN-INT-06): quem, quando, lote, quantidade. Gravado na MESMA transação da decisão
 * (tabela `integracao.inativacao_auditoria`, pedido ao banco-dados; formato público: `AuditoriaInativacao` em contracts/bko.ts) — sem auditoria não há decisão. Sem dado pessoal: só uuids,
 * perfil, contagens e o motivo digitado (até 300 caracteres).
 */
export interface RegistroAuditoriaInativacao {
  pendencia_id: string;
  sessao_id: string;
  lote_id: string;
  entidade: string;
  conector_id: string;
  acao: 'confirmar' | 'recusar';
  decidida_por: string;
  perfil: Perfil;
  decidida_em: string;
  /** Quantos registros a pendência inativaria (o que o operador viu ao decidir). */
  quantidade: number;
  total_ativos: number;
  percentual: number;
  motivo: string | null;
}

export type ResultadoDecisao =
  | { ok: true; pendencia: Pendencia; reavaliarComConfirmacao: boolean; auditoria: RegistroAuditoriaInativacao }
  | { ok: false; status: 403; codigo: 'perfil_sem_acesso'; mensagem: string }
  | { ok: false; status: 422; codigo: 'pendencia_expirada' | 'pendencia_ja_decidida'; mensagem: string };

/**
 * P-3: confirmar ou recusar é de **admin ou analista** (supervisor, vendedor e os demais: 403 `perfil_sem_acesso`), sempre com a
 * auditoria (quem, quando, lote, quantidade). Confirmar pede à API para reavaliar com `confirmado: true` (a lista atual de ativos,
 * não a de quando a pendência nasceu); recusar encerra sem inativar. Decidir de novo ou depois da validade é recusado (422).
 */
export function decidirPendencia(
  p: Pendencia,
  acao: 'confirmar' | 'recusar',
  agora: string,
  autor: AutorDecisao,
  motivo?: string | null,
): ResultadoDecisao {
  const permissao = autorizarAcaoIntegracao('inativacao.decidir', autor.perfil);
  if (!permissao.ok) return permissao;
  const situacao = situacaoPendencia(p, agora);
  if (situacao === 'confirmada' || situacao === 'recusada') {
    return { ok: false, status: 422, codigo: 'pendencia_ja_decidida', mensagem: `Esta inativação já foi ${situacao === 'confirmada' ? 'confirmada' : 'recusada'}. Nada a fazer.` };
  }
  if (situacao === 'expirada') {
    return { ok: false, status: 422, codigo: 'pendencia_expirada', mensagem: 'A confirmação venceu. Peça ao Conector uma nova carga completa da entidade (conector carga-completa) para decidir de novo.' };
  }
  const confirmar = acao === 'confirmar';
  const motivoDecisao = motivo?.trim() ? motivo.trim().slice(0, 300) : null;
  const pendencia: Pendencia = {
    ...p,
    estado: confirmar ? 'confirmada' : 'recusada',
    decidida_em: agora,
    decidida_por: autor.usuario_id,
    decidida_por_perfil: autor.perfil,
    motivo_decisao: motivoDecisao,
  };
  const auditoria: RegistroAuditoriaInativacao = {
    pendencia_id: p.id,
    sessao_id: p.sessao_id,
    lote_id: p.lote_id,
    entidade: p.entidade,
    conector_id: p.conector_id,
    acao,
    decidida_por: autor.usuario_id,
    perfil: autor.perfil,
    decidida_em: agora,
    quantidade: p.candidatos,
    total_ativos: p.total_ativos,
    percentual: p.percentual,
    motivo: motivoDecisao,
  };
  return { ok: true, reavaliarComConfirmacao: confirmar, pendencia, auditoria };
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
