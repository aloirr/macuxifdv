/**
 * Rota de um dia para o filtro padrão da Rota (R-20261115-074500): hoje é a rota efetiva do `useCore` (com as visitas do
 * aparelho); outro dia é a rota inteira daquele dia, montada das linhas do aparelho (offline). Sem rota no aparelho, null.
 */
import { useEffect, useState } from 'react';

import type { RouteDay } from '../../contracts';
import type { UsoCore } from './usar-core';

export function useRotaDoDia(core: UsoCore, data: string | null): { rota: RouteDay | null; carregando: boolean } {
  const [outra, setOutra] = useState<{ data: string; rota: RouteDay | null } | null>(null);
  const { armazem } = core;
  const sincronizadoEm = core.estado.sincronizadoEm;
  useEffect(() => {
    if (!data || !armazem) return;
    let vivo = true;
    void armazem.rotaDoDia(data).then((rota) => {
      if (vivo) setOutra({ data, rota });
    });
    return () => {
      vivo = false;
    };
  }, [armazem, data, sincronizadoEm]);
  if (!data) return { rota: core.rota, carregando: false };
  if (outra?.data !== data) return { rota: null, carregando: true };
  return { rota: outra.rota, carregando: false };
}
