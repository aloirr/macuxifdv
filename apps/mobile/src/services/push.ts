/**
 * Push no app (RN-CORE-23 item 3, RF-CORE-09; T-0065 A) com expo-notifications. As regras (lista de entidades, rota ao
 * tocar, silencioso, quando registrar o token) estão em `lib/push.ts`; aqui fica o que depende do aparelho:
 * - canal Android "Avisos" e o que aparece com o app aberto (push visível vira banner; silencioso não aparece);
 * - permissão e token do Expo, registrado no servidor em `PUT /v1/dispositivos/atual/push` (Core, `PushTokenSchema`);
 * - push recebido com o app aberto → o agendador sincroniza (só as entidades indicadas); toque no push → abre a rota;
 * - push silencioso com o app em segundo plano ou fechado → tarefa `macuxi-push-sync` (definida no escopo global, na
 *   importação feita pelo `index.ts`), que roda a mesma passada do ADR 0017.
 * Sem Firebase no build (`GOOGLE_SERVICES_JSON` ausente: build de desenvolvimento) ou sem o módulo nativo (APK antigo),
 * nada quebra: o token não sai e o app segue com o botão Sincronizar e a atualização automática.
 * Nenhum dado pessoal em log: só mensagens técnicas curtas.
 */
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { chaveRegistroPush, entidadesDoPush, precisaRegistrarPush, pushSilencioso, rotaDoPush, tokenExpoValido, type RegistroPush } from '@/lib/push';
import { semDerrubar, semDerrubarAgora } from '@/lib/trava-sync';

import { readJson, writeJson } from './storage';
import { registrarErroDaTarefa, rodarPassadaEmSegundoPlano } from './segundo-plano';

type ModNotificacoes = typeof import('expo-notifications');
type ModTaskManager = typeof import('expo-task-manager');

/** Tarefa do push silencioso com o app fora do primeiro plano. */
export const TAREFA_PUSH_SYNC = 'macuxi-push-sync';
const CANAL = 'avisos';
const CHAVE_ULTIMO_TOQUE = 'fv:push:ultimo_toque';

function nativos(): { n: ModNotificacoes; tm: ModTaskManager | null } | null {
  if (Platform.OS !== 'android') return null;
  try {
    if (!requireOptionalNativeModule('ExpoPushTokenManager')) return null;
    const n = require('expo-notifications') as ModNotificacoes;
    let tm: ModTaskManager | null = null;
    try {
      tm = requireOptionalNativeModule('ExpoTaskManager') ? (require('expo-task-manager') as ModTaskManager) : null;
    } catch {
      tm = null;
    }
    return { n, tm };
  } catch {
    return null;
  }
}

const nat = nativos();

function dadosDe(conteudo: { data?: unknown } | null | undefined): Record<string, unknown> {
  const d = conteudo?.data;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
}

// ---------- escopo global: o que aparece com o app aberto e a tarefa do push silencioso ----------
// T-0140: roda na carga do bundle, também quando o Android acorda o app sem tela (depois da atualização do APK o
// expo-task-manager restaura a tarefa): um erro aqui derrubaria o app a cada abertura, então vai ao Diagnóstico
semDerrubarAgora(() => {
  if (!nat) return;
  nat.n.setNotificationHandler({
    handleNotification: async (notificacao) => {
      const visivel = !pushSilencioso(notificacao.request.content);
      return { shouldShowBanner: visivel, shouldShowList: visivel, shouldPlaySound: visivel, shouldSetBadge: false };
    },
  });
  if (nat.tm && !nat.tm.isTaskDefined(TAREFA_PUSH_SYNC)) {
    nat.tm.defineTask(TAREFA_PUSH_SYNC, async () => {
      // app aberto: o ouvinte do primeiro plano já sincroniza (sem passada dobrada); a passada nunca lança e grava o
      // próprio resultado no Diagnóstico (abrindo, sincronizando ou com build novo, ela não roda: lib/segundo-plano.ts)
      if (AppState.currentState === 'active') return;
      await semDerrubar(() => rodarPassadaEmSegundoPlano(), registrarErroDaTarefa(TAREFA_PUSH_SYNC), null);
    });
  }
}, registrarErroDaTarefa(TAREFA_PUSH_SYNC));

export interface OuvintesPush {
  /** Push recebido com o app aberto (visível ou silencioso): sincroniza as entidades indicadas (null = novidades). */
  aoAviso(entidades: string[] | null): void;
  /** Toque no push: abre a rota no app. */
  aoAbrir(rota: string): void;
}

/** Liga os ouvintes (app aberto). Devolve a função que desliga. Também trata o toque que abriu o app fechado. */
export function ouvirPush(o: OuvintesPush): () => void {
  if (!nat) return () => undefined;
  const { n } = nat;
  const recebido = n.addNotificationReceivedListener((notificacao) => {
    o.aoAviso(entidadesDoPush(dadosDe(notificacao.request.content)));
  });
  // o último toque fica gravado: reabrir o app não abre de novo a tela do push antigo
  const tocar = async (r: { notification: { request: { identifier: string; content: { data?: unknown } } } } | null) => {
    if (!r) return;
    const id = r.notification.request.identifier;
    if ((await readJson<string>(CHAVE_ULTIMO_TOQUE)) === id) return;
    await writeJson(CHAVE_ULTIMO_TOQUE, id);
    const dados = dadosDe(r.notification.request.content);
    o.aoAviso(entidadesDoPush(dados));
    const rota = rotaDoPush(dados);
    if (rota) o.aoAbrir(rota);
  };
  const resposta = n.addNotificationResponseReceivedListener((r) => void tocar(r).catch(() => undefined));
  void n
    .getLastNotificationResponseAsync()
    .then(tocar)
    .catch(() => undefined);
  return () => {
    recebido.remove();
    resposta.remove();
  };
}

/**
 * Pede a permissão (Android 13+), pega o token do Expo e registra no servidor quando precisa (`precisaRegistrarPush`).
 * `enviar` faz o `PUT /v1/dispositivos/atual/push`. Falha (sem Firebase, sem permissão, sem sinal) devolve o motivo,
 * sem lançar: o app segue sem push.
 */
export async function registrarPush(opcoes: {
  usuarioId: string;
  dispositivoId: string;
  enviar: (corpo: { dispositivo_id: string; token: string; plataforma: 'android' }) => Promise<unknown>;
}): Promise<'registrado' | 'ja_registrado' | 'sem_modulo' | 'sem_permissao' | 'sem_token' | 'falhou'> {
  if (!nat) return 'sem_modulo';
  const { n } = nat;
  try {
    await n.setNotificationChannelAsync(CANAL, { name: 'Avisos', importance: n.AndroidImportance.HIGH });
    let perm = await n.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await n.requestPermissionsAsync();
    if (!perm.granted) return 'sem_permissao';
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const token = (await n.getExpoPushTokenAsync(projectId ? { projectId } : {})).data;
    if (!tokenExpoValido(token)) return 'sem_token';
    // a tarefa do push silencioso só existe com o token (o servidor só manda push a quem registrou)
    if (nat.tm) await n.registerTaskAsync(TAREFA_PUSH_SYNC).catch(() => undefined);
    const chave = chaveRegistroPush(opcoes.usuarioId);
    if (!precisaRegistrarPush(await readJson<RegistroPush>(chave), token, opcoes.dispositivoId, Date.now())) return 'ja_registrado';
    await opcoes.enviar({ dispositivo_id: opcoes.dispositivoId, token, plataforma: 'android' });
    await writeJson(chave, { token, dispositivo_id: opcoes.dispositivoId, em: new Date().toISOString() } satisfies RegistroPush);
    return 'registrado';
  } catch (e) {
    // build sem google-services.json: "Default FirebaseApp is not initialized" — esperado no desenvolvimento
    console.warn(`[push] sem registro: ${e instanceof Error ? e.message.slice(0, 160) : 'erro desconhecido'}`);
    return 'falhou';
  }
}

/** Logout / aparelho bloqueado: esquece o registro local (o próximo login registra de novo). */
export async function esquecerRegistroPush(usuarioId: string): Promise<void> {
  await writeJson(chaveRegistroPush(usuarioId), null);
}
