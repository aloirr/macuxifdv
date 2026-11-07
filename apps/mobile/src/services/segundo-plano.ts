/**
 * ADR 0017 §3 (T-0059): tarefa `macuxi-sync-delta` (expo-background-task = WorkManager no Android, com a restrição
 * "rede conectada"). As regras (quando roda, lease, orçamento de 60 s) estão em `lib/segundo-plano.ts`; aqui fica o que
 * depende do aparelho:
 * - `TaskManager.defineTask` no escopo global, na importação deste arquivo (feita pelo `index.ts` do app ANTES do
 *   expo-router): quando o Android acorda o app fechado, não há React montado e a tarefa monta o motor sozinha;
 * - app aberto neste processo (`registrarAppAberto`): a tarefa usa o motor do app (mesma promessa de `sincronizar`);
 * - ligar (depois da carga inicial) e desligar (logout, aparelho bloqueado) o agendamento.
 * Só Android na v1 (§4). Build sem o módulo nativo (APK anterior a esta dependência): tudo vira no-op, sem quebrar o app.
 */
import { ehAparelhoBloqueado, tratarAparelhoBloqueado } from '@macuxi/core/app';
import type { ArmazenamentoSync, Perfil } from '@macuxi/platform-sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { criarTratadorAparelhoBloqueado } from '@/lib/aparelho-bloqueado';
import { enderecoSalvoValido } from '@/lib/endereco-do-build';
import { shellDaVariante } from '@/lib/modulos';
import {
  CHAVE_LEASE,
  executarTarefaSegundoPlano,
  INTERVALO_MINIMO_MIN,
  TAREFA_SYNC_DELTA,
  type LeaseSync,
  type MotorSegundoPlano,
  type ResultadoSegundoPlano,
} from '@/lib/segundo-plano';
import { varianteAtual } from '@/lib/variante';

import { criarAmbienteDoAparelho } from './ambiente';
import { ApiClient, HttpError, NetworkError } from './api';
import { abrirArmazenamentoDoUsuario, apagarBancosDoAparelho } from './armazenamento';
import { apagarFotosLocais } from './arquivos';
import { gravarTokens, lerTokens } from './credenciais';
import { modoApi, perfilBuildAtual, platformDefaultApiUrl } from './device';
import { consultarModulosEfetivos, criarMotorDoUsuario, trocarRefresh } from './motor-do-usuario';
import { keys, readJson, writeJson } from './storage';

/** Última execução (Diagnóstico do Perfil: "Última sincronização em segundo plano"). */
export const CHAVE_ULTIMO_SEGUNDO_PLANO = 'fv:diagnostico:segundo_plano';

type ModBackgroundTask = typeof import('expo-background-task');
type ModTaskManager = typeof import('expo-task-manager');

/** Módulos nativos, só se o build os tem (o `require` do pacote lançaria sem eles). */
function nativos(): { bt: ModBackgroundTask; tm: ModTaskManager } | null {
  if (Platform.OS !== 'android') return null;
  try {
    if (!requireOptionalNativeModule('ExpoBackgroundTask') || !requireOptionalNativeModule('ExpoTaskManager')) return null;
    return { bt: require('expo-background-task') as ModBackgroundTask, tm: require('expo-task-manager') as ModTaskManager };
  } catch {
    return null;
  }
}

// ---------- app aberto neste processo ----------
interface AppAberto {
  motor: MotorSegundoPlano;
  aoResultado(r: ResultadoSegundoPlano): void;
}
let appAberto: AppAberto | null = null;
let passada: Promise<ResultadoSegundoPlano> | null = null;

/** O app (React) registra o próprio motor: a tarefa usa o mesmo enquanto o processo vive. Devolve o "desregistrar". */
export function registrarAppAberto(motor: MotorSegundoPlano, aoResultado: (r: ResultadoSegundoPlano) => void): () => void {
  const eu: AppAberto = { motor, aoResultado };
  appAberto = eu;
  return () => {
    if (appAberto === eu) appAberto = null;
  };
}

/** Passada da tarefa em andamento NESTE processo (o app reaberto durante a tarefa espera por ela). */
export function passadaEmSegundoPlano(): Promise<ResultadoSegundoPlano> | null {
  return passada;
}

export function lerUltimoSegundoPlano(): Promise<ResultadoSegundoPlano | null> {
  return readJson<ResultadoSegundoPlano>(CHAVE_ULTIMO_SEGUNDO_PLANO);
}

// ---------- motor sem interface (app fechado) ----------
interface SessaoGuardada {
  user?: { id?: string; name?: string; perfil?: Perfil | null };
  tenant?: { id?: string; fuso?: string } | null;
  modo?: string;
}

async function usuarioDaSessao(): Promise<string | null> {
  const [s, tokens] = await Promise.all([readJson<SessaoGuardada>(keys.session), lerTokens()]);
  // mesma regra da abertura do app (`state/plataforma.tsx`): sessão do modo deste build e com token
  if (!s?.user?.id || !tokens?.access || (s.modo ?? 'demo') !== modoApi()) return null;
  return s.user.id;
}

/**
 * T-0088: o armazenamento do usuário e tenant da sessão guardada, pela MESMA abertura do app (uma instância por arquivo no
 * processo; a passagem do AsyncStorage roda uma vez só, aqui mesmo se o app ainda não abriu depois da atualização).
 * Com o espelho gravado e o arquivo sem abrir (`erro`), a tarefa desiste: o app mostra "Tentar de novo".
 */
async function armazenamentoSemInterface(usuarioId: string): Promise<ArmazenamentoSync> {
  const s = await readJson<SessaoGuardada>(keys.session);
  const r = await abrirArmazenamentoDoUsuario({ usuarioId, tenantId: s?.tenant?.id ?? null, ...(s?.tenant?.fuso ? { fuso: s.tenant.fuso } : {}) });
  if (r.tipo === 'erro') throw new Error(`banco local do usuário não abriu: ${r.detalhe}`);
  return r.armazenamento;
}

async function abrirMotorSemInterface(usuarioId: string, armazenamento: Promise<ArmazenamentoSync>): Promise<MotorSegundoPlano> {
  const modo = modoApi();
  const [s, settings] = await Promise.all([readJson<SessaoGuardada>(keys.session), readJson<{ apiUrl?: string | null }>(keys.settings)]);
  const apiUrl = enderecoSalvoValido(perfilBuildAtual(), settings?.apiUrl) ?? platformDefaultApiUrl();
  let token = (await lerTokens())?.access ?? null;
  let sessaoInvalida = false;
  let bloqueado = false;
  const motorRef: { m: ReturnType<typeof criarMotorDoUsuario> | null } = { m: null };

  // RN-CORE-15: 423 em qualquer chamada limpa o aparelho (sem interface: sem aviso nem navegação; o app abre no login)
  const tratarBloqueio = criarTratadorAparelhoBloqueado(
    {
      motor: () => motorRef.m,
      apagarBancos: apagarBancosDoAparelho,
      chavesLocais: async () => [...(await AsyncStorage.getAllKeys())],
      removerChaves: async (chaves) => {
        await Promise.all(chaves.map((k) => writeJson(k, null)));
      },
      apagarFotos: apagarFotosLocais,
      apagarTokens: () => gravarTokens(null),
      fecharSessao: () => {
        bloqueado = true;
        void desligarSyncEmSegundoPlano();
      },
      avisar: () => undefined,
      irParaLogin: () => undefined,
    },
    tratarAparelhoBloqueado,
    ehAparelhoBloqueado,
  );

  // sessão: o refresh que falha NÃO encerra a sessão aqui (a tarefa só desiste; o app pede login na próxima abertura)
  const renovar = async (): Promise<string | null> => {
    try {
      const novo = await trocarRefresh(apiUrl);
      if (novo) token = novo;
      else sessaoInvalida = true;
      return novo;
    } catch (e) {
      if (await tratarBloqueio(e).catch(() => false)) return null;
      if (!(e instanceof NetworkError) && !(e instanceof HttpError && (e.status >= 500 || e.status === 408 || e.status === 429))) sessaoInvalida = true;
      return null;
    }
  };
  const api = () => new ApiClient(apiUrl, token, modo === 'v1' ? renovar : undefined, (e) => void tratarBloqueio(e).catch(() => undefined));
  const ambiente = criarAmbienteDoAparelho({
    api,
    online: () => !bloqueado && !sessaoInvalida,
    usuario: () => ({
      id: usuarioId,
      nome: s?.user?.name ?? '',
      perfil: s?.user?.perfil ?? null,
      ...(s?.tenant?.fuso ? { fuso: s.tenant.fuso } : {}),
    }),
  });
  const m = criarMotorDoUsuario({
    usuarioId,
    armazenamento: await armazenamento,
    shell: shellDaVariante(varianteAtual()),
    modo,
    api,
    online: () => !bloqueado && !sessaoInvalida,
    ambiente,
  });
  motorRef.m = m;
  await m.carregar();

  return {
    sincronizadoEm: () => m.estado().sincronizado_em,
    erro: () => m.estado().erro,
    // ADR 0018 item 8: API real = atualização leve (`GET /v1/sync/novidades`, que já traz os módulos efetivos quando
    // mudam; sem cursor, o próprio motor faz a completa). Demonstração (Fase M, sem novidades): completa.
    sincronizar: () => (modo === 'v1' ? m.sincronizarNovidades() : m.sincronizar()),
    async prepararSessao() {
      // API real: nada a consultar antes (os módulos vêm na resposta das novidades; 1 requisição sem mudança)
      if (modo === 'v1') {
        if (bloqueado) return 'aparelho-bloqueado';
        return sessaoInvalida ? 'sessao-invalida' : 'ok';
      }
      try {
        const { efetivos, parametros } = await consultarModulosEfetivos(api(), modo, s?.user?.perfil ?? null);
        if (bloqueado) return 'aparelho-bloqueado';
        await m.aplicarModulosAtivos(efetivos, parametros);
        return 'ok';
      } catch (e) {
        if (bloqueado || ehAparelhoBloqueado(e) || (e instanceof HttpError && e.status === 423)) return 'aparelho-bloqueado';
        if (sessaoInvalida || (e instanceof HttpError && e.status === 401)) return 'sessao-invalida';
        if (e instanceof NetworkError) return 'sem-rede';
        throw e;
      }
    },
  };
}

/** Uma passada (chamada pelo sistema). Nunca duas ao mesmo tempo neste processo. */
export function rodarPassadaEmSegundoPlano(): Promise<ResultadoSegundoPlano> {
  passada ??= (async () => {
    // lease e motor na mesma abertura (o reserva no AsyncStorage não fica guardado no SDK: uma tentativa por passada)
    const abertos = new Map<string, Promise<ArmazenamentoSync>>();
    const armazenamentoDe = (usuarioId: string) => {
      let a = abertos.get(usuarioId);
      if (!a) {
        a = armazenamentoSemInterface(usuarioId);
        abertos.set(usuarioId, a);
      }
      return a;
    };
    const r = await executarTarefaSegundoPlano({
      agora: () => Date.now(),
      modoSemSinal: async () => Boolean(await readJson<boolean>(keys.offline)),
      motorDoApp: () => appAberto?.motor ?? null,
      usuarioDaSessao,
      lease: (usuarioId) => {
        const a = armazenamentoDe(usuarioId);
        return {
          ler: async () => (await a).ler<LeaseSync>(CHAVE_LEASE),
          gravar: async (l) => (await a).gravar(CHAVE_LEASE, l),
          remover: async () => (await a).remover(CHAVE_LEASE),
        };
      },
      abrirMotor: (usuarioId) => abrirMotorSemInterface(usuarioId, armazenamentoDe(usuarioId)),
    });
    await writeJson(CHAVE_ULTIMO_SEGUNDO_PLANO, r);
    if (r.resultado === 'falhou' || r.resultado === 'parcial') console.warn(`[sync segundo plano] ${r.resultado}: ${r.mensagem ?? ''}`);
    appAberto?.aoResultado(r);
    return r;
  })().finally(() => {
    passada = null;
  });
  return passada;
}

// ---------- definição (escopo global) e agendamento ----------
const nat = nativos();
if (nat && !nat.tm.isTaskDefined(TAREFA_SYNC_DELTA)) {
  nat.tm.defineTask(TAREFA_SYNC_DELTA, async () => {
    const r = await rodarPassadaEmSegundoPlano();
    return r.resultado === 'falhou' ? nat.bt.BackgroundTaskResult.Failed : nat.bt.BackgroundTaskResult.Success;
  });
}

/** Liga o agendamento (idempotente). Chamado pelo app quando há carga gravada (`sincronizado_em`). */
export async function ligarSyncEmSegundoPlano(): Promise<void> {
  if (!nat) return;
  try {
    if ((await nat.bt.getStatusAsync()) !== nat.bt.BackgroundTaskStatus.Available) return;
    if (await nat.tm.isTaskRegisteredAsync(TAREFA_SYNC_DELTA)) return;
    await nat.bt.registerTaskAsync(TAREFA_SYNC_DELTA, { minimumInterval: INTERVALO_MINIMO_MIN });
  } catch (e) {
    console.warn(`[sync segundo plano] não foi possível agendar: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Desliga o agendamento (logout, aparelho bloqueado). */
export async function desligarSyncEmSegundoPlano(): Promise<void> {
  if (!nat) return;
  try {
    if (await nat.tm.isTaskRegisteredAsync(TAREFA_SYNC_DELTA)) await nat.bt.unregisterTaskAsync(TAREFA_SYNC_DELTA);
  } catch {
    // sem agendamento para desligar
  }
}
