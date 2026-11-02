/**
 * Push da central de notificações (RF-CORE-09; T-0019 critério 3). Pronto e DESLIGADO por padrão: só envia com
 * `MACUXI_PUSH_ATIVO=1` (o build EAS com expo-notifications é do Alexandre). O despachante da outbox (T-0022) chama
 * `enviarPush` (via `consumidores.ts`) ao consumir `core.notificacao.criada@1`. A mensagem leva só título/corpo curtos e o `link`; nada é logado.
 */
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
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(d.token)) return null;
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

/** Envia em lote; sem a configuração ligada devolve `enviadas: 0` sem tocar na rede. */
export async function enviarPush(
  destinos: readonly DestinoPush[],
  opcoes: { env?: Readonly<Record<string, string | undefined>>; fetcher?: typeof fetch } = {},
): Promise<{ enviadas: number; ignoradas: number }> {
  const mensagens = destinos.map(montarMensagemExpo).filter((m): m is MensagemExpo => m !== null);
  if (!pushAtivo(opcoes.env) || mensagens.length === 0) return { enviadas: 0, ignoradas: destinos.length };
  const resposta = await (opcoes.fetcher ?? fetch)(URL_EXPO_PUSH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(mensagens),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS), // o lote do despachante fica travado enquanto o handler roda
  });
  if (!resposta.ok) throw new Error(`Push Expo recusado (HTTP ${resposta.status}).`);
  return { enviadas: mensagens.length, ignoradas: destinos.length - mensagens.length };
}
