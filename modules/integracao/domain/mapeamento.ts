/**
 * T-0120: de-para de códigos ERP ↔ Macuxi no BKO (RN-INT-08). Funções puras; a API grava e libera os pedidos retidos.
 * Regras (espelham os índices de `integracao.mapeamento`): único por (tipo, codigo_erp) entre os vivos; para a condição de
 * pagamento, um correspondente ATIVO por código do Macuxi (a tradução do pedido precisa ser inequívoca).
 */
import type { PedidoAprovadoEvento } from '../../vendedor/contracts';
import type { Mapeamento as MapeamentoEntrada, PedidoParaErp } from '../contracts';
import { montarPedidoParaErp, montarSnapshotParaFila, type CodigoRetencao } from './pedido-fila';

export interface MapeamentoGravado {
  id: string;
  tipo: MapeamentoEntrada['tipo'];
  codigo_erp: string;
  codigo_macuxi: string;
  ativo: boolean;
}

export type ResultadoValidacaoMapeamento = { ok: true; acao: 'criar' } | { ok: true; acao: 'atualizar'; id: string } | { ok: false; mensagem: string };

export function validarMapeamento(entrada: MapeamentoEntrada, existentes: readonly MapeamentoGravado[]): ResultadoValidacaoMapeamento {
  const mesmoErp = existentes.find((e) => e.tipo === entrada.tipo && e.codigo_erp === entrada.codigo_erp);
  if (entrada.tipo === 'condicao_pagamento' && entrada.ativo) {
    const outro = existentes.find((e) => e.tipo === 'condicao_pagamento' && e.ativo && e.codigo_macuxi === entrada.codigo_macuxi && e.id !== mesmoErp?.id);
    if (outro) {
      return { ok: false, mensagem: `A condição "${entrada.codigo_macuxi}" já tem o código ${outro.codigo_erp} do ERP ativo. Inative o de-para ${outro.codigo_erp} antes de ativar outro, ou edite o existente.` };
    }
  }
  return mesmoErp ? { ok: true, acao: 'atualizar', id: mesmoErp.id } : { ok: true, acao: 'criar' };
}

export interface PedidoRetido {
  pedido_uuid: string;
  /** `payload_origem` da fila: o evento `vendedor.pedido.aprovado@1` como chegou. */
  origem: PedidoAprovadoEvento;
}

export interface RetencaoMantida {
  pedido_uuid: string;
  codigo: CodigoRetencao;
  mensagem: string;
}

/** Reavalia os retidos com o de-para atual: os que montam saem da retenção; os demais ficam com o motivo de agora. */
export function liberarRetidosPorMapeamento(
  retidos: readonly PedidoRetido[],
  mapeamentos: readonly MapeamentoGravado[],
): { liberados: { pedido_uuid: string; pedido: PedidoParaErp }[]; continuamRetidos: RetencaoMantida[] } {
  const liberados: { pedido_uuid: string; pedido: PedidoParaErp }[] = [];
  const continuamRetidos: RetencaoMantida[] = [];
  for (const r of retidos) {
    const s = montarSnapshotParaFila(r.origem);
    if (!s.ok) {
      continuamRetidos.push({ pedido_uuid: r.pedido_uuid, codigo: 'mapeamento_ausente', mensagem: s.mensagem });
      continue;
    }
    const m = montarPedidoParaErp(s.snapshot, mapeamentos);
    if (m.ok) liberados.push({ pedido_uuid: r.pedido_uuid, pedido: m.pedido });
    else continuamRetidos.push({ pedido_uuid: r.pedido_uuid, codigo: m.codigo, mensagem: m.mensagem });
  }
  return { liberados, continuamRetidos };
}

/** Para o monitor: condições do Macuxi que travam pedidos por falta de correspondente ativo (o que cadastrar), com a contagem. */
export function condicoesSemCorrespondente(retidos: readonly PedidoRetido[], mapeamentos: readonly MapeamentoGravado[]): { codigo_macuxi: string; pedidos: number }[] {
  const contagem = new Map<string, number>();
  for (const r of retidos) {
    const codigo = r.origem.condicao_pagamento_codigo?.trim();
    const pagamento = (r.origem as { pagamento?: { prazo_external_id?: string | null } }).pagamento;
    if (!codigo || pagamento?.prazo_external_id?.trim()) continue;
    if (mapeamentos.some((m) => m.tipo === 'condicao_pagamento' && m.ativo && m.codigo_macuxi === codigo)) continue;
    contagem.set(codigo, (contagem.get(codigo) ?? 0) + 1);
  }
  return [...contagem].map(([codigo_macuxi, pedidos]) => ({ codigo_macuxi, pedidos })).sort((a, b) => (a.codigo_macuxi < b.codigo_macuxi ? -1 : 1));
}
