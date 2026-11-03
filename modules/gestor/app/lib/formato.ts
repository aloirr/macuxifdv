/** Formatos de apresentação do app do Gestor (puros, pt-BR). */

/** Percentual em pt-BR com até 1 casa ("7,5%"); `null` = sem dado ("—"). */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** "1 pedido" / "2 pedidos": singular só para 1 (0 e demais usam o plural, como em "0 pedidos"). */
export function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
