/**
 * T-0103 (desenho §14): consome `catalogo.referencia.marca_desconhecida@1` e acrescenta o aviso `marca_concorrente_desconhecida`
 * aos `avisos` do lote que originou a linha. O lote pode estar concluído: o aviso é acréscimo (não muda status nem contagens).
 * Idempotente (ADR 0007: efeito e `evento_consumo` na mesma transação; reentrega não duplica o aviso). Lote inexistente: ignora.
 */
import { definirConsumidor, eventoTolerante, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_REFERENCIA_MARCA_DESCONHECIDA } from '../../catalogo/contracts';
import { acrescentarAvisosAoLote, avisoMarcaDesconhecida } from '../domain';
import type { AvisoLinha } from '../contracts';

type Evento = { produto_external_id: string; produto_codigo: string | null; marcas: string[]; lote_id: string };

export async function registrarAvisoMarcaDesconhecida(p: Evento, ctx: ContextoConsumo): Promise<void> {
  const tenantId = ctx.envelope.tenant_id;
  const { rows } = await ctx.db.query<{ avisos: AvisoLinha[] | null }>(
    'select avisos from integracao.lote where tenant_id = $1 and id = $2 for update',
    [tenantId, p.lote_id],
  );
  if (!rows[0]) return;
  const r = acrescentarAvisosAoLote(rows[0].avisos ?? [], [avisoMarcaDesconhecida(p)]);
  if (!r.alterou) return;
  await ctx.db.query('update integracao.lote set avisos = $3::jsonb where tenant_id = $1 and id = $2', [tenantId, p.lote_id, JSON.stringify(r.avisos)]);
}

export const consumidorMarcaDesconhecida = definirConsumidor({ evento: eventoTolerante(EVENTO_REFERENCIA_MARCA_DESCONHECIDA), executar: registrarAvisoMarcaDesconhecida });
