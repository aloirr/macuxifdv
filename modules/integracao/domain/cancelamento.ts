/**
 * Cancelamento do pedido devolvido ao ERP (T-0114; exceção da RN-INT-08 / RN-VEN-31). Funções puras.
 *
 * O Vendedor publica `vendedor.pedido.cancelado@1`. O Hub decide por pedido:
 *  - ainda não entregue ao Conector → sai da fila (como na saída de `aprovado`);
 *  - já entregue e o Conector aceita cancelamento → fica `cancelamento_estado = 'pendente'` e sai em `GET /pedidos/pendentes`
 *    (campo `cancelamentos`, aditivo na v1); o Conector executa no ERP e a CONFIRMAÇÃO é o retorno `cancelado` que já existe;
 *  - já entregue e o Conector não aceita → nada muda (o ERP continua sendo quem avisa o cancelamento).
 * O ERP pode RECUSAR o cancelamento pedido (retorno `cancelamento_recusado`, T-0114): o cancelamento passa a `recusado`, o pedido
 * segue como estava e o monitor alerta (`cancelamento_recusado`); um `cancelado` posterior (o ERP cancelou por conta própria) confirma.
 * Idempotência: pelo pedido (um pedido só tem um cancelamento) e pelo evento (`evento_consumo`, ADR 0007).
 */
import type { CancelamentoParaErp, EstadoPedidoErp } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

export type EstadoCancelamento = 'pendente' | 'enviado' | 'confirmado' | 'recusado';

/** Recorte da linha da fila que importa ao cancelamento. */
export interface PedidoParaCancelar {
  pedido_uuid: string;
  estado: EstadoPedidoErp;
  tentativas: number;
  numero_erp: string | null;
  removido_em: string | null;
  cancelamento_estado: EstadoCancelamento | null;
  cancelamento_motivo: string | null;
  cancelamento_solicitado_em: string | null;
  cancelamento_enviado_em: string | null;
  cancelamento_tentativas: number;
}

export type DecisaoCancelamento =
  | { acao: 'remover_da_fila' }
  | { acao: 'solicitar_ao_erp'; motivo: string | null }
  | { acao: 'ignorar'; motivo: 'fora_da_fila' | 'conector_nao_aceita' | 'ja_solicitado' | 'estado_final' };

const MOTIVO_MAX = 500;

export function decidirCancelamento(e: { existente: PedidoParaCancelar | null; aceitaCancelamento: boolean; motivo: string | null }): DecisaoCancelamento {
  const p = e.existente;
  if (p === null || p.removido_em !== null) return { acao: 'ignorar', motivo: 'fora_da_fila' };
  if (p.cancelamento_estado !== null) return { acao: 'ignorar', motivo: 'ja_solicitado' };
  if (p.estado === 'cancelado' || p.estado === 'rejeitado_erp' || p.estado === 'faturado_total') return { acao: 'ignorar', motivo: 'estado_final' };
  // `pendente` com tentativas = 0 nunca foi ao Conector; com tentativas > 0 voltou por timeout mas o Conector já o tem
  if (p.estado === 'pendente' && p.tentativas === 0) return { acao: 'remover_da_fila' };
  if (!e.aceitaCancelamento) return { acao: 'ignorar', motivo: 'conector_nao_aceita' };
  const motivo = e.motivo?.trim() ? e.motivo.trim().slice(0, MOTIVO_MAX) : null;
  return { acao: 'solicitar_ao_erp', motivo };
}

export interface AtualizacaoEntregaCancelamento {
  pedido_uuid: string;
  cancelamento_enviado_em: string;
  cancelamento_tentativas: number;
}

export interface SelecaoCancelamentos {
  entregar: CancelamentoParaErp[];
  atualizacoes: AtualizacaoEntregaCancelamento[];
}

/** Cancelamentos pendentes (e `enviado` sem confirmação no prazo) por ordem de solicitação; cada entrega conta uma tentativa. */
export function selecionarCancelamentos(fila: readonly PedidoParaCancelar[], agora: string, opcoes: { limite?: number; timeoutMin?: number } = {}): SelecaoCancelamentos {
  const limite = opcoes.limite ?? PARAMETROS_PADRAO.pedidosPorConsulta;
  const timeoutMs = (opcoes.timeoutMin ?? PARAMETROS_PADRAO.timeoutEnvioMin) * 60_000;
  const candidatos = fila
    .filter((p) => p.removido_em === null && p.cancelamento_solicitado_em !== null && p.estado !== 'cancelado')
    .filter((p) => {
      if (p.cancelamento_estado === 'pendente') return true;
      if (p.cancelamento_estado !== 'enviado' || p.cancelamento_enviado_em === null) return false;
      return Date.parse(agora) - Date.parse(p.cancelamento_enviado_em) >= timeoutMs;
    })
    .sort((a, b) => Date.parse(a.cancelamento_solicitado_em as string) - Date.parse(b.cancelamento_solicitado_em as string) || (a.pedido_uuid < b.pedido_uuid ? -1 : 1))
    .slice(0, limite);
  return {
    entregar: candidatos.map((p) => ({
      pedido_uuid: p.pedido_uuid,
      numero_erp: p.numero_erp,
      motivo: p.cancelamento_motivo,
      cancelado_em: p.cancelamento_solicitado_em as string,
      tentativa: p.cancelamento_tentativas + 1,
    })),
    atualizacoes: candidatos.map((p) => ({ pedido_uuid: p.pedido_uuid, cancelamento_enviado_em: agora, cancelamento_tentativas: p.cancelamento_tentativas + 1 })),
  };
}

/** Recorte do Conector que importa ao aceite. */
export interface ConectorParaAceite {
  ativo: boolean;
  recebe_pedidos: boolean;
  aceita_cancelamento: boolean;
}

/** Aceite do cancelamento no ERP (RN-INT-08, T-0114): algum Conector ativo que recebe pedidos com `aceita_cancelamento`. */
export function erpAceitaCancelamento(conectores: readonly ConectorParaAceite[]): boolean {
  return conectores.some((c) => c.ativo && c.recebe_pedidos && c.aceita_cancelamento);
}

/** Instante e motivo da recusa do ERP (T-0114), como o retorno `cancelamento_recusado` os traz. */
export interface RecusaDeCancelamento {
  motivo: string | null | undefined;
  ocorrido_em: string;
}

export type CodigoFalhaRecusa = 'pedido_desconhecido' | 'cancelamento_nao_solicitado' | 'cancelamento_nao_entregue' | 'cancelamento_ja_confirmado';

export type ResultadoRecusa =
  | {
      ok: true;
      /** Mesma recusa já registrada: responde 200 sem gravar nem publicar de novo. */
      repetido: boolean;
      atualizacao: { cancelamento_estado: 'recusado'; cancelamento_recusa_motivo: string; cancelamento_recusado_em: string };
      /** Conteúdo de `integracao.pedido.cancelamento_recusado@1` (só quando não repetido). */
      evento: { pedido_uuid: string; numero_erp: string | null; motivo: string; recusado_em: string };
    }
  | { ok: false; status: 422; codigo: CodigoFalhaRecusa; mensagem: string };

const MOTIVO_RECUSA_MAX = 300;

/**
 * RN-INT-08 (exceção da T-0114): o ERP recusou o cancelamento que o Hub pediu. Só vale para cancelamento `enviado` (já entregue ao
 * Conector). Repetir a recusa é idempotente; recusa depois de `confirmado` é conflito (o ERP já cancelou); sem cancelamento
 * pedido, o Hub recusa (o Conector não inventa cancelamento). Não altera o estado do pedido: ele continua vivo no ERP.
 */
export function aplicarCancelamentoRecusado(item: (Pick<PedidoParaCancelar, 'pedido_uuid' | 'numero_erp' | 'removido_em' | 'cancelamento_estado'> & { cancelamento_recusa_motivo?: string | null }) | null, recusa: RecusaDeCancelamento): ResultadoRecusa {
  const falha = (codigo: CodigoFalhaRecusa, mensagem: string): ResultadoRecusa => ({ ok: false, status: 422, codigo, mensagem });
  if (item === null || item.removido_em !== null) return falha('pedido_desconhecido', 'O Hub não conhece este pedido. Só pedidos aprovados e entregues ao Conector recebem retorno.');
  const motivo = (recusa.motivo ?? '').trim().slice(0, MOTIVO_RECUSA_MAX) || 'o ERP não informou o motivo';
  const evento = { pedido_uuid: item.pedido_uuid, numero_erp: item.numero_erp, motivo, recusado_em: recusa.ocorrido_em };
  const atualizacao = { cancelamento_estado: 'recusado' as const, cancelamento_recusa_motivo: motivo, cancelamento_recusado_em: recusa.ocorrido_em };
  switch (item.cancelamento_estado) {
    case null:
      return falha('cancelamento_nao_solicitado', 'O Hub não pediu o cancelamento deste pedido ao ERP; não há o que recusar. Envie a recusa só para um cancelamento recebido em /pedidos/pendentes.');
    case 'pendente':
      return falha('cancelamento_nao_entregue', 'Este cancelamento ainda não foi entregue ao Conector (GET /pedidos/pendentes). Busque os cancelamentos pendentes antes de enviar a recusa.');
    case 'confirmado':
      return falha('cancelamento_ja_confirmado', 'O cancelamento deste pedido já foi confirmado pelo ERP; a recusa não vale. Confira o pedido no ERP.');
    case 'recusado':
      return { ok: true, repetido: true, atualizacao: { ...atualizacao, cancelamento_recusa_motivo: item.cancelamento_recusa_motivo ?? motivo }, evento };
    case 'enviado':
      return { ok: true, repetido: false, atualizacao, evento };
  }
}
