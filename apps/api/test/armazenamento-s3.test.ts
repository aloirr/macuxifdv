/**
 * Adaptador S3 da porta ArmazenamentoArquivos (ADR 0010 §3 + ADR 0020; T-0074), contra o S3 FALSO local (s3-falso.ts),
 * que confere a assinatura SigV4 do pedido recebido. Nunca contra o bucket real.
 * RN-CORE-05: a chave do objeto leva o tenant no começo; chave fora do formato fechado nem sai da API.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assinarSigV4, codificarCaminhoS3, criarArmazenamentoS3, ErroArmazenamentoS3, lerArmazenamentoDoAmbiente } from '../src/armazenamento-s3';
import { chaveDaParte, chaveDaParte1, chaveDoArquivo } from '../src/arquivos';
import { CRED_TESTE, subirS3Falso, type S3Falso } from './s3-falso';

const QUANDO = new Date('2026-11-04T05:00:00Z');
const chave = (tenant = randomUUID()) => chaveDoArquivo({ tenant_id: tenant, modulo: 'vendedor', id: randomUUID() }, QUANDO);

describe('assinatura SigV4', () => {
  it('determinística: mesmo pedido, mesma assinatura; muda com o segredo, a região e o corpo', () => {
    const p = { metodo: 'PUT', caminho: '/b/x.jpg', cabecalhos: { host: 'h', 'x-amz-date': '20261104T050000Z', 'x-amz-content-sha256': 'ab' }, hashCorpo: 'ab' };
    const a = assinarSigV4(p, CRED_TESTE, QUANDO);
    expect(a).toBe(assinarSigV4(p, CRED_TESTE, QUANDO));
    expect(a).toMatch(/^AWS4-HMAC-SHA256 Credential=chave-de-teste\/20261104\/br-se1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(assinarSigV4(p, { ...CRED_TESTE, segredo: 'outro' }, QUANDO)).not.toBe(a);
    expect(assinarSigV4(p, { ...CRED_TESTE, regiao: 'br-ne1' }, QUANDO)).not.toBe(a);
    expect(assinarSigV4({ ...p, hashCorpo: 'cd' }, CRED_TESTE, QUANDO)).not.toBe(a);
  });

  it('caminho codificado como o S3 espera (RFC 3986, barra preservada)', () => {
    expect(codificarCaminhoS3("a b/c!'()*.jpg")).toBe('a%20b/c%21%27%28%29%2A.jpg');
  });
});

describe('criarArmazenamentoS3 × S3 falso', () => {
  let s3: S3Falso;
  beforeAll(async () => {
    s3 = await subirS3Falso();
  });
  afterAll(async () => {
    await s3?.fechar();
  });
  const adaptador = (extra: Partial<Parameters<typeof criarArmazenamentoS3>[0]> = {}) =>
    criarArmazenamentoS3({ endpoint: s3.endpoint, regiao: CRED_TESTE.regiao, bucket: s3.bucket, chaveId: CRED_TESTE.chaveId, segredo: CRED_TESTE.segredo, prefixo: 'arquivos/', ...extra });

  it('grava, lê e remove; ausente = null; o objeto fica em <bucket>/<prefixo><tenant>/...', async () => {
    const a = adaptador();
    const tenant = randomUUID();
    const k = chave(tenant);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    await a.gravar(k, bytes);
    expect(s3.objetos.get(`/${s3.bucket}/arquivos/${k}`)).toEqual(Buffer.from(bytes));
    expect(k.startsWith(`${tenant}/`)).toBe(true);
    expect(await a.ler(k)).toEqual(bytes);
    await a.remover(k);
    expect(await a.ler(k)).toBeNull();
    await a.remover(k); // idempotente
  });

  it('assinatura errada → erro com status e código S3, sem segredo na mensagem', async () => {
    const a = adaptador({ segredo: 'segredo-errado' });
    const e = await a.gravar(chave(), new Uint8Array([1])).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroArmazenamentoS3);
    expect((e as ErroArmazenamentoS3).status).toBe(403);
    expect((e as ErroArmazenamentoS3).codigoS3).toBe('SignatureDoesNotMatch');
    expect(String((e as Error).message)).not.toContain('segredo');
  });

  it('5xx do servidor na leitura → erro (a rota responde 5xx, não "foto não encontrada")', async () => {
    s3.falharProxima(500);
    await expect(adaptador().ler(chave())).rejects.toBeInstanceOf(ErroArmazenamentoS3);
  });

  it('chave fora do formato fechado não sai da API (sem pedido ao S3)', async () => {
    const a = adaptador();
    const antes = s3.pedidos;
    for (const ruim of ['../x.jpg', `${randomUUID()}/vendedor/2026-11/../../x.jpg`, 'outro-bucket/x.jpg', '']) {
      await expect(a.gravar(ruim, new Uint8Array([1]))).rejects.toThrow('chave de arquivo inválida');
      await expect(a.ler(ruim)).rejects.toThrow('chave de arquivo inválida');
    }
    expect(s3.pedidos).toBe(antes);
  });

  it('ADR 0054: tamanho por HEAD (sem baixar); ausente = null; content-type do PUT pela extensão', async () => {
    const a = adaptador();
    const tenant = randomUUID();
    const id = randomUUID();
    const png = chaveDoArquivo({ tenant_id: tenant, modulo: 'catalogo', id }, QUANDO, 'image/png');
    await a.gravar(png, new Uint8Array(37));
    expect(await a.tamanho(png)).toBe(37);
    expect(s3.tipos.get(`/${s3.bucket}/arquivos/${png}`)).toBe('image/png');
    const parte = chaveDaParte1({ tenant_id: tenant, modulo: 'catalogo', id }, QUANDO);
    await a.gravar(parte, new Uint8Array(5));
    expect(s3.tipos.get(`/${s3.bucket}/arquivos/${parte}`)).toBe('application/octet-stream');
    expect(await a.tamanho(chaveDaParte(parte, 2))).toBeNull();
  });

  it('ADR 0054: URL de envio = PUT pré-assinado só da chave de PARTE; o S3 aceita o corpo dentro da validade', async () => {
    const a = adaptador();
    const id = randomUUID();
    const parte = chaveDaParte(chaveDaParte1({ tenant_id: randomUUID(), modulo: 'catalogo', id }, QUANDO), 3);
    const u = a.urlEnvio!(parte, 900);
    expect(u.url).toContain('X-Amz-Expires=900');
    const r = await fetch(u.url, { method: 'PUT', body: Buffer.from([1, 2, 3]) });
    expect(r.status).toBe(200);
    expect(await a.tamanho(parte)).toBe(3);
    // GET com a URL de PUT: a assinatura não vale para outro método
    expect((await fetch(u.url)).status).toBe(403);
    expect(() => a.urlEnvio!(chave(), 900)).toThrow('chave de arquivo inválida');
  });

  it('configuração inválida falha na criação', () => {
    expect(() => adaptador({ endpoint: 'ftp://x' })).toThrow();
    expect(() => adaptador({ bucket: 'Bucket_Ruim' })).toThrow('MACUXI_S3_BUCKET');
    expect(() => adaptador({ prefixo: '/abs' })).toThrow('MACUXI_S3_PREFIXO');
  });
});

describe('lerArmazenamentoDoAmbiente', () => {
  const s3env = {
    MACUXI_ARQUIVOS_DRIVER: 's3',
    MACUXI_S3_ENDPOINT: 'https://br-se1.magaluobjects.com',
    MACUXI_S3_REGIAO: 'br-se1',
    MACUXI_S3_BUCKET: 'macuxi-demo-arquivos',
    MACUXI_S3_CHAVE_ID: 'id-falso',
    MACUXI_S3_SEGREDO: 'segredo-falso',
  };
  it('padrão = disco (dev e CI)', () => {
    expect(lerArmazenamentoDoAmbiente({}).descricao).toBe('disco');
    expect(lerArmazenamentoDoAmbiente({ MACUXI_ARQUIVOS_DRIVER: 'disco' }).descricao).toBe('disco');
  });
  it('s3 completo: descrição sem chave nem segredo', () => {
    const r = lerArmazenamentoDoAmbiente({ ...s3env, MACUXI_S3_PREFIXO: 'arquivos/' });
    expect(r.descricao).toBe('s3 br-se1.magaluobjects.com/macuxi-demo-arquivos/arquivos/');
    expect(r.descricao).not.toContain('falso');
  });
  it('s3 incompleto ou driver desconhecido: falha fechada com o NOME da variável, nunca o valor', () => {
    const { MACUXI_S3_SEGREDO: _s, ...semSegredo } = s3env;
    expect(() => lerArmazenamentoDoAmbiente(semSegredo)).toThrow('MACUXI_S3_SEGREDO');
    expect(() => lerArmazenamentoDoAmbiente({ ...s3env, MACUXI_S3_CHAVE_ID: ' ' })).toThrow(/MACUXI_S3_CHAVE_ID/);
    expect(() => lerArmazenamentoDoAmbiente({ ...s3env, MACUXI_S3_ESTILO: 'outro' })).toThrow('MACUXI_S3_ESTILO');
    expect(() => lerArmazenamentoDoAmbiente({ MACUXI_ARQUIVOS_DRIVER: 'ftp' })).toThrow('MACUXI_ARQUIVOS_DRIVER');
  });
});
