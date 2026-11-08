/**
 * Metas e indicadores do mês só com as linhas do aparelho (offline-first, T-0020 fase 1; RN-CORE-20..22):
 * `rota_parada`, `visita` (⊕ check-ins ainda na fila), `indicador_diario` e `meta` do pull. A conta é a do domínio
 * (`painelDoUsuario`), a mesma que a API roda sobre o banco — o app e o BKO mostram os mesmos números. Puro.
 */
import type { ItemSobreposicao } from '@macuxi/platform-sdk';

import type { IndicadorDiarioSync, MetaSync, ParametroSync, RotaParadaSync, VisitaSync } from '../../contracts';
import { aplicarPendentesVisita, calendarioDoTenant, dataLocal, painelDoUsuario, type PainelDeMetas } from '../../domain';
import { pendentesDaFila } from './rota-local';

export interface LinhasMetas {
  paradas: readonly RotaParadaSync[];
  visitas: readonly VisitaSync[];
  diarios: readonly IndicadorDiarioSync[];
  metas: readonly MetaSync[];
  /** Pull `parametro`: traz `metas.dias_uteis_semana` (RN-CORE-26); ausente = seg–sáb. */
  parametros?: readonly ParametroSync[];
}

export function painelLocal(
  l: LinhasMetas,
  fila: readonly ItemSobreposicao[],
  o: { usuarioId: string; fuso: string; agora: Date; periodo?: string },
): PainelDeMetas & { periodo: string } {
  const hoje = dataLocal(o.agora, o.fuso);
  const periodo = o.periodo ?? hoje.slice(0, 7);
  const minhas = l.visitas.filter((v) => !v.deleted_at && v.usuario_id === o.usuarioId);
  const visitas = aplicarPendentesVisita([...minhas], pendentesDaFila(fila), { usuario_id: o.usuarioId, fuso: o.fuso });
  const p = painelDoUsuario({
    periodo,
    usuario_id: o.usuarioId,
    hoje,
    paradas: l.paradas,
    visitas,
    diarios: l.diarios,
    metas: l.metas,
    calendario: calendarioDoTenant((l.parametros ?? []).map((p) => ({ ...p, valor: p.valor }))),
  });
  return { ...p, periodo };
}
