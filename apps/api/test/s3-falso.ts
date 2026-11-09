/**
 * Servidor S3 FALSO para os testes do adaptador (T-0074): HTTP de verdade em 127.0.0.1, porta aleatória. Nunca fala
 * com bucket real. Confere o que um S3 confere:
 *  - Authorization AWS4-HMAC-SHA256 recalculada do pedido RECEBIDO (método, caminho cru, host, x-amz-date,
 *    x-amz-content-sha256), com a credencial de teste: assinatura errada = 403 SignatureDoesNotMatch;
 *  - x-amz-content-sha256 bate com o corpo (senão 400 XAmzContentSHA256Mismatch);
 *  - bucket existente (senão 404 NoSuchBucket); objeto ausente = 404 NoSuchKey;
 *  - GET pré-assinado (T-0098, ADR 0037: `X-Amz-Algorithm` na query): assinatura da query recalculada com `preAssinarGetS3`
 *    (errada = 403 SignatureDoesNotMatch) e validade pelo relógio do falso (`agora`; vencido = 403 AccessDenied).
 * Guarda os objetos em memória por caminho (`/<bucket>/<chave>`), para o teste conferir onde cada tenant gravou.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { assinarSigV4, preAssinarGetS3 } from '../src/armazenamento-s3';

export const CRED_TESTE = { chaveId: 'chave-de-teste', segredo: 'segredo-de-teste-nao-e-real', regiao: 'br-se1' } as const;

export interface S3Falso {
  endpoint: string;
  bucket: string;
  objetos: Map<string, Buffer>;
  /** Respostas forçadas (ex.: 500) para o próximo pedido. */
  falharProxima(status: number): void;
  pedidos: number;
  /** Relógio do falso para a validade da URL pré-assinada (padrão: o real). */
  agora: () => Date;
  /** `content-type` recebido em cada PUT, por caminho. */
  tipos: Map<string, string>;
  fechar(): Promise<void>;
}

const xml = (codigo: string) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${codigo}</Code><Message>teste</Message></Error>`;

async function corpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

export async function subirS3Falso(bucket = 'macuxi-teste'): Promise<S3Falso> {
  const objetos = new Map<string, Buffer>();
  const tipos = new Map<string, string>();
  let falha: number | null = null;
  const estado = { pedidos: 0, agora: () => new Date() };
  const servidor: Server = createServer((req, res) => {
    void (async () => {
      estado.pedidos++;
      const bytes = await corpo(req);
      const responder = (status: number, codigo?: string, dados?: Buffer) => {
        res.statusCode = status;
        if (codigo) res.setHeader('content-type', 'application/xml');
        res.end(codigo ? xml(codigo) : dados);
      };
      if (falha !== null) {
        const s = falha;
        falha = null;
        return responder(s, 'InternalError');
      }
      const [caminho = '/', query = ''] = (req.url ?? '/').split('?');
      const q = new URLSearchParams(query);
      if (q.has('X-Amz-Algorithm')) {
        const quandoQ = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(q.get('X-Amz-Date') ?? '');
        const expira = Number(q.get('X-Amz-Expires'));
        if (req.method !== 'GET' || !quandoQ || !Number.isInteger(expira)) return responder(403, 'AccessDenied');
        const instanteQ = new Date(`${quandoQ[1]}-${quandoQ[2]}-${quandoQ[3]}T${quandoQ[4]}:${quandoQ[5]}:${quandoQ[6]}Z`);
        const extras = Object.fromEntries([...q.entries()].filter(([n]) => !n.startsWith('X-Amz-')));
        const esperada = new URL(preAssinarGetS3({ protocolo: 'http:', host: String(req.headers.host), caminho, consulta: extras }, CRED_TESTE, instanteQ, expira));
        if (q.get('X-Amz-Signature') !== esperada.searchParams.get('X-Amz-Signature')) return responder(403, 'SignatureDoesNotMatch');
        if (estado.agora().getTime() > instanteQ.getTime() + expira * 1000) return responder(403, 'AccessDenied');
        const o = objetos.get(decodeURIComponent(caminho));
        if (o && extras['response-content-disposition']) res.setHeader('content-disposition', extras['response-content-disposition']);
        return o ? responder(200, undefined, o) : responder(404, 'NoSuchKey');
      }
      const data = String(req.headers['x-amz-date'] ?? '');
      const hash = String(req.headers['x-amz-content-sha256'] ?? '');
      const quando = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(data);
      if (!quando) return responder(403, 'AccessDenied');
      const instante = new Date(`${quando[1]}-${quando[2]}-${quando[3]}T${quando[4]}:${quando[5]}:${quando[6]}Z`);
      const esperado = assinarSigV4(
        { metodo: req.method ?? 'GET', caminho, cabecalhos: { host: String(req.headers.host), 'x-amz-content-sha256': hash, 'x-amz-date': data }, hashCorpo: hash },
        CRED_TESTE,
        instante,
      );
      if (req.headers.authorization !== esperado) return responder(403, 'SignatureDoesNotMatch');
      if (createHash('sha256').update(bytes).digest('hex') !== hash) return responder(400, 'XAmzContentSHA256Mismatch');
      if (!caminho.startsWith(`/${bucket}/`)) return responder(404, 'NoSuchBucket');
      const chave = decodeURIComponent(caminho);
      if (req.method === 'PUT') {
        objetos.set(chave, bytes);
        tipos.set(chave, String(req.headers['content-type'] ?? ''));
        return responder(200);
      }
      if (req.method === 'GET') {
        const o = objetos.get(chave);
        return o ? responder(200, undefined, o) : responder(404, 'NoSuchKey');
      }
      if (req.method === 'DELETE') {
        objetos.delete(chave);
        return responder(204);
      }
      return responder(405, 'MethodNotAllowed');
    })();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    objetos,
    falharProxima: (s) => {
      falha = s;
    },
    get pedidos() {
      return estado.pedidos;
    },
    get agora() {
      return estado.agora;
    },
    set agora(f: () => Date) {
      estado.agora = f;
    },
    tipos,
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  };
}
