/**
 * Visão da equipe em cache no aparelho (lida só do SQLite do módulo), compartilhada pelos hooks dos slots do Gestor.
 * Lida uma vez por ciclo de sync, num armazenamento por chave (motor, `sincronizado_em`) como o da carteira: N paradas e
 * N hooks chamam o loader uma vez e recebem a MESMA referência enquanto `calculado_em` não muda.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useSyncExternalStore } from 'react';
import type { VisaoEquipe } from '../../contracts';
import { chaveDoCiclo, criarArmazenamentoPorChave } from './armazenamento-por-chave';
import { criarCache } from './cache';

const mesmaVisao = (a: VisaoEquipe | null, b: VisaoEquipe | null): boolean => a === b || (!!a && !!b && a.calculado_em === b.calculado_em);

const armazenamento = criarArmazenamentoPorChave<VisaoEquipe | null>(null, mesmaVisao);

export function useVisaoEmCache(): VisaoEquipe | null {
  const { motor, estado } = useMotorSync();
  useEffect(() => {
    if (motor) armazenamento.solicitar(chaveDoCiclo(motor, estado.sincronizado_em), async () => (await criarCache(motor.armazenamentoDoModulo('gestor')).ler('visao')) ?? null);
  }, [motor, estado.sincronizado_em]);
  return useSyncExternalStore(armazenamento.assinar, armazenamento.obter, armazenamento.obter);
}
