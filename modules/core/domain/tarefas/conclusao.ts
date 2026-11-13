/**
 * Conclusão da tarefa (desenho `docs/desenho/tarefas-consultor.md` §5; RN-CORE-TAR-03, 05, 06 e 08; decisões D3, D4 e D5).
 * `decidirConclusao` é o `receber` do push `tarefa_conclusao`: cada consultor conclui só a sua linha (D3) e a foto não exige
 * check-in no cliente (D5: a tarefa pode ser feita fora da visita). `desmarcarTarefa` é o desfazer do app: só enquanto a
 * conclusão está na fila, sem ter subido (D4).
 */
import { ERROS_TAREFA, TAREFA_FOTOS_MAX, type ConclusaoTarefa, type TipoTarefa } from '../../contracts/tarefa';

/** O que a regra precisa da linha de `core.tarefa_destinatario` (com o tipo e o cancelamento da tarefa). */
export interface LinhaParaConcluir {
  id: string;
  usuario_id: string;
  tipo: TipoTarefa;
  concluida_em: string | null;
  cancelada_em: string | null;
}

export type DecisaoConclusao =
  | { acao: 'recusar'; codigo: typeof ERROS_TAREFA.naoEncontrada | typeof ERROS_TAREFA.pesquisa | typeof ERROS_TAREFA.foto }
  /** Aceito sem gravar: reenvio do mesmo comando ou linha já concluída (vale a primeira conclusão). */
  | { acao: 'nada' }
  /** `suspeita`: relógio do aparelho mais de 24 h adiantado; `conta = false`: tarefa já cancelada (guardada, fora dos números). */
  | { acao: 'gravar'; suspeita: boolean; conta: boolean };

/** RN-CORE-TAR-06 e RN-CORE-42: relógio do aparelho mais adiantado que isso em relação ao servidor (a mesma da RN-PES-04). */
export const TOLERANCIA_RELOGIO_ADIANTADO_MS = 24 * 60 * 60 * 1000;

export function decidirConclusao(linha: LinhaParaConcluir | null, cmd: ConclusaoTarefa, ctx: { usuario_id: string; agora: Date }): DecisaoConclusao {
  // Linha de outro consultor = mesma resposta de linha inexistente (não revela que existe).
  if (!linha || linha.id !== cmd.tarefa_destinatario_id || linha.usuario_id !== ctx.usuario_id) return { acao: 'recusar', codigo: ERROS_TAREFA.naoEncontrada };
  if (linha.concluida_em) return { acao: 'nada' };
  if (linha.tipo === 'pesquisa') return { acao: 'recusar', codigo: ERROS_TAREFA.pesquisa };
  const fotos = new Set(cmd.foto_ids);
  const fotosOk = linha.tipo === 'foto' ? fotos.size >= 1 && fotos.size <= TAREFA_FOTOS_MAX && fotos.size === cmd.foto_ids.length : fotos.size === 0;
  if (!fotosOk) return { acao: 'recusar', codigo: ERROS_TAREFA.foto };
  return { acao: 'gravar', suspeita: Date.parse(cmd.concluida_em) - ctx.agora.getTime() > TOLERANCIA_RELOGIO_ADIANTADO_MS, conta: linha.cancelada_em === null };
}

/** Item da fila do motor (ou aceito ainda não coberto pelo pull), como a sobreposição o entrega (ADR 0009 §3). */
export interface ItemFilaTarefa {
  id: string;
  entidade: string;
  payload: unknown;
  /** `pendente`, `falhou`, `modulo_inativo` (na fila) ou `aceito` (já subiu). */
  situacao?: string;
}

export const ENTIDADE_CONCLUSAO = 'tarefa_conclusao';

/** Itens de conclusão da linha `tarefaDestinatarioId`, na ordem da fila. */
export function conclusoesDaLinha(fila: readonly ItemFilaTarefa[], tarefaDestinatarioId: string): ItemFilaTarefa[] {
  return fila.filter((i) => i.entidade === ENTIDADE_CONCLUSAO && (i.payload as Partial<ConclusaoTarefa> | null)?.tarefa_destinatario_id === tarefaDestinatarioId);
}

export type ResultadoDesmarcar = { ok: true; descartar: string[] } | { ok: false; motivo: 'ja_sincronizada' | 'nao_marcada' };

/** D4: desmarcar descarta os comandos de conclusão ainda na fila; depois que o servidor aceitou, não há desfazer no app. */
export function desmarcarTarefa(linha: { id: string; concluida_em: string | null }, fila: readonly ItemFilaTarefa[]): ResultadoDesmarcar {
  const itens = conclusoesDaLinha(fila, linha.id);
  if (linha.concluida_em || itens.some((i) => i.situacao === 'aceito')) return { ok: false, motivo: 'ja_sincronizada' };
  if (itens.length === 0) return { ok: false, motivo: 'nao_marcada' };
  return { ok: true, descartar: itens.map((i) => i.id) };
}
