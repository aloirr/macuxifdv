/**
 * Abre a tela do termo uma vez por abertura do app enquanto o aceite da versão vigente estiver pendente (T-0156, spec §1; RN-CORE-13): o shell
 * chama este hook na raiz, depois do login e da carga. O app segue usável; "Agora não" fecha a tela e ela volta na próxima abertura.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';

import { useRastreamento } from '../../lib/usar-rastreamento';

let jaAbriuNestaAbertura = false;

export function useAbrirTermoPendente(): void {
  const r = useRastreamento();
  useEffect(() => {
    if (!r.carregado || r.situacao !== 'pendente' || jaAbriuNestaAbertura) return;
    jaAbriuNestaAbertura = true;
    router.navigate('/m/termo-rastreamento' as never);
  }, [r.carregado, r.situacao]);
}
