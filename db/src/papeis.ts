/**
 * Papéis do banco (dono: banco-dados).
 *
 * - Migrador/dono dos objetos: o usuário admin da conexão (no Docker local, `postgres`). Ignora RLS
 *   por ser superusuário ou, sem superusuário (DBaaS), pela política `manutencao` do papel macuxi_manutencao que ele
 *   herda (0031, garantirPapelManutencao) — por isso NUNCA é usado pela API nem pelos testes de vazamento.
 * - macuxi_app: papel da aplicação. LOGIN, NOSUPERUSER, NOBYPASSRLS, não é dono de tabela; todas as
 *   tabelas têm FORCE ROW LEVEL SECURITY. É o único papel com que a API conecta.
 * - macuxi_worker: despachante da outbox (ADR 0007). LOGIN, NOSUPERUSER, NOBYPASSRLS; só lê e marca
 *   plataforma.evento (todos os tenants, por política própria). Handlers de evento usam o macuxi_app.
 * - macuxi_portal: portal do super-admin (0038, T-0091, ADR 0029). LOGIN, NOSUPERUSER, NOBYPASSRLS, sem grant de tabela e sem
 *   filiação; o ÚNICO com EXECUTE nas plataforma.sa_*. Só o 2º pool da API conecta com ele (senha no portal.env da VM).
 * - macuxi_leitura: consulta só leitura na produção (0078, ADR 0055). LOGIN, NOSUPERUSER, NOBYPASSRLS, sem filiação; SELECT nas
 *   tabelas de tenant com a política `leitura` (só o tenant de app.tenant_id) e EXECUTE só em plataforma.tenant_por_codigo(text).
 *   A sessão nasce só leitura e com timeouts curtos (AJUSTES_LEITURA). Só o serviço pgleitura do compose conecta com ele.
 * - garantirPapelDeLogin (B0 do plano B do DBaaS, T-0075): CREATE com os atributos; papel existente só recebe LOGIN e a
 *   senha (atributos conferidos em pg_roles, nunca citados no ALTER ROLE); senha como verificador SCRAM quando o servidor
 *   usa scram-sha-256. Dicionário: docs/banco/rls.md (papéis).
 */
import type { ClientBase } from 'pg';
import {
  exigirBancoLocal,
  hostDoCliente,
  PAPEL_APP,
  PAPEL_LEITURA,
  PAPEL_PORTAL,
  PAPEL_WORKER,
  SENHA_APP_LOCAL,
  SENHA_LEITURA_LOCAL,
  SENHA_PORTAL_LOCAL,
  SENHA_WORKER_LOCAL,
} from './config';
import { senhaAceitaPeloScramLocal, verificadorScram } from './scram';

/** Chave do advisory lock que serializa CREATE/ALTER ROLE (diferente da chave do migrador). */
const CHAVE_LOCK_PAPEL = 0x6d6163757870;

/**
 * Atributos dos papéis de login da aplicação: nunca superusuário nem BYPASSRLS. Só no CREATE ROLE (papel novo): no
 * PG 16, CITAR NOSUPERUSER/NOBYPASSRLS/NOREPLICATION num ALTER ROLE exige superusuário mesmo sem mudar nada — foi o
 * "permission denied to alter role" do DBaaS (T-0075, plano B, B0). No CREATE, o admin com CREATEROLE pode.
 */
export const ATRIBUTOS_DO_PAPEL = 'login nosuperuser nobypassrls nocreatedb nocreaterole noreplication';

/** Linha de pg_roles com os atributos que o papel de login da aplicação NÃO pode ter. */
export interface AtributosPapel {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
}

const PROIBIDOS: readonly (readonly [keyof AtributosPapel, string])[] = [
  ['rolsuper', 'SUPERUSER'],
  ['rolbypassrls', 'BYPASSRLS'],
  ['rolcreatedb', 'CREATEDB'],
  ['rolcreaterole', 'CREATEROLE'],
  ['rolreplication', 'REPLICATION'],
];

/** Atributos indevidos de um papel existente, na ordem fixa SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, REPLICATION. */
export function atributosIndevidos(a: AtributosPapel): string[] {
  return PROIBIDOS.filter(([coluna]) => a[coluna]).map(([, nome]) => nome);
}

/** Configuração de senha do servidor (current_setting): password_encryption e scram_iterations (PG 16+; null antes). */
export interface CifraDoServidor {
  cifra: string | null | undefined;
  iteracoes: string | number | null | undefined;
}

/**
 * O que vai no PASSWORD do CREATE/ALTER ROLE. Com password_encryption = scram-sha-256 (padrão do PG 14+, o da demo e o
 * do CI) e senha ASCII imprimível sem espaço: o verificador SCRAM calculado aqui, com as iterações do servidor — o
 * servidor guarda o mesmo tipo de credencial que guardaria com a senha em texto, que nunca chega a ele. Senão (md5,
 * servidor sem a configuração, senha com outros caracteres, que pediriam SASLprep): a senha em texto, como antes.
 */
export function senhaDoPapel(senha: string, servidor: CifraDoServidor, sal?: Buffer): { valor: string; forma: 'scram' | 'texto' } {
  const iteracoes = Number(servidor.iteracoes ?? 4096);
  if (servidor.cifra === 'scram-sha-256' && senhaAceitaPeloScramLocal(senha) && Number.isInteger(iteracoes) && iteracoes > 0) {
    return { valor: verificadorScram(senha, sal, iteracoes), forma: 'scram' };
  }
  return { valor: senha, forma: 'texto' };
}

/**
 * Comando do papel: novo = CREATE com os atributos; existente = só LOGIN e senha (nenhum atributo citado). `senhaSql` já
 * vem como literal SQL (escapeLiteral).
 */
export function comandoDoPapel(papel: string, existente: boolean, senhaSql: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(papel)) throw new Error(`Nome de papel inválido: ${papel}`);
  return existente ? `alter role ${papel} login password ${senhaSql}` : `create role ${papel} ${ATRIBUTOS_DO_PAPEL} password ${senhaSql}`;
}

/**
 * O admin precisa de filiação com SET no papel? Só sem superusuário e no PG 16+ (pg_has_role com 'SET' e GRANT ... WITH
 * SET são do 16). CASE: o pg_has_role(..., 'SET') nem é avaliado no PG < 16.
 */
export const SQL_PRECISA_SET_ROLE =
  "select case when current_setting('is_superuser') = 'on' or current_setting('server_version_num')::int < 160000 then false " +
  "else not pg_has_role(current_user, $1, 'SET') end as precisa";

/** GRANT do papel ao próprio admin só com SET (sem INHERIT: o admin não herda as políticas do papel da aplicação). */
export function comandoSetRole(papel: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(papel)) throw new Error(`Nome de papel inválido: ${papel}`);
  return `grant ${papel} to current_user with inherit false, set true`;
}

/**
 * Papel de manutenção (0031, B1 do plano B do DBaaS, T-0075): NOLOGIN, sem BYPASSRLS; as políticas `manutencao` (for all
 * using true) valem para ele em toda tabela com RLS, e o migrador o herda (INHERIT) — assim o dono das tabelas e das
 * funções SECURITY DEFINER enxerga todos os tenants sem superusuário. macuxi_app e macuxi_worker NUNCA são membros.
 */
export const PAPEL_MANUTENCAO = 'macuxi_manutencao';

/**
 * Cria o macuxi_manutencao e a filiação do admin com INHERIT, se faltam — o mesmo que a 0031 faz, mas ANTES das
 * migrações e com advisory lock: bancos de teste migrando em paralelo (um advisory lock do migrador por banco) não
 * disputam pg_authid/pg_auth_members ("tuple concurrently updated"); a 0031 então encontra tudo pronto e não grava nada.
 * Chame conectado ao banco "postgres" (lock comum entre processos). Idempotente.
 */
export async function garantirPapelManutencao(admin: ClientBase): Promise<void> {
  await admin.query('begin');
  try {
    await admin.query('select pg_advisory_xact_lock($1)', [CHAVE_LOCK_PAPEL]);
    const existe = await admin.query('select 1 from pg_roles where rolname = $1', [PAPEL_MANUTENCAO]);
    if (existe.rowCount === 0) await admin.query(`create role ${PAPEL_MANUTENCAO} nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
    const filiado = await admin.query(
      `select 1 from pg_auth_members m
        where m.roleid = (select oid from pg_roles where rolname = $1)
          and m.member = (select oid from pg_roles where rolname = current_user)
          and m.inherit_option`,
      [PAPEL_MANUTENCAO],
    );
    if (filiado.rowCount === 0) await admin.query(`grant ${PAPEL_MANUTENCAO} to current_user with inherit true`);
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback').catch(() => undefined);
    throw e;
  }
}

export function mensagemAtributosIndevidos(papel: string, indevidos: readonly string[]): string {
  const tirar = indevidos.map((n) => `no${n.toLowerCase()}`).join(' ');
  return (
    `O papel ${papel} já existe com ${indevidos.join(', ')}: o papel de login da aplicação não pode ter esses atributos e ` +
    `este passo não muda atributo de papel existente (no PG 16 só superusuário tira). Corrija como superusuário ` +
    `(alter role ${papel} ${tirar}) ou apague o papel, e rode de novo.`
  );
}

/**
 * Cria um papel de login com a senha do ambiente, ou dá LOGIN e a senha nova ao que já existe (B0 do plano B do DBaaS):
 * o CREATE leva os atributos; o papel existente recebe só `LOGIN PASSWORD` e os atributos são CONFERIDOS em pg_roles —
 * SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE ou REPLICATION num papel existente = erro claro, nada é alterado (antes, o
 * ALTER ROLE com os atributos corrigia em silêncio, e só um superusuário podia rodá-lo). Na demo e no CI o papel nasce
 * pela migração 0001/0003 (nologin, atributos já certos) e este passo dá LOGIN e a senha, como antes.
 * Idempotente e seguro com vários processos ao mesmo tempo (ex.: suítes de teste em paralelo criando bancos efêmeros):
 * papel é objeto do cluster (pg_authid), e dois ALTER ROLE simultâneos dão "tuple concurrently updated". Por isso a
 * operação roda numa transação com advisory lock (chame sempre conectado ao banco "postgres", para o lock ser o mesmo
 * entre processos). Uso direto: só testes de banco; a aplicação chama garantirPapelApp/garantirPapelWorker.
 */
export async function garantirPapelDeLogin(admin: ClientBase, papel: string, senha: string): Promise<void> {
  if (!senha) throw new Error(`Senha do papel ${papel} vazia.`);
  await admin.query('begin');
  try {
    await admin.query('select pg_advisory_xact_lock($1)', [CHAVE_LOCK_PAPEL]);
    // Sem verificador SCRAM a senha vai em texto: nesta transação nada de log de comando (log_min_duration_statement=300
    // do servidor da demo registraria o texto se o comando demorasse). Só superusuário muda esses parâmetros; sem ele, segue.
    await admin.query(
      "select set_config('log_min_duration_statement', '-1', true), set_config('log_statement', 'none', true) where current_setting('is_superuser') = 'on'",
    );
    const atual = await admin.query<AtributosPapel>(
      'select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication from pg_roles where rolname = $1',
      [papel],
    );
    const existente = atual.rows[0];
    if (existente) {
      const indevidos = atributosIndevidos(existente);
      if (indevidos.length) throw new Error(mensagemAtributosIndevidos(papel, indevidos));
    }
    const servidor = await admin.query<CifraDoServidor>(
      "select current_setting('password_encryption', true) as cifra, current_setting('scram_iterations', true) as iteracoes",
    );
    const { valor } = senhaDoPapel(senha, servidor.rows[0] ?? { cifra: null, iteracoes: null });
    await admin.query(comandoDoPapel(papel, existente !== undefined, admin.escapeLiteral(valor)));
    // Sem superusuário (DBaaS, PG 16): quem cria o papel ganha só ADMIN OPTION (createrole_self_grant vazio) e não consegue
    // SET ROLE nele (testes e manutenção usam "set local role macuxi_app/macuxi_worker"). Filiação SÓ com SET, sem INHERIT:
    // o admin não passa a herdar as políticas do papel. Superusuário ou PG < 16: nada a fazer (a consulta devolve false).
    const set = await admin.query<{ precisa: boolean }>(SQL_PRECISA_SET_ROLE, [papel]);
    if (set.rows[0]?.precisa === true) await admin.query(comandoSetRole(papel));
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
  await garantirPapelDeLogin(admin, PAPEL_APP, senha);
}

/**
 * Papel do worker da outbox macuxi_worker (ADR 0007): LOGIN, sem SUPERUSER/BYPASSRLS. Os privilégios (só
 * plataforma.evento, políticas despacho_outbox*) vêm da migração 0003_plataforma_worker.
 */
export async function garantirPapelWorker(admin: ClientBase, senha: string): Promise<void> {
  if (!senha) throw new Error('Senha do papel do worker vazia (MACUXI_PG_WORKER_SENHA).');
  if (senha === SENHA_WORKER_LOCAL) exigirBancoLocal(hostDoCliente(admin), 'Gravar a senha pública local no papel macuxi_worker');
  await garantirPapelDeLogin(admin, PAPEL_WORKER, senha);
}

/**
 * Papel do portal do super-admin macuxi_portal (0038, T-0091, ADR 0029): LOGIN, sem SUPERUSER/BYPASSRLS, pelo B0 (CREATE com
 * os atributos; existente só LOGIN e a senha, como verificador SCRAM). Os privilégios (USAGE em plataforma e EXECUTE só nas
 * plataforma.sa_*) vêm da migração 0038; aqui nada é concedido além do SET do admin sem superusuário (garantirPapelDeLogin).
 */
export async function garantirPapelPortal(admin: ClientBase, senha: string): Promise<void> {
  if (!senha) throw new Error('Senha do papel do portal vazia (MACUXI_PG_PORTAL_SENHA).');
  if (senha === SENHA_PORTAL_LOCAL) exigirBancoLocal(hostDoCliente(admin), 'Gravar a senha pública local no papel macuxi_portal');
  await garantirPapelDeLogin(admin, PAPEL_PORTAL, senha);
}

/**
 * Papel da consulta só leitura macuxi_leitura (0078, ADR 0055): LOGIN, sem SUPERUSER/BYPASSRLS, pelo B0 (CREATE com os
 * atributos; existente só LOGIN e a senha, como verificador SCRAM). Os privilégios (USAGE, SELECT, a política leitura e o
 * EXECUTE em plataforma.tenant_por_codigo) vêm da migração 0078; os ajustes da sessão, de garantirAjustesLeitura.
 */
export async function garantirPapelLeitura(admin: ClientBase, senha: string): Promise<void> {
  if (!senha) throw new Error('Senha do papel de leitura vazia (MACUXI_PG_LEITURA_SENHA).');
  if (senha === SENHA_LEITURA_LOCAL) exigirBancoLocal(hostDoCliente(admin), 'Gravar a senha pública local no papel macuxi_leitura');
  await garantirPapelDeLogin(admin, PAPEL_LEITURA, senha);
}

/**
 * Ajustes de sessão do macuxi_leitura (ALTER ROLE ... SET, valem em todo banco do servidor): a sessão nasce só leitura e com
 * timeouts curtos. São os mesmos que a 0078 grava; a ordem e a forma (nome=valor) são as de pg_db_role_setting.setconfig.
 */
export const AJUSTES_LEITURA: readonly (readonly [string, string])[] = [
  ['default_transaction_read_only', 'on'],
  ['statement_timeout', '15s'],
  ['idle_in_transaction_session_timeout', '60s'],
];

/**
 * Coluna sensível para o macuxi_leitura (0078): nome com hash, token, senha, segredo, chave, carga ou cifrad (e tipo que não seja
 * boolean). Fica fora do SELECT por coluna (a saída da consulta vai para o log do Actions; regra 8). Expressão regular do
 * Postgres (operador ~), a mesma da 0078 e do db/scripts/conferir-rls.sql.
 */
export const COLUNA_SENSIVEL_LEITURA = '(hash|token|senha|segredo|chave|carga|cifrad)';

/**
 * Grava os AJUSTES_LEITURA que faltam no macuxi_leitura (o papel precisa existir: garantirPapelLeitura ou garantirPapelSemLogin
 * antes). Com o advisory lock dos papéis e só quando falta: bancos de teste migrando em paralelo não disputam
 * pg_db_role_setting ("tuple concurrently updated") e a 0078 encontra tudo pronto. Chame conectado ao banco "postgres".
 * Devolve os ajustes gravados agora (vazio = já estavam todos).
 */
export async function garantirAjustesLeitura(admin: ClientBase): Promise<string[]> {
  await admin.query('begin');
  try {
    await admin.query('select pg_advisory_xact_lock($1)', [CHAVE_LOCK_PAPEL]);
    const atual = await admin.query<{ ajustes: string[] | null }>(
      `select s.setconfig as ajustes from pg_db_role_setting s
        where s.setdatabase = 0 and s.setrole = (select oid from pg_roles where rolname = $1)`,
      [PAPEL_LEITURA],
    );
    const tem = new Set(atual.rows[0]?.ajustes ?? []);
    const gravados: string[] = [];
    for (const [nome, valor] of AJUSTES_LEITURA) {
      if (tem.has(`${nome}=${valor}`)) continue;
      await admin.query(`alter role ${PAPEL_LEITURA} set ${nome} = '${valor}'`);
      gravados.push(`${nome}=${valor}`);
    }
    await admin.query('commit');
    return gravados;
  } catch (e) {
    await admin.query('rollback').catch(() => undefined);
    throw e;
  }
}

/**
 * Passo de papéis do macuxi_leitura (0078, ADR 0055), no padrão do macuxi_portal (B0): com a senha (MACUXI_PG_LEITURA_SENHA),
 * LOGIN com verificador SCRAM, sem SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION e sem filiação; sem a senha, NOLOGIN.
 * Nos dois casos, os AJUSTES_LEITURA. Usado por "banco papeis", "banco migrar" (criarBanco) e pelos bancos de teste.
 */
export async function garantirLeitura(admin: ClientBase, senha: string): Promise<'login' | 'nologin'> {
  if (senha) await garantirPapelLeitura(admin, senha);
  else await garantirPapelSemLogin(admin, PAPEL_LEITURA);
  await garantirAjustesLeitura(admin);
  return senha ? 'login' : 'nologin';
}

/**
 * Cria um papel SEM LOGIN (nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication) se ele falta; existente não
 * muda, mas tem os atributos CONFERIDOS (SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE ou REPLICATION = erro claro, como no B0). O mesmo que o "create role ... if not exists" das migrações 0003/0038, mas antes delas e com o advisory lock dos papéis:
 * bancos de teste migrando em paralelo não disputam pg_authid. Usado quando a senha do papel não está configurada (o papel
 * fica NOLOGIN, como a migração o deixaria). Chame conectado ao banco "postgres". Idempotente.
 */
export async function garantirPapelSemLogin(admin: ClientBase, papel: string): Promise<'criado' | 'já existia'> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(papel)) throw new Error(`Nome de papel inválido: ${papel}`);
  await admin.query('begin');
  try {
    await admin.query('select pg_advisory_xact_lock($1)', [CHAVE_LOCK_PAPEL]);
    const atual = await admin.query<AtributosPapel>(
      'select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication from pg_roles where rolname = $1',
      [papel],
    );
    const existente = atual.rows[0];
    if (existente) {
      const indevidos = atributosIndevidos(existente);
      if (indevidos.length) throw new Error(mensagemAtributosIndevidos(papel, indevidos));
    } else {
      await admin.query(`create role ${papel} nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
    }
    await admin.query('commit');
    return existente ? 'já existia' : 'criado';
  } catch (e) {
    await admin.query('rollback').catch(() => undefined);
    throw e;
  }
}

export interface DiagnosticoPapel {
  superusuario: boolean;
  ignoraRls: boolean;
  tabelasDeQueEDono: string[];
}

/** Usado pelos testes de conformidade (S0-028). `papel` padrão: macuxi_app. */
export async function diagnosticarPapelApp(c: ClientBase, papelAlvo: string = PAPEL_APP): Promise<DiagnosticoPapel> {
  // ignorar RLS = BYPASSRLS ou ser membro (direto ou indireto, com INHERIT ou SET) do macuxi_manutencao da 0031
  const papel = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `select r.rolsuper,
            r.rolbypassrls or coalesce((select pg_has_role(r.oid, m.oid, 'MEMBER') from pg_roles m where m.rolname = $2), false) as rolbypassrls
       from pg_roles r where r.rolname = $1`,
    [papelAlvo, PAPEL_MANUTENCAO],
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
