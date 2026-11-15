import { TOLERANCIA_RELOGIO_ADIANTADO_MS } from '../tarefas/conclusao';
function instante(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t))
        throw new RangeError(`Horário inválido: ${iso}.`);
    return t;
}
/**
 * Decide uma troca recebida. `viva` = a linha viva do usuário (ou `null` = iniciais); `idsGravados` = ids de trocas desse
 * usuário que já estão no banco (vivas ou apagadas), para a idempotência.
 */
export function aplicarTrocaAvatar(viva, idsGravados, troca, ctx) {
    if (troca.usuario_id !== ctx.usuario_id && !ctx.pode_trocar_outro)
        return { acao: 'recusar', codigo: 'FORA_DO_ESCOPO' };
    if (viva && viva.usuario_id !== troca.usuario_id)
        throw new RangeError('A escolha viva é de outro usuário.');
    if (idsGravados.includes(troca.id) || viva?.id === troca.id)
        return { acao: 'nada' };
    const agora = ctx.agora.getTime();
    const alterado = instante(troca.alterado_em) - agora > TOLERANCIA_RELOGIO_ADIANTADO_MS ? ctx.agora.toISOString() : troca.alterado_em;
    if (viva && instante(viva.alterado_em) > instante(alterado))
        return { acao: 'gravar_superada', alterado_em: alterado };
    return { acao: 'substituir', alterado_em: alterado, apagar_id: viva?.id ?? null, apagar_arquivo_id: viva?.tipo === 'foto' ? viva.arquivo_id : null };
}
/** O que mostrar para `usuarioId`: a viva de maior `alterado_em` (o banco garante uma só); sem viva = iniciais. */
export function escolhaAtual(linhas, usuarioId) {
    let atual = null;
    for (const l of linhas) {
        if (l.usuario_id !== usuarioId || l.deleted_at)
            continue;
        if (!atual || instante(l.alterado_em) > instante(atual.alterado_em))
            atual = l;
    }
    if (atual?.tipo === 'avatar' && atual.avatar_codigo)
        return { tipo: 'avatar', avatar_codigo: atual.avatar_codigo };
    if (atual?.tipo === 'foto' && atual.arquivo_id)
        return { tipo: 'foto', arquivo_id: atual.arquivo_id };
    return { tipo: 'iniciais' };
}
