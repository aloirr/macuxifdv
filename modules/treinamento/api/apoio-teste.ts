/**
 * Apoio dos testes da API do Treinamento (não é importado pelo código de produção): contexto de rota com relógio de
 * teste, transação falsa que registra eventos e auditoria, e `chamar`, que reproduz a ordem do `createApp` para uma rota
 * do módulo — licença (RN-CORE-02) → perfil pela ação do manifesto (ADR 0004, `verificarAcao` do SDK, o mesmo da API)
 * → validação Zod (400) → `executar` (erros do módulo viram `{ status, codigo }`).
 */
import type { RelogioDeTeste } from '@macuxi/comum/relogio';
import {
  criarPermissoes,
  ErroHttpModulo,
  verificarAcao,
  type ClienteBanco,
  type ContextoBase,
  type ContextoRota,
  type ModuloApi,
  type ModuloId,
  type RegistroAuditoria,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import type { UsuarioTreinamento } from './repositorio';
import type { BancoTreinamentoMemoria } from './memoria';

export const TENANT_A = '0a000000-0000-4000-8000-0000000000aa';
export const TENANT_B = '0a000000-0000-4000-8000-0000000000bb';
export const EQ1 = '0e000000-0000-4000-8000-000000000001';
export const EQ2 = '0e000000-0000-4000-8000-000000000002';
export const REG1 = '0f000000-0000-4000-8000-000000000001';

/** UUID determinístico para os testes (`uuid(1)` = ...000000000001). */
export const uuid = (n: number, prefixo = '00000000'): string => `${prefixo}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const U = {
  vera: { id: uuid(1, '0b000000'), nome: 'Vera Vendedora', perfil: 'vendedor', equipe_id: EQ1, regional_id: REG1, ativo: true },
  vitor: { id: uuid(2, '0b000000'), nome: 'Vitor Vendedor', perfil: 'vendedor', equipe_id: EQ1, regional_id: REG1, ativo: true },
  paula: { id: uuid(3, '0b000000'), nome: 'Paula Promotora', perfil: 'promotor', equipe_id: EQ2, regional_id: REG1, ativo: true },
  sara: { id: uuid(4, '0b000000'), nome: 'Sara Supervisora', perfil: 'supervisor', equipe_id: EQ1, regional_id: REG1, ativo: true },
  ana: { id: uuid(5, '0b000000'), nome: 'Ana Analista', perfil: 'analista', equipe_id: null, regional_id: null, ativo: true },
  sem: { id: uuid(6, '0b000000'), nome: 'Sérgio Sem Equipe', perfil: 'vendedor', equipe_id: null, regional_id: null, ativo: true },
  beto: { id: uuid(7, '0b000000'), nome: 'Beto do Tenant B', perfil: 'vendedor', equipe_id: null, regional_id: null, ativo: true },
} satisfies Record<string, UsuarioTreinamento>;

/** Cadastro dos usuários (do Core) no banco em memória: B só tem o Beto. */
export function semearUsuarios(b: BancoTreinamentoMemoria): void {
  for (const u of Object.values(U)) b.usuarios.push({ ...u, tenant_id: u.id === U.beto.id ? TENANT_B : TENANT_A });
}

export interface Registro {
  eventos: { nome: string; payload: unknown; agregado: string | null | undefined }[];
  auditoria: RegistroAuditoria[];
  avisos: string[];
}

export interface OpcoesContexto {
  usuario: UsuarioTreinamento;
  tenant?: string;
  relogio: RelogioDeTeste;
  modulos?: readonly ModuloId[];
  visiveis?: ReadonlySet<string> | 'tenant';
  parametros?: Record<string, unknown>;
  registro?: Registro;
  /**
   * Banco real (testes `*.db.test.ts`): executa `fn` na transação do tenant, com RLS. Sem isso o `ClienteBanco` é um
   * objeto vazio (só serve ao repositório em memória).
   */
  executor?: <T>(tenant: string, fn: (db: ClienteBanco) => Promise<T>) => Promise<T>;
  /** Cadastro do Core simulado para `tx.consultar(core.cadastro_resumo@1)` (usuários pedidos por id). */
  cadastro?: readonly UsuarioTreinamento[];
  /** Tenant inteiro devolvido por `core.usuarios_resumo@1` (paginado pelo cursor); ausente = consulta indisponível. */
  usuariosCore?: readonly UsuarioTreinamento[];
  /** Tamanho da página simulada de `core.usuarios_resumo@1` (teste de cursor). */
  paginaCore?: number;
}

export const novoRegistro = (): Registro => ({ eventos: [], auditoria: [], avisos: [] });

export function contexto(o: OpcoesContexto): ContextoBase & { registro: Registro } {
  const registro = o.registro ?? novoRegistro();
  const tenant = o.tenant ?? (o.usuario.id === U.beto.id ? TENANT_B : TENANT_A);
  const tx: TransacaoTenant = {
    async publicar(def, payload, agregado) {
      if (!manifest.publica.includes(def.nome)) throw new Error(`evento fora do manifesto: ${def.nome}`);
      const p = def.schema.parse(payload);
      registro.eventos.push({ nome: def.nome, payload: p, agregado });
      return { evento_id: uuid(registro.eventos.length, 'ee000000'), nome: def.nome, tenant_id: tenant, ocorrido_em: o.relogio.iso(), payload: p } as never;
    },
    async registrarArquivo() {
      throw new Error('o Treinamento não registra arquivo');
    },
    async consultar(def, entrada) {
      if (def.nome === 'core.usuarios_resumo@1') {
        if (!o.usuariosCore) throw new ConsultaIndisponivel(def.nome, 'core');
        const { apos_id, limite } = entrada as { apos_id?: string; limite: number };
        const todos = [...o.usuariosCore].sort((a, b) => a.id.localeCompare(b.id));
        const resto = apos_id ? todos.filter((u) => u.id > apos_id) : todos;
        const n = Math.min(limite, o.paginaCore ?? limite);
        const pagina = resto.slice(0, n);
        return { usuarios: pagina, proximo_cursor: resto.length > n ? pagina[pagina.length - 1]!.id : null } as never;
      }
      if (!o.cadastro) throw new Error('o Treinamento não consulta outro módulo');
      const ids = new Set((entrada as { usuario_ids?: string[] }).usuario_ids ?? []);
      const usuarios = o.cadastro.filter((u) => ids.has(u.id)).map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, external_id: null }));
      return { clientes: [], produtos: [], usuarios } as never;
    },
    async auditar(r) {
      registro.auditoria.push(r);
    },
  };
  return {
    registro,
    usuario: { id: o.usuario.id, tenant_id: tenant, perfil: o.usuario.perfil, modulos: o.modulos ?? ['core', 'treinamento'] },
    dependencias: {},
    requestId: 'req-teste',
    agora: () => o.relogio.agora(),
    comTenant: (fn) => (o.executor ? o.executor(tenant, (db) => fn(db, tx)) : fn({ tenantId: tenant } as unknown as ClienteBanco, tx)),
    carteira: async () => 'tenant',
    usuariosVisiveis: async () => o.visiveis ?? new Set([o.usuario.id]),
    parametros: () => o.parametros ?? {},
    fuso: () => o.relogio.fuso,
    log: { info: () => undefined, warn: (_o, m) => void registro.avisos.push(m ?? ''), error: () => undefined },
  };
}

const permissoes = criarPermissoes([manifest]);

export interface Resposta<T = unknown> {
  status: number;
  corpo: T;
}

/** Chama a rota `metodo caminho` (caminho concreto, ex.: `bko/trilhas/<id>/publicar`) como o `createApp` faria. */
export async function chamar<T = unknown>(
  api: ModuloApi,
  metodo: string,
  caminho: string,
  o: OpcoesContexto & { corpo?: unknown; query?: Record<string, unknown> },
): Promise<Resposta<T>> {
  const achada = (api.rotas ?? [])
    .map((r) => {
      const partes = r.caminho.split('/');
      const reais = caminho.split('/');
      if (r.metodo !== metodo || partes.length !== reais.length) return null;
      const params: Record<string, string> = {};
      for (let i = 0; i < partes.length; i++) {
        if (partes[i]!.startsWith(':')) params[partes[i]!.slice(1)] = reais[i]!;
        else if (partes[i] !== reais[i]) return null;
      }
      return { r, params };
    })
    .find(Boolean);
  if (!achada) throw new Error(`rota inexistente: ${metodo} ${caminho}`);
  const { r, params } = achada;
  const ctx = contexto(o);
  if (!r.acao) throw new Error(`${metodo} ${caminho}: toda rota do Treinamento declara a ação do manifesto`);
  const acesso = verificarAcao(ctx.usuario, permissoes, r.acao);
  if (!acesso.ok) return { status: acesso.status, corpo: { codigo: acesso.codigo, mensagem: acesso.mensagem } as T };
  const parse = (s: { safeParse(x: unknown): { success: boolean; data?: unknown } } | undefined, x: unknown) => (s ? s.safeParse(x) : { success: true, data: x });
  const pc = parse(r.corpo, o.corpo);
  const pq = parse(r.query, o.query ?? {});
  const pp = parse(r.params, params);
  if (!pc.success || !pq.success || !pp.success) return { status: 400, corpo: { codigo: 'VALIDACAO' } as T };
  try {
    const corpo = await r.executar({ ...ctx, corpo: pc.data, query: pq.data, params: pp.data } as ContextoRota);
    return { status: r.status ?? 200, corpo: corpo as T };
  } catch (e) {
    if (e instanceof ErroHttpModulo) return { status: e.status, corpo: { codigo: e.codigo, mensagem: e.message, ...(e.detalhes ? { detalhes: e.detalhes } : {}) } as T };
    throw e;
  }
}
