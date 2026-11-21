/**
 * Leituras do Início do BKO (T-0189; RN-CORE-64). Os schemas dos outros módulos são ESTRUTURAIS de propósito (só os campos que o Início usa, sem
 * importar o código deles): a resposta real é validada pela API de cada módulo, que também checa perfil, escopo e licença.
 */
import { z } from 'zod';

const Instante = z.string();

/** `GET /v1/integracao/monitor` (`monitor.ver`): lotes recentes e o resumo dos pedidos no ERP. */
export const MonitorParaInicioSchema = z.object({
  lotes_recentes: z.array(z.object({ lote_id: z.string(), entidade: z.string(), status: z.string(), recebidas: z.number(), com_erro: z.number(), recebido_em: Instante })),
  resumo_pedidos: z.object({ presos_sem_retorno: z.number(), retidos_sem_mapeamento: z.number() }),
});
export type MonitorParaInicio = z.infer<typeof MonitorParaInicioSchema>;

/** `GET /v1/gestor/aprovacoes`: a fila do escopo de quem consulta. */
export const AprovacoesParaInicioSchema = z.object({ itens: z.array(z.object({ solicitada_em: Instante })), resumo: z.object({ total: z.number() }) });
export type AprovacoesParaInicio = z.infer<typeof AprovacoesParaInicioSchema>;

/** `GET /v1/gestor/alertas?status=aberto`. */
export const AlertasParaInicioSchema = z.object({ itens: z.array(z.object({ status: z.string() })) });

/** `GET /v1/gestor/ranking?indicador=atingimento_meta_pct&periodo=mensal`. */
export const RankingParaInicioSchema = z.object({
  linhas: z.array(z.object({ posicao: z.number().nullable(), nome: z.string(), valor: z.number().nullable(), vendas_cents: z.number() })),
});
export type RankingParaInicio = z.infer<typeof RankingParaInicioSchema>;

export const CAMINHOS_INICIO_BKO = {
  inicio: '/core/inicio-bko',
  monitor: '/integracao/monitor',
  aprovacoes: '/gestor/aprovacoes',
  alertas: '/gestor/alertas?status=aberto',
  ranking: '/gestor/ranking?indicador=atingimento_meta_pct&periodo=mensal',
} as const;

/** Mensagens paradas = pedidos presos sem retorno do ERP + retidos sem mapeamento. */
export const mensagensParadas = (m: MonitorParaInicio): number => m.resumo_pedidos.presos_sem_retorno + m.resumo_pedidos.retidos_sem_mapeamento;

/** Primeiros três do ranking que têm posição, na ordem. */
export const top3 = (r: RankingParaInicio) => r.linhas.filter((l) => l.posicao !== null).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0)).slice(0, 3);
