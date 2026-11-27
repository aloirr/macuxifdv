/**
 * Opção `promotor_ve_pedidos` do perfil Promotor (RN-CORE-01; RN-PRO-01; T-0061). Por tenant, padrão LIGADO (ausência de
 * registro = ligado). A opção só controla a LEITURA de pedido pelo promotor; criar/editar/cancelar/duplicar/excluir continua
 * sempre negado (RN-PRO-01). Guardada em `plataforma.parametro` (modulo `core`, chave abaixo, valor JSON booleano), sem tabela nova.
 * - Rotas do BKO (admin): `GET|PUT /v1/core/parametros/promotor-ve-pedidos`.
 * - Consulta síncrona: `core.promotor_ve_pedidos@1` (avaliada a cada requisição; nunca em JWT/sessão).
 * - App offline: a entidade de sync `parametro` leva a linha `{ modulo: 'core', chave: 'promotor_ve_pedidos', valor: boolean }`
 *   (tenant em `legado`; em `concessao` o app segue `LeituraDePedidosDoUsuario`, abaixo).
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
 * ADR 0073 §2.4 (R-20261127-144433, item 5): o app lê se o usuário vê pedidos por esta rota, e não pelo parâmetro do tenant.
 * - `GET /v1/core/${ROTA_LEITURA_DE_PEDIDOS}` — `LeituraDePedidosDoUsuario` do próprio usuário da requisição (sem parâmetro).
 * - `leitura: 'concessao'`: tenant que lê as concessões; `ve_pedidos` = cargo e chave `pedido.ver` do perfil (trava do cargo,
 *   RN-PRO-01). `leitura: 'legado'`: tenant ainda no motor antigo; para o promotor vale o parâmetro `promotor_ve_pedidos`.
 * - Cargo que não é promotor: `ve_pedidos` = true (o escopo de carteira segue valendo em cada leitura).
 * A API decide pela mesma regra das leituras de pedido do servidor (`usuarioDaRequisicaoVePedidos`); licença e perfil, pela plataforma.
 */
export const ROTA_LEITURA_DE_PEDIDOS = 'eu/leitura-de-pedidos';
export const LeituraDePedidosDoUsuarioSchema = z
  .object({ usuario_id: z.string().uuid(), ve_pedidos: z.boolean(), leitura: z.enum(['concessao', 'legado']) })
  .strict();
export type LeituraDePedidosDoUsuario = z.infer<typeof LeituraDePedidosDoUsuarioSchema>;

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
