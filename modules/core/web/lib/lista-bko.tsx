'use client';

/**
 * Peças comuns das listas do BKO revisadas pelo grupo B do Core (docs/design/telas/bko-revisao.md §P4, §P6 e §P7):
 * busca ao digitar com espera de 300 ms, "Limpar filtros" só com filtro ligado e o quadro da lista sem título,
 * que some quando não há linha (fica só o `EstadoVazio`, uma vez).
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Panel } from '@macuxi/ui/web';

export const ESPERA_BUSCA_MS = 300;

/**
 * Busca da lista com espera: o texto digitado fica no campo na hora; o termo aplicado (estado ou URL) só muda 300 ms
 * depois da última tecla ou ao apertar Enter. Acompanha o valor externo (Limpar filtros, voltar do navegador).
 */
export function useBuscaComEspera(valor: string, aoMudar: (v: string) => void, espera: number = ESPERA_BUSCA_MS) {
  const [texto, setTexto] = useState(valor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

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

/** Botão do fim da barra de filtros: só existe com algum filtro ligado. */
export function LimparFiltros({ ligado, onLimpar, testId = 'lista.limpar-filtros' }: { ligado: boolean; onLimpar: () => void; testId?: string }) {
  if (!ligado) return null;
  return (
    <Button size="sm" onClick={onLimpar} data-testid={testId}>
      Limpar filtros
    </Button>
  );
}

/** Quadro da lista principal: sem título (o `h1` já diz o que é) e sem quadro quando não há linha. */
export function QuadroDaLista({ vazia, vazio, children }: { vazia: boolean; vazio: ReactNode; children: ReactNode }) {
  if (vazia) return <>{vazio}</>;
  return <Panel>{children}</Panel>;
}

/** Frase do estado vazio: com filtro ligado "Nenhum <item> com esses filtros.", sem filtro "Nenhum <item> cadastrado.". */
export function fraseDoVazio(item: string, feminino: boolean, comFiltro: boolean): string {
  if (comFiltro) return `Nenhum${feminino ? 'a' : ''} ${item} com esses filtros.`;
  return `Nenhum${feminino ? 'a' : ''} ${item} cadastrad${feminino ? 'a' : 'o'}.`;
}
