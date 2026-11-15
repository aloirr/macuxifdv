/**
 * Lembretes locais de produtividade no Campo (T-0180, D4/D6; RN-CORE-26, RN-CORE-44; RF-CORE-17). Função pura: a partir da rota do dia,
 * das visitas locais (já com a fila aplicada), da fila de envio, do horário de almoço e dos parâmetros `alertas.produtividade`,
 * devolve a agenda do dia. O aparelho a recalcula ao abrir, a cada sync e a cada check-in ou check-out, e cancela o que sair dela.
 *
 * Regras (um lembrete por tipo e ocasião; cada um tem um `id` estável):
 * - só vendedor e promotor; só em dia útil; só dentro do horário comercial (antes da abertura sobe para a abertura; depois do fechamento não sai);
 * - o "parado" vale com ou sem rota;
 * - ordem de prioridade: sem check-in, fim do almoço, parado, rota incompleta, visita aberta, envio pendente;
 * - teto por pessoa por dia (`teto_lembretes_dia`, padrão 4): o que já saiu hoje conta; passou do teto, não agenda mais;
 * - rota incompleta não sai se o "parado" disparou na última hora;
 * - o que já passou da hora não sai atrasado (aparelho desligado na hora perde o lembrete), exceto o envio pendente: com o limite
 *   (`apos_h`, padrão 4 h) já vencido ao abrir o app, inclusive item de ontem, sai 1 min depois de agora (ou na abertura, se ainda não abriu), dentro do teto e da prioridade.
 * Textos: título curto e o corpo "Próxima visita: <cliente>." igual em todos (sem próxima visita, só o título). Vai só para a bandeja do aparelho.
 */
import { HORARIO_COMERCIAL_PADRAO, type ParametrosAlertasProdutividade } from '../contracts/alertas-produtividade';
import type { HorarioAlmoco } from '../contracts/jornada';
import { textoDoMinuto } from '../contracts/jornada';

export type TipoLembrete = 'sem_checkin_inicio' | 'fim_almoco' | 'parado_entre_visitas' | 'rota_incompleta' | 'visita_aberta' | 'envio_pendente';

/** Ordem de prioridade para o teto. */
export const PRIORIDADE_LEMBRETES: readonly TipoLembrete[] = ['sem_checkin_inicio', 'fim_almoco', 'parado_entre_visitas', 'rota_incompleta', 'visita_aberta', 'envio_pendente'];


export interface ParadaDaRotaLembrete {
  cliente_id: string;
  cliente_nome: string;
  sequencia: number;
}
/** Visita local do dia (do pull ou da fila). Instantes em UTC. */
export interface VisitaDoLembrete {
  cliente_id: string;
  checkin_em: string;
  checkout_em?: string | null;
  deleted_at?: string | null;
}
export interface LembreteDoDia {
  /** Estável: o mesmo fato gera o mesmo id; o aparelho troca o agendado e não repete o que já saiu. */
  id: string;
  tipo: TipoLembrete;
  /** Instante em UTC (ISO) em que a notificação deve aparecer. */
  em: string;
  titulo: string;
  /** "Próxima visita: <cliente>."; ausente sem rota. */
  corpo?: string;
}

export interface EntradaLembretes {
  agora: Date;
  /** Início do dia local (00:00) em UTC (ISO): base dos horários em minutos do dia. */
  inicio_do_dia_em: string;
  perfil: string;
  dia_util: boolean;
  horario_comercial?: { inicio_min: number; fim_min: number };
  parametros: ParametrosAlertasProdutividade;
  /** `inicio.parado_min` (RN-CORE-26). */
  parado_min: number;
  almoco: HorarioAlmoco;
  paradas: readonly ParadaDaRotaLembrete[];
  visitas: readonly VisitaDoLembrete[];
  /** Itens da fila de envio ainda não enviados (instante em que entraram na fila, UTC). */
  fila: readonly { criado_em: string }[];
  /** O que já saiu hoje neste aparelho (conta no teto e vale para a regra do "parado na última hora"). */
  enviados: readonly { id: string; em: string }[];
}

const MIN = 60_000;
const ms = (iso: string) => new Date(iso).getTime();

/** "1 h", "45 min", "1 h 30 min". */
export function duracaoCurta(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Soma `minutos` a `ref` sem contar o tempo de almoço (RN-CORE-44: o horário cadastrado). */
export function somarSemAlmoco(refMs: number, minutos: number, almocoMs: { inicio: number; fim: number }): number {
  const fimSimples = refMs + minutos * MIN;
  if (refMs >= almocoMs.fim || fimSimples <= almocoMs.inicio) return fimSimples;
  if (refMs >= almocoMs.inicio) return almocoMs.fim + minutos * MIN;
  return fimSimples + (almocoMs.fim - almocoMs.inicio);
}

type Candidato = LembreteDoDia & { emMs: number };

/** A agenda de lembretes do dia, em ordem de horário; vazia para quem não é de campo, fora de dia útil ou com tudo desligado. */
export function agendaDeLembretes(e: EntradaLembretes): LembreteDoDia[] {
  if ((e.perfil !== 'vendedor' && e.perfil !== 'promotor') || !e.dia_util) return [];
  const p = e.parametros;
  const base = ms(e.inicio_do_dia_em);
  const noDia = (min: number) => base + min * MIN;
  const com = e.horario_comercial ?? HORARIO_COMERCIAL_PADRAO;
  const abre = noDia(com.inicio_min);
  const fecha = noDia(com.fim_min);
  const agora = e.agora.getTime();

  const visitas = e.visitas.filter((v) => !v.deleted_at && ms(v.checkin_em) >= base && ms(v.checkin_em) < base + 24 * 60 * MIN);
  const feitos = new Set(visitas.map((v) => v.cliente_id));
  const pendentes = [...e.paradas].filter((x) => !feitos.has(x.cliente_id)).sort((a, b) => a.sequencia - b.sequencia);
  const aberta = visitas.filter((v) => !v.checkout_em);
  const corpoDe = (excluir?: string): string | undefined => {
    const prox = pendentes.find((x) => x.cliente_id !== excluir);
    return prox ? `Próxima visita: ${prox.cliente_nome}.` : undefined;
  };
  const almoco = { inicio: noDia(e.almoco.inicio_min), fim: noDia(e.almoco.fim_min) };

  const candidatos: Candidato[] = [];
  const add = (tipo: TipoLembrete, id: string, emMs: number, titulo: string, corpo?: string) =>
    candidatos.push({ id, tipo, em: new Date(emMs).toISOString(), emMs, titulo, ...(corpo ? { corpo } : {}) });

  // sem check-in até o horário (RF-GES-07): nenhuma visita no dia
  if (p.sem_checkin_inicio.ativa && p.sem_checkin_inicio.vendedor && visitas.length === 0) {
    add('sem_checkin_inicio', `sem_checkin_inicio:${e.inicio_do_dia_em}`, noDia(p.sem_checkin_inicio.ate_min), 'Nenhuma visita hoje', corpoDe());
  }

  // fim do almoço: só com ao menos um check-in, fora de visita aberta e sem check-in depois do início do almoço
  const voltouAntes = visitas.some((v) => ms(v.checkin_em) > almoco.inicio);
  if (p.fim_almoco.ativa && p.fim_almoco.vendedor && visitas.length > 0 && aberta.length === 0 && !voltouAntes) {
    add('fim_almoco', `fim_almoco:${e.inicio_do_dia_em}`, almoco.fim - p.fim_almoco.antecedencia_min * MIN, `Seu almoço termina às ${textoDoMinuto(e.almoco.fim_min)}`, corpoDe());
  }

  // parado entre visitas: depois do 1º check-in e sem visita aberta, com ou sem rota (sem próxima visita, só o título); não conta o almoço
  const checkouts = visitas.filter((v) => v.checkout_em).map((v) => ms(v.checkout_em!));
  const ultimoCheckout = checkouts.length > 0 ? Math.max(...checkouts) : null;
  let paradoEm: number | null = null;
  if (p.parado_entre_visitas.ativa && p.parado_entre_visitas.vendedor && visitas.length > 0 && aberta.length === 0 && ultimoCheckout !== null) {
    paradoEm = somarSemAlmoco(ultimoCheckout, e.parado_min, almoco);
    add('parado_entre_visitas', `parado_entre_visitas:${new Date(ultimoCheckout).toISOString()}`, paradoEm, `Há ${duracaoCurta(e.parado_min)} sem visita`, corpoDe());
  }

  // rota incompleta: clientes da rota sem visita; não sai se o "parado" disparou na última hora
  if (p.rota_incompleta.ativa && p.rota_incompleta.vendedor && pendentes.length > 0) {
    const quando = noDia(p.rota_incompleta.as_min);
    const paradosDaHora = [...candidatos.filter((c) => c.tipo === 'parado_entre_visitas').map((c) => c.emMs), ...e.enviados.filter((x) => x.id.startsWith('parado_entre_visitas:')).map((x) => ms(x.em))];
    if (!paradosDaHora.some((t) => t <= quando && quando - t < 60 * MIN)) {
      add('rota_incompleta', `rota_incompleta:${e.inicio_do_dia_em}`, quando, pendentes.length === 1 ? 'Falta 1 cliente da rota' : `Faltam ${pendentes.length} clientes da rota`, corpoDe());
    }
  }

  // visita aberta há mais de N min (um por visita)
  if (p.visita_aberta.ativa && p.visita_aberta.vendedor) {
    for (const v of aberta) add('visita_aberta', `visita_aberta:${v.cliente_id}:${v.checkin_em}`, ms(v.checkin_em) + p.visita_aberta.apos_min * MIN, `Visita aberta há ${duracaoCurta(p.visita_aberta.apos_min)}`, corpoDe(v.cliente_id));
  }

  // envio pendente: o item mais antigo da fila passou do limite
  if (p.envio_pendente.ativa && p.envio_pendente.vendedor && e.fila.length > 0) {
    const maisAntigo = Math.min(...e.fila.map((x) => ms(x.criado_em)));
    const n = e.fila.length;
    // limite já vencido (item de ontem ou de antes, ou app aberto depois): sai no próximo momento válido do dia, 1 min depois de agora
    const limite = maisAntigo + p.envio_pendente.apos_h * 60 * MIN;
    add('envio_pendente', `envio_pendente:${e.inicio_do_dia_em}`, limite > agora ? limite : agora + MIN, n === 1 ? '1 registro sem enviar' : `${n} registros sem enviar`, corpoDe());
  }

  // horário comercial, hora que já passou e teto do dia
  const jaSairam = new Set(e.enviados.map((x) => x.id));
  const restante = Math.max(0, p.teto_lembretes_dia - e.enviados.length);
  const ordem = (c: Candidato) => PRIORIDADE_LEMBRETES.indexOf(c.tipo);
  return candidatos
    .map((c) => ({ ...c, emMs: Math.max(c.emMs, abre) }))
    .filter((c) => c.emMs <= fecha && c.emMs > agora && !jaSairam.has(c.id))
    .sort((a, b) => ordem(a) - ordem(b) || a.emMs - b.emMs)
    .slice(0, restante)
    .sort((a, b) => a.emMs - b.emMs)
    .map(({ emMs, ...c }) => ({ ...c, em: new Date(emMs).toISOString() }));
}
