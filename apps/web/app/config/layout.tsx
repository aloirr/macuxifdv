import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Portal de implantação', robots: { index: false, follow: false } };

/** Portal de implantação (`config.macuxifdv.com.br`, T-0087), fora do layout do BKO (sem o menu dos módulos). */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
