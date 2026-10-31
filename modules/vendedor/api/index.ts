/**
 * API do módulo Vendedor (`/v1/vendedor`). Rotas declarativas; o `createApp` (apps/api) aplica
 * autenticação, licença, perfil (RN-PRO-01), validação e escopo de carteira (CLAUDE.md regra 6).
 * A regra de negócio vive no domínio e é revalidada aqui (regra 2).
 */
import { z } from 'zod';
import { definirModuloApi, ErroNaoEncontrado, ErroRegraNegocio, type ModuloApi, type RotaModulo } from '@macuxi/platform-sdk';
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
        throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.');
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

const QueryLista = z.object({ cliente_id: z.string().uuid().optional(), limite: z.coerce.number().int().min(1).max(200).default(50) });

/**
 * GET /v1/vendedor/pedidos — ação `pedido.ver` (leitura; inclui promotor, RN-PRO-01 / O-3 do doc 03).
 * Só devolve pedidos de clientes da carteira do usuário (RN-CORE-04).
 */
export const rotaListarPedidos: RotaModulo = {
  metodo: 'GET',
  caminho: 'pedidos',
  acao: 'pedido.ver',
  carteira: 'filtrar_no_dominio',
  query: QueryLista,
  async executar(ctx) {
    const q = ctx.query as z.infer<typeof QueryLista>;
    const carteira = await ctx.carteira();
    return ctx.comTenant(async (db) => {
      // RN-CORE-04: filtra pela carteira NA consulta (antes do limit), senão a página vem incompleta.
      const ids = carteira === 'tenant' ? null : [...carteira];
      const { rows } = await db.query<LinhaPedido & { id: string }>(
        'select id, status, cliente_id from vendedor.pedido where deleted_at is null and ($1::uuid is null or cliente_id = $1) and ($3::uuid[] is null or cliente_id = any($3::uuid[])) order by created_at desc limit $2',
        [q.cliente_id ?? null, q.limite, ids],
      );
      // defesa em profundidade: a API sempre revalida.
      return { itens: rows.filter((p) => carteira === 'tenant' || carteira.has(p.cliente_id)) };
    });
  },
};

/** GET /v1/vendedor/pedidos/:id — fora da carteira = 404 `PEDIDO_NAO_ENCONTRADO` (RN-CORE-04). */
export const rotaVerPedido: RotaModulo = {
  metodo: 'GET',
  caminho: 'pedidos/:id',
  acao: 'pedido.ver',
  carteira: 'filtrar_no_dominio',
  params: ParamsPedido,
  async executar(ctx) {
    const { id } = ctx.params as z.infer<typeof ParamsPedido>;
    const carteira = await ctx.carteira();
    return ctx.comTenant(async (db) => {
      const { rows } = await db.query<LinhaPedido>('select status, cliente_id from vendedor.pedido where id = $1 and deleted_at is null', [id]);
      const pedido = rows[0];
      if (!pedido || (carteira !== 'tenant' && !carteira.has(pedido.cliente_id))) {
        throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.');
      }
      return { id, status: pedido.status, cliente_id: pedido.cliente_id };
    });
  },
};

export const apiVendedor: ModuloApi = definirModuloApi({ manifesto: manifest, rotas: [rotaListarPedidos, rotaVerPedido, rotaCancelarPedido] });
export default apiVendedor;
