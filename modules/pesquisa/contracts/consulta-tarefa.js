/**
 * Consultas que a Pesquisa oferece ao Core para a tarefa de pesquisa (T-0170, ADR 0012 / ADR 0019):
 * - `pesquisa.questionarios_para_tarefa@1` (API): questionários vigentes do tenant e quem está fora do público;
 * - `pesquisa.resposta_local@1` (aparelho): a resposta local mais recente, para mostrar "Respondida" antes de sincronizar.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { InstanteUtc, TextoCurto, Uuid } from './base';
export const QuestionariosParaTarefaEntradaSchema = z.object({ usuario_ids: z.array(Uuid).min(1).max(500) }).strict();
export const QuestionariosParaTarefaSaidaSchema = z.array(z
    .object({
    questionario_id: Uuid,
    titulo: TextoCurto,
    vigente_ate: InstanteUtc.nullable(),
    fora_do_publico: z.array(Uuid),
})
    .strict());
export const CONSULTA_QUESTIONARIOS_PARA_TAREFA = definirConsulta({
    nome: 'pesquisa.questionarios_para_tarefa@1',
    entrada: QuestionariosParaTarefaEntradaSchema,
    saida: QuestionariosParaTarefaSaidaSchema,
});
export const RespostaLocalEntradaSchema = z
    .object({ questionario_id: Uuid, cliente_id: Uuid.nullable(), desde: InstanteUtc })
    .strict();
export const RespostaLocalSaidaSchema = z.object({ resposta_id: Uuid.nullable() }).strict();
export const CONSULTA_RESPOSTA_LOCAL = definirConsulta({
    nome: 'pesquisa.resposta_local@1',
    entrada: RespostaLocalEntradaSchema,
    saida: RespostaLocalSaidaSchema,
});
