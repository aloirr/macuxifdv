/**
 * Hook do painel de metas: lê `rota_parada`, `visita`, `indicador_diario` e `meta` do aparelho (offline) e recalcula
 * quando um sync termina ou a fila muda. A conta é `painelLocal` (domínio), igual à da API.
 */
import { itensParaSobrepor } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import type { IndicadorDiarioSync, MetaSync, RotaParadaSync, VisitaSync } from '../../contracts';
import { fusoDe } from './estado';
import { painelLocal, type LinhasMetas } from './metas-local';
import { useCore } from './usar-core';

export function usePainelMetas() {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [linhas, setLinhas] = useState<LinhasMetas | null>(null);

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const [paradas, visitas, diarios, metas] = await Promise.all([
        motor.linhas<RotaParadaSync>('rota_parada'),
        motor.linhas<VisitaSync>('visita'),
        motor.linhas<IndicadorDiarioSync>('indicador_diario'),
        motor.linhas<MetaSync>('meta'),
      ]);
      if (ativo) setLinhas({ paradas, visitas, diarios, metas });
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  return useMemo(
    () => (linhas ? painelLocal(linhas, itensParaSobrepor(estado), { usuarioId: core.vendedorId, fuso: fusoDe(core.estado.me), agora: new Date() }) : null),
    [linhas, estado.fila, estado.aceitos, core.vendedorId, core.estado.me],
  );
}
