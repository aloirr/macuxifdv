'use client';

import { useCallback, useEffect, useState } from 'react';
import { type FiltrosMonitor, lerFiltros, urlComFiltros } from './filtros-url';

/** Estado do monitor na URL (`?historico=...&lote=...`): lê ao abrir e grava a cada mudança, sem recarregar a página. */
export function useFiltrosNaUrl(): [FiltrosMonitor, (patch: Partial<FiltrosMonitor>) => void] {
  const [filtros, setFiltros] = useState<FiltrosMonitor>(() => lerFiltros(typeof window === 'undefined' ? '' : window.location.search));

  // botão voltar/avançar do navegador
  useEffect(() => {
    const aoNavegar = () => setFiltros(lerFiltros(window.location.search));
    window.addEventListener('popstate', aoNavegar);
    return () => window.removeEventListener('popstate', aoNavegar);
  }, []);

  // grava na URL depois da mudança (fora da função de atualização do estado, que deve ser pura)
  useEffect(() => {
    const url = urlComFiltros(filtros, window.location);
    if (url !== null) window.history.replaceState(window.history.state, '', url);
  }, [filtros]);

  const mudar = useCallback((patch: Partial<FiltrosMonitor>) => setFiltros((atual) => ({ ...atual, ...patch })), []);

  return [filtros, mudar];
}
