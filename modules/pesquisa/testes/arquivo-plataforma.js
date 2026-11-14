/**
 * Apoio dos testes de banco da Pesquisa (não faz parte do módulo em produção): simula, contra o Postgres real, o que a
 * plataforma faz em `tx.registrarArquivo` (ADR 0010; versão real em apps/api/src/outbox.ts) e confere as linhas de
 * `plataforma.arquivo`. Fica fora de `api/` de propósito: o módulo nunca lê nem grava tabela de outro schema (regra 1);
 * só o teste precisa da linha do arquivo, porque `pesquisa.resposta_foto` tem FK para ela.
 */
import { CODIGOS_ARQUIVO, ErroHttpModulo } from '@macuxi/platform-sdk';
/** Mesma regra da real: idempotente pelo id; foto de outro registro ou de outro usuário = 409 ARQUIVO_JA_REFERENCIADO. */
export async function registrarArquivoSimulado(c, usuarioId, a) {
    const r = await c.query(`insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por, tipo)
     values ($1, plataforma.tenant_atual(), 'pesquisa', $2, $3, $4, $5, $6, 'image/jpeg') on conflict (id) do nothing`, [a.id, a.finalidade, a.entidade, a.entidade_id, a.cliente_id ?? null, usuarioId]);
    if (r.rowCount)
        return { criado: true };
    const atual = (await c.query('select entidade_id, enviado_por from plataforma.arquivo where id = $1', [a.id])).rows[0];
    if (atual && atual.entidade_id === a.entidade_id && atual.enviado_por === usuarioId)
        return { criado: false };
    throw new ErroHttpModulo(409, CODIGOS_ARQUIVO.jaReferenciado, 'Esta foto já está ligada a outro registro. Tire a foto de novo.');
}
export async function contarArquivos(c, id) {
    return Number((await c.query('select count(*) as n from plataforma.arquivo where id = $1', [id])).rows[0].n);
}
export async function lerArquivo(c, id) {
    return (await c.query('select finalidade, entidade, entidade_id, cliente_id, enviado_por, modulo from plataforma.arquivo where id = $1', [id])).rows;
}
