import { escopoDeUsuarios } from './clientes';
export function podeEditarMetaDe(e) {
    if (e.perfil !== 'supervisor' && e.perfil !== 'gerente' && e.perfil !== 'analista' && e.perfil !== 'admin') {
        return { ok: false, codigo: 'META_SEM_PERMISSAO', mensagem: 'Seu perfil só consulta metas. Peça a um supervisor ou gerente para definir.' };
    }
    const escopo = escopoDeUsuarios(e.perfil, { proprio: e.editorId, equipe: e.equipe, equipesAbaixo: e.equipesAbaixo });
    if (escopo === 'tenant' || escopo.has(e.alvoId))
        return { ok: true };
    return { ok: false, codigo: 'META_FORA_DA_EQUIPE', mensagem: 'Este usuário não está na sua equipe. Escolha alguém da sua equipe para definir a meta.' };
}
/** Alvos válidos de uma meta por equipe: usuários ativos de perfil vendedor ou promotor, sem repetição. */
export function expandirEquipe(membros) {
    const vistos = new Set();
    for (const m of membros)
        if (m.ativo && (m.perfil === 'vendedor' || m.perfil === 'promotor'))
            vistos.add(m.id);
    return [...vistos];
}
/** Metas do mês anterior que entram no mês de destino: só as que ainda não existem lá (usuário + indicador) e com valor > 0. */
export function copiarMetas(anterior, destino) {
    const existentes = new Set(destino.map((d) => `${d.usuario_id}|${d.indicador}`));
    return anterior.filter((a) => a.valor > 0 && !existentes.has(`${a.usuario_id}|${a.indicador}`));
}
