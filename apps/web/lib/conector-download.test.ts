/**
 * T-0098 e T-0190 — download por link temporário (Conector e APKs do Campo e do Gestão): validação da resposta pelos contratos
 * (`LinkDownloadConectorSchema`, `LinkDownloadAppSchema`) e só https, textos do pacote e da validade, e o que a tela faz em cada
 * falha (rota ausente ou sem pacote = "em breve"; app sem licença = uma linha, RN-CORE-67).
 */
import { describe, expect, it } from 'vitest';

import {
  DOWNLOAD_APPS,
  DOWNLOAD_CONECTOR,
  falhaDoDownload,
  LinkDownloadAppResposta,
  LinkDownloadConectorResposta,
  tamanhoLegivel,
  TEXTOS_DOWNLOAD_CONECTOR,
  textoDaValidade,
  textoDoPacote,
  urlDeDownloadValida,
} from './conector-download';
import { ErroPortal } from './portal-api';
import { ROTAS_PORTAL } from './portal-rotas';

const URL_PRESIGN = 'https://br-se1.magaluobjects.com/macuxi-conector/macuxi-conector-1.0.0-win-x64.zip?X-Amz-Expires=900&X-Amz-Signature=abc';

describe('rota', () => {
  it('POST /integracao/conector/download (proposta R-20261108-234517)', () => {
    expect(ROTAS_PORTAL.conectorDownload).toBe('/integracao/conector/download');
  });

  it('T-0190: POST /core/apps/download com { variante }, Campo antes do Gestão', () => {
    expect(ROTAS_PORTAL.appDownload).toBe('/core/apps/download');
    expect(DOWNLOAD_CONECTOR.rota).toBe(ROTAS_PORTAL.conectorDownload);
    expect(DOWNLOAD_APPS.map((p) => [p.rota, p.corpo, p.testId])).toEqual([
      ['/core/apps/download', { variante: 'campo' }, 'empresa-pagina.baixar-campo'],
      ['/core/apps/download', { variante: 'gestao' }, 'empresa-pagina.baixar-gestao'],
    ]);
  });
});

describe('LinkDownloadAppResposta (T-0190)', () => {
  const app = { url: 'https://br-se1.magaluobjects.com/macuxi-prod/pacotes/campo/Campo-Oficial-v1.0.19.apk?X-Amz-Signature=abc', expira_em: '2026-11-21T10:05:00.000Z', versao: '1.0.19', arquivo: 'Campo-Oficial-v1.0.19.apk', variante: 'campo' };
  it('pelo contrato do Core; url só https', () => {
    expect(LinkDownloadAppResposta.safeParse(app)).toEqual({ success: true, data: app });
    expect(LinkDownloadAppResposta.safeParse({ ...app, variante: 'outro' }).success).toBe(false);
    expect(LinkDownloadAppResposta.safeParse({ ...app, url: 'ftp://x/y.apk' }).success).toBe(false);
    expect(LinkDownloadAppResposta.safeParse({ ...app, url: 'http://bucket.exemplo.com/y.apk' }).success).toBe(false);
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
  it('pacote: só o tamanho (o nome do arquivo já está no link)', () => {
    expect(textoDoPacote({ ...base, versao: '1.0.0', arquivo: 'macuxi-conector-1.0.0-win-x64.zip', tamanho_bytes: 12_900_000 })).toBe('12,3 MB');
    expect(textoDoPacote({ ...base, versao: '1.0.0', arquivo: 'macuxi-conector-1.0.0-win-x64.zip' })).toBeNull();
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

  it('T-0190 apps: sem pacote ou sem storage = "em breve"; sem licença = linha própria (RN-CORE-67); outro 403 = sem acesso', () => {
    const [campo] = DOWNLOAD_APPS;
    expect(falhaDoDownload(new ErroPortal(404, 'APP_SEM_PACOTE', 'x'), campo)).toEqual({ tipo: 'em-breve' });
    expect(falhaDoDownload(new ErroPortal(503, 'ARMAZENAMENTO_INDISPONIVEL', 'x'), campo)).toEqual({ tipo: 'em-breve' });
    expect(falhaDoDownload(new ErroPortal(403, 'APP_SEM_LICENCA', 'x'), campo)).toEqual({ tipo: 'sem-licenca' });
    expect(falhaDoDownload(new ErroPortal(403, 'SEM_PERMISSAO', 'x'), campo)).toEqual({ tipo: 'erro', texto: 'Só quem administra a empresa no portal baixa os apps.' });
    // o código do app não vale para o Conector (e vice-versa)
    expect(falhaDoDownload(new ErroPortal(404, 'CONECTOR_SEM_PACOTE', 'x'), campo).tipo).toBe('erro');
    expect(falhaDoDownload(new ErroPortal(403, 'APP_SEM_LICENCA', 'x'))).toEqual({ tipo: 'erro', texto: TEXTOS_DOWNLOAD_CONECTOR.semAcesso });
  });

  it('T-0190 apps: textos', () => {
    const [campo, gestao] = DOWNLOAD_APPS;
    expect(campo?.textos.botao).toBe('Gerar o link do Macuxi Campo');
    expect(gestao?.textos.botao).toBe('Gerar o link do Macuxi Gestão');
    expect(gestao?.textos.baixar('Gestao-Oficial-v1.0.19.apk')).toBe('Baixar Gestao-Oficial-v1.0.19.apk');
    expect(campo?.textos.emBreve).toBe('em breve.');
    expect(gestao?.textos.emBreve).toBe('em breve.');
    expect(campo?.textos.semLicenca).toBe('sem licença. Peça ao suporte para ativar o módulo.');
  });
});
