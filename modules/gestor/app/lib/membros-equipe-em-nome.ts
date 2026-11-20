/**
 * Hook do slot `pedido.equipe_em_nome` do Vendedor (RN-VEN-35, RN-CORE-04): membros do escopo de quem está logado, lidos só
 * da visão em cache. `[]` enquanto carrega; o array só é refeito quando a visão (`calculado_em`) ou o usuário mudam.
 */
import { useAmbiente } from '@macuxi/platform-sdk/react';
import { useMemo } from 'react';
import type { MembroEquipeEmNome } from '../../contracts';
import { membrosDaEquipeDaVisao } from '../../domain/membros-da-equipe';
import { useVisaoEmCache } from './visao-em-cache';

export function useMembrosEquipeEmNome(): MembroEquipeEmNome[] {
  const visao = useVisaoEmCache();
  const usuarioId = useAmbiente().usuario()?.id ?? null;
  return useMemo(() => membrosDaEquipeDaVisao(visao, usuarioId), [visao, usuarioId]);
}
