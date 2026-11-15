'use client';

/**
 * Abas do BKO (T-0104). Uso: `<Abas idBase="pedidos" rotulo="Situação do pedido" abas={...} valor={aba} onChange={setAba} />`
 * e um `<PainelAba idBase="pedidos" id="pendentes" ativo={aba === 'pendentes'}>` por aba.
 * Acessibilidade (padrão WAI-ARIA de abas): lista `tablist` com nome, cada aba `tab` ligada ao seu `tabpanel`, foco
 * itinerante (só a aba com foco entra no Tab; setas, Home e End movem o foco e já trocam a aba, pulando as desligadas,
 * com volta nas pontas). Aba ativa marcada por borda laranja + texto `text-accent-ink` (laranja puro em texto não passa AA).
 * Alvo de 44 px. Sem hooks: o estado é da tela (componente controlado).
 */

import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './ui';

export type ItemAba<T extends string = string> = {
  id: T;
  rotulo: string;
  /** Quantidade ao lado do rótulo: "Pendentes (3)". */
  contador?: number | null;
  desligada?: boolean;
  testid?: string;
};

const NUMERO = new Intl.NumberFormat('pt-BR');

/** "Pendentes (3)"; sem contador, só o rótulo. */
export function rotuloDaAba(rotulo: string, contador?: number | null): string {
  if (contador === undefined || contador === null || Number.isNaN(contador)) return rotulo;
  return `${rotulo} (${NUMERO.format(contador)})`;
}

export function idDaAba(idBase: string, id: string): string {
  return `${idBase}-aba-${id}`;
}

export function idDoPainel(idBase: string, id: string): string {
  return `${idBase}-painel-${id}`;
}

/** Aba que recebe o foco do Tab: a ativa, se ligada; senão a primeira ligada; -1 se todas desligadas. */
export function indiceComFoco<T extends string>(abas: ReadonlyArray<ItemAba<T>>, valor: T | null | undefined): number {
  const ativa = abas.findIndex((a) => a.id === valor);
  if (ativa >= 0 && !abas[ativa]?.desligada) return ativa;
  return abas.findIndex((a) => !a.desligada);
}

/**
 * Próxima aba para a tecla (ArrowRight/ArrowLeft com volta nas pontas, Home/End), pulando as desligadas.
 * `null` para outra tecla ou se não há aba ligada.
 */
export function indiceDaTecla(tecla: string, atual: number, desligadas: ReadonlyArray<boolean>): number | null {
  const n = desligadas.length;
  if (n === 0) return null;
  const ligada = (i: number) => !desligadas[i];
  const andar = (passo: 1 | -1): number | null => {
    for (let k = 1; k <= n; k++) {
      const j = (((atual + passo * k) % n) + n) % n;
      if (ligada(j)) return j;
    }
    return null;
  };
  switch (tecla) {
    case 'ArrowRight':
      return andar(1);
    case 'ArrowLeft':
      return andar(-1);
    case 'Home': {
      for (let j = 0; j < n; j++) if (ligada(j)) return j;
      return null;
    }
    case 'End': {
      for (let j = n - 1; j >= 0; j--) if (ligada(j)) return j;
      return null;
    }
    default:
      return null;
  }
}

const ABA_BASE =
  'relative -mb-px inline-flex min-h-[44px] shrink-0 items-center justify-center border-b-2 bg-transparent px-4 text-[15px] font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-transparent disabled:text-disabled';
const ABA_ATIVA = 'border-accent text-accent-ink';
const ABA_INATIVA = 'border-transparent text-ink-2 hover:border-field hover:text-ink';

/** Classes de uma aba (exportada para teste e para quem precisar da mesma cara num link). */
export function classeDaAba(ativa: boolean): string {
  return cx(ABA_BASE, ativa ? ABA_ATIVA : ABA_INATIVA);
}

export type PropsAbas<T extends string> = {
  abas: ReadonlyArray<ItemAba<T>>;
  valor: T;
  onChange: (id: T) => void;
  /** Nome da lista para leitor de tela (aria-label), ex.: "Situação do pedido". */
  rotulo: string;
  /** Prefixo dos ids de aba e painel; único na página. */
  idBase: string;
  testid?: string;
  className?: string;
};

export function Abas<T extends string>({ abas, valor, onChange, rotulo, idBase, testid = 'abas', className }: PropsAbas<T>) {
  const comFoco = indiceComFoco(abas, valor);
  const desligadas = abas.map((a) => Boolean(a.desligada));

  const aoTeclar = (e: KeyboardEvent<HTMLButtonElement>, atual: number) => {
    const prox = indiceDaTecla(e.key, atual, desligadas);
    if (prox === null) return;
    e.preventDefault();
    const botoes = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    botoes?.[prox]?.focus();
    const alvo = abas[prox];
    if (alvo && alvo.id !== valor) onChange(alvo.id);
  };

  return (
    <div role="tablist" aria-label={rotulo} aria-orientation="horizontal" data-testid={testid} className={cx('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {abas.map((a, i) => {
        const ativa = a.id === valor;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={idDaAba(idBase, a.id)}
            aria-controls={idDoPainel(idBase, a.id)}
            aria-selected={ativa}
            tabIndex={i === comFoco ? 0 : -1}
            disabled={a.desligada}
            data-testid={a.testid ?? `${testid}.${a.id}`}
            className={classeDaAba(ativa)}
            onClick={() => {
              if (!ativa && !a.desligada) onChange(a.id);
            }}
            onKeyDown={(e) => aoTeclar(e, i)}
          >
            {rotuloDaAba(a.rotulo, a.contador)}
          </button>
        );
      })}
    </div>
  );
}

export type PropsPainelAba = {
  idBase: string;
  id: string;
  ativo: boolean;
  children?: ReactNode;
  className?: string;
  testid?: string;
};

/** Conteúdo de uma aba: fica no DOM e só aparece quando ativo (`hidden` nos inativos). */
export function PainelAba({ idBase, id, ativo, children, className, testid }: PropsPainelAba) {
  return (
    <div
      role="tabpanel"
      id={idDoPainel(idBase, id)}
      aria-labelledby={idDaAba(idBase, id)}
      tabIndex={0}
      hidden={!ativo}
      data-testid={testid}
      className={cx('focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', className)}
    >
      {children}
    </div>
  );
}
