/**
 * Tela "Recados e tarefas" (RF-CORE-09 e RF-CORE-18; RN-CORE-TAR-07; desenho `docs/desenho/tarefas-consultor.md` §2.2 e
 * §7.2). Função pura, no aparelho e offline: junta as notificações (já com a leitura da fila aplicada por `montarCaixa`) e as
 * tarefas do pull `tarefa`, com as conclusões da fila sobrepostas (ADR 0009 §3).
 * - cada tarefa vira um item; o aviso dela (`subtipo = 'tarefa'`) não aparece: só marca a tarefa como nova até ser lido;
 * - as outras notificações aparecem como hoje;
 * - ordem: abertas e não lidas do mais novo para o mais antigo; recados lidos; feitas; canceladas.
 */
import { localDate } from '@macuxi/comum/calendar';
import { SUBTIPO_NOTIFICACAO_TAREFA, type ConclusaoTarefa, type SituacaoTarefa, type TarefaSync } from '../../contracts/tarefa';
import { conclusoesDaLinha, type ItemFilaTarefa } from './conclusao';
import { situacaoTarefa } from './situacao';

/** O que a lista precisa de uma notificação (a `NotificacaoLocal` de `montarCaixa` serve). */
export interface NotificacaoDaLista {
  id: string;
  updated_at: string;
  lida_em?: string | null;
  subtipo?: string | null;
  tarefa_id?: string | null;
}

export type ItemRecadosETarefas<N extends NotificacaoDaLista = NotificacaoDaLista> =
  | { tipo: 'recado'; id: string; notificacao: N }
  | {
      tipo: 'tarefa';
      id: string;
      /** A linha do pull com a conclusão da fila sobreposta. */
      tarefa: TarefaSync;
      situacao: SituacaoTarefa;
      /** Ponto laranja: aviso ainda não lido e tarefa não feita. */
      nova: boolean;
      /** Notificação a marcar como lida ao abrir ou concluir. */
      aviso_id: string | null;
      /** Conclusão só na fila (ainda não subiu): o app pode desmarcar (D4). */
      conclusao_pendente: boolean;
    };

export interface OpcoesLista {
  agora: Date;
  fuso: string;
  /** Pesquisa efetiva para o usuário; `false` deixa a tarefa de pesquisa "sem módulo" (RN-CORE-TAR-11). Ausente = ativa. */
  pesquisa_ativa?: boolean;
}

const FEITAS: readonly SituacaoTarefa[] = ['feita_no_prazo', 'feita_com_atraso'];

function grupo(item: ItemRecadosETarefas): number {
  if (item.tipo === 'recado') return item.notificacao.lida_em ? 1 : 0;
  if (item.situacao === 'cancelada') return 3;
  return FEITAS.includes(item.situacao) ? 2 : 0;
}

/** Instante que ordena dentro do grupo: a notificação pela atualização; a feita pela conclusão; a cancelada pelo cancelamento. */
function quando(item: ItemRecadosETarefas): number {
  if (item.tipo === 'recado') return Date.parse(item.notificacao.updated_at);
  return Date.parse((item.situacao === 'cancelada' ? item.tarefa.cancelada_em : item.tarefa.concluida_em) ?? item.tarefa.updated_at);
}

export function montarRecadosETarefas<N extends NotificacaoDaLista>(
  notificacoes: readonly N[],
  tarefas: readonly TarefaSync[],
  fila: readonly ItemFilaTarefa[],
  opcoes: OpcoesLista,
): ItemRecadosETarefas<N>[] {
  const hoje = localDate(opcoes.agora, opcoes.fuso);
  const avisos = new Map<string, N>();
  const recados: ItemRecadosETarefas<N>[] = [];
  for (const n of notificacoes) {
    if (n.subtipo === SUBTIPO_NOTIFICACAO_TAREFA) {
      if (n.tarefa_id && !avisos.has(n.tarefa_id)) avisos.set(n.tarefa_id, n);
    } else recados.push({ tipo: 'recado', id: n.id, notificacao: n });
  }

  const itensTarefa = tarefas
    .filter((t) => !t.deleted_at)
    .map((linha): ItemRecadosETarefas<N> => {
      const naFila = linha.concluida_em ? undefined : conclusoesDaLinha(fila, linha.id)[0];
      const concluidaNaFila = (naFila?.payload as Partial<ConclusaoTarefa> | undefined)?.concluida_em;
      const tarefa = concluidaNaFila ? { ...linha, concluida_em: concluidaNaFila } : linha;
      const moduloAtivo = tarefa.tipo === 'pesquisa' ? opcoes.pesquisa_ativa : undefined;
      const situacao = situacaoTarefa(tarefa, { hoje, fuso: opcoes.fuso, modulo_ativo: moduloAtivo });
      const aviso = avisos.get(tarefa.tarefa_id) ?? null;
      return {
        tipo: 'tarefa',
        id: tarefa.id,
        tarefa,
        situacao,
        nova: !!aviso && !aviso.lida_em && !FEITAS.includes(situacao) && situacao !== 'cancelada',
        aviso_id: aviso?.id ?? null,
        conclusao_pendente: !!concluidaNaFila && naFila?.situacao !== 'aceito',
      };
    });

  return [...recados, ...itensTarefa].sort((a, b) => grupo(a) - grupo(b) || quando(b) - quando(a) || a.id.localeCompare(b.id));
}
