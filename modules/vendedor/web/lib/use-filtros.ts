'use client';

import { useCallback, useEffect, useState } from 'react';
import { type FiltrosPedidos, lerFiltros, paraBusca } from './filtros-url';

/** Filtros da lista na URL (`?status=...`): lê ao abrir e grava a cada mudança, sem recarregar a página. */
export function useFiltrosNaUrl(): [FiltrosPedidos, (patch: Partial<FiltrosPedidos>) => void] {
  const [filtros, setFiltros] = useState<FiltrosPedidos>(() => lerFiltros(typeof window === 'undefined' ? '' : window.location.search));

  // botão voltar/avançar do navegador
  useEffect(() => {
    const aoNavegar = () => setFiltros(lerFiltros(window.location.search));
    window.addEventListener('popstate', aoNavegar);
    return () => window.removeEventListener('popstate', aoNavegar);
  }, []);

  const mudar = useCallback((patch: Partial<FiltrosPedidos>) => {
    setFiltros((atual) => {
      const novo = { ...atual, ...patch };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${paraBusca(novo)}`);
      return novo;
    });
  }, []);

  return [filtros, mudar];
}
