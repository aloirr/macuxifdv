/**
 * Filial do usuário na API (T-0176; RN-CORE-39 revista). A regra é a do domain; aqui a API revalida com o estado do banco e grava
 * por SQL direto (o espelho Drizzle é do banco-dados). `core.usuario.filial_cadastro_id` (nulo = bloqueado) e `core.usuario_filial`
 * (filiais de VENDA; remover o vínculo é soft delete). Invariante do banco: a de cadastro está sempre entre as de venda (gatilho
 * adiável `usuario_filial_inclui_cadastro`, 23514, checado no COMMIT; aqui antecipado com `set constraints ... immediate`).
 * O bloqueio `USUARIO_SEM_FILIAL` vale para qualquer perfil (guarda global da plataforma, ADR 0056). Sem dado pessoal em log.
 */
import { ErroHttpModulo, ErroRegraNegocio, pode } from '@macuxi/platform-sdk';
import { ACAO_FILIAL_USUARIO_EDITAR, CODIGOS_FILIAL_USUARIO, MENSAGEM_FILIAL_INVALIDA, MENSAGEM_FILIAL_VENDA_SEM_CADASTRO, MENSAGEM_SEM_PERMISSAO_FILIAL, } from '../contracts';
import { filiaisDeVendaComCadastro, filiaisInexistentes, usuarioBloqueadoPorFilial, validarFiliaisDoUsuario } from '../domain';
const SEM_FILIAL = { filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true };
/** Filial de cadastro e filiais de venda vivas do usuário (ordem estável). Usuário inexistente = sem filial. */
export async function filiaisDoUsuario(db, usuarioId) {
    return (await filiaisDosUsuarios(db, [usuarioId])).get(usuarioId) ?? SEM_FILIAL;
}
/** Filiais de vários usuários, de uma vez (lista do BKO). */
export async function filiaisDosUsuarios(db, ids) {
    const m = new Map();
    if (ids.length === 0)
        return m;
    const base = await db.query('select id, filial_cadastro_id from core.usuario where id = any($1::uuid[]) and deleted_at is null', [[...ids]]);
    const venda = await db.query('select usuario_id, filial_id from core.usuario_filial where usuario_id = any($1::uuid[]) and deleted_at is null order by created_at, filial_id', [[...ids]]);
    const porUsuario = new Map();
    for (const l of venda.rows)
        porUsuario.set(l.usuario_id, [...(porUsuario.get(l.usuario_id) ?? []), l.filial_id]);
    for (const u of base.rows)
        m.set(u.id, { filial_cadastro_id: u.filial_cadastro_id, filial_venda_ids: porUsuario.get(u.id) ?? [], sem_filial: usuarioBloqueadoPorFilial(u) });
    return m;
}
/** RN-CORE-39: o usuário (qualquer perfil) sem filial de cadastro está bloqueado. Inexistente = não bloqueado (quem não existe nem chega aqui). */
export async function usuarioSemFilial(db, usuarioId) {
    const r = await db.query('select filial_cadastro_id from core.usuario where id = $1 and deleted_at is null', [usuarioId]);
    return r.rows[0] ? usuarioBloqueadoPorFilial(r.rows[0]) : false;
}
/** ADR 0033: quem informa ou troca filial é quem tem a ação `usuario.filial_editar` (de fábrica admin e analista): 403 para os demais. */
export function exigirQuemEditaFilial(perfis) {
    if (!pode(perfis, ACAO_FILIAL_USUARIO_EDITAR))
        throw new ErroHttpModulo(403, CODIGOS_FILIAL_USUARIO.semPermissao, MENSAGEM_SEM_PERMISSAO_FILIAL);
}
/**
 * Normaliza (a de cadastro entra na de venda se faltar) e confere: 422 se a regra do domain falha ou se alguma filial não existe,
 * foi excluída ou é de outro tenant (RLS). Devolve cadastro e venda prontos para gravar.
 */
export async function conferirFiliaisDoUsuario(db, f) {
    const venda = filiaisDeVendaComCadastro(f.cadastro, f.venda);
    const erro = validarFiliaisDoUsuario({ cadastro: f.cadastro, venda });
    if (erro)
        throw new ErroRegraNegocio(erro.codigo, erro.mensagem, { campo: erro.codigo === CODIGOS_FILIAL_USUARIO.cadastroObrigatoria ? 'filial_cadastro_id' : 'filial_venda_ids' });
    const r = await db.query('select id from core.filial where id = any($1::uuid[]) and deleted_at is null', [venda]);
    const faltam = filiaisInexistentes(venda, r.rows.map((l) => l.id));
    if (faltam.length > 0)
        throw new ErroRegraNegocio(CODIGOS_FILIAL_USUARIO.invalida, MENSAGEM_FILIAL_INVALIDA, { campo: f.venda.some((v) => faltam.includes(v)) ? 'filial_venda_ids' : 'filial_cadastro_id' });
    return { cadastro: f.cadastro, venda };
}
/**
 * Grava cadastro e venda na MESMA transação: tira da venda as que saíram (soft delete), põe as novas e atualiza a coluna. Devolve se algo
 * mudou. O 23514 `usuario_filial_inclui_cadastro` do banco vira 422.
 */
export async function gravarFiliaisDoUsuario(db, usuarioId, cadastro, venda) {
    const novas = filiaisDeVendaComCadastro(cadastro, venda);
    const atual = await filiaisDoUsuario(db, usuarioId);
    const sairam = atual.filial_venda_ids.filter((f) => !novas.includes(f));
    const entraram = novas.filter((f) => !atual.filial_venda_ids.includes(f));
    const cadastroMudou = atual.filial_cadastro_id !== cadastro;
    if (sairam.length === 0 && entraram.length === 0 && !cadastroMudou)
        return false;
    try {
        if (sairam.length > 0)
            await db.query('update core.usuario_filial set deleted_at = now() where usuario_id = $1 and filial_id = any($2::uuid[]) and deleted_at is null', [usuarioId, sairam]);
        for (const f of entraram) {
            await db.query('insert into core.usuario_filial (tenant_id, usuario_id, filial_id) values (plataforma.tenant_atual(), $1, $2)', [usuarioId, f]);
        }
        if (cadastroMudou)
            await db.query('update core.usuario set filial_cadastro_id = $2 where id = $1', [usuarioId, cadastro]);
        await db.query('set constraints core.usuario_filial_inclui_cadastro immediate');
    }
    catch (e) {
        if (e?.code === '23514' && e.constraint === 'usuario_filial_inclui_cadastro') {
            throw new ErroRegraNegocio(CODIGOS_FILIAL_USUARIO.vendaSemCadastro, MENSAGEM_FILIAL_VENDA_SEM_CADASTRO, { campo: 'filial_venda_ids' });
        }
        throw e;
    }
    return true;
}
/**
 * Carga do ERP (`integracao.vendedor.atualizado@1`, `filial_external_id` opcional do Hub): ausente, nulo ou vazio = não altera;
 * presente e existente = vira a filial de CADASTRO e entra na lista de venda (as outras de venda ficam). Presente e inexistente =
 * o usuário fica SEM filial (bloqueado) e o erro `FILIAL_INEXISTENTE` vai ao log (Monitor), só com o código do ERP, sem dado pessoal.
 * Só o vendedor da carga (o consumidor é o do vendedor do ERP).
 */
export async function aplicarFilialDoErp(ctx, usuarioId, vendedorExternalId, filialExternalId) {
    const codigo = typeof filialExternalId === 'string' ? filialExternalId.trim() : '';
    if (codigo === '')
        return 'inalterada';
    const f = await ctx.db.query('select id from core.filial where external_id = $1 and deleted_at is null', [codigo]);
    if (!f.rows[0]) {
        await ctx.db.query('update core.usuario set filial_cadastro_id = null where id = $1 and filial_cadastro_id is not null', [usuarioId]);
        ctx.log.warn({ erro: CODIGOS_FILIAL_USUARIO.inexistenteNaCarga, external_id: vendedorExternalId, filial_external_id: codigo }, 'filial do vendedor não encontrada: o vendedor segue sem filial, bloqueado');
        return 'filial_inexistente';
    }
    const atual = await filiaisDoUsuario(ctx.db, usuarioId);
    return (await gravarFiliaisDoUsuario(ctx.db, usuarioId, f.rows[0].id, [...atual.filial_venda_ids, f.rows[0].id])) ? 'gravada' : 'inalterada';
}
