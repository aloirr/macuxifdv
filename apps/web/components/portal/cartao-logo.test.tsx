/**
 * T-0182 — teste de componente do cartão "Logo" do portal (spec docs/design/telas/logo-cliente.md §2), com `react-dom/server`:
 * os estados desenhados pela `VistaCartaoLogo` e, nos `CartaoMarca`, o admin do cliente sem botões (RN-CORE-33) e, sem logo, sem o cartão.
 * Item 15 (v1.0.17): o liga/desliga "Ocultar o logo da Macuxi", só para o time da Macuxi.
 */
import type { MarcaEmpresa } from '@macuxi/platform-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { estadoDoCartao } from '@/lib/portal-logo';

import { CartaoMarca, chaveMarca, VistaCartaoLogo, VistaOcultarMarca } from './cartao-logo';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const MARCA: MarcaEmpresa = { tenant_id: TENANT, razao_social: 'Distribuidora Exemplo Norte Ltda', nome_fantasia: 'Exemplo Norte', logo: null, ocultar_marca_macuxi: false };
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
      <CartaoMarca tenant={TENANT} podeGravar={podeGravar} />
    </QueryClientProvider>,
  );
}

describe('cartão Logo (o nome fantasia fica em Dados da empresa)', () => {
  it('time da Macuxi: "Enviar logo" e o seletor só de PNG e JPG; sem o nome fantasia', () => {
    const html = renderizarMarca(true);
    expect(html).toContain('data-testid="empresa-logo.enviar"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).not.toContain('empresa-nome-fantasia');
    expect(html).not.toContain('Nome fantasia');
  });
  it('admin do cliente sem logo salva: o cartão não aparece (ele não pode agir ali)', () => {
    expect(renderizarMarca(false)).toBe('');
  });
  it('admin do cliente com a logo salva: sem botões, sem seletor, sem limites e sem o nome fantasia', () => {
    const logo = { sha256: 'a'.repeat(64), tipo: 'image/png', tamanho_bytes: 1000, largura_px: 400, altura_px: 100, atualizada_em: '2026-11-01T12:00:00.000Z' } as const;
    const html = renderizarMarca(false, { ...MARCA, logo });
    expect(html).toContain('data-testid="empresa-logo"');
    expect(html).not.toMatch(/<button/);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('empresa-logo.limites');
    expect(html).not.toContain('Exemplo Norte<');
  });
});

describe('item 15: "Ocultar o logo da Macuxi"', () => {
  it('time da Macuxi: o liga/desliga no cartão da logo, com o estado salvo', () => {
    const desligado = renderizarMarca(true);
    expect(desligado).toContain('data-testid="empresa-logo.ocultar-marca"');
    expect(desligado).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*aria-labelledby="empresa-logo-ocultar-marca"/);
    expect(texto(desligado)).toContain('Ocultar o logo da Macuxi');
    expect(renderizarMarca(true, { ...MARCA, ocultar_marca_macuxi: true })).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });
  it('admin do cliente: não vê a opção', () => {
    const html = renderizarMarca(false, { ...MARCA, ocultar_marca_macuxi: true });
    expect(html).not.toContain('ocultar-marca');
    expect(texto(html)).not.toContain('Ocultar o logo da Macuxi');
  });
  it('gravando: a chave fica desabilitada; erro na linha de baixo, em região viva', () => {
    const html = renderToStaticMarkup(<VistaOcultarMarca ligado salvando erro="Não foi possível salvar. Tente de novo." aoMudar={() => undefined} />);
    expect(html).toMatch(/role="switch"[^>]*disabled=""/);
    expect(html).toMatch(/aria-live="polite"><span data-testid="empresa-logo.ocultar-marca.erro"/);
  });
});
