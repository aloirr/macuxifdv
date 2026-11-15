/**
 * Adaptador S3 genérico da porta `ArmazenamentoArquivos` (ADR 0010 §3, complemento na ADR 0020; T-0074).
 * Fala o protocolo S3 (PUT/GET/DELETE de objeto, assinatura AWS Signature V4) com `fetch` e `node:crypto`, sem SDK:
 * vale para o Object Storage da Magalu Cloud (br-se1), MinIO, AWS S3 ou qualquer compatível. Tudo por variável
 * (`lerArmazenamentoDoAmbiente`): endpoint, região, bucket, prefixo, chave e segredo. O disco local continua em dev e no CI.
 *
 * Isolamento entre tenants (RN-CORE-05): a chave do objeto é `<prefixo><tenant_id>/<modulo>/<aaaa-mm>/<id>.jpg`, no
 * formato fechado de `chaveDoArquivo` (conferido aqui de novo antes de virar URL). Quem decide se alguém pode ler é a
 * rota (`arquivos.ts`: linha de `plataforma.arquivo` com RLS + licença, perfil e carteira); o bucket é privado e só a
 * API tem a chave. As fotos nunca saem por URL pré-assinada; só os pacotes publicados (instalador do Conector, ADR 0037,
 * `pacotes.ts`) saem por link GET assinado de validade curta (`preAssinarGetS3`), gerado pela rota que decide o acesso.
 * ADR 0054: a única escrita por URL assinada é a PARTE do ZIP do lote (`urlEnvio`, PUT de uma chave `.pNNN.zip` fixa, 15 min),
 * ligável e desligada por padrão. `tamanho` usa HEAD (o `concluir` confere as partes sem baixá-las).
 * Log: nunca a chave de acesso, o segredo nem a assinatura; erros levam só o status HTTP e o código S3.
 */
import { createHash, createHmac } from 'node:crypto';
import { CHAVE_ARQUIVO_RE, criarArmazenamentoEmDisco, DIR_ARQUIVOS_PADRAO, type ArmazenamentoArquivos } from './arquivos';

export interface ConfigS3 {
  /** Ex.: `https://br-se1.magaluobjects.com` (sem barra no fim). */
  endpoint: string;
  /** Ex.: `br-se1`. Entra no escopo da assinatura. */
  regiao: string;
  bucket: string;
  chaveId: string;
  segredo: string;
  /** Prefixo dentro do bucket (ex.: `arquivos/`); os backups ficam em `backups/`. Vazio = raiz. */
  prefixo?: string;
  /** `caminho` (padrão: `<endpoint>/<bucket>/<chave>`) ou `virtual` (`<bucket>.<host>/<chave>`). */
  estilo?: 'caminho' | 'virtual';
  /** Para testes. */
  fetch?: typeof fetch;
  agora?: () => Date;
  /** Tempo máximo por chamada (padrão 15 s). */
  timeoutMs?: number;
}

const sha256Hex = (dados: string | Uint8Array) => createHash('sha256').update(dados).digest('hex');
const hmac = (chave: string | Buffer, dados: string) => createHmac('sha256', chave).update(dados).digest();

/** Codificação de caminho do S3 (RFC 3986; a barra entre segmentos fica). */
export function codificarCaminhoS3(caminho: string): string {
  return caminho
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export interface PedidoAssinavel {
  metodo: string;
  /** Caminho já codificado (ex.: `/bucket/a/b.jpg`). */
  caminho: string;
  /** Cabeçalhos a assinar (o `host` precisa estar aqui). Nomes em qualquer caixa. */
  cabecalhos: Record<string, string>;
  /** sha256 hex do corpo (ou `UNSIGNED-PAYLOAD`). */
  hashCorpo: string;
}

/** `AAAAMMDDTHHMMSSZ` (formato do `x-amz-date`). */
const dataAmz = (quando: Date) => quando.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Codificação de nome/valor da query string do S3 (RFC 3986; aqui a barra também vira `%2F`). */
const codificarValorS3 = (v: string) => codificarCaminhoS3(v).replace(/\//g, '%2F');

/** Escopo e assinatura SigV4 de um pedido canônico já montado (por cabeçalho ou por query string). */
function assinarCanonico(pedidoCanonico: string, cred: { segredo: string; regiao: string }, amzData: string): { escopo: string; assinatura: string } {
  const dia = amzData.slice(0, 8);
  const escopo = `${dia}/${cred.regiao}/s3/aws4_request`;
  const paraAssinar = ['AWS4-HMAC-SHA256', amzData, escopo, sha256Hex(pedidoCanonico)].join('\n');
  const chave = hmac(hmac(hmac(hmac(`AWS4${cred.segredo}`, dia), cred.regiao), 's3'), 'aws4_request');
  return { escopo, assinatura: createHmac('sha256', chave).update(paraAssinar).digest('hex') };
}

/**
 * AWS Signature Version 4 (serviço `s3`, sem query string). Devolve o valor do cabeçalho `Authorization`.
 * Exportada para o teste conferir a assinatura do lado do "servidor".
 */
export function assinarSigV4(p: PedidoAssinavel, cred: { chaveId: string; segredo: string; regiao: string }, quando: Date): string {
  const amzData = dataAmz(quando);
  const nomes = Object.keys(p.cabecalhos)
    .map((n) => n.toLowerCase())
    .sort();
  const porNome = new Map(Object.entries(p.cabecalhos).map(([n, v]) => [n.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const));
  const canonicos = nomes.map((n) => `${n}:${porNome.get(n)}\n`).join('');
  const assinados = nomes.join(';');
  const pedidoCanonico = [p.metodo.toUpperCase(), p.caminho, '', canonicos, assinados, p.hashCorpo].join('\n');
  const { escopo, assinatura } = assinarCanonico(pedidoCanonico, cred, amzData);
  return `AWS4-HMAC-SHA256 Credential=${cred.chaveId}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`;
}

/** Query string canônica do SigV4: nomes e valores codificados (RFC 3986) e ordenados pelo nome. */
export function canonicaConsultaS3(consulta: Record<string, string>): string {
  return Object.entries(consulta)
    .map(([n, v]) => [codificarValorS3(n), codificarValorS3(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([n, v]) => `${n}=${v}`)
    .join('&');
}

/**
 * URL pré-assinada SigV4 por query string: GET, só o cabeçalho `host` assinado, corpo `UNSIGNED-PAYLOAD`, válida por
 * `validadeS` segundos a partir de `quando` (depois o bucket recusa). `consulta` entra na assinatura (ex.:
 * `response-content-disposition`). ADR 0037: só para pacotes publicados, nunca para fotos.
 * Exportada para o teste conferir contra o exemplo da documentação da AWS e para o S3 falso recalcular.
 */
export function preAssinarGetS3(
  p: { protocolo: string; host: string; caminho: string; consulta?: Record<string, string> },
  cred: { chaveId: string; segredo: string; regiao: string },
  quando: Date,
  validadeS: number,
): string {
  return preAssinarS3('GET', p, cred, quando, validadeS);
}

/** Como `preAssinarGetS3`, para `GET` ou `PUT` (ADR 0054: a parte do ZIP). O método entra na assinatura. */
export function preAssinarS3(
  metodo: string | undefined,
  p: { protocolo: string; host: string; caminho: string; consulta?: Record<string, string> },
  cred: { chaveId: string; segredo: string; regiao: string },
  quando: Date,
  validadeS: number,
): string {
  const verbo = (metodo ?? 'GET').toUpperCase();
  if (verbo !== 'GET' && verbo !== 'PUT') throw new Error('URL pré-assinada só para GET ou PUT');
  if (!(Number.isInteger(validadeS) && validadeS >= 1 && validadeS <= 604_800)) throw new Error('validade da URL pré-assinada fora de 1 s a 7 dias');
  const amzData = dataAmz(quando);
  const consulta: Record<string, string> = {
    ...p.consulta,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cred.chaveId}/${amzData.slice(0, 8)}/${cred.regiao}/s3/aws4_request`,
    'X-Amz-Date': amzData,
    'X-Amz-Expires': String(validadeS),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = canonicaConsultaS3(consulta);
  const pedidoCanonico = [verbo, p.caminho, qs, `host:${p.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const { assinatura } = assinarCanonico(pedidoCanonico, cred, amzData);
  return `${p.protocolo}//${p.host}${p.caminho}?${qs}&X-Amz-Signature=${assinatura}`;
}

/** Erro do armazenamento sem dado sensível (só operação, status e código S3). */
export class ErroArmazenamentoS3 extends Error {
  constructor(
    readonly operacao: 'gravar' | 'ler' | 'remover' | 'tamanho' | 'pacote',
    readonly status: number,
    readonly codigoS3: string | null,
  ) {
    super(`S3 ${operacao}: HTTP ${status}${codigoS3 ? ` (${codigoS3})` : ''}`);
    this.name = 'ErroArmazenamentoS3';
  }
}

/** Prefixo dentro do bucket: minúsculas, dígitos, `/`, `_` e `-`, terminado em `/`. */
export const PREFIXO_S3_RE = /^[a-z0-9][a-z0-9/_-]*\/$/;

export async function codigoDoErro(r: Response): Promise<string | null> {
  const texto = await r.text().catch(() => '');
  return /<Code>([^<]{1,64})<\/Code>/.exec(texto)?.[1] ?? null;
}

/** Cliente S3 mínimo sobre a chave COMPLETA do objeto (já com o prefixo); quem chama valida a chave. */
export interface ClienteS3 {
  /** Pedido assinado por cabeçalho. `tipo` = `content-type` do PUT (padrão `application/octet-stream`). */
  chamar(metodo: 'PUT' | 'GET' | 'HEAD' | 'DELETE', chaveCompleta: string, corpo?: Uint8Array, tipo?: string): Promise<Response>;
  /** GET (padrão) ou PUT pré-assinado por `validadeS` segundos a partir de agora (relógio do cliente). */
  urlPreAssinada(chaveCompleta: string, validadeS: number, consulta?: Record<string, string>, metodo?: 'GET' | 'PUT'): { url: string; expiraEm: Date };
}

export function criarClienteS3(cfg: Omit<ConfigS3, 'prefixo'>): ClienteS3 {
  const base = new URL(cfg.endpoint);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('MACUXI_S3_ENDPOINT precisa ser http(s)://');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket)) throw new Error('MACUXI_S3_BUCKET inválido');
  const virtual = cfg.estilo === 'virtual';
  const host = virtual ? `${cfg.bucket}.${base.host}` : base.host;
  const raiz = (base.pathname.replace(/\/$/, '') || '') + (virtual ? '' : `/${cfg.bucket}`);
  const buscar = cfg.fetch ?? fetch;
  const agora = cfg.agora ?? (() => new Date());
  const timeoutMs = cfg.timeoutMs ?? 15_000;
  const caminhoDe = (chaveCompleta: string) => `${raiz}/${codificarCaminhoS3(chaveCompleta)}`;

  return {
    chamar(metodo, chaveCompleta, corpo, tipo) {
      const caminho = caminhoDe(chaveCompleta);
      const hashCorpo = sha256Hex(corpo ?? '');
      const quando = agora();
      const amzData = dataAmz(quando);
      const assinados: Record<string, string> = { host, 'x-amz-content-sha256': hashCorpo, 'x-amz-date': amzData };
      const autorizacao = assinarSigV4({ metodo, caminho, cabecalhos: assinados, hashCorpo }, cfg, quando);
      const cabecalhos: Record<string, string> = {
        'x-amz-content-sha256': hashCorpo,
        'x-amz-date': amzData,
        authorization: autorizacao,
      };
      if (corpo) cabecalhos['content-type'] = tipo ?? 'application/octet-stream';
      return buscar(`${base.protocol}//${host}${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo ? Buffer.from(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    urlPreAssinada(chaveCompleta, validadeS, consulta, metodo = 'GET') {
      const quando = agora();
      const url = preAssinarS3(metodo, { protocolo: base.protocol, host, caminho: caminhoDe(chaveCompleta), consulta }, cfg, quando, validadeS);
      return { url, expiraEm: new Date(quando.getTime() + validadeS * 1000) };
    },
  };
}

export function criarArmazenamentoS3(cfg: ConfigS3): ArmazenamentoArquivos {
  const prefixo = cfg.prefixo ?? '';
  if (prefixo && !PREFIXO_S3_RE.test(prefixo)) throw new Error('MACUXI_S3_PREFIXO inválido (ex.: arquivos/)');
  const cliente = criarClienteS3(cfg);

  const chamar = async (metodo: 'PUT' | 'GET' | 'HEAD' | 'DELETE', chave: string, corpo?: Uint8Array): Promise<Response> => {
    if (!CHAVE_ARQUIVO_RE.test(chave)) throw new Error('chave de arquivo inválida');
    return cliente.chamar(metodo, prefixo + chave, corpo, corpo ? tipoDoObjeto(chave) : undefined);
  };

  return {
    async gravar(chave, bytes) {
      const r = await chamar('PUT', chave, bytes);
      if (!r.ok) throw new ErroArmazenamentoS3('gravar', r.status, await codigoDoErro(r));
      await r.body?.cancel();
    },
    async ler(chave) {
      const r = await chamar('GET', chave);
      if (r.status === 404) {
        await r.body?.cancel();
        return null;
      }
      if (!r.ok) throw new ErroArmazenamentoS3('ler', r.status, await codigoDoErro(r));
      return new Uint8Array(await r.arrayBuffer());
    },
    async remover(chave) {
      const r = await chamar('DELETE', chave);
      if (!r.ok && r.status !== 404) throw new ErroArmazenamentoS3('remover', r.status, await codigoDoErro(r));
      await r.body?.cancel();
    },
    async tamanho(chave) {
      const r = await chamar('HEAD', chave);
      await r.body?.cancel();
      if (r.status === 404) return null;
      if (!r.ok) throw new ErroArmazenamentoS3('tamanho', r.status, null);
      const n = Number(r.headers.get('content-length'));
      return Number.isInteger(n) && n >= 0 ? n : null;
    },
    urlEnvio(chave, validadeS) {
      // só a parte do ZIP (ADR 0054): foto e miniatura nunca são escritas por URL assinada
      if (!CHAVE_ARQUIVO_RE.test(chave) || !/\.p\d{3}\.zip$/.test(chave)) throw new Error('chave de arquivo inválida');
      return cliente.urlPreAssinada(prefixo + chave, validadeS, undefined, 'PUT');
    },
  };
}

/** `content-type` do objeto pela extensão da chave (a parte do ZIP é um pedaço binário, não um ZIP inteiro). */
function tipoDoObjeto(chave: string): string {
  if (chave.endsWith('.zip')) return 'application/octet-stream';
  if (chave.endsWith('.png')) return 'image/png';
  if (chave.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Escolhe o adaptador pelo ambiente (`servidor.ts`):
 * - `MACUXI_ARQUIVOS_DRIVER` ausente ou `disco`: disco local em `MACUXI_ARQUIVOS_DIR` (dev, CI, plano B);
 * - `s3`: exige `MACUXI_S3_ENDPOINT`, `MACUXI_S3_REGIAO`, `MACUXI_S3_BUCKET`, `MACUXI_S3_CHAVE_ID` e `MACUXI_S3_SEGREDO`
 *   (opcionais: `MACUXI_S3_PREFIXO`, `MACUXI_S3_ESTILO=caminho|virtual`). Falta alguma = erro na subida (falha fechada),
 *   com o NOME da variável e nunca o valor.
 */
export function lerArmazenamentoDoAmbiente(env: NodeJS.ProcessEnv): { armazenamento: ArmazenamentoArquivos; descricao: string } {
  const driver = (env.MACUXI_ARQUIVOS_DRIVER ?? 'disco').trim().toLowerCase() || 'disco';
  if (driver === 'disco') {
    const dir = env.MACUXI_ARQUIVOS_DIR || DIR_ARQUIVOS_PADRAO;
    return { armazenamento: criarArmazenamentoEmDisco(dir), descricao: 'disco' };
  }
  if (driver !== 's3') throw new Error(`MACUXI_ARQUIVOS_DRIVER inválido: use disco ou s3`);
  const cfg = lerConfigS3DoAmbiente(env);
  return { armazenamento: criarArmazenamentoS3(cfg), descricao: `s3 ${new URL(cfg.endpoint).host}/${cfg.bucket}/${cfg.prefixo}` };
}

/** Lê `MACUXI_S3_*` (sem decidir o driver). Falta alguma = erro com o NOME da variável, nunca o valor. */
export function lerConfigS3DoAmbiente(env: NodeJS.ProcessEnv): ConfigS3 {
  const exigidas = ['MACUXI_S3_ENDPOINT', 'MACUXI_S3_REGIAO', 'MACUXI_S3_BUCKET', 'MACUXI_S3_CHAVE_ID', 'MACUXI_S3_SEGREDO'] as const;
  const faltando = exigidas.filter((n) => !env[n]?.trim());
  if (faltando.length) throw new Error(`MACUXI_ARQUIVOS_DRIVER=s3 sem ${faltando.join(', ')}: a API não sobe (falha fechada).`);
  const estilo = (env.MACUXI_S3_ESTILO ?? 'caminho').trim().toLowerCase();
  if (estilo !== 'caminho' && estilo !== 'virtual') throw new Error('MACUXI_S3_ESTILO inválido: use caminho ou virtual');
  const v = (n: (typeof exigidas)[number]) => (env[n] ?? '').trim();
  return {
    endpoint: v('MACUXI_S3_ENDPOINT').replace(/\/$/, ''),
    regiao: v('MACUXI_S3_REGIAO'),
    bucket: v('MACUXI_S3_BUCKET'),
    chaveId: v('MACUXI_S3_CHAVE_ID'),
    segredo: v('MACUXI_S3_SEGREDO'),
    prefixo: env.MACUXI_S3_PREFIXO?.trim() || '',
    estilo,
  };
}
