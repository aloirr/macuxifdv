/** Gravação idempotente (upsert por id) usada por seeds e fixtures. */
import type { ClientBase } from 'pg';

export type Linha = Record<string, unknown>;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const TABELA = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/**
 * Literal de array do Postgres para coluna `text[]` (ex.: `vendedor.pedido.motivos_aprovacao`). Arrays JS viram JSON
 * em `gravarLinhas` (colunas jsonb), por isso a coluna de array recebe o literal pronto. Só códigos simples (sem
 * vírgula, aspas, chaves ou espaço).
 */
export function arrayDeTexto(itens: readonly string[]): string {
  for (const x of itens) if (!/^[a-z0-9_]+$/.test(x)) throw new Error(`arrayDeTexto: valor não suportado: ${x}`);
  return `{${itens.join(',')}}`;
}

function valor(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

/**
 * INSERT ... ON CONFLICT (id) DO UPDATE. Rodar 2× não duplica nada.
 * `preservar`: colunas que não são sobrescritas se já houver valor (ex.: senha_hash, que muda o sal a cada hash).
 */
export async function gravarLinhas(c: ClientBase, tabela: string, linhas: Linha[], opcoes: { preservar?: string[] } = {}): Promise<number> {
  if (linhas.length === 0) return 0;
  if (!TABELA.test(tabela)) throw new Error(`tabela inválida: ${tabela}`);
  const colunas = Object.keys(linhas[0]!);
  if (!colunas.includes('id')) throw new Error(`${tabela}: toda linha precisa de id`);
  for (const col of colunas) if (!IDENT.test(col)) throw new Error(`coluna inválida: ${col}`);
  const preservar = new Set(opcoes.preservar ?? []);
  const atualizar = colunas
    .filter((col) => col !== 'id' && col !== 'created_at')
    .map((col) => (preservar.has(col) ? `${col} = coalesce(${tabela}.${col}, excluded.${col})` : `${col} = excluded.${col}`));
  let total = 0;
  const LOTE = 200;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const params: unknown[] = [];
    const tuplas = lote.map((linha) => {
      const chaves = Object.keys(linha);
      if (chaves.length !== colunas.length || chaves.some((k) => !colunas.includes(k))) {
        throw new Error(`${tabela}: todas as linhas precisam das mesmas colunas (${colunas.join(', ')})`);
      }
      return `(${colunas.map((col) => `$${params.push(valor(linha[col]))}`).join(', ')})`;
    });
    const sql =
      `insert into ${tabela} (${colunas.join(', ')}) values ${tuplas.join(', ')} ` +
      (atualizar.length ? `on conflict (id) do update set ${atualizar.join(', ')}` : 'on conflict (id) do nothing');
    const r = await c.query(sql, params);
    total += r.rowCount ?? 0;
  }
  return total;
}
