import type { ComponentType, ReactNode } from 'react';
import { nomeDoModuloAcesso } from '../../lib/acesso';

/**
 * Ícones dos módulos nas telas Usuários e Perfis de acesso. Mapa único id → ícone (o nome fica em `lib/acesso.ts`).
 * O kit (`packages/ui`) ainda não tem ícones de módulo: o mapa segue para o designer-ux levar ao kit.
 */
export interface IconeProps {
  size?: number;
  className?: string;
}

function Svg({ size = 18, className, children }: IconeProps & { children: ReactNode }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

const Geral = (p: IconeProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);
const Gestor = (p: IconeProps) => (
  <Svg {...p}>
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20H2" />
  </Svg>
);
const Pesquisa = (p: IconeProps) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1" />
    <path d="m9 13 2 2 4-4" />
  </Svg>
);
const Promotor = (p: IconeProps) => (
  <Svg {...p}>
    <path d="M3 9 5 4h14l2 5" />
    <path d="M4 9v11h16V9" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
  </Svg>
);
const Treinamento = (p: IconeProps) => (
  <Svg {...p}>
    <path d="m2 9 10-5 10 5-10 5Z" />
    <path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.500" />
  </Svg>
);
const Vendedor = (p: IconeProps) => (
  <Svg {...p}>
    <circle cx="9" cy="20" r="1.5" />
    <circle cx="18" cy="20" r="1.5" />
    <path d="M2 3h3l2.5 12h11L21 7H6" />
  </Svg>
);

/** id do módulo → ícone. */
export const ICONE_DO_MODULO: Readonly<Record<string, ComponentType<IconeProps>>> = {
  core: Geral,
  gestor: Gestor,
  pesquisa: Pesquisa,
  promotor: Promotor,
  treinamento: Treinamento,
  vendedor: Vendedor,
};

export function IconeDoModulo({ id, size, className }: IconeProps & { id: string }) {
  const Icone = ICONE_DO_MODULO[id] ?? Geral;
  return <Icone size={size} className={className} />;
}

/** Ícone com o nome para leitor de tela e dica (a coluna "Módulos" da lista de usuários). */
export function IconeComNome({ id }: { id: string }) {
  const nome = nomeDoModuloAcesso(id);
  return (
    <span role="img" aria-label={nome} title={nome} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ground text-ink">
      <IconeDoModulo id={id} />
    </span>
  );
}
