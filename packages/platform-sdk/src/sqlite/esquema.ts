/**
 * Esquema local do aparelho (desenho T-0008 §1.2 e §1.4): tabelas da plataforma, tabela genérica por entidade de sync
 * e migrações por módulo. Especificação de dados: banco-dados (P2, `docs/banco/aparelho-sqlite.md`); código: engenheiro.
 *
 * - `kv`: tudo o que a interface base grava (`sync:*`, inclusive a fila, e `mod:<m>:*`).
 * - `ent_<entidade>`: linhas do pull (`id`, `updated_at`, `deleted_at`, `dados` JSON), criada pelo adaptador na primeira
 *   gravação e registrada em `_entidades` (para limpar entidade que nem está mais no registro).
 * - `_esquema`: versão do esquema local da plataforma (`dono = 'plataforma'`) e de cada módulo.
 * - `<modulo>__<nome>`: objetos próprios de um módulo (ex.: FTS do Catálogo), criados pelas migrações do módulo
 *   (`modules/<m>/db/aparelho.ts`, dono banco-dados) e apagados por prefixo na RN-CORE-02.
 */
import { ENTIDADE_SYNC_RE, MODULOS, type ModuloId } from '../nomes';
import type { DriverSqlite } from './driver';

/** Uma versão do esquema local (só para frente; `sql` com várias instruções). */
export interface MigracaoAparelho {
  versao: number;
  sql: string;
}

export const DONO_PLATAFORMA = 'plataforma';

/** Na abertura, antes da primeira tabela (`auto_vacuum` só vale na criação do arquivo). */
export const PRAGMAS_ABERTURA = [
  'PRAGMA auto_vacuum = INCREMENTAL',
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
  'PRAGMA foreign_keys = ON',
  // L-6: o WAL volta a no máximo 4 MB depois de um checkpoint (a carga inicial o deixava em ~9 MB)
  'PRAGMA journal_size_limit = 4194304',
].join(';\n');

/** Versões do esquema local; existe antes de qualquer migração (é onde elas se registram). */
const DDL_ESQUEMA =
  'CREATE TABLE IF NOT EXISTS _esquema (dono TEXT PRIMARY KEY, versao INTEGER NOT NULL, aplicado_em TEXT NOT NULL) WITHOUT ROWID';

export const MIGRACOES_PLATAFORMA: readonly MigracaoAparelho[] = [
  {
    versao: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS kv (chave TEXT PRIMARY KEY, valor TEXT NOT NULL) WITHOUT ROWID;
      ${DDL_ESQUEMA};
      CREATE TABLE IF NOT EXISTS _entidades (nome TEXT PRIMARY KEY, modulo TEXT NOT NULL, criada_em TEXT NOT NULL) WITHOUT ROWID;
    `,
  },
];

/** Nome da tabela da entidade (`ent_<e>`); a entidade precisa ser snake_case validado (nunca texto livre). */
export function tabelaDaEntidade(entidade: string): string {
  if (!ENTIDADE_SYNC_RE.test(entidade)) throw new Error(`Entidade de sync inválida para o SQLite: ${entidade}`);
  return `ent_${entidade}`;
}

export function ddlDaEntidade(entidade: string): string {
  const t = tabelaDaEntidade(entidade);
  return `
    CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, deleted_at TEXT, dados TEXT NOT NULL) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS ${t}__cursor ON ${t} (updated_at, id);
  `;
}

/** Prefixo dos objetos próprios de um módulo. */
export const prefixoDoModulo = (m: ModuloId) => `${m}__`;

export function validarMigracoes(dono: string, migracoes: readonly MigracaoAparelho[]): void {
  let anterior = 0;
  for (const m of migracoes) {
    if (!Number.isInteger(m.versao) || m.versao <= anterior)
      throw new Error(`Migrações locais de ${dono}: versões inteiras e crescentes (achei ${m.versao} depois de ${anterior})`);
    anterior = m.versao;
  }
}

/**
 * Aplica as versões maiores que a gravada em `_esquema`, cada uma numa transação exclusiva junto com a atualização
 * de `_esquema`. Falha = rollback daquela versão e exceção (quem chama marca o módulo como indisponível).
 * Versão gravada maior que a do app (downgrade): devolve `'downgrade'` sem aplicar nada (quem chama recria do zero).
 */
export async function aplicarMigracoes(
  driver: DriverSqlite,
  dono: string,
  migracoes: readonly MigracaoAparelho[],
  agora: () => Date,
): Promise<'ok' | 'downgrade'> {
  validarMigracoes(dono, migracoes);
  await driver.executar(DDL_ESQUEMA);
  const atual = (await driver.primeira<{ versao: number }>('SELECT versao FROM _esquema WHERE dono = ?', [dono]))?.versao ?? 0;
  const maior = migracoes.at(-1)?.versao ?? 0;
  if (atual > maior) return 'downgrade';
  for (const m of migracoes) {
    if (m.versao <= atual) continue;
    await driver.transacaoExclusiva(async (tx) => {
      await tx.executar(m.sql);
      await tx.rodar(
        'INSERT INTO _esquema (dono, versao, aplicado_em) VALUES (?, ?, ?) ON CONFLICT(dono) DO UPDATE SET versao = excluded.versao, aplicado_em = excluded.aplicado_em',
        [dono, m.versao, agora().toISOString()],
      );
    });
  }
  return 'ok';
}

interface ObjetoSqlite {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

/** Objetos criados pelo usuário (sem os internos `sqlite_*`). */
export function listarObjetos(driver: DriverSqlite): Promise<ObjetoSqlite[]> {
  return driver.todas<ObjetoSqlite>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
  );
}

/**
 * Validação de dono (desenho T-0008 §1.4; teste do SDK e dos módulos, não roda em produção): aplica as migrações do
 * módulo num banco VAZIO e devolve os problemas — todo objeto criado precisa ser `<m>__*` (inclusive as tabelas-sombra
 * da FTS) ou índice sobre `ent_<e>` de entidade do PRÓPRIO módulo.
 */
export async function verificarDonoDasMigracoes(
  driverVazio: DriverSqlite,
  modulo: ModuloId,
  migracoes: readonly MigracaoAparelho[],
  entidadesDoModulo: readonly string[],
  /** Entidades de outros módulos (as tabelas existem no aparelho; índice nelas é proibido). */
  outrasEntidades: readonly string[] = [],
): Promise<string[]> {
  if (!(MODULOS as readonly string[]).includes(modulo)) return [`módulo desconhecido: ${modulo}`];
  await driverVazio.executar(PRAGMAS_ABERTURA);
  for (const m of MIGRACOES_PLATAFORMA) await driverVazio.executar(m.sql);
  // as tabelas das entidades do módulo existem antes (o adaptador as cria), para os índices de expressão
  for (const e of [...entidadesDoModulo, ...outrasEntidades]) await driverVazio.executar(ddlDaEntidade(e));
  const antes = new Set((await listarObjetos(driverVazio)).map((o) => o.name));
  const problemas: string[] = [];
  try {
    await aplicarMigracoes(driverVazio, modulo, migracoes, () => new Date(0));
  } catch (e) {
    return [`migração falhou: ${(e as Error).message}`];
  }
  const tabelasDoModulo = new Set(entidadesDoModulo.map(tabelaDaEntidade));
  for (const o of await listarObjetos(driverVazio)) {
    if (antes.has(o.name)) continue;
    if (o.name.startsWith(prefixoDoModulo(modulo))) {
      if (o.type === 'index' && !o.tbl_name.startsWith(prefixoDoModulo(modulo)) && !tabelasDoModulo.has(o.tbl_name))
        problemas.push(`índice ${o.name} sobre ${o.tbl_name}, que não é do módulo ${modulo}`);
      continue;
    }
    problemas.push(`${o.type} ${o.name} fora do prefixo ${prefixoDoModulo(modulo)}`);
  }
  return problemas;
}
