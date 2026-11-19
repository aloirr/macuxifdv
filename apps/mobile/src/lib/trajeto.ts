/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): regras puras da tarefa `macuxi-trajeto`, sem nada
 * nativo (o lado do aparelho fica em `services/trajeto.ts`). A condição de negócio (`podeRastrear`, §3.2) é do Core e
 * entra pronta; aqui só o que o shell faz com ela: montar o ponto, filtrar o lote, ligar ou desligar e o estado do
 * Diagnóstico. Nenhuma coordenada sai daqui para log, erro, Diagnóstico ou telemetria (§9).
 *
 * PROVISÓRIO: `CondicaoTrajeto`, `MotivoSemTrajeto` e `PontoDoTrajeto` são locais até o modulo-core publicar
 * `podeRastrear` (domain) e `PontoTrajeto` em `@macuxi/core/contracts`; aí estes tipos passam a vir de lá.
 */
import { formatHHMM } from '@macuxi/comum/fuso';

export const TAREFA_TRAJETO = 'macuxi-trajeto';

/** Motivo de não rastrear (§2). Provisório: passa a vir de `podeRastrear` do Core. */
export type MotivoSemTrajeto =
  | 'desligado'
  | 'cargo'
  | 'sem_aceite'
  | 'fora_do_expediente'
  | 'feriado'
  | 'ausencia'
  | 'pausa'
  | 'sem_permissao';

/** Resultado de `podeRastrear` (§3.2). Provisório: passa a vir de `@macuxi/core`. */
export type CondicaoTrajeto = { pode: true } | { pode: false; motivo: MotivoSemTrajeto };

/** Ponto do trajeto, só os campos do §3.1. Provisório: passa a ser `PontoTrajeto` de `@macuxi/core/contracts`. */
export interface PontoDoTrajeto {
  id: string;
  capturado_em: string;
  latitude: number;
  longitude: number;
  precisao_m: number | null;
  velocidade_ms: number | null;
}

/** Leitura entregue pelo expo-location (`LocationObject`); altitude e rumo chegam e são ignorados (§3.1). */
export interface LeituraDeLocalizacao {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
  };
}

/**
 * Parâmetros do `startLocationUpdatesAsync` (§3.1). `accuracy: 4` é o `Accuracy.High` do expo-location (`Location.types`),
 * em número para este arquivo não importar o módulo nativo. A notificação fixa não tem ação nem texto além do título; o
 * expo-location 57 cria para ela o canal próprio `<appId>:macuxi-trajeto` com IMPORTANCE_LOW, sem som
 * (`LocationTaskService.kt`).
 */
export const OPCOES_TRAJETO = {
  accuracy: 4,
  distanceInterval: 200,
  timeInterval: 300_000,
  deferredUpdatesInterval: 300_000,
  foregroundService: {
    notificationTitle: 'Macuxi Campo — localização ativa no expediente',
    // obrigatório no tipo do expo-location; vazio para a notificação mostrar só o título
    notificationBody: '',
    killServiceOnDestroy: false,
  },
} as const;

const casas6 = (n: number): number => Number(n.toFixed(6));
const numeroOuNulo = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** Leitura → ponto do §3.1, ou `null` se a leitura não serve (instante ou coordenada fora da faixa). */
export function pontoDaLeitura(leitura: LeituraDeLocalizacao, novoId: () => string): PontoDoTrajeto | null {
  const { timestamp, coords } = leitura;
  if (!Number.isFinite(timestamp)) return null;
  const { latitude, longitude } = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const velocidade = numeroOuNulo(coords.speed);
  return {
    id: novoId(),
    capturado_em: new Date(timestamp).toISOString(),
    latitude: casas6(latitude),
    longitude: casas6(longitude),
    precisao_m: numeroOuNulo(coords.accuracy),
    velocidade_ms: velocidade !== null && velocidade >= 0 ? velocidade : null,
  };
}

/**
 * Lote do Android (§3.2): cada ponto é julgado pela condição no instante dele (o lote pode cruzar o fim do expediente) e o
 * recusado é descartado. `parar` quando a condição recusa a leitura mais recente: a tarefa desliga a captura.
 */
export function pontosDoLote(
  leituras: readonly LeituraDeLocalizacao[],
  condicao: (instanteMs: number) => CondicaoTrajeto,
  novoId: () => string,
): { pontos: PontoDoTrajeto[]; parar: boolean } {
  const pontos: PontoDoTrajeto[] = [];
  let maisRecente = Number.NEGATIVE_INFINITY;
  let parar = false;
  for (const leitura of leituras) {
    const ponto = pontoDaLeitura(leitura, novoId);
    if (!ponto) continue;
    const pode = condicao(leitura.timestamp).pode;
    if (pode) pontos.push(ponto);
    if (leitura.timestamp >= maisRecente) {
      maisRecente = leitura.timestamp;
      parar = !pode;
    }
  }
  return { pontos, parar };
}

/** Liga só se pode e ainda não está ativa; desliga se está ativa e não pode mais; senão mantém (§3.2). */
export function acaoDoTrajeto(condicao: CondicaoTrajeto, ativa: boolean): 'ligar' | 'desligar' | 'manter' {
  if (condicao.pode) return ativa ? 'manter' : 'ligar';
  return ativa ? 'desligar' : 'manter';
}

export type EstadoDoTrajeto = 'ativa' | 'fora_do_expediente' | 'pausada' | 'sem_termo' | 'desligada';

/** Estado do Diagnóstico (§9), só pelo motivo: nunca o lugar. */
export function estadoDoTrajeto(condicao: CondicaoTrajeto, ativa: boolean): EstadoDoTrajeto {
  if (condicao.pode) return ativa ? 'ativa' : 'desligada';
  switch (condicao.motivo) {
    case 'fora_do_expediente':
    case 'feriado':
    case 'ausencia':
      return 'fora_do_expediente';
    case 'pausa':
      return 'pausada';
    case 'sem_aceite':
      return 'sem_termo';
    default:
      return 'desligada';
  }
}

export const TEXTOS_TRAJETO: Record<EstadoDoTrajeto, string> = {
  ativa: 'Ativa',
  fora_do_expediente: 'Fora do expediente',
  pausada: 'Pausada',
  sem_termo: 'Sem termo',
  desligada: 'Desligada',
};

/** Linha do Diagnóstico: o estado e, se houver, a hora do último ponto no fuso do tenant (§9). */
export function textoDoEstadoDoTrajeto(estado: EstadoDoTrajeto, ultimoPontoIso: string | null, fuso: string): string {
  const texto = TEXTOS_TRAJETO[estado];
  return ultimoPontoIso ? `${texto} · último ponto às ${formatHHMM(ultimoPontoIso, fuso)}` : texto;
}

/**
 * Número decimal com cara de coordenada (`-3.119027`, `60.0217`). Fica de fora o que o suporte precisa: hora ISO
 * (`00.000Z`, depois de `:`), versão (`1.0.15`) e pilha (`index.bundle:1234:56789`).
 */
const COORDENADA = /(?<![\d:.])-?\d+\.\d+(?![\d.])/g;
export const MARCADOR_COORDENADA = '‹coord›';

const semCoordenada = (texto: string): string => texto.replace(COORDENADA, MARCADOR_COORDENADA);

/** Erro da tarefa para o Diagnóstico sem nenhuma coordenada na mensagem nem na pilha (§9). */
export function erroSemCoordenada(e: unknown): Error {
  const original = e instanceof Error ? e : null;
  const limpo = new Error(semCoordenada(original ? original.message : String(e)));
  if (original) {
    limpo.name = original.name;
    if (original.stack) limpo.stack = semCoordenada(original.stack);
  }
  return limpo;
}
