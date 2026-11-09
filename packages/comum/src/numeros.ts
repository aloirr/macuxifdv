/**
 * Arredondamento e percentual dos indicadores (RD-0045): fonte única das 4 cópias idênticas que viviam em
 * `modules/{gestor,treinamento,promotor}/domain/numeros.ts` e `modules/pesquisa/domain/util.ts`, com o mesmo código,
 * a mesma assinatura e os mesmos padrões (nenhum resultado muda).
 *
 * Não é para dinheiro: valor monetário é inteiro em centavos e usa `toCents`/`applyPct` (`./money`).
 */

/** Arredonda meio para cima (afastando de zero) em `casas` casas decimais; nunca devolve -0. */
export function arredondar(valor: number, casas = 2): number {
  const f = 10 ** casas;
  // `+ EPSILON * f` corrige o binário de casos como 1.005 × 100 = 100.49999999999999.
  const r = (Math.sign(valor) * Math.round(Math.abs(valor) * f + Number.EPSILON * f)) / f;
  return r === 0 ? 0 : r;
}

/** `parte ÷ total × 100` arredondado; `null` quando o total é zero/inválido (sem dados). */
export function percentual(parte: number, total: number, casas = 2): number | null {
  if (!Number.isFinite(parte) || !Number.isFinite(total) || total <= 0) return null;
  return arredondar((parte / total) * 100, casas);
}
