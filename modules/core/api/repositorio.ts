/**
 * Acesso a dados da autenticação do Core. Interface + implementação SQL (Postgres, dentro de `comTenant`: RLS).
 * Tabelas: `core.usuario` (+ `tentativas_falhas`, `bloqueio_ate`), `core.sessao` e `core.dispositivo`
 * (migração pedida ao banco-dados no recado da T-0003 Fase 2). Os testes do Core usam a implementação em memória
 * (`teste/memoria.ts`); este SQL é conferido com o banco quando a migração existir.
 * Nada daqui entra em log (e-mail e hash são dado pessoal/segredo).
 */
import { ErroHttpModulo, type AcessoBanco, type ClienteBanco, type Perfil } from '@macuxi/platform-sdk';

/** Aparelho que pertence a outro tenant/usuário (FK 23503, unicidade 23505, RLS 42501): erro de cliente, não 500. */
const CODIGOS_APARELHO_INVALIDO = new Set(['23503', '23505', '42501']);
const aparelhoInvalido = (): ErroHttpModulo => new ErroHttpModulo(403, 'DISPOSITIVO_INVALIDO', 'Este aparelho não pode ser usado com este acesso. Fale com o administrador da sua empresa.');
async function comAparelho(consulta: Promise<unknown>): Promise<void> {
  try {
    await consulta;
  } catch (e) {
    if (CODIGOS_APARELHO_INVALIDO.has(String((e as { code?: unknown } | null)?.code))) throw aparelhoInvalido();
    throw e;
  }
}

export interface UsuarioLogin {
  id: string;
  nome: string;
  nome_curto: string | null;
  email: string;
  perfil: Perfil;
  senha_hash: string | null;
  ativo: boolean;
  bloqueado_em: Date | null;
  bloqueio_ate: Date | null;
  tentativas_falhas: number;
}

export interface UsuarioAtual {
  id: string;
  perfil: Perfil;
  ativo: boolean;
  bloqueado_em: Date | null;
}

export interface SessaoRefresh {
  id: string;
  usuario_id: string;
  familia_id: string;
  dispositivo_id: string | null;
  expira_em: Date;
  usado_em: Date | null;
  revogado_em: Date | null;
}

export interface NovaSessao {
  id: string;
  usuario_id: string;
  familia_id: string;
  token_hash: string;
  dispositivo_id: string | null;
  expira_em: Date;
}

export interface TenantLogin {
  id: string;
  status: string;
}

export interface TenantExibicao {
  id: string;
  codigo: string;
  nome: string;
  fuso: string;
}

/** Operações dentro da transação do tenant. */
export interface RepositorioTenant {
  usuarioPorEmail(email: string): Promise<UsuarioLogin | null>;
  usuarioAtual(id: string): Promise<UsuarioAtual | null>;
  gravarTentativas(usuarioId: string, falhas: number, bloqueioAte: Date | null): Promise<void>;
  registrarLoginOk(usuarioId: string, agora: Date): Promise<void>;
  /** `bloqueado` = aparelho bloqueado remotamente (RF-CORE-01). */
  /** RN-CORE-15: o bloqueio vale para o tenant inteiro (o RLS isola o tenant) — qualquer usuário no aparelho bloqueado é recusado. */
  dispositivoBloqueado(dispositivoId: string): Promise<boolean>;
  upsertDispositivo(usuarioId: string, dispositivoId: string, nome: string | null, agora: Date): Promise<void>;
  criarSessao(s: NovaSessao): Promise<void>;
  sessaoPorHash(hash: string): Promise<SessaoRefresh | null>;
  marcarSessaoUsada(id: string, agora: Date): Promise<void>;
  revogarFamilia(familiaId: string, agora: Date): Promise<void>;
}

/** Operações fora de tenant (só funções SECURITY DEFINER). */
export interface RepositorioPublico {
  tenantPorCodigo(codigo: string): Promise<TenantLogin | null>;
  tenantParaExibicao(codigo: string): Promise<TenantExibicao | null>;
}

const data = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export function repositorioTenantSql(db: ClienteBanco): RepositorioTenant {
  return {
    async usuarioPorEmail(email) {
      const r = await db.query<Record<string, unknown>>(
        `select id, nome, nome_curto, email, perfil, senha_hash, ativo, bloqueado_em, bloqueio_ate, tentativas_falhas
           from core.usuario
          where lower(email) = lower($1) and deleted_at is null`,
        [email],
      );
      const l = r.rows[0];
      if (!l) return null;
      return {
        id: String(l.id),
        nome: String(l.nome),
        nome_curto: (l.nome_curto as string | null) ?? null,
        email: String(l.email),
        perfil: l.perfil as Perfil,
        senha_hash: (l.senha_hash as string | null) ?? null,
        ativo: Boolean(l.ativo),
        bloqueado_em: data(l.bloqueado_em),
        bloqueio_ate: data(l.bloqueio_ate),
        tentativas_falhas: Number(l.tentativas_falhas ?? 0),
      };
    },
    async usuarioAtual(id) {
      const r = await db.query<Record<string, unknown>>('select id, perfil, ativo, bloqueado_em from core.usuario where id = $1 and deleted_at is null', [id]);
      const l = r.rows[0];
      return l ? { id: String(l.id), perfil: l.perfil as Perfil, ativo: Boolean(l.ativo), bloqueado_em: data(l.bloqueado_em) } : null;
    },
    async gravarTentativas(usuarioId, falhas, bloqueioAte) {
      await db.query('update core.usuario set tentativas_falhas = $2, bloqueio_ate = $3 where id = $1', [usuarioId, falhas, bloqueioAte]);
    },
    async registrarLoginOk(usuarioId, agora) {
      await db.query('update core.usuario set tentativas_falhas = 0, bloqueio_ate = null, ultimo_login_em = $2 where id = $1', [usuarioId, agora]);
    },
    async dispositivoBloqueado(dispositivoId) {
      const r = await db.query('select 1 from core.dispositivo where id = $1 and bloqueado_em is not null and deleted_at is null', [dispositivoId]);
      return r.rows.length > 0;
    },
    async upsertDispositivo(usuarioId, dispositivoId, nome, agora) {
      await comAparelho(db.query(
        `insert into core.dispositivo (id, tenant_id, usuario_id, nome, ultimo_acesso_em)
         values ($1, plataforma.tenant_atual(), $2, $3, $4)
         on conflict (id) do update set ultimo_acesso_em = excluded.ultimo_acesso_em, nome = coalesce(excluded.nome, core.dispositivo.nome),
           push_token = case when core.dispositivo.usuario_id = excluded.usuario_id then core.dispositivo.push_token end,
           push_plataforma = case when core.dispositivo.usuario_id = excluded.usuario_id then core.dispositivo.push_plataforma end,
           usuario_id = excluded.usuario_id
         where core.dispositivo.bloqueado_em is null`,
        [dispositivoId, usuarioId, nome, agora],
      ));
    },
    async criarSessao(s) {
      await comAparelho(db.query(
        `insert into core.sessao (id, tenant_id, usuario_id, familia_id, token_hash, dispositivo_id, expira_em)
         values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6)`,
        [s.id, s.usuario_id, s.familia_id, s.token_hash, s.dispositivo_id, s.expira_em],
      ));
    },
    async sessaoPorHash(hash) {
      const r = await db.query<Record<string, unknown>>(
        'select id, usuario_id, familia_id, dispositivo_id, expira_em, usado_em, revogado_em from core.sessao where token_hash = $1 and deleted_at is null',
        [hash],
      );
      const l = r.rows[0];
      if (!l) return null;
      return {
        id: String(l.id),
        usuario_id: String(l.usuario_id),
        familia_id: String(l.familia_id),
        dispositivo_id: (l.dispositivo_id as string | null) ?? null,
        expira_em: data(l.expira_em) as Date,
        usado_em: data(l.usado_em),
        revogado_em: data(l.revogado_em),
      };
    },
    async marcarSessaoUsada(id, agora) {
      await db.query('update core.sessao set usado_em = $2 where id = $1', [id, agora]);
    },
    async revogarFamilia(familiaId, agora) {
      await db.query('update core.sessao set revogado_em = $2 where familia_id = $1 and revogado_em is null', [familiaId, agora]);
    },
  };
}

export function repositorioPublicoSql(banco: AcessoBanco): RepositorioPublico {
  return {
    async tenantPorCodigo(codigo) {
      // só id e status: nome e fuso do tenant NÃO são lidos antes de a senha ser validada
      const r = await banco.semTenant((db) => db.query<{ id: string; status: string }>('select id, status from plataforma.tenant_por_codigo($1)', [codigo]));
      return r.rows[0] ?? null;
    },
    async tenantParaExibicao(codigo) {
      const r = await banco.semTenant((db) => db.query<{ id: string; nome: string; fuso: string }>('select id, nome, fuso from plataforma.tenant_por_codigo($1)', [codigo]));
      const l = r.rows[0];
      return l ? { id: l.id, codigo, nome: l.nome, fuso: l.fuso } : null;
    },
  };
}

/** Fábricas injetáveis: nos testes entram versões em memória. */
export interface FabricaRepositorios {
  doTenant(db: ClienteBanco): RepositorioTenant;
  publico(banco: AcessoBanco): RepositorioPublico;
}

export const fabricaSql: FabricaRepositorios = { doTenant: repositorioTenantSql, publico: repositorioPublicoSql };
