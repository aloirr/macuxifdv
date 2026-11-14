import { versaoVigente } from './questionario';
/** RN-CORE-04: resultados só das respostas de usuários visíveis (supervisor: a equipe; gerente: as equipes abaixo; BKO: tenant). */
export function respostasNoEscopo(respostas, usuariosVisiveis) {
    if (usuariosVisiveis === 'tenant')
        return [...respostas];
    return respostas.filter((r) => usuariosVisiveis.has(r.usuario_id));
}
/**
 * RN-CORE-04 / RN-PES-02: o resumo de resposta que vai ao aparelho — as do próprio usuário e as de clientes da carteira
 * (a frequência conta por cliente, de qualquer usuário). Resposta sem cliente de outro usuário nunca vai.
 */
export function respostaNoEscopoDoAparelho(r, usuarioId, carteira) {
    if (r.usuario_id === usuarioId)
        return true;
    if (r.cliente_id === null)
        return false;
    return carteira === 'tenant' || carteira.has(r.cliente_id);
}
/** RF-PES-05: linha da lista do BKO. Título, modo e vigência são os da vigente; sem vigente, os da versão mais nova. */
export function resumirQuestionario(q, versoes, extra) {
    const vigente = versaoVigente({ arquivado_em: null }, versoes);
    const maisNova = versoes.reduce((a, b) => (a === null || b.numero > a.numero ? b : a), null);
    const base = vigente ?? maisNova;
    if (!base)
        throw new RangeError(`Questionário ${q.id} sem versão.`);
    return {
        id: q.id,
        titulo: base.titulo,
        modo: base.modo,
        situacao: q.arquivado_em !== null ? 'arquivado' : vigente ? 'publicada' : 'rascunho',
        versao_vigente: vigente?.numero ?? null,
        tem_rascunho: versoes.some((v) => v.status === 'rascunho'),
        vigencia: base.vigencia,
        respostas: extra.respostas,
        criado_em: q.criado_em,
        atualizado_em: extra.atualizado_em,
        arquivado_em: q.arquivado_em,
    };
}
const semAcento = (s) => s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
/** Filtros da lista (situação e busca no título); ordena do mais recente para o mais antigo. */
export function filtrarResumos(lista, f) {
    const q = f.q ? semAcento(f.q.trim()) : '';
    return lista
        .filter((r) => (f.situacao ? r.situacao === f.situacao : true))
        .filter((r) => (q ? semAcento(r.titulo).includes(q) : true))
        .sort((a, b) => (a.atualizado_em < b.atualizado_em ? 1 : a.atualizado_em > b.atualizado_em ? -1 : a.id < b.id ? -1 : 1));
}
