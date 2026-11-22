'use client';

/**
 * Resto do cartão de base por CSV (v1.0.21; spec portal-config-enxuto §10 e §12: nenhum CSV fica no `config.`). O cartão saiu;
 * fica só o símbolo que `tela-empresa.tsx` ainda importa, sem tela, até a aba Bases sair dela. Depois, apagar este arquivo.
 */
import type { ItemOrdemCarga } from '@macuxi/integracao/contracts';

export function CartaoBase(_props: { item: ItemOrdemCarga; tenant: string; rotuloDepende: string | null }): null {
  return null;
}
