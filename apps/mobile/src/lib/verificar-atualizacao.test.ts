/**
 * Item 19 do teste de campo do Campo v1.0.16 — "Verificar atualização" (desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2):
 * a rota pública da versão publicada, a comparação pelo `haVersaoNova` do SDK e o que o botão mostra em cada caso.
 */
import { ErroHttp, ErroSemConexao, type ClienteHttp } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { mensagemDaVerificacao, TEXTOS_ATUALIZACAO, verificarAtualizacao } from './verificar-atualizacao';

const APK = 'https://downloads.exemplo.com/Campo-Oficial-v1.0.17.apk';

function httpQue(responde: (caminho: string, query: unknown) => unknown): Pick<ClienteHttp, 'get'> & { pedidos: Array<[string, unknown]> } {
  const pedidos: Array<[string, unknown]> = [];
  return {
    pedidos,
    get: async <T,>(caminho: string, query?: unknown) => {
      pedidos.push([caminho, query]);
      return responde(caminho, query) as T;
    },
  };
}

const publicada = (versao: string, variante = 'campo') => ({ variante, versao, apk_url: APK, publicada_em: null });

describe('verificarAtualizacao (item 19)', () => {
  it('chama GET /app/versao com a variante do app (relativo ao /v1, como o ClienteHttp do shell)', async () => {
    const http = httpQue(() => publicada('1.0.16'));
    await verificarAtualizacao(http, 'gestao', '1.0.16');
    expect(http.pedidos).toEqual([['/app/versao', { variante: 'gestao' }]]);
  });

  it('versão publicada maior: "nova", com a versão e o link do APK', async () => {
    const r = await verificarAtualizacao(httpQue(() => publicada('1.0.17')), 'campo', '1.0.16');
    expect(r).toEqual({ tipo: 'nova', versao: '1.0.17', apkUrl: APK });
    expect(TEXTOS_ATUALIZACAO.atualizar('1.0.17')).toBe('Atualizar para 1.0.17');
    expect(mensagemDaVerificacao(r)).toBeNull();
  });

  it('comparação numérica: 1.0.10 é maior que 1.0.9', async () => {
    expect((await verificarAtualizacao(httpQue(() => publicada('1.0.10')), 'campo', '1.0.9')).tipo).toBe('nova');
  });

  it('mesma versão ou menor: "Você está na versão mais recente."', async () => {
    for (const v of ['1.0.16', '1.0.15']) {
      const r = await verificarAtualizacao(httpQue(() => publicada(v)), 'campo', '1.0.16');
      expect(r).toEqual({ tipo: 'atual' });
      expect(mensagemDaVerificacao(r)).toBe('Você está na versão mais recente.');
    }
  });

  it('sem rede ou modo sem sinal: mensagem curta para tentar de novo com internet', async () => {
    const r = await verificarAtualizacao(
      httpQue(() => {
        throw new ErroSemConexao();
      }),
      'campo',
      '1.0.16',
    );
    expect(r).toEqual({ tipo: 'sem_sinal' });
    expect(mensagemDaVerificacao(r)).toBe('Sem sinal. Tente de novo com internet.');
  });

  it('404 SEM_VERSAO, erro do servidor, resposta fora do contrato ou de outra variante: "tente mais tarde"', async () => {
    const respostas: Array<() => unknown> = [
      () => {
        throw new ErroHttp(404, 'SEM_VERSAO', 'sem versão');
      },
      () => {
        throw new ErroHttp(500, 'ERRO_INTERNO', 'falhou');
      },
      () => ({ ...publicada('1.0.17'), apk_url: 'http://inseguro.exemplo.com/a.apk' }),
      () => publicada('1.0.17', 'gestao'),
      () => null,
    ];
    for (const responde of respostas) {
      const r = await verificarAtualizacao(httpQue(responde), 'campo', '1.0.16');
      expect(r).toEqual({ tipo: 'indisponivel' });
      expect(mensagemDaVerificacao(r)).toBe('Não deu para verificar agora. Tente mais tarde.');
    }
  });

  it('versão do app ilegível: não pergunta ao servidor e não oferece atualização', async () => {
    const http = httpQue(() => publicada('9.9.9'));
    expect(await verificarAtualizacao(http, 'campo', undefined)).toEqual({ tipo: 'indisponivel' });
    expect(http.pedidos).toEqual([]);
  });

  it('antes de verificar, nenhuma mensagem', () => {
    expect(mensagemDaVerificacao(null)).toBeNull();
  });
});
