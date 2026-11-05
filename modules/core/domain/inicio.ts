/**
 * Regras do Início do Campo e do Gestão (RN-CORE-26; T-0073 §1.5 e §3.2). Funções puras: o aparelho (offline) e a API fazem a mesma conta.
 * Sem relógio, sem GPS e sem expediente: quem chama passa `agora` e `hoje` (dia civil no fuso do tenant).
 */
import { formatHHMM, zonedParts } from '@macuxi/comum/fuso';
import type { Perfil } from '@macuxi/platform-sdk';
import type { MembroAgoraContrato, StatusAgoraContrato, VisaoInicio } from '../contracts/inicio';

/** Frase padrão do sistema quando o tenant não definiu `inicio.recado_do_dia_padrao`. */
export const RECADO_DO_DIA_PADRAO = 'Bom trabalho hoje!';
/** Padrão do parâmetro `inicio.parado_min`. */
export const PARADO_MIN_PADRAO = 60;

export interface NotificacaoParaRecado {
  id: string;
  usuario_id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  /** Dia civil (fuso do tenant) em que o recado vale; null = não marcado. */
  recado_do_dia?: string | null;
  expira_em?: string | null;
  updated_at: string;
  deleted_at?: string | null;
  autor_nome?: string | null;
  autor_perfil?: Perfil | null;
}

export type RecadoDoDia = VisaoInicio['recado'];

/**
 * RN-CORE-26: recado do dia = recado do próprio usuário, vivo, não expirado, marcado para `hoje`; vários = o de `updated_at` mais novo.
 * Sem nenhum, a frase padrão do tenant (ou "Bom trabalho hoje!").
 */
export function recadoDoDia(notificacoes: readonly NotificacaoParaRecado[], o: { usuario_id: string; hoje: string; agora: Date; padrao?: string | null }): RecadoDoDia {
  const agora = o.agora.getTime();
  const candidatas = notificacoes
    .filter((n) => n.usuario_id === o.usuario_id && n.tipo === 'recado' && !n.deleted_at && n.recado_do_dia === o.hoje && !(n.expira_em && new Date(n.expira_em).getTime() <= agora))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  const n = candidatas[0];
  if (n) return { origem: 'recado', texto: n.corpo, titulo: n.titulo, autor_nome: n.autor_nome ?? null, autor_perfil: n.autor_perfil ?? null, notificacao_id: n.id };
  const padrao = o.padrao?.trim();
  return { origem: 'padrao', texto: padrao ? padrao : RECADO_DO_DIA_PADRAO, titulo: null, autor_nome: null, autor_perfil: null, notificacao_id: null };
}

export type StatusAgora = StatusAgoraContrato;
export type MembroAgora = MembroAgoraContrato;

export interface VisitaDoDia {
  usuario_id: string;
  cliente_id: string;
  data_local: string;
  checkin_em: string;
  checkout_em?: string | null;
  deleted_at?: string | null;
}
export interface ParadaDoDia {
  usuario_id: string;
  cliente_id: string;
  data: string;
  deleted_at?: string | null;
}

const ORDEM_STATUS: Record<StatusAgora, number> = { parado: 0, sem_checkin: 1, em_rota: 2, em_visita: 3, rota_concluida: 4 };

/**
 * RN-CORE-26 (equipe agora), por pessoa, só com as linhas de `hoje`:
 * em_visita = há visita sem checkout; sem_checkin = nenhuma visita; rota_concluida = sem visita aberta e todas as paradas com check-in
 * (ou sem parada planejada e já houve visita); parado = sem visita aberta, com parada pendente e ≥ `parado_min` minutos desde o último
 * checkout; em_rota = o mesmo caso, com menos que isso. Ordem: parado, sem_checkin, em_rota, em_visita, rota_concluida, depois o nome.
 */
export function equipeAgora(e: {
  hoje: string;
  agora: Date;
  parado_min: number;
  membros: ReadonlyArray<{ usuario_id: string; nome: string; vendas_hoje_cents: number | null }>;
  visitas: ReadonlyArray<VisitaDoDia>;
  paradas: ReadonlyArray<ParadaDoDia>;
}): MembroAgora[] {
  const lista = e.membros.map((m): MembroAgora => {
    const visitas = e.visitas.filter((v) => v.usuario_id === m.usuario_id && !v.deleted_at && v.data_local === e.hoje);
    const paradas = e.paradas.filter((p) => p.usuario_id === m.usuario_id && !p.deleted_at && p.data === e.hoje);
    const clientesVisitados = new Set(visitas.map((v) => v.cliente_id));
    const planejados = new Set(paradas.map((p) => p.cliente_id));
    const comum = { usuario_id: m.usuario_id, nome: m.nome, paradas_hoje: planejados.size, visitadas_hoje: [...planejados].filter((c) => clientesVisitados.has(c)).length, vendas_hoje_cents: m.vendas_hoje_cents };
    const abertas = visitas.filter((v) => !v.checkout_em).sort((a, b) => (a.checkin_em < b.checkin_em ? 1 : -1));
    if (abertas[0]) return { ...comum, status: 'em_visita', desde: abertas[0].checkin_em, cliente_id: abertas[0].cliente_id, minutos_sem_atividade: null };
    if (visitas.length === 0) return { ...comum, status: 'sem_checkin', desde: null, cliente_id: null, minutos_sem_atividade: null };
    const ultimoCheckout = visitas.map((v) => v.checkout_em as string).sort().at(-1) as string;
    const pendentes = [...planejados].filter((c) => !clientesVisitados.has(c)).length;
    if (pendentes === 0) return { ...comum, status: 'rota_concluida', desde: ultimoCheckout, cliente_id: null, minutos_sem_atividade: null };
    const minutos = Math.max(0, Math.floor((e.agora.getTime() - new Date(ultimoCheckout).getTime()) / 60_000));
    return { ...comum, status: minutos >= e.parado_min ? 'parado' : 'em_rota', desde: ultimoCheckout, cliente_id: null, minutos_sem_atividade: minutos };
  });
  return lista.sort((a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "Bom dia" (0h–11h59, exceto madrugada), "Boa tarde" (12h–17h59), "Boa noite" (18h–4h59), no fuso do tenant (T-0076). */
export function saudacaoDoDia(agora: Date, fuso: string): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const h = zonedParts(agora, fuso).hour;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export interface RecadoDaCaixa {
  id: string;
  titulo: string;
  corpo: string;
  tipo: string;
  updated_at: string;
  lida: boolean;
  link: string | null;
}
export type RecadosDeHoje = NonNullable<VisaoInicio['recados_hoje']>;

/**
 * T-0076 (RF-CORE-09): "Recados de hoje" = as 3 primeiras da caixa (já ordenada: não lidas, alta prioridade, mais novas) com o
 * recado do dia (RN-CORE-26) sempre em primeiro e destacado; "N novos" = todas as não lidas da caixa.
 */
export function recadosDeHoje(caixa: readonly RecadoDaCaixa[], recadoDoDiaId: string | null, fuso: string): RecadosDeHoje {
  const destaque = recadoDoDiaId ? caixa.find((n) => n.id === recadoDoDiaId) : undefined;
  const ordem = destaque ? [destaque, ...caixa.filter((n) => n.id !== destaque.id)] : [...caixa];
  return {
    novos: caixa.filter((n) => !n.lida).length,
    itens: ordem.slice(0, 3).map((n) => ({ id: n.id, titulo: n.titulo, subtitulo: n.corpo, tipo: n.tipo, criada_em: n.updated_at, hora: formatHHMM(n.updated_at, fuso), lida: n.lida, link: n.link, destaque: n.id === destaque?.id })),
  };
}
