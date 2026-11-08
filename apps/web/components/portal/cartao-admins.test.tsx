/**
 * T-0094 (R-20261108-111116; migração 0047; RN-CORE-33/35) — teste de componente do cartão "Administradores" do portal,
 * renderizado com `react-dom/server` e a lista já no cache do React Query:
 * - admin + vendedor (`entra_no_portal = false`) ganha a etiqueta "Entra só pelo app" (com a dica no `title`) e continua com
 *   "Redefinir senha";
 * - admin só admin (`entra_no_portal = true`) não ganha a etiqueta.
 */
import type { AdminDaEmpresa } from '@macuxi/platform-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TEXTOS_ADMINS } from '@/lib/portal-admins';

import { CartaoAdmins } from './cartao-admins';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const admin = (n: number, nome: string, x: Partial<AdminDaEmpresa> = {}): AdminDaEmpresa => ({
  usuario_id: `5d1e2c0a-7b3f-4a51-8c2d-0000000000${String(n).padStart(2, '0')}`,
  nome,
  email: `${nome.split(' ')[0]?.toLowerCase()}@uma.com.br`,
  ativo: true,
  bloqueado: false,
  tem_senha: true,
  trocar_senha: false,
  senha_expira_em: null,
  entra_no_portal: true,
  ...x,
});

function renderizar(lista: AdminDaEmpresa[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['portal', TENANT, 'admins'], lista);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CartaoAdmins tenant={TENANT} fuso="America/Manaus" />
    </QueryClientProvider>,
  );
}

/** Trecho da linha do admin `n` (do `<li>` dele até o próximo). */
const linha = (html: string, n: number) => {
  const inicio = html.indexOf(`data-testid="empresa-admins.item-5d1e2c0a-7b3f-4a51-8c2d-0000000000${String(n).padStart(2, '0')}"`);
  if (inicio < 0) throw new Error(`sem a linha ${n}`);
  const fim = html.indexOf('</li>', inicio);
  return html.slice(inicio, fim);
};

describe('cartão Administradores: quem não entra no portal', () => {
  it('admin + vendedor: etiqueta "Entra só pelo app" com a dica, e o "Redefinir senha" continua', () => {
    const html = renderizar([admin(1, 'Ana Souza', { entra_no_portal: true }), admin(7, 'Marcos Reis', { entra_no_portal: false })]);
    const marcos = linha(html, 7);
    expect(marcos).toContain(TEXTOS_ADMINS.soPeloApp);
    expect(marcos).toContain(`title="${TEXTOS_ADMINS.soPeloAppDica}"`);
    expect(marcos).toContain('data-testid="empresa-admins.redefinir"');
    const ana = linha(html, 1);
    expect(ana).not.toContain(TEXTOS_ADMINS.soPeloApp);
    expect(ana).toContain('data-testid="empresa-admins.redefinir"');
  });

  it('a etiqueta convive com as do ciclo de senha (bloqueado não tem o botão)', () => {
    const html = renderizar([admin(2, 'Carlos Lima', { bloqueado: true, entra_no_portal: false })]);
    const carlos = linha(html, 2);
    expect(carlos).toContain('Bloqueado');
    expect(carlos).toContain(TEXTOS_ADMINS.soPeloApp);
    expect(carlos).not.toContain('data-testid="empresa-admins.redefinir"');
  });
});
