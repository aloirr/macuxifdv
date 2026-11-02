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
 */

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

/** Token do Expo aceito pelo servidor (`montarMensagemExpo` em modules/core/api/push.ts). */
export function tokenExpoValido(token: unknown): token is string {
  return typeof token === 'string' && token.length <= 300 && /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

/** Registro do token no servidor: chave local por usuário e aparelho, para não repetir o PUT a cada abertura. */
export function chaveRegistroPush(usuarioId: string): string {
  return `fv:push:${usuarioId}`;
}

export interface RegistroPush {
  token: string;
  dispositivo_id: string;
  /** ISO; o app registra de novo depois de 7 dias (o servidor pode ter limpado o token num novo login). */
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
