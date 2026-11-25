/**
 * Tela "Recados e tarefas" (RF-CORE-09 e RF-CORE-18; RN-CORE-TAR-07; desenho `docs/desenho/tarefas-consultor.md` §2.2 e
 * §7.2). Função pura, no aparelho e offline: junta as notificações (já com a leitura da fila aplicada por `montarCaixa`) e as
 * tarefas do pull `tarefa`, com as conclusões da fila sobrepostas (ADR 0009 §3).
 * - cada tarefa vira um item; o aviso dela (`subtipo = 'tarefa'`) não aparece: só marca a tarefa como nova até ser lido;
 * - as outras notificações aparecem como hoje;
 * - ordem: abertas e não lidas do mais novo para o mais antigo; recados lidos; feitas; canceladas.
 */
import { localDate } from '@macuxi/comum/calendar';
import { SUBTIPO_NOTIFICACAO_TAREFA } from '../../contracts/tarefa';
import { conclusoesDaLinha } from './conclusao';
import { situacaoTarefa } from './situacao';
/** Fonte única de "tarefa a fazer" (RN-CORE-TAR-07): é ela que o ponto laranja, o contador do sino e o balão usam. */
export function tarefaAFazer(situacao) {
    return situacao === 'aberta' || situacao === 'atrasada';
}
const FEITAS = ['feita_no_prazo', 'feita_com_atraso'];
function grupo(item) {
    if (item.tipo === 'recado')
        return item.notificacao.lida_em ? 1 : 0;
    if (item.situacao === 'cancelada')
        return 3;
    return FEITAS.includes(item.situacao) ? 2 : 0;
}
/** Instante que ordena dentro do grupo: a notificação pela atualização; a feita pela conclusão; a cancelada pelo cancelamento. */
function quando(item) {
    if (item.tipo === 'recado')
        return Date.parse(item.notificacao.updated_at);
    return Date.parse((item.situacao === 'cancelada' ? item.tarefa.cancelada_em : item.tarefa.concluida_em) ?? item.tarefa.updated_at);
}
export function montarRecadosETarefas(notificacoes, tarefas, fila, opcoes) {
    const hoje = localDate(opcoes.agora, opcoes.fuso);
    const avisos = new Map();
    const recados = [];
    for (const n of notificacoes) {
        if (n.subtipo === SUBTIPO_NOTIFICACAO_TAREFA) {
            if (n.tarefa_id && !avisos.has(n.tarefa_id))
                avisos.set(n.tarefa_id, n);
        }
        else
            recados.push({ tipo: 'recado', id: n.id, notificacao: n });
    }
    const itensTarefa = tarefas
        .filter((t) => !t.deleted_at)
        .map((linha) => {
        const naFila = linha.concluida_em ? undefined : conclusoesDaLinha(fila, linha.id)[0];
        const concluidaNaFila = naFila?.payload?.concluida_em;
        const tarefa = concluidaNaFila ? { ...linha, concluida_em: concluidaNaFila } : linha;
        const moduloAtivo = tarefa.tipo === 'pesquisa' ? opcoes.pesquisa_ativa : undefined;
        const situacao = situacaoTarefa(tarefa, { hoje, fuso: opcoes.fuso, modulo_ativo: moduloAtivo });
        const aviso = avisos.get(tarefa.tarefa_id) ?? null;
        return {
            tipo: 'tarefa',
            id: tarefa.id,
            tarefa,
            situacao,
            nova: !!aviso && !aviso.lida_em && tarefaAFazer(situacao),
            aviso_id: aviso?.id ?? null,
            conclusao_pendente: !!concluidaNaFila && naFila?.situacao !== 'aceito',
        };
    });
    return [...recados, ...itensTarefa].sort((a, b) => grupo(a) - grupo(b) || quando(b) - quando(a) || a.id.localeCompare(b.id));
}
