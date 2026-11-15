'use client';

// Vai para o kit (packages/ui) pelo RD-0416 e RD-0417; então só muda o import.

/**
 * Busca da lista com espera (revisão do BKO §P4): o texto digitado fica no campo na hora; o filtro (e a URL) só mudam 300 ms
 * depois da última tecla ou ao apertar Enter. Acompanha o valor externo (Limpar filtros, voltar do navegador).
 */
import { Button } from '@macuxi/ui/web';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

export const ESPERA_BUSCA_MS = 300;

export function useBuscaComEspera(valor: string, aoMudar: (v: string) => void, espera: number = ESPERA_BUSCA_MS) {
  const [texto, setTexto] = useState(valor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  // valor externo mudou (Limpar filtros, popstate): o campo acompanha
  useEffect(() => {
    setTexto(valor);
  }, [valor]);

  const cancelar = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelar, []);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const novo = e.target.value;
      setTexto(novo);
      cancelar();
      timer.current = setTimeout(() => {
        timer.current = null;
        aoMudarRef.current(novo);
      }, espera);
    },
    [espera],
  );
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    cancelar();
    aoMudarRef.current(e.currentTarget.value);
  }, []);

  return { value: texto, onChange, onKeyDown };
}

/** Botão "Limpar filtros" da barra de filtros: some quando não há filtro ligado. */
export function LimparFiltros({ ligado, onLimpar, testId = 'lista.limpar-filtros' }: { ligado: boolean; onLimpar: () => void; testId?: string }) {
  if (!ligado) return null;
  return (
    <Button size="sm" onClick={onLimpar} data-testid={testId}>
      Limpar filtros
    </Button>
  );
}
