/**
 * Acesso a dados do portal (T-0093; ADR 0031; desenho docs/desenho/T-0093.md §3 e §4). Interface + implementação SQL pelas
 * funções `plataforma.sa_*` da migração 0039 (SECURITY DEFINER, EXECUTE só ao papel `macuxi_portal`; as tabelas não têm
 * política para ele: 0 linhas direto). Cada chamada é uma transação curta (`semTenant`); a atomicidade (contagem de falhas,
 * troca de empresa) é das funções. Nada daqui entra em log: e-mail, hash.
 */
import type { AcessoBanco } from '@macuxi/platform-sdk';

/** Conta achada para o e-mail (`sa_contas_para_login`): super-admin ativo ou `admin` ativo de empresa ativa. */
export interface ContaParaLogin {
  tipo: 'super_admin' | 'admin_cliente';
  /** `super_admin.id` ou `core.usuario.id` da empresa. */
  conta_id: string;
  tenant_id: string | null;
  tenant_codigo: string | null;
  tenant_nome: string | null;
  senha_hash: string;
  /** T-0094 (0040): a conta do admin ainda tem senha temporária; o hash temporário do "Esqueci" nunca chega aqui. */
  trocar_senha?: boolean;
  senha_expira_em?: Date | null;
  sessao_versao?: number;
}

export interface EstadoTentativa {
  falhas: number;
  bloqueado_ate: Date | null;
}

export interface SessaoViva {
  tipo: 'super_admin' | 'admin_cliente';
  super_admin_id: string | null;
  /** Empresa atual (admin do cliente); `null` = ainda não escolheu. */
  tenant_id: string | null;
  usuario_id: string | null;
  /** Teto da sessão (8 h). */
  expira_em: Date;
  /** RN-CORE-39 (ADR 0056): `filial_cadastro_id is null` do admin da empresa atual; lido pelo banco na própria `sa_sessao_valida`. Ausente = não informado. */
  sem_filial?: boolean;
}

export interface EmpresaDaSessao {
  id: string;
  codigo: string;
  nome: string;
}

/** Entrada de `sa_abrir_sessao_portal(p jsonb)`: super-admin OU a lista das empresas em que a senha conferiu. */
export type EntradaAbrirSessao =
  | { tipo: 'super_admin'; super_admin_id: string }
  | { tipo: 'admin_cliente'; empresas: { tenant_id: string; usuario_id: string; sessao_versao?: number }[] };

export interface LinhaAuditoriaAuth {
  super_admin_id: string | null;
  sessao_id: string | null;
  ator_tipo: 'super_admin' | 'admin_cliente' | null;
  usuario_id: string | null;
  acao: string;
  metodo: string;
  rota: string;
  status: number;
  request_id: string;
  ip_prefixo: string | null;
  /** Só contagens e códigos de motivo; nunca e-mail, senha, token ou hash. */
  detalhes?: Record<string, string | number | boolean | null>;
}

export interface RepositorioSuperAdmin {
  /** `sa_tentativa_estado(chave)`: chave sem registro = 0 falhas, sem bloqueio. */
  tentativaEstado(chave: string): Promise<EstadoTentativa>;
  /** `sa_tentativa_falha(chave)`: bloqueio vivo não conta nem estende; a 5ª falha seguida bloqueia 15 min. */
  tentativaFalha(chave: string): Promise<EstadoTentativa>;
  tentativaSucesso(chave: string): Promise<void>;
  /** Até 20 contas, admin ordenado pelo nome da empresa; grava `sa.login.consulta` (contagem, sem e-mail) pelo próprio banco. */
  contasParaLogin(email: string): Promise<ContaParaLogin[]>;
  /** Reconfere cada conta no banco; `null` se nenhuma continua qualificada. Com uma empresa só, ela já fica escolhida. */
  abrirSessao(entrada: EntradaAbrirSessao): Promise<{ sessao_id: string; expira_em: Date } | null>;
  /** Só `admin_cliente`, só tenant da lista da sessão, reconferindo admin ativo e empresa ativa; `null` = recusado. */
  escolherEmpresa(sid: string, tenantId: string): Promise<{ tenant_id: string; usuario_id: string; codigo: string; nome: string } | null>;
  /** `null`: inexistente, revogada, vencida, ou (admin do cliente) deixou de ser admin ativo / a empresa saiu de ativo. */
  sessaoValida(sid: string): Promise<SessaoViva | null>;
  /** Super-admin: todas as empresas; admin do cliente: só as da sessão. */
  listarEmpresas(sid: string): Promise<EmpresaDaSessao[]>;
  revogarSessao(sid: string): Promise<void>;
  auditar(linha: LinhaAuditoriaAuth): Promise<void>;
}

export type FabricaSuperAdmin = (banco: AcessoBanco) => RepositorioSuperAdmin;

const dt = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));

export const fabricaSuperAdminSql: FabricaSuperAdmin = (banco) => {
  const um = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> =>
    banco.semTenant(async (db) => (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0]?.r);
  /** Funções que devolvem `table (...)`. */
  const linhasDe = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    banco.semTenant(async (db) => (await db.query<T & Record<string, unknown>>(`select * from ${sql}`, params)).rows as T[]);
  const estado = (r: { falhas?: unknown; bloqueado_ate?: unknown } | undefined): EstadoTentativa => ({ falhas: Number(r?.falhas ?? 0), bloqueado_ate: dt(r?.bloqueado_ate) });
  return {
    async tentativaEstado(chave) {
      return estado((await linhasDe<{ falhas: number; bloqueado_ate: string | null }>('plataforma.sa_tentativa_estado($1)', [chave]))[0]);
    },
    async tentativaFalha(chave) {
      return estado((await linhasDe<{ falhas: number; bloqueado_ate: string | null }>('plataforma.sa_tentativa_falha($1)', [chave]))[0]);
    },
    async tentativaSucesso(chave) {
      await um('plataforma.sa_tentativa_sucesso($1)', [chave]);
    },
    async contasParaLogin(email) {
      const linhas = await linhasDe<Record<string, unknown>>('plataforma.sa_contas_para_login($1)', [email]);
      return linhas.map((r) => ({
        tipo: r.tipo === 'super_admin' ? 'super_admin' : 'admin_cliente',
        conta_id: String(r.conta_id),
        tenant_id: r.tenant_id ? String(r.tenant_id) : null,
        tenant_codigo: r.tenant_codigo ? String(r.tenant_codigo) : null,
        tenant_nome: r.tenant_nome ? String(r.tenant_nome) : null,
        senha_hash: String(r.senha_hash),
        trocar_senha: r.trocar_senha === true,
        senha_expira_em: dt(r.senha_expira_em),
        sessao_versao: Number(r.sessao_versao ?? 0),
      }));
    },
    async abrirSessao(entrada) {
      const r = (await linhasDe<{ sessao_id: string; expira_em: string }>('plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(entrada)]))[0];
      return r ? { sessao_id: r.sessao_id, expira_em: new Date(r.expira_em) } : null;
    },
    async escolherEmpresa(sid, tenantId) {
      const r = (await linhasDe<{ tenant_id: string; usuario_id: string; codigo: string; nome: string }>('plataforma.sa_escolher_empresa($1, $2)', [sid, tenantId]))[0];
      return r ? { tenant_id: r.tenant_id, usuario_id: r.usuario_id, codigo: r.codigo, nome: r.nome } : null;
    },
    async sessaoValida(sid) {
      const r = (await linhasDe<Record<string, unknown>>('plataforma.sa_sessao_valida($1)', [sid]))[0];
      return r
        ? {
            tipo: r.tipo === 'super_admin' ? 'super_admin' : 'admin_cliente',
            super_admin_id: r.super_admin_id ? String(r.super_admin_id) : null,
            tenant_id: r.tenant_id ? String(r.tenant_id) : null,
            usuario_id: r.usuario_id ? String(r.usuario_id) : null,
            expira_em: new Date(r.expira_em as string),
            sem_filial: r.sem_filial === true,
          }
        : null;
    },
    async listarEmpresas(sid) {
      const r = await um<{ itens?: { id: string; codigo: string; razao_social: string }[] }>('plataforma.sa_listar_tenants($1)', [sid]);
      // a função devolve ListaEmpresasSchema: o nome da empresa é `razao_social` (R-20261107-165858)
      return (r?.itens ?? []).map((e) => ({ id: e.id, codigo: e.codigo, nome: e.razao_social }));
    },
    async revogarSessao(sid) {
      await um('plataforma.sa_revogar($1)', [sid]);
    },
    async auditar(l) {
      await um('plataforma.sa_auditar($1::jsonb)', [JSON.stringify({ ...l, tenant_id: null })]);
    },
  };
};
