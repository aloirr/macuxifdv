import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Backoffice Macuxi', template: '%s · Backoffice Macuxi' },
  description: 'Backoffice Macuxi FDV: shell que monta as páginas dos módulos efetivos do usuário.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1E3350' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
