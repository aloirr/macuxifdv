/**
 * E-mail transacional do Core (T-0094; ADR 0032, desenho §10). A porta `ServicoEmail` vem da plataforma (`ctx.email`, fatia S +
 * frente N5): `enfileirar` só faz um insert na outbox de e-mail pela conexão da transação do tenant, com a carga cifrada, e o
 * despachante envia depois. Sem serviço (ou sem adaptador) o Core trata como
 * `indisponivel` (o BKO avisa e a Equipe por CSV recusa antes de gravar). A senha só passa por `dados.senha`: nunca vai a log,
 * auditoria nem evento.
 */
import { perfisDeFabrica, podeUsarApp } from '../domain';
import { APPS_COM_LOGIN } from '@macuxi/platform-sdk';
/** O serviço de e-mail do contexto, ou `null` se a plataforma não o oferece. */
export function emailDoContexto(ctx) {
    const e = ctx?.email;
    return e && typeof e.enfileirar === 'function' && typeof e.disponivel === 'function' ? e : null;
}
export const emailDisponivel = (ctx) => emailDoContexto(ctx)?.disponivel() ?? false;
/** Apps em que o perfil entra (textos do e-mail). */
export const appsDoPerfil = (perfil) => APPS_COM_LOGIN.filter((a) => podeUsarApp(perfisDeFabrica(perfil), a));
/** Apps em que o usuário entra com o perfil dele (RN-CORE-33: perfil que não usa o app fecha o app). */
export const appsDosPerfis = (perfis) => APPS_COM_LOGIN.filter((a) => podeUsarApp(perfis, a));
/** Enfileira e devolve o resultado; sem serviço = `indisponivel`. Nunca lança por falta de e-mail. */
export async function enviarEmail(ctx, db, m) {
    const s = emailDoContexto(ctx);
    if (!s || !s.disponivel())
        return 'indisponivel';
    return s.enfileirar(db, m);
}
/** Empresa do tenant da transação (nome e código para o e-mail). */
export async function empresaDoTenant(db) {
    const r = await db.query('select nome, codigo from plataforma.tenant where id = plataforma.tenant_atual()');
    return r.rows[0] ?? { nome: '', codigo: '' };
}
