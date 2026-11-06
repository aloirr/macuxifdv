/**
 * Consulta que o Promotor oferece a outros módulos (ADR 0012, ADR 0027 revisada): `promotor.concorrentes@1`.
 * O Promotor é dono do cadastro de concorrentes/marcas (RF-PRO-11). O Catálogo guarda `marca_id` = `concorrente.id` na
 * referência cruzada (RN-CAT-09), sem FK entre schemas, e lê nome e situação por esta consulta. Só leitura; vale a
 * licença do módulo de quem consulta (sem Promotor no tenant, a consulta fica indisponível).
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Id } from '@macuxi/core/contracts';

/** Formato de UUID (a consulta faz `::uuid` no SQL; id fora do formato seria erro 500, então a validação recusa antes). */
const IdUuid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

export const ConcorrentesEntradaSchema = z
  .object({
    /** Até 500 ids por chamada. Ausente = todos os concorrentes do tenant (filtrados pelos demais campos). */
    ids: z.array(IdUuid).max(500).optional(),
    /** Trecho do nome (sem diferenciar caixa), até 120 caracteres. Ausente ou vazio = sem filtro de nome. */
    busca: z.string().trim().max(120).optional(),
    /** Padrão `false`: só ativos. Com `true`, devolve também os inativos (para exibir referência antiga). */
    incluir_inativos: z.boolean().default(false),
  })
  .strict();
export type ConcorrentesEntrada = z.infer<typeof ConcorrentesEntradaSchema>;

export const ConcorrenteResumoSchema = z.object({
  id: Id,
  nome: z.string(),
  ativo: z.boolean(),
  external_id: z.string().nullable(),
});
export type ConcorrenteResumo = z.infer<typeof ConcorrenteResumoSchema>;

export const ConcorrentesSaidaSchema = z.object({
  /** Ordenados por nome (sem diferenciar caixa) e id. Id inexistente (ou apagado) simplesmente não aparece. */
  concorrentes: z.array(ConcorrenteResumoSchema),
});
export type ConcorrentesSaida = z.infer<typeof ConcorrentesSaidaSchema>;

export const CONSULTA_CONCORRENTES = definirConsulta({
  nome: 'promotor.concorrentes@1',
  entrada: ConcorrentesEntradaSchema,
  saida: ConcorrentesSaidaSchema,
});
