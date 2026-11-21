'use client';

import { useCallback, useEffect, useState } from 'react';
import { type FiltrosMonitor, lerFiltros, paraBusca } from './filtros-url';

/** Estado do monitor na URL (`?historico=...&lote=...`): lê ao abrir e grava a cada mudança, sem recarregar a página. */
export function useFiltrosNaUrl(): [FiltrosMonitor, (patch: Partial<FiltrosMonitor>) => void] {
  const [filtros, setFiltros] = useState<FiltrosMonitor>(() => lerFiltros(typeof window === 'undefined' ? '' : window.location.search));

  // botão voltar/avançar do navegador
  useEffect(() => {
    const aoNavegar = () => setFiltros(lerFiltros(window.location.search));
    window.addEventListener('popstate', aoNavegar);
    return () => window.removeEventListener('popstate', aoNavegar);
  }, []);

  const mudar = useCallback((patch: Partial<FiltrosMonitor>) => {
    setFiltros((atual) => {
      const novo = { ...atual, ...patch };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${paraBusca(novo)}`);
      return novo;
    });
  }, []);

  return [filtros, mudar];
}
