/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): regras puras da tarefa `macuxi-trajeto`, sem nada
 * nativo (o lado do aparelho fica em `services/trajeto.ts`). A condição de negócio (`podeRastrear`, §3.2) é do Core e
 * entra pronta; aqui só o que o shell faz com ela: montar o ponto, filtrar o lote, ligar ou desligar e o estado do
 * Diagnóstico. Nenhuma coordenada sai daqui para log, erro, Diagnóstico ou telemetria (§9).
 *
 * Tipos do contrato do Core (`@macuxi/core/contracts`): `MotivoSemRastreio` e `PontoTrajeto` (validado pelo `PontoTrajetoSchema`).
 */
import { formatHHMM } from '@macuxi/comum/fuso';
import { PontoTrajetoSchema, type MotivoSemRastreio, type PontoTrajeto } from '@macuxi/core/contracts';
import type { DriverSqlite } from '@macuxi/platform-sdk';

import { semDerrubar } from './trava-sync';

export const TAREFA_TRAJETO = 'macuxi-trajeto';

/** Resultado do portão `podeRastrear` do Core (§3.2), com o motivo do contrato. */
export type CondicaoTrajeto = { pode: true } | { pode: false; motivo: MotivoSemRastreio };

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

/** Leitura → ponto do §3.1 validado pelo `PontoTrajetoSchema`, ou `null` se a leitura não serve (instante, coordenada ou precisão). */
export function pontoDaLeitura(leitura: LeituraDeLocalizacao, novoId: () => string): PontoTrajeto | null {
  const { timestamp, coords } = leitura;
  if (!Number.isFinite(timestamp)) return null;
  const { latitude, longitude } = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const velocidade = numeroOuNulo(coords.speed);
  const ponto = PontoTrajetoSchema.safeParse({
    id: novoId(),
    capturado_em: new Date(timestamp).toISOString(),
    latitude: casas6(latitude),
    longitude: casas6(longitude),
    precisao_m: numeroOuNulo(coords.accuracy),
    velocidade_ms: velocidade !== null && velocidade >= 0 ? velocidade : null,
  });
  // o erro do Zod repetiria a coordenada (§9): só o descarte
  return ponto.success ? ponto.data : null;
}

/**
 * Lote do Android (§3.2): cada ponto é julgado pela condição no instante dele (o lote pode cruzar o fim do expediente) e o
 * recusado é descartado. `parar` quando a condição recusa a leitura mais recente: a tarefa desliga a captura.
 */
export function pontosDoLote(
  leituras: readonly LeituraDeLocalizacao[],
  condicao: (instanteMs: number) => CondicaoTrajeto,
  novoId: () => string,
): { pontos: PontoTrajeto[]; parar: boolean } {
  const pontos: PontoTrajeto[] = [];
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

export type AcaoDoTrajeto = 'ligar' | 'desligar' | 'manter';

/** Liga só se pode e ainda não está ativa; desliga se está ativa e não pode mais; senão mantém (§3.2). */
export function acaoDoTrajeto(condicao: CondicaoTrajeto, ativa: boolean): AcaoDoTrajeto {
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
    // §2, condição 1: sem termo publicado a empresa ainda não ligou o tracking; app e cargo de fora, ou sem a permissão
    case 'desligado':
    case 'sem_termo':
    case 'cargo':
    case 'app':
    case 'sem_permissao':
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

/** §2, condição 1: o rastreamento vem desligado de fábrica. */
const DESLIGADO: CondicaoTrajeto = { pode: false, motivo: 'desligado' };

/**
 * PONTO ÚNICO da condição do §2 no shell (RN-CORE-13). Hoje devolve sempre "desligado": a tarefa NUNCA liga de fábrica.
 * TROCAR AQUI quando o Core expuser `podeRastrear` e os parâmetros `rastreamento` em `@macuxi/core/app`: ler uma vez os
 * parâmetros, o aceite, os feriados, as ausências, a pausa e a permissão, e devolver
 * `(instante) => podeRastrear({ ..., instante, fuso })`, com o app da variante no portão (o Gestão nunca rastreia).
 */
export function condicaoDoTrajeto(): Promise<(instanteMs: number) => CondicaoTrajeto> {
  return Promise.resolve(() => DESLIGADO);
}

/** A captura do aparelho (`expo-location`, `services/trajeto.ts`). */
export interface CapturaDoAparelho {
  ativa(): Promise<boolean>;
  ligar(): Promise<void>;
  parar(): Promise<void>;
}

/** O que o Diagnóstico do Perfil guarda (§9): o estado e a hora do último ponto, nunca a coordenada. */
export interface DiagnosticoDoTrajeto {
  estado: EstadoDoTrajeto;
  ultimo_ponto_em: string | null;
}

export interface DepsDoTrajeto {
  /** `null` = build sem os módulos nativos (tudo vira nada). */
  captura: CapturaDoAparelho | null;
  condicao(): Promise<(instanteMs: number) => CondicaoTrajeto>;
  gravar(pontos: PontoTrajeto[]): Promise<void>;
  novoId(): string;
  agora(): number;
  guardarDiagnostico(d: Partial<DiagnosticoDoTrajeto>): Promise<void>;
  /** Recebe o erro já sem coordenada (`erroSemCoordenada`). */
  registrarErro(e: Error): void;
}

const instanteMaisRecente = (pontos: readonly PontoTrajeto[]): string =>
  pontos.reduce((a, p) => (Date.parse(p.capturado_em) > Date.parse(a) ? p.capturado_em : a), pontos[0]!.capturado_em);

/**
 * A tarefa `macuxi-trajeto` sobre as dependências do aparelho. Nenhuma função lança: o erro vai ao `registrarErro` sem
 * coordenada (§3.1 e §9).
 * - `atualizar`: os três gatilhos do §3.2 (abertura depois da carga, volta ao primeiro plano, passada da `macuxi-sync-delta`);
 * - `parar`: logout e aparelho bloqueado, antes de fechar ou apagar os bancos (§3.4);
 * - `tratarLote`: o lote entregue pelo Android; o ponto recusado pela condição é descartado e a captura para.
 */
export function criarTrajeto(d: DepsDoTrajeto) {
  const registrar = (e: unknown) => d.registrarErro(erroSemCoordenada(e));
  const pararSeAtiva = async (c: CapturaDoAparelho) => {
    if (await c.ativa()) await c.parar();
  };
  return {
    atualizar(): Promise<AcaoDoTrajeto | null> {
      const c = d.captura;
      if (!c) return Promise.resolve(null);
      return semDerrubar<AcaoDoTrajeto | null>(
        async () => {
          const ativa = await c.ativa();
          const agora = (await d.condicao())(d.agora());
          const acao = acaoDoTrajeto(agora, ativa);
          if (acao === 'ligar') await c.ligar();
          else if (acao === 'desligar') await c.parar();
          await d.guardarDiagnostico({ estado: estadoDoTrajeto(agora, acao === 'manter' ? ativa : acao === 'ligar') });
          return acao;
        },
        registrar,
        null,
      );
    },
    async parar(): Promise<void> {
      const c = d.captura;
      if (!c) return;
      await semDerrubar(
        async () => {
          await pararSeAtiva(c);
          await d.guardarDiagnostico({ estado: 'desligada', ultimo_ponto_em: null });
        },
        registrar,
        undefined,
      );
    },
    async tratarLote(leituras: readonly LeituraDeLocalizacao[], erro: { message: string } | null): Promise<void> {
      const c = d.captura;
      if (!c) return;
      await semDerrubar(
        async () => {
          if (erro) throw new Error(`erro da captura: ${erro.message}`);
          const condicao = await d.condicao();
          const { pontos, parar } = pontosDoLote(leituras, condicao, d.novoId);
          try {
            if (pontos.length > 0) {
              await d.gravar(pontos);
              await d.guardarDiagnostico({ ultimo_ponto_em: instanteMaisRecente(pontos) });
            }
          } finally {
            if (parar || !condicao(d.agora()).pode) await pararSeAtiva(c);
          }
        },
        registrar,
        undefined,
      );
    },
  };
}

/** Linhas por comando: 6 parâmetros cada, longe do limite de parâmetros do SQLite. */
const PONTOS_POR_COMANDO = 500;
const INSERIR_PONTOS =
  'INSERT OR IGNORE INTO core__ponto_trajeto (id, capturado_em, latitude, longitude, precisao_m, velocidade_ms, enviado_em) VALUES ';

/**
 * Grava os pontos em `core__ponto_trajeto` (SQLite do usuário; docs/banco/aparelho-sqlite.md §11) com `enviado_em` nulo
 * (na fila), idempotente pelo id (§3.4). Sem a tabela (o Core ainda não declarou as migrações do aparelho), descarta e
 * devolve 0. Devolve quantos pontos entraram.
 */
export async function gravarPontosDoTrajeto(db: Pick<DriverSqlite, 'rodar'>, pontos: readonly PontoTrajeto[]): Promise<number> {
  let inseridos = 0;
  try {
    for (let i = 0; i < pontos.length; i += PONTOS_POR_COMANDO) {
      const parte = pontos.slice(i, i + PONTOS_POR_COMANDO);
      const r = await db.rodar(
        INSERIR_PONTOS + parte.map(() => '(?, ?, ?, ?, ?, ?, NULL)').join(', '),
        parte.flatMap((p) => [p.id, p.capturado_em, p.latitude, p.longitude, Math.round(p.precisao_m), p.velocidade_ms]),
      );
      inseridos += r.alteradas;
    }
  } catch (e) {
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) return 0;
    throw e;
  }
  return inseridos;
}
