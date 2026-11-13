/**
 * RN-CORE-TAR-02 (prazo e atraso), 08 (cancelamento), 10 (consultor desligado) e 11 (módulo desligado) — desenho
 * `docs/desenho/tarefas-consultor.md` §8. Função pura: o app calcula offline (relógio do aparelho, fuso do tenant) e o
 * servidor recalcula no acompanhamento do BKO. Quem chama passa `hoje` (data civil no fuso do tenant); nada é gravado.
 */
import { exigirDataCivil } from '@macuxi/comum/calendar';
import type { SituacaoTarefa } from '../../contracts/tarefa';
import { dataLocal } from '../checkin';

export interface LinhaSituacao {
  prazo: string;
  /** Hora do aparelho na conclusão (RN-CORE-TAR-06). */
  concluida_em: string | null;
  cancelada_em: string | null;
  /** Hora do servidor ao aceitar a conclusão; ausente no aparelho (vale `concluida_em`). */
  recebida_em?: string | null;
}

export interface ContextoSituacao {
  hoje: string;
  fuso: string;
  /** `false` = consultor desativado (RN-CORE-TAR-10). Ausente = ativo. */
  consultor_ativo?: boolean;
  /** `false` = tarefa de pesquisa com a Pesquisa desligada para o tenant ou o usuário (RN-CORE-TAR-11). Ausente = ativo. */
  modulo_ativo?: boolean;
}

export function situacaoTarefa(l: LinhaSituacao, ctx: ContextoSituacao): SituacaoTarefa {
  exigirDataCivil(l.prazo);
  exigirDataCivil(ctx.hoje);
  const chegou = l.recebida_em ?? l.concluida_em;
  // RN-CORE-TAR-08: conclusão que chegou depois do cancelamento não conta.
  if (l.cancelada_em && !(chegou && Date.parse(chegou) <= Date.parse(l.cancelada_em))) return 'cancelada';
  if (l.concluida_em) return dataLocal(l.concluida_em, ctx.fuso) <= l.prazo ? 'feita_no_prazo' : 'feita_com_atraso';
  if (ctx.consultor_ativo === false) return 'sem_consultor_ativo';
  if (ctx.modulo_ativo === false) return 'sem_modulo';
  return ctx.hoje > l.prazo ? 'atrasada' : 'aberta';
}

/** RN-CORE-TAR-02 e 09: na criação e na edição, o prazo é hoje ou depois (data civil no fuso do tenant). Falso = 422 `RN-CORE-TAR-02`. */
export function prazoAceito(prazo: string, hoje: string): boolean {
  return exigirDataCivil(prazo) >= exigirDataCivil(hoje);
}
