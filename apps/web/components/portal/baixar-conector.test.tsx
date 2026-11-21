/**
 * T-0098 e T-0190 — `BaixarPacote` (Conector na aba Integração, APKs no cartão "Apps"), renderizado com `react-dom/server`:
 * - antes de gerar: só o botão (o link nunca vem pronto na página);
 * - com o link gerado: o link real (nova aba, sem `opener`) com o nome do arquivo, só o tamanho embaixo e a validade.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DOWNLOAD_APPS, DOWNLOAD_CONECTOR, TEXTOS_DOWNLOAD_CONECTOR } from '@/lib/conector-download';

import { BaixarPacote } from './baixar-conector';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const URL_PRESIGN = 'https://br-se1.magaluobjects.com/macuxi-conector/macuxi-conector-1.0.0-win-x64.zip?X-Amz-Signature=abc';

describe('BaixarPacote', () => {
  it('antes de gerar: só o botão, sem link', () => {
    const html = renderToStaticMarkup(<BaixarPacote produto={DOWNLOAD_CONECTOR} tenant={TENANT} />);
    expect(html).toContain('data-testid="integracao.baixar-conector-gerar"');
    expect(html).toContain(TEXTOS_DOWNLOAD_CONECTOR.botao);
    expect(html).not.toContain('integracao.baixar-conector-link');
    expect(html).not.toContain('href=');
  });

  it('com o link: abre em nova aba sem opener, mostra o arquivo no link, só o tamanho embaixo e a validade', () => {
    const html = renderToStaticMarkup(
      <BaixarPacote
        produto={DOWNLOAD_CONECTOR}
        tenant={TENANT}
        inicial={{ url: URL_PRESIGN, expira_em: '2026-11-09T05:15:00.000Z', versao: '1.0.0', arquivo: 'macuxi-conector-1.0.0-win-x64.zip', tamanho_bytes: 12_900_000 }}
      />,
    );
    expect(html).toContain('data-testid="integracao.baixar-conector-link"');
    expect(html).toContain(`href="${URL_PRESIGN.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('Baixar macuxi-conector-1.0.0-win-x64.zip');
    expect(html).toContain('<span class="text-ink-2">12,3 MB</span>');
    expect(html).not.toContain('Versão 1.0.0');
    expect(html.split('macuxi-conector-1.0.0-win-x64.zip').length).toBe(3); // href e texto do link, nada embaixo
    expect(html).toContain('O link vale até ');
  });

  it('T-0190 apps: um botão por app antes de gerar; com o link do Gestão, o APK no link e só o tamanho embaixo', () => {
    const [campo, gestao] = DOWNLOAD_APPS;
    const antes = renderToStaticMarkup(<BaixarPacote produto={campo!} tenant={TENANT} />);
    expect(antes).toContain('data-testid="empresa-pagina.baixar-campo-gerar"');
    expect(antes).toContain('Gerar o link do Macuxi Campo');
    expect(antes).not.toContain('href=');
    const url = 'https://br-se1.magaluobjects.com/macuxi-prod/pacotes/gestao/Gestao-Oficial-v1.0.19.apk?X-Amz-Signature=abc';
    const html = renderToStaticMarkup(
      <BaixarPacote produto={gestao!} tenant={TENANT} inicial={{ url, expira_em: '2026-11-21T10:05:00.000Z', versao: '1.0.19', arquivo: 'Gestao-Oficial-v1.0.19.apk', tamanho_bytes: 80_000_000 }} />,
    );
    expect(html).toContain('data-testid="empresa-pagina.baixar-gestao-link"');
    expect(html).toContain('Baixar Gestao-Oficial-v1.0.19.apk');
    expect(html).toContain('<span class="text-ink-2">76,3 MB</span>');
    expect(html).not.toContain('Versão 1.0.19');
    expect(html.split('Gestao-Oficial-v1.0.19.apk').length).toBe(3); // href e texto do link, nada embaixo
    expect(html).toContain('rel="noreferrer noopener"');
  });
});
