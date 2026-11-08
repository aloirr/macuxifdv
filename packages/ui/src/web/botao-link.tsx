/**
 * Link com cara de botão do BKO (T-0104): para navegar (`href`), não para agir — ação é `<Button>`.
 * Uso: `<BotaoLink nivel="principal" href="/pedidos/novo">Novo pedido</BotaoLink>`; com o `<Link>` do Next, a tela aplica
 * `className={classeBotaoLink('secundario')}` (o kit não depende de next). Um só principal por tela.
 * Acessibilidade: alvo de 44 px, foco visível; `externo` abre em nova aba e avisa o leitor de tela; `desligado` vira
 * link sem `href` com `aria-disabled`, fora do Tab e com cara de desabilitado.
 * Sem `'use client'` e sem importar o `ui.tsx` (que é de cliente): serve também em componente de servidor do Next.
 */

import type { AnchorHTMLAttributes, ReactNode } from 'react';

const juntar = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export type NivelBotaoLink = 'principal' | 'secundario' | 'perigo';
export type TamanhoBotaoLink = 'md' | 'sm';

const BASE =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 font-semibold no-underline transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const TAMANHO: Record<TamanhoBotaoLink, string> = {
  md: 'rounded-xl px-4 text-[14px]',
  sm: 'rounded-[10px] px-3 text-[13px]',
};

/** Mesma cara do `<Button>` web por nível. */
const NIVEL: Record<NivelBotaoLink, string> = {
  principal: 'bg-ink text-white hover:bg-[#0b1218]',
  secundario: 'border border-field bg-surface text-ink hover:bg-ground',
  perigo: 'bg-danger text-white hover:bg-[#8d1f16]',
};

const NIVEL_DESLIGADO: Record<NivelBotaoLink, string> = {
  principal: 'cursor-not-allowed bg-disabled text-white',
  secundario: 'cursor-not-allowed border border-line bg-surface text-disabled',
  perigo: 'cursor-not-allowed bg-disabled text-white',
};

/** Classes do link-botão; o alvo de 44 px vale nos dois tamanhos. */
export function classeBotaoLink(nivel: NivelBotaoLink = 'secundario', tamanho: TamanhoBotaoLink = 'md', desligado = false): string {
  return juntar(BASE, TAMANHO[tamanho], desligado ? NIVEL_DESLIGADO[nivel] : NIVEL[nivel]);
}

export type PropsBotaoLink = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> & {
  href: string;
  nivel?: NivelBotaoLink;
  tamanho?: TamanhoBotaoLink;
  /** Abre em nova aba (`target="_blank"`, `rel="noopener noreferrer"`) e avisa "(abre em nova aba)" ao leitor de tela. */
  externo?: boolean;
  /** Sem `href`, `aria-disabled="true"`, fora do Tab e sem clique. */
  desligado?: boolean;
  testid?: string;
  children: ReactNode;
};

export function BotaoLink({ nivel = 'secundario', tamanho = 'md', href, externo, desligado, className, children, testid, ...rest }: PropsBotaoLink) {
  const classe = juntar(classeBotaoLink(nivel, tamanho, desligado), className);
  if (desligado) {
    // Link desligado (padrão WAI-ARIA): sem href não entra no Tab nem navega; role="link" mantém o papel anunciado.
    // Descarta clique, alvo e rel que a tela tenha passado.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { onClick, target, rel, tabIndex, ...resto } = rest;
    return (
      <a {...resto} role="link" aria-disabled="true" data-testid={testid} className={classe}>
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={href} data-testid={testid} className={classe} {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
      {externo && <span className="sr-only"> (abre em nova aba)</span>}
    </a>
  );
}
