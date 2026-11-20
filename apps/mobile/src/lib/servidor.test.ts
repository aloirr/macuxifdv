import { ehSemConexao, ErroHttp } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { CODIGO_SERVIDOR_INVALIDO, erroDoTesteServidor, testarServidor, type BuscarHttp, type ResultadoTesteServidor } from './servidor';

const TUNEL = 'https://vampire-populations-tractor-fabric.trycloudflare.com/v1';
const ERRADO = 'https://vampire-populations-tractor-fabric.trycloudfare.com/v1';

function resposta(status: number, corpo: unknown): BuscarHttp {
  return async () => ({ status, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
}

const chamadas: string[] = [];
const gravando =
  (b: BuscarHttp): BuscarHttp =>
  async (url, init) => {
    chamadas.push(url);
    return b(url, init);
  };

const op = (buscar: BuscarHttp, extra: Partial<{ exigirHttps: boolean; timeoutMs: number }> = {}) => ({ rota: '/saude', exigirHttps: true, buscar, ...extra });
const falhou = (r: ResultadoTesteServidor) => {
  if (r.ok) throw new Error('esperava falha');
  return r;
};

describe('teste do servidor: só um servidor Macuxi passa (R-20261101-023742-alexandre)', () => {
  it('JSON certo (200, servico macuxi-api): passa e diz o endereço testado e a versão', async () => {
    const r = await testarServidor(TUNEL, op(gravando(resposta(200, { ok: true, servico: 'macuxi-api', versao: '0.1.0', modulos: ['core'] }))));
    expect(r).toMatchObject({ ok: true, versao: '0.1.0', testado: `${TUNEL}/saude` });
    expect(r.mensagem).toBe(`Servidor Macuxi respondeu (versão 0.1.0). Testado: ${TUNEL}/saude`);
    expect(chamadas.at(-1)).toBe(`${TUNEL}/saude`);
  });

  it('site de terceiro que responde HTML a qualquer caminho: não é Macuxi', async () => {
    const r = falhou(await testarServidor(ERRADO, op(resposta(200, '<!doctype html><html><body>Parked domain</body></html>'))));
    expect(r.motivo).toBe('nao_macuxi');
    expect(r.mensagem).toMatch(/^Este endereço não é um servidor Macuxi: .*trycloudfare\.com\/v1\/saude respondeu com uma página/);
    expect(r.mensagem).toMatch(/ele termina em \/v1/);
  });

  it('JSON qualquer (ok: true sem servico, ou de outro serviço): não é Macuxi', async () => {
    expect(falhou(await testarServidor(ERRADO, op(resposta(200, { ok: true })))).mensagem).toMatch(/sem a identificação do Macuxi/);
    expect(falhou(await testarServidor(ERRADO, op(resposta(200, { ok: true, servico: 'outro', versao: '1' })))).motivo).toBe('nao_macuxi');
    // mock-api antigo (sem servico) também não passa
    expect(falhou(await testarServidor(TUNEL, op(resposta(200, { ok: true, version: 3 })))).motivo).toBe('nao_macuxi');
  });

  it('404 (endereço sem /v1, por exemplo): rota não encontrada, com a dica do /v1', async () => {
    const semV1 = TUNEL.replace(/\/v1$/, '');
    const r = falhou(await testarServidor(semV1, op(resposta(404, { message: 'Route GET:/saude not found' }))));
    expect(r).toMatchObject({ motivo: 'nao_encontrado', status: 404, testado: `${semV1}/saude` });
    expect(r.mensagem).toBe(`Este endereço não é um servidor Macuxi: ${semV1}/saude não existe (erro 404). Confira o endereço; ele termina em /v1.`);
  });

  it('5xx (túnel sem API atrás): não passa e sugere servidor fora do ar', async () => {
    const r = falhou(await testarServidor(TUNEL, op(resposta(502, '<html>Bad gateway</html>'))));
    expect(r).toMatchObject({ motivo: 'erro_do_servidor', status: 502 });
    expect(r.mensagem).toMatch(/fora do ar/);
  });

  it('falha de conexão (DNS, certificado, sem internet): diz o endereço testado', async () => {
    const r = falhou(
      await testarServidor(
        ERRADO,
        op(async () => {
          throw new TypeError('Network request failed');
        }),
      ),
    );
    expect(r.motivo).toBe('sem_resposta');
    expect(r.mensagem).toMatch(/^Não foi possível falar com https:\/\/.*trycloudfare\.com\/v1\/saude\. Confira o endereço; ele termina em \/v1\./);
  });

  it('timeout: aborta e diz quanto esperou', async () => {
    const pendurado: BuscarHttp = (_url, init) =>
      new Promise((_ok, erro) => {
        init.signal.addEventListener('abort', () => erro(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      });
    const r = falhou(await testarServidor(TUNEL, op(pendurado, { timeoutMs: 20 })));
    expect(r.motivo).toBe('tempo_esgotado');
    expect(r.mensagem).toMatch(/não respondeu em 0 s/);
  });

  it('fora do desenvolvimento só https; nem chega a chamar o endereço http', async () => {
    const antes = chamadas.length;
    const r = falhou(await testarServidor('http://192.168.0.10:8100/v1', op(gravando(resposta(200, { ok: true, servico: 'macuxi-api', versao: '1' })))));
    expect(r.motivo).toBe('endereco');
    expect(r.mensagem).toMatch(/https:\/\//);
    expect(chamadas.length).toBe(antes);
    // no desenvolvimento, http na rede local passa
    expect((await testarServidor('http://192.168.0.10:8100/v1', op(resposta(200, { ok: true, servico: 'macuxi-api', versao: '1' }), { exigirHttps: false }))).ok).toBe(true);
  });

  it('endereço sem https:// não é completado: falha sem chamar a rede', async () => {
    const r = falhou(await testarServidor('vampire.trycloudflare.com/v1', op(resposta(200, {}))));
    expect(r).toMatchObject({ motivo: 'endereco', testado: 'vampire.trycloudflare.com/v1/saude' });
  });
});

describe('erro do login quando o servidor não passou (formato combinado com o modulo-core)', () => {
  it('falha de conexão e timeout viram ErroSemConexao; o resto, ErroHttp SERVIDOR_INVALIDO', async () => {
    const semRede = falhou(
      await testarServidor(
        TUNEL,
        op(async () => {
          throw new TypeError('Network request failed');
        }),
      ),
    );
    expect(ehSemConexao(erroDoTesteServidor(semRede))).toBe(true);
    const html = erroDoTesteServidor(falhou(await testarServidor(ERRADO, op(resposta(200, '<html></html>')))));
    expect(html).toBeInstanceOf(ErroHttp);
    expect((html as ErroHttp).codigo).toBe(CODIGO_SERVIDOR_INVALIDO);
    expect((html as ErroHttp).status).toBe(200);
  });
});
