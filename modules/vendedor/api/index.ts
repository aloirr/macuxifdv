/**
 * API do módulo Vendedor (`/v1/vendedor`). Rotas declarativas; o `createApp` (apps/api) aplica
 * autenticação, licença, perfil (RN-PRO-01), validação e escopo de carteira (CLAUDE.md regra 6).
 * A regra de negócio vive no domínio e é revalidada aqui (regra 2).
 */
import { z } from 'zod';
import { definirModuloApi, ErroRegraNegocio, type ModuloApi, type RotaModulo } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { verificarCancelamento } from '../domain/order';

const ParamsPedido = z.object({ id: z.string().uuid() });
const CorpoCancelar = z.object({ motivo: z.string().max(500).optional() }).default({});

interface LinhaPedido {
  status: string;
  cliente_id: string;
}

/**
 * POST /v1/vendedor/pedidos/:id/cancelar — ação `pedido.cancelar` (vendedor/supervisor/gerente/...; promotor 403).
 * RN-VEN-CANCELAR-APOS-ENVIO: enviado ao ERP ou posterior → 422 (cancelar no ERP). Antes do envio → 200.
 * Pendente do banco-dados: tabela `vendedor.pedido` (colunas id, cliente_id, status) — ver recado da T-0009.
 */
export const rotaCancelarPedido: RotaModulo = {
  metodo: 'POST',
  caminho: 'pedidos/:id/cancelar',
  acao: 'pedido.cancelar',
  carteira: 'filtrar_no_dominio',
  params: ParamsPedido,
  corpo: CorpoCancelar,
  async executar(ctx) {
    const { id } = ctx.params as z.infer<typeof ParamsPedido>;
    const carteira = await ctx.carteira();
    return ctx.comTenant(async (db) => {
      const { rows } = await db.query<LinhaPedido>('select status, cliente_id from vendedor.pedido where id = $1 and deleted_at is null for update', [id]);
      const pedido = rows[0];
      // fora da carteira = não encontrado (não revela existência; RN-CORE-04)
      if (!pedido || (carteira !== 'tenant' && !carteira.has(pedido.cliente_id))) {
        throw new ErroRegraNegocio('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.');
      }
      const v = verificarCancelamento(pedido.status);
      if (!v.ok) throw new ErroRegraNegocio(v.codigo, v.mensagem);
      if (pedido.status !== 'cancelled') {
        await db.query("update vendedor.pedido set status = 'cancelled', updated_at = $2 where id = $1", [id, ctx.agora().toISOString()]);
      }
      return { id, status: 'cancelled' };
    });
  },
};

export const apiVendedor: ModuloApi = definirModuloApi({ manifesto: manifest, rotas: [rotaCancelarPedido] });
export default apiVendedor;
