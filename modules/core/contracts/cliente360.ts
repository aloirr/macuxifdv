/** Cliente 360 (desenho T-0016 §3.1): resposta online e resumos calculados pelo domínio (igual no app offline). */
import { z } from 'zod';
import {
  ClienteContatoSyncSchema,
  ClienteFinanceiroSyncSchema,
  ClienteSyncSchema,
  HistoricoCompraSyncSchema,
  TituloSyncSchema,
  VisitaSyncSchema,
} from './sync';

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ResumoComprasSchema = z.object({
  ultima_compra_em: Data.nullable(),
  dias_sem_compra: z.number().int().nullable(),
  ticket_medio_cents: z.number().int(),
  frequencia_media_dias: z.number().nullable(),
  total_12m_cents: z.number().int(),
});
export type ResumoCompras = z.infer<typeof ResumoComprasSchema>;

export const ResumoFinanceiroSchema = z.object({
  limite_cents: z.number().int(),
  saldo_aberto_cents: z.number().int(),
  credito_disponivel_cents: z.number().int(),
  bloqueado: z.boolean(),
  motivo_bloqueio: z.string().nullable(),
  vencidos_qtd: z.number().int(),
  vencidos_cents: z.number().int(),
  a_vencer_qtd: z.number().int(),
  a_vencer_cents: z.number().int(),
  maior_atraso_dias: z.number().int(),
});
export type ResumoFinanceiro = z.infer<typeof ResumoFinanceiroSchema>;

export const Cliente360Schema = z.object({
  cliente: ClienteSyncSchema,
  contatos: z.array(ClienteContatoSyncSchema),
  financeiro: ClienteFinanceiroSyncSchema.nullable(),
  titulos: z.array(TituloSyncSchema),
  historico: z.array(HistoricoCompraSyncSchema),
  resumo_compras: ResumoComprasSchema,
  resumo_financeiro: ResumoFinanceiroSchema.nullable(),
  ultimas_visitas: z.array(VisitaSyncSchema).max(5),
});
export type Cliente360 = z.infer<typeof Cliente360Schema>;
