/**
 * Apoio dos testes com banco da T-0170 (tarefas, frases, avatar, metas de produtividade, Performance e sync): monta o contexto das
 * rotas e dos provedores sobre o Postgres dos testes (fixture dois-tenants, RLS, papel `macuxi_app`), com a `tx` falsa que
 * guarda os eventos, grava os arquivos de verdade e responde às consultas que o teste programar. Não é importado pelo código de
 * produção. O `index.ts` ainda não registra essas rotas, por isso cada teste monta o próprio contexto (sem Fastify).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco } from '@macuxi/db/teste/estado';
import { ConsultaIndisponivel, type AcessoBanco, type ClienteBanco, type ContextoBase, type ItemPush, type LinhaSync, type PedidoPull, type ProvedorSync, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

export const A = DOIS_TENANTS.A;
export const B = DOIS_TENANTS.B;
export const U = A.usuarios;

export interface EventoGravado {
  nome: string;
  payload: Record<string, unknown>;
}

type Pedido = { corpo?: unknown; query?: unknown; params?: unknown };

export class AmbienteBanco {
  pool!: pg.Pool;
  admin!: pg.Pool;
  acesso!: AcessoBanco;
  eventos: EventoGravado[] = [];
  linhasDeLog: string[] = [];
  /** Respostas das consultas entre módulos (`nome@1` → função); sem entrada = `ConsultaIndisponivel`. */
  consultas: Record<string, (entrada: unknown) => unknown> = {};
  /** Relógio do servidor; nulo = o relógio verdadeiro (o Postgres grava com `now()`). */
  relogio: Date | null = null;

  async abrir(): Promise<void> {
    this.pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    this.admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 2 });
    this.acesso = {
      comTenant: (tenantId, fn) => comTenant(this.pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
  }

  async fechar(): Promise<void> {
    await this.admin?.end();
    await this.pool?.end();
  }

  usuario(uid: string, perfil: UsuarioAutenticado['perfil'], tenant: string = A.tenantId): UsuarioAutenticado {
    return { id: uid, tenant_id: tenant, perfil };
  }

  /** Executa no tenant com o papel da aplicação (RLS). */
  noTenant<T>(tenant: string, fn: (db: ClienteBanco) => Promise<T>): Promise<T> {
    return comTenant(this.pool, tenant, (c) => fn(c as unknown as ClienteBanco));
  }

  /** Apaga linhas de teste com o papel administrativo (as tabelas novas não têm `delete` para a aplicação). */
  async limpar(sql: string, valores: unknown[] = []): Promise<void> {
    await this.admin.query(sql, valores);
  }

  ctx(u: UsuarioAutenticado, extra: { dependencias?: Record<string, string[]> } = {}): ContextoBase {
    const tx = {
      publicar: async (def: { nome: string }, payload: Record<string, unknown>) => {
        this.eventos.push({ nome: def.nome, payload });
        return {};
      },
      consultar: async (def: { nome: string }, entrada: unknown) => {
        const h = this.consultas[def.nome];
        if (!h) throw new ConsultaIndisponivel(def.nome, def.nome.split('.')[0] as never);
        return h(entrada);
      },
    };
    const log = (o: Record<string, unknown>, m?: string) => this.linhasDeLog.push(JSON.stringify({ o, m }));
    return {
      usuario: u,
      requestId: 'req-teste',
      dependencias: extra.dependencias ?? {},
      agora: () => this.relogio ?? new Date(), // hora-fixa-ok: o Postgres real grava com now(); o contexto acompanha o relógio verdadeiro
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) =>
        comTenant(this.pool, u.tenant_id, async (c) => {
          const r = await fn(c, {
            ...tx,
            registrarArquivo: async (a: { id: string; finalidade: string; entidade: string; entidade_id: string; cliente_id?: string | null }) => {
              const r = await c.query(
                `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por) values ($1, plataforma.tenant_atual(), 'core', $2, $3, $4, $5, $6) on conflict (id) do nothing`,
                [a.id, a.finalidade, a.entidade, a.entidade_id, a.cliente_id ?? null, u.id],
              );
              return { criado: (r.rowCount ?? 0) > 0 };
            },
          });
          return r;
        }),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, this.acesso),
      carteira: async () => 'tenant' as const,
      parametros: () => ({}),
      log: { info: log, warn: log, error: log },
    } as unknown as ContextoBase;
  }

  rota(rotas: readonly RotaModulo[], metodo: string, caminho: string): RotaModulo {
    const r = rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho} não encontrada`);
    return r;
  }

  /** Valida o corpo, a query e os params pelos schemas da rota (como a plataforma) e executa. */
  async chamar(rotas: readonly RotaModulo[], metodo: string, caminho: string, u: UsuarioAutenticado, extra: Pedido = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = this.rota(rotas, metodo, caminho);
    return r.executar({
      ...this.ctx(u),
      corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {},
      query: r.query ? r.query.parse(extra.query ?? {}) : {},
      params: r.params ? r.params.parse(extra.params ?? {}) : {},
    } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  pedidoPull(): PedidoPull {
    return { desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 }; // hora-fixa-ok: a janela do pull precisa cobrir linhas gravadas agora pelo banco real
  }

  puxar(provedores: readonly ProvedorSync[], entidade: string, u: UsuarioAutenticado): Promise<LinhaSync[]> {
    const p = provedores.find((x) => x.entidade.nome === entidade);
    if (!p?.puxar) throw new Error(`provedor de pull ${entidade} não encontrado`);
    return p.puxar(this.ctx(u), this.pedidoPull());
  }

  receber(provedores: readonly ProvedorSync[], entidade: string, u: UsuarioAutenticado, itens: ItemPush[]) {
    const p = provedores.find((x) => x.entidade.nome === entidade);
    if (!p?.receber) throw new Error(`provedor de push ${entidade} não encontrado`);
    return p.receber(this.ctx(u), itens);
  }
}

/** Id de teste estável por faixa (cada arquivo de teste usa a sua, para limpar só o que criou). */
export const idDe = (faixa: string) => (n: number) => `${faixa}-0000-4000-8000-${String(n).padStart(12, '0')}`;
