/**
 * Apoio da filial do usuário nos testes de integração (T-0176, RN-CORE-39 revista; R-20261115-093000 e R-20261115-094500).
 *
 * A regra nova: todo usuário, em qualquer perfil, tem filial de CADASTRO (`core.usuario.filial_cadastro_id`) e ela está entre as
 * filiais de VENDA (`core.usuario_filial`, gatilho adiado `usuario_filial_inclui_cadastro`, 23514). Sem ela, as rotas do Core
 * respondem 403 `USUARIO_SEM_FILIAL`. A fixture dois-tenants da 0077 deixa de propósito admin, analista, assistente, gerente,
 * vendedor-2 e promotor de A e o admin de B SEM filial (bloqueados), e as seeds demo e Fase M não dão filial a ninguém.
 *
 * Os testes de integração que não são da T-0176 precisam de usuários DESTRAVADOS, como num tenant de verdade depois do cadastro.
 * Por isso os bancos efêmeros dos testes (`subirApi`, `subirApiDemo`) passam por `garantirFilialDosUsuarios` logo depois da carga:
 * quem está sem filial recebe a padrão do tenant como cadastro e como venda. Os testes da T-0176 travam o usuário que precisarem
 * (`deixarSemFilial`) e o destravam no fim.
 *
 * Compatível com as duas versões até o merge (main sem a 0077 e sem o contrato novo):
 * - no banco: sem a coluna `core.usuario.filial_cadastro_id`, tudo aqui é no-op;
 * - na API: `API_TEM_FILIAL_DE_USUARIO` diz se o `CriarUsuarioRequestSchema` (estrito) já aceita `filial_cadastro_id`; sem isso,
 *   `camposDeFilial` devolve `{}` (mandar o campo ao contrato antigo daria 400).
 */
import { CriarUsuarioRequestSchema } from '@macuxi/core/contracts';

/** O que os helpers usam de uma conexão do `pg` (Pool, PoolClient ou Client). */
export interface Consulta {
  query(sql: string, valores?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** O contrato do Core já tem a filial do usuário (T-0176)? Lido em tempo de execução, sem importar símbolo novo. */
export const API_TEM_FILIAL_DE_USUARIO: boolean = 'filial_cadastro_id' in (CriarUsuarioRequestSchema.shape as Record<string, unknown>);

/** O banco tem a 0077 (coluna `core.usuario.filial_cadastro_id`)? */
export async function bancoTemFilialDeUsuario(db: Consulta): Promise<boolean> {
  const r = await db.query(
    "select 1 from information_schema.columns where table_schema = 'core' and table_name = 'usuario' and column_name = 'filial_cadastro_id'",
  );
  return (r.rowCount ?? r.rows.length) > 0;
}

/** Filial padrão viva do tenant (gatilho `tenant_semear_filial` da 0056). Use a conexão de administração (sem RLS). */
export async function filialPadrao(db: Consulta, tenantId: string): Promise<string> {
  const r = await db.query('select id::text as id from core.filial where tenant_id = $1 and padrao and deleted_at is null', [tenantId]);
  const id = (r.rows[0] as { id: string } | undefined)?.id;
  if (!id) throw new Error(`tenant ${tenantId} sem filial padrão viva`);
  return id;
}

/** Filiais vivas do tenant, a padrão primeiro (id, código e `external_id`). Conexão de administração. */
export async function filiaisDoTenant(db: Consulta, tenantId: string): Promise<{ id: string; codigo: string; external_id: string | null; padrao: boolean }[]> {
  const r = await db.query(
    'select id::text as id, codigo, external_id, padrao from core.filial where tenant_id = $1 and deleted_at is null order by padrao desc, codigo, id',
    [tenantId],
  );
  return r.rows as { id: string; codigo: string; external_id: string | null; padrao: boolean }[];
}

/**
 * Dá a filial padrão do tenant (cadastro e venda) a todo usuário vivo SEM filial de cadastro. Um comando só: a linha de venda
 * entra no mesmo comando que preenche o cadastro, e o gatilho adiado confere no fim dele. No-op sem a 0077. Devolve quantos
 * usuários mudaram. Use a conexão de administração (sem RLS), logo depois da carga da fixture ou da seed.
 */
export async function garantirFilialDosUsuarios(db: Consulta, usuarioIds?: readonly string[]): Promise<number> {
  if (!(await bancoTemFilialDeUsuario(db))) return 0;
  const r = await db.query(
    `with alvo as (
       select u.tenant_id, u.id,
              (select f.id from core.filial f where f.tenant_id = u.tenant_id and f.padrao and f.deleted_at is null limit 1) as filial_id
         from core.usuario u
        where u.deleted_at is null and u.filial_cadastro_id is null and ($1::uuid[] is null or u.id = any($1::uuid[]))
     ), venda as (
       insert into core.usuario_filial (tenant_id, usuario_id, filial_id)
       select a.tenant_id, a.id, a.filial_id from alvo a
        where a.filial_id is not null
          and not exists (select 1 from core.usuario_filial uf
                           where uf.tenant_id = a.tenant_id and uf.usuario_id = a.id and uf.filial_id = a.filial_id and uf.deleted_at is null)
       returning usuario_id
     )
     update core.usuario u set filial_cadastro_id = a.filial_id
       from alvo a
      where u.id = a.id and a.filial_id is not null`,
    [usuarioIds ? [...usuarioIds] : null],
  );
  return r.rowCount ?? 0;
}

/**
 * Trava o usuário (RN-CORE-39): sem filial de cadastro e sem filiais de venda vivas, como um vendedor da carga com filial
 * inexistente ou um usuário de empresa com 2+ filiais depois da 0077. Conexão de administração.
 */
export async function deixarSemFilial(db: Consulta, usuarioId: string): Promise<void> {
  await db.query('update core.usuario set filial_cadastro_id = null where id = $1', [usuarioId]);
  await db.query('update core.usuario_filial set deleted_at = now() where usuario_id = $1 and deleted_at is null', [usuarioId]);
}

/** Filial de cadastro e filiais de venda vivas do usuário, lidas no banco (conexão de administração). */
export async function filiaisNoBanco(db: Consulta, usuarioId: string): Promise<{ cadastro: string | null; venda: string[] }> {
  const u = await db.query('select filial_cadastro_id::text as f from core.usuario where id = $1', [usuarioId]);
  const v = await db.query('select filial_id::text as f from core.usuario_filial where usuario_id = $1 and deleted_at is null order by filial_id', [usuarioId]);
  return { cadastro: (u.rows[0] as { f: string | null } | undefined)?.f ?? null, venda: (v.rows as { f: string }[]).map((x) => x.f) };
}

/**
 * Campos de filial para o `POST /v1/core/usuarios` (e o `PUT`): a padrão do tenant como cadastro e, se pedidas, mais filiais de
 * venda. Com o contrato antigo (main antes do merge), `{}`.
 */
export async function camposDeFilial(
  db: Consulta,
  tenantId: string,
  opcoes: { cadastro?: string; venda?: readonly string[] } = {},
): Promise<{ filial_cadastro_id?: string; filial_venda_ids?: string[] }> {
  if (!API_TEM_FILIAL_DE_USUARIO) return {};
  const cadastro = opcoes.cadastro ?? (await filialPadrao(db, tenantId));
  return { filial_cadastro_id: cadastro, filial_venda_ids: [...new Set([cadastro, ...(opcoes.venda ?? [])])] };
}

/** O que o destravamento usa da API de teste (`ApiDeTeste` ou `ApiDemo`). */
interface ChamadaApi {
  chamar(token: string | null, op: { method: 'GET' | 'PUT'; url: string; payload?: object }): Promise<{ statusCode: number; body: string; json(): unknown }>;
}

/**
 * O caminho do BKO para o admin que nasce sem filial (tenant criado pelo `pnpm tenant:criar`, que não passa pela
 * `sa_provisionar_tenant`): `GET /v1/core/eu/filial-cadastro` e, se `sem_filial` e `pode_informar`, `PUT` com a 1ª filial da
 * lista (a padrão vem primeiro). Devolve a filial gravada ou null se não havia o que fazer (contrato antigo ou já com filial).
 */
export async function destravarPelaRotaPropria(api: ChamadaApi, token: string): Promise<string | null> {
  if (!API_TEM_FILIAL_DE_USUARIO) return null;
  const g = await api.chamar(token, { method: 'GET', url: '/v1/core/eu/filial-cadastro' });
  if (g.statusCode !== 200) throw new Error(`GET eu/filial-cadastro: ${g.statusCode} ${g.body}`);
  const est = g.json() as { sem_filial: boolean; pode_informar: boolean; filiais: { id: string }[] };
  if (!est.sem_filial) return null;
  const filial = est.filiais[0]?.id;
  if (!est.pode_informar || !filial) throw new Error(`usuário sem filial e sem como se destravar: ${g.body}`);
  const p = await api.chamar(token, { method: 'PUT', url: '/v1/core/eu/filial-cadastro', payload: { filial_cadastro_id: filial } });
  if (p.statusCode !== 200) throw new Error(`PUT eu/filial-cadastro: ${p.statusCode} ${p.body}`);
  return filial;
}
