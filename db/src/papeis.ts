/**
 * Papéis do banco (dono: banco-dados).
 *
 * - Migrador/dono dos objetos: o usuário admin da conexão (no Docker local, `postgres`). Ignora RLS
 *   por ser superusuário — por isso NUNCA é usado pela API nem pelos testes de vazamento.
 * - macuxi_app: papel da aplicação. LOGIN, NOSUPERUSER, NOBYPASSRLS, não é dono de tabela; todas as
 *   tabelas têm FORCE ROW LEVEL SECURITY. É o único papel com que a API conecta.
 */
import type { ClientBase } from 'pg';
import { PAPEL_APP } from './config';

/** Cria (ou corrige) o papel de aplicação com LOGIN e a senha do ambiente. Idempotente. */
export async function garantirPapelApp(admin: ClientBase, senha: string): Promise<void> {
  if (!senha) throw new Error('Senha do papel de aplicação vazia (MACUXI_PG_APP_SENHA).');
  const existe = await admin.query('select 1 from pg_roles where rolname = $1', [PAPEL_APP]);
  const atributos = 'login nosuperuser nobypassrls nocreatedb nocreaterole noreplication';
  const senhaSql = admin.escapeLiteral(senha);
  if (existe.rowCount === 0) {
    await admin.query(`create role ${PAPEL_APP} ${atributos} password ${senhaSql}`);
  } else {
    await admin.query(`alter role ${PAPEL_APP} ${atributos} password ${senhaSql}`);
  }
}

export interface DiagnosticoPapel {
  superusuario: boolean;
  ignoraRls: boolean;
  tabelasDeQueEDono: string[];
}

/** Usado pelos testes de conformidade (S0-028). */
export async function diagnosticarPapelApp(c: ClientBase): Promise<DiagnosticoPapel> {
  const papel = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'select rolsuper, rolbypassrls from pg_roles where rolname = $1',
    [PAPEL_APP],
  );
  const linha = papel.rows[0];
  if (!linha) throw new Error(`Papel ${PAPEL_APP} não existe`);
  const donas = await c.query<{ tabela: string }>(
    `select n.nspname || '.' || c.relname as tabela
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and pg_get_userbyid(c.relowner) = $1`,
    [PAPEL_APP],
  );
  return { superusuario: linha.rolsuper, ignoraRls: linha.rolbypassrls, tabelasDeQueEDono: donas.rows.map((r) => r.tabela) };
}
