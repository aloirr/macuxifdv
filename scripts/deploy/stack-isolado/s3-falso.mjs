#!/usr/bin/env node
/**
 * S3 FALSO do stack isolado (T-0074; .github/workflows/stack-isolado.yml). Roda num contêiner do compose do CI
 * (compose.ci.yml, serviço "s3-falso", rede "borda") no lugar do Object Storage da Magalu: nenhum pedido sai do runner.
 * Node puro, sem dependência e SEM importar o código que ele confere (db/backup/s3.mjs, apps/api/src/armazenamento-s3.ts):
 * a assinatura AWS SigV4 é recalculada aqui, de forma independente, a partir do pedido RECEBIDO.
 *
 * Confere o que um S3 confere e responde como ele:
 *  - Authorization AWS4-HMAC-SHA256 com a credencial de TESTE (MACUXI_S3_CHAVE_ID/MACUXI_S3_SEGREDO do segredos.env
 *    gerado no job) e a região MACUXI_S3_REGIAO: errada = 403 SignatureDoesNotMatch / InvalidAccessKeyId;
 *  - x-amz-content-sha256 igual ao sha256 do corpo no PUT (ou UNSIGNED-PAYLOAD): senão 400 XAmzContentSHA256Mismatch;
 *  - só o bucket MACUXI_S3_BUCKET, estilo caminho (/<bucket>/<chave>): outro = 404 NoSuchBucket;
 *  - PUT (guarda os x-amz-meta-*), GET e HEAD (devolvem content-length e x-amz-meta-*), DELETE e ListObjectsV2
 *    (prefix, paginação por continuation-token com MACUXI_S3_FALSO_PAGINA itens, padrão 2, para exercitar a paginação).
 * Objetos em memória (o contêiner vive o job inteiro). Log: uma linha por pedido (método, status, chave), nunca a
 * credencial. GET /saude (sem assinatura) = 200, para o healthcheck.
 */
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PORTA = Number(process.env.MACUXI_S3_FALSO_PORTA || 9000);
const PAGINA = Number(process.env.MACUXI_S3_FALSO_PAGINA || 2);
const exigir = (n) => {
  const v = process.env[n]?.trim();
  if (!v) {
    console.error(`[s3-falso] falta a variável ${n}`);
    process.exit(2);
  }
  return v;
};
const CHAVE_ID = exigir('MACUXI_S3_CHAVE_ID');
const SEGREDO = exigir('MACUXI_S3_SEGREDO');
const REGIAO = exigir('MACUXI_S3_REGIAO');
const BUCKET = exigir('MACUXI_S3_BUCKET');

/** chave → { corpo, meta, modificado } */
const objetos = new Map();

const sha256 = (dados) => createHash('sha256').update(dados).digest('hex');
const hmac = (chave, dados) => createHmac('sha256', chave).update(dados).digest();
/** RFC 3986 (o que o SigV4 exige na query canônica). */
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlErro = (codigo) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${codigo}</Code><Message>s3-falso</Message></Error>`;
const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Query canônica a partir da query CRUA recebida: decodifica, recodifica em RFC 3986 e ordena. */
function queryCanonica(crua) {
  if (!crua) return '';
  return crua
    .split('&')
    .filter(Boolean)
    .map((par) => {
      const i = par.indexOf('=');
      const k = decodeURIComponent((i < 0 ? par : par.slice(0, i)).replace(/\+/g, '%20'));
      const v = i < 0 ? '' : decodeURIComponent(par.slice(i + 1).replace(/\+/g, '%20'));
      return [rfc3986(k), rfc3986(v)];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** null = assinatura confere; senão o código de erro do S3. */
function conferirAssinatura(req, caminhoCru, queryCrua) {
  const auth = String(req.headers.authorization ?? '');
  const m = /^AWS4-HMAC-SHA256 Credential=([^/,\s]+)\/(\d{8})\/([^/,\s]+)\/s3\/aws4_request,\s*SignedHeaders=([a-z0-9;-]+),\s*Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return 'AccessDenied';
  const [, chaveId, dia, regiao, assinadosTxt, assinatura] = m;
  if (chaveId !== CHAVE_ID) return 'InvalidAccessKeyId';
  if (regiao !== REGIAO) return 'AuthorizationHeaderMalformed';
  const amz = String(req.headers['x-amz-date'] ?? '');
  if (!/^\d{8}T\d{6}Z$/.test(amz) || amz.slice(0, 8) !== dia) return 'AccessDenied';
  const assinados = assinadosTxt.split(';');
  if (!assinados.includes('host') || !assinados.includes('x-amz-date') || !assinados.includes('x-amz-content-sha256')) return 'AccessDenied';
  const cabecalhos = assinados.map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonico = [req.method, caminhoCru, queryCanonica(queryCrua), cabecalhos, assinadosTxt, String(req.headers['x-amz-content-sha256'] ?? '')].join('\n');
  const escopo = `${dia}/${regiao}/s3/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', amz, escopo, sha256(canonico)].join('\n');
  const chave = hmac(hmac(hmac(hmac(`AWS4${SEGREDO}`, dia), regiao), 's3'), 'aws4_request');
  return createHmac('sha256', chave).update(paraAssinar).digest('hex') === assinatura ? null : 'SignatureDoesNotMatch';
}

function listar(res, params) {
  const prefixo = params.get('prefix') ?? '';
  const todas = [...objetos.keys()].filter((k) => k.startsWith(prefixo)).sort();
  const inicio = Number(params.get('continuation-token') ?? '0') || 0;
  const pagina = todas.slice(inicio, inicio + PAGINA);
  const mais = inicio + PAGINA < todas.length;
  console.log(`[s3-falso] GET 200 lista ${prefixo || '/'} (${pagina.length} de ${todas.length})`);
  const itens = pagina
    .map((k) => `<Contents><Key>${escXml(k)}</Key><Size>${objetos.get(k).corpo.length}</Size><LastModified>${objetos.get(k).modificado}</LastModified></Contents>`)
    .join('');
  res.writeHead(200, { 'content-type': 'application/xml' }).end(
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${BUCKET}</Name><Prefix>${escXml(prefixo)}</Prefix><KeyCount>${pagina.length}</KeyCount>` +
      `<IsTruncated>${mais}</IsTruncated>${mais ? `<NextContinuationToken>${inicio + PAGINA}</NextContinuationToken>` : ''}${itens}</ListBucketResult>`,
  );
}

const servidor = createServer((req, res) => {
  const partes = [];
  req.on('data', (p) => partes.push(p));
  req.on('end', () => {
    const corpo = Buffer.concat(partes);
    const url = req.url ?? '/';
    const q = url.indexOf('?');
    const caminhoCru = q < 0 ? url : url.slice(0, q);
    const queryCrua = q < 0 ? '' : url.slice(q + 1);
    let chave = '';
    const responder = (status, codigo, cabecalhos = {}, dados) => {
      console.log(`[s3-falso] ${req.method} ${status}${codigo ? ` ${codigo}` : ''} ${chave || caminhoCru}`);
      if (codigo) res.writeHead(status, { 'content-type': 'application/xml', ...cabecalhos }).end(req.method === 'HEAD' ? undefined : xmlErro(codigo));
      else res.writeHead(status, cabecalhos).end(req.method === 'HEAD' ? undefined : dados);
    };
    if (req.method === 'GET' && caminhoCru === '/saude') return res.writeHead(200).end('ok');

    const erroAssinatura = conferirAssinatura(req, caminhoCru, queryCrua);
    if (erroAssinatura) return responder(403, erroAssinatura);
    const hashCorpo = String(req.headers['x-amz-content-sha256']);
    if (req.method === 'PUT' && hashCorpo !== 'UNSIGNED-PAYLOAD' && sha256(corpo) !== hashCorpo) return responder(400, 'XAmzContentSHA256Mismatch');

    const raiz = `/${BUCKET}`;
    if (caminhoCru === raiz || caminhoCru === `${raiz}/`) {
      const params = new URLSearchParams(queryCrua);
      if (req.method === 'GET' && params.get('list-type') === '2') return listar(res, params);
      return responder(400, 'InvalidRequest');
    }
    if (!caminhoCru.startsWith(`${raiz}/`)) return responder(404, 'NoSuchBucket');
    chave = decodeURIComponent(caminhoCru.slice(raiz.length + 1));
    const obj = objetos.get(chave);
    if (req.method === 'PUT') {
      const meta = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-amz-meta-')).map(([k, v]) => [k, String(v)]));
      objetos.set(chave, { corpo, meta, modificado: new Date().toISOString() });
      return responder(200, null, { etag: `"${createHash('md5').update(corpo).digest('hex')}"` });
    }
    if (req.method === 'DELETE') {
      objetos.delete(chave);
      return responder(204, null);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return responder(405, 'MethodNotAllowed');
    if (!obj) return responder(404, 'NoSuchKey');
    return responder(200, null, { 'content-type': 'application/octet-stream', 'content-length': String(obj.corpo.length), ...obj.meta }, obj.corpo);
  });
});

servidor.listen(PORTA, '0.0.0.0', () => console.log(`[s3-falso] ouvindo em :${PORTA}, bucket ${BUCKET}, região ${REGIAO}`));
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => servidor.close(() => process.exit(0)));
