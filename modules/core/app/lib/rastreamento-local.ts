/**
 * Rastreamento no Campo (T-0156; desenho `tracking.md` §4.3 e §6; spec `docs/design/tracking/spec.md`). RN-CORE-13, RN-CORE-46.
 * Funções puras e testadas: situação do termo, estado da seção Localização do Perfil (ativa, pausada, fora do expediente, sem expediente),
 * pausa pessoal e o resumo do dia de "Meu trajeto". A decisão de gravar ponto é o `podeRastrear` do domain, o mesmo da API e da tarefa
 * `macuxi-trajeto`. Sem coordenada em texto de tela, log ou erro (§9).
 */
import { formatHHMM, localIsoDate, zonedParts } from '@macuxi/comum/fuso';
import type { AceiteTermoRastreamentoSync, AusenciaUsuario, Expediente, ParametrosRastreamento, PontoDoTrajeto, TermoRastreamento } from '../../contracts';
import { formatarDistancia, ROTULO_ESTADO_RASTREAMENTO, TRAJETO_DIAS_MAX, type PausaDoDia } from '../../contracts';
import { CARGOS_RASTREADOS, PAUSA_MAX_MIN, podeRastrear } from '../../domain/rastreamento';
import { metrosDoTrajeto } from '../../domain/performance/trajeto';

/** Chaves do armazenamento do módulo no aparelho (`motor.armazenamentoDoModulo('core')`): a tarefa `macuxi-trajeto` lê as mesmas. */
export const CHAVE_ACEITE_LOCAL = 'rastreamento.aceite';
export const CHAVE_PAUSA_LOCAL = 'rastreamento.pausa';

export interface AceiteLocal {
  id: string;
  versao: number;
  aceito_em: string;
}
export interface PausaLocal {
  id: string;
  inicio: string;
}
export interface PausaFechada {
  id: string;
  inicio: string;
  fim: string;
}

export interface EntradaLocalizacao {
  parametros: ParametrosRastreamento;
  termos: readonly TermoRastreamento[];
  /** Aceite gravado neste aparelho (vale na hora, offline). */
  aceiteLocal: AceiteLocal | null;
  /** Aceites que voltaram no pull (só os do próprio usuário). */
  aceitesServidor: readonly AceiteTermoRastreamentoSync[];
  usuarioId: string;
  cargo: string;
  ausencias: readonly AusenciaUsuario[];
  feriados: readonly string[];
  pausa: PausaLocal | null;
  /** Instante avaliado (UTC, ISO). */
  agora: string;
  fuso: string;
}

/** Maior versão que não foi removida. */
export function termoVigenteDe(termos: readonly TermoRastreamento[]): TermoRastreamento | null {
  return termos.filter((t) => !t.deleted_at).reduce<TermoRastreamento | null>((v, t) => (v === null || t.versao > v.versao ? t : v), null);
}

/** O aceite da versão vigente: o do aparelho ou, sem ele, o que voltou do servidor. */
export function aceiteDaVersao(e: Pick<EntradaLocalizacao, 'aceiteLocal' | 'aceitesServidor' | 'usuarioId'>, versao: number): { versao: number; aceito_em: string } | null {
  if (e.aceiteLocal && e.aceiteLocal.versao === versao) return { versao, aceito_em: e.aceiteLocal.aceito_em };
  const s = e.aceitesServidor.find((a) => a.usuario_id === e.usuarioId && a.termo_versao === versao && !a.deleted_at);
  return s ? { versao, aceito_em: s.aceito_em } : null;
}

export type SituacaoTermo = 'desligado' | 'sem_termo' | 'pendente' | 'aceito';

/**
 * RN-CORE-13: o termo só entra em cena para usuário de campo com o rastreamento ligado e termo publicado; `pendente` = abre a tela do
 * termo a cada abertura do app até o "Li e estou ciente" (o app segue usável sem ele).
 */
export function situacaoDoTermo(e: EntradaLocalizacao): SituacaoTermo {
  if (!e.parametros.ativo || !CARGOS_RASTREADOS.includes(e.cargo)) return 'desligado';
  const vigente = termoVigenteDe(e.termos);
  if (!vigente) return 'sem_termo';
  return aceiteDaVersao(e, vigente.versao) ? 'aceito' : 'pendente';
}

const dd = (n: number) => String(n).padStart(2, '0');
const textoDoMinuto = (min: number) => `${dd(Math.floor(min / 60))}:${dd(min % 60)}`;
const diaDaSemana = (iso: string, fuso: string): keyof Expediente => String(new Date(`${localIsoDate(iso, fuso)}T12:00:00Z`).getUTCDay()) as keyof Expediente;

/** Faixas do expediente do dia de `instante` (no fuso do tenant). */
export function faixasDoDia(expediente: Expediente, instante: string, fuso: string): Array<{ inicio_min: number; fim_min: number }> {
  return expediente[diaDaSemana(instante, fuso)];
}
const rotuloFaixas = (faixas: ReadonlyArray<{ inicio_min: number; fim_min: number }>): string | null =>
  faixas.length === 0 ? null : `Hoje ${faixas.map((f) => `${textoDoMinuto(f.inicio_min)}–${textoDoMinuto(f.fim_min)}`).join(' e ')}`;

export type EstadoLocalizacao =
  | { estado: 'oculta' }
  | { estado: 'ativa' | 'pausada' | 'fora' | 'sem_expediente'; apoio: string | null; acao: 'pausar' | 'retomar' | null };

/** Minutos que faltam para a pausa terminar: o menor entre o prazo dela e o fim da faixa de agora. */
function faltaDaPausa(e: EntradaLocalizacao, pausa: PausaLocal): number {
  const agora = Date.parse(e.agora);
  const porPrazo = Date.parse(pausa.inicio) + PAUSA_MAX_MIN * 60_000 - agora;
  const p = zonedParts(e.agora, e.fuso);
  const minuto = p.hour * 60 + p.minute;
  const faixa = faixasDoDia(e.parametros.expediente, e.agora, e.fuso).find((f) => f.inicio_min <= minuto && minuto < f.fim_min);
  const porExpediente = faixa ? (faixa.fim_min - minuto) * 60_000 : porPrazo;
  return Math.min(porPrazo, porExpediente);
}

/** Estado da seção Localização do Perfil (spec §2). `oculta` = sem aceite da versão vigente, desligado ou sem termo. */
export function estadoDaLocalizacao(e: EntradaLocalizacao): EstadoLocalizacao {
  if (situacaoDoTermo(e) !== 'aceito') return { estado: 'oculta' };
  const vigente = termoVigenteDe(e.termos)!;
  const aceite = aceiteDaVersao(e, vigente.versao)!;
  const faixas = faixasDoDia(e.parametros.expediente, e.agora, e.fuso);
  const apoio = rotuloFaixas(faixas);
  // a permissão "o tempo todo" não muda a seção (o app já a pede na abertura, RN-CORE-37)
  const r = podeRastrear({
    ativo: e.parametros.ativo,
    termoVigente: vigente.versao,
    cargo: e.cargo,
    app: 'campo',
    aceite,
    expediente: e.parametros.expediente,
    feriados: e.feriados,
    ausencias: e.ausencias.filter((a) => a.usuario_id === e.usuarioId && !a.deleted_at).map((a) => ({ de: a.de, ate: a.ate })),
    pausas: e.pausa ? [{ inicio: e.pausa.inicio, fim: null }] : [],
    instante: e.agora,
    fuso: e.fuso,
  });
  if (r.pode) return { estado: 'ativa', apoio, acao: 'pausar' };
  switch (r.motivo) {
    case 'pausa': {
      const min = Math.ceil(faltaDaPausa(e, e.pausa!) / 60_000);
      return { estado: 'pausada', apoio: min < 1 || faltaDaPausa(e, e.pausa!) < 60_000 ? 'Volta em menos de 1 min' : `Volta em ${min} min`, acao: 'retomar' };
    }
    case 'fora_do_expediente':
      return faixas.length > 0 ? { estado: 'fora', apoio, acao: null } : { estado: 'sem_expediente', apoio: null, acao: null };
    case 'feriado':
    case 'ausencia':
      return { estado: 'sem_expediente', apoio: null, acao: null };
    default:
      return { estado: 'oculta' };
  }
}

/** Pausa que passou do prazo vira registro fechado no prazo (nunca fica em curso para sempre); `null` = ainda vale. */
export function pausaVencida(p: PausaLocal, agora: string): PausaFechada | null {
  const fim = Date.parse(p.inicio) + PAUSA_MAX_MIN * 60_000;
  return fim <= Date.parse(agora) ? { id: p.id, inicio: p.inicio, fim: new Date(fim).toISOString() } : null;
}

// ---- Meu trajeto ----
const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const partes = (d: string) => d.split('-').map(Number) as [number, number, number];
const utc = (d: string) => Date.UTC(...(([y, m, dia]) => [y, m - 1, dia] as [number, number, number])(partes(d)));
const curto = (d: string) => `${SEMANA_CURTA[new Date(utc(d)).getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function rotuloDoDia(data: string, hoje: string): string {
  if (data === hoje) return `Hoje · ${curto(data)}`;
  if (data === deslocarDia(hoje, -1)) return `Ontem · ${curto(data)}`;
  return curto(data);
}

export function deslocarDia(data: string, dias: number): string {
  return new Date(utc(data) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** `‹` fica desabilitado no dia mais antigo guardado (TRAJETO_DIAS_MAX dias atrás). */
export const diaAnteriorPermitido = (data: string, hoje: string): boolean => deslocarDia(data, -1) >= deslocarDia(hoje, -TRAJETO_DIAS_MAX);

export interface LinhaDoResumo {
  tipo: 'inicio' | 'pausa' | 'fim';
  rotulo: string;
  hora: string;
}

/** Resumo do dia (spec §3): km pelo `metrosDoTrajeto` e as linhas Início, Pausa e Último ponto (hoje) ou Fim. Horas no fuso do tenant. */
export function resumoDoDia(o: { pontos: readonly PontoDoTrajeto[]; pausas: readonly PausaDoDia[]; hoje: boolean; agora: string; fuso: string }): { titulo: string; hoje: boolean; km: string; linhas: LinhaDoResumo[] } {
  const ordenados = [...o.pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const km = formatarDistancia(metrosDoTrajeto(ordenados).metros);
  const linhas: LinhaDoResumo[] = [];
  if (ordenados.length > 0) linhas.push({ tipo: 'inicio', rotulo: 'Início', hora: formatHHMM(ordenados[0]!.capturado_em, o.fuso) });
  for (const p of o.pausas) linhas.push({ tipo: 'pausa', rotulo: 'Pausa', hora: `${formatHHMM(p.inicio, o.fuso)}–${p.fim ? formatHHMM(p.fim, o.fuso) : 'agora'}` });
  if (ordenados.length > 1) linhas.push({ tipo: 'fim', rotulo: o.hoje ? 'Último ponto' : 'Fim', hora: formatHHMM(ordenados.at(-1)!.capturado_em, o.fuso) });
  return { titulo: o.hoje ? 'Até agora' : 'Distância', hoje: o.hoje, km, linhas };
}

/** Texto do estado: o chip do Perfil e a leitura falada usam o mesmo (rótulos dos contracts). */
export const ROTULO_DO_ESTADO: Readonly<Record<'ativa' | 'pausada' | 'fora' | 'sem_expediente', string>> = {
  ativa: ROTULO_ESTADO_RASTREAMENTO.ativa,
  pausada: ROTULO_ESTADO_RASTREAMENTO.pausa,
  fora: ROTULO_ESTADO_RASTREAMENTO.fora_do_expediente,
  sem_expediente: 'Sem expediente hoje',
};

const horaFalada = (h: string, m: string) => `${Number(h)}${m === '00' ? '' : `:${m}`}`;

/** Leitura da linha de estado para o leitor de tela (spec §2): "Localização, ativa, hoje das 8 às 18". */
export function leituraDaLocalizacao(e: Exclude<EstadoLocalizacao, { estado: 'oculta' }>): string {
  const rotulo = ROTULO_DO_ESTADO[e.estado].toLowerCase();
  const apoio = e.apoio
    ?.replace(/(\d\d):(\d\d)–(\d\d):(\d\d)/g, (_m, h1: string, m1: string, h2: string, m2: string) => `das ${horaFalada(h1, m1)} às ${horaFalada(h2, m2)}`)
    .replace(/^Hoje/, 'hoje')
    .replace(/^Volta/, 'volta');
  return ['Localização', rotulo, apoio].filter(Boolean).join(', ');
}
