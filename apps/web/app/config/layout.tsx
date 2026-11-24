import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: { default: 'Portal de implantação', template: '%s · Portal de implantação Macuxi' }, robots: { index: false, follow: false } };

/**
 * Portal de implantação (`fdv.macuxifdv.com.br/config`, ADR 0068; antes `config.macuxifdv.com.br`, T-0087, ADR 0029), fora do
 * layout do BKO (sem o menu dos módulos e sem a sessão do tenant). No host `bko.` antigo, o `proxy.ts` responde 404 antes de
 * chegar aqui.
 * Renderização sempre na requisição (`connection`): a CSP do portal leva um nonce novo por requisição, e o Next só põe o nonce
 * nos scripts de página dinâmica (a estática, gerada no build, sairia sem nonce e a CSP bloquearia tudo).
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  await connection();
  return children;
}
