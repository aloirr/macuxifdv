'use client';

/**
 * Peças comuns das listas do BKO revisadas pelo grupo B do Core (docs/design/telas/bko-revisao.md §P4, §P6 e §P7):
 * busca ao digitar com espera de 300 ms, "Limpar filtros" só com filtro ligado e o quadro da lista sem título,
 * que some quando não há linha (fica só o `EstadoVazio`, uma vez).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Panel } from '@macuxi/ui/web';

export const ESPERA_BUSCA_MS = 300;

/** Texto do campo (imediato) e termo aplicado à consulta (300 ms depois de parar de digitar, ou já com Enter). */
export function useBuscaComEspera(ms = ESPERA_BUSCA_MS) {
  const [texto, setTexto] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTermo(texto.trim()), ms);
    return () => clearTimeout(t);
  }, [texto, ms]);
  return {
    texto,
    termo,
    setTexto,
    aplicar: () => setTermo(texto.trim()),
    limpar: () => {
      setTexto('');
      setTermo('');
    },
  };
}

/** Botão do fim da barra de filtros: só existe com algum filtro ligado. */
export function LimparFiltros({ ligado, onLimpar }: { ligado: boolean; onLimpar: () => void }) {
  if (!ligado) return null;
  return (
    <Button size="sm" onClick={onLimpar} data-testid="lista.limpar-filtros">
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
