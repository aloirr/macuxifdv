/**
 * T-0098 — "Baixar o Conector" da aba Integração, renderizado com `react-dom/server`:
 * - antes de gerar: só o botão (o link nunca vem pronto na página);
 * - com o link gerado: o link real (nova aba, sem `opener`), o tamanho do pacote e a validade.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TEXTOS_DOWNLOAD_CONECTOR } from '@/lib/conector-download';

import { BaixarConector } from './baixar-conector';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const URL_PRESIGN = 'https://br-se1.magaluobjects.com/macuxi-conector/macuxi-conector-1.0.0-win-x64.zip?X-Amz-Signature=abc';

describe('BaixarConector', () => {
  it('antes de gerar: só o botão, sem link', () => {
    const html = renderToStaticMarkup(<BaixarConector tenant={TENANT} />);
    expect(html).toContain('data-testid="integracao.baixar-conector-gerar"');
    expect(html).toContain(TEXTOS_DOWNLOAD_CONECTOR.botao);
    expect(html).not.toContain('integracao.baixar-conector-link');
    expect(html).not.toContain('href=');
  });

  it('com o link: abre em nova aba sem opener, mostra o arquivo no link, o tamanho e a validade', () => {
    const html = renderToStaticMarkup(
      <BaixarConector
        tenant={TENANT}
        inicial={{ url: URL_PRESIGN, expira_em: '2026-11-09T05:15:00.000Z', versao: '1.0.0', arquivo: 'macuxi-conector-1.0.0-win-x64.zip', tamanho_bytes: 12_900_000 }}
      />,
    );
    expect(html).toContain('data-testid="integracao.baixar-conector-link"');
    expect(html).toContain(`href="${URL_PRESIGN.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('Baixar macuxi-conector-1.0.0-win-x64.zip');
    expect(html).toContain('12,3 MB');
    expect(html).not.toContain('Versão');
    expect(html).toContain('O link vale até ');
  });
});
