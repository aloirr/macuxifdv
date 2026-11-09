/**
 * Consulta `integracao.cancelamento_erp@1` na API (ADR 0012; T-0114): o Vendedor pergunta se o ERP aceita o cancelamento de pedido
 * já enviado. Lê só o schema da Integração, na transação de quem consulta (RLS do tenant), e nunca escreve. A regra é do domain.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_CANCELAMENTO_ERP } from '../contracts';
import { aceiteDoTenant } from './aceite-cancelamento';

export const consultaCancelamentoErp = implementarConsulta(CONSULTA_CANCELAMENTO_ERP, async (_entrada, ctx) => ({ aceita: await aceiteDoTenant(ctx.db, ctx.usuario.tenant_id) }));
