/**
 * Observabilidade mínima (T-0078): contagem de respostas por janela deslizante (5xx), resumo da outbox e alerta simples.
 *
 * - API: `createApp` conta cada resposta (`onResponse`) e `GET /v1/saude` devolve `dependencias` (banco e outbox),
 *   `metricas` (janela de 15 min) e `alertas` (códigos). O servidor (`servidor.ts`) registra a mesma linha no log a cada
 *   `MACUXI_METRICAS_INTERVALO_MS` (padrão 5 min), em `warn` quando há alerta.
 * - Worker: a mesma linha da outbox, lida com o papel `macuxi_worker` (`SQL_RESUMO_OUTBOX`).
 * - VM: `scripts/deploy/demo/alerta-saude.sh` lê `/v1/saude` e avisa quando `alertas` não está vazio.
 *
 * Nada aqui leva dado pessoal nem de tenant: só contagens, segundos e códigos.
 */
import { mensagemSegura } from './log-seguro';

export interface JanelaMetricas {
  janela_min: number;
  requisicoes: number;
  erros_4xx: number;
  erros_5xx: number;
}

export interface ResumoOutbox {
  /** Eventos com consumidor instalado ainda não publicados (e com tentativas sobrando). */
  pendentes: number;
  /** Eventos com as tentativas esgotadas (o despachante não tenta mais sozinho). */
  parados: number;
  /** Idade do pendente mais antigo em segundos; `null` = nenhum pendente. */
  mais_antigo_s: number | null;
}

/** `ausente` = a API subiu sem banco (testes, rota pública local). */
export type EstadoBanco = 'ok' | 'falha' | 'ausente';

export type CodigoAlerta = 'BANCO_FALHA' | 'ERROS_5XX' | 'OUTBOX_ATRASADA' | 'OUTBOX_PARADA';

export const LIMITES_ALERTA_PADRAO = Object.freeze({
  /** 5xx na janela de 15 min a partir do qual alerta. */
  erros5xxJanela: 5,
  /** Pendente mais antigo da outbox acima disto (s) = o worker parou ou está atrasado. */
  outboxAtrasoS: 600,
});

export type LimitesAlerta = typeof LIMITES_ALERTA_PADRAO;

export const JANELA_METRICAS_MIN = 15;

/** Contador por minuto, em memória (uma instância da API). Sem rota nem tenant: só o status. */
export function criarMetricasApi(op: { relogio?: () => Date; janelaMin?: number } = {}) {
  const relogio = op.relogio ?? (() => new Date());
  const janelaMin = op.janelaMin ?? JANELA_METRICAS_MIN;
  const desde = relogio().toISOString();
  const baldes = new Map<number, { requisicoes: number; erros_4xx: number; erros_5xx: number }>();
  let total = 0;
  let total5xx = 0;
  const minuto = () => Math.floor(relogio().getTime() / 60_000);
  const podar = (agora: number) => {
    for (const k of baldes.keys()) if (k <= agora - janelaMin) baldes.delete(k);
  };
  return {
    registrar(status: number): void {
      const m = minuto();
      podar(m);
      const b = baldes.get(m) ?? { requisicoes: 0, erros_4xx: 0, erros_5xx: 0 };
      b.requisicoes++;
      if (status >= 500) b.erros_5xx++;
      else if (status >= 400) b.erros_4xx++;
      baldes.set(m, b);
      total++;
      if (status >= 500) total5xx++;
    },
    janela(): JanelaMetricas {
      podar(minuto());
      const j: JanelaMetricas = { janela_min: janelaMin, requisicoes: 0, erros_4xx: 0, erros_5xx: 0 };
      for (const b of baldes.values()) {
        j.requisicoes += b.requisicoes;
        j.erros_4xx += b.erros_4xx;
        j.erros_5xx += b.erros_5xx;
      }
      return j;
    },
    total(): { desde: string; requisicoes: number; erros_5xx: number } {
      return { desde, requisicoes: total, erros_5xx: total5xx };
    },
  };
}

export type MetricasApi = ReturnType<typeof criarMetricasApi>;

/** Códigos de alerta (vazio = tudo bem). Banco `ausente` e outbox sem resumo não alertam: não há o que medir. */
export function avaliarAlertas(
  d: { banco: EstadoBanco; outbox: ResumoOutbox | null; erros_5xx: number },
  limites: LimitesAlerta = LIMITES_ALERTA_PADRAO,
): CodigoAlerta[] {
  const alertas: CodigoAlerta[] = [];
  if (d.banco === 'falha') alertas.push('BANCO_FALHA');
  if (d.erros_5xx >= limites.erros5xxJanela) alertas.push('ERROS_5XX');
  if (d.outbox && d.outbox.mais_antigo_s !== null && d.outbox.mais_antigo_s > limites.outboxAtrasoS) alertas.push('OUTBOX_ATRASADA');
  if (d.outbox && d.outbox.parados > 0) alertas.push('OUTBOX_PARADA');
  return alertas;
}

/** Linha de log das métricas (API e worker): só números e códigos. */
export function linhaDeMetricas(j: JanelaMetricas | null, outbox: ResumoOutbox | null, alertas: readonly CodigoAlerta[]) {
  return {
    tipo: 'metricas' as const,
    ...(j ?? {}),
    ...(outbox ? { outbox_pendentes: outbox.pendentes, outbox_parados: outbox.parados, outbox_mais_antigo_s: outbox.mais_antigo_s } : {}),
    alertas: [...alertas],
  };
}

/**
 * Resumo da outbox lido pelo `macuxi_worker` (todas as linhas, sem RLS por tenant; só as colunas com grant da 0003).
 * `$1` = eventos com consumidor instalado (os outros ficam na outbox de propósito), `$2` = tentativas máximas.
 */
export const SQL_RESUMO_OUTBOX = `
  select count(*) filter (where tentativas < $2)::int as pendentes,
         count(*) filter (where tentativas >= $2)::int as parados,
         extract(epoch from now() - min(ocorrido_em) filter (where tentativas < $2))::float8 as mais_antigo_s
    from plataforma.evento
   where publicado_em is null
     and nome = any($1::text[])`;

/** Normaliza a linha do resumo (o `pg` devolve `null` quando não há pendente). */
export function resumoDaLinha(l: { pendentes: number | string; parados: number | string; mais_antigo_s: number | string | null } | undefined): ResumoOutbox {
  if (!l) return { pendentes: 0, parados: 0, mais_antigo_s: null };
  const s = l.mais_antigo_s === null ? null : Math.max(0, Math.round(Number(l.mais_antigo_s)));
  return { pendentes: Number(l.pendentes), parados: Number(l.parados), mais_antigo_s: s };
}

/** Espera no máximo `ms` (sonda de saúde não pode pendurar a rota). */
export function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error('prazo esgotado')), ms);
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(timer));
}

/** Log mínimo das linhas de métricas (pino da API/worker ou o logger do Fastify). */
export interface LogMetricas {
  info(o: object, msg: string): void;
  warn(o: object, msg: string): void;
}

/**
 * Linha `tipo: metricas` da API (servidor.ts, a cada `MACUXI_METRICAS_INTERVALO_MS`): a mesma leitura do monitor externo,
 * o `/v1/saude` (sonda com cache e prazo), em `info` sem alerta e `warn` com alerta. Exportada para o teste L1 (T-0078).
 */
export async function registrarMetricasApi(
  app: { inject(op: { method: 'GET'; url: string }): PromiseLike<{ json(): unknown }> },
  log: LogMetricas,
): Promise<void> {
  try {
    const r = await app.inject({ method: 'GET', url: '/v1/saude' });
    const s = r.json() as { metricas: JanelaMetricas; dependencias: { outbox: ResumoOutbox | null }; alertas: CodigoAlerta[] };
    const linha = linhaDeMetricas(s.metricas, s.dependencias.outbox, s.alertas);
    if (s.alertas.length > 0) log.warn(linha, 'alerta');
    else log.info(linha, 'métricas');
  } catch (e) {
    log.warn({ tipo: 'metricas', erro: mensagemSegura(e) }, 'métricas indisponíveis');
  }
}

/**
 * Linha `tipo: metricas` do worker (worker.ts): `consultar` devolve a linha do `SQL_RESUMO_OUTBOX`; com o banco fora,
 * `warn` com `BANCO_FALHA` e a mensagem segura do erro (sem `detail` do Postgres).
 */
export async function registrarMetricasWorker(consultar: () => Promise<Parameters<typeof resumoDaLinha>[0]>, log: LogMetricas): Promise<void> {
  try {
    const outbox = resumoDaLinha(await consultar());
    const alertas = avaliarAlertas({ banco: 'ok', outbox, erros_5xx: 0 });
    if (alertas.length > 0) log.warn(linhaDeMetricas(null, outbox, alertas), 'alerta: outbox');
    else log.info(linhaDeMetricas(null, outbox, alertas), 'métricas da outbox');
  } catch (e) {
    log.warn({ ...linhaDeMetricas(null, null, ['BANCO_FALHA']), erro: mensagemSegura(e) }, 'alerta: banco');
  }
}
