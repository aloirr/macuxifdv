/**
 * Entidades de sync do Core que o servidor serve (T-0003 Fase 2): `cliente`, `carteira`, `produto`.
 * São o formato de LINHA do pull (`GET /v1/sync/pull?entidade=…`): colunas do banco em snake_case, `updated_at`
 * UTC com microssegundos, `deleted_at` preenchido quando removida (o aparelho apaga). Somente leitura no aparelho
 * (`direcao: 'pull'`, `servidor_vence`): cadastro vem do ERP/BKO.
 * Mesma definição no app (`app/index.ts`) e na API (`api/sync.ts`) — o motor valida o schema dos dois lados.
 */
import { z } from 'zod';

const Base = {
  id: z.string().uuid(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

export const ClienteSyncSchema = z
  .object({
    ...Base,
    documento: z.string().nullable(),
    razao_social: z.string(),
    nome_fantasia: z.string().nullable(),
    segmento: z.string().nullable(),
    telefone: z.string().nullable(),
    email: z.string().nullable(),
    logradouro: z.string().nullable(),
    numero: z.string().nullable(),
    bairro: z.string().nullable(),
    cidade: z.string().nullable(),
    uf: z.string().nullable(),
    cep: z.string().nullable(),
    /** numeric(9,6) chega como texto do Postgres; o app converte. */
    latitude: z.union([z.string(), z.number()]).nullable(),
    longitude: z.union([z.string(), z.number()]).nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type ClienteSync = z.infer<typeof ClienteSyncSchema>;

export const CarteiraSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    papel: z.enum(['vendedor', 'promotor']),
    inicio: z.string().nullable(),
    fim: z.string().nullable(),
    /** Agenda por frequência (RF-CORE-05): a cada N semanas (1, 2 ou 4) no dia ISO da semana (1 = segunda). Opcionais: compatível com o contrato anterior. */
    frequencia_semanas: z.union([z.literal(1), z.literal(2), z.literal(4)]).nullable().optional(),
    dia_semana: z.number().int().min(1).max(7).nullable().optional(),
  })
  .strict();
export type CarteiraSync = z.infer<typeof CarteiraSyncSchema>;

export const ProdutoSyncSchema = z
  .object({
    ...Base,
    sku: z.string(),
    ean: z.string().nullable(),
    nome: z.string(),
    marca: z.string().nullable(),
    categoria: z.string().nullable(),
    unidade: z.string(),
    ativo: z.boolean(),
  })
  .strict();
export type ProdutoSync = z.infer<typeof ProdutoSyncSchema>;

// ---------- Sprint 1 (desenho T-0016 §3, §4, §5, §6) ----------
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Centavos = z.number().int();

export const ClienteContatoSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    nome: z.string(),
    cargo: z.string().nullable().optional(),
    telefone: z.string().nullable().optional(),
    whatsapp: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    principal: z.boolean(),
  })
  .strict();
export type ClienteContatoSync = z.infer<typeof ClienteContatoSyncSchema>;

export const ClienteFinanceiroSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    limite_cents: Centavos,
    saldo_aberto_cents: Centavos,
    /** Do ERP; nulo = o domínio calcula limite − saldo. */
    credito_disponivel_cents: Centavos.nullable().optional(),
    bloqueado: z.boolean(),
    motivo_bloqueio: z.string().nullable().optional(),
    atualizado_erp_em: z.string().nullable().optional(),
  })
  .strict();
export type ClienteFinanceiroSync = z.infer<typeof ClienteFinanceiroSyncSchema>;

export const TituloSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    documento: z.string(),
    parcela: z.string().nullable().optional(),
    emissao: Data,
    vencimento: Data,
    valor_cents: Centavos,
    saldo_cents: Centavos,
    situacao: z.enum(['aberto', 'liquidado', 'cancelado']),
    liquidado_em: z.string().nullable().optional(),
  })
  .strict();
export type TituloSync = z.infer<typeof TituloSyncSchema>;

export const HistoricoCompraSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    ano_mes: AnoMes,
    valor_cents: Centavos,
    pedidos: z.number().int().min(0),
    itens: z.number().int().min(0),
    ultima_compra_em: Data.nullable().optional(),
    origem: z.enum(['erp', 'macuxi']),
  })
  .strict();
export type HistoricoCompraSync = z.infer<typeof HistoricoCompraSyncSchema>;

export const MotivoSyncSchema = z
  .object({
    ...Base,
    tipo: z.enum(['nao_venda', 'cliente_fechado', 'fora_do_raio']),
    codigo: z.string(),
    descricao: z.string(),
    exige_foto: z.boolean(),
    sistema: z.boolean(),
    ativo: z.boolean(),
    ordem: z.number().int(),
  })
  .strict();
export type MotivoSync = z.infer<typeof MotivoSyncSchema>;

export const RotaSyncSchema = z
  .object({
    ...Base,
    usuario_id: z.string().uuid(),
    data: Data,
    situacao: z.enum(['planejada', 'publicada', 'cancelada']),
    origem: z.enum(['bko', 'frequencia', 'erp']),
    regiao: z.string().nullable().optional(),
    observacao: z.string().nullable().optional(),
  })
  .strict();
export type RotaSync = z.infer<typeof RotaSyncSchema>;

export const RotaParadaSyncSchema = z
  .object({
    ...Base,
    rota_id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    data: Data,
    cliente_id: z.string().uuid(),
    sequencia: z.number().int().min(1),
    janela_inicio: Hora.nullable().optional(),
    janela_fim: Hora.nullable().optional(),
  })
  .strict();
export type RotaParadaSync = z.infer<typeof RotaParadaSyncSchema>;

export const RESULTADOS_VISITA = ['atendido', 'pedido', 'sem_pedido', 'cliente_fechado'] as const;
export const ResultadoVisitaSchema = z.enum(RESULTADOS_VISITA);
export type ResultadoVisita = z.infer<typeof ResultadoVisitaSchema>;

/** Linha da visita no pull/aparelho. `nao_finalizado` só nasce do servidor/auto (RN-CORE-11). */
export const VisitaSyncSchema = z
  .object({
    ...Base,
    usuario_id: z.string().uuid(),
    cliente_id: z.string().uuid(),
    rota_parada_id: z.string().uuid().nullable().optional(),
    data_local: Data,
    checkin_em: z.string(),
    checkin_lat: z.union([z.string(), z.number()]).nullable().optional(),
    checkin_lng: z.union([z.string(), z.number()]).nullable().optional(),
    sem_gps: z.boolean(),
    distancia_m: z.number().nullable().optional(),
    fora_do_raio: z.boolean(),
    justificativa_fora_raio: z.string().nullable().optional(),
    sugere_coordenada: z.boolean(),
    extra: z.boolean(),
    checkout_em: z.string().nullable().optional(),
    resultado: z.enum([...RESULTADOS_VISITA, 'nao_finalizado']).nullable().optional(),
    motivo_id: z.string().uuid().nullable().optional(),
    motivo_texto: z.string().nullable().optional(),
    pedido_id: z.string().uuid().nullable().optional(),
    foto_fachada_id: z.string().uuid().nullable().optional(),
    fechada_por: z.enum(['usuario', 'auto']).nullable().optional(),
  })
  .strict();
export type VisitaSync = z.infer<typeof VisitaSyncSchema>;

export const TIPOS_NOTIFICACAO = ['recado', 'sistema', 'pedido', 'treinamento', 'trade'] as const;
export const NotificacaoSyncSchema = z
  .object({
    ...Base,
    usuario_id: z.string().uuid(),
    tipo: z.enum(TIPOS_NOTIFICACAO),
    titulo: z.string().max(120),
    corpo: z.string().max(1000),
    link: z.string().regex(/^\/m\/[a-z0-9-]+/).nullable().optional(),
    origem_modulo: z.string(),
    autor_id: z.string().uuid().nullable().optional(),
    prioridade: z.enum(['normal', 'alta']),
    lida_em: z.string().nullable().optional(),
    expira_em: z.string().nullable().optional(),
  })
  .strict();
export type NotificacaoSync = z.infer<typeof NotificacaoSyncSchema>;

export const INDICADORES_META = ['venda_cents', 'positivacao', 'cobertura_pct', 'visitas'] as const;
export const MetaSyncSchema = z
  .object({
    ...Base,
    usuario_id: z.string().uuid(),
    periodo: AnoMes,
    indicador: z.enum(INDICADORES_META),
    /** Inteiro; `cobertura_pct` em pontos-base (8500 = 85,00%). */
    valor: z.number().int(),
  })
  .strict();
export type MetaSync = z.infer<typeof MetaSyncSchema>;
