/**
 * RN-CORE-TAR-07: aviso da tarefa ao consultor (desenho `docs/desenho/tarefas-consultor.md` §2.2). É uma `core.notificacao`
 * por destinatário, gravada na mesma transação da tarefa, com `tipo = 'sistema'` e `subtipo = 'tarefa'`: o APK v1.0.5 mostra
 * "Aviso do sistema · Nova tarefa: …" e não quebra. Texto indicativo; o final é do designer-ux.
 */
import { SUBTIPO_NOTIFICACAO_TAREFA, TAREFA_TITULO_MAX, TIPO_NOTIFICACAO_TAREFA } from '../../contracts/tarefa';

export interface AvisoTarefa {
  tipo: typeof TIPO_NOTIFICACAO_TAREFA;
  subtipo: typeof SUBTIPO_NOTIFICACAO_TAREFA;
  tarefa_id: string;
  titulo: string;
  corpo: string;
  prioridade: 'normal';
}

/** O título da notificação tem o mesmo teto do título da tarefa (120). */
function cortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

export function avisoDaTarefa(tarefa: { id: string; titulo: string; prazo: string }): AvisoTarefa {
  const [ano, mes, dia] = tarefa.prazo.split('-');
  return {
    tipo: TIPO_NOTIFICACAO_TAREFA,
    subtipo: SUBTIPO_NOTIFICACAO_TAREFA,
    tarefa_id: tarefa.id,
    titulo: cortar(`Nova tarefa: ${tarefa.titulo}`, TAREFA_TITULO_MAX),
    corpo: `Prazo: ${dia}/${mes}/${ano}`,
    prioridade: 'normal',
  };
}
