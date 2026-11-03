/**
 * Opção `promotor_ve_pedidos` do perfil Promotor (RN-CORE-01; RN-PRO-01; RN-AUD-01; T-0061). Guardada em
 * `plataforma.parametro` (modulo `core`), por tenant (RLS), padrão LIGADO (sem registro = ligado). Só `admin` lê e escreve pelo BKO
 * (ação `parametro.promotor_ve_pedidos`). A escrita é idempotente (upsert do mesmo valor) e audita antes/depois só quando o valor muda.
 * A opção só controla a LEITURA de pedido pelo promotor; a escrita de pedido segue sempre negada (RN-PRO-01).
 */
import type { ClienteBanco, RotaModulo } from '@macuxi/platform-sdk';
import { PARAMETRO_PROMOTOR_VE_PEDIDOS, PromotorVePedidosPutSchema, PromotorVePedidosSchema, type PromotorVePedidos } from '../contracts';
import { promotorVePedidos } from '../domain';
import { auditar } from './auditoria';

/** Lê o valor efetivo do tenant da transação (RLS). Sem cache: cada chamada vai ao banco. */
export async function lerPromotorVePedidos(db: ClienteBanco): Promise<boolean> {
  const r = await db.query<{ valor: unknown }>("select valor from plataforma.parametro where modulo = 'core' and chave = $1 and deleted_at is null limit 1", [
    PARAMETRO_PROMOTOR_VE_PEDIDOS,
  ]);
  return promotorVePedidos(r.rows[0]?.valor);
}

export const rotasDePromotorPedidos: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'parametros/promotor-ve-pedidos',
    acao: 'parametro.promotor_ve_pedidos',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<PromotorVePedidos> => PromotorVePedidosSchema.parse({ ligado: await lerPromotorVePedidos(db) })),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/promotor-ve-pedidos',
    acao: 'parametro.promotor_ve_pedidos',
    carteira: 'nao_se_aplica',
    corpo: PromotorVePedidosPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db): Promise<PromotorVePedidos> => {
        const c = ctx.corpo as PromotorVePedidos;
        const antes = await lerPromotorVePedidos(db);
        await db.query(
          `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
           on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
             where plataforma.parametro.valor is distinct from excluded.valor`,
          [PARAMETRO_PROMOTOR_VE_PEDIDOS, JSON.stringify(c.ligado)],
        );
        if (antes !== c.ligado) {
          await auditar(db, ctx, {
            acao: 'parametro.promotor_ve_pedidos',
            entidade: 'parametro',
            entidadeId: null,
            antes: { [PARAMETRO_PROMOTOR_VE_PEDIDOS]: antes },
            depois: { [PARAMETRO_PROMOTOR_VE_PEDIDOS]: c.ligado },
          });
        }
        return c;
      }),
  },
];
