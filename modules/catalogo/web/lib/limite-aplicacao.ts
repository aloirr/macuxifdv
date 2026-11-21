import { validarLimiteAplicacao } from '../../domain/parametros';

export interface EstadoLimiteAplicacao {
  /** Número lido do campo (`undefined` quando não é um número válido). */
  valor: number | undefined;
  erro: string | undefined;
  podeSalvar: boolean;
}

/**
 * RN-CAT-11: estado do painel Catálogo. `texto` é o que a pessoa digitou (`null` = não mexeu, vale o `salvo`); o ponto de milhar
 * ("1.500") é aceito. A regra da faixa é a do domain (a API revalida). Salvar só liga com valor válido e diferente do salvo.
 */
export function estadoDoLimiteAplicacao(texto: string | null, salvo: number): EstadoLimiteAplicacao {
  if (texto === null) return { valor: salvo, erro: undefined, podeSalvar: false };
  const limpo = texto.trim().replace(/\./g, '');
  const r = validarLimiteAplicacao(/^\d+$/.test(limpo) ? Number(limpo) : Number.NaN);
  if (!r.ok) return { valor: undefined, erro: r.mensagem, podeSalvar: false };
  return { valor: r.valor, erro: undefined, podeSalvar: r.valor !== salvo };
}
