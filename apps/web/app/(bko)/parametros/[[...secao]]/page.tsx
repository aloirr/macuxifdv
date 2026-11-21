'use client';

import { use } from 'react';
import { PaginaParametros } from '@/components/parametros-page';

/**
 * Página Parâmetros do BKO (ADR 0060, D3/D10): `/parametros/<secao>`; `/parametros` abre a primeira seção disponível. Rota
 * da plataforma (o segmento fixo vence o `[...caminho]` das páginas de módulo); as seções vêm de `lib/parametros.ts`.
 */
export default function Page({ params }: { params: Promise<{ secao?: string[] }> }) {
  const { secao } = use(params);
  return <PaginaParametros segmentos={secao ?? []} />;
}
