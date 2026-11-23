/**
 * `GET /v1/integracao/monitor` (ação `monitor.ver`; RF-INT-04, T-0173): os lotes recentes da tela Integração ERP e o resumo dos
 * pedidos no ERP (cards do Vendedor). Só o que alguma tela lê. O super-admin também lê, pelo portal (ADR 0029; desenho
 * `empresa-zerar.md` §6.4); o admin do cliente no portal entra como o admin real do tenant, com perfil e licença como no BKO.
 *
 * `GET /v1/integracao/monitor/detalhes` (só o super-admin): o detalhe por entidade e por Conector da aba Integração do portal.
 */
import type { ContextoRota, RotaModulo } from '@macuxi/platform-sdk';
import { ESTADOS_PEDIDO_ERP, type CodigoErroLinha, type Entidade, type EstadoLoteBko, type LoteListagemItem, type MonitorDetalhes, type MonitorResumo, type TipoConector } from '../contracts';
import { montarMonitorDetalhes, resumoPedidosErp } from '../domain';
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
  superAdmin: 'aceita',
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

/**
 * Detalhe do Hub por entidade e por Conector (desenho `empresa-zerar.md` §6.4): cursor, `registro_atual`, último lote, erros por
 * código e classe nos lotes recentes (a mesma janela do monitor) e os lotes reprocessáveis; por Conector, o último sinal de vida.
 * Só o super-admin (`'exige'`): o tenant vem no `x-macuxi-tenant` e o RLS vale. Nada de valor de linha (só códigos e contagens).
 */
export const rotaMonitorDetalhes: RotaModulo = {
  metodo: 'GET',
  caminho: 'monitor/detalhes',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  superAdmin: 'exige',
  executar: async (ctx: ContextoRota): Promise<MonitorDetalhes> => {
    const tenantId = ctx.usuario.tenant_id;
    const agora = ctx.agora().toISOString();
    return ctx.comTenant(async (db) => {
      const { rows: conectores } = await db.query<{
        conector_id: string;
        tipo: TipoConector;
        ativo: boolean;
        entidades: Entidade[];
        versao_conector: string | null;
        ultimo_sinal_em: Date | null;
        parado_por_versao: boolean;
        sinal_resumo: unknown;
      }>(
        `select identificador as conector_id, tipo, ativo, entidades, versao_conector, ultimo_sinal_em, parado_por_versao, sinal_resumo
           from integracao.conector where tenant_id = $1 and deleted_at is null order by identificador`,
        [tenantId],
      );
      const { rows: cursores } = await db.query<{ conector_id: string; entidade: Entidade; alterado_em: Date | null; external_id: string | null; atualizado_em: Date }>(
        `select c.identificador as conector_id, k.entidade, k.cursor_alterado_em as alterado_em, k.cursor_external_id as external_id, k.atualizado_em
           from integracao.cursor_entidade k join integracao.conector c on c.tenant_id = k.tenant_id and c.id = k.conector_id
          where k.tenant_id = $1 and k.deleted_at is null and c.deleted_at is null order by k.entidade, c.identificador`,
        [tenantId],
      );
      const { rows: registros } = await db.query<{ entidade: Entidade; ativos: number; inativos: number }>(
        `select entidade, count(*) filter (where ativo and deleted_at is null)::int as ativos,
                count(*) filter (where not ativo or deleted_at is not null)::int as inativos
           from integracao.registro_atual where tenant_id = $1 group by entidade`,
        [tenantId],
      );
      // a mesma janela do monitor (LOTES_POR_ENTIDADE por entidade); `tem_conteudo` = o corpo ainda está no staging (RN-INT-15)
      const { rows: lotes } = await db.query<{
        lote_id: string;
        conector_id: string;
        entidade: Entidade;
        modo: 'completo' | 'delta';
        status: EstadoLoteBko;
        recebido_em: Date;
        concluido_em: Date | null;
        tem_conteudo: boolean;
      }>(
        `select l.id as lote_id, c.identificador as conector_id, l.entidade, l.modo, l.status, l.recebido_em, l.concluido_em,
                exists (select 1 from integracao.lote_staging s where s.tenant_id = l.tenant_id and s.lote_id = l.id and s.corpo is not null) as tem_conteudo
           from (select x.*, row_number() over (partition by x.entidade order by x.recebido_em desc) as rn
                   from integracao.lote x where x.tenant_id = $1 and x.deleted_at is null) l
           join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id
          where l.rn <= ${LOTES_POR_ENTIDADE}`,
        [tenantId],
      );
      const { rows: erros } = await db.query<{ entidade: Entidade; codigo: CodigoErroLinha; reprocessavel: boolean; linhas: number }>(
        `select l.entidade, e.codigo, e.reprocessavel, count(*)::int as linhas
           from integracao.lote_linha_erro e
           join (select x.id, x.tenant_id, x.entidade, row_number() over (partition by x.entidade order by x.recebido_em desc) as rn
                   from integracao.lote x where x.tenant_id = $1 and x.deleted_at is null) l on l.tenant_id = e.tenant_id and l.id = e.lote_id and l.rn <= ${LOTES_POR_ENTIDADE}
          where e.tenant_id = $1 and e.deleted_at is null and e.resolvido_em is null
          group by l.entidade, e.codigo, e.reprocessavel`,
        [tenantId],
      );
      return montarMonitorDetalhes({
        agora,
        conectores: conectores.map((c) => ({ ...c, ultimo_sinal_em: iso(c.ultimo_sinal_em) })),
        cursores: cursores.map((k) => ({ ...k, alterado_em: iso(k.alterado_em), atualizado_em: iso(k.atualizado_em) as string })),
        registros,
        lotes: lotes.map((l) => ({ ...l, recebido_em: iso(l.recebido_em) as string, concluido_em: iso(l.concluido_em) })),
        erros,
      });
    });
  },
};
