import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: { default: 'Portal de implantação', template: '%s · Portal de implantação Macuxi' }, robots: { index: false, follow: false } };

/**
 * Portal de implantação (`config.macuxifdv.com.br`, T-0087; ADR 0029), fora do layout do BKO (sem o menu dos módulos e sem a
 * sessão do tenant). Fora do host `config.`, o `proxy.ts` responde 404 antes de chegar aqui.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
