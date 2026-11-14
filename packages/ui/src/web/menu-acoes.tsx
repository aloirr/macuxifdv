'use client';

/**
 * Menu "⋯" de ações (revisão do BKO, docs/design/telas/bko-revisao.md §P3): as ações de uma linha da tabela (ou as
 * secundárias da página) ficam atrás de um botão só, com o rótulo inteiro, nunca cortado ("Desativa", "Redefini senha").
 * Abre em posição `fixed` (nenhum quadro corta), fecha com Esc, clique fora, rolagem ou ao escolher; setas, Home e End
 * andam entre os itens. Ação de perigo (Desativar, Excluir) vai por último, em vermelho, depois de um traço.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { indiceNoMenu, posicaoDoMenu } from './tabela-dados';
import { cx } from './ui';

export interface AcaoDoMenu {
  id: string;
  rotulo: string;
  aoEscolher: () => void;
  /** Desativar, excluir, cancelar: vermelho e por último. */
  perigo?: boolean;
  desligada?: boolean;
  testId?: string;
}

export const IconMais = ({ size = 18 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="19" cy="12" r="1.9" />
  </svg>
);

/** Perigo por último: a ordem dentro de cada grupo é a da tela. */
export function ordenarAcoes(acoes: readonly AcaoDoMenu[]): AcaoDoMenu[] {
  return [...acoes.filter((a) => !a.perigo), ...acoes.filter((a) => a.perigo)];
}

const ALTURA_ITEM = 40;

export function MenuAcoes({ acoes, rotulo = 'Mais ações', testId }: { acoes: readonly AcaoDoMenu[]; rotulo?: string; testId?: string }) {
  const [aberto, setAberto] = useState(false);
  const [estilo, setEstilo] = useState<CSSProperties>({});
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const itens = ordenarAcoes(acoes);
  const id = useId();

  const fechar = useCallback((voltarFoco: boolean) => {
    setAberto(false);
    if (voltarFoco) botao.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    setEstilo(posicaoDoMenu(r, { largura: window.innerWidth, altura: window.innerHeight }, itens.length * ALTURA_ITEM + 10));
    const primeiro = lista.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    primeiro?.focus();
  }, [aberto, itens.length]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!lista.current?.contains(alvo) && !botao.current?.contains(alvo)) fechar(false);
    };
    const sair = () => fechar(false);
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', sair, true);
    window.addEventListener('resize', sair);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('scroll', sair, true);
      window.removeEventListener('resize', sair);
    };
  }, [aberto, fechar]);

  if (itens.length === 0) return null;

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      fechar(true);
      return;
    }
    const botoes = [...(lista.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const atual = botoes.findIndex((b) => b === document.activeElement);
    const prox = indiceNoMenu(e.key, atual, itens.map((a) => !!a.desligada));
    if (prox !== null) {
      e.preventDefault();
      botoes[prox]?.focus();
    }
  };

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        title={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          setAberto((v) => !v);
        }}
        className={cx(
          'inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          aberto && 'bg-ground text-ink',
        )}
      >
        <IconMais />
      </button>
      {aberto && (
        <div
          ref={lista}
          id={id}
          role="menu"
          aria-label={rotulo}
          onKeyDown={teclas}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', ...estilo }}
          className="z-[55] flex min-w-[200px] flex-col rounded-xl border border-line bg-surface py-1 shadow-lg"
        >
          {itens.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={a.desligada}
              data-testid={a.testId}
              onClick={() => {
                fechar(true);
                a.aoEscolher();
              }}
              className={cx(
                'flex h-10 items-center px-3.5 text-left text-[14px] font-medium whitespace-nowrap hover:bg-ground focus-visible:bg-ground focus-visible:outline-none disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent',
                a.perigo ? 'text-danger' : 'text-ink',
                a.perigo && i > 0 && !itens[i - 1]?.perigo && 'mt-1 border-t border-line-2',
              )}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
