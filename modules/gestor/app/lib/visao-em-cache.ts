/**
 * Visão da equipe em cache no aparelho (lida só do SQLite do módulo), compartilhada pelos hooks dos slots do Gestor.
 * Relê quando o sync termina; mantém a MESMA referência enquanto `calculado_em` não muda (re-renderizar não gera dado novo).
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useState } from 'react';
import type { VisaoEquipe } from '../../contracts';
import { criarCache } from './cache';

export function useVisaoEmCache(): VisaoEquipe | null {
  const { motor, estado } = useMotorSync();
  const [visao, setVisao] = useState<VisaoEquipe | null>(null);

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void criarCache(motor.armazenamentoDoModulo('gestor'))
      .ler('visao')
      .then((nova) => {
        if (vivo) setVisao((atual) => (atual && nova && atual.calculado_em === nova.calculado_em ? atual : (nova ?? null)));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [motor, estado.sincronizado_em]);

  return visao;
}
