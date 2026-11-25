/**
 * Rotas de administração de licenças de módulo (tenant → perfil → usuário; RN-CORE-01/02/03). Só `admin`
 * (ação `modulo.gerir_licencas` do manifesto; a API revalida). Escrevem `plataforma.tenant_modulo`,
 * `plataforma.perfil_modulo` e `plataforma.usuario_modulo` por `ctx.comTenant` (RLS) e, na MESMA transação,
 * publicam `core.usuario.modulos_alterados@1` (outbox) e gravam a auditoria (RN-AUD-01). A licença vale na
 * requisição seguinte do usuário (a plataforma recalcula a cada chamada; `versao_licencas` muda no `/me/modulos`).
 * - O `core` nunca desliga em nenhum nível (RN-CORE-01 → 422).
 * - Exceção do usuário só REMOVE (esclarecimento do doc 03).
 */
import { MODULOS, PERFIS, ehModulo, ErroNaoEncontrado, ErroRegraNegocio } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { AlterarLicencaRequestSchema, EVENTO_MODULOS_ALTERADOS, ModuloIdSchema, PerfilSchema } from '../contracts';
import { podeDesativarModulo } from '../domain';
const modulosDe = (rows) => rows.map((r) => r.modulo).filter(ehModulo);
/** Dependências entre módulos (RN-CORE-03), quando a plataforma as fornece no contexto (`ctx.dependencias`). */
export function dependenciasDoContexto(ctx) {
    const d = ctx.dependencias;
    if (!d)
        return {};
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [...(v ?? [])]]));
}
export async function lerEstadoDeLicencas(db, dependencias) {
    const tenant = await db.query('select modulo, ativo from plataforma.tenant_modulo where deleted_at is null');
    const perfis = await db.query('select perfil, modulo from plataforma.perfil_modulo where deleted_at is null');
    const usuarios = await db.query('select id, nome, email, perfil from core.usuario where deleted_at is null and ativo order by nome, id');
    const removidos = await db.query("select usuario_id, modulo from plataforma.usuario_modulo where efeito = 'remover' and deleted_at is null");
    const tenantMapa = {};
    for (const m of MODULOS)
        tenantMapa[m] = m === 'core';
    for (const l of tenant.rows)
        if (ehModulo(l.modulo))
            tenantMapa[l.modulo] = l.ativo || l.modulo === 'core';
    const perfisMapa = Object.fromEntries(PERFIS.map((p) => [p, []]));
    for (const l of perfis.rows)
        if (ehModulo(l.modulo))
            perfisMapa[l.perfil]?.push(l.modulo);
    return {
        modulos: [...MODULOS],
        dependencias,
        tenant: tenantMapa,
        perfis: perfisMapa,
        usuarios: usuarios.rows.map((u) => ({
            ...u,
            removidos: modulosDe(removidos.rows.filter((r) => r.usuario_id === u.id)),
        })),
    };
}
function recusarCore(modulo, ativo) {
    if (!ativo && !podeDesativarModulo(modulo)) {
        throw new ErroRegraNegocio('RN-CORE-01', 'O módulo Core faz parte de todas as licenças e não pode ser desativado.');
    }
}
const ModuloParam = z.object({ modulo: ModuloIdSchema });
const PerfilModuloParam = z.object({ perfil: PerfilSchema, modulo: ModuloIdSchema });
const UsuarioModuloParam = z.object({ id: z.string().uuid(), modulo: ModuloIdSchema });
/** Grava auditoria e evento dentro da transação já aberta. */
async function auditarEPublicar(ctx, db, tx, g) {
    await db.query(`insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, request_id)
     values (plataforma.tenant_atual(), $1, 'core', 'licenca.alterar', 'licenca', $2, $3::jsonb, $4::jsonb, $5)`, [ctx.usuario.id, g.entidadeId, JSON.stringify({ ativo: g.antes }), JSON.stringify(g.evento), ctx.requestId]);
    if (g.antes !== g.depois)
        await tx.publicar(EVENTO_MODULOS_ALTERADOS, g.evento, g.entidadeId);
}
export const rotasDeLicencas = [
    {
        metodo: 'GET',
        caminho: 'licencas',
        superficie: 'bko',
        perfis: ['admin'],
        carteira: 'nao_se_aplica',
        executar: (ctx) => ctx.comTenant((db) => lerEstadoDeLicencas(db, dependenciasDoContexto(ctx))),
    },
    {
        metodo: 'PUT',
        caminho: 'licencas/tenant/:modulo',
        superficie: 'bko',
        acao: 'modulo.gerir_licencas',
        carteira: 'nao_se_aplica',
        params: ModuloParam,
        corpo: AlterarLicencaRequestSchema,
        executar: async (ctx) => {
            const { modulo } = ctx.params;
            const { ativo } = ctx.corpo;
            recusarCore(modulo, ativo);
            return ctx.comTenant(async (db, tx) => {
                const atual = await db.query('select ativo from plataforma.tenant_modulo where modulo = $1 and deleted_at is null', [modulo]);
                const antes = atual.rows[0]?.ativo ?? false;
                await db.query(`insert into plataforma.tenant_modulo (tenant_id, modulo, ativo, ativado_em, desativado_em)
           values (plataforma.tenant_atual(), $1, $2, case when $2 then now() end, case when not $2 then now() end)
           on conflict (tenant_id, modulo) where deleted_at is null
           do update set ativo = excluded.ativo,
                         ativado_em = case when excluded.ativo and not plataforma.tenant_modulo.ativo then now() else plataforma.tenant_modulo.ativado_em end,
                         desativado_em = case when not excluded.ativo and plataforma.tenant_modulo.ativo then now() else plataforma.tenant_modulo.desativado_em end`, [modulo, ativo]);
                await auditarEPublicar(ctx, db, tx, { antes, depois: ativo, entidadeId: null, evento: { nivel: 'tenant', modulo, ativo, perfil: null, usuario_id: null } });
                return { nivel: 'tenant', modulo, ativo };
            });
        },
    },
    {
        metodo: 'PUT',
        caminho: 'licencas/perfis/:perfil/:modulo',
        superficie: 'bko',
        acao: 'modulo.gerir_licencas',
        carteira: 'nao_se_aplica',
        params: PerfilModuloParam,
        corpo: AlterarLicencaRequestSchema,
        executar: async (ctx) => {
            const { modulo, perfil } = ctx.params;
            const { ativo } = ctx.corpo;
            recusarCore(modulo, ativo);
            return ctx.comTenant(async (db, tx) => {
                const atual = await db.query('select 1 from plataforma.perfil_modulo where perfil = $1 and modulo = $2 and deleted_at is null', [perfil, modulo]);
                const antes = atual.rows.length > 0;
                if (ativo && !antes) {
                    await db.query('insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values (plataforma.tenant_atual(), $1, $2)', [perfil, modulo]);
                }
                else if (!ativo && antes) {
                    await db.query('update plataforma.perfil_modulo set deleted_at = now() where perfil = $1 and modulo = $2 and deleted_at is null', [perfil, modulo]);
                }
                await auditarEPublicar(ctx, db, tx, { antes, depois: ativo, entidadeId: null, evento: { nivel: 'perfil', modulo, ativo, perfil, usuario_id: null } });
                return { nivel: 'perfil', perfil, modulo, ativo };
            });
        },
    },
    {
        metodo: 'PUT',
        caminho: 'licencas/usuarios/:id/:modulo',
        superficie: 'bko',
        acao: 'modulo.gerir_licencas',
        carteira: 'nao_se_aplica',
        params: UsuarioModuloParam,
        corpo: AlterarLicencaRequestSchema,
        executar: async (ctx) => {
            const { id, modulo } = ctx.params;
            const { ativo } = ctx.corpo;
            recusarCore(modulo, ativo);
            return ctx.comTenant(async (db, tx) => {
                const u = await db.query('select id from core.usuario where id = $1 and deleted_at is null', [id]);
                if (u.rows.length === 0)
                    throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
                const atual = await db.query("select 1 from plataforma.usuario_modulo where usuario_id = $1 and modulo = $2 and efeito = 'remover' and deleted_at is null", [id, modulo]);
                const removido = atual.rows.length > 0;
                // exceção só REMOVE: "ativo" = sem exceção; "inativo" = exceção que remove
                if (!ativo && !removido) {
                    await db.query("insert into plataforma.usuario_modulo (tenant_id, usuario_id, modulo, efeito) values (plataforma.tenant_atual(), $1, $2, 'remover')", [id, modulo]);
                }
                else if (ativo && removido) {
                    await db.query("update plataforma.usuario_modulo set deleted_at = now() where usuario_id = $1 and modulo = $2 and efeito = 'remover' and deleted_at is null", [id, modulo]);
                }
                await auditarEPublicar(ctx, db, tx, { antes: !removido, depois: ativo, entidadeId: id, evento: { nivel: 'usuario', modulo, ativo, perfil: null, usuario_id: id } });
                return { nivel: 'usuario', usuario_id: id, modulo, ativo };
            });
        },
    },
];
