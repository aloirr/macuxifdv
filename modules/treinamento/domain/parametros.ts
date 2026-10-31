/**
 * Parâmetros do tenant do Treinamento (doc 03 §7 e tabela de parâmetros). Os valores entre colchetes das
 * RN-TRE entram como padrão; os marcados "premissa T-0011" não existem no doc e estão em docs/modulos/treinamento/regras.md.
 */

export type NotaQueVale = 'melhor' | 'ultima';

export interface ParametrosTreinamento {
  /** RN-TRE-02: nota mínima (%) para aprovar o quiz ([70]). */
  nota_minima_pct: number;
  /** RN-TRE-02: tentativas de quiz por dia ([3]). */
  tentativas_max_dia: number;
  /** Premissa T-0011: intervalo mínimo, em minutos, entre tentativas do mesmo quiz (0 = sem intervalo). */
  intervalo_min_tentativas_min: number;
  /** Premissa T-0011: qual nota vale nos relatórios — a melhor ou a última tentativa. */
  nota_que_vale: NotaQueVale;
  /** RN-TRE-04: tempo mínimo, em segundos, na lição para a conclusão contar ([30]). */
  tempo_min_licao_seg: number;
  /** RN-TRE-01: XP por lição concluída ([10]). */
  xp_licao: number;
  /** RN-TRE-01: XP por questão acertada na 1ª tentativa do quiz ([5]). */
  xp_acerto_questao: number;
  /** RN-TRE-01: XP por trilha concluída ([50]). */
  xp_trilha: number;
  /** RN-TRE-01: XP do streak = por dia × dias consecutivos ([2]). */
  xp_streak_por_dia: number;
  /** RN-TRE-01: teto do XP de streak num dia ([20]). */
  xp_streak_teto: number;
  /** Premissa T-0011: teto de XP por dia (dia no fuso do tenant); 0 = sem teto. */
  xp_teto_diario: number;
  /** Premissa T-0011: XP mínimo de cada nível; o 1º é sempre 0 e a lista é estritamente crescente. */
  niveis_xp_min: readonly number[];
  /** Premissa T-0011: dias consecutivos para a medalha de sequência. */
  streak_medalha_dias: number;
  /** Premissa T-0011: perfis que entram no ranking. */
  perfis_ranking: readonly string[];
  /** Doc 03, tabela de parâmetros: fuso horário do tenant (define o "dia"). */
  fuso: string;
}

export const FAIXAS_NIVEL_PADRAO: readonly number[] = Object.freeze([0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200]);

export const PARAMETROS_PADRAO: Readonly<ParametrosTreinamento> = Object.freeze({
  nota_minima_pct: 70,
  tentativas_max_dia: 3,
  intervalo_min_tentativas_min: 0,
  nota_que_vale: 'melhor',
  tempo_min_licao_seg: 30,
  xp_licao: 10,
  xp_acerto_questao: 5,
  xp_trilha: 50,
  xp_streak_por_dia: 2,
  xp_streak_teto: 20,
  xp_teto_diario: 200,
  niveis_xp_min: FAIXAS_NIVEL_PADRAO,
  streak_medalha_dias: 7,
  perfis_ranking: Object.freeze(['vendedor', 'promotor']),
  fuso: 'America/Manaus',
});

const NUMERICOS_NAO_NEGATIVOS = [
  'intervalo_min_tentativas_min',
  'tempo_min_licao_seg',
  'xp_licao',
  'xp_acerto_questao',
  'xp_trilha',
  'xp_streak_por_dia',
  'xp_streak_teto',
  'xp_teto_diario',
] as const;

/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos (mensagens em português). */
export function resolverParametros(parcial: Partial<ParametrosTreinamento> = {}): ParametrosTreinamento {
  const p: ParametrosTreinamento = { ...PARAMETROS_PADRAO, ...parcial };
  for (const k of NUMERICOS_NAO_NEGATIVOS) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new RangeError(`Parâmetro ${k} inválido: informe um número inteiro maior ou igual a zero.`);
  }
  if (typeof p.nota_minima_pct !== 'number' || !Number.isFinite(p.nota_minima_pct) || p.nota_minima_pct < 0 || p.nota_minima_pct > 100) {
    throw new RangeError('Parâmetro nota_minima_pct inválido: informe um valor entre 0 e 100.');
  }
  if (!Number.isInteger(p.tentativas_max_dia) || p.tentativas_max_dia < 1) {
    throw new RangeError('Parâmetro tentativas_max_dia inválido: informe pelo menos 1 tentativa por dia.');
  }
  if (!Number.isInteger(p.streak_medalha_dias) || p.streak_medalha_dias < 1) {
    throw new RangeError('Parâmetro streak_medalha_dias inválido: informe pelo menos 1 dia.');
  }
  if (p.nota_que_vale !== 'melhor' && p.nota_que_vale !== 'ultima') {
    throw new RangeError('Parâmetro nota_que_vale inválido: use "melhor" ou "ultima".');
  }
  validarFaixasDeNivel(p.niveis_xp_min);
  if (p.perfis_ranking.length === 0) throw new RangeError('Parâmetro perfis_ranking inválido: informe ao menos um perfil.');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: p.fuso });
  } catch {
    throw new RangeError(`Fuso horário inválido: ${p.fuso}.`);
  }
  return p;
}

/** As faixas começam em 0 e crescem estritamente (nível n exige mais XP que o n−1). */
export function validarFaixasDeNivel(faixas: readonly number[]): void {
  if (faixas.length === 0 || faixas[0] !== 0) throw new RangeError('As faixas de nível precisam começar em 0 XP.');
  for (let i = 1; i < faixas.length; i++) {
    const f = faixas[i]!;
    if (!Number.isInteger(f) || f <= faixas[i - 1]!) throw new RangeError('As faixas de nível precisam ser inteiros crescentes.');
  }
}
