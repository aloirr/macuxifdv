/**
 * Modo do CI que SIMULA o admin do DBaaS da Magalu (dono: banco-dados; T-0075, 3ª execução, pedido R-20261105-103215).
 *
 * No DBaaS o admin tem CREATEDB e CREATEROLE, mas não SUPERUSER nem BYPASSRLS (X1, X1.2). A suíte do @macuxi/db só via isso
 * na VM: 17 ❌ do arnês (up/down com dados antes da 0031, set role em papel descartável) apareceram só na 3ª execução.
 * Este script, rodado COMO SUPERUSUÁRIO num Postgres local e descartável (o service container de um job do CI), cria o papel
 * de login `macuxi_admin_sem_super` com os mesmos atributos do admin do DBaaS e as mesmas filiações que importam
 * (pg_read_all_data, pg_write_all_data); depois a suíte roda com ele como admin e MACUXI_PG_ADMIN_SEM_SUPER=1 (o globalSetup
 * recusa admin que ignora RLS: o modo não passa calado com superusuário). Assim a regressão aparece no CI, sem o DBaaS.
 *
 * Também apaga macuxi_app, macuxi_worker e macuxi_manutencao, se existirem: no DBaaS quem os cria é o próprio admin (ganha
 * ADMIN OPTION e, pelo B0, SET); criados por superusuário, o admin simulado não teria esses direitos (o X7 da VM faz o mesmo).
 * Se algum deles tiver dependências (base antiga), o script para com erro: use um servidor novo.
 *
 * Só no Postgres local (exigirBancoLocal): senha pública de CI, nunca em servidor compartilhado.
 *
 * Uso (CI, com MACUXI_PG_HOST/PORTA/ADMIN_* do superusuário):
 *   pnpm --filter @macuxi/db exec tsx scripts/admin-sem-superusuario.ts
 *   MACUXI_PG_ADMIN_USUARIO=macuxi_admin_sem_super MACUXI_PG_ADMIN_SENHA=macuxi_admin_sem_super_ci MACUXI_PG_ADMIN_SEM_SUPER=1 \
 *     pnpm --filter @macuxi/db test
 */
import pg from 'pg';
import { exigirBancoLocal, lerConfigTestes, urlAdmin } from '../src/config';
import { PAPEL_MANUTENCAO, senhaDoPapel, type CifraDoServidor } from '../src/papeis';

/** Papel de login que faz o papel do admin do DBaaS (CREATEDB, CREATEROLE; sem SUPERUSER, BYPASSRLS, REPLICATION). */
const ADMIN_SEM_SUPER = 'macuxi_admin_sem_super';
/** Senha pública do modo (só Postgres local do CI: exigirBancoLocal). */
const SENHA_ADMIN_SEM_SUPER = 'macuxi_admin_sem_super_ci';
/** Atributos do admin do DBaaS medidos no P3/X1 (3ª execução). */
const ATRIBUTOS_ADMIN_SEM_SUPER = 'login nosuperuser nobypassrls createdb createrole noreplication';
/** Filiações do admin do DBaaS que mudam o que ele pode fazer em tabela (o mgc_superuser é do provedor e fica de fora). */
const FILIACOES_ADMIN_SEM_SUPER = ['pg_read_all_data', 'pg_write_all_data'] as const;
/** Papéis que o admin do DBaaS cria ele mesmo (migração 0001/0003/0031 e db/src/papeis.ts). */
const PAPEIS_DO_ADMIN = ['macuxi_app', 'macuxi_worker', PAPEL_MANUTENCAO] as const;

async function principal(): Promise<void> {
  const cfg = lerConfigTestes();
  exigirBancoLocal(cfg.host, 'O modo do CI com admin sem superusuário');
  const c = new pg.Client({ connectionString: urlAdmin(cfg, 'postgres') });
  await c.connect();
  try {
    const eu = await c.query<{ s: string; v: number }>("select current_setting('is_superuser') as s, current_setting('server_version_num')::int as v");
    if (eu.rows[0]?.s !== 'on') throw new Error(`[db] rode como superusuário (MACUXI_PG_ADMIN_USUARIO=${cfg.adminUsuario} não é).`);
    if ((eu.rows[0]?.v ?? 0) < 160000) throw new Error('[db] o modo sem superusuário simula o PG 16 do DBaaS (GRANT ... WITH SET): servidor < 16.');
    if (cfg.adminUsuario === ADMIN_SEM_SUPER) throw new Error(`[db] MACUXI_PG_ADMIN_USUARIO já é ${ADMIN_SEM_SUPER}: rode este passo com o superusuário.`);

    const sobra = await c.query<{ datname: string }>("select datname from pg_database where datname like 'macuxi\\_teste\\_%' order by 1");
    if (sobra.rows.length > 0) throw new Error(`[db] há bancos de teste neste servidor (${sobra.rows.map((x) => x.datname).join(', ')}): use um servidor novo.`);
    for (const papel of PAPEIS_DO_ADMIN) {
      try {
        await c.query(`drop role if exists ${papel}`);
      } catch (e) {
        throw new Error(`[db] não consegui apagar o papel ${papel} (${(e as Error).message}): use um servidor novo.`, { cause: e });
      }
    }

    const servidor = await c.query<CifraDoServidor>(
      "select current_setting('password_encryption', true) as cifra, current_setting('scram_iterations', true) as iteracoes",
    );
    const { valor } = senhaDoPapel(SENHA_ADMIN_SEM_SUPER, servidor.rows[0] ?? { cifra: null, iteracoes: null });
    const existe = await c.query('select 1 from pg_roles where rolname = $1', [ADMIN_SEM_SUPER]);
    await c.query(
      existe.rowCount === 0
        ? `create role ${ADMIN_SEM_SUPER} ${ATRIBUTOS_ADMIN_SEM_SUPER} password ${c.escapeLiteral(valor)}`
        : `alter role ${ADMIN_SEM_SUPER} ${ATRIBUTOS_ADMIN_SEM_SUPER} password ${c.escapeLiteral(valor)}`,
    );
    for (const f of FILIACOES_ADMIN_SEM_SUPER) await c.query(`grant ${f} to ${ADMIN_SEM_SUPER}`);
    // o admin do DBaaS cria bases com CREATE DATABASE direto (C2.2) e é dono delas; no template1 nada muda

    const r = await c.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolcanlogin: boolean }>(
      'select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin from pg_roles where rolname = $1',
      [ADMIN_SEM_SUPER],
    );
    const a = r.rows[0];
    if (!a || a.rolsuper || a.rolbypassrls || !a.rolcreatedb || !a.rolcreaterole || !a.rolcanlogin) {
      throw new Error(`[db] ${ADMIN_SEM_SUPER} ficou com atributos inesperados: ${JSON.stringify(a)}`);
    }
    console.info(
      `[db] ${ADMIN_SEM_SUPER} pronto (LOGIN, CREATEDB, CREATEROLE; sem SUPERUSER/BYPASSRLS; membro de ${FILIACOES_ADMIN_SEM_SUPER.join(', ')}). ` +
        `Rode a suíte com MACUXI_PG_ADMIN_USUARIO=${ADMIN_SEM_SUPER}, a senha pública do modo (SENHA_ADMIN_SEM_SUPER) e MACUXI_PG_ADMIN_SEM_SUPER=1.`,
    );
  } finally {
    await c.end();
  }
}

principal().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
