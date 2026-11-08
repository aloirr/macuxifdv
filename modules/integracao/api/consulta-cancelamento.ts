/**
 * Consulta `integracao.cancelamento_erp@1` na API (ADR 0012; T-0114): o Vendedor pergunta se o ERP aceita o cancelamento de pedido
 * já enviado. Lê só o schema da Integração, na transação de quem consulta (RLS do tenant), e nunca escreve. A regra é do domain.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_CANCELAMENTO_ERP } from '../contracts';
import { erpAceitaCancelamento } from '../domain';

export const consultaCancelamentoErp = implementarConsulta(CONSULTA_CANCELAMENTO_ERP, async (_entrada, ctx) => {
  const { rows } = await ctx.db.query<{ ativo: boolean; recebe_pedidos: boolean; aceita_cancelamento: boolean }>(
    'select ativo, recebe_pedidos, aceita_cancelamento from integracao.conector where tenant_id = $1 and deleted_at is null',
    [ctx.usuario.tenant_id],
  );
  return { aceita: erpAceitaCancelamento(rows) };
});
