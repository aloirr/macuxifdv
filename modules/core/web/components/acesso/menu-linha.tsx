'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface ItemDoMenu {
  rotulo: string;
  onSelecionar: () => void;
  perigo?: boolean;
  testId?: string;
}

/** Menu "⋯" de uma linha de tabela: abre com clique, fecha com Esc, clique fora ou ao escolher. Alvos de 44 px. */
export function MenuDaLinha({ rotulo, itens, testId }: { rotulo: string; itens: readonly ItemDoMenu[]; testId?: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);
  if (itens.length === 0) return null;
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        onClick={() => setAberto((a) => !a)}
        data-testid={testId}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-transparent text-[20px] leading-none font-bold text-ink hover:border-field hover:bg-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {aberto && (
        <div id={id} role="menu" aria-label={rotulo} className="absolute top-full right-0 z-30 mt-1 flex min-w-[180px] flex-col rounded-xl border border-line bg-surface p-1 shadow-lg">
          {itens.map((i) => (
            <button
              key={i.rotulo}
              type="button"
              role="menuitem"
              data-testid={i.testId}
              onClick={() => {
                setAberto(false);
                i.onSelecionar();
              }}
              className={`flex min-h-[44px] items-center rounded-lg px-3 text-left text-[14px] font-semibold hover:bg-ground focus-visible:outline-2 focus-visible:outline-accent ${i.perigo ? 'text-danger' : 'text-ink'}`}
            >
              {i.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
