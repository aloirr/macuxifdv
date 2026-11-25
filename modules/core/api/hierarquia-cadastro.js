/**
 * Hierarquia no cadastro de usuário (ADR 0049; RN-CORE-54 a RN-CORE-57; contrato da migração 0069).
 * A regra é a do domain (`errosDaHierarquia`); aqui a API revalida com o estado do banco e grava só em `core.usuario.equipe_id` e
 * `core.equipe` (sem coluna nova no usuário). Leitura do cargo e da hierarquia: `core.v_usuario_hierarquia`. Os dois erros do banco
 * no COMMIT (`promotor_sem_gerente`, `promotor_gerente_do_supervisor`, 23514) viram 422 com frase curta.
 */
import { ErroRegraNegocio } from '@macuxi/platform-sdk';
import { CODIGOS_HIERARQUIA, MENSAGENS_HIERARQUIA } from '../contracts';
import { equipeChefiadaPor, erroDoCodigoErp, errosDaHierarquia, hierarquiaDoCargo, responsavelDaEquipe } from '../domain';
/** Cargo do perfil escolhido (`plataforma.perfil.cargo`, NOT NULL desde a 0069). */
export async function cargoDoPerfil(db, codigo) {
    const r = await db.query('select cargo from plataforma.perfil where codigo = $1 and deleted_at is null', [codigo]);
    return r.rows[0]?.cargo ?? null;
}
/** Cargo, gerente e situação das pessoas escolhidas como supervisor ou gerente. */
export async function pessoasDaHierarquia(db, ids) {
    const vivos = [...new Set(ids.filter((x) => !!x))];
    if (vivos.length === 0)
        return [];
    const r = await db.query(`select h.usuario_id as id, h.cargo, h.gerente_id, u.ativo
       from core.v_usuario_hierarquia h join core.usuario u on u.id = h.usuario_id and u.deleted_at is null
      where h.usuario_id = any($1::uuid[])`, [vivos]);
    return r.rows;
}
/** Hierarquia gravada do usuário (para editar sem reenviar tudo e para saber se mudou). */
export async function hierarquiaAtual(db, usuarioId) {
    const r = await db.query(`select h.cargo, h.supervisor_id, h.gerente_id, h.equipe_id, case when e.responsavel_id = h.usuario_id then h.equipe_nome end as equipe_nome
       from core.v_usuario_hierarquia h left join core.equipe e on e.id = h.equipe_id
      where h.usuario_id = $1`, [usuarioId]);
    return r.rows[0] ?? { cargo: null, supervisor_id: null, gerente_id: null, equipe_nome: null, equipe_id: null };
}
/** 422 com o primeiro erro (e todos em `campos`), igual a `dadosInvalidos` da rota: hierarquia (RN-CORE-55/56) e código no ERP (RN-CORE-57). */
export async function conferirHierarquia(db, cargo, pedida, externalId) {
    const h = hierarquiaDoCargo(cargo, pedida);
    const erros = errosDaHierarquia(cargo, h, await pessoasDaHierarquia(db, [h.supervisor_id, h.gerente_id]));
    const erp = erroDoCodigoErp(externalId);
    if (erp)
        erros.push(erp);
    if (erros.length > 0)
        throw new ErroRegraNegocio(erros[0].codigo, erros[0].mensagem, { regra: erp && erros.length === 1 ? 'RN-CORE-57' : 'RN-CORE-55', campos: erros.map(({ campo, mensagem }) => ({ campo, mensagem })) });
    return h;
}
async function equipesChefiadas(db, pessoaId) {
    return (await db.query('select id, responsavel_id from core.equipe where responsavel_id = $1 and deleted_at is null and ativo', [pessoaId])).rows;
}
/**
 * A equipe chefiada pela pessoa; sem ela (gerente sem equipe própria, supervisor antigo), cria "Equipe de {nome}": a do gerente
 * sem equipe-pai, a do supervisor abaixo da equipe em que ele está hoje.
 */
async function garantirEquipeDe(db, pessoaId) {
    const ja = equipeChefiadaPor(await equipesChefiadas(db, pessoaId), pessoaId);
    if (ja)
        return ja.id;
    const p = (await db.query('select u.nome, u.equipe_id, h.cargo from core.usuario u left join core.v_usuario_hierarquia h on h.usuario_id = u.id where u.id = $1', [pessoaId])).rows[0];
    const pai = p?.cargo === 'supervisor' ? (p.equipe_id ?? null) : null;
    const r = await db.query('insert into core.equipe (tenant_id, nome, equipe_pai_id, responsavel_id) values (plataforma.tenant_atual(), $1, $2, $3) returning id', [`Equipe de ${p?.nome ?? 'gerente'}`, pai, pessoaId]);
    const id = r.rows[0].id;
    if (p?.cargo === 'supervisor')
        await db.query('update core.usuario set equipe_id = $2 where id = $1', [pessoaId, id]);
    return id;
}
/**
 * Põe o usuário na equipe do cargo (contrato da 0069), na mesma transação do cadastro: vendedor na equipe do supervisor; promotor na
 * do supervisor ou, sem ele, na do gerente; supervisor chefia a equipe dele (nome informado, filha da do gerente); gerente com nome
 * de equipe chefia a dele (sem equipe-pai). Administrativo sai de equipe. Devolve o `equipe_id` final.
 */
export async function posicionarNaEquipe(db, usuarioId, cargo, h, equipeAtual) {
    const responsavel = responsavelDaEquipe(cargo, h);
    let equipe = equipeAtual;
    if (responsavel)
        equipe = await garantirEquipeDe(db, responsavel);
    else if ((cargo === 'supervisor' && h.gerente_id && h.equipe_nome) || (cargo === 'gerente' && h.equipe_nome)) {
        const pai = cargo === 'supervisor' && h.gerente_id ? await garantirEquipeDe(db, h.gerente_id) : null;
        const dele = equipeChefiadaPor(await equipesChefiadas(db, usuarioId), usuarioId);
        if (dele) {
            await db.query('update core.equipe set nome = $2, equipe_pai_id = $3 where id = $1', [dele.id, h.equipe_nome, pai]);
            equipe = dele.id;
        }
        else {
            const r = await db.query('insert into core.equipe (tenant_id, nome, equipe_pai_id, responsavel_id) values (plataforma.tenant_atual(), $1, $2, $3) returning id', [h.equipe_nome, pai, usuarioId]);
            equipe = r.rows[0].id;
        }
    }
    else if (cargo === 'administrativo')
        equipe = null;
    if (equipe !== equipeAtual)
        await db.query('update core.usuario set equipe_id = $2 where id = $1', [usuarioId, equipe]);
    return equipe;
}
/** Os dois erros da 0069 no COMMIT (23514) viram 422 com a frase da tela; o resto segue. */
export function erroDaHierarquiaNoBanco(e) {
    const x = e;
    if (x?.code !== '23514')
        return null;
    if (x.constraint === 'promotor_sem_gerente')
        return new ErroRegraNegocio(CODIGOS_HIERARQUIA.gerenteObrigatorio, MENSAGENS_HIERARQUIA.gerenteObrigatorio, { regra: 'RN-CORE-56', campo: 'gerente_id' });
    if (x.constraint === 'promotor_gerente_do_supervisor')
        return new ErroRegraNegocio(CODIGOS_HIERARQUIA.gerenteDoSupervisor, MENSAGENS_HIERARQUIA.gerenteDoSupervisor, { regra: 'RN-CORE-56', campo: 'gerente_id' });
    return null;
}
