/**
 * URL assinada (AWS Signature V4, assinatura na query) para bucket compatível com S3 — T-0109.
 * Usada por `baixar-apk.mjs` para enviar o APK ao bucket PRIVADO (PUT assinado) e gerar o link temporário de download
 * (GET assinado, no máximo 7 dias, limite do SigV4). Sem SDK: só `node:crypto`, para o script rodar com o Node puro no
 * PC do dono do produto e no runner. Endereço no estilo de caminho (`https://<endpoint>/<bucket>/<chave>`), o que os
 * provedores compatíveis (Magalu Cloud Object Storage, ADR 0020; MinIO; R2) aceitam.
 * Segredos só chegam por parâmetro (lidos do ambiente/.env pelo script) e nunca entram em log nem no retorno.
 * TypeScript "apagável" (o Node importa este arquivo removendo os tipos): sem enum, namespace nem parameter property.
 */
import { createHash, createHmac } from 'node:crypto';

export interface CredenciaisS3 {
  regiao: string;
  chave: string;
  segredo: string;
}

export interface PedidoAssinado {
  metodo: 'GET' | 'PUT';
  /** `https:` */
  protocolo: string;
  /** host com porta, se houver: `br-se1.magaluobjects.com` */
  host: string;
  /** caminho já com o bucket no estilo de caminho, começando por `/`, SEM codificar (a função codifica cada trecho) */
  caminho: string;
  credenciais: CredenciaisS3;
  /** instante da assinatura (o link vale a partir dele) */
  agora: Date;
  /** validade em segundos: 1 a 604800 (7 dias) */
  expiraEm: number;
  /** parâmetros extras assinados, ex.: `response-content-disposition` */
  consulta?: Record<string, string>;
}

export const VALIDADE_MAXIMA_S = 7 * 24 * 60 * 60;

/** Codificação do SigV4 (RFC 3986): só A-Z a-z 0-9 - _ . ~ ficam como estão. */
export function codificar(texto: string): string {
  return encodeURIComponent(texto).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function codificarCaminho(caminho: string): string {
  return caminho
    .split('/')
    .map((trecho) => codificar(trecho))
    .join('/');
}

function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

function hmac(chave: Buffer | string, texto: string): Buffer {
  return createHmac('sha256', chave).update(texto, 'utf8').digest();
}

/** `20130524T000000Z` */
export function dataAmz(agora: Date): string {
  return agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** URL assinada completa. Erro se a validade sair de 1 s a 7 dias ou se faltar credencial. */
export function urlAssinada(p: PedidoAssinado): string {
  if (!Number.isInteger(p.expiraEm) || p.expiraEm < 1 || p.expiraEm > VALIDADE_MAXIMA_S) {
    throw new Error(`validade do link fora do limite: ${p.expiraEm} s (de 1 s a ${VALIDADE_MAXIMA_S} s = 7 dias)`);
  }
  const { regiao, chave, segredo } = p.credenciais;
  if (!regiao || !chave || !segredo) throw new Error('credenciais do bucket incompletas (região, chave e segredo)');
  if (!p.caminho.startsWith('/')) throw new Error(`caminho deve começar com "/": ${p.caminho}`);

  const amz = dataAmz(p.agora);
  const dia = amz.slice(0, 8);
  const escopo = `${dia}/${regiao}/s3/aws4_request`;
  const parametros: Record<string, string> = {
    ...(p.consulta ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${chave}/${escopo}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(p.expiraEm),
    'X-Amz-SignedHeaders': 'host',
  };
  const consulta = Object.keys(parametros)
    .map((k) => [codificar(k), codificar(parametros[k] ?? '')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const caminho = codificarCaminho(p.caminho);
  const canonico = [p.metodo, caminho, consulta, `host:${p.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const paraAssinar = ['AWS4-HMAC-SHA256', amz, escopo, sha256Hex(canonico)].join('\n');
  const chaveAssinatura = hmac(hmac(hmac(hmac(`AWS4${segredo}`, dia), regiao), 's3'), 'aws4_request');
  const assinatura = createHmac('sha256', chaveAssinatura).update(paraAssinar, 'utf8').digest('hex');
  return `${p.protocolo}//${p.host}${caminho}?${consulta}&X-Amz-Signature=${assinatura}`;
}

/**
 * Chave do objeto no bucket: `apk/<versionCode>/<Campo-Oficial-v1.0.0>.apk`. A pasta pelo versionCode guarda cada build
 * (dois builds da mesma versão não se sobrescrevem) e o arquivo mantém o nome do build.
 */
export function chaveDoApk(nomeApk: string, versionCode: string | number | null | undefined, prefixo = 'apk'): string {
  if (!/^[A-Za-z0-9._-]+\.apk$/.test(nomeApk)) throw new Error(`nome de APK inválido: ${nomeApk}`);
  const pasta = versionCode === null || versionCode === undefined || String(versionCode).trim() === '' ? 'sem-versioncode' : `build-${String(versionCode).trim()}`;
  const base = prefixo.replace(/^\/+|\/+$/g, '');
  return `${base ? `${base}/` : ''}${pasta}/${nomeApk}`;
}

/** Endereço e caminho no estilo de caminho a partir do endpoint (`https://br-se1.magaluobjects.com`), do bucket e da chave. */
export function alvoNoBucket(endpoint: string, bucket: string, chave: string): { protocolo: string; host: string; caminho: string } {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error(`o endpoint do bucket precisa ser https: ${url.protocol}`);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`nome de bucket inválido: ${bucket}`);
  const base = url.pathname.replace(/\/+$/, '');
  return { protocolo: url.protocol, host: url.host, caminho: `${base}/${bucket}/${chave}` };
}
