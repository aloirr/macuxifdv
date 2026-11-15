/**
 * RN-CORE-23 item 3 / RF-CORE-09: o que o app faz com um push do servidor. Funções puras (rodam em Node nos testes); a
 * parte nativa (expo-notifications) fica em `services/push.ts`.
 *
 * Formato combinado com o servidor (`modules/core/api/push.ts`: `data: { link }`; T-0065 acrescenta a lista de entidades):
 * - `data.entidades`: lista de entidades do sync com mudança para o usuário (`['pedido']`). Vem como lista, como texto
 *   JSON (`'["pedido"]'`, o FCM só leva texto) ou separada por vírgula. Sem a lista, o app faz a verificação de novidades.
 * - `data.link`: rota do app (`/m/pedido?id=...`, `/m/core/notificacoes`). Só caminhos internos começando por `/`.
 * - `data.pedido_id`: atalho para o detalhe do pedido quando não vem `link`.
 * Push SILENCIOSO = sem título e sem corpo: só dispara o motor, nada aparece na bandeja.
 * FCM direto (v1.0.10): `data` chega como mapa de textos; `entidades` vem como texto JSON ou separado por vírgula.
 */
import { PushTokenSchema } from '@macuxi/core/contracts';

/** Nome de entidade do sync: letras minúsculas, dígitos e `_` (ex.: `pedido`, `cliente_condicao`). */
const NOME_ENTIDADE = /^[a-z][a-z0-9_]{0,62}$/;
const MAX_ENTIDADES = 50;

type DadosPush = Readonly<Record<string, unknown>> | null | undefined;

/** Lista de entidades indicada pelo servidor (sem repetição, só nomes válidos) ou `null` quando o push não traz lista. */
export function entidadesDoPush(dados: DadosPush): string[] | null {
  const bruto = dados?.entidades;
  if (bruto === undefined || bruto === null) return null;
  let lista: unknown = bruto;
  if (typeof bruto === 'string') {
    const texto = bruto.trim();
    if (texto.startsWith('[')) {
      try {
        lista = JSON.parse(texto);
      } catch {
        return null;
      }
    } else lista = texto === '' ? [] : texto.split(',');
  }
  if (!Array.isArray(lista)) return null;
  const nomes = lista.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => NOME_ENTIDADE.test(x));
  return [...new Set(nomes)].slice(0, MAX_ENTIDADES);
}

/** Rota do app para abrir ao tocar no push, ou `null`. Nunca endereço externo nem esquema (`//host`, `https:`, `macuxi:`). */
export function rotaDoPush(dados: DadosPush): string | null {
  const link = dados?.link;
  if (typeof link === 'string') {
    const l = link.trim();
    if (l.startsWith('/') && !l.startsWith('//') && !l.includes('\\') && l.length <= 500) return l;
  }
  const pedido = dados?.pedido_id;
  if (typeof pedido === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(pedido)) return `/m/pedido?id=${encodeURIComponent(pedido)}`;
  return null;
}

/** Push sem título e sem corpo: silencioso (só sincroniza). */
export function pushSilencioso(conteudo: { title?: string | null; body?: string | null } | null | undefined): boolean {
  return !conteudo?.title && !conteudo?.body;
}

/**
 * Token do aparelho para o registro do push: vale o que o contrato `PushTokenSchema` aceita (ADR 0053 §1: tokens Expo
 * e FCM convivem; o servidor tira o tipo do formato). O app não tem regra própria de formato.
 */
export function tokenPushValido(token: unknown): token is string {
  return PushTokenSchema.shape.token.safeParse(token).success;
}

type Mapa = Record<string, unknown>;

function mapa(v: unknown): Mapa | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Mapa) : null;
}

/**
 * `data` do push como mapa. FCM direto: mapa de textos (`{ link, entidades }`). Formato Expo: os dados vêm em
 * `dataString` (texto JSON), que é aberto e prevalece sobre as chaves soltas.
 */
export function dadosDoPush(data: unknown): Mapa {
  const d = mapa(data);
  if (!d) return {};
  const texto = d.dataString;
  if (typeof texto === 'string' && texto.trim().startsWith('{')) {
    try {
      const aberto = mapa(JSON.parse(texto));
      if (aberto) return { ...d, ...aberto };
    } catch {
      // texto ilegível: fica com as chaves soltas
    }
  }
  return d;
}

/**
 * Mensagem entregue à tarefa `macuxi-push-sync` (o expo-notifications roda a tarefa a cada mensagem do FCM, com o app
 * aberto ou não): `{ data: { ...dados }, notification: { title, body } | null }`. `soDados` = sem o bloco `notification`:
 * com o app aberto, o expo-notifications não entrega essa mensagem ao ouvinte do primeiro plano, só à tarefa.
 */
export function mensagemDaTarefaPush(payload: unknown): { dados: Mapa; soDados: boolean } {
  const p = mapa(payload) ?? {};
  return { dados: dadosDoPush(p.data), soDados: mapa(p.notification) === null };
}

/** Registro do token no servidor: chave local por usuário e aparelho, para não repetir o PUT a cada abertura. */
export function chaveRegistroPush(usuarioId: string): string {
  return `fv:push:${usuarioId}`;
}

export interface RegistroPush {
  token: string;
  dispositivo_id: string;
  /** ISO; o app registra de novo depois de 7 dias (garantia: o servidor limpa o token no logout e quando outro usuário registra o mesmo token). */
  em: string;
}

export const VALIDADE_REGISTRO_PUSH_MS = 7 * 24 * 60 * 60_000;

/** Precisa mandar o token ao servidor: nunca mandou, mudou o token ou o aparelho, ou o último envio tem 7 dias. */
export function precisaRegistrarPush(anterior: RegistroPush | null, token: string, dispositivoId: string, agora: number): boolean {
  if (!anterior) return true;
  if (anterior.token !== token || anterior.dispositivo_id !== dispositivoId) return true;
  const em = Date.parse(anterior.em);
  return !Number.isFinite(em) || agora - em >= VALIDADE_REGISTRO_PUSH_MS || agora < em;
}
