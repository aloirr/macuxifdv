/**
 * Hook do slot `rota.parada_complemento` (RN-CORE-52, RN-CORE-04): nome da vendedora da carteira do cliente, lido só do
 * aparelho (pull `carteira` do Core + visão do Gestor em cache). Nada novo é gravado; sem dado, devolve null.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';
import type { MembroDaEquipe } from '../../contracts';
import { complementoDaParada, membrosDaEquipeDaVisao, type VinculoCarteira } from '../../domain/membros-da-equipe';
import { criarCache } from './cache';

export function useComplementoDaParada(clienteId: string): string | null {
  const { motor, estado } = useMotorSync();
  const usuarioId = useAmbiente().usuario()?.id ?? null;
  const [dados, setDados] = useState<{ vinculos: VinculoCarteira[]; membros: MembroDaEquipe[] }>({ vinculos: [], membros: [] });

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const cache = criarCache(motor.armazenamentoDoModulo('gestor'));
    void Promise.all([motor.linhas<VinculoCarteira & LinhaSync>('carteira').catch(() => []), cache.ler('visao')]).then(([vinculos, visao]) => {
      if (vivo) setDados({ vinculos: vinculos.filter((v) => v.cliente_id === clienteId), membros: membrosDaEquipeDaVisao(visao, usuarioId) });
    });
    return () => {
      vivo = false;
    };
  }, [motor, estado.sincronizado_em, clienteId, usuarioId]);

  return useMemo(() => complementoDaParada(clienteId, dados.vinculos, dados.membros, usuarioId, new Date().toISOString()), [clienteId, dados, usuarioId]);
}
