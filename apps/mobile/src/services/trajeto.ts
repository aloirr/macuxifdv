/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): tarefa `macuxi-trajeto`, o lado do aparelho. As regras
 * (ponto, lote, ligar e desligar, estado) estão em `lib/trajeto.ts`; aqui fica o que depende do aparelho, no padrão da
 * `macuxi-sync-delta` (`services/segundo-plano.ts`, T-0140):
 * - `TaskManager.defineTask` no escopo global: quando o Android entrega um lote com o app fechado, não há React montado;
 * - a tarefa não toca em tela nem em estado de React, só grava pelo `gravar` configurado, e nenhum erro derruba o processo
 *   (vai ao Diagnóstico pelo `erroSemCoordenada`: nenhuma coordenada em log, erro, Diagnóstico ou telemetria, §9);
 * - desligado de fábrica: sem `configurarTrajeto`, a tarefa para a captura e descarta o lote.
 * Notificação fixa: o expo-location 57 cria o canal próprio `<appId>:macuxi-trajeto` com IMPORTANCE_LOW, sem som
 * (`LocationTaskService.kt`); nada a criar aqui.
 * Só Android na v1. Build sem os módulos nativos: tudo vira no-op, sem quebrar o app.
 *
 * ESQUELETO: este arquivo ainda não é importado pelo `index.ts` nem chamado em lugar nenhum; isso entra com os contratos
 * do modulo-core (`podeRastrear`, `PontoTrajeto` e a tabela local `ponto_trajeto`).
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { semDerrubar, semDerrubarAgora } from '@/lib/trava-sync';
import {
  acaoDoTrajeto,
  erroSemCoordenada,
  OPCOES_TRAJETO,
  pontosDoLote,
  TAREFA_TRAJETO,
  type CondicaoTrajeto,
  type LeituraDeLocalizacao,
  type PontoDoTrajeto,
} from '@/lib/trajeto';

import { uuid } from './device';
import { gravarErro } from './erros';

/**
 * Ponto de injeção. `condicao` carrega o estado do §2 (parâmetros, aceite, expediente, pausa, permissão) e devolve a
 * condição num instante; `gravar` guarda os pontos no SQLite do aparelho. Provisório até o `podeRastrear` do Core.
 */
export interface ConfiguracaoTrajeto {
  condicao: () => Promise<(instanteMs: number) => CondicaoTrajeto>;
  gravar: (pontos: PontoDoTrajeto[]) => Promise<void>;
}

let configuracao: ConfiguracaoTrajeto | null = null;

/** Liga (ou, com `null`, desliga) a configuração da tarefa neste processo. */
export function configurarTrajeto(c: ConfiguracaoTrajeto | null): void {
  configuracao = c;
}

const registrarErro = (e: unknown) => void gravarErro(erroSemCoordenada(e), 'nao-fatal', `tarefa ${TAREFA_TRAJETO}`);

type ModLocation = typeof import('expo-location');
type ModTaskManager = typeof import('expo-task-manager');

/** Módulos nativos, só se o build os tem (o `require` do pacote lançaria sem eles). */
function nativos(): { loc: ModLocation; tm: ModTaskManager } | null {
  if (Platform.OS !== 'android') return null;
  try {
    if (!requireOptionalNativeModule('ExpoLocation') || !requireOptionalNativeModule('ExpoTaskManager')) return null;
    return { loc: require('expo-location') as ModLocation, tm: require('expo-task-manager') as ModTaskManager };
  } catch {
    return null;
  }
}

const nat = nativos();

async function captura(): Promise<boolean> {
  if (!nat) return false;
  return nat.loc.hasStartedLocationUpdatesAsync(TAREFA_TRAJETO);
}

async function pararCaptura(): Promise<void> {
  if (nat && (await captura())) await nat.loc.stopLocationUpdatesAsync(TAREFA_TRAJETO);
}

/** Um lote entregue pelo Android. Não lança (o chamador envolve em `semDerrubar`). */
async function tratarLote(leituras: readonly LeituraDeLocalizacao[]): Promise<void> {
  const c = configuracao;
  // desligado de fábrica: sem configuração, nada grava e a captura para
  if (!c) {
    await pararCaptura();
    return;
  }
  const condicao = await c.condicao();
  const { pontos, parar } = pontosDoLote(leituras, condicao, uuid);
  try {
    if (pontos.length > 0) await c.gravar(pontos);
  } finally {
    if (parar || !condicao(Date.now()).pode) await pararCaptura();
  }
}

// ---------- definição (escopo global) ----------
// na carga do bundle (também quando o Android acorda o app sem tela): um erro aqui derrubaria o app a cada abertura
semDerrubarAgora(() => {
  if (!nat || nat.tm.isTaskDefined(TAREFA_TRAJETO)) return;
  nat.tm.defineTask<{ locations?: LeituraDeLocalizacao[] }>(TAREFA_TRAJETO, async ({ data, error }) => {
    await semDerrubar(
      async () => {
        if (error) throw new Error(`erro da captura: ${error.message}`);
        await tratarLote(data?.locations ?? []);
      },
      registrarErro,
      undefined,
    );
  });
}, registrarErro);

/**
 * Liga ou desliga a captura pela condição de agora (§3.2: abertura do app, volta ao primeiro plano e cada passada da
 * `macuxi-sync-delta`). Sem configuração, desliga. Nunca lança.
 */
export async function atualizarTrajeto(): Promise<void> {
  if (!nat) return;
  await semDerrubar(
    async () => {
      const c = configuracao;
      const ativa = await captura();
      const condicao: CondicaoTrajeto = c ? (await c.condicao())(Date.now()) : { pode: false, motivo: 'desligado' };
      const acao = acaoDoTrajeto(condicao, ativa);
      if (acao === 'ligar') await nat.loc.startLocationUpdatesAsync(TAREFA_TRAJETO, OPCOES_TRAJETO);
      else if (acao === 'desligar') await nat.loc.stopLocationUpdatesAsync(TAREFA_TRAJETO);
    },
    registrarErro,
    undefined,
  );
}
