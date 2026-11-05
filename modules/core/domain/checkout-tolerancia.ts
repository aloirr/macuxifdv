/**
 * RN-CORE-12 (complemento T-0039, 05/11): tolerância às etapas de OUTROS módulos no checkout.
 * Regras do Core (resultado, motivo da lista do tenant, foto da fachada) continuam recusando. Etapa obrigatória de outro
 * módulo não concluída no servidor = checkout aceito com pendência; cliente fechado (RN-CORE-14) dispensa, sem pendência.
 */
import { CHECKOUT_PENDENCIA_ALERTA_H_PADRAO, CheckoutPendenciaAlertaHSchema, type SituacaoVisitaEtapa } from '../contracts/etapas-pendencia';
import { avaliarCheckoutNoServidor, type CodigoRecusaCheckout, type EntradaCheckoutNoServidor, type VerificacaoEtapaServidor } from './checkout-servidor';

export interface EtapaRegistroTolerante {
  modulo: string;
  etapa: string;
  rotulo: string;
  situacao: SituacaoVisitaEtapa;
}

export type DecisaoCheckoutTolerante =
  | { decisao: 'recusar'; codigo: CodigoRecusaCheckout; pendencias: string[]; etapasRegistro: []; etapasPendentes: 0 }
  | { decisao: 'aceitar'; codigo: null; pendencias: []; etapasRegistro: EtapaRegistroTolerante[]; etapasPendentes: 0 }
  | { decisao: 'aceitar_com_pendencias'; codigo: null; pendencias: []; etapasRegistro: EtapaRegistroTolerante[]; etapasPendentes: number };

export function avaliarCheckoutTolerante(e: EntradaCheckoutNoServidor): DecisaoCheckoutTolerante {
  // etapas de outros módulos não entram na recusa: avalia só as regras do Core
  const neutras: VerificacaoEtapaServidor[] = e.verificacoes.map((v) => ({ ...v, concluida: true }));
  const core = avaliarCheckoutNoServidor({ ...e, verificacoes: neutras });
  if (!core.pode) return { decisao: 'recusar', codigo: core.codigo ?? 'RN-CORE-12', pendencias: core.pendencias, etapasRegistro: [], etapasPendentes: 0 };

  const fechado = e.resultadoInformado === 'cliente_fechado';
  const etapasRegistro: EtapaRegistroTolerante[] = [];
  for (const v of e.verificacoes) {
    if (v.concluida) etapasRegistro.push({ modulo: v.modulo, etapa: v.etapa, rotulo: v.rotulo, situacao: 'concluida' });
    else if (v.obrigatoria) etapasRegistro.push({ modulo: v.modulo, etapa: v.etapa, rotulo: v.rotulo, situacao: fechado ? 'dispensada' : 'pendente' });
  }
  const etapasPendentes = etapasRegistro.filter((r) => r.situacao === 'pendente').length;
  if (etapasPendentes === 0) return { decisao: 'aceitar', codigo: null, pendencias: [], etapasRegistro, etapasPendentes: 0 };
  return { decisao: 'aceitar_com_pendencias', codigo: null, pendencias: [], etapasRegistro, etapasPendentes };
}

export interface LinhaVisitaEtapa {
  visitaId: string;
  modulo: string;
  etapa: string;
  situacao: SituacaoVisitaEtapa;
}

export interface EntradaBaixaPendencia {
  /** Linhas atuais de `visita_etapa`. */
  linhas: readonly LinhaVisitaEtapa[];
  /** Evento recebido (`pesquisa.resposta.registrada@1`): visita (pode ser nula) e módulo mapeado do evento. */
  visitaId: string | null;
  modulo: string;
  referenciaId: string;
  /** Resultado da RECONSULTA `<modulo>.etapas_checkout@1` feita após o evento. */
  reconsulta: readonly Pick<VerificacaoEtapaServidor, 'etapa' | 'concluida'>[];
  agora: string;
}

export interface ResultadoBaixa {
  baixar: { etapa: string; referenciaId: string; resolvidaEm: string }[];
  /** Pendentes que restam na visita (para `visita.etapas_pendentes`). */
  etapasPendentes: number;
}

/** RN-CORE-12: a resposta registrada baixa a pendência só se a reconsulta disser concluída; idempotente; sem linha pendente = nada. */
export function baixarPendenciasPorEvento(e: EntradaBaixaPendencia): ResultadoBaixa {
  const da = e.visitaId ? e.linhas.filter((l) => l.visitaId === e.visitaId) : [];
  const baixar: ResultadoBaixa['baixar'] = [];
  for (const l of da) {
    if (l.situacao !== 'pendente' || l.modulo !== e.modulo) continue;
    if (e.reconsulta.some((r) => r.etapa === l.etapa && r.concluida)) baixar.push({ etapa: l.etapa, referenciaId: e.referenciaId, resolvidaEm: e.agora });
  }
  const restam = da.filter((l) => l.situacao === 'pendente' && !(l.modulo === e.modulo && baixar.some((b) => b.etapa === l.etapa))).length;
  return { baixar, etapasPendentes: restam };
}

/** Prazo do alerta: inteiro 1..168; inválido/ausente cai no padrão (24 h). */
export function prazoAlertaPendenciaH(valor: unknown): number {
  const r = CheckoutPendenciaAlertaHSchema.safeParse(valor);
  return r.success ? r.data : CHECKOUT_PENDENCIA_ALERTA_H_PADRAO;
}

export interface EntradaAlertaPendencia {
  situacao: SituacaoVisitaEtapa;
  pendenteDesde: string | null;
  alertadaEm: string | null;
  agora: string;
  prazoH?: unknown;
}

/** RN-CORE-12: pendente há pelo menos o prazo e ainda não alertada (uma notificação por pendência). Chamar após reconsulta. */
export function pendenciaViraAlerta(e: EntradaAlertaPendencia): boolean {
  if (e.situacao !== 'pendente' || e.alertadaEm || !e.pendenteDesde) return false;
  const desde = Date.parse(e.pendenteDesde);
  const agora = Date.parse(e.agora);
  if (Number.isNaN(desde) || Number.isNaN(agora)) return false;
  return agora - desde >= prazoAlertaPendenciaH(e.prazoH) * 3_600_000;
}

export interface EntradaTextoAlertaPendencia {
  destinatario: 'vendedor' | 'supervisor';
  /** Rótulo da consulta, já completo (ex.: Pesquisa obrigatória: "Gôndola do mês"). */
  rotulo: string;
  clienteNome: string;
  /** Instante da visita (UTC); a data sai em dd/mm no fuso do tenant. */
  visitaEm: string;
  fusoTenant: string;
  /** Nome do vendedor; só o primeiro nome entra no texto do supervisor. */
  vendedorNome?: string;
  /** Prazo do alerta em horas (só supervisor); inválido cai no padrão. */
  prazoH?: unknown;
}

/** Primeiro nome de um nome completo. */
function primeiroNome(nome: string | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/** RN-CORE-12 (docs/design/checkout-pendencia.md §1.3 e §2.1): título e corpo da notificação, sem ponto final. */
export function textoAlertaPendencia(e: EntradaTextoAlertaPendencia): { titulo: string; corpo: string } {
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: e.fusoTenant, day: '2-digit', month: '2-digit' }).format(new Date(e.visitaEm));
  if (e.destinatario === 'supervisor') {
    const vendedor = primeiroNome(e.vendedorNome);
    return {
      titulo: vendedor ? `Etapa pendente na visita de ${vendedor} a ${e.clienteNome}` : `Etapa pendente na visita a ${e.clienteNome}`,
      corpo: `${e.rotulo} · visita de ${data} · não chegou em ${prazoAlertaPendenciaH(e.prazoH)} h`,
    };
  }
  return {
    titulo: `Etapa pendente na visita a ${e.clienteNome}`,
    corpo: `${e.rotulo} · visita de ${data} · confira a fila do aparelho ou fale com seu supervisor`,
  };
}
