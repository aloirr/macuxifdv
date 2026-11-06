/**
 * Acesso a dados do super-admin de plataforma (T-0087; ADR 0029; desenho §6). Interface + implementação SQL pelas funções
 * `plataforma.sa_*` da migração 0035 (SECURITY DEFINER; as tabelas não têm política para `macuxi_app`: 0 linhas direto).
 * Cada chamada é uma transação curta (`semTenant`); a atomicidade (passo do TOTP, uso único do código e do desafio) é das funções.
 * Nada daqui entra em log: e-mail, hash, segredo cifrado.
 */
import type { AcessoBanco } from '@macuxi/platform-sdk';

export interface SuperAdminLinha {
  id: string;
  nome: string;
  email: string;
  senha_hash: string;
  ativo: boolean;
  bloqueado_ate: Date | null;
  falhas: number;
  totp_confirmado: boolean;
}

export interface TotpEstado {
  segredo_cifrado: string | null;
  pendente_cifrado: string | null;
  ultimo_passo: number;
  recuperacao_restantes: number;
}

export type EtapaDesafio = 'segundo_fator' | 'cadastrar_totp';

export interface LinhaAuditoriaAuth {
  super_admin_id: string | null;
  sessao_id: string | null;
  acao: string;
  metodo: string;
  rota: string;
  status: number;
  request_id: string;
  ip_prefixo: string | null;
  /** Só contagens e códigos de motivo; nunca e-mail, senha, código ou segredo. */
  detalhes?: Record<string, string | number | boolean | null>;
}

export interface RepositorioSuperAdmin {
  existe(): Promise<boolean>;
  /** Cria o primeiro super-admin; `null` se já existe algum (a trava é do banco). */
  criarPrimeiro(email: string, nome: string, senhaHash: string): Promise<string | null>;
  paraLogin(email: string): Promise<SuperAdminLinha | null>;
  porId(id: string): Promise<SuperAdminLinha | null>;
  registrarFalha(id: string): Promise<{ falhas: number; bloqueado_ate: Date | null }>;
  registrarSucesso(id: string): Promise<void>;
  totpEstado(id: string): Promise<TotpEstado>;
  gravarTotpPendente(id: string, cifrado: string): Promise<void>;
  /** Move o pendente para o definitivo, grava o passo e os hashes dos códigos de recuperação. Falso: nada pendente ou já confirmado. */
  confirmarTotp(id: string, passo: number, hashes: readonly string[]): Promise<boolean>;
  /** Atômico: só avança o passo. Falso = reuso do código. */
  marcarPasso(id: string, passo: number): Promise<boolean>;
  /** Uso único: remove o hash e devolve os restantes; `null` se o hash não existia. */
  usarRecuperacao(id: string, hash: string): Promise<number | null>;
  regerarRecuperacao(id: string, hashes: readonly string[]): Promise<void>;
  /** A etapa (cadastrar_totp ou segundo_fator) e os 5 min são do banco; os desafios anteriores do mesmo super-admin deixam de valer. `null`: inativo ou bloqueado. */
  abrirDesafio(id: string, hashDoDesafio: string): Promise<{ etapa: EtapaDesafio; expira_em: Date } | null>;
  /** Não consome. `null`: inexistente, usado, expirado ou super-admin inativo/bloqueado. */
  lerDesafio(hashDoDesafio: string): Promise<{ super_admin_id: string; etapa: EtapaDesafio } | null>;
  /** CONSOME o desafio (uso único) e abre a sessão com teto de 8 h; `null` se o desafio não vale ou o TOTP não está confirmado. */
  abrirSessao(hashDoDesafio: string): Promise<{ sessao_id: string; super_admin_id: string; expira_em: Date } | null>;
  sessaoValida(sid: string): Promise<{ super_admin_id: string; expira_em: Date } | null>;
  revogarSessao(sid: string): Promise<void>;
  auditar(linha: LinhaAuditoriaAuth): Promise<void>;
}

export type FabricaSuperAdmin = (banco: AcessoBanco) => RepositorioSuperAdmin;

const dt = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));

export const fabricaSuperAdminSql: FabricaSuperAdmin = (banco) => {
  const um = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> =>
    banco.semTenant(async (db) => (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0]?.r);
  /** Funções que devolvem `table (...)`: a primeira linha, ou nada. */
  const linhaDe = async <T>(sql: string, params: unknown[] = []): Promise<T | null> =>
    banco.semTenant(async (db) => ((await db.query<T & Record<string, unknown>>(`select * from ${sql}`, params)).rows[0] as T | undefined) ?? null);
  const linha = (r: Record<string, unknown> | null | undefined): SuperAdminLinha | null =>
    r
      ? {
          id: String(r.id),
          nome: String(r.nome),
          email: String(r.email),
          senha_hash: String(r.senha_hash),
          ativo: r.ativo === true,
          bloqueado_ate: dt(r.bloqueado_ate),
          falhas: Number(r.falhas ?? 0),
          totp_confirmado: r.totp_confirmado_em !== null && r.totp_confirmado_em !== undefined,
        }
      : null;
  return {
    existe: async () => (await um<boolean>('plataforma.sa_existe()')) === true,
    criarPrimeiro: async (email, nome, senhaHash) => (await um<string | null>('plataforma.sa_criar_primeiro($1, $2, $3)', [email, nome, senhaHash])) ?? null,
    paraLogin: async (email) => linha(await linhaDe<Record<string, unknown>>('plataforma.sa_para_login($1)', [email])),
    porId: async (id) => linha(await linhaDe<Record<string, unknown>>('plataforma.sa_por_id($1)', [id])),
    async registrarFalha(id) {
      const r = await linhaDe<{ falhas: number; bloqueado_ate: string | null }>('plataforma.sa_registrar_falha($1)', [id]);
      return { falhas: Number(r?.falhas ?? 0), bloqueado_ate: dt(r?.bloqueado_ate) };
    },
    async registrarSucesso(id) {
      await um('plataforma.sa_registrar_sucesso($1)', [id]);
    },
    async totpEstado(id) {
      const r = await linhaDe<Record<string, unknown>>('plataforma.sa_por_id($1)', [id]);
      return {
        segredo_cifrado: (r?.totp_segredo_cifrado as string | null | undefined) ?? null,
        pendente_cifrado: (r?.totp_pendente_cifrado as string | null | undefined) ?? null,
        ultimo_passo: Number(r?.totp_ultimo_passo ?? 0),
        recuperacao_restantes: Number(r?.recuperacao_restantes ?? 0),
      };
    },
    async gravarTotpPendente(id, cifrado) {
      await um('plataforma.sa_gravar_totp_pendente($1, $2)', [id, cifrado]);
    },
    confirmarTotp: async (id, passo, hashes) => (await um<boolean>('plataforma.sa_confirmar_totp($1, $2, $3::text[])', [id, passo, [...hashes]])) === true,
    marcarPasso: async (id, passo) => (await um<boolean>('plataforma.sa_marcar_passo($1, $2)', [id, passo])) === true,
    usarRecuperacao: async (id, hash) => {
      const r = await um<number | null>('plataforma.sa_usar_recuperacao($1, $2)', [id, hash]);
      return r === null || r === undefined ? null : Number(r);
    },
    async regerarRecuperacao(id, hashes) {
      await um('plataforma.sa_regerar_recuperacao($1, $2::text[])', [id, [...hashes]]);
    },
    async abrirDesafio(id, hash) {
      const r = await linhaDe<{ etapa: EtapaDesafio; expira_em: string }>('plataforma.sa_abrir_desafio($1, $2)', [id, hash]);
      return r ? { etapa: r.etapa, expira_em: new Date(r.expira_em) } : null;
    },
    async lerDesafio(hash) {
      const r = await linhaDe<{ super_admin_id: string; etapa: EtapaDesafio }>('plataforma.sa_ver_desafio($1)', [hash]);
      return r ? { super_admin_id: r.super_admin_id, etapa: r.etapa } : null;
    },
    async abrirSessao(hash) {
      const r = await linhaDe<{ sessao_id: string; super_admin_id: string; expira_em: string }>('plataforma.sa_abrir_sessao($1)', [hash]);
      return r ? { sessao_id: r.sessao_id, super_admin_id: r.super_admin_id, expira_em: new Date(r.expira_em) } : null;
    },
    async sessaoValida(sid) {
      const r = await linhaDe<{ super_admin_id: string; expira_em: string }>('plataforma.sa_sessao_valida($1)', [sid]);
      return r ? { super_admin_id: r.super_admin_id, expira_em: new Date(r.expira_em) } : null;
    },
    async revogarSessao(sid) {
      await um('plataforma.sa_revogar($1)', [sid]);
    },
    async auditar(l) {
      await um('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ ...l, tenant_id: null })]);
    },
  };
};
