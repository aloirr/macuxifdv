/**
 * T-0098 — download do Conector por link temporário: validação da resposta pelo contrato do Integração
 * (`LinkDownloadConectorSchema`) e só https, textos do pacote e da validade, e o que a tela faz em cada falha (rota ausente = "em breve").
 */
import { describe, expect, it } from 'vitest';

import { falhaDoDownload, LinkDownloadConectorResposta, tamanhoLegivel, TEXTOS_DOWNLOAD_CONECTOR, textoDaValidade, textoDoPacote, urlDeDownloadValida } from './conector-download';
import { ErroPortal } from './portal-api';
import { ROTAS_PORTAL } from './portal-rotas';

const URL_PRESIGN = 'https://br-se1.magaluobjects.com/macuxi-conector/macuxi-conector-1.0.0-win-x64.zip?X-Amz-Expires=900&X-Amz-Signature=abc';

describe('rota', () => {
  it('POST /integracao/conector/download (proposta R-20261108-234517)', () => {
    expect(ROTAS_PORTAL.conectorDownload).toBe('/integracao/conector/download');
  });
});

describe('LinkDownloadConectorResposta', () => {
  it('resposta completa', () => {
    const r = LinkDownloadConectorResposta.safeParse({
      url: URL_PRESIGN,
      expira_em: '2026-11-09T05:15:00.000Z',
      versao: '1.0.0',
      arquivo: 'macuxi-conector-1.0.0-win-x64.zip',
      tamanho_bytes: 12_900_000,
      sha256: 'a'.repeat(64),
    });
    expect(r).toEqual({
      success: true,
      data: {
        url: URL_PRESIGN,
        expira_em: '2026-11-09T05:15:00.000Z',
        versao: '1.0.0',
        arquivo: 'macuxi-conector-1.0.0-win-x64.zip',
        tamanho_bytes: 12_900_000,
        sha256: 'a'.repeat(64),
      },
    });
  });

  it('pelo contrato: tamanho e sha256 opcionais; expira_em, versao e arquivo obrigatórios; campo a mais sai', () => {
    const minimo = { url: URL_PRESIGN, expira_em: '2026-11-09T05:15:00.000Z', versao: '1.0.0', arquivo: 'macuxi-conector-1.0.0-win-x64.zip' };
    expect(LinkDownloadConectorResposta.safeParse({ ...minimo, publicado_em: 'x' })).toEqual({ success: true, data: minimo });
    expect(LinkDownloadConectorResposta.safeParse({ url: URL_PRESIGN }).success).toBe(false);
    expect(LinkDownloadConectorResposta.safeParse({ ...minimo, expira_em: 'amanhã' }).success).toBe(false);
    expect(LinkDownloadConectorResposta.safeParse({ ...minimo, tamanho_bytes: -1 }).success).toBe(false);
  });

  it('sem url, url não https ou corpo estranho: formato inesperado', () => {
    expect(LinkDownloadConectorResposta.safeParse({}).success).toBe(false);
    expect(LinkDownloadConectorResposta.safeParse(null).success).toBe(false);
    const resto = { expira_em: '2026-11-09T05:15:00.000Z', versao: '1.0.0', arquivo: 'x.zip' };
    expect(LinkDownloadConectorResposta.safeParse({ ...resto, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(LinkDownloadConectorResposta.safeParse({ ...resto, url: 'ftp://x/y.zip' }).success).toBe(false);
  });
});

describe('urlDeDownloadValida', () => {
  it('https sempre; http só localhost e fora da produção', () => {
    expect(urlDeDownloadValida(URL_PRESIGN, true)).toBe(true);
    expect(urlDeDownloadValida('http://localhost:9000/x.zip', false)).toBe(true);
    expect(urlDeDownloadValida('http://localhost:9000/x.zip', true)).toBe(false);
    expect(urlDeDownloadValida('http://bucket.exemplo.com/x.zip', false)).toBe(false);
    expect(urlDeDownloadValida('não é url', false)).toBe(false);
  });
});

describe('textos', () => {
  const base = { url: URL_PRESIGN, expira_em: '2026-11-09T05:15:00.000Z', versao: '', arquivo: '' };
  it('pacote: versão · tamanho, só o que veio (o arquivo já está no link)', () => {
    expect(textoDoPacote({ ...base, versao: '1.0.0', arquivo: 'macuxi-conector-1.0.0-win-x64.zip', tamanho_bytes: 12_900_000 })).toBe(`Versão 1.0.0 · ${tamanhoLegivel(12_900_000)}`);
    expect(textoDoPacote({ ...base, versao: '1.0.0' })).toBe('Versão 1.0.0');
    expect(textoDoPacote(base)).toBeNull();
  });

  it('tamanho em MB com uma casa ou em KB', () => {
    expect(tamanhoLegivel(12_900_000)).toBe('12,3 MB');
    expect(tamanhoLegivel(850 * 1024)).toBe('850 KB');
    expect(tamanhoLegivel(10)).toBe('1 KB');
  });

  it('validade com a hora de quem vê', () => {
    expect(textoDaValidade(base, () => '01:15')).toBe('O link vale até 01:15. Depois disso, gere outro.');
  });

  it('botão com o arquivo quando veio', () => {
    expect(TEXTOS_DOWNLOAD_CONECTOR.baixar('macuxi-conector-1.0.0-win-x64.zip')).toBe('Baixar macuxi-conector-1.0.0-win-x64.zip');
    expect(TEXTOS_DOWNLOAD_CONECTOR.baixar(null)).toBe('Baixar o Conector');
  });
});

describe('falhaDoDownload', () => {
  it('rota ausente, sem pacote ou sem storage = "em breve"', () => {
    expect(falhaDoDownload(new ErroPortal(404, 'NAO_ENCONTRADO', 'x'))).toEqual({ tipo: 'em-breve' });
    expect(falhaDoDownload(new ErroPortal(404, 'http_404', 'x'))).toEqual({ tipo: 'em-breve' });
    expect(falhaDoDownload(new ErroPortal(404, 'CONECTOR_SEM_PACOTE', 'x'))).toEqual({ tipo: 'em-breve' });
    expect(falhaDoDownload(new ErroPortal(503, 'ARMAZENAMENTO_INDISPONIVEL', 'x'))).toEqual({ tipo: 'em-breve' });
    expect(falhaDoDownload(new ErroPortal(501, 'http_501', 'x'))).toEqual({ tipo: 'em-breve' });
  });

  it('429 = aviso de espera; 403 = sem acesso; o resto = mensagem da API ou a padrão', () => {
    expect(falhaDoDownload(new ErroPortal(429, 'LIMITE', 'x'))).toEqual({ tipo: 'aviso', texto: TEXTOS_DOWNLOAD_CONECTOR.espera });
    expect(falhaDoDownload(new ErroPortal(403, 'SEM_PERMISSAO', 'x'))).toEqual({ tipo: 'erro', texto: TEXTOS_DOWNLOAD_CONECTOR.semAcesso });
    expect(falhaDoDownload(new ErroPortal(500, 'ERRO', 'O servidor falhou ao gerar o link.'))).toEqual({ tipo: 'erro', texto: 'O servidor falhou ao gerar o link.' });
    expect(falhaDoDownload(new Error('{"x":1}')).tipo).toBe('erro');
  });
});
