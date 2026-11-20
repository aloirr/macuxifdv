/**
 * Apoio dos testes da API da Pesquisa (não faz parte do módulo em produção): contexto de rota com repositório em
 * memória, transação falsa que guarda eventos, auditorias e arquivos, e o relógio injetado (`ctx.agora`).
 */
import type { ClienteBanco, ContextoBase, ItemPush, NovoArquivo, Perfil, RegistroAuditoria, RotaModulo, TransacaoTenant } from '@macuxi/platform-sdk';
import { criarApiPesquisa } from './index';
import type { FabricaRepositorio } from './repositorio';
import { criarRepositorioEmMemoria } from './repositorio-memoria';

export const uu = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TENANT_A = uu(9001);
export const TENANT_B = uu(9002);

export interface Efeitos {
  eventos: { nome: string; payload: unknown; agregado: string | null | undefined }[];
  auditorias: RegistroAuditoria[];
  arquivos: NovoArquivo[];
}

export interface OpcoesContexto {
  id: string;
  perfil: Perfil;
  tenant?: string;
  carteira?: ReadonlySet<string> | 'tenant';
  /** Nomes que `core.usuarios_resumo@1` devolve (id → nome); sem isto a consulta falha, como fora do ar. */
  nomes?: Record<string, string>;
  visiveis?: ReadonlySet<string> | 'tenant';
  parametros?: Record<string, unknown>;
  agora: () => Date;
}

export function criarAmbienteDeTeste() {
  const fabrica: FabricaRepositorio & { limpar(): void } = criarRepositorioEmMemoria();
  const api = criarApiPesquisa(fabrica);
  const efeitos: Efeitos = { eventos: [], auditorias: [], arquivos: [] };
  const db: ClienteBanco = { query: async () => ({ rows: [], rowCount: 0 }) };

  const contexto = (o: OpcoesContexto): ContextoBase => {
    const tx = {
      publicar: async (def: { nome: string }, payload: unknown, agregado?: string | null) => {
        efeitos.eventos.push({ nome: def.nome, payload, agregado });
        return {} as never;
      },
      auditar: async (r: RegistroAuditoria) => {
        efeitos.auditorias.push(r);
      },
      registrarArquivo: async (a: NovoArquivo) => {
        efeitos.arquivos.push(a);
        return { criado: true };
      },
      consultar: async (_def: unknown, entrada: { usuario_ids?: string[] }) => {
        if (!o.nomes) throw new Error('consulta indisponível');
        const nomes = o.nomes;
        if ((entrada.usuario_ids?.length ?? 0) > 500) throw new Error('usuario_ids acima de 500 (contrato core.usuarios_resumo@1)');
        return { usuarios: (entrada.usuario_ids ?? []).filter((i) => i in nomes).map((i) => ({ id: i, nome: nomes[i]!, perfil: 'vendedor', equipe_id: null, regional_id: null, ativo: true })), proximo_cursor: null };
      },
    } as unknown as TransacaoTenant;
    const usuario = { id: o.id, tenant_id: o.tenant ?? TENANT_A, perfil: o.perfil, modulos: ['core', 'pesquisa'] as const };
    const padrao = ['analista', 'admin', 'assistente'].includes(o.perfil) ? ('tenant' as const) : new Set([o.id]);
    return {
      usuario,
      dependencias: {},
      requestId: 'req-teste',
      agora: o.agora,
      comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx),
      carteira: async () => o.carteira ?? 'tenant',
      usuariosVisiveis: async () => o.visiveis ?? padrao,
      parametros: () => o.parametros ?? {},
      fuso: () => 'America/Manaus',
      log: { info() {}, warn() {}, error() {} },
    } as unknown as ContextoBase;
  };

  const rota = (metodo: string, caminho: string): RotaModulo => {
    const r = api.rotas?.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho} não existe`);
    return r;
  };

  /** Executa como o `createApp` faria depois das checagens (o corpo/query/params passam pelo Zod da rota). */
  const chamar = async <T = unknown>(ctx: ContextoBase, metodo: string, caminho: string, e: { corpo?: unknown; query?: unknown; params?: unknown } = {}): Promise<T> => {
    const r = rota(metodo, caminho);
    const corpo = r.corpo ? r.corpo.parse(e.corpo ?? {}) : (e.corpo ?? {});
    const query = r.query ? r.query.parse(e.query ?? {}) : (e.query ?? {});
    const params = r.params ? r.params.parse(e.params ?? {}) : (e.params ?? {});
    return (await r.executar({ ...ctx, corpo, query, params } as never)) as T;
  };

  const provedor = (entidade: string) => {
    const p = api.sync?.find((s) => s.entidade.nome === entidade);
    if (!p) throw new Error(`sem provedor ${entidade}`);
    return p;
  };

  const push = (ctx: ContextoBase, itens: ItemPush[]) => provedor('resposta_pesquisa').receber!(ctx, itens);
  const pull = (ctx: ContextoBase, entidade: string, ate: string, desde: { updated_at: string; id: string } | null = null) => provedor(entidade).puxar!(ctx, { desde, ate, limite: 1000 });

  return { api, fabrica, efeitos, contexto, rota, chamar, push, pull, provedor };
}
