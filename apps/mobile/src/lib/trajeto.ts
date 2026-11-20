/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): regras puras da tarefa `macuxi-trajeto`, sem nada
 * nativo (o lado do aparelho fica em `services/trajeto.ts`). A condição de negócio é o `podeRastrear` do Core (§3.2), o
 * mesmo da API; aqui só o que o shell faz com ela: ler do aparelho a `EntradaRastreio`, montar o ponto, filtrar o lote,
 * ligar ou desligar. Nenhuma coordenada sai daqui para log, erro, Diagnóstico ou telemetria (§9).
 *
 * Do contrato do Core (`@macuxi/core/contracts`): `podeRastrear` e `PontoTrajeto` (validado pelo `PontoTrajetoSchema`).
 */
import {
  ENTIDADE_AUSENCIA_USUARIO,
  PARAMETRO_FERIADOS,
  PARAMETRO_RASTREAMENTO,
  PARAMETROS_RASTREAMENTO_PADRAO,
  ParametrosRastreamentoSchema,
  podeRastrear,
  PontoTrajetoSchema,
  type EntradaRastreio,
  type FrequenciaRastreamento,
  type ParametrosRastreamento,
  type PontoTrajeto,
  type ResultadoRastreio,
} from '@macuxi/core/contracts';
import type { ArmazenamentoSync, DriverSqlite } from '@macuxi/platform-sdk';

import { semDerrubar } from './trava-sync';
import type { Variante } from './variante-tipo';

export const TAREFA_TRAJETO = 'macuxi-trajeto';

/** Resultado do portão `podeRastrear` do Core (§3.2), com o motivo do contrato. */
export type CondicaoTrajeto = ResultadoRastreio;

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

/** O que da captura depende da frequência do parâmetro (§3.1): distância e intervalos, em metros e milissegundos. */
export interface IntervalosDaCaptura {
  distanceInterval: number;
  timeInterval: number;
  deferredUpdatesInterval: number;
}

/** Parâmetros do `startLocationUpdatesAsync` (§3.1). */
export type OpcoesDoTrajeto = IntervalosDaCaptura & {
  accuracy: 4;
  foregroundService: { notificationTitle: string; notificationBody: string; killServiceOnDestroy: boolean };
};

const MINUTO_MS = 60_000;

const TITULO_DA_NOTIFICACAO: Readonly<Record<Variante, string>> = { campo: 'Macuxi Campo ativo', gestao: 'Macuxi Gestão ativo' };

/**
 * Opções da captura pela frequência do parâmetro `rastreamento` do BKO (§3.1 e §3.3: sobe sem build novo). `accuracy: 4` é o
 * `Accuracy.High` do expo-location (`Location.types`), em número para este arquivo não importar o módulo nativo.
 * Notificação fixa: o Android exige uma para o serviço em primeiro plano. O rastreamento é interno (dono do produto, 19/11):
 * só o título do app ("Macuxi Campo ativo" ou, T-0187 P7 A, "Macuxi Gestão ativo"), sem ação e sem citar localização, no
 * canal `macuxi-servico` ("Serviço do app", IMPORTANCE_LOW, sem som) do `plugins/notificacao-trajeto.ts`.
 */
export function opcoesDoTrajeto(
  frequencia: FrequenciaRastreamento = PARAMETROS_RASTREAMENTO_PADRAO.frequencia,
  app: Variante = 'campo',
): OpcoesDoTrajeto {
  return {
    accuracy: 4,
    distanceInterval: frequencia.distancia_m,
    timeInterval: frequencia.intervalo_min * MINUTO_MS,
    deferredUpdatesInterval: frequencia.lote_min * MINUTO_MS,
    foregroundService: {
      notificationTitle: TITULO_DA_NOTIFICACAO[app],
      // obrigatório no tipo do expo-location; vazio, o `setContentText("")` do LocationTaskService.kt deixa só o título
      notificationBody: '',
      killServiceOnDestroy: false,
    },
  };
}

/** A captura em curso usa estes intervalos? Sem o que comparar (`null`), não: a próxima atualização reinicia. */
export function mesmosIntervalos(a: IntervalosDaCaptura, b: Partial<IntervalosDaCaptura> | null): boolean {
  return !!b && a.distanceInterval === b.distanceInterval && a.timeInterval === b.timeInterval && a.deferredUpdatesInterval === b.deferredUpdatesInterval;
}

/** Linha do pull `parametro` (`ParametroSync` do Core), só o que a leitura usa. */
type LinhaDeParametro = Readonly<{ modulo?: unknown; chave?: unknown; valor?: unknown; deleted_at?: unknown }>;

/**
 * Parâmetro `rastreamento` do Core nas linhas do pull `parametro`. Ausente, removido ou fora do `ParametrosRastreamentoSchema`:
 * o padrão de fábrica do contrato (desligado).
 */
function parametrosDasLinhas(linhas: readonly LinhaDeParametro[]): ParametrosRastreamento {
  const valor = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_RASTREAMENTO && !l.deleted_at)?.valor;
  const p = ParametrosRastreamentoSchema.safeParse(valor);
  return p.success ? p.data : PARAMETROS_RASTREAMENTO_PADRAO;
}

/** Frequência do parâmetro `rastreamento`; sem ele, a do padrão de fábrica do contrato. */
export function frequenciaDasLinhas(linhas: readonly LinhaDeParametro[]): FrequenciaRastreamento {
  return parametrosDasLinhas(linhas).frequencia;
}

/** Entidade de pull dos parâmetros do tenant (o `motor.linhas('parametro')` do Core). */
const ENTIDADE_PARAMETRO = 'parametro';

/**
 * Lê a frequência no banco do usuário sem motor: pelas linhas (`ent_parametro` no SQLite) ou, sem elas, pela chave `ent:parametro`
 * (mapa id → linha), como o `motor.linhas` do SDK.
 */
export async function lerFrequenciaDoTrajeto(base: ArmazenamentoSync): Promise<FrequenciaRastreamento> {
  return frequenciaDasLinhas(await linhasDaEntidade(base, ENTIDADE_PARAMETRO));
}

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

export type AcaoDoTrajeto = 'ligar' | 'desligar' | 'reiniciar' | 'manter';

/**
 * Liga só se pode e ainda não está ativa; desliga se está ativa e não pode mais; reinicia se pode, está ativa e a frequência do
 * parâmetro mudou; senão mantém (§3.2).
 */
export function acaoDoTrajeto(condicao: CondicaoTrajeto, ativa: boolean, frequenciaMudou = false): AcaoDoTrajeto {
  if (condicao.pode) return !ativa ? 'ligar' : frequenciaMudou ? 'reiniciar' : 'manter';
  return ativa ? 'desligar' : 'manter';
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
 * O que o `podeRastrear` do Core pede, menos o instante (§2 e §3.2), lido do aparelho uma vez por atualização ou lote: o
 * parâmetro `rastreamento`, o cargo (perfil base da sessão), o app (variante atual), os feriados do tenant, as ausências do
 * próprio usuário, a permissão "o tempo todo" e o fuso do tenant.
 */
export interface ContextoDoRastreio {
  parametros: Pick<ParametrosRastreamento, 'ativo' | 'expediente'>;
  cargo: string;
  app: string;
  feriados: readonly string[];
  ausencias: ReadonlyArray<{ de: string; ate: string }>;
  /** Só `true` com a permissão lida e concedida; sem leitura, `false` (nunca "não conferida"). */
  permissao: boolean;
  fuso: string;
}

/** A `EntradaRastreio` do Core para o instante. */
export function entradaDoRastreio(c: ContextoDoRastreio, instanteMs: number): EntradaRastreio {
  return {
    ativo: c.parametros.ativo,
    cargo: c.cargo,
    app: c.app,
    expediente: c.parametros.expediente,
    feriados: c.feriados,
    ausencias: c.ausencias,
    permissao: c.permissao,
    instante: new Date(instanteMs).toISOString(),
    fuso: c.fuso,
  };
}

/** RN-CORE-13: o `podeRastrear` do Core, o mesmo da API, decide cargo, app e permissão; com instante inválido, desligado. */
export function portaoDoTrajeto(c: ContextoDoRastreio, instanteMs: number): CondicaoTrajeto {
  if (!Number.isFinite(instanteMs)) return DESLIGADO;
  return podeRastrear(entradaDoRastreio(c, instanteMs));
}

/**
 * PONTO ÚNICO da condição do §2 no shell (RN-CORE-13): cada instante passa pelo `podeRastrear` com o contexto lido uma vez.
 * Sem contexto (sem sessão, sem banco ou leitura com erro), "desligado" em qualquer instante: nunca liga de fábrica.
 */
export async function condicaoDoTrajeto(
  lerContexto: () => Promise<ContextoDoRastreio | null> = () => Promise.resolve(null),
): Promise<(instanteMs: number) => CondicaoTrajeto> {
  const contexto = await lerContexto().catch(() => null);
  if (!contexto) return () => DESLIGADO;
  return (instanteMs) => portaoDoTrajeto(contexto, instanteMs);
}

/** O que a sessão guardada e o aparelho dizem do usuário (`services/trajeto.ts`). */
export interface SessaoDoRastreio {
  usuarioId: string;
  cargo: string | null;
  app: string;
  fuso: string;
  permissao: boolean;
}

type Linha = Readonly<Record<string, unknown>>;
const ehData = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const viva = (l: Linha): boolean => !l.deleted_at;

/** Linhas guardadas de uma entidade do pull, como o `motor.linhas` do SDK: pela extensão `linhas` (SQLite) ou pela chave `ent:<e>`. */
async function linhasDaEntidade(base: ArmazenamentoSync, entidade: string): Promise<Linha[]> {
  if (base.linhas) return (await base.linhas.listar(entidade)) as unknown as Linha[];
  return Object.values((await base.ler<Record<string, Linha>>(`ent:${entidade}`)) ?? {});
}

/** Feriados do tenant no pull `parametro` (`metas.feriados` do Core): só datas AAAA-MM-DD; os nacionais o portão acrescenta. */
export function feriadosDasLinhas(linhas: readonly LinhaDeParametro[]): string[] {
  const f = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_FERIADOS && !l.deleted_at)?.valor;
  return Array.isArray(f) ? f.filter(ehData) : [];
}

/** Ausências do próprio usuário no pull `ausencia_usuario` (datas civis no fuso do tenant). */
export function ausenciasDasLinhas(linhas: readonly Linha[], usuarioId: string): Array<{ de: string; ate: string }> {
  return linhas.filter((a) => viva(a) && a.usuario_id === usuarioId && ehData(a.de) && ehData(a.ate)).map((a) => ({ de: a.de as string, ate: a.ate as string }));
}

/**
 * Lê o contexto do portão no banco do usuário, sem motor: os pulls `parametro` e `ausencia_usuario`. Sem cargo, cargo vazio
 * (o Core recusa).
 */
export async function lerContextoDoRastreio(base: ArmazenamentoSync, s: SessaoDoRastreio): Promise<ContextoDoRastreio> {
  const [parametro, ausencias] = await Promise.all([linhasDaEntidade(base, ENTIDADE_PARAMETRO), linhasDaEntidade(base, ENTIDADE_AUSENCIA_USUARIO)]);
  const { ativo, expediente } = parametrosDasLinhas(parametro);
  return {
    parametros: { ativo, expediente },
    cargo: s.cargo ?? '',
    app: s.app,
    feriados: feriadosDasLinhas(parametro),
    ausencias: ausenciasDasLinhas(ausencias, s.usuarioId),
    permissao: s.permissao,
    fuso: s.fuso,
  };
}

/** A captura do aparelho (`expo-location`, `services/trajeto.ts`). */
export interface CapturaDoAparelho {
  ativa(): Promise<boolean>;
  ligar(opcoes: OpcoesDoTrajeto): Promise<void>;
  parar(): Promise<void>;
  /** Intervalos com que a captura em curso foi ligada; `null` se não sabe (a próxima atualização reinicia). */
  intervalosEmUso(): Promise<Partial<IntervalosDaCaptura> | null>;
}

export interface DepsDoTrajeto {
  /** `null` = build sem os módulos nativos (tudo vira nada). */
  captura: CapturaDoAparelho | null;
  condicao(): Promise<(instanteMs: number) => CondicaoTrajeto>;
  /** Frequência do parâmetro `rastreamento` (`lerFrequenciaDoTrajeto`); o padrão do contrato quando falta. */
  frequencia(): Promise<FrequenciaRastreamento>;
  gravar(pontos: PontoTrajeto[]): Promise<void>;
  novoId(): string;
  agora(): number;
  /** Recebe o erro já sem coordenada (`erroSemCoordenada`). */
  registrarErro(e: Error): void;
  /** Variante do app (título da notificação fixa); sem ela, o Campo. */
  app?: Variante;
}

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
          // a frequência só importa se a captura vai ficar ligada
          const opcoes = agora.pode ? opcoesDoTrajeto(await d.frequencia(), d.app) : null;
          const mudou = !!opcoes && ativa && !mesmosIntervalos(opcoes, await c.intervalosEmUso());
          const acao = acaoDoTrajeto(agora, ativa, mudou);
          if (acao === 'desligar' || acao === 'reiniciar') await c.parar();
          if ((acao === 'ligar' || acao === 'reiniciar') && opcoes) await c.ligar(opcoes);
          return acao;
        },
        registrar,
        null,
      );
    },
    async parar(): Promise<void> {
      const c = d.captura;
      if (!c) return;
      await semDerrubar(() => pararSeAtiva(c), registrar, undefined);
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
            if (pontos.length > 0) await d.gravar(pontos);
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
