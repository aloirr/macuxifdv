/**
 * Schema `core` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0002_core.up.sql (0004: sessao, dispositivo, tentativas de login; 0006: lote A da Sprint 1; 0013: cadastro mínimo do cliente, custo
 * e preço do produto, produto_unidade e cliente_endereco; 0018: medida e embalagem do produto; 0019: nota_erp e meta.tipo; 0021: recado do dia em notificacao; 0025: vendedor da nota_erp; 0028: plano_rv), para uso
 * INTERNO do módulo Core (modules/core/api).
 * Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, RLS e grants ficam lá); aqui ficam
 * colunas e chave primária. Perfis vêm de @macuxi/platform-sdk (fonte única); o CHECK do SQL é
 * comparado com eles em db/testes/estatico.test.ts.
 * db/testes/drizzle-x-banco.test.ts confere colunas x banco migrado.
 */
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { PERFIS } from '@macuxi/platform-sdk';

export const core = pgSchema('core');

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

/** Árvore de equipes: gerente responde pelo nó de cima; supervisor pela equipe (RN-CORE-04). */
export const equipe = core.table('equipe', {
  ...comuns(),
  nome: text('nome').notNull(),
  equipe_pai_id: uuid('equipe_pai_id'),
  responsavel_id: uuid('responsavel_id'),
  ativo: boolean('ativo').notNull().default(true),
});

/** E-mail único por tenant (comparado em minúsculas); senha_hash só argon2id (PHC). */
export const usuario = core.table('usuario', {
  ...comuns(),
  nome: text('nome').notNull(),
  nome_curto: text('nome_curto'),
  email: text('email').notNull(),
  perfil: text('perfil', { enum: PERFIS }).notNull(),
  equipe_id: uuid('equipe_id'),
  senha_hash: text('senha_hash'),
  ativo: boolean('ativo').notNull().default(true),
  bloqueado_em: timestamp('bloqueado_em', { withTimezone: true }),
  ultimo_login_em: timestamp('ultimo_login_em', { withTimezone: true }),
  /** Falhas de senha seguidas (0004). 5 falhas => bloqueio_ate = agora + 15 min; login certo zera. */
  tentativas_falhas: smallint('tentativas_falhas').notNull().default(0),
  /** Bloqueio TEMPORÁRIO por tentativas (0004). bloqueado_em é o bloqueio manual do admin. */
  bloqueio_ate: timestamp('bloqueio_ate', { withTimezone: true }),
});

/**
 * Medidas do tenant (0018, RN-CORE-19, RF-CORE-14): sigla ^[A-Z]{1,4}$ ÚNICA por tenant (único total medida_sigla_uk, alvo
 * das FKs de produto e produto_unidade), descrição e ativo. Nunca é apagada: sai de uso com ativo = false (o banco recusa
 * deleted_at em medida usada por produto vivo — gatilho medida_em_uso, 23503 — e o macuxi_app não tem DELETE). Lista
 * inicial semeada em todo tenant: MEDIDAS_INICIAIS em db/src/ids.ts. Pull escopo tenant.
 */
export const medida = core.table('medida', {
  ...comuns(),
  sigla: text('sigla').notNull(),
  descricao: text('descricao').notNull(),
  ativo: boolean('ativo').notNull().default(true),
});

/** Cadastro base de produto (ADR-0005). Preço/estoque/conteúdo/busca: schema catalogo. */
export const produto = core.table('produto', {
  ...comuns(),
  sku: text('sku').notNull(),
  ean: text('ean'),
  nome: text('nome').notNull(),
  marca: text('marca'),
  categoria: text('categoria'),
  unidade: text('unidade').notNull().default('UN'),
  ativo: boolean('ativo').notNull().default(true),
  // --- 0013 (RN-CORE-18, RN-VEN-11): DADO INTERNO — custo nunca vai ao aparelho nem ao PDF do cliente ---
  custo_cents: bigint('custo_cents', { mode: 'number' }),
  preco_venda_cents: bigint('preco_venda_cents', { mode: 'number' }),
  /** Nulo = parâmetro do tenant `desconto_maximo_produto_pct` (padrão 15). 0 a 100. */
  desconto_maximo_pct: numeric('desconto_maximo_pct', { precision: 5, scale: 2 }),
  // --- 0018 (RN-CORE-19): `unidade` = sigla da medida da unidade (FK produto_medida_fk -> core.medida). Embalagem opcional:
  // medida (FK produto_embalagem_medida_fk) + quantidade de unidades (2 a 9999, produto_embalagem_quantidade_faixa), as duas
  // juntas ou nenhuma, medida <> unidade.
  embalagem_medida: text('embalagem_medida'),
  embalagem_quantidade: integer('embalagem_quantidade'),
});

export const cliente = core.table('cliente', {
  ...comuns(),
  documento: text('documento'),
  razao_social: text('razao_social').notNull(),
  nome_fantasia: text('nome_fantasia'),
  segmento: text('segmento'),
  telefone: text('telefone'),
  email: text('email'),
  logradouro: text('logradouro'),
  numero: text('numero'),
  bairro: text('bairro'),
  cidade: text('cidade'),
  uf: text('uf'),
  cep: text('cep'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  ativo: boolean('ativo').notNull().default(true),
  // --- 0013 (RN-CORE-16/17, RN-INT-14) ---
  /** IE ou 'ISENTO' (só PJ). */
  inscricao_estadual: text('inscricao_estadual'),
  /** Observações vindas do ERP; a linha automática "Cadastro incompleto: falta ..." é montada na exibição. */
  observacao: text('observacao'),
  /** CHECK: cadastro_incompleto = (cadastro_campos_faltantes não vazio). Calculado pelo domain do Core. */
  cadastro_incompleto: boolean('cadastro_incompleto').notNull().default(false),
  cadastro_campos_faltantes: text('cadastro_campos_faltantes').array().notNull().default([]),
});

/**
 * Unidades de venda do produto vindas do ERP (0013, RN-VEN-15): UN, CX com fator... fator = unidades base na unidade
 * (UN = 1). (produto, unidade) único vivo; no máximo uma `padrao` viva por produto. Pull escopo tenant.
 */
export const produtoUnidade = core.table('produto_unidade', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  unidade: text('unidade').notNull(),
  fator: integer('fator').notNull().default(1),
  ean: text('ean'),
  padrao: boolean('padrao').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
});

export const TIPOS_ENDERECO_CLIENTE = ['principal', 'entrega', 'cobranca'] as const;

/**
 * Endereços do cliente vindos do ERP (0013, RF-CORE-12, RN-VEN-17): principal + entrega. No máximo um `principal` vivo
 * por cliente. cep = 8 dígitos; uf = 2 letras. Pull escopo carteira (cliente_id).
 */
export const clienteEndereco = core.table('cliente_endereco', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_ENDERECO_CLIENTE }).notNull().default('entrega'),
  descricao: text('descricao'),
  logradouro: text('logradouro').notNull(),
  numero: text('numero'),
  complemento: text('complemento'),
  bairro: text('bairro'),
  cidade: text('cidade').notNull(),
  uf: text('uf').notNull(),
  cep: text('cep'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  principal: boolean('principal').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
});

/** Vínculo cliente x usuário (papel vendedor | promotor) — base do escopo de carteira. */
export const carteira = core.table('carteira', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  papel: text('papel', { enum: ['vendedor', 'promotor'] }).notNull(),
  inicio: date('inicio'),
  fim: date('fim'),
  /** Agenda por frequência (0006, RF-CORE-05): a cada 1, 2 ou 4 semanas, no dia ISO 1 (segunda) a 7 (domingo). */
  frequencia_semanas: smallint('frequencia_semanas'),
  dia_semana: smallint('dia_semana'),
});

/** Aparelho do usuário (0004; RF-CORE-01 bloqueio remoto). id = UUID gerado no aparelho. Fora do sync. */
export const dispositivo = core.table('dispositivo', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  nome: text('nome'),
  plataforma: text('plataforma'),
  ultimo_acesso_em: timestamp('ultimo_acesso_em', { withTimezone: true }),
  bloqueado_em: timestamp('bloqueado_em', { withTimezone: true }),
  /** Token de push Expo do aparelho (0006, T-0019). push_token e push_plataforma andam juntos. */
  push_token: text('push_token'),
  push_plataforma: text('push_plataforma', { enum: ['android'] }),
  push_atualizado_em: timestamp('push_atualizado_em', { withTimezone: true }),
});

/**
 * Refresh token rotativo (0004; doc 04). token_hash = sha256 hex do segredo, único por tenant.
 * familia_id agrupa os refresh de um login (reuso de refresh usado revoga a família). Fora do sync.
 */
export const sessao = core.table('sessao', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  familia_id: uuid('familia_id').notNull(),
  token_hash: text('token_hash').notNull(),
  dispositivo_id: uuid('dispositivo_id'),
  expira_em: timestamp('expira_em', { withTimezone: true }).notNull(),
  usado_em: timestamp('usado_em', { withTimezone: true }),
  revogado_em: timestamp('revogado_em', { withTimezone: true }),
});

// ---------------------------------------------------------------------------------------------
// Lote A da Sprint 1 (0006; desenho T-0016 §7). Dinheiro em centavos: bigint lido como number (mode 'number');
// no `pg` cru o int8 chega como string — converta no provedor (Number(x)) ou faça cast na consulta.
// As listas fechadas abaixo espelham os CHECKs da 0006 e são comparadas com os contratos do Core em
// db/testes/estatico.test.ts.

/** Contatos do cliente (Cliente 360). Um `principal` vivo por cliente. */
export const clienteContato = core.table('cliente_contato', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  nome: text('nome').notNull(),
  cargo: text('cargo'),
  telefone: text('telefone'),
  whatsapp: text('whatsapp'),
  email: text('email'),
  principal: boolean('principal').notNull().default(false),
});

/** Financeiro do cliente: um vivo por cliente. credito_disponivel_cents nulo = domínio calcula limite − saldo. */
export const clienteFinanceiro = core.table('cliente_financeiro', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  limite_cents: bigint('limite_cents', { mode: 'number' }).notNull().default(0),
  saldo_aberto_cents: bigint('saldo_aberto_cents', { mode: 'number' }).notNull().default(0),
  credito_disponivel_cents: bigint('credito_disponivel_cents', { mode: 'number' }),
  bloqueado: boolean('bloqueado').notNull().default(false),
  motivo_bloqueio: text('motivo_bloqueio'),
  atualizado_erp_em: timestamp('atualizado_erp_em', { withTimezone: true }),
});

export const SITUACOES_TITULO = ['aberto', 'liquidado', 'cancelado'] as const;

/** Títulos a receber do cliente. Pull: abertos + vencimento >= hoje − 90. */
export const titulo = core.table('titulo', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  documento: text('documento').notNull(),
  parcela: text('parcela'),
  emissao: date('emissao').notNull(),
  vencimento: date('vencimento').notNull(),
  valor_cents: bigint('valor_cents', { mode: 'number' }).notNull(),
  saldo_cents: bigint('saldo_cents', { mode: 'number' }).notNull(),
  situacao: text('situacao', { enum: SITUACOES_TITULO }).notNull().default('aberto'),
  liquidado_em: timestamp('liquidado_em', { withTimezone: true }),
});

/** Consolidado mensal de compras (AAAA-MM), um vivo por cliente e mês. */
export const historicoCompra = core.table('historico_compra', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  ano_mes: text('ano_mes').notNull(),
  valor_cents: bigint('valor_cents', { mode: 'number' }).notNull().default(0),
  pedidos: integer('pedidos').notNull().default(0),
  itens: integer('itens').notNull().default(0),
  ultima_compra_em: date('ultima_compra_em'),
  origem: text('origem', { enum: ['erp', 'macuxi'] }).notNull().default('erp'),
});

export const TIPOS_NOTA_ERP_BANCO = ['faturamento', 'devolucao'] as const;

/**
 * Notas do ERP (0019, T-0066): uma linha por nota de integracao.nota.atualizado@1, base idempotente do recálculo de
 * historico_compra (soma das notas vivas e não canceladas por cliente e ano_mes). external_id OBRIGATÓRIO (chave da nota
 * no ERP; único vivo nota_erp_external_uk). cliente_id com FK composta; pedido_uuid é retrato SEM FK (fronteira).
 * ano_mes AAAA-MM no fuso do tenant (o consumidor calcula a partir de emitida_em). Fora do pull do app; sem DELETE.
 * 0025 (T-0080, RN-CORE-27): vendedor_external_id (chave do vendedor no ERP, aparada; vazio = null) e usuario_id (FK composta
 * nota_erp_usuario_fk para core.usuario; null = sem vendedor ou vendedor ainda não recebido; completado pelo consumidor do vendedor).
 */
export const notaErp = core.table('nota_erp', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_NOTA_ERP_BANCO }).notNull(),
  numero: text('numero').notNull(),
  serie: text('serie'),
  emitida_em: timestamp('emitida_em', { withTimezone: true }).notNull(),
  ano_mes: text('ano_mes').notNull(),
  total_cents: bigint('total_cents', { mode: 'number' }).notNull(),
  quantidade_itens: integer('quantidade_itens').notNull().default(0),
  pedido_uuid: uuid('pedido_uuid'),
  cancelada: boolean('cancelada').notNull().default(false),
  vendedor_external_id: text('vendedor_external_id'),
  usuario_id: uuid('usuario_id'),
});

export const TIPOS_MOTIVO = ['nao_venda', 'cliente_fechado', 'fora_do_raio'] as const;

/**
 * Motivos (não venda, cliente fechado, fora do raio). RN-CORE-14: todo tenant tem loja_fechada e acesso_negado
 * (sistema, exige_foto), semeados pelo gatilho core.semear_tenant; motivo de sistema não é removido nem desativado.
 */
export const motivo = core.table('motivo', {
  ...comuns(),
  tipo: text('tipo', { enum: TIPOS_MOTIVO }).notNull(),
  codigo: text('codigo').notNull(),
  descricao: text('descricao').notNull(),
  exige_foto: boolean('exige_foto').notNull().default(false),
  sistema: boolean('sistema').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
  ordem: integer('ordem').notNull().default(0),
});

/** Rota do dia (uma viva por usuário e data). */
export const rota = core.table('rota', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  data: date('data').notNull(),
  situacao: text('situacao', { enum: ['planejada', 'publicada', 'cancelada'] }).notNull().default('planejada'),
  origem: text('origem', { enum: ['bko', 'frequencia', 'erp'] }).notNull().default('bko'),
  regiao: text('regiao'),
  observacao: text('observacao'),
});

/**
 * Parada da rota. usuario_id e data iguais aos da rota (FK composta com on update cascade). Sequência única por rota
 * entre as vivas, conferida no COMMIT (reordenar numa transação). janela_* em `time` (formatar HH:MM no provedor).
 */
export const rotaParada = core.table('rota_parada', {
  ...comuns(),
  rota_id: uuid('rota_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  data: date('data').notNull(),
  cliente_id: uuid('cliente_id').notNull(),
  sequencia: integer('sequencia').notNull(),
  janela_inicio: time('janela_inicio'),
  janela_fim: time('janela_fim'),
});

/** Resultados aceitos pelo banco: os do contrato (RESULTADOS_VISITA) + 'nao_finalizado' (só servidor/auto, RN-CORE-11). */
export const RESULTADOS_VISITA_BANCO = ['atendido', 'pedido', 'sem_pedido', 'cliente_fechado', 'nao_finalizado'] as const;

/**
 * Visita (check-in/checkout). RN-CORE-11: uma aberta (checkout_em nulo) e viva por usuário (índice único parcial
 * visita_aberta_uk). checkout_id único (idempotência do checkout). RN-CORE-10: fora_do_raio ⇒ justificativa.
 * RN-CORE-14: cliente_fechado ⇒ motivo_id e foto_fachada_id. checkout_em, resultado e fechada_por andam juntos.
 * pedido_id sem FK (schema vendedor).
 * 0026 (T-0039 §2, RN-CORE-12): etapas_pendentes = contagem das linhas 'pendente' vivas de visita_etapa, mantida pelo Core
 * na mesma transação (CHECK >= 0; vai no pull da visita); índice parcial visita_etapas_pendentes_ix (filtro do BKO).
 */
export const visita = core.table('visita', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  cliente_id: uuid('cliente_id').notNull(),
  rota_parada_id: uuid('rota_parada_id'),
  data_local: date('data_local').notNull(),
  checkin_em: timestamp('checkin_em', { withTimezone: true }).notNull(),
  checkin_lat: numeric('checkin_lat', { precision: 9, scale: 6 }),
  checkin_lng: numeric('checkin_lng', { precision: 9, scale: 6 }),
  checkin_precisao_m: integer('checkin_precisao_m'),
  sem_gps: boolean('sem_gps').notNull().default(false),
  distancia_m: integer('distancia_m'),
  fora_do_raio: boolean('fora_do_raio').notNull().default(false),
  justificativa_fora_raio: text('justificativa_fora_raio'),
  sugere_coordenada: boolean('sugere_coordenada').notNull().default(false),
  extra: boolean('extra').notNull().default(false),
  checkout_id: uuid('checkout_id'),
  checkout_em: timestamp('checkout_em', { withTimezone: true }),
  checkout_lat: numeric('checkout_lat', { precision: 9, scale: 6 }),
  checkout_lng: numeric('checkout_lng', { precision: 9, scale: 6 }),
  resultado: text('resultado', { enum: RESULTADOS_VISITA_BANCO }),
  motivo_id: uuid('motivo_id'),
  motivo_texto: text('motivo_texto'),
  pedido_id: uuid('pedido_id'),
  foto_fachada_id: uuid('foto_fachada_id'),
  fechada_por: text('fechada_por', { enum: ['usuario', 'auto'] }),
  recebido_em: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  etapas_pendentes: smallint('etapas_pendentes').notNull().default(0),
});

/** Situações aceitas pelo banco em visita_etapa (CHECK visita_etapa_situacao_valida; 'pendente' desde a 0026). */
export const SITUACOES_VISITA_ETAPA_BANCO = ['concluida', 'dispensada', 'pendente'] as const;

/**
 * Etapa do checkout registrada por módulo (única por visita + módulo + etapa, visita_etapa_uk).
 * 0026 (T-0039 §2, RN-CORE-12): 'pendente' = obrigatória de outro módulo não concluída no servidor no checkout (aceito).
 * rotulo (1..120, da consulta) · pendente_desde (servidor; obrigatório em 'pendente') · resolvida_em (baixa; só fora de
 * 'pendente' e com pendente_desde) · alertada_em (job do alerta; só com pendente_desde). Índice parcial
 * visita_etapa_pendente_ix (tenant_id, pendente_desde) where situacao = 'pendente' and vivo.
 */
export const visitaEtapa = core.table('visita_etapa', {
  ...comuns(),
  visita_id: uuid('visita_id').notNull(),
  modulo: text('modulo').notNull(),
  etapa: text('etapa').notNull(),
  situacao: text('situacao', { enum: SITUACOES_VISITA_ETAPA_BANCO }).notNull(),
  referencia_id: uuid('referencia_id'),
  registrada_em: timestamp('registrada_em', { withTimezone: true }).notNull().defaultNow(),
  rotulo: text('rotulo'),
  pendente_desde: timestamp('pendente_desde', { withTimezone: true }),
  resolvida_em: timestamp('resolvida_em', { withTimezone: true }),
  alertada_em: timestamp('alertada_em', { withTimezone: true }),
});

export const TIPOS_NOTIFICACAO_BANCO = ['recado', 'sistema', 'pedido', 'treinamento', 'trade'] as const;

/**
 * Notificação do usuário. Únicos parciais por (usuário, origem_evento_id) e (usuário, envio_id).
 * 0021 (T-0073): recado do dia = recado_do_dia (dia civil do tenant) + recado_do_dia_por, juntos (CHECK _par), só em
 * tipo = 'recado' (CHECK _so_recado), um por pessoa por dia (único vivo notificacao_recado_do_dia_uk).
 */
export const notificacao = core.table('notificacao', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_NOTIFICACAO_BANCO }).notNull(),
  titulo: text('titulo').notNull(),
  corpo: text('corpo').notNull(),
  link: text('link'),
  origem_modulo: text('origem_modulo').notNull().default('core'),
  origem_evento_id: uuid('origem_evento_id'),
  envio_id: uuid('envio_id'),
  autor_id: uuid('autor_id'),
  prioridade: text('prioridade', { enum: ['normal', 'alta'] }).notNull().default('normal'),
  lida_em: timestamp('lida_em', { withTimezone: true }),
  expira_em: timestamp('expira_em', { withTimezone: true }),
  push_enviado_em: timestamp('push_enviado_em', { withTimezone: true }),
  recado_do_dia: date('recado_do_dia'),
  recado_do_dia_por: uuid('recado_do_dia_por'),
});

export const INDICADORES_META_BANCO = ['venda_cents', 'positivacao', 'cobertura_pct', 'visitas'] as const;

/** Tipo da meta (0019, RN-CORE-21): realizado por pedido aprovado (data de emissão) ou por faturamento (data do ERP). */
export const TIPOS_META_BANCO = ['pedido', 'faturamento'] as const;

/** Meta mensal (AAAA-MM) por usuário e indicador; cobertura_pct em pontos-base (0–10000). */
export const meta = core.table('meta', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  periodo: text('periodo').notNull(),
  indicador: text('indicador', { enum: INDICADORES_META_BANCO }).notNull(),
  valor: bigint('valor', { mode: 'number' }).notNull(),
  /** 0019 (RN-CORE-21): padrão 'pedido' (as metas anteriores à 0019 ficaram 'pedido'); CHECK meta_tipo_valido. */
  tipo: text('tipo', { enum: TIPOS_META_BANCO }).notNull().default('pedido'),
});

/** Read-model diário de vendas por vendedor (lote B; alimentado pelo consumidor de vendedor.pedido.* futuro). */
export const indicadorDiario = core.table('indicador_diario', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  data: date('data').notNull(),
  pedidos: integer('pedidos').notNull().default(0),
  vendido_cents: bigint('vendido_cents', { mode: 'number' }).notNull().default(0),
  cancelado_cents: bigint('cancelado_cents', { mode: 'number' }).notNull().default(0),
  /**
   * 0021 (T-0073 §1.1): clientes DISTINTOS com pedido que conta para a meta no dia; null = não apurado (linhas anteriores à
   * 0021, sem backfill). CHECK indicador_diario_clientes_positivados_nao_negativo (>= 0). Fallback da positivação do Início
   * com o Vendedor desligado.
   */
  clientes_positivados: integer('clientes_positivados'),
  /**
   * 0023 (positivação acumulada do mês, opção 3): QUAIS clientes o usuário positivou no dia, sem repetição; null = não
   * apurado. Gravada junto com clientes_positivados (CHECK indicador_diario_clientes_positivados_ids_coerente: 1 dimensão,
   * sem nulo, cardinality = clientes_positivados). A contagem do mês sem repetir cliente entre dias sai de
   * core.positivacao_do_mes(usuarios, 'AAAA-MM', hoje) → (usuario_id, ate_ontem, hoje, mes).
   */
  clientes_positivados_ids: uuid('clientes_positivados_ids').array(),
});

/** 0028 (T-0082, RN-CORE-30): perfis que um plano de RV pode abranger; CHECK plano_rv_perfis_validos. */
export const PERFIS_PLANO_RV_BANCO = ['vendedor', 'promotor'] as const;

/** Faixa de atingimento de uma regra do plano (mesmos nomes de FaixaRvSchema em modules/core/contracts/plano-rv.ts). */
export interface FaixaPlanoRvBanco {
  de_pct: number;
  modo: 'zero' | 'proporcional' | 'fixo';
  pagamento_pct: number;
}
/** Regra por indicador do plano (mesmos nomes de RegraRvSchema); o banco só exige que `regras` seja um array JSON. */
export interface RegraPlanoRvBanco {
  indicador: (typeof INDICADORES_META_BANCO)[number];
  peso_pct: number;
  gatilho: boolean;
  faixas: FaixaPlanoRvBanco[];
}

/**
 * Plano de RV do tenant (0028, T-0082; RN-CORE-29/30), versionado por mês de início: vale de vigencia_inicio ('AAAA-MM')
 * até o mês anterior ao próximo plano vivo; um vivo por (tenant, mês de início) — único parcial plano_rv_vigencia_uk.
 * valor_maximo_cents > 0; perfis não vazio ⊆ PERFIS_PLANO_RV_BANCO; regras = array JSON (formato e pesos validados no
 * domain/API, validarPlanoRv). atualizado_por: FK composta para core.usuario (null = carga). Fora de TABELAS_SYNC.
 */
export const planoRv = core.table('plano_rv', {
  ...comuns(),
  nome: text('nome').notNull(),
  vigencia_inicio: text('vigencia_inicio').notNull(),
  perfis: text('perfis', { enum: PERFIS_PLANO_RV_BANCO }).array().notNull(),
  valor_maximo_cents: bigint('valor_maximo_cents', { mode: 'number' }).notNull(),
  regras: jsonb('regras').$type<RegraPlanoRvBanco[]>().notNull(),
  atualizado_por: uuid('atualizado_por'),
});
