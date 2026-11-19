/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): tarefa `macuxi-trajeto`, o lado do aparelho. As regras
 * (ponto, lote, ligar e desligar, estado, gravação) estão em `lib/trajeto.ts`; aqui fica o que depende do aparelho, no padrão
 * da `macuxi-sync-delta` (`services/segundo-plano.ts`, T-0140):
 * - `TaskManager.defineTask` no escopo global (importado pelo `index.ts`): quando o Android entrega um lote com o app
 *   fechado, não há React montado;
 * - a tarefa não toca em tela nem em estado de React, só grava no SQLite do usuário, e nenhum erro derruba o processo
 *   (vai ao Diagnóstico pelo `erroSemCoordenada`: nenhuma coordenada em log, erro, Diagnóstico ou telemetria, §9);
 * - a captura usa a frequência do parâmetro `rastreamento` do pull (`lerFrequenciaDoTrajeto`) e reinicia quando ela muda;
 * - desligada de fábrica: a condição é a de `condicaoDoTrajeto` (ponto único, `lib/trajeto.ts`), sobre o aceite e a pausa que
 *   o Core grava nas chaves `rastreamento.aceite` e `rastreamento.pausa` do armazenamento dele no banco do usuário;
 * - os pontos de hoje voltam ao Core pelo leitor de `leitorDePontosLocais` (`definirPontosLocaisDoDia`, §3.4).
 * Notificação fixa: o expo-location 57 cria o canal próprio `<appId>:macuxi-trajeto` com IMPORTANCE_LOW, sem som
 * (`LocationTaskService.kt`); nada a criar aqui.
 * Só Android na v1. Build sem os módulos nativos: tudo vira no-op, sem quebrar o app.
 */
import { CHAVE_ACEITE_LOCAL, CHAVE_PAUSA_LOCAL, type LeitorDePontosLocais } from '@macuxi/core/app';
import { PARAMETROS_RASTREAMENTO_PADRAO, type FrequenciaRastreamento } from '@macuxi/core/contracts';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { semDerrubarAgora } from '@/lib/trava-sync';
import {
  condicaoDoTrajeto,
  criarTrajeto,
  erroSemCoordenada,
  gravarPontosDoTrajeto,
  lerEstadoLocalDoRastreamento,
  lerFrequenciaDoTrajeto,
  lerPontosDoDia,
  TAREFA_TRAJETO,
  type CapturaDoAparelho,
  type DiagnosticoDoTrajeto,
  type EstadoLocalDoRastreamento,
  type IntervalosDaCaptura,
  type LeituraDeLocalizacao,
} from '@/lib/trajeto';

import { driverDoArquivo } from './armazenamento';
import { uuid } from './device';
import { gravarErro } from './erros';
import { abrirArmazenamentoDaSessao, usuarioDaSessao } from './sessao-sem-tela';
import { readJson, writeJson } from './storage';

/** Diagnóstico do Perfil: estado e hora do último ponto (`DiagnosticoDoTrajeto`, sem coordenada). */
export const CHAVE_DIAGNOSTICO_TRAJETO = 'fv:diagnostico:trajeto';

export function lerDiagnosticoDoTrajeto(): Promise<DiagnosticoDoTrajeto | null> {
  return readJson<DiagnosticoDoTrajeto>(CHAVE_DIAGNOSTICO_TRAJETO);
}

const registrarErro = (e: Error) => void gravarErro(e, 'nao-fatal', `tarefa ${TAREFA_TRAJETO}`);

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

const captura: CapturaDoAparelho | null = nat && {
  ativa: () => nat.loc.hasStartedLocationUpdatesAsync(TAREFA_TRAJETO),
  ligar: (opcoes) => nat.loc.startLocationUpdatesAsync(TAREFA_TRAJETO, opcoes),
  parar: () => nat.loc.stopLocationUpdatesAsync(TAREFA_TRAJETO),
  // as opções com que a tarefa foi ligada (o expo-location guarda as do `startLocationUpdatesAsync`)
  intervalosEmUso: () => nat.tm.getTaskOptionsAsync<Partial<IntervalosDaCaptura>>(TAREFA_TRAJETO).catch(() => null),
};

/**
 * Os pontos vão ao SQLite do usuário da sessão guardada, aberto como na `macuxi-sync-delta` (a mesma instância do app).
 * Sem sessão, na reserva do AsyncStorage ou com o arquivo que não abriu, o lote é descartado (§2: nada guardado para depois).
 */
async function gravarNoBancoDoUsuario(pontos: Parameters<typeof gravarPontosDoTrajeto>[1]): Promise<void> {
  const usuarioId = await usuarioDaSessao();
  if (!usuarioId) return;
  const aberto = await abrirArmazenamentoDaSessao(usuarioId);
  if (aberto.tipo !== 'sqlite') return;
  await aberto.armazenamento.pronto;
  const db = driverDoArquivo(aberto.arquivo);
  if (db) await gravarPontosDoTrajeto(db, pontos);
}

/** Aceite e pausa gravados pelo Core no banco do usuário da sessão; sem sessão ou com o banco que não abriu, `null` (desligado). */
async function estadoLocalDaSessao(): Promise<EstadoLocalDoRastreamento | null> {
  const usuarioId = await usuarioDaSessao();
  if (!usuarioId) return null;
  const aberto = await abrirArmazenamentoDaSessao(usuarioId);
  if (aberto.tipo === 'erro') return null;
  return lerEstadoLocalDoRastreamento(aberto.armazenamento, { aceite: CHAVE_ACEITE_LOCAL, pausa: CHAVE_PAUSA_LOCAL });
}

/** Frequência do parâmetro `rastreamento` no pull do banco do usuário da sessão; sem sessão ou sem banco, a do padrão do contrato. */
async function frequenciaDaSessao(): Promise<FrequenciaRastreamento> {
  const usuarioId = await usuarioDaSessao();
  if (!usuarioId) return PARAMETROS_RASTREAMENTO_PADRAO.frequencia;
  const aberto = await abrirArmazenamentoDaSessao(usuarioId);
  if (aberto.tipo === 'erro') return PARAMETROS_RASTREAMENTO_PADRAO.frequencia;
  return lerFrequenciaDoTrajeto(aberto.armazenamento);
}

const trajeto = criarTrajeto({
  captura,
  condicao: () => condicaoDoTrajeto(estadoLocalDaSessao),
  frequencia: frequenciaDaSessao,
  gravar: gravarNoBancoDoUsuario,
  novoId: uuid,
  agora: () => Date.now(),
  guardarDiagnostico: async (d) => {
    const atual = await readJson<DiagnosticoDoTrajeto>(CHAVE_DIAGNOSTICO_TRAJETO);
    await writeJson(CHAVE_DIAGNOSTICO_TRAJETO, { estado: 'desligada', ultimo_ponto_em: null, ...atual, ...d });
  },
  registrarErro,
});

// ---------- definição (escopo global) ----------
// na carga do bundle (também quando o Android acorda o app sem tela): um erro aqui derrubaria o app a cada abertura
semDerrubarAgora(
  () => {
    if (!nat || nat.tm.isTaskDefined(TAREFA_TRAJETO)) return;
    nat.tm.defineTask<{ locations?: LeituraDeLocalizacao[] }>(TAREFA_TRAJETO, ({ data, error }) =>
      trajeto.tratarLote(data?.locations ?? [], error),
    );
  },
  (e) => registrarErro(erroSemCoordenada(e)),
);

/**
 * Liga ou desliga a captura pela condição de agora (§3.2: abertura do app depois da carga, volta ao primeiro plano e cada
 * passada da `macuxi-sync-delta`). Nunca lança.
 */
export async function atualizarTrajeto(): Promise<void> {
  await trajeto.atualizar();
}

/** Logout e aparelho bloqueado (§3.4): para a captura antes de fechar ou apagar os bancos do usuário. Nunca lança. */
export function pararTrajeto(): Promise<void> {
  return trajeto.parar();
}

/**
 * Leitor dos pontos do dia no banco aberto pelo motor (`arquivo`), entregue ao Core por `definirPontosLocaisDoDia` na abertura
 * da sessão e retirado no logout e no aparelho bloqueado (`state/plataforma.tsx`). Banco já fechado: vazio (a tela vai ao servidor).
 */
export function leitorDePontosLocais(arquivo: string): LeitorDePontosLocais {
  return async (data, fuso) => {
    const db = driverDoArquivo(arquivo);
    return db ? lerPontosDoDia(db, data, fuso) : [];
  };
}
