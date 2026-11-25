/**
 * T-0190 e R-20261124-090942 item 04 — cartão "Apps" da aba Empresa, renderizado com `react-dom/server`:
 * - antes de gerar: uma linha por app com o nome e "Gerar link" (o link nunca vem pronto na página);
 * - com o link: "Baixar <arquivo>" em nova aba sem `opener`, o tamanho, "Copiar link", a validade com data e hora no fuso da empresa
 *   (24 h, ADR 0074) e o SHA-256 recolhido.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { classesDoBotao, cx } from '@macuxi/ui/web';
import { DOWNLOAD_APPS } from '@/lib/conector-download';

import { CartaoApps } from './cartao-apps';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

describe('CartaoApps', () => {
  it('antes de gerar: Macuxi Campo e Macuxi Gestão, cada um com "Gerar link" (nome acessível = o texto visível; o app na descrição), sem link', () => {
    const html = renderToStaticMarkup(<CartaoApps tenant={TENANT} fuso="America/Manaus" />);
    expect(html).toContain('>Apps<');
    for (const v of ['campo', 'gestao']) expect(html).toContain(`data-testid="empresa-pagina.baixar-${v}-gerar"`);
    expect(html).toContain('>Macuxi Campo<');
    expect(html).toContain('>Macuxi Gestão<');
    expect(html).not.toMatch(/<button[^>]*aria-label=/);
    expect(html.match(/aria-describedby="[^"]+"/g)).toHaveLength(2);
    expect(html.match(/>Gerar link</g)).toHaveLength(2);
    expect(html).not.toContain('href=');
  });

  it('com o link: Baixar, tamanho, Copiar link, validade com data e hora (Manaus) e o SHA-256 recolhido', () => {
    const [, gestao] = DOWNLOAD_APPS;
    const url = 'https://br-se1.magaluobjects.com/macuxi-prod/pacotes/gestao/Gestao-Oficial-v1.0.34.apk?X-Amz-Signature=abc';
    const sha256 = 'a'.repeat(64);
    const html = renderToStaticMarkup(
      <CartaoApps
        tenant={TENANT}
        fuso="America/Manaus"
        iniciais={{ [gestao!.testId]: { url, expira_em: '2026-11-26T14:15:00.000Z', versao: '1.0.34', arquivo: 'Gestao-Oficial-v1.0.34.apk', tamanho_bytes: 80_000_000, sha256 } }}
      />,
    );
    const linha = html.slice(html.indexOf('data-testid="empresa-pagina.baixar-gestao"'));
    expect(linha).toContain('data-testid="empresa-pagina.baixar-gestao-link"');
    expect(linha).toContain(`href="${url}"`);
    expect(linha).toContain('target="_blank"');
    expect(linha).toContain('rel="noreferrer noopener"');
    expect(linha).toContain('Baixar Gestao-Oficial-v1.0.34.apk');
    // secundário: a única ação principal da aba Empresa é "Trocar de plano"
    expect(linha).toContain(`class="${cx(classesDoBotao('secondary', 'sm'), 'no-underline')}"`);
    expect(linha).toContain('76,3 MB');
    expect(linha).toContain('data-testid="empresa-pagina.baixar-gestao-copiar"');
    expect(linha).toContain('O link vale até 26/11 às 10:15.');
    expect(linha).toContain('>Gerar novo link<');
    // SHA-256 recolhido (details sem `open`), com o botão de copiar
    expect(linha).toMatch(/<details data-testid="empresa-pagina\.baixar-gestao-sha"[^>]*>/);
    expect(linha).not.toMatch(/<details[^>]* open/);
    expect(linha).toContain('Copiar SHA-256');
    // o Campo segue sem link
    expect(html.slice(0, html.indexOf('data-testid="empresa-pagina.baixar-gestao"'))).not.toContain('href=');
  });
});
