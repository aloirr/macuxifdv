/**
 * Expurgo diário do rastreamento (ADR 0061; desenho `docs/desenho/tracking.md` §5.4; RN-CORE-13), no worker.
 *
 * - Chama `core.expurgar_rastreamento(p_agora, p_limite)` (migração 0089, SECURITY DEFINER, EXECUTE só ao `macuxi_worker`): apaga
 *   de fato os pontos com mais de [90] dias e os resumos com mais de [5] anos, em lotes, de todos os tenants.
 * - Repete enquanto algum lote vem cheio, até `MAX_LOTES_EXPURGO` por rodada (o resto fica para o dia seguinte).
 * - Sem a função no banco (0089 ainda não aplicada), o worker não liga o job (`SQL_EXISTE_EXPURGO`).
 * - Log: só contagens e quantos tenants; nunca usuário nem coordenada.
 */

export const LOTE_EXPURGO = 10_000;
export const MAX_LOTES_EXPURGO = 100;
/** Uma vez por dia; o 1º ciclo roda na subida do worker. */
export const INTERVALO_EXPURGO_MS = 24 * 60 * 60_000;

export const SQL_EXPURGO_RASTREAMENTO = 'select tenant_id, pontos, resumos from core.expurgar_rastreamento($1::timestamptz, $2::int)';
export const SQL_EXISTE_EXPURGO = "select to_regprocedure('core.expurgar_rastreamento(timestamptz, integer)') is not null as ok";

export interface ResumoExpurgo {
  lotes: number;
  pontos: number;
  resumos: number;
  tenants: number;
}

type Consulta = { query(sql: string, params: unknown[]): Promise<{ rows: { tenant_id: string; pontos: number | string; resumos: number | string }[] }> };

export async function expurgarRastreamento(pool: Consulta, agora: Date, maxLotes = MAX_LOTES_EXPURGO): Promise<ResumoExpurgo> {
  const tenants = new Set<string>();
  let pontos = 0;
  let resumos = 0;
  let lotes = 0;
  for (;;) {
    const { rows } = await pool.query(SQL_EXPURGO_RASTREAMENTO, [agora.toISOString(), LOTE_EXPURGO]);
    lotes += 1;
    let p = 0;
    let r = 0;
    for (const l of rows) {
      tenants.add(l.tenant_id);
      p += Number(l.pontos);
      r += Number(l.resumos);
    }
    pontos += p;
    resumos += r;
    if ((p < LOTE_EXPURGO && r < LOTE_EXPURGO) || lotes >= maxLotes) break;
  }
  return { lotes, pontos, resumos, tenants: tenants.size };
}
