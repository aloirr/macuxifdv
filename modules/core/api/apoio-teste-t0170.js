/**
 * Apoio dos testes com banco da T-0170 (tarefas, frases, avatar, metas de produtividade, Performance e sync): monta o contexto das
 * rotas e dos provedores sobre o Postgres dos testes (fixture dois-tenants, RLS, papel `macuxi_app`), com a `tx` falsa que
 * guarda os eventos, grava os arquivos de verdade e responde às consultas que o teste programar. Não é importado pelo código de
 * produção. O `index.ts` ainda não registra essas rotas, por isso cada teste monta o próprio contexto (sem Fastify).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco } from '@macuxi/db/teste/estado';
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import pg from 'pg';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
export const A = DOIS_TENANTS.A;
export const B = DOIS_TENANTS.B;
export const U = A.usuarios;
export class AmbienteBanco {
    pool;
    admin;
    acesso;
    eventos = [];
    linhasDeLog = [];
    /** Respostas das consultas entre módulos (`nome@1` → função); sem entrada = `ConsultaIndisponivel`. */
    consultas = {};
    /** Relógio do servidor; nulo = o relógio verdadeiro (o Postgres grava com `now()`). */
    relogio = null;
    async abrir() {
        this.pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        this.admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 2 });
        this.acesso = {
            comTenant: (tenantId, fn) => comTenant(this.pool, tenantId, (c) => fn(c)),
            semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
        };
    }
    async fechar() {
        await this.admin?.end();
        await this.pool?.end();
    }
    usuario(uid, perfil, tenant = A.tenantId) {
        return { id: uid, tenant_id: tenant, perfil };
    }
    /** Executa no tenant com o papel da aplicação (RLS). */
    noTenant(tenant, fn) {
        return comTenant(this.pool, tenant, (c) => fn(c));
    }
    /** Apaga linhas de teste com o papel administrativo (as tabelas novas não têm `delete` para a aplicação). */
    async limpar(sql, valores = []) {
        await this.admin.query(sql, valores);
    }
    ctx(u, extra = {}) {
        const tx = {
            publicar: async (def, payload) => {
                this.eventos.push({ nome: def.nome, payload });
                return {};
            },
            consultar: async (def, entrada) => {
                const h = this.consultas[def.nome];
                if (!h)
                    throw new ConsultaIndisponivel(def.nome, def.nome.split('.')[0]);
                return h(entrada);
            },
        };
        const log = (o, m) => this.linhasDeLog.push(JSON.stringify({ o, m }));
        return {
            usuario: u,
            requestId: 'req-teste',
            dependencias: extra.dependencias ?? {},
            agora: () => this.relogio ?? new Date(), // hora-fixa-ok: o Postgres real grava com now(); o contexto acompanha o relógio verdadeiro
            fuso: () => 'America/Manaus',
            comTenant: (fn) => comTenant(this.pool, u.tenant_id, async (c) => {
                const r = await fn(c, {
                    ...tx,
                    registrarArquivo: async (a) => {
                        const r = await c.query(`insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por) values ($1, plataforma.tenant_atual(), 'core', $2, $3, $4, $5, $6) on conflict (id) do nothing`, [a.id, a.finalidade, a.entidade, a.entidade_id, a.cliente_id ?? null, u.id]);
                        return { criado: (r.rowCount ?? 0) > 0 };
                    },
                });
                return r;
            }),
            usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, this.acesso),
            carteira: async () => 'tenant',
            parametros: () => ({}),
            log: { info: log, warn: log, error: log },
        };
    }
    rota(rotas, metodo, caminho) {
        const r = rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
        if (!r)
            throw new Error(`rota ${metodo} ${caminho} não encontrada`);
        return r;
    }
    /** Valida o corpo, a query e os params pelos schemas da rota (como a plataforma) e executa. */
    async chamar(rotas, metodo, caminho, u, extra = {}) {
        const r = this.rota(rotas, metodo, caminho);
        return r.executar({
            ...this.ctx(u),
            corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {},
            query: r.query ? r.query.parse(extra.query ?? {}) : {},
            params: r.params ? r.params.parse(extra.params ?? {}) : {},
        }); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    pedidoPull() {
        return { desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 }; // hora-fixa-ok: a janela do pull precisa cobrir linhas gravadas agora pelo banco real
    }
    puxar(provedores, entidade, u) {
        const p = provedores.find((x) => x.entidade.nome === entidade);
        if (!p?.puxar)
            throw new Error(`provedor de pull ${entidade} não encontrado`);
        return p.puxar(this.ctx(u), this.pedidoPull());
    }
    receber(provedores, entidade, u, itens) {
        const p = provedores.find((x) => x.entidade.nome === entidade);
        if (!p?.receber)
            throw new Error(`provedor de push ${entidade} não encontrado`);
        return p.receber(this.ctx(u), itens);
    }
}
/** Id de teste estável por faixa (cada arquivo de teste usa a sua, para limpar só o que criou). */
export const idDe = (faixa) => (n) => `${faixa}-0000-4000-8000-${String(n).padStart(12, '0')}`;
