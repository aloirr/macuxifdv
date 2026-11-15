/**
 * Entidades de sync do Core que o servidor serve (T-0003 Fase 2): `cliente`, `carteira`, `produto`.
 * São o formato de LINHA do pull (`GET /v1/sync/pull?entidade=…`): colunas do banco em snake_case, `updated_at`
 * UTC com microssegundos, `deleted_at` preenchido quando removida (o aparelho apaga). Somente leitura no aparelho
 * (`direcao: 'pull'`, `servidor_vence`): cadastro vem do ERP/BKO.
 * Mesma definição no app (`app/index.ts`) e na API (`api/sync.ts`) — o motor valida o schema dos dois lados.
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';
import { EtapasPendentesSchema } from './etapas-pendencia';
import { ModuloIdSchema } from './modulos';
import { FilialDadosFiscaisSchema } from './filial';
import { EMBALAGEM_QUANTIDADE_MAX, EMBALAGEM_QUANTIDADE_MIN } from './medida';
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
    /** T-0149 / RN-CORE-39 (aditivo): filial do cliente (nunca nula no servidor; ausente = linha/emissor antigo = padrão). */
    filial_id: z.string().uuid().nullable().optional(),
    /** Cadastro mínimo (RN-CORE-16/17; T-0060). Opcionais: APK antigo e linhas antigas continuam válidos. `cadastro_campos_faltantes` é string (e não o enum): campo novo do tenant não reprova a linha no aparelho antigo. */
    inscricao_estadual: z.string().nullable().optional(),
    observacao: z.string().nullable().optional(),
    cadastro_incompleto: z.boolean().optional(),
    cadastro_campos_faltantes: z.array(z.string()).optional(),
    /** T-0089 / RN-VEN-25 (aditivo): prazo médio máximo em dias (nulo = sem teto) e códigos das formas permitidas (nulo ou vazio = todas). */
    prazo_medio_max_dias: z.number().int().min(0).max(365).nullable().optional(),
    formas_pagamento: z.array(z.string().min(1).max(20)).max(20).nullable().optional(),
    /** T-0115 / RN-PES-05 (aditivo): canal do cliente (lista do tenant, vem do ERP); a Pesquisa o usa no público-alvo. Ausente = linha/emissor antigo. */
    canal: z.string().max(60).nullable().optional(),
})
    .strict();
/**
 * RN-VEN-11a (T-0168): funções e limite de desconto do usuário. O app usa a linha do usuário da sessão; sem linha = `LIMITE_DESCONTO_PADRAO`.
 * Só o que o aparelho precisa (sem nome, e-mail nem senha). Entidade nova: o APK antigo não a pede.
 */
export const UsuarioSyncSchema = z
    .object({
    ...Base,
    /** RN-CORE-59: Código FDV, só de leitura; nulo até a migração entrar. */
    codigo_fdv: z.string().nullable().default(null),
    desconto_limita_item: z.boolean().default(true),
    desconto_limita_pedido: z.boolean().default(false),
    desconto_maximo_pedido_permil: z.number().int().min(0).max(1000).nullable().default(null),
    /** T-0176 / RN-CORE-39 (aditivo): filial de cadastro (nula = bloqueado), filiais de VENDA (inclui a de cadastro) e o indicador `sem_filial`. Ausente = emissor antigo. */
    filial_cadastro_id: z.string().uuid().nullable().optional(),
    filial_venda_ids: z.array(z.string().uuid()).optional(),
    sem_filial: z.boolean().optional(),
    /** T-0180 (D5): horário de almoço próprio, em minutos do dia; nulo = padrão da empresa (`jornada.almoco_padrao`). */
    almoco_inicio_min: z.number().int().min(0).max(1439).nullable().default(null),
    almoco_fim_min: z.number().int().min(0).max(1439).nullable().default(null),
})
    .strict();
/**
 * RN-CORE-50 (cliente_visita_resumo@1): resumo das visitas do cliente no servidor, de QUALQUER usuário e sem janela, lido da
 * view `core.v_cliente_visita_resumo`. `id` = `cliente_id`. `ultima_visita_em` em UTC (a tela mostra a data no fuso do tenant).
 * Sem linha no aparelho, a aba Performance usa o cálculo local (`visita` do aparelho).
 */
export const ClienteVisitaResumoSyncSchema = z
    .object({
    ...Base,
    cliente_id: z.string().uuid(),
    total_visitas: z.number().int().min(0),
    ultima_visita_em: z.string().datetime({ offset: true }).nullable(),
    ultima_visita_usuario_id: z.string().uuid().nullable(),
    ultima_visita_usuario_nome: z.string().nullable(),
})
    .strict();
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
export const ProdutoSyncSchema = z
    .object({
    ...Base,
    sku: z.string(),
    ean: z.string().nullable(),
    nome: z.string(),
    marca: z.string().nullable(),
    categoria: z.string().nullable(),
    unidade: z.string(),
    /** Embalagem opcional (RN-CORE-19): medida + quantidade de unidades. Opcionais: compatível com o pull anterior. */
    embalagem_medida: z.string().nullable().optional(),
    embalagem_quantidade: z.number().int().min(EMBALAGEM_QUANTIDADE_MIN).max(EMBALAGEM_QUANTIDADE_MAX).nullable().optional(),
    /** T-0151 / RN-VEN-11 (aditivo): preço de venda em centavos; nulo = sem preço de venda. Ausente em pull antigo. */
    preco_venda_cents: z.number().int().min(0).nullable().optional(),
    /** T-0151 / RN-VEN-11 (aditivo): desconto máximo EFETIVO em % (próprio do produto, senão parâmetro do tenant, senão 15). */
    desconto_maximo_pct: z.number().min(0).max(100).optional(),
    ativo: z.boolean(),
})
    .strict();
/** Filiais do tenant (RN-CORE-39; T-0149): escopo tenant (dezenas de linhas); inativa continua no pull (o cliente e o pedido a mantêm). */
export const FilialSyncSchema = z
    .object({
    ...Base,
    codigo: z.string(),
    nome: z.string(),
    cidade: z.string().nullable(),
    uf: z.string().nullable(),
    padrao: z.boolean(),
    ativo: z.boolean(),
    /** T-0159 (aditivo, opcional): CNPJ e endereço da filial (PDF do pedido). Ausente = emissor antigo. */
    ...FilialDadosFiscaisSchema.shape,
})
    .strict();
/** Medidas do tenant (RN-CORE-19; RF-CORE-14): sigla única e descrição. Escopo tenant; inativa continua no pull (o produto mantém a sigla). */
export const MedidaSyncSchema = z
    .object({
    ...Base,
    sigla: z.string(),
    descricao: z.string(),
    ativo: z.boolean(),
})
    .strict();
/** Unidades de venda do produto (RN-VEN-15; T-0061 §4.1). Escopo tenant. */
export const ProdutoUnidadeSyncSchema = z
    .object({
    ...Base,
    produto_id: z.string().uuid(),
    unidade: z.string(),
    fator: z.number().int().positive(),
    ean: z.string().nullable(),
    padrao: z.boolean(),
    ativo: z.boolean(),
})
    .strict();
/** Endereços do cliente (RF-CORE-12, RN-VEN-17). Escopo carteira (cliente_id). */
export const ClienteEnderecoSyncSchema = z
    .object({
    ...Base,
    cliente_id: z.string().uuid(),
    tipo: z.enum(['principal', 'entrega', 'cobranca']),
    descricao: z.string().nullable(),
    logradouro: z.string(),
    numero: z.string().nullable(),
    complemento: z.string().nullable(),
    bairro: z.string().nullable(),
    cidade: z.string(),
    uf: z.string(),
    cep: z.string().nullable(),
    latitude: z.union([z.string(), z.number()]).nullable(),
    longitude: z.union([z.string(), z.number()]).nullable(),
    principal: z.boolean(),
    ativo: z.boolean(),
})
    .strict();
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
/** Parâmetro do tenant (`plataforma.parametro`, fonte única) que o app precisa offline: `checkin.raio_m` (RN-CORE-10). */
export const ParametroSyncSchema = z
    .object({
    ...Base,
    modulo: z.string(),
    chave: z.string(),
    valor: z.unknown(),
})
    .strict();
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
export const RESULTADOS_VISITA = ['atendido', 'pedido', 'sem_pedido', 'cliente_fechado'];
export const ResultadoVisitaSchema = z.enum(RESULTADOS_VISITA);
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
    /** UUID do comando de checkout já aplicado no servidor (idempotência; a sobreposição da fila o usa). */
    checkout_id: z.string().uuid().nullable().optional(),
    /** T-0039 §2: etapas obrigatórias de outros módulos pendentes (RN-CORE-12). Aditivo: aparelho antigo ignora. */
    etapas_pendentes: EtapasPendentesSchema.optional(),
})
    .strict();
export const TIPOS_NOTIFICACAO = ['recado', 'sistema', 'pedido', 'treinamento', 'trade'];
export const NotificacaoSyncSchema = z
    .object({
    ...Base,
    usuario_id: z.string().uuid(),
    tipo: z.enum(TIPOS_NOTIFICACAO),
    titulo: z.string().max(120),
    corpo: z.string().max(1000),
    link: z.string().regex(/^\/m\/[a-z0-9-]+/).nullable().optional(),
    origem_modulo: ModuloIdSchema,
    autor_id: z.string().uuid().nullable().optional(),
    prioridade: z.enum(['normal', 'alta']),
    lida_em: z.string().nullable().optional(),
    expira_em: z.string().nullable().optional(),
    /** T-0073 (aditivo, migração 0021): dia civil no fuso do tenant em que o recado vale como "recado do dia"; null/ausente = não marcado. */
    recado_do_dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** T-0073 (aditivo): nome e perfil de quem enviou (subconsulta em core.usuario); só para exibir o autor do recado. */
    autor_nome: z.string().nullable().optional(),
    autor_perfil: PerfilSchema.nullable().optional(),
    /** T-0039 (aditivo, migração 0030): marcador estável dentro do tipo (ex.: `etapa_pendente_checkout`); null/ausente = sem subtipo. */
    subtipo: z.string().regex(/^[a-z_]{1,40}$/).nullable().optional(),
    /** T-0170 (aditivo): tarefa do consultor que gerou o aviso; null/ausente = não é de tarefa. */
    tarefa_id: z.string().uuid().nullable().optional(),
})
    .strict();
export const INDICADORES_META = ['venda_cents', 'positivacao', 'cobertura_pct', 'visitas', 'itens_por_pedido'];
/**
 * RD-0250: um nome por indicador, igual no Campo, na Gestão, no BKO e no PDF (`docs/design/rotulos-indicadores.md`).
 * Quem exibe usa este mapa e não cria sinônimo. A única exceção (D6) está em `rotuloDoIndicadorMeta`.
 */
export const ROTULO_INDICADOR_META = {
    venda_cents: 'Vendas',
    positivacao: 'Positivação',
    cobertura_pct: 'Cobertura de rota',
    visitas: 'Visitas',
    itens_por_pedido: 'Itens por pedido',
};
/** D6: `venda_cents` vira "Faturamento" só quando a meta do tenant é de faturamento; sem base (`null`) ou de pedido, "Vendas". */
export function rotuloDoIndicadorMeta(indicador, tipoMetaVenda) {
    return indicador === 'venda_cents' && tipoMetaVenda === 'faturamento' ? 'Faturamento' : ROTULO_INDICADOR_META[indicador];
}
/** RN-CORE-21: apuração da meta de venda (pedido aprovado por emissão | faturamento por data do ERP). Espelha `core.meta.tipo`. */
export const TIPOS_META = ['pedido', 'faturamento'];
export const MetaSyncSchema = z
    .object({
    ...Base,
    usuario_id: z.string().uuid(),
    periodo: AnoMes,
    indicador: z.enum(INDICADORES_META),
    /** Inteiro; `cobertura_pct` em pontos-base (8500 = 85,00%). */
    valor: z.number().int(),
    /** Aditivo: ausente = 'pedido'. Só a meta de venda (`venda_cents`) usa 'faturamento'. */
    tipo: z.enum(TIPOS_META).optional(),
})
    .strict();
/** Vendas do vendedor por dia (read-model `core.indicador_diario`; RN-CORE-21): líquido = vendido − cancelado. Pull `usuarios`. */
export const IndicadorDiarioSyncSchema = z
    .object({
    ...Base,
    usuario_id: z.string().uuid(),
    /** Dia civil no fuso do tenant (AAAA-MM-DD). */
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pedidos: z.number().int(),
    vendido_cents: z.number().int(),
    cancelado_cents: z.number().int(),
})
    .strict();
