/** Cliente 360 (desenho T-0016 §3.1): resposta online e resumos calculados pelo domínio (igual no app offline). */
import { z } from 'zod';
import { ClienteContatoSyncSchema, ClienteEnderecoSyncSchema, ClienteFinanceiroSyncSchema, ClienteSyncSchema, HistoricoCompraSyncSchema, TituloSyncSchema, VisitaSyncSchema, } from './sync';
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ResumoComprasSchema = z.object({
    ultima_compra_em: Data.nullable(),
    dias_sem_compra: z.number().int().nullable(),
    ticket_medio_cents: z.number().int(),
    frequencia_media_dias: z.number().nullable(),
    total_12m_cents: z.number().int(),
});
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
export const Cliente360Schema = z.object({
    cliente: ClienteSyncSchema,
    contatos: z.array(ClienteContatoSyncSchema),
    financeiro: ClienteFinanceiroSyncSchema.nullable(),
    titulos: z.array(TituloSyncSchema),
    historico: z.array(HistoricoCompraSyncSchema),
    resumo_compras: ResumoComprasSchema,
    resumo_financeiro: ResumoFinanceiroSchema.nullable(),
    ultimas_visitas: z.array(VisitaSyncSchema).max(5),
    /** T-0061 (RF-CORE-12, RN-VEN-17): endereços ativos do cliente, o padrão primeiro. Opcional: o app antigo ignora. */
    enderecos: z.array(ClienteEnderecoSyncSchema).optional(),
    /** `id` do endereço padrão da entrega (principal; sem principal, o primeiro de entrega); `null` = sem endereço. */
    endereco_padrao_id: z.string().uuid().nullable().optional(),
});
/** T-0089 / RN-VEN-24: formas de pagamento ativas para a ficha do cliente (`GET /v1/core/formas-pagamento`). `null` = Vendedor desligado ou ausente: as formas ficam só leitura. */
export const FormasPagamentoDisponiveisSchema = z.object({ formas: z.array(z.object({ codigo: z.string(), nome: z.string() })).max(200).nullable() });
