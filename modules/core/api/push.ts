/**
 * Push da central de notificações (RF-CORE-09; T-0019 critério 3). Pronto e DESLIGADO por padrão: só envia com
 * `MACUXI_PUSH_ATIVO=1` (o build EAS com expo-notifications é do Alexandre). O despachante da outbox (T-0022) chama
 * `enviarPush` (via `consumidores.ts`) ao consumir `core.notificacao.criada@1`. A mensagem leva só título/corpo curtos e o `link`; nada é logado.
 * ADR 0053: tokens Expo seguem em lote no exp.host; tokens FCM vão um a um no FCM HTTP v1 (OAuth por JWT RS256 com `node:crypto`).
 */
import { createSign } from 'node:crypto';
import { REGEX_TOKEN_EXPO, tipoDoToken } from '../contracts';

export interface DestinoPush {
  token: string;
  titulo: string;
  corpo: string;
  link: string | null;
  prioridade: 'normal' | 'alta';
  /** Entidades do pull que mudaram (RN-CORE-23): o app sincroniza só elas. */
  entidades?: readonly string[];
}

export interface MensagemExpo {
  to: string;
  /** Omitidos no push silencioso (sem título e sem corpo; só `data.entidades`). */
  title?: string;
  body?: string;
  priority: 'default' | 'high';
  data: { link: string | null; entidades?: string[] };
}

/** Limite do envio ao Expo (ADR 0007: o lote do despachante espera o handler). */
export const TEMPO_LIMITE_MS = 10_000;
export const URL_EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

export const pushAtivo = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => env.MACUXI_PUSH_ATIVO === '1';

/** Só tokens do Expo (`ExponentPushToken[...]`); corpo cortado em 178 caracteres para caber na bandeja. */
export function montarMensagemExpo(d: DestinoPush): MensagemExpo | null {
  if (!REGEX_TOKEN_EXPO.test(d.token)) return null;
  const data = d.entidades && d.entidades.length > 0 ? { link: d.link, entidades: [...d.entidades] } : { link: d.link };
  // Silencioso (RN-CORE-23): sem título e sem corpo, prioridade alta para chegar com o app em segundo plano.
  if (d.titulo.trim() === '' && d.corpo.trim() === '') return { to: d.token, priority: 'high', data };
  return {
    to: d.token,
    title: d.titulo.slice(0, 120),
    body: d.corpo.length > 178 ? `${d.corpo.slice(0, 177)}…` : d.corpo,
    priority: d.prioridade === 'alta' ? 'high' : 'default',
    data,
  };
}


type Env = Readonly<Record<string, string | undefined>>;

// ---------- FCM HTTP v1 (ADR 0053) ----------
export const URL_TOKEN_GOOGLE = 'https://oauth2.googleapis.com/token';
export const ESCOPO_FCM = 'https://www.googleapis.com/auth/firebase.messaging';
export const CONCORRENCIA_FCM = 5;
const MARGEM_CACHE_S = 300;

export interface ContaServico {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export interface CacheOAuth {
  token?: string;
  venceEm?: number; // ms
  pendente?: Promise<string>;
}

export interface MensagemFcm {
  message: {
    token: string;
    notification?: { title: string; body: string };
    android: { priority: 'HIGH'; notification?: { channel_id: 'avisos' } };
    data: Record<string, string>;
  };
}

const b64u = (v: Buffer | string): string => Buffer.from(v).toString('base64url');

/** Lê `FCM_SERVICE_ACCOUNT_JSON` (base64). Devolve null se faltar ou estiver ilegível; nunca expõe o conteúdo. */
export function lerContaServico(env: Env): { conta: ContaServico; projeto: string } | null {
  const bruto = env.FCM_SERVICE_ACCOUNT_JSON;
  const projeto = env.FCM_PROJECT_ID;
  if (!bruto || !projeto) return null;
  try {
    const j = JSON.parse(Buffer.from(bruto, 'base64').toString('utf8')) as Partial<ContaServico>;
    if (typeof j.client_email !== 'string' || typeof j.private_key !== 'string') return null;
    return { conta: { client_email: j.client_email, private_key: j.private_key, private_key_id: j.private_key_id }, projeto };
  } catch {
    return null;
  }
}

/** JWT RS256 da conta de serviço (ADR 0053 §3). `agora` em ms. */
export function assinarJwtGoogle(conta: ContaServico, agora: number): string {
  const iat = Math.floor(agora / 1000);
  const cab = { alg: 'RS256', typ: 'JWT', ...(conta.private_key_id ? { kid: conta.private_key_id } : {}) };
  const carga = { iss: conta.client_email, scope: ESCOPO_FCM, aud: URL_TOKEN_GOOGLE, iat, exp: iat + 3600 };
  const corpo = `${b64u(JSON.stringify(cab))}.${b64u(JSON.stringify(carga))}`;
  const assinatura = createSign('RSA-SHA256').update(corpo).sign(conta.private_key);
  return `${corpo}.${b64u(assinatura)}`;
}

/** Token OAuth em cache até 5 min antes de vencer; uma troca por vez. */
export async function tokenOAuth(conta: ContaServico, o: { fetcher: typeof fetch; agora: () => number; cache: CacheOAuth; renovar?: boolean }): Promise<string> {
  const c = o.cache;
  if (o.renovar) {
    c.token = undefined;
    c.venceEm = undefined;
  }
  if (c.token && c.venceEm && o.agora() < c.venceEm) return c.token;
  if (c.pendente) return c.pendente;
  c.pendente = (async () => {
    try {
      const r = await o.fetcher(URL_TOKEN_GOOGLE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assinarJwtGoogle(conta, o.agora()) }).toString(),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
      if (!r.ok) throw new ErroPush(`Troca do token OAuth recusada (HTTP ${r.status}).`);
      const j = (await r.json()) as { access_token?: string; expires_in?: number };
      if (!j.access_token) throw new ErroPush('Resposta do OAuth sem access_token.');
      c.token = j.access_token;
      c.venceEm = o.agora() + Math.max(0, (j.expires_in ?? 3600) - MARGEM_CACHE_S) * 1000;
      return c.token;
    } finally {
      c.pendente = undefined;
    }
  })();
  return c.pendente;
}

export class ErroPush extends Error {}

/** Mensagem FCM; `data` só com texto (`link` omitido se nulo; `entidades` em JSON texto). */
export function montarMensagemFcm(d: DestinoPush): MensagemFcm {
  const data: Record<string, string> = {};
  if (d.link) data.link = d.link;
  if (d.entidades && d.entidades.length > 0) data.entidades = JSON.stringify([...d.entidades]);
  if (d.titulo.trim() === '' && d.corpo.trim() === '') return { message: { token: d.token, android: { priority: 'HIGH' }, data } };
  return {
    message: {
      token: d.token,
      notification: { title: d.titulo.slice(0, 120), body: d.corpo.length > 178 ? `${d.corpo.slice(0, 177)}…` : d.corpo },
      android: { priority: 'HIGH', notification: { channel_id: 'avisos' } },
      data,
    },
  };
}

type ResultadoFcm = 'enviada' | 'limpar' | 'descartada';

async function lerErroFcm(r: Response): Promise<{ status?: string; token: boolean }> {
  try {
    const j = (await r.json()) as { error?: { status?: string; details?: unknown } };
    return { status: j.error?.status, token: JSON.stringify(j.error?.details ?? '').includes('message.token') };
  } catch {
    return { token: false };
  }
}

async function enviarUmFcm(
  d: DestinoPush,
  projeto: string,
  conta: ContaServico,
  o: { fetcher: typeof fetch; agora: () => number; cache: CacheOAuth; log: (m: string) => void },
): Promise<ResultadoFcm> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projeto)}/messages:send`;
  const body = JSON.stringify(montarMensagemFcm(d));
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await tokenOAuth(conta, { ...o, renovar: tentativa > 0 });
    let r: Response;
    try {
      r = await o.fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch {
      throw new ErroPush('Falha de rede no FCM.');
    }
    if (r.ok) return 'enviada';
    if (r.status === 401 && tentativa === 0) continue;
    const e = await lerErroFcm(r);
    if (r.status === 404 || e.status === 'UNREGISTERED' || e.status === 'NOT_FOUND') return 'limpar';
    if (r.status === 400 && e.status === 'INVALID_ARGUMENT' && e.token) return 'limpar';
    if (r.status === 403) o.log(`push_fcm_config HTTP 403 ${e.status ?? ''}`.trim());
    if (r.status === 400 || r.status === 413) {
      o.log(`push_fcm_descartada HTTP ${r.status} ${e.status ?? ''}`.trim());
      return 'descartada';
    }
    throw new ErroPush(`FCM recusou (HTTP ${r.status}${e.status ? ` ${e.status}` : ''}).`);
  }
  throw new ErroPush('FCM recusou (HTTP 401).');
}

const cacheProcesso: CacheOAuth = {};
let avisouFcmDesligado = false;

export interface OpcoesEnvio {
  env?: Env;
  fetcher?: typeof fetch;
  /** Relógio em ms (teste). */
  agora?: () => number;
  /** Chamado com o token FCM que o Google recusou como inexistente/inválido (limpa `push_token`). */
  limparToken?: (token: string) => Promise<void>;
  cache?: CacheOAuth;
  log?: (mensagem: string) => void;
}

/** Envia: Expo em lote, FCM um a um (até 5 em paralelo). Sem a configuração ligada devolve `enviadas: 0` sem tocar na rede. */
export async function enviarPush(destinos: readonly DestinoPush[], opcoes: OpcoesEnvio = {}): Promise<{ enviadas: number; ignoradas: number; limpas: number }> {
  if (!pushAtivo(opcoes.env)) return { enviadas: 0, ignoradas: destinos.length, limpas: 0 };
  const fetcher = opcoes.fetcher ?? fetch;
  const log = opcoes.log ?? ((m: string) => console.warn(m));
  let enviadas = 0;
  let limpas = 0;
  const erros: string[] = [];

  const expo = destinos.map(montarMensagemExpo).filter((m): m is MensagemExpo => m !== null);
  if (expo.length > 0) {
    try {
      const resposta = await fetcher(URL_EXPO_PUSH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(expo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS), // o lote do despachante fica travado enquanto o handler roda
      });
      if (!resposta.ok) throw new ErroPush(`Push Expo recusado (HTTP ${resposta.status}).`);
      enviadas += expo.length;
    } catch (e) {
      erros.push(e instanceof Error ? e.message : 'Falha no push Expo.');
    }
  }

  const fcm = destinos.filter((d) => d.token !== '' && tipoDoToken(d.token) === 'fcm');
  if (fcm.length > 0) {
    const cfg = lerContaServico(opcoes.env ?? process.env);
    if (!cfg) {
      if (!avisouFcmDesligado || opcoes.log) log('push_fcm_desligado');
      avisouFcmDesligado = true;
    } else {
      const o = { fetcher, agora: opcoes.agora ?? Date.now, cache: opcoes.cache ?? cacheProcesso, log };
      const fila = [...fcm];
      const trabalhador = async (): Promise<void> => {
        for (let d = fila.shift(); d; d = fila.shift()) {
          try {
            const r = await enviarUmFcm(d, cfg.projeto, cfg.conta, o);
            if (r === 'enviada') enviadas++;
            else if (r === 'limpar') {
              await opcoes.limparToken?.(d.token);
              limpas++;
            }
          } catch (e) {
            erros.push(e instanceof Error ? e.message : 'Falha no push FCM.');
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCORRENCIA_FCM, fcm.length) }, trabalhador));
    }
  }

  if (erros.length > 0) throw new ErroPush(`Push com ${erros.length} falha(s) para nova tentativa: ${[...new Set(erros)].join(' | ')}`);
  return { enviadas, ignoradas: destinos.length - enviadas - limpas, limpas };
}
