/** Utilitários de massa de teste (sorteador, EAN-13, gravação em lote), compartilhados pelas massas de volume e de carga. Uso: db/seeds/volume/LEIA-ME.md. */

/** Sorteador mulberry32 (32 bits): rápido, sem dependência e com a mesma sequência em qualquer motor JS. */
export function criarPrng(semente: number) {
  let s = semente >>> 0;
  const proximo = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    proximo,
    /** Inteiro em [min, max] (inclusivo). */
    inteiro: (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1)),
    escolher: <T>(lista: readonly T[]): T => lista[Math.floor(proximo() * lista.length)]!,
    chance: (p: number) => proximo() < p,
  };
}

/** EAN-13: os 12 dígitos da base mais o dígito verificador. */
export function ean13(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error(`ean13: base inválida ${base12}`);
  const soma = [...base12].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + String((10 - (soma % 10)) % 10);
}

/**
 * Grava `linhas` em `tabela` pela conexão de admin, em lotes, com `json_populate_recordset(null::<tabela>)`: o Postgres
 * converte cada coluna pelo tipo da própria tabela. `on conflict do nothing` torna a carga repetível; devolve as linhas novas.
 */
export async function gravarEmLote(
  admin: { query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }> },
  tabela: string,
  linhas: ReadonlyArray<Record<string, unknown>>,
  lote = 5_000,
): Promise<number> {
  if (linhas.length === 0) return 0;
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(tabela)) throw new Error(`tabela inválida: ${tabela}`);
  const colunas = Object.keys(linhas[0]!);
  for (const c of colunas) if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`coluna inválida: ${c}`);
  const lista = colunas.join(', ');
  const sql = `insert into ${tabela} (${lista}) select ${lista} from json_populate_recordset(null::${tabela}, $1::json) on conflict do nothing`;
  let total = 0;
  for (let i = 0; i < linhas.length; i += lote) {
    const r = await admin.query(sql, [JSON.stringify(linhas.slice(i, i + lote))]);
    total += r.rowCount ?? 0;
  }
  return total;
}
