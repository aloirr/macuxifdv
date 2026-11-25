/**
 * Conclusão da tarefa (desenho `docs/desenho/tarefas-consultor.md` §5; RN-CORE-TAR-03, 05, 06 e 08; decisões D3, D4 e D5).
 * `decidirConclusao` é o `receber` do push `tarefa_conclusao`: cada consultor conclui só a sua linha (D3) e a foto não exige
 * check-in no cliente (D5: a tarefa pode ser feita fora da visita). `desmarcarTarefa` é o desfazer do app: só enquanto a
 * conclusão está na fila, sem ter subido (D4).
 */
import { ERROS_TAREFA, TAREFA_FOTOS_MAX } from '../../contracts/tarefa';
/** RN-CORE-TAR-06 e RN-CORE-42: relógio do aparelho mais adiantado que isso em relação ao servidor (a mesma da RN-PES-04). */
export const TOLERANCIA_RELOGIO_ADIANTADO_MS = 24 * 60 * 60 * 1000;
export function decidirConclusao(linha, cmd, ctx) {
    // Linha de outro consultor = mesma resposta de linha inexistente (não revela que existe).
    if (!linha || linha.id !== cmd.tarefa_destinatario_id || linha.usuario_id !== ctx.usuario_id)
        return { acao: 'recusar', codigo: ERROS_TAREFA.naoEncontrada };
    if (linha.concluida_em)
        return { acao: 'nada' };
    if (linha.tipo === 'pesquisa')
        return { acao: 'recusar', codigo: ERROS_TAREFA.pesquisa };
    const fotos = new Set(cmd.foto_ids);
    const fotosOk = linha.tipo === 'foto' ? fotos.size >= 1 && fotos.size <= TAREFA_FOTOS_MAX && fotos.size === cmd.foto_ids.length : fotos.size === 0;
    if (!fotosOk)
        return { acao: 'recusar', codigo: ERROS_TAREFA.foto };
    return { acao: 'gravar', suspeita: Date.parse(cmd.concluida_em) - ctx.agora.getTime() > TOLERANCIA_RELOGIO_ADIANTADO_MS, conta: linha.cancelada_em === null };
}
export const ENTIDADE_CONCLUSAO = 'tarefa_conclusao';
/** Itens de conclusão da linha `tarefaDestinatarioId`, na ordem da fila. */
export function conclusoesDaLinha(fila, tarefaDestinatarioId) {
    return fila.filter((i) => i.entidade === ENTIDADE_CONCLUSAO && i.payload?.tarefa_destinatario_id === tarefaDestinatarioId);
}
/** D4: desmarcar descarta os comandos de conclusão ainda na fila; depois que o servidor aceitou, não há desfazer no app. */
export function desmarcarTarefa(linha, fila) {
    const itens = conclusoesDaLinha(fila, linha.id);
    if (linha.concluida_em || itens.some((i) => i.situacao === 'aceito'))
        return { ok: false, motivo: 'ja_sincronizada' };
    if (itens.length === 0)
        return { ok: false, motivo: 'nao_marcada' };
    return { ok: true, descartar: itens.map((i) => i.id) };
}
