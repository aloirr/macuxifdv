/**
 * Papéis do banco (dono: banco-dados).
 *
 * - Migrador/dono dos objetos: o usuário admin da conexão (no Docker local, `postgres`). Ignora RLS
 *   por ser superusuário — por isso NUNCA é usado pela API nem pelos testes de vazamento.
 * - macuxi_app: papel da aplicação. LOGIN, NOSUPERUSER, NOBYPASSRLS, não é dono de tabela; todas as
 *   tabelas têm FORCE ROW LEVEL SECURITY. É o único papel com que a API conecta.
 * - macuxi_worker: despachante da outbox (ADR 0007). LOGIN, NOSUPERUSER, NOBYPASSRLS; só lê e marca
 *   plataforma.evento (todos os tenants, por política própria). Handlers de evento usam o macuxi_app.
 */
import type { ClientBase } from 'pg';
import { exigirBancoLocal, hostDoCliente, PAPEL_APP, PAPEL_WORKER, SENHA_APP_LOCAL, SENHA_WORKER_LOCAL } from './config';

/** Chave do advisory lock que serializa CREATE/ALTER ROLE (diferente da chave do migrador). */
const CHAVE_LOCK_PAPEL = 0x6d6163757870;

/** Atributos dos papéis de login da aplicação: nunca superusuário nem BYPASSRLS. */
const ATRIBUTOS = 'login nosuperuser nobypassrls nocreatedb nocreaterole noreplication';

/**
 * Cria (ou corrige) um papel de login com a senha do ambiente. Idempotente e seguro com vários processos ao
 * mesmo tempo (ex.: suítes de teste em paralelo criando bancos efêmeros): papel é objeto do cluster
 * (pg_authid), e dois ALTER ROLE simultâneos dão "tuple concurrently updated". Por isso a operação roda numa
 * transação com advisory lock (chame sempre conectado ao banco "postgres", para o lock ser o mesmo entre
 * processos).
 */
async function garantirPapel(admin: ClientBase, papel: string, senha: string): Promise<void> {
  const senhaSql = admin.escapeLiteral(senha);
  await admin.query('begin');
  try {
    await admin.query('select pg_advisory_xact_lock($1)', [CHAVE_LOCK_PAPEL]);
    // A senha vai em texto no ALTER ROLE: nesta transação nada de log de comando (log_min_duration_statement=300 do
    // servidor da demo registraria o texto se o comando demorasse). Só superusuário muda esses parâmetros; sem ele, segue.
    await admin.query(
      "select set_config('log_min_duration_statement', '-1', true), set_config('log_statement', 'none', true) where current_setting('is_superuser') = 'on'",
    );
    const existe = await admin.query('select 1 from pg_roles where rolname = $1', [papel]);
    const verbo = existe.rowCount === 0 ? 'create' : 'alter';
    await admin.query(`${verbo} role ${papel} ${ATRIBUTOS} password ${senhaSql}`);
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback').catch(() => undefined);
    throw e;
  }
}

/** Papel de aplicação macuxi_app (LOGIN, sem SUPERUSER/BYPASSRLS). */
export async function garantirPapelApp(admin: ClientBase, senha: string): Promise<void> {
  if (!senha) throw new Error('Senha do papel de aplicação vazia (MACUXI_PG_APP_SENHA).');
  // Segunda trava (a primeira é lerConfig): a senha pública local nunca vai para o papel de um banco não local.
  if (senha === SENHA_APP_LOCAL) exigirBancoLocal(hostDoCliente(admin), 'Gravar a senha pública local no papel macuxi_app');
  await garantirPapel(admin, PAPEL_APP, senha);
}

/**
 * Papel do worker da outbox macuxi_worker (ADR 0007): LOGIN, sem SUPERUSER/BYPASSRLS. Os privilégios (só
 * plataforma.evento, políticas despacho_outbox*) vêm da migração 0003_plataforma_worker.
 */
export async function garantirPapelWorker(admin: ClientBase, senha: string): Promise<void> {
  if (!senha) throw new Error('Senha do papel do worker vazia (MACUXI_PG_WORKER_SENHA).');
  if (senha === SENHA_WORKER_LOCAL) exigirBancoLocal(hostDoCliente(admin), 'Gravar a senha pública local no papel macuxi_worker');
  await garantirPapel(admin, PAPEL_WORKER, senha);
}

export interface DiagnosticoPapel {
  superusuario: boolean;
  ignoraRls: boolean;
  tabelasDeQueEDono: string[];
}

/** Usado pelos testes de conformidade (S0-028). `papel` padrão: macuxi_app. */
export async function diagnosticarPapelApp(c: ClientBase, papelAlvo: string = PAPEL_APP): Promise<DiagnosticoPapel> {
  const papel = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'select rolsuper, rolbypassrls from pg_roles where rolname = $1',
    [papelAlvo],
  );
  const linha = papel.rows[0];
  if (!linha) throw new Error(`Papel ${papelAlvo} não existe`);
  const donas = await c.query<{ tabela: string }>(
    `select n.nspname || '.' || c.relname as tabela
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and pg_get_userbyid(c.relowner) = $1`,
    [papelAlvo],
  );
  return { superusuario: linha.rolsuper, ignoraRls: linha.rolbypassrls, tabelasDeQueEDono: donas.rows.map((r) => r.tabela) };
}
