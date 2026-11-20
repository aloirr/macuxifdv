/**
 * Hook do slot `rota.parada_complemento` (RN-CORE-52, RN-CORE-04): nome da vendedora da carteira do cliente, lido só do
 * aparelho (pull `carteira` do Core + visão do Gestor em cache). Nada novo é gravado; sem dado, devolve null.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';
import { complementoDaParada, membrosDaEquipeDaVisao, type VinculoCarteira } from '../../domain/membros-da-equipe';
import { useVisaoEmCache } from './visao-em-cache';

export function useComplementoDaParada(clienteId: string): string | null {
  const { motor, estado } = useMotorSync();
  const usuarioId = useAmbiente().usuario()?.id ?? null;
  const visao = useVisaoEmCache();
  const [vinculos, setVinculos] = useState<VinculoCarteira[]>([]);

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void motor.linhas<VinculoCarteira & LinhaSync>('carteira').catch(() => []).then((linhas) => {
      if (vivo) setVinculos(linhas.filter((v) => v.cliente_id === clienteId));
    });
    return () => {
      vivo = false;
    };
  }, [motor, estado.sincronizado_em, clienteId]);

  const membros = useMemo(() => membrosDaEquipeDaVisao(visao, usuarioId), [visao, usuarioId]);
  return useMemo(() => complementoDaParada(clienteId, vinculos, membros, usuarioId, new Date().toISOString()), [clienteId, vinculos, membros, usuarioId]);
}
