/**
 * Apoio dos testes de banco do pré-cadastro (`cliente-cadastro.db.test.ts` e `cliente-pre-cadastro-bko.db.test.ts`; ADR 0069). Uma
 * transação por caso, desfeita no fim; cada `comTenant` roda num savepoint, como a transação própria da API (erro desfaz só ele).
 * Não é importado pelo código de produção.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { vi } from 'vitest';
import { perfisDeFabrica } from '../domain';
export const A = DOIS_TENANTS.A;
export const B = DOIS_TENANTS.B;
/** Campos do padrão da RN-CORE-16 preenchidos (IE "ISENTO" vale para CNPJ). */
export const ENDERECO_COMPLETO = { inscricao_estadual: 'ISENTO', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69000000' };
/** Carteira do usuário como a API calcula para vendedor (os próprios clientes vivos); demais perfis: o tenant. */
async function carteiraDe(c, u) {
    if (u.perfil !== 'vendedor' && u.perfil !== 'promotor')
        return 'tenant';
    const r = await c.query('select cliente_id from core.carteira where usuario_id = $1 and deleted_at is null', [u.id]);
    return new Set(r.rows.map((x) => x.cliente_id));
}
export async function emTransacao(pool, fn) {
    const c = await pool.connect();
    let sp = 0;
    try {
        await c.query('begin');
        await definirTenant(c, A.tenantId);
        const publicar = vi.fn(async () => ({}));
        const q = async (sql, v = []) => (await c.query(sql, v)).rows;
        const comTenant = async (f) => {
            const nome = `t${++sp}`;
            await c.query(`savepoint ${nome}`);
            try {
                const r = await f(c, { publicar });
                await c.query(`release savepoint ${nome}`);
                return r;
            }
            catch (e) {
                await c.query(`rollback to savepoint ${nome}`);
                throw e;
            }
        };
        const ctx = (u, extra = {}) => ({
            usuario: { id: u.id, tenant_id: u.tenant ?? A.tenantId, perfil: u.perfil, perfis: perfisDeFabrica(u.perfil) },
            requestId: 'req-pre-cadastro',
            agora: () => new Date(),
            fuso: () => 'America/Manaus',
            comTenant,
            carteira: () => carteiraDe(c, u),
            corpo: extra.rota?.corpo ? extra.rota.corpo.parse(extra.corpo ?? {}) : extra.corpo,
            query: extra.rota?.query ? extra.rota.query.parse(extra.query ?? {}) : (extra.query ?? {}),
            params: extra.rota?.params ? extra.rota.params.parse(extra.params ?? {}) : (extra.params ?? {}),
        });
        const rota = (rotas, metodo, caminho, u, extra = {}) => {
            const r = rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
            if (!r)
                throw new Error(`rota ${metodo} ${caminho} não existe`);
            return r.executar(ctx(u, { ...extra, rota: r }));
        };
        const push = (receber, u, payloads, operacao = 'upsert') => receber(ctx(u), payloads.map((p) => ({ entidade: 'cliente_pre_cadastro', id: String(p.id), operacao, payload: p })));
        const trocarTenant = (tenantId) => definirTenant(c, tenantId);
        try {
            await fn({ c, publicar, q, ctx, rota, push, trocarTenant });
        }
        finally {
            await c.query('rollback').catch(() => undefined);
        }
    }
    finally {
        c.release();
    }
}
/** Marca o pré-cadastro como recusado pelo ERP na revisão atual (o que o consumidor do retorno faz), com motivo e erros por campo. */
export async function recusar(t, id, motivo = 'CNPJ com cadastro bloqueado no ERP.', erros = [{ campo: 'inscricao_estadual', codigo: 'IE_INVALIDA', mensagem: 'IE não confere.' }]) {
    await t.q("update core.cliente set status_cadastro = 'recusado', motivo_recusa = $2, erros_recusa = $3::jsonb where id = $1", [id, motivo, JSON.stringify(erros)]);
    await t.q(`update core.cliente_pre_cadastro_tentativa set resultado = 'recusado', respondido_em = now(), motivo = $2, erros = $3::jsonb
      where cliente_id = $1 and revisao = (select revisao_cadastro from core.cliente where id = $1)`, [id, motivo, JSON.stringify(erros)]);
}
