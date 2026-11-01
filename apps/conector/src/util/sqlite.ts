/**
 * Carrega `node:sqlite` (experimental no Node 22) sem o aviso "ExperimentalWarning: SQLite is an experimental feature".
 *
 * - SÓ PARA NODE 22: o Conector roda no Node 22+ instalado no cliente (`scripts/empacotar.mjs` mira `node22`), onde o aviso ainda
 *   é emitido. No Node 24 (engines da raiz, usado em dev/CI) o `node:sqlite` não emite mais o aviso e esta troca é inofensiva
 *   (nunca dispara). Remover quando o Node 22 deixar de ser suportado pelo Conector.
 * - A troca de `process.emitWarning` é global, mas dura apenas o `require` (síncrono) e é desfeita no `finally`.
 * - O Vite/Vitest 3 não conhece `node:sqlite` como módulo embutido; por isso o carregamento é por `createRequire`,
 *   que passa direto ao Node e funciona igual no executável, no tsx e no Vitest.
 * - Só o aviso do SQLite é suprimido (durante o carregamento); qualquer outro aviso continua aparecendo.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

export type BancoSqlite = DatabaseSync;
type ModuloSqlite = typeof import('node:sqlite');

let modulo: ModuloSqlite | null = null;

export function carregarSqlite(): ModuloSqlite {
  if (modulo) return modulo;
  const emitir = process.emitWarning.bind(process) as (...a: unknown[]) => void;
  process.emitWarning = ((aviso: unknown, ...resto: unknown[]) => {
    const texto = typeof aviso === 'string' ? aviso : (aviso as Error | undefined)?.message ?? '';
    if (/sqlite/i.test(texto)) return;
    emitir(aviso, ...resto);
  }) as typeof process.emitWarning;
  try {
    modulo = createRequire(import.meta.url)('node:sqlite') as ModuloSqlite;
  } finally {
    process.emitWarning = emitir as typeof process.emitWarning;
  }
  return modulo;
}

export function abrirSqlite(caminho: string): BancoSqlite {
  const { DatabaseSync: Banco } = carregarSqlite();
  const db = new Banco(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  return db;
}
