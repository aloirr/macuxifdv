/**
 * Eventos das tarefas do consultor (T-0170; desenho `docs/desenho/tarefas-consultor.md` §4.2). Sem título nem descrição no
 * payload (dado pessoal fica no banco). PROVISÓRIO neste arquivo: a costura do PC move as 3 definições para
 * `contracts/eventos.ts`, acrescenta os nomes em `publica` do manifesto e registra em `.coord/contratos/eventos.md`.
 */
import { definirEvento } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { TAREFA_DESTINATARIOS_MAX, TIPOS_TAREFA } from '../contracts/tarefa';

const Uuid = z.string().uuid();

export const TarefaCriadaSchema = z.object({
  tarefa_id: Uuid,
  autor_id: Uuid,
  tipo: z.enum(TIPOS_TAREFA),
  cliente_id: Uuid.nullable(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  usuario_ids: z.array(Uuid).max(TAREFA_DESTINATARIOS_MAX),
  criada_em: z.string().datetime(),
});
export const EVENTO_TAREFA_CRIADA = definirEvento('core.tarefa.criada@1', TarefaCriadaSchema);

export const TarefaConcluidaSchema = z.object({
  tarefa_id: Uuid,
  tarefa_destinatario_id: Uuid,
  usuario_id: Uuid,
  cliente_id: Uuid.nullable(),
  tipo: z.enum(TIPOS_TAREFA),
  concluida_em: z.string().datetime(),
  recebida_em: z.string().datetime(),
  no_prazo: z.boolean(),
  fotos_total: z.number().int().min(0),
  resposta_id: Uuid.nullable(),
  suspeita: z.boolean(),
});
export const EVENTO_TAREFA_CONCLUIDA = definirEvento('core.tarefa.concluida@1', TarefaConcluidaSchema);

export const TarefaCanceladaSchema = z.object({
  tarefa_id: Uuid,
  cancelada_por: Uuid,
  cancelada_em: z.string().datetime(),
  abertas_no_cancelamento: z.number().int().min(0),
});
export const EVENTO_TAREFA_CANCELADA = definirEvento('core.tarefa.cancelada@1', TarefaCanceladaSchema);
