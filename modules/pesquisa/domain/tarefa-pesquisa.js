import { equipeNoPublico, perfilNoPublico, vigenteEm } from './publico';
import { versaoVigente } from './questionario';
import { instanteMs } from './util';
/**
 * RN-PES-01/02 e RF-PES-02: questionários com versão vigente (publicada de maior número, não arquivado) e dentro da vigência
 * agora; para cada um, os usuários cujo perfil ou equipe (valem juntos) estão fora do público. Cliente não entra: a tarefa
 * ainda não tem cliente. Falha para o lado de não bloquear: atributo desconhecido não marca ninguém.
 */
export function questionariosParaTarefa(pesquisas, usuarios, agora) {
    const saida = [];
    for (const p of pesquisas) {
        const v = versaoVigente(p.questionario, p.versoes);
        if (!v || !vigenteEm(v.vigencia, agora))
            continue;
        const fora = usuarios
            .filter((u) => (u.perfil !== null && !perfilNoPublico(v.publico_alvo, { perfil: u.perfil })) || (u.equipe_ids !== null && !equipeNoPublico(v.publico_alvo, { equipe_ids: u.equipe_ids })))
            .map((u) => u.id);
        saida.push({ questionario_id: p.questionario.id, titulo: v.titulo, vigente_ate: v.vigencia.fim, fora_do_publico: fora });
    }
    return saida;
}
/** RN-PES-02: a resposta mais recente do questionário (e do cliente, se informado) a partir de `desde` (inclusive); empate pelo maior id. */
export function respostaLocalMaisRecente(respostas, filtro) {
    const limite = instanteMs(filtro.desde);
    let melhor = null;
    for (const r of respostas) {
        if (r.questionario_id !== filtro.questionario_id)
            continue;
        if (filtro.cliente_id !== null && r.cliente_id !== filtro.cliente_id)
            continue;
        const t = instanteMs(r.respondida_em);
        if (t < limite)
            continue;
        if (melhor === null || t > melhor.t || (t === melhor.t && r.id > melhor.id))
            melhor = { id: r.id, t };
    }
    return melhor?.id ?? null;
}
/**
 * RN-PES-02: respostas do PRÓPRIO usuário que o aparelho conhece para `resposta_local@1` — linhas do pull (sem as
 * apagadas e só as do usuário; o pull traz respostas de outros na carteira) mais as da fila (sempre do aparelho).
 * O id repetido vale uma vez.
 */
export function respostasLocaisDoUsuario(linhas, fila, usuarioId) {
    const vistos = new Set();
    const saida = [];
    const quero = (r) => {
        if (vistos.has(r.id))
            return;
        vistos.add(r.id);
        saida.push({ id: r.id, questionario_id: r.questionario_id, cliente_id: r.cliente_id, respondida_em: r.respondida_em });
    };
    for (const l of linhas)
        if (l.deleted_at === null && l.usuario_id === usuarioId)
            quero(l);
    for (const f of fila)
        quero(f);
    return saida;
}
