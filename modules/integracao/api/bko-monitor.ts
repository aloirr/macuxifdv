/**
 * `GET /v1/integracao/monitor` (ação `monitor.ver`; RF-INT-04, T-0173): os lotes recentes da tela Integração ERP e o resumo dos
 * pedidos no ERP (cards do Vendedor). Só o que alguma tela lê.
 */
import type { ContextoRota, RotaModulo } from '@macuxi/platform-sdk';
import { ESTADOS_PEDIDO_ERP, type Entidade, type LoteListagemItem, type MonitorResumo } from '../contracts';
import { resumoPedidosErp } from '../domain';
import { iso } from './bko-comum';
import { lerParametrosHub } from './parametros';

interface LinhaLote {
  lote_id: string;
  conector_id: string;
  entidade: Entidade;
  modo: 'completo' | 'delta';
  status: LoteListagemItem['status'];
  recebidas: number;
  com_erro: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  obsoletas: number;
  inativadas: number;
  recebido_em: Date;
  concluido_em: Date | null;
}

const COLUNAS_LOTE = `l.id as lote_id, c.identificador as conector_id, l.entidade, l.modo, l.status, l.recebidas, l.com_erro, l.novas, l.atualizadas,
  l.inalteradas, l.obsoletas, l.inativadas, l.recebido_em, l.concluido_em`;

const paraItem = (l: LinhaLote): LoteListagemItem => ({ ...l, recebido_em: iso(l.recebido_em) as string, concluido_em: iso(l.concluido_em) });

export const rotaMonitor: RotaModulo = {
  metodo: 'GET',
  caminho: 'monitor',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  executar: async (ctx: ContextoRota): Promise<MonitorResumo> => {
    const tenantId = ctx.usuario.tenant_id;
    const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
    const agoraIso = ctx.agora().toISOString();
    return ctx.comTenant(async (db) => {
      const { rows: recentes } = await db.query<LinhaLote>(
        `select ${COLUNAS_LOTE} from integracao.lote l join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id
          where l.tenant_id = $1 and l.deleted_at is null order by l.recebido_em desc limit 100`,
        [tenantId],
      );
      // RN-INT-08: contagem por estado da fila, presos (enviados com tentativas no limite) e retidos sem mapeamento
      const { rows: porEstado } = await db.query<{ estado: string; n: number }>(
        'select estado, count(*)::int as n from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null group by estado',
        [tenantId],
      );
      const { rows: extras } = await db.query<{ presos: number; retidos: number }>(
        `select count(*) filter (where estado = 'enviado' and tentativas >= $2)::int as presos,
                count(*) filter (where retencao_codigo is not null)::int as retidos
           from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null`,
        [tenantId, parametros.tentativasAlertaPedido],
      );

      const contagem = Object.fromEntries(ESTADOS_PEDIDO_ERP.map((e) => [e, 0])) as Record<(typeof ESTADOS_PEDIDO_ERP)[number], number>;
      for (const r of porEstado) if (r.estado in contagem) contagem[r.estado as keyof typeof contagem] = r.n;

      return {
        gerado_em: agoraIso,
        lotes_recentes: recentes.map(paraItem),
        resumo_pedidos: resumoPedidosErp({ por_estado: contagem, presos: extras[0]?.presos ?? 0, retidos: extras[0]?.retidos ?? 0 }),
      };
    });
  },
};
