/**
 * Medalhas por regra (RF-TRE-03). Cada medalha é concedida uma única vez por usuário
 * (`medalha_usuario` é único por usuário + medalha); `avaliarMedalhas` devolve só as novas.
 */

export type RegraMedalha =
  | { tipo: 'trilhas_concluidas'; quantidade: number }
  | { tipo: 'nota_maxima' }
  | { tipo: 'sequencia_dias'; dias: number };

export interface Medalha {
  codigo: string;
  nome: string;
  regra: RegraMedalha;
}

/** Catálogo padrão (decisão 31/10): primeira trilha, 100% num quiz e N dias seguidos (`streak_medalha_dias`, padrão 7). */
export function medalhasPadrao(sequenciaDias = 7): readonly Medalha[] {
  return [
    { codigo: 'primeira_trilha', nome: 'Primeira trilha concluída', regra: { tipo: 'trilhas_concluidas', quantidade: 1 } },
    { codigo: 'nota_maxima', nome: 'Nota máxima no quiz', regra: { tipo: 'nota_maxima' } },
    { codigo: `sequencia_${sequenciaDias}_dias`, nome: `${sequenciaDias} dias seguidos`, regra: { tipo: 'sequencia_dias', dias: sequenciaDias } },
  ];
}

export const MEDALHAS_PADRAO: readonly Medalha[] = Object.freeze(medalhasPadrao(7));

export interface EstadoMedalhas {
  trilhas_concluidas: number;
  /** Maior nota (%) já tirada em qualquer quiz; null se nunca fez. */
  melhor_nota_pct: number | null;
  maior_sequencia_dias: number;
}

export function medalhaConquistada(regra: RegraMedalha, estado: EstadoMedalhas): boolean {
  switch (regra.tipo) {
    case 'trilhas_concluidas':
      return estado.trilhas_concluidas >= regra.quantidade;
    case 'nota_maxima':
      return estado.melhor_nota_pct !== null && estado.melhor_nota_pct >= 100;
    case 'sequencia_dias':
      return estado.maior_sequencia_dias >= regra.dias;
  }
}

/** Medalhas do catálogo que o estado atinge e que o usuário ainda não tem (sem duplicidade). */
export function avaliarMedalhas(catalogo: readonly Medalha[], estado: EstadoMedalhas, jaConquistadas: Iterable<string>): Medalha[] {
  const tem = new Set(jaConquistadas);
  return catalogo.filter((m) => !tem.has(m.codigo) && medalhaConquistada(m.regra, estado));
}
