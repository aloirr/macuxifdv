/**
 * T-0098 (ADR 0037): link temporário do pacote publicado (instalador do Conector), contra o S3 FALSO local (s3-falso.ts),
 * que confere a assinatura da query e a validade da URL. Nunca contra o bucket real.
 * Critérios: link com validade curta (padrão 5 min, 1 a 15) assinado só com a chave da API; pacote com nome e versão no
 * bucket (`ultimo.json`); falha fechada (503) sem S3, com bucket fora ou manifesto inválido; nada de URL, chave ou segredo
 * no log; a rota do módulo recebe a porta em `ctx.pacotes`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definirModuloApi, ErroHttpModulo, SERVICO_PACOTES_DESLIGADO, VALIDADE_LINK_PACOTE_S, type RotaModulo, type ServicoPacotes } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarClienteS3, preAssinarGetS3 } from '../src/armazenamento-s3';
import { executarPublicarPacote, publicarPacote } from '../src/cli/publicar-pacote';
import { criarPacotesS3, lerPacotesDoAmbiente } from '../src/pacotes';
import { cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, vendedorApi } from './apoio';
import { CRED_TESTE, subirS3Falso, type S3Falso } from './s3-falso';

const AGORA = new Date('2026-11-09T12:00:00Z');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);

describe('preAssinarGetS3', () => {
  it('confere com o exemplo de URL pré-assinada da documentação da AWS (SigV4 por query string)', () => {
    const url = preAssinarGetS3(
      { protocolo: 'https:', host: 'examplebucket.s3.amazonaws.com', caminho: '/test.txt' },
      { chaveId: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1' },
      new Date('2013-05-24T00:00:00Z'),
      86_400,
    );
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('validade fora de 1 s a 7 dias = erro de programação', () => {
    const p = { protocolo: 'https:', host: 'h', caminho: '/b/x' };
    expect(() => preAssinarGetS3(p, CRED_TESTE, AGORA, 0)).toThrow();
    expect(() => preAssinarGetS3(p, CRED_TESTE, AGORA, 604_801)).toThrow();
  });
});

describe('pacotes × S3 falso', () => {
  let s3: S3Falso;
  beforeAll(async () => {
    s3 = await subirS3Falso();
  });
  afterAll(async () => {
    await s3?.fechar();
  });
  const cliente = (extra: Partial<Parameters<typeof criarClienteS3>[0]> = {}) =>
    criarClienteS3({ endpoint: s3.endpoint, regiao: CRED_TESTE.regiao, bucket: s3.bucket, chaveId: CRED_TESTE.chaveId, segredo: CRED_TESTE.segredo, agora: () => AGORA, ...extra });
  const avisos: Record<string, unknown>[] = [];
  const log = { warn: (o: Record<string, unknown>) => void avisos.push(o) };
  const servico = (prefixo = 'pacotes/', extra: Partial<Parameters<typeof criarClienteS3>[0]> = {}) => criarPacotesS3(cliente(extra), { prefixo, validadeS: 300, log });

  it('sem pacote publicado = null (a rota responde o próprio 404)', async () => {
    expect(await servico('vazio/').linkDoUltimo('conector')).toBeNull();
  });

  it('publica pacote e ultimo.json; o link baixa o pacote com o nome do arquivo e vale 5 min', async () => {
    const m = await publicarPacote(cliente(), 'pacotes/', { produto: 'conector', arquivo: 'macuxi-conector-1.3.0-win-x64.zip', versao: '1.3.0', bytes: ZIP, agora: AGORA });
    expect(s3.objetos.get(`/${s3.bucket}/pacotes/conector/macuxi-conector-1.3.0-win-x64.zip`)).toEqual(Buffer.from(ZIP));
    expect(s3.tipos.get(`/${s3.bucket}/pacotes/conector/macuxi-conector-1.3.0-win-x64.zip`)).toBe('application/zip');
    expect(JSON.parse(s3.objetos.get(`/${s3.bucket}/pacotes/conector/ultimo.json`)!.toString('utf8'))).toEqual(m);
    expect(m).toMatchObject({ versao: '1.3.0', tamanho_bytes: ZIP.byteLength, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), publicado_em: AGORA.toISOString() });

    const l = await servico().linkDoUltimo('conector');
    expect(l).toMatchObject({ versao: '1.3.0', arquivo: 'macuxi-conector-1.3.0-win-x64.zip', tamanho_bytes: ZIP.byteLength, sha256: m.sha256 });
    expect(l!.expira_em).toBe(new Date(AGORA.getTime() + 300_000).toISOString());
    expect(l!.url).not.toContain(CRED_TESTE.segredo);
    expect(new URL(l!.url).searchParams.get('X-Amz-Expires')).toBe('300');

    s3.agora = () => new Date(AGORA.getTime() + 60_000);
    const r = await fetch(l!.url);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(ZIP);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="macuxi-conector-1.3.0-win-x64.zip"');
  });

  it('link vencido ou adulterado (outro arquivo, validade maior) = 403 do bucket', async () => {
    const l = (await servico().linkDoUltimo('conector'))!;
    s3.agora = () => new Date(AGORA.getTime() + 301_000);
    expect((await fetch(l.url)).status).toBe(403);
    s3.agora = () => AGORA;
    expect((await fetch(l.url.replace('X-Amz-Expires=300', 'X-Amz-Expires=900'))).status).toBe(403);
    expect((await fetch(l.url.replace('1.3.0-win-x64.zip', '1.3.0-win-x86.zip'))).status).toBe(403);
    expect((await fetch(l.url)).status).toBe(200);
  });

  it('manifesto inválido, bucket com erro ou fora do ar = 503 ARMAZENAMENTO_INDISPONIVEL; log sem URL nem segredo', async () => {
    s3.objetos.set(`/${s3.bucket}/ruim/conector/ultimo.json`, Buffer.from('{"versao":"1","arquivo":"../x"}'));
    s3.objetos.set(`/${s3.bucket}/lixo/conector/ultimo.json`, Buffer.from('não é json'));
    avisos.length = 0;
    for (const s of [servico('ruim/'), servico('lixo/')]) {
      await expect(s.linkDoUltimo('conector')).rejects.toMatchObject({ status: 503, codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
    }
    s3.falharProxima(500);
    const e = await servico().linkDoUltimo('conector').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroHttpModulo);
    expect(e).toMatchObject({ status: 503 });
    await expect(servico('pacotes/', { endpoint: 'http://127.0.0.1:9', timeoutMs: 2_000 }).linkDoUltimo('conector')).rejects.toMatchObject({ status: 503 });
    expect(avisos.map((a) => a.codigo ?? a.status ?? a.erro)).toEqual(['PACOTE_MANIFESTO_INVALIDO', 'PACOTE_MANIFESTO_INVALIDO', 500, expect.any(String)]);
    const texto = JSON.stringify(avisos);
    for (const proibido of [CRED_TESTE.segredo, CRED_TESTE.chaveId, 'X-Amz-Signature', 'http']) expect(texto).not.toContain(proibido);
  });

  it('CLI: --simular só calcula; publicar regrava (idempotente); argumentos inválidos param antes do bucket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'macuxi-pacote-'));
    const arquivo = join(dir, 'macuxi-conector-1.4.0-win-x64.zip');
    writeFileSync(arquivo, ZIP);
    const env = {
      MACUXI_S3_ENDPOINT: s3.endpoint,
      MACUXI_S3_REGIAO: CRED_TESTE.regiao,
      MACUXI_S3_BUCKET: s3.bucket,
      MACUXI_S3_CHAVE_ID: CRED_TESTE.chaveId,
      MACUXI_S3_SEGREDO: CRED_TESTE.segredo,
    };
    const antes = s3.pedidos;
    expect(await executarPublicarPacote(['conector', arquivo, '--versao', '1.4.0', '--simular'], env, AGORA)).toMatchObject({ arquivo: 'macuxi-conector-1.4.0-win-x64.zip', versao: '1.4.0' });
    expect(s3.pedidos).toBe(antes);
    await executarPublicarPacote(['conector', arquivo, '--versao', '1.4.0'], env, AGORA);
    await executarPublicarPacote(['conector', arquivo, '--versao', '1.4.0'], env, AGORA);
    expect((await servico().linkDoUltimo('conector'))?.versao).toBe('1.4.0');
    await expect(executarPublicarPacote(['outro', arquivo, '--versao', '1.4.0'], env)).rejects.toThrow(/produto inválido/);
    await expect(executarPublicarPacote(['conector', arquivo], env)).rejects.toThrow(/--versao/);
    await expect(executarPublicarPacote(['conector', arquivo, '--versao', 'v1'], env)).rejects.toThrow();
  });
});

describe('lerPacotesDoAmbiente', () => {
  const S3 = {
    MACUXI_ARQUIVOS_DRIVER: 's3',
    MACUXI_S3_ENDPOINT: 'https://br-se1.magaluobjects.com',
    MACUXI_S3_REGIAO: 'br-se1',
    MACUXI_S3_BUCKET: 'macuxi-demo',
    MACUXI_S3_CHAVE_ID: 'id-nao-real',
    MACUXI_S3_SEGREDO: 'segredo-nao-real',
    MACUXI_S3_PREFIXO: 'arquivos/',
  };

  it('sem S3 (disco, dev e CI): desligado, e a porta responde 503', async () => {
    const p = lerPacotesDoAmbiente({});
    expect(p.descricao).toMatch(/desligado/);
    expect(p.criar()).toBe(SERVICO_PACOTES_DESLIGADO);
    await expect(p.criar().linkDoUltimo('conector')).rejects.toMatchObject({ status: 503, codigo: 'ARMAZENAMENTO_INDISPONIVEL' });
  });

  it('com S3: padrão pacotes/ e 300 s; descrição sem credencial', () => {
    const p = lerPacotesDoAmbiente(S3);
    expect(p.criar().disponivel()).toBe(true);
    expect(p.descricao).toBe(`s3 macuxi-demo/pacotes/ (link ${VALIDADE_LINK_PACOTE_S.padrao} s)`);
    expect(p.descricao).not.toContain('nao-real');
  });

  it('valor inválido = não sobe, com o nome da variável e sem o valor do segredo', () => {
    for (const extra of [{ MACUXI_PACOTES_VALIDADE_S: '30' }, { MACUXI_PACOTES_VALIDADE_S: '3600' }, { MACUXI_PACOTES_VALIDADE_S: 'x' }, { MACUXI_PACOTES_PREFIXO: '../x' }, { MACUXI_PACOTES_PREFIXO: 'arquivos/' }]) {
      const e = (() => {
        try {
          lerPacotesDoAmbiente({ ...S3, ...extra });
          return null;
        } catch (x) {
          return x as Error;
        }
      })();
      expect(e?.message, JSON.stringify(extra)).toMatch(/MACUXI_PACOTES_/);
      expect(e?.message).not.toContain('nao-real');
    }
    expect(() => lerPacotesDoAmbiente({ ...S3, MACUXI_S3_SEGREDO: '' })).toThrow(/MACUXI_S3_SEGREDO/);
  });
});

describe('ctx.pacotes nas rotas de módulo', () => {
  const rota: RotaModulo = {
    metodo: 'POST',
    caminho: 'baixar-pacote',
    acao: 'pedido.criar',
    carteira: 'nao_se_aplica',
    executar: async (ctx) => (await ctx.pacotes!.linkDoUltimo('conector')) ?? { sem: true },
  };
  const app = (pacotes?: ServicoPacotes) =>
    createApp(opcoesDeTeste(LICENCAS_PADRAO, { pacotes, modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rota] }) }) }));

  it('padrão desligado: 503 ARMAZENAMENTO_INDISPONIVEL', async () => {
    const r = await app().inject({ method: 'POST', url: '/v1/vendedor/baixar-pacote', headers: cab('vendedor') });
    expect(r.statusCode).toBe(503);
    expect(r.json().codigo).toBe('ARMAZENAMENTO_INDISPONIVEL');
  });

  it('a porta injetada chega à rota (fábrica com o log do app)', async () => {
    const falsa: ServicoPacotes = { disponivel: () => true, linkDoUltimo: async () => ({ versao: '1.3.0', arquivo: 'c.zip', url: 'https://x/c.zip', expira_em: AGORA.toISOString() }) };
    const r = await createApp(
      opcoesDeTeste(LICENCAS_PADRAO, { pacotes: (log) => (log ? falsa : SERVICO_PACOTES_DESLIGADO), modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rota] }) }) }),
    ).inject({ method: 'POST', url: '/v1/vendedor/baixar-pacote', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ versao: '1.3.0', url: 'https://x/c.zip' });
    expect((await app(falsa).inject({ method: 'POST', url: '/v1/vendedor/baixar-pacote', headers: cab('vendedor') })).statusCode).toBe(200);
  });
});
