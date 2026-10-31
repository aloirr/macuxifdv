/**
 * XP: valor por evento, teto diário, lançamentos append-only e idempotência (RN-TRE-01, RN-TRE-02, RN-TRE-04).
 *
 * O saldo é a SOMA dos lançamentos: nada é editado nem apagado. Cada lançamento tem o UUID gerado no aparelho
 * (idempotência por id) e uma chave natural (usuário + origem + referência) que impede pagar o mesmo evento
 * duas vezes vindo de aparelhos diferentes.
 */
import { localDate } from '@macuxi/comum';
import { instanteMs } from './numeros';
import { PARAMETROS_PADRAO, type ParametrosTreinamento } from './parametros';

export const ORIGENS_XP = ['licao', 'quiz', 'trilha', 'streak', 'desafio_vendas'] as const;
export type OrigemXp = (typeof ORIGENS_XP)[number];

/** Origens que não passam pelo teto diário (incentivo de vendas; têm teto próprio por desafio). */
const ORIGENS_SEM_TETO: readonly OrigemXp[] = ['desafio_vendas'];

/** Fato que merece XP, ainda sem teto aplicado. `referencia_id`: lição/quiz/trilha, data do streak ou `desafio:pedido:evento` / `desafio:pedido:total`. */
export interface CandidatoXp {
  /** UUID gerado no aparelho. */
  id: string;
  tenant_id: string;
  usuario_id: string;
  origem: OrigemXp;
  referencia_id: string;
  pontos_base: number;
  /** Instante UTC do fato (hora do aparelho). */
  ocorrido_em: string;
  /**
   * Teto próprio do desafio de vendas (RF-TRE-06): máximo de XP do usuário nesse desafio (soma dos lançamentos
   * `desafio_vendas` com referência `desafio_id:*`). Só vale para a origem `desafio_vendas`; 0/ausente = sem teto.
   */
  teto_desafio?: { desafio_id: string; max: number };
}

export interface LancamentoXp {
  id: string;
  tenant_id: string;
  usuario_id: string;
  origem: OrigemXp;
  referencia_id: string;
  /** Pontos concedidos (já com o teto diário). */
  pontos: number;
  /** Pontos antes do teto. */
  pontos_base: number;
  limitado_pelo_teto: boolean;
  ocorrido_em: string;
  /** Data civil do fato no fuso do tenant. */
  dia: string;
}

type ParamsXp = Pick<ParametrosTreinamento, 'xp_licao' | 'xp_acerto_questao' | 'xp_trilha' | 'xp_streak_por_dia' | 'xp_streak_teto'>;

/** RN-TRE-01: lição concluída [10]. */
export const xpDaLicao = (p: Pick<ParamsXp, 'xp_licao'> = PARAMETROS_PADRAO): number => p.xp_licao;
/** RN-TRE-01: trilha concluída [50]. */
export const xpDaTrilha = (p: Pick<ParamsXp, 'xp_trilha'> = PARAMETROS_PADRAO): number => p.xp_trilha;

/** RN-TRE-01/02: [5] por questão acertada, só na 1ª tentativa do quiz. */
export function xpDoQuiz(acertos: number, primeiraTentativa: boolean, p: Pick<ParamsXp, 'xp_acerto_questao'> = PARAMETROS_PADRAO): number {
  return primeiraTentativa ? acertos * p.xp_acerto_questao : 0;
}

/** RN-TRE-01: streak diário = [2] × dias consecutivos, até [20]. */
export function xpDoStreak(dias: number, p: Pick<ParamsXp, 'xp_streak_por_dia' | 'xp_streak_teto'> = PARAMETROS_PADRAO): number {
  return Math.max(0, Math.min(dias * p.xp_streak_por_dia, p.xp_streak_teto));
}

/** Chave natural do fato: o mesmo usuário não ganha duas vezes pela mesma lição/quiz/trilha/dia de streak/pedido. */
export const chaveDoEvento = (l: Pick<CandidatoXp, 'usuario_id' | 'origem' | 'referencia_id'>): string => `${l.usuario_id}|${l.origem}|${l.referencia_id}`;

export type ResultadoLancamento =
  | { resultado: 'aceito'; lancamento: LancamentoXp }
  | { resultado: 'duplicado'; motivo: 'ID' | 'EVENTO' }
  | { resultado: 'sem_pontos' };

type ParamsLancamento = Pick<ParametrosTreinamento, 'xp_teto_diario' | 'fuso'>;

/** XP do usuário no dia (data civil no fuso do tenant). */
export function xpDoDia(lancamentos: readonly LancamentoXp[], usuarioId: string, dia: string): number {
  return lancamentos.filter((l) => l.usuario_id === usuarioId && l.dia === dia).reduce((s, l) => s + l.pontos, 0);
}

/**
 * Propõe o lançamento de um fato: recusa repetição (mesmo `id` ou mesmo evento) e aplica o teto diário
 * de XP. Não altera `existentes`: quem chama grava o lançamento devolvido (append-only).
 */
export function proporLancamento(existentes: readonly LancamentoXp[], c: CandidatoXp, params: ParamsLancamento = PARAMETROS_PADRAO): ResultadoLancamento {
  if (!Number.isInteger(c.pontos_base) || c.pontos_base < 0) throw new RangeError('Os pontos do lançamento precisam ser um número inteiro maior ou igual a zero.');
  instanteMs(c.ocorrido_em);
  if (existentes.some((l) => l.id === c.id)) return { resultado: 'duplicado', motivo: 'ID' };
  const chave = chaveDoEvento(c);
  if (existentes.some((l) => chaveDoEvento(l) === chave)) return { resultado: 'duplicado', motivo: 'EVENTO' };
  if (c.pontos_base === 0) return { resultado: 'sem_pontos' };

  const dia = localDate(new Date(c.ocorrido_em), params.fuso);
  let pontos = c.pontos_base;
  if (c.origem === 'desafio_vendas' && c.teto_desafio && c.teto_desafio.max > 0) {
    const prefixo = `${c.teto_desafio.desafio_id}:`;
    const jaNoDesafio = existentes
      .filter((l) => l.usuario_id === c.usuario_id && l.origem === 'desafio_vendas' && l.referencia_id.startsWith(prefixo))
      .reduce((s, l) => s + l.pontos, 0);
    pontos = Math.max(0, Math.min(pontos, c.teto_desafio.max - jaNoDesafio));
  }
  if (params.xp_teto_diario > 0 && !ORIGENS_SEM_TETO.includes(c.origem)) {
    const jaNoDia = existentes
      .filter((l) => l.usuario_id === c.usuario_id && l.dia === dia && !ORIGENS_SEM_TETO.includes(l.origem))
      .reduce((s, l) => s + l.pontos, 0);
    pontos = Math.max(0, Math.min(c.pontos_base, params.xp_teto_diario - jaNoDia));
  }
  return {
    resultado: 'aceito',
    lancamento: {
      id: c.id,
      tenant_id: c.tenant_id,
      usuario_id: c.usuario_id,
      origem: c.origem,
      referencia_id: c.referencia_id,
      pontos,
      pontos_base: c.pontos_base,
      limitado_pelo_teto: pontos < c.pontos_base,
      ocorrido_em: c.ocorrido_em,
      dia,
    },
  };
}

export interface ResultadoLote {
  /** Lançamentos novos, na ordem em que foram aceitos. */
  lancamentos: LancamentoXp[];
  duplicados: { id: string; motivo: 'ID' | 'EVENTO' }[];
}

/**
 * RN-TRE-04: processa um lote vindo da sincronização offline pela data/hora do fato (e id, no empate),
 * para o teto diário valer para o que aconteceu primeiro. Reenviar o lote não muda nada.
 */
export function processarLote(existentes: readonly LancamentoXp[], candidatos: readonly CandidatoXp[], params: ParamsLancamento = PARAMETROS_PADRAO): ResultadoLote {
  const ordenados = [...candidatos].sort((a, b) => instanteMs(a.ocorrido_em) - instanteMs(b.ocorrido_em) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const todos = [...existentes];
  const out: ResultadoLote = { lancamentos: [], duplicados: [] };
  for (const c of ordenados) {
    const r = proporLancamento(todos, c, params);
    if (r.resultado === 'aceito') {
      todos.push(r.lancamento);
      out.lancamentos.push(r.lancamento);
    } else if (r.resultado === 'duplicado') {
      out.duplicados.push({ id: c.id, motivo: r.motivo });
    }
  }
  return out;
}

/** RN-TRE-04: saldo = soma dos lançamentos do usuário. */
export function saldoXp(lancamentos: readonly LancamentoXp[], usuarioId: string): number {
  return lancamentos.filter((l) => l.usuario_id === usuarioId).reduce((s, l) => s + l.pontos, 0);
}

/** XP do usuário entre duas datas civis (inclusive); `null` = sem limite naquela ponta. */
export function xpNoPeriodo(lancamentos: readonly LancamentoXp[], usuarioId: string, inicio: string | null, fim: string | null): number {
  return lancamentos
    .filter((l) => l.usuario_id === usuarioId && (inicio === null || l.dia >= inicio) && (fim === null || l.dia <= fim))
    .reduce((s, l) => s + l.pontos, 0);
}
