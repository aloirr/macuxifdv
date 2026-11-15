/**
 * T-0182 — teste de componente do cartão "Logo" do portal (spec docs/design/telas/logo-cliente.md §2), com `react-dom/server`:
 * os estados desenhados pela `VistaCartaoLogo` e, nos `CartoesMarca`, o admin do cliente sem botões (RN-CORE-33).
 */
import type { MarcaEmpresa } from '@macuxi/platform-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { estadoDoCartao } from '@/lib/portal-logo';

import { CartoesMarca, chaveMarca, VistaCartaoLogo } from './cartao-logo';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const MARCA: MarcaEmpresa = { tenant_id: TENANT, razao_social: 'Distribuidora Exemplo Norte Ltda', nome_fantasia: 'Exemplo Norte', logo: null };
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** A tag do botão com o testID (para conferir `disabled` e a classe). */
const botao = (html: string, id: string) => /<button[^>]*>/g.exec(html.slice(html.lastIndexOf('<button', html.indexOf(`data-testid="empresa-logo.${id}"`))))?.[0] ?? '';

const vista = (p: { escolhido?: boolean; salvando?: boolean; salva?: boolean; erro?: string | null }) =>
  renderToStaticMarkup(
    <VistaCartaoLogo
      estado={estadoDoCartao({ escolhido: Boolean(p.escolhido), salvando: Boolean(p.salvando), temLogoSalva: Boolean(p.salva) })}
      imagem={p.escolhido || p.salva ? 'blob:logo' : null}
      alt="Logo da Exemplo Norte"
      podeGravar
      erro={p.erro ?? null}
      aoTocar={() => undefined}
    />,
  );

describe('cartão Logo: os estados da spec', () => {
  it('1 · sem logo: caixa tracejada vazia, "Enviar logo" e os limites', () => {
    const html = vista({});
    expect(html).toContain('border-dashed');
    expect(html).not.toContain('empresa-logo.imagem');
    expect(texto(html)).toBe('Enviar logo PNG ou JPG · até 1 MB · pelo menos 200 px de altura');
  });
  it('2 · arquivo escolhido: a pré-visualização com o alt, "Salvar" (principal) e "Cancelar"', () => {
    const html = vista({ escolhido: true });
    expect(html).toContain('alt="Logo da Exemplo Norte"');
    expect(html).not.toContain('border-dashed');
    expect(botao(html, 'salvar')).toContain('bg-accent');
    expect(texto(html)).toBe('Salvar Cancelar PNG ou JPG · até 1 MB · pelo menos 200 px de altura');
  });
  it('3 · salvando: "Salvando…" e "Cancelar" desabilitados', () => {
    const html = vista({ escolhido: true, salvando: true });
    expect(botao(html, 'salvando')).toContain('disabled=""');
    expect(botao(html, 'cancelar-desabilitado')).toContain('disabled=""');
    expect(texto(html)).toContain('Salvando… Cancelar');
  });
  it('4 · logo salva: "Trocar" e "Remover" (texto em vermelho)', () => {
    const html = vista({ salva: true });
    expect(texto(html)).toBe('Trocar Remover PNG ou JPG · até 1 MB · pelo menos 200 px de altura');
    expect(botao(html, 'remover')).toContain('text-danger');
  });
  it('5 · arquivo recusado: o estado anterior com o erro no lugar dos limites, em região viva', () => {
    const html = vista({ erro: 'O arquivo passa de 1 MB. Envie um menor.' });
    expect(texto(html)).toBe('Enviar logo O arquivo passa de 1 MB. Envie um menor.');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('empresa-logo.limites');
  });
});

function renderizarMarca(podeGravar: boolean, marca: MarcaEmpresa = MARCA): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(chaveMarca(TENANT), marca);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CartoesMarca tenant={TENANT} podeGravar={podeGravar} />
    </QueryClientProvider>,
  );
}

describe('cartões Logo e Nome fantasia', () => {
  it('time da Macuxi: "Enviar logo", o seletor só de PNG e JPG, e o campo do nome fantasia', () => {
    const html = renderizarMarca(true);
    expect(html).toContain('data-testid="empresa-logo.enviar"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain('data-testid="empresa-nome-fantasia.campo"');
    expect(html).toContain('value="Exemplo Norte"');
    // o Logo vem antes do Nome fantasia
    expect(html.indexOf('empresa-logo')).toBeLessThan(html.indexOf('empresa-nome-fantasia'));
  });
  it('admin do cliente: sem botões, sem seletor e sem limites; o nome fantasia só para ler', () => {
    const html = renderizarMarca(false);
    expect(html).not.toMatch(/<button/);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('empresa-logo.limites');
    expect(html).toMatch(/data-testid="empresa-nome-fantasia.valor"[^>]*>Exemplo Norte</);
  });
  it.each([null, '', '   '])('sem nome fantasia (%j), o admin do cliente vê o campo vazio, sem a razão social nem texto', (nome) => {
    const html = renderizarMarca(false, { ...MARCA, nome_fantasia: nome });
    expect(html).not.toContain('Distribuidora Exemplo Norte Ltda');
    expect(html).not.toContain('empresa-nome-fantasia.valor');
    expect(html).toMatch(/<div data-testid="empresa-nome-fantasia.vazio"[^>]*><\/div>/);
    expect(html).not.toContain('<input');
  });
});
