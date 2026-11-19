/**
 * ADR 0017 §3 (T-0059): tarefa `macuxi-sync-delta` (expo-background-task = WorkManager no Android, com a restrição
 * "rede conectada"). As regras (quando roda, trava, orçamento de 60 s) estão em `lib/segundo-plano.ts`; aqui fica o que
 * depende do aparelho:
 * - `TaskManager.defineTask` no escopo global, na importação deste arquivo (feita pelo `index.ts` do app ANTES do
 *   expo-router): quando o Android acorda o app fechado, não há React montado e a tarefa monta o motor sozinha;
 * - app aberto neste processo (`registrarAppAberto`): a tarefa usa o motor do app (mesma promessa de `sincronizar`);
 * - ligar (depois da carga inicial) e desligar (logout, aparelho bloqueado) o agendamento.
 * Só Android na v1 (§4). Build sem o módulo nativo (APK anterior a esta dependência): tudo vira no-op, sem quebrar o app.
 * T-0140 (relatos 1 e 6, o app abria e fechava depois de atualizado e na carga inicial): a tarefa sem tela não toca em tela
 * nem em estado de React (o app relê o resultado ao voltar ao primeiro plano), não roda com o app em primeiro plano, abrindo
 * ou sincronizando (`travaSync`), nem num build que ainda não abriu com tela; a passada é cortada no fim do orçamento; e
 * nenhum erro da tarefa (nem da definição dela, na carga do bundle) derruba o processo: vai ao Diagnóstico.
 */
import { ehAparelhoBloqueado, tratarAparelhoBloqueado } from '@macuxi/core/app';
import type { ArmazenamentoSync } from '@macuxi/platform-sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { criarTratadorAparelhoBloqueado } from '@/lib/aparelho-bloqueado';
import { enderecoSalvoValido } from '@/lib/endereco-do-build';
import { shellDaVariante } from '@/lib/modulos';
import {
  executarTarefaSegundoPlano,
  INTERVALO_MINIMO_MIN,
  TAREFA_SYNC_DELTA,
  type MotorSegundoPlano,
  type ResultadoSegundoPlano,
} from '@/lib/segundo-plano';
import { buildAindaNaoAberto, criarCorteDaPassada, criarTravaSync, idDoBuild, semDerrubar, semDerrubarAgora, type CorteDaPassada } from '@/lib/trava-sync';
import { permissoesLiberadas } from '@/lib/permissoes';
import { varianteAtual } from '@/lib/variante';

import { criarAmbienteDoAparelho } from './ambiente';
import { ApiClient, HttpError, NetworkError } from './api';
import { apagarBancosDoAparelho, driverDoArquivo } from './armazenamento';
import { apagarFotosLocais } from './arquivos';
import { gravarTokens, lerTokens } from './credenciais';
import { modoApi, perfilBuildAtual, platformDefaultApiUrl } from './device';
import { lerPermissoes } from './permissoes';
import { gravarErro } from './erros';
import { consultarModulosEfetivos, criarMotorDoUsuario, trocarRefresh } from './motor-do-usuario';
import { abrirArmazenamentoDaSessao, usuarioDaSessao, type SessaoGuardada } from './sessao-sem-tela';
import { keys, readJson, writeJson } from './storage';
import { atualizarTrajeto, pararTrajeto } from './trajeto';

/** Última execução (Diagnóstico do Perfil: "Última sincronização em segundo plano"). */
export const CHAVE_ULTIMO_SEGUNDO_PLANO = 'fv:diagnostico:segundo_plano';

/** Build que já abriu com tela neste aparelho (`idDoBuild`): a tarefa sem tela só roda depois disso (T-0140). */
export const CHAVE_BUILD_ABERTO = 'fv:app:build_aberto';

/** Trava única do processo entre o app com tela e a tarefa sem tela (`lib/trava-sync.ts`). */
export const travaSync = criarTravaSync();

/** Versão do app + versionCode (sobe a cada build: a instalação por cima sempre muda). */
export function idDoBuildAtual(): string {
  const android = (Constants.platform as { android?: { versionCode?: number | string } } | undefined)?.android;
  return idDoBuild(Constants.expoConfig?.version, android?.versionCode);
}

/** O app abriu com tela neste build (chamado ao fim da abertura): a tarefa sem tela fica liberada. */
export async function marcarBuildAberto(): Promise<void> {
  await writeJson(CHAVE_BUILD_ABERTO, idDoBuildAtual()).catch(() => undefined);
}

/** Erro da tarefa: Diagnóstico do Perfil (`gravarErro` não apaga um fatal ainda não visto) e nunca derruba. */
export const registrarErroDaTarefa = (tarefa: string) => (e: unknown) => void gravarErro(e, 'nao-fatal', `tarefa ${tarefa}`);

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
}
let appAberto: AppAberto | null = null;
let passada: Promise<ResultadoSegundoPlano> | null = null;

/**
 * O app (React) registra o próprio motor: a tarefa usa o mesmo enquanto o processo vive. Devolve o "desregistrar".
 * A tarefa não chama nada do React (T-0140): o app relê o resultado (`lerUltimoSegundoPlano`) ao voltar ao primeiro plano.
 */
export function registrarAppAberto(motor: MotorSegundoPlano): () => void {
  const eu: AppAberto = { motor };
  appAberto = eu;
  return () => {
    if (appAberto === eu) appAberto = null;
  };
}

export function lerUltimoSegundoPlano(): Promise<ResultadoSegundoPlano | null> {
  return readJson<ResultadoSegundoPlano>(CHAVE_ULTIMO_SEGUNDO_PLANO);
}

// ---------- motor sem interface (app fechado) ----------
/** Com o espelho gravado e o arquivo sem abrir (`erro`), a tarefa desiste: o app mostra "Tentar de novo". */
async function armazenamentoSemInterface(usuarioId: string): Promise<ArmazenamentoSemInterface> {
  const r = await abrirArmazenamentoDaSessao(usuarioId);
  if (r.tipo === 'erro') throw new Error(`banco local do usuário não abriu: ${r.detalhe}`);
  return { armazenamento: r.armazenamento, arquivo: r.tipo === 'sqlite' ? r.arquivo : null };
}

/** O armazenamento do motor e o arquivo SQLite dele (`null` na reserva do AsyncStorage), onde ficam os pontos do trajeto. */
interface ArmazenamentoSemInterface {
  armazenamento: ArmazenamentoSync;
  arquivo: string | null;
}

async function abrirMotorSemInterface(
  usuarioId: string,
  aberto: Promise<ArmazenamentoSemInterface>,
  corte: CorteDaPassada,
): Promise<MotorSegundoPlano> {
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
      pararCaptura: pararTrajeto,
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
  // T-0140: depois do orçamento, a próxima requisição da passada é recusada (o motor para na página seguinte)
  const api = () => {
    corte.conferir();
    return new ApiClient(apiUrl, token, modo === 'v1' ? renovar : undefined, (e) => void tratarBloqueio(e).catch(() => undefined));
  };
  const online = () => !bloqueado && !sessaoInvalida && !corte.cortada();
  const ambiente = criarAmbienteDoAparelho({
    api,
    online,
    usuario: () => ({
      id: usuarioId,
      nome: s?.user?.name ?? '',
      perfil: s?.user?.perfil ?? null,
      ...(s?.tenant?.fuso ? { fuso: s.tenant.fuso } : {}),
    }),
  });
  const { armazenamento, arquivo } = await aberto;
  const m = criarMotorDoUsuario({
    usuarioId,
    armazenamento,
    shell: shellDaVariante(varianteAtual()),
    modo,
    api,
    online,
    ambiente,
    perfil: () => s?.user?.perfil ?? null,
    // sem tela: a busca online do Catálogo continua ligada ao motor do app (ADR 0054)
    cargaOnline: false,
    // T-0156: os pontos do trajeto entram na fila antes do envio da passada
    bancoDoTrajeto: () => (arquivo ? driverDoArquivo(arquivo) : null),
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

/** O build instalado ainda não abriu com tela (ou não dá para saber: na dúvida, a tarefa espera a abertura). */
async function buildAindaNaoAbertoNoAparelho(): Promise<boolean> {
  return buildAindaNaoAberto(idDoBuildAtual(), await readJson<string>(CHAVE_BUILD_ABERTO).catch(() => null));
}

/**
 * Uma passada (chamada pelo sistema). Nunca duas ao mesmo tempo neste processo e nunca lança: qualquer erro vira `falhou`
 * no Diagnóstico. Não toca em tela nem em estado de React (T-0140).
 */
export function rodarPassadaEmSegundoPlano(): Promise<ResultadoSegundoPlano> {
  passada ??= (async (): Promise<ResultadoSegundoPlano> => {
    const inicio = Date.now();
    const r = await semDerrubar<ResultadoSegundoPlano>(
      () => passadaUnica(),
      registrarErroDaTarefa(TAREFA_SYNC_DELTA),
      { quando: new Date(inicio).toISOString(), resultado: 'falhou', mensagem: 'Erro inesperado na tarefa.', duracao_ms: Date.now() - inicio },
    );
    await writeJson(CHAVE_ULTIMO_SEGUNDO_PLANO, r).catch(() => undefined);
    if (r.resultado === 'falhou' || r.resultado === 'parcial') console.warn(`[sync segundo plano] ${r.resultado}`);
    // T-0156 (tracking §3.2): cada passada liga ou desliga a captura do trajeto (com o app fechado no início do expediente)
    await atualizarTrajeto();
    return r;
  })().finally(() => {
    passada = null;
  });
  return passada;
}

async function passadaUnica(): Promise<ResultadoSegundoPlano> {
  // T-0140: corte da passada sem tela quando o orçamento acaba (a próxima requisição dela é recusada)
  const corte = criarCorteDaPassada();
  return executarTarefaSegundoPlano({
    agora: () => Date.now(),
    modoSemSinal: async () => Boolean(await readJson<boolean>(keys.offline)),
    motorDoApp: () => appAberto?.motor ?? null,
    usuarioDaSessao,
    // uma abertura do armazenamento por passada (o reserva no AsyncStorage não fica guardado no SDK)
    abrirMotor: (usuarioId) => abrirMotorSemInterface(usuarioId, armazenamentoSemInterface(usuarioId), corte),
    // T-0140: app em primeiro plano, abrindo ou sincronizando = a tarefa não roda; build novo = espera a 1ª abertura
    appEmPrimeiroPlano: () => AppState.currentState === 'active',
    trava: travaSync,
    buildAindaNaoAberto: buildAindaNaoAbertoNoAparelho,
    aoEsgotarOrcamento: () => corte.cortar(),
    // T-0144: a tarefa que dispara junto com a abertura do app (logo depois da atualização) espera a tela montar e desiste
    esperar: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    // T-0145: sem as permissões obrigatórias da variante, nada sincroniza (nem sem tela)
    permissoesLiberadas: async () => permissoesLiberadas(varianteAtual(), await lerPermissoes()),
  });
}

// ---------- definição (escopo global) e agendamento ----------
const nat = nativos();
// na carga do bundle (também quando o Android acorda o app sem tela): um erro aqui derrubaria o app a cada abertura
semDerrubarAgora(() => {
  if (!nat || nat.tm.isTaskDefined(TAREFA_SYNC_DELTA)) return;
  nat.tm.defineTask(TAREFA_SYNC_DELTA, async () => {
    const r = await rodarPassadaEmSegundoPlano();
    return r.resultado === 'falhou' ? nat.bt.BackgroundTaskResult.Failed : nat.bt.BackgroundTaskResult.Success;
  });
}, registrarErroDaTarefa(TAREFA_SYNC_DELTA));

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
