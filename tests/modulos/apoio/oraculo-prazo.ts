/** Oráculo do % do prazo para os ensaios valor × regra, escrito sem o domain do Vendedor. */

/** RN-VEN-43: tabela ajustada = meia-para-cima(tabela × (10 000 + bp) ÷ 10 000), por unidade. */
export const regra = (tabela: number, bp: number): number => Math.floor((tabela * (10_000 + bp) + 5_000) / 10_000);

/** RN-VEN-02 (v2): desconto % no unitário, meia para cima ao centavo. */
export const comDesconto = (unit: number, pct: number): number => Math.floor((unit * (10_000 - Math.round(pct * 100)) + 5_000) / 10_000);
