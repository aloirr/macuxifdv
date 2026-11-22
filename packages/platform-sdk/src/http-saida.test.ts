/// <reference types="node" />
/**
 * Cliente HTTP de saída com proteção contra SSRF (ADR 0066; desenho integracao-modelos-erp §2.5; RN-INT-17 e RN-INT-20
 * propostas). Sem rede: resolver e transporte falsos; os casos do cliente padrão só exercitam a recusa antes da conexão.
 */
import { describe, expect, it } from 'vitest';
import {
  ErroHttpSaida,
  criarClienteHttpSaida,
  enderecoIpBloqueado,
  validarUrlSaida,
  type EnderecoResolvido,
  type PedidoTransporte,
  type RespostaHttpSaida,
} from './http-saida';

const PUBLICO: EnderecoResolvido = { address: '93.184.215.14', family: 4 };

async function erroDe(p: Promise<unknown>): Promise<ErroHttpSaida> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroHttpSaida) return e;
    throw e;
  }
  throw new Error('não lançou');
}

const ok = (corpo = '{"value":[]}'): RespostaHttpSaida => ({ status: 200, cabecalhos: { 'content-type': 'application/json' }, corpo: Buffer.from(corpo) });

function falso(dns: Record<string, string[]>, respostas: ((p: PedidoTransporte) => RespostaHttpSaida | Promise<RespostaHttpSaida>)[]) {
  const pedidos: PedidoTransporte[] = [];
  let agora = 1_000_000;
  const cliente = criarClienteHttpSaida({
    resolver: async (h) => {
      const r = dns[h];
      if (!r) throw new Error('ENOTFOUND');
      return r.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    },
    transporte: async (p) => {
      pedidos.push(p);
      const f = respostas[Math.min(pedidos.length - 1, respostas.length - 1)]!;
      return f(p);
    },
    agora: () => agora,
  });
  return { cliente, pedidos, avancar: (ms: number) => (agora += ms) };
}

describe('enderecoIpBloqueado', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '169.254.0.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '::',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::127.0.0.1',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd00:ec2::254',
    'ff02::1',
    'fec0::1',
    '64:ff9b::10.0.0.1',
    '2002:a9fe:a9fe::1',
    '2001:db8::1',
    '2001::1',
    'localhost',
    'não é ip',
    '',
  ])('%s é proibido', (ip) => {
    expect(enderecoIpBloqueado(ip)).toBe(true);
  });

  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '2002:808:808::1'])(
    '%s é permitido',
    (ip) => {
      expect(enderecoIpBloqueado(ip)).toBe(false);
    },
  );
});

describe('validarUrlSaida', () => {
  it('só https, sem usuário e senha na URL', () => {
    expect(validarUrlSaida('https://erp.exemplo.com.br:50000/b1s/v1').host).toBe('erp.exemplo.com.br:50000');
    expect(() => validarUrlSaida('http://erp.exemplo.com.br')).toThrow(expect.objectContaining({ codigo: 'ESQUEMA_PROIBIDO' }));
    expect(() => validarUrlSaida('file:///etc/passwd')).toThrow(expect.objectContaining({ codigo: 'ESQUEMA_PROIBIDO' }));
    expect(() => validarUrlSaida('https://manager:segredo@erp.exemplo.com.br')).toThrow(expect.objectContaining({ codigo: 'CREDENCIAL_NA_URL' }));
    expect(() => validarUrlSaida('erp.exemplo.com.br')).toThrow(expect.objectContaining({ codigo: 'URL_INVALIDA' }));
  });
});

describe('criarClienteHttpSaida: SSRF', () => {
  it('conecta só no endereço conferido, com o host original na URL', async () => {
    const f = falso({ 'erp.exemplo.com.br': [PUBLICO.address] }, [() => ok()]);
    const r = await f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/b1s/v1/Items?$top=100', chaveLimite: 'c1' });
    expect(r.status).toBe(200);
    expect(f.pedidos).toHaveLength(1);
    expect(f.pedidos[0]!.endereco).toEqual(PUBLICO);
    expect(f.pedidos[0]!.url.hostname).toBe('erp.exemplo.com.br');
  });

  it('nome que resolve para loopback, privado ou metadados: DESTINO_BLOQUEADO antes de conectar', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', 'fd00:ec2::254']) {
      const f = falso({ 'erp.exemplo.com.br': [ip] }, [() => ok()]);
      const e = await erroDe(f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/' }));
      expect(e.codigo).toBe('DESTINO_BLOQUEADO');
      expect(e.retentavel).toBe(false);
      expect(f.pedidos).toHaveLength(0);
    }
  });

  it('basta um endereço proibido entre os resolvidos para recusar', async () => {
    const f = falso({ 'erp.exemplo.com.br': [PUBLICO.address, '192.168.1.1'] }, [() => ok()]);
    expect((await erroDe(f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/' }))).codigo).toBe('DESTINO_BLOQUEADO');
  });

  it('IP literal na URL também passa pela conferência', async () => {
    const f = falso({}, [() => ok()]);
    expect((await erroDe(f.cliente.requisitar({ url: 'https://169.254.169.254/latest/meta-data/' }))).codigo).toBe('DESTINO_BLOQUEADO');
    expect((await erroDe(f.cliente.requisitar({ url: 'https://[::ffff:127.0.0.1]/' }))).codigo).toBe('DESTINO_BLOQUEADO');
    expect(f.pedidos).toHaveLength(0);
  });

  it('DNS que falha: DNS_FALHOU, retentável', async () => {
    const f = falso({}, [() => ok()]);
    const e = await erroDe(f.cliente.requisitar({ url: 'https://nao-existe.exemplo.com.br/' }));
    expect(e.codigo).toBe('DNS_FALHOU');
    expect(e.retentavel).toBe(true);
  });

  it('redirecionamento para o mesmo host é seguido e reconferido; 303 vira GET sem corpo', async () => {
    const dns: Record<string, string[]> = { 'erp.exemplo.com.br': [PUBLICO.address] };
    const f = falso(dns, [
      () => ({ status: 303, cabecalhos: { location: '/b1s/v1/Login2' }, corpo: Buffer.alloc(0) }),
      () => ok(),
    ]);
    const r = await f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/b1s/v1/Login', metodo: 'POST', corpo: '{}' });
    expect(r.status).toBe(200);
    expect(f.pedidos.map((p) => [p.metodo, p.url.pathname, p.corpo])).toEqual([
      ['POST', '/b1s/v1/Login', '{}'],
      ['GET', '/b1s/v1/Login2', undefined],
    ]);
  });

  it('redirecionamento do mesmo host com DNS trocado para endereço interno é recusado (rebinding)', async () => {
    const dns: Record<string, string[]> = { 'erp.exemplo.com.br': [PUBLICO.address] };
    const f = falso(dns, [
      () => {
        dns['erp.exemplo.com.br'] = ['127.0.0.1'];
        return { status: 307, cabecalhos: { location: '/outra' }, corpo: Buffer.alloc(0) };
      },
    ]);
    expect((await erroDe(f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/' }))).codigo).toBe('DESTINO_BLOQUEADO');
    expect(f.pedidos).toHaveLength(1);
  });

  it('redirecionamento para outro host, outra porta ou http: recusado', async () => {
    for (const [location, codigo] of [
      ['https://interno.exemplo.com.br/', 'REDIRECIONAMENTO_PROIBIDO'],
      ['https://erp.exemplo.com.br:8443/', 'REDIRECIONAMENTO_PROIBIDO'],
      ['http://erp.exemplo.com.br/', 'ESQUEMA_PROIBIDO'],
      ['https://169.254.169.254/', 'REDIRECIONAMENTO_PROIBIDO'],
    ] as const) {
      const f = falso({ 'erp.exemplo.com.br': [PUBLICO.address] }, [() => ({ status: 302, cabecalhos: { location }, corpo: Buffer.alloc(0) })]);
      expect((await erroDe(f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/' }))).codigo).toBe(codigo);
      expect(f.pedidos).toHaveLength(1);
    }
  });

  it('mais de 3 redirecionamentos: REDIRECIONAMENTOS_DEMAIS', async () => {
    const f = falso({ 'erp.exemplo.com.br': [PUBLICO.address] }, [() => ({ status: 302, cabecalhos: { location: '/de-novo' }, corpo: Buffer.alloc(0) })]);
    expect((await erroDe(f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/' }))).codigo).toBe('REDIRECIONAMENTOS_DEMAIS');
    expect(f.pedidos).toHaveLength(4);
  });
});

describe('criarClienteHttpSaida: limites', () => {
  it('60 chamadas por minuto por Conector; a 61ª espera a janela; outro Conector não é afetado', async () => {
    const f = falso({ 'erp.exemplo.com.br': [PUBLICO.address] }, [() => ok()]);
    for (let i = 0; i < 60; i++) await f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/', chaveLimite: 'c1' });
    const e = await erroDe(f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/', chaveLimite: 'c1' }));
    expect(e.codigo).toBe('LIMITE_POR_MINUTO');
    expect(e.retentavel).toBe(true);
    expect(e.esperarMs).toBe(60_000);
    await f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/', chaveLimite: 'c2' });
    f.avancar(60_000);
    await f.cliente.requisitar({ url: 'https://erp.exemplo.com.br/', chaveLimite: 'c1' });
    expect(f.pedidos).toHaveLength(62);
  });

  it('tempo esgotado: TEMPO_ESGOTADO, retentável, com o sinal abortado no transporte', async () => {
    const cliente = criarClienteHttpSaida({
      timeoutMs: 20,
      resolver: async () => [PUBLICO],
      transporte: (p) =>
        new Promise((_r, rej) => {
          p.sinal.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    });
    const e = await erroDe(cliente.requisitar({ url: 'https://erp.exemplo.com.br/' }));
    expect(e.codigo).toBe('TEMPO_ESGOTADO');
    expect(e.retentavel).toBe(true);
  });

  it('o erro não traz caminho, query, cabeçalho nem corpo: só código e host', async () => {
    const cliente = criarClienteHttpSaida({
      resolver: async () => [PUBLICO],
      transporte: async () => {
        throw new Error('ECONNRESET Authorization: Bearer abc123 senha=S3nh@');
      },
    });
    const e = await erroDe(
      cliente.requisitar({ url: 'https://erp.exemplo.com.br/api?appkey=CHAVE-SECRETA', cabecalhos: { authorization: 'Bearer abc123' }, corpo: 'senha=S3nh@' }),
    );
    expect(e.codigo).toBe('REDE');
    expect(e.message).toBe('saída HTTP recusada: REDE (erp.exemplo.com.br)');
    expect(JSON.stringify({ ...e, message: e.message })).not.toMatch(/CHAVE-SECRETA|abc123|S3nh@|appkey/);
  });
});

describe('cliente padrão (node:https e DNS do sistema): recusa antes de conectar', () => {
  const cliente = criarClienteHttpSaida();

  it.each([
    ['http://example.com/', 'ESQUEMA_PROIBIDO'],
    ['https://127.0.0.1/', 'DESTINO_BLOQUEADO'],
    ['https://[::1]:8443/', 'DESTINO_BLOQUEADO'],
    ['https://169.254.169.254/latest/meta-data/', 'DESTINO_BLOQUEADO'],
    ['https://10.0.0.1/', 'DESTINO_BLOQUEADO'],
  ])('%s → %s', async (url, codigo) => {
    expect((await erroDe(cliente.requisitar({ url }))).codigo).toBe(codigo);
  });
});
