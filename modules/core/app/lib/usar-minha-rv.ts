/**
 * Hook da própria RV (T-0082): lê a cópia de `GET /v1/core/rv` guardada pela etapa `core-rv` (offline) e devolve a `VisaoMinhaRv`
 * pronta (`montarMinhaRv`). Recarrega quando um sync termina; nenhum timer (RN-CORE-23). `null` até a primeira leitura.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import type { RvLocal } from '../../contracts';
import { CHAVES } from './estado';
import { montarMinhaRv, validarCopiaRv, type VisaoMinhaRv } from './minha-rv';
import { useCore } from './usar-core';

export function useMinhaRv(): { visao: VisaoMinhaRv | null; erro: boolean } {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [copia, setCopia] = useState<{ valor: RvLocal | null } | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    motor
      .armazenamentoDoModulo('core')
      .ler<unknown>(CHAVES.rv)
      .then((v) => {
        if (ativo) {
          setCopia({ valor: validarCopiaRv(v) });
          setErro(false);
        }
      })
      .catch(() => {
        if (ativo) setErro(true);
      });
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  const visao = useMemo(() => (copia ? montarMinhaRv(copia.valor, core.vendedorId, core.tz) : null), [copia, core.vendedorId, core.tz]);
  return { visao, erro };
}
