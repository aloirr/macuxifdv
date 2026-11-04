/**
 * Cliente S3 mínimo do backup (dono: banco-dados). Node puro (node:http/https + node:crypto), sem SDK e sem pnpm
 * install: roda na imagem macuxi-api (node:24-bookworm-slim, que tem o db/ inteiro) e no PC.
 * Assinatura AWS SigV4 (serviço s3) com query string (o ListObjectsV2 precisa), corpo assinado por sha256 (sem
 * UNSIGNED-PAYLOAD: nem todo S3 compatível aceita). Mesma convenção do adaptador da API (apps/api/src/armazenamento-s3.ts):
 * estilo "caminho" por padrão (<endpoint>/<bucket>/<chave>) ou "virtual" (<bucket>.<host>/<chave>).
 * Nenhuma mensagem de erro leva chave, segredo ou assinatura: só operação, status HTTP e código S3.
 */
import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export const SHA256_VAZIO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const hmac = (chave, dados) => createHmac('sha256', chave).update(dados).digest();
const sha256Hex = (dados) => createHash('sha256').update(dados).digest('hex');

/** RFC 3986 (o que o S3 espera): encodeURIComponent mais !'()*. */
export function codificarRfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Caminho do objeto codificado segmento a segmento (a barra fica). */
export function codificarCaminho(caminho) {
  return caminho.split('/').map(codificarRfc3986).join('/');
}

/** Query string canônica: pares codificados e ordenados pelo nome (depois pelo valor). */
export function queryCanonica(query) {
  return Object.entries(query)
    .map(([k, v]) => [codificarRfc3986(k), codificarRfc3986(String(v))])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** AAAAMMDDTHHMMSSZ */
export function dataAmz(quando) {
  return quando.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Cabeçalho Authorization do SigV4.
 * pedido: { metodo, caminho (já codificado), query (objeto), cabecalhos (todos assinados; inclua host), hashCorpo }.
 */
export function assinarSigV4(pedido, cred, quando) {
  const amz = dataAmz(quando);
  const dia = amz.slice(0, 8);
  const porNome = new Map(Object.entries(pedido.cabecalhos).map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const nomes = [...porNome.keys()].sort();
  const canonico = [
    pedido.metodo.toUpperCase(),
    pedido.caminho,
    queryCanonica(pedido.query ?? {}),
    nomes.map((n) => `${n}:${porNome.get(n)}\n`).join(''),
    nomes.join(';'),
    pedido.hashCorpo,
  ].join('\n');
  const escopo = `${dia}/${cred.regiao}/s3/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', amz, escopo, sha256Hex(canonico)].join('\n');
  const chave = hmac(hmac(hmac(hmac(`AWS4${cred.segredo}`, dia), cred.regiao), 's3'), 'aws4_request');
  const assinatura = createHmac('sha256', chave).update(paraAssinar).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${cred.chaveId}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}`;
}

/** Erro do S3 sem dado sensível. */
export class ErroS3 extends Error {
  constructor(operacao, status, codigo) {
    super(`S3 ${operacao}: HTTP ${status}${codigo ? ` (${codigo})` : ''}`);
    this.name = 'ErroS3';
    this.operacao = operacao;
    this.status = status;
    this.codigo = codigo;
  }
}

async function lerTexto(res) {
  const partes = [];
  for await (const p of res) partes.push(p);
  return Buffer.concat(partes).toString('utf8');
}

const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, nome) => {
  const m = new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`).exec(xml);
  return m ? desescapar(m[1]) : null;
};

/**
 * cfg: { endpoint, regiao, bucket, chaveId, segredo, estilo?: 'caminho'|'virtual' }.
 * opcoes: { agora?: () => Date, timeoutMs?: number (inatividade do socket, padrão 120 s) }.
 */
export function criarClienteS3(cfg, opcoes = {}) {
  const base = new URL(cfg.endpoint);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('MACUXI_S3_ENDPOINT precisa ser http(s)://');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket)) throw new Error('MACUXI_S3_BUCKET inválido');
  const virtual = cfg.estilo === 'virtual';
  const host = virtual ? `${cfg.bucket}.${base.host}` : base.host;
  const raiz = base.pathname.replace(/\/$/, '') + (virtual ? '' : `/${cfg.bucket}`);
  const agora = opcoes.agora ?? (() => new Date());
  const timeoutMs = opcoes.timeoutMs ?? 120_000;
  const modulo = base.protocol === 'https:' ? https : http;

  /** Faz a chamada assinada; resolve com a resposta (corpo ainda não lido). */
  function chamar(metodo, chave, { query = {}, corpo, tamanho, hashCorpo = SHA256_VAZIO, extras = {} } = {}) {
    const caminho = chave === null ? raiz || '/' : `${raiz}/${codificarCaminho(chave)}`;
    const quando = agora();
    const assinados = { host, 'x-amz-content-sha256': hashCorpo, 'x-amz-date': dataAmz(quando), ...extras };
    const authorization = assinarSigV4({ metodo, caminho, query, cabecalhos: assinados, hashCorpo }, cfg, quando);
    const qs = queryCanonica(query);
    const cabecalhos = { ...assinados, authorization };
    if (corpo !== undefined) {
      cabecalhos['content-length'] = String(tamanho ?? corpo.length);
      cabecalhos['content-type'] = 'application/octet-stream';
    }
    return new Promise((resolve, reject) => {
      const req = modulo.request(
        {
          protocol: base.protocol,
          hostname: virtual ? `${cfg.bucket}.${base.hostname}` : base.hostname,
          port: base.port || undefined,
          method: metodo,
          path: caminho + (qs ? `?${qs}` : ''),
          headers: cabecalhos,
        },
        resolve,
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`S3 ${metodo}: sem resposta em ${timeoutMs} ms`)));
      req.on('error', (e) => reject(new Error(`S3 ${metodo}: ${e.code ?? e.message}`)));
      if (corpo === undefined) req.end();
      else if (Buffer.isBuffer(corpo) || typeof corpo === 'string') req.end(corpo);
      else {
        corpo.on('error', (e) => req.destroy(e));
        corpo.pipe(req);
      }
    });
  }

  async function falhar(operacao, res) {
    const texto = await lerTexto(res).catch(() => '');
    throw new ErroS3(operacao, res.statusCode, /<Code>([^<]{1,64})<\/Code>/.exec(texto)?.[1] ?? null);
  }

  return {
    /** PUT de um objeto. corpo: Buffer ou stream legível com `tamanho` bytes e sha256 `hashCorpo` já conhecidos. */
    async gravar(chave, corpo, { tamanho, hashCorpo, metadados = {} }) {
      const extras = Object.fromEntries(Object.entries(metadados).map(([k, v]) => [`x-amz-meta-${k.toLowerCase()}`, String(v)]));
      const res = await chamar('PUT', chave, { corpo, tamanho, hashCorpo, extras });
      if (res.statusCode < 200 || res.statusCode >= 300) await falhar('gravar', res);
      res.resume();
    },
    /** GET: a resposta (stream legível) ou null se não existir. `res.headers['x-amz-meta-*']` traz os metadados. */
    async ler(chave) {
      const res = await chamar('GET', chave);
      if (res.statusCode === 404) {
        res.resume();
        return null;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) await falhar('ler', res);
      return res;
    },
    /** HEAD: { tamanho, metadados } ou null. */
    async info(chave) {
      const res = await chamar('HEAD', chave);
      res.resume();
      if (res.statusCode === 404) return null;
      if (res.statusCode < 200 || res.statusCode >= 300) throw new ErroS3('info', res.statusCode, null);
      const metadados = Object.fromEntries(
        Object.entries(res.headers)
          .filter(([k]) => k.startsWith('x-amz-meta-'))
          .map(([k, v]) => [k.slice('x-amz-meta-'.length), String(v)]),
      );
      return { tamanho: Number(res.headers['content-length']), metadados };
    },
    async remover(chave) {
      const res = await chamar('DELETE', chave);
      if (res.statusCode !== 404 && (res.statusCode < 200 || res.statusCode >= 300)) await falhar('remover', res);
      res.resume();
    },
    /** ListObjectsV2 com paginação: [{ chave, tamanho, modificado }]. */
    async listar(prefixo) {
      const itens = [];
      let token = null;
      for (let pagina = 0; pagina < 1000; pagina += 1) {
        const query = { 'list-type': '2', prefix: prefixo };
        if (token) query['continuation-token'] = token;
        const res = await chamar('GET', null, { query });
        if (res.statusCode < 200 || res.statusCode >= 300) await falhar('listar', res);
        const xml = await lerTexto(res);
        for (const bloco of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
          itens.push({ chave: tag(bloco, 'Key'), tamanho: Number(tag(bloco, 'Size') ?? 0), modificado: tag(bloco, 'LastModified') });
        }
        token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : null;
        if (!token) return itens;
      }
      throw new Error('S3 listar: paginação sem fim');
    },
  };
}
