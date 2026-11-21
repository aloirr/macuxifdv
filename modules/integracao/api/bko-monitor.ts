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

/** Limite de lotes recentes devolvidos por entidade: carga rara não some quando outra entidade carrega sem parar. */
export const LOTES_POR_ENTIDADE = 20;

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
        `select ${COLUNAS_LOTE}
           from (select x.*, row_number() over (partition by x.entidade order by x.recebido_em desc) as rn
                   from integracao.lote x where x.tenant_id = $1 and x.deleted_at is null) l
           join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id
          where l.rn <= ${LOTES_POR_ENTIDADE} order by l.recebido_em desc`,
        [tenantId],
      );
      const { rows: conectores } = await db.query<{ conector_id: string; versao_conector: string | null }>(
        'select identificador as conector_id, versao_conector from integracao.conector where tenant_id = $1 and deleted_at is null order by identificador',
        [tenantId],
      );
      // RN-INT-08: contagem por estado da fila, presos (enviados com tentativas no limite) e retidos sem mapeamento
      const { rows: porEstado } = await db.query<{ estado: string; n: number }>(
        'select estado, count(*)::int as n from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null group by estado',
        [tenantId],
      );
      const { rows: extras } = await db.query<{ presos: number; retidos: number; parados_desde: Date | null }>(
        `select count(*) filter (where estado = 'enviado' and tentativas >= $2)::int as presos,
                count(*) filter (where retencao_codigo is not null)::int as retidos,
                least(min(coalesce(enviado_em, aprovado_em)) filter (where estado = 'enviado' and tentativas >= $2),
                      min(aprovado_em) filter (where retencao_codigo is not null)) as parados_desde
           from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null`,
        [tenantId, parametros.tentativasAlertaPedido],
      );
      // T-0189: a última carga de cada entidade, sem janela (índice lote_entidade_ix: tenant_id, entidade, recebido_em desc)
      const { rows: ultimas } = await db.query<{ entidade: Entidade; recebido_em: Date }>(
        'select entidade, max(recebido_em) as recebido_em from integracao.lote where tenant_id = $1 and deleted_at is null group by entidade order by entidade',
        [tenantId],
      );

      const contagem = Object.fromEntries(ESTADOS_PEDIDO_ERP.map((e) => [e, 0])) as Record<(typeof ESTADOS_PEDIDO_ERP)[number], number>;
      for (const r of porEstado) if (r.estado in contagem) contagem[r.estado as keyof typeof contagem] = r.n;

      return {
        gerado_em: agoraIso,
        lotes_recentes: recentes.map(paraItem),
        conectores,
        resumo_pedidos: {
          ...resumoPedidosErp({ por_estado: contagem, presos: extras[0]?.presos ?? 0, retidos: extras[0]?.retidos ?? 0 }),
          parados_desde: iso(extras[0]?.parados_desde ?? null),
        },
        ultima_carga_por_entidade: ultimas.map((u) => ({ entidade: u.entidade, recebido_em: iso(u.recebido_em) as string })),
      };
    });
  },
};
