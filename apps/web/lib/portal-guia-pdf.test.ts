/** Guia da API em PDF (spec portal-config-enxuto §10.2; S6, v1.0.23): rota pública, baixada sem sessão como o OpenAPI. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const baixados: { nome: string; tipo: string }[] = [];
vi.mock('@macuxi/platform-sdk/web', async (original) => ({
  ...(await original<typeof import('@macuxi/platform-sdk/web')>()),
  downloadBlob: (blob: Blob, nome: string) => void baixados.push({ nome, tipo: blob.type }),
}));

import { baixarDocumentoPublico } from './portal-api';
import { documentoPublicoFalso } from './portal-falso';
import { ENCAIXE_API_HUB, GUIA_PDF_HUB, OPENAPI_HUB } from './portal-rotas';

afterEach(() => {
  vi.unstubAllGlobals();
  baixados.length = 0;
});

describe('guia da API em PDF', () => {
  it('o botão baixa da rota pública same-origin, sem token nem tenant, com o nome da API', async () => {
    const fetchFalso = vi.fn(async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="macuxi-guia-api-v1.pdf"' } }));
    vi.stubGlobal('fetch', fetchFalso);
    expect(ENCAIXE_API_HUB.guiaPdf).toBe('/api-proxy/_publico/integracao/v1/guia.pdf');
    await baixarDocumentoPublico(ENCAIXE_API_HUB.guiaPdf ?? '', 'outro.pdf');
    expect(fetchFalso).toHaveBeenCalledWith(GUIA_PDF_HUB.viaProxy, { method: 'GET', cache: 'no-store', credentials: 'omit' });
    expect(baixados).toEqual([{ nome: 'macuxi-guia-api-v1.pdf', tipo: 'application/pdf' }]);
  });

  it('modo falso: o PDF e o OpenAPI de exemplo, sem sessão; outro caminho = rota ausente', async () => {
    const pdf = documentoPublicoFalso(GUIA_PDF_HUB.viaProxy);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain('macuxi-guia-api-v1.pdf');
    const texto = await pdf.text();
    expect(texto.startsWith('%PDF-1.4')).toBe(true);
    expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
    const doc = documentoPublicoFalso(OPENAPI_HUB.viaProxy);
    expect(((await doc.json()) as { openapi: string }).openapi).toBe('3.1.0');
    expect(documentoPublicoFalso('/api-proxy/_publico/outro').status).toBe(404);
  });
});
