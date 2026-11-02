/**
 * `GET /v1/integracao/monitor` (ação `monitor.ver`; RF-INT-04, RF-INT-06): saúde dos Conectores, alertas com a causa e a ação
 * seguinte, lotes recentes, carga por entidade, inativações aguardando, reconciliações e a fila de pedidos do ERP. Janelas em
 * relação a `ctx.agora()` (nunca uma data fixa contra o relógio do banco).
 */
import type { ContextoRota, RotaModulo } from '@macuxi/platform-sdk';
import { ESTADOS_PEDIDO_ERP, type Entidade, type LoteListagemItem, type MonitorResumo, type PendenciaInativacao } from '../contracts';
import { ehRetencaoPorChaveErp, montarAlertasMonitor, pedidosAguardandoConector, resumirCargaPorEntidade, type EstadoCargaEntidade } from '../domain';
import { COLUNAS_CONECTOR, iso, lerChaves, lerPolitica, montarResumo, type LinhaConector } from './bko-comum';
import { lerParametrosHub } from './parametros';

const JANELA_24H_MS = 24 * 3_600_000;
const DIAS_RECONCILIACAO = 7;

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
    const agora = ctx.agora();
    const agoraIso = agora.toISOString();
    const desde24h = new Date(agora.getTime() - JANELA_24H_MS).toISOString();
    return ctx.comTenant(async (db) => {
      const { rows: conectores } = await db.query<LinhaConector>(`select ${COLUNAS_CONECTOR} from integracao.conector where tenant_id = $1 and deleted_at is null order by identificador`, [tenantId]);
      const chaves = await lerChaves(db, tenantId, conectores.map((c) => c.id));
      const politica = await lerPolitica(db, tenantId);
      const resumos = conectores.map((c) => montarResumo(c, chaves.get(c.id), politica, agoraIso));

      const { rows: recentes } = await db.query<LinhaLote>(
        `select ${COLUNAS_LOTE} from integracao.lote l join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id
          where l.tenant_id = $1 and l.deleted_at is null order by l.recebido_em desc limit 20`,
        [tenantId],
      );
      // carga por entidade: os 1.000 lotes mais recentes bastam para o estado de cada entidade
      const { rows: paraCarga } = await db.query<LinhaLote>(
        `select ${COLUNAS_LOTE} from integracao.lote l join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id
          where l.tenant_id = $1 and l.deleted_at is null order by l.recebido_em desc limit 1000`,
        [tenantId],
      );
      const cargas = resumirCargaPorEntidade(paraCarga.map((l) => ({ entidade: l.entidade, status: l.status, contagens: { recebidas: l.recebidas, com_erro: l.com_erro, novas: l.novas, atualizadas: l.atualizadas, inalteradas: l.inalteradas } })));

      const { rows: pend } = await db.query<{
        id: string; sessao_id: string; entidade: Entidade; conector_id: string; lote_id: string; estado: PendenciaInativacao['estado']; candidatos: number; total_ativos: number;
        percentual: string; limite_pct: string; amostra: string[]; created_at: Date; expira_em: Date;
      }>(
        `select p.id, p.sessao_id, p.entidade, c.identificador as conector_id, p.lote_id, p.estado, p.candidatos, p.total_ativos, p.percentual::text, p.limite_pct::text,
                p.amostra, p.created_at, p.expira_em
           from integracao.pendencia_inativacao p join integracao.conector c on c.tenant_id = p.tenant_id and c.id = p.conector_id
          where p.tenant_id = $1 and p.estado = 'aguardando' and p.deleted_at is null order by p.created_at desc limit 100`,
        [tenantId],
      );
      const pendencias: PendenciaInativacao[] = pend.map((p) => ({
        id: p.id, sessao_id: p.sessao_id, entidade: p.entidade, conector_id: p.conector_id, lote_id: p.lote_id, estado: p.estado, candidatos: p.candidatos,
        total_ativos: p.total_ativos, percentual: Number(p.percentual), limite_pct: Number(p.limite_pct), amostra: p.amostra, criada_em: iso(p.created_at) as string,
        expira_em: iso(p.expira_em) as string, decidida_em: null, decidida_por: null, decidida_por_perfil: null, motivo_decisao: null,
      }));

      const { rows: reconc } = await db.query<{ entidade: Entidade; data_referencia: string; divergente: boolean; motivos: string[]; contagem_erp: string; contagem_macuxi: string }>(
        `select entidade, to_char(data_referencia, 'YYYY-MM-DD') as data_referencia, divergente, motivos, contagem_erp::text, contagem_macuxi::text
           from integracao.reconciliacao
          where tenant_id = $1 and deleted_at is null and data_referencia >= ($2::timestamptz)::date - $3::int
          order by data_referencia desc, entidade limit 100`,
        [tenantId, agoraIso, DIAS_RECONCILIACAO],
      );

      const { rows: porEstado } = await db.query<{ estado: string; n: number }>(
        'select estado, count(*)::int as n from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null group by estado',
        [tenantId],
      );
      const { rows: presos } = await db.query<{ pedido_uuid: string }>(
        `select pedido_uuid from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null and estado = 'enviado' and tentativas >= $2 limit 1000`,
        [tenantId, parametros.tentativasAlertaPedido],
      );
      const { rows: retidos } = await db.query<{ pedido_uuid: string; retencao_mensagem: string | null }>(
        'select pedido_uuid, retencao_mensagem from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null and retencao_codigo is not null limit 1000',
        [tenantId],
      );

      // ADR 0016: pedidos que exigem Conector mais novo que o que recebe os pedidos (versão do último sinal)
      const { rows: esperandoConector } = await db.query<{ pedido_uuid: string; exige_conector: string }>(
        `select pedido_uuid, exige_conector from integracao.pedido_fila_erp
          where tenant_id = $1 and deleted_at is null and exige_conector is not null and estado in ('pendente', 'enviado') limit 1000`,
        [tenantId],
      );
      const { rows: recebedor } = await db.query<{ versao_conector: string | null }>(
        'select versao_conector from integracao.conector where tenant_id = $1 and ativo and recebe_pedidos and deleted_at is null limit 1',
        [tenantId],
      );

      const { rows: falhos } = await db.query<{ entidade: Entidade; conector_id: string }>(
        `select l.entidade, c.identificador as conector_id from integracao.lote l join integracao.conector c on c.tenant_id = l.tenant_id and c.id = l.conector_id
          where l.tenant_id = $1 and l.status = 'falhou' and l.recebido_em > $2::timestamptz and l.deleted_at is null`,
        [tenantId, desde24h],
      );
      const { rows: descartes } = await db.query<{ pedido_uuid: string; produto_external_id: string }>(
        'select pedido_uuid, produto_external_id from integracao.pedido_retorno_erro where tenant_id = $1 and created_at > $2::timestamptz and resolvido_em is null and deleted_at is null',
        [tenantId, desde24h],
      );

      const alertas = montarAlertasMonitor({
        agora: agoraIso,
        conectores: resumos.map((r) => ({
          conector_id: r.conector_id,
          ativo: r.ativo,
          ultimo_sinal_em: r.ultimo_sinal_em,
          parado_por_versao: conectores.find((c) => c.id === r.id)?.parado_por_versao ?? false,
          situacao_versao: r.situacao_versao,
          chave_anterior_em_uso: r.chave?.anterior_prefixo != null && r.chave.anterior_valida_ate != null && Date.parse(r.chave.anterior_valida_ate) > agora.getTime(),
        })),
        lotesFalhosUltimas24h: falhos,
        pendenciasInativacao: pendencias,
        reconciliacoesDivergentes: reconc.filter((r) => r.divergente),
        pedidos: {
          presos: presos.map((p) => p.pedido_uuid),
          retidos: retidos.map((p) => p.pedido_uuid),
          retidosPorChaveErp: retidos.filter((p) => ehRetencaoPorChaveErp(p.retencao_mensagem)).map((p) => p.pedido_uuid),
        },
        retornosComItensDescartados24h: descartes,
        pedidosAguardandoConector: pedidosAguardandoConector(esperandoConector, recebedor[0]?.versao_conector ?? null),
      });

      const contagem = Object.fromEntries(ESTADOS_PEDIDO_ERP.map((e) => [e, 0])) as Record<(typeof ESTADOS_PEDIDO_ERP)[number], number>;
      for (const r of porEstado) if (r.estado in contagem) contagem[r.estado as keyof typeof contagem] = r.n;

      return {
        gerado_em: agoraIso,
        conectores: resumos,
        alertas,
        lotes_recentes: recentes.map(paraItem),
        cargas: cargas.map((c) => ({ entidade: c.entidade, estado: c.estado as EstadoCargaEntidade, lotes: c.lotes, com_erro: c.com_erro, aguardando: c.aguardando })),
        pendencias_inativacao: pendencias,
        reconciliacoes: reconc.map((r) => ({ entidade: r.entidade, data_referencia: r.data_referencia, divergente: r.divergente, motivos: r.motivos, contagem_erp: Number(r.contagem_erp), contagem_macuxi: Number(r.contagem_macuxi) })),
        pedidos: { por_estado: contagem, presos: presos.length, retidos: retidos.length },
      } as MonitorResumo;
    });
  },
};
