/**
 * Consulta que a Integração oferece (ADR 0012; T-0114): `integracao.cancelamento_erp@1`. O Vendedor pergunta, na transação do
 * tenant, se o ERP aceita receber o cancelamento de um pedido já enviado (conector ativo que recebe pedidos e com
 * `aceita_cancelamento`). Sem cópia da configuração no Vendedor: a API decide na hora (RN-INT-08, RN-VEN-31 com a exceção da T-0114).
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';
export const CancelamentoErpEntradaSchema = z.object({}).strict();
export const CancelamentoErpSaidaSchema = z.object({ aceita: z.boolean() }).strict();
export const CONSULTA_CANCELAMENTO_ERP = definirConsulta({
    nome: 'integracao.cancelamento_erp@1',
    entrada: CancelamentoErpEntradaSchema,
    saida: CancelamentoErpSaidaSchema,
    // ADR 0025 §4.1: resposta igual para qualquer usuário do tenant (só a configuração do Conector); o Vendedor pode pedir licença 'tenant'
    configuracaoDoTenant: true,
});
