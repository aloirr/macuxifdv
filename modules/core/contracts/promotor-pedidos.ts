/**
 * Opção `promotor_ve_pedidos` do perfil Promotor (RN-CORE-01; RN-PRO-01; T-0061). Por tenant, padrão LIGADO (ausência de
 * registro = ligado). A opção só controla a LEITURA de pedido pelo promotor; criar/editar/cancelar/duplicar/excluir continua
 * sempre negado (RN-PRO-01). Guardada em `plataforma.parametro` (modulo `core`, chave abaixo, valor JSON booleano), sem tabela nova.
 * - Rotas do BKO (admin): `GET|PUT /v1/core/parametros/promotor-ve-pedidos`.
 * - Consulta síncrona: `core.promotor_ve_pedidos@1` (avaliada a cada requisição; nunca em JWT/sessão).
 * - App offline: a entidade de sync `parametro` leva a linha `{ modulo: 'core', chave: 'promotor_ve_pedidos', valor: boolean }`.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

export const PARAMETRO_PROMOTOR_VE_PEDIDOS = 'promotor_ve_pedidos';
export const PROMOTOR_VE_PEDIDOS_PADRAO = true;

export const PromotorVePedidosSchema = z.object({ ligado: z.boolean() }).strict();
export type PromotorVePedidos = z.infer<typeof PromotorVePedidosSchema>;
export const PromotorVePedidosPutSchema = PromotorVePedidosSchema;

export const PromotorVePedidosEntradaSchema = z.object({}).strict();
export const CONSULTA_PROMOTOR_VE_PEDIDOS = definirConsulta({
  nome: 'core.promotor_ve_pedidos@1',
  entrada: PromotorVePedidosEntradaSchema,
  saida: PromotorVePedidosSchema,
});

/**
 * Valor efetivo (regra pura, aqui para o Vendedor e o Catálogo lerem sem importar o domain do Core): só `false`
 * (booleano) desliga; ausente ou inválido = padrão (ligado).
 */
export function promotorVePedidos(valor: unknown): boolean {
  return valor === false ? false : PROMOTOR_VE_PEDIDOS_PADRAO;
}

/** Valor efetivo a partir das linhas da entidade de sync `parametro` (`motor.linhas('parametro')`); sem linha ou removida = ligado. */
export function promotorVePedidosDasLinhas(linhas: readonly { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null }[]): boolean {
  const l = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_PROMOTOR_VE_PEDIDOS && !x.deleted_at);
  return promotorVePedidos(l?.valor);
}
