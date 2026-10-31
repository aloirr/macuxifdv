/**
 * Apoio dos testes do Core: repositórios em memória (mesma interface do SQL), banco falso e contexto público.
 * Não é importado pelo código de produção.
 */
import type { AcessoBanco, ClienteBanco, ContextoPublico, LogRota } from '@macuxi/platform-sdk';
import type { FabricaRepositorios, NovaSessao, RepositorioPublico, RepositorioTenant, SessaoRefresh, UsuarioLogin } from './repositorio';
import { hashSenha } from './seguranca';

export const TENANT_A = '0a000000-0000-4000-8000-0000000000aa';
export const TENANT_B = '0a000000-0000-4000-8000-0000000000bb';
export const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';

export interface EstadoMemoria {
  tenants: Map<string, { id: string; codigo: string; nome: string; fuso: string; status: string }>;
  usuarios: Map<string, UsuarioLogin & { tenant_id: string }>;
  sessoes: Array<NovaSessao & { tenant_id: string; usado_em: Date | null; revogado_em: Date | null }>;
  dispositivos: Map<string, { usuario_id: string; bloqueado: boolean }>;
  /** Consultas ao tenant sem contexto (semTenant) — para provar que o nome só é lido depois da senha. */
  leituraDeExibicao: string[];
}

export async function estadoInicial(): Promise<EstadoMemoria> {
  const e: EstadoMemoria = { tenants: new Map(), usuarios: new Map(), sessoes: [], dispositivos: new Map(), leituraDeExibicao: [] };
  e.tenants.set('alfa', { id: TENANT_A, codigo: 'alfa', nome: 'Distribuidora Alfa', fuso: 'America/Manaus', status: 'ativo' });
  e.tenants.set('beta', { id: TENANT_B, codigo: 'beta', nome: 'Comercial Beta', fuso: 'America/Sao_Paulo', status: 'ativo' });
  const hash = await hashSenha('Teste@1234');
  const base = { nome_curto: null, senha_hash: hash, ativo: true, bloqueado_em: null, bloqueio_ate: null, tentativas_falhas: 0 };
  e.usuarios.set('u-vend', { ...base, id: '0b000000-0000-4000-8000-000000000001', tenant_id: TENANT_A, nome: 'Vera Vendedora', email: 'vendedor@exemplo.com.br', perfil: 'vendedor' });
  e.usuarios.set('u-prom', { ...base, id: '0b000000-0000-4000-8000-000000000002', tenant_id: TENANT_A, nome: 'Paulo Promotor', email: 'promotor@exemplo.com.br', perfil: 'promotor' });
  e.usuarios.set('u-beta', { ...base, id: '0b000000-0000-4000-8000-000000000003', tenant_id: TENANT_B, nome: 'Beto Beta', email: 'vendedor@exemplo.com.br', perfil: 'vendedor' });
  return e;
}

export function fabricaEmMemoria(e: EstadoMemoria): FabricaRepositorios {
  return {
    doTenant(db: ClienteBanco): RepositorioTenant {
      const tenantId = (db as unknown as { tenantId: string }).tenantId;
      const meus = () => [...e.usuarios.values()].filter((u) => u.tenant_id === tenantId);
      const sessoes = () => e.sessoes.filter((s) => s.tenant_id === tenantId);
      return {
        usuarioPorEmail: async (email) => meus().find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
        usuarioAtual: async (id) => meus().find((u) => u.id === id) ?? null,
        gravarTentativas: async (id, falhas, ate) => {
          const u = meus().find((x) => x.id === id)!;
          u.tentativas_falhas = falhas;
          u.bloqueio_ate = ate;
        },
        registrarLoginOk: async (id) => {
          const u = meus().find((x) => x.id === id)!;
          u.tentativas_falhas = 0;
          u.bloqueio_ate = null;
        },
        dispositivoBloqueado: async (usuarioId, d) => e.dispositivos.get(d)?.usuario_id === usuarioId && e.dispositivos.get(d)!.bloqueado,
        upsertDispositivo: async (usuarioId, d) => {
          if (!e.dispositivos.has(d)) e.dispositivos.set(d, { usuario_id: usuarioId, bloqueado: false });
        },
        criarSessao: async (s) => {
          e.sessoes.push({ ...s, tenant_id: tenantId, usado_em: null, revogado_em: null });
        },
        sessaoPorHash: async (hash): Promise<SessaoRefresh | null> => sessoes().find((s) => s.token_hash === hash) ?? null,
        marcarSessaoUsada: async (id, agora) => {
          sessoes().find((s) => s.id === id)!.usado_em = agora;
        },
        revogarFamilia: async (familia, agora) => {
          for (const s of sessoes()) if (s.familia_id === familia && !s.revogado_em) s.revogado_em = agora;
        },
      };
    },
    publico(): RepositorioPublico {
      return {
        tenantPorCodigo: async (codigo) => {
          const t = e.tenants.get(codigo.toLowerCase());
          return t ? { id: t.id, status: t.status } : null;
        },
        tenantParaExibicao: async (codigo) => {
          e.leituraDeExibicao.push(codigo);
          const t = e.tenants.get(codigo.toLowerCase());
          return t ? { id: t.id, codigo: t.codigo, nome: t.nome, fuso: t.fuso } : null;
        },
      };
    },
  };
}

/** Banco falso: `comTenant` entrega um "db" que só carrega o tenant (o repositório em memória lê dele). */
export function bancoDeTeste(): { banco: AcessoBanco; tenantsUsados: string[] } {
  const tenantsUsados: string[] = [];
  const banco: AcessoBanco = {
    comTenant: async (tenantId, fn) => {
      tenantsUsados.push(tenantId);
      return fn({ tenantId, query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco);
    },
    semTenant: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
  };
  return { banco, tenantsUsados };
}

export const logSilencioso: LogRota & { linhas: string[] } = {
  linhas: [],
  info(o, m) {
    this.linhas.push(JSON.stringify({ o, m }));
  },
  warn(o, m) {
    this.linhas.push(JSON.stringify({ o, m }));
  },
  error(o, m) {
    this.linhas.push(JSON.stringify({ o, m }));
  },
};

export function contextoPublico<C>(corpo: C, banco: AcessoBanco, agora: () => Date): ContextoPublico<C> {
  logSilencioso.linhas.length = 0;
  return { corpo, query: {}, params: {}, requestId: 'req-1', ip: '127.0.0.1', agora, banco, log: logSilencioso };
}
