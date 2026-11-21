/**
 * Schema `core` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0002_core.up.sql (0004: sessao, dispositivo, tentativas de login; 0006: lote A da Sprint 1; 0013: cadastro mínimo do cliente, custo
 * e preço do produto, produto_unidade e cliente_endereco; 0018: medida e embalagem do produto; 0019: nota_erp e meta.tipo; 0021: recado do dia em notificacao; 0025: vendedor da nota_erp; 0028: plano_rv; 0030: notificacao.subtipo; 0036: usuario_convite e usuario.telefone; 0037: prazo médio máximo e formas de pagamento do cliente; 0039 (seção T-0095): erp_alterado_em em cliente, usuario e produto e usuario.desligado_no_bko_em; 0040: estado da senha e sessao_versao do usuário; 0053: canal do cliente; 0056: filial e cliente.filial_id; 0057: foto_tipo, cliente_foto e cliente.inativado_em; 0059: dados fiscais da filial; 0062: erp_alterado_em em cliente_endereco, produto_unidade, titulo, nota_erp, rota e filial e filial.desligado_no_bko_em; 0063: limite de desconto do usuário; 0064: tarefa, tarefa_destinatario e notificacao.tarefa_id; 0065: frase_dia e usuario_avatar; 0066: meta_produtividade, deslocamento_dia e itens_por_pedido no CHECK de meta.indicador; 0076: marca_codigo do produto; 0077: usuario.filial_cadastro_id e usuario_filial; 0080: usuario.codigo_fdv e usuario_codigo_fdv_contador; 0084: almoço do usuário e usuario_contato; 0089: ponto_trajeto e ausencia_usuario; 0090: forma de pagamento e NF em nota_erp e titulo, documento_tipo, documento_cliente, documento_permissao e documento_excecao), para uso
 * INTERNO do módulo Core (modules/core/api).
 * Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, RLS e grants ficam lá); aqui ficam
 * colunas e chave primária. Perfis vêm de @macuxi/platform-sdk (fonte única); o CHECK do SQL é
 * comparado com eles em db/testes/estatico.test.ts.
 * db/testes/drizzle-x-banco.test.ts confere colunas x banco migrado.
 */
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, smallint, text, time, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
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
  /** Telefone do CSV da Equipe (0036, T-0087): dado pessoal; null ou 1..30 caracteres (formato validado no domain do Core). */
  telefone: text('telefone'),
  /**
   * Estado da senha (0040, T-0094, ADR 0032, RN-CORE-34). trocar_senha: a senha atual é temporária e, usada, leva à troca
   * obrigatória. senha_expira_em: validade dela (72 h); nula = não vence (definitiva ou a master do admin inicial). CHECK:
   * senha_expira_em só com trocar_senha. Fora do pull do usuário.
   */
  trocar_senha: boolean('trocar_senha').notNull().default(false),
  senha_expira_em: timestamp('senha_expira_em', { withTimezone: true }),
  /** Senha do "Esqueci a senha" (0040), PARALELA à atual (P6): argon2id; as três senha_temporaria_* juntas (CHECK). */
  senha_temporaria_hash: text('senha_temporaria_hash'),
  senha_temporaria_expira_em: timestamp('senha_temporaria_expira_em', { withTimezone: true }),
  /** Quando a temporária foi gerada: teto de 15 min entre pedidos (T-0094 §5). */
  senha_temporaria_criada_em: timestamp('senha_temporaria_criada_em', { withTimezone: true }),
  /** Sobe a cada troca/redefinição/desativação (0040): token (claim sv) e sessão do portal só valem com a versão atual. >= 0. */
  sessao_versao: integer('sessao_versao').notNull().default(0),
  // --- T-0095 (seção da 0039; RN-INT-02/04): guarda de ordem do ERP e desligamento pelo BKO. Fora do pull. ---
  /** Último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Reentrega mais antiga é ignorada. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
  /** Gravada pela API do BKO ao desativar, limpa ao reativar; preenchida, a carga do ERP não reativa (o monitor avisa). */
  desligado_no_bko_em: timestamp('desligado_no_bko_em', { withTimezone: true, precision: 3 }),
  // --- 0063 (T-0168, RN-VEN-11a): limite de desconto do usuário. Gravado só pelo BKO (ERP e CSV não tocam). ---
  /** "Limitar desconto por item" (RN-VEN-11 ligada). Padrão true (usuário antigo e novo). */
  desconto_limita_item: boolean('desconto_limita_item').notNull().default(true),
  /** "Limitar desconto por pedido". Ligada exige desconto_maximo_pedido_permil (CHECK usuario_desconto_pedido_com_limite). */
  desconto_limita_pedido: boolean('desconto_limita_pedido').notNull().default(false),
  /** Desconto máximo do pedido em décimos de % (‰): 8,0% = 80; 0..1000. Desligar "por pedido" mantém o número. */
  desconto_maximo_pedido_permil: integer('desconto_maximo_pedido_permil'),
  // --- 0084 (T-0180, D5, RN-CORE-44): almoço da pessoa. Gravado só pelo BKO (ERP e CSV não tocam). ---
  /**
   * Início/fim do almoço em minutos do dia, hora local do tenant (12:00 = 720). As duas nulas = "Padrão da empresa"
   * (jornada.almoco_padrao). CHECKs: usuario_almoco_par (as duas ou nenhuma), usuario_almoco_faixa (0..1439) e
   * usuario_almoco_duracao (fim > início, 15 a 180 min).
   */
  almoco_inicio_min: smallint('almoco_inicio_min'),
  almoco_fim_min: smallint('almoco_fim_min'),
  /**
   * Filial de CADASTRO (0077, T-0176, RN-CORE-39): nula = usuário bloqueado (domain/API do Core). FK composta
   * usuario_filial_cadastro_fk -> core.filial. Preenchida exige linha viva em usuario_filial com a mesma filial (gatilho adiado
   * usuario_filial_inclui_cadastro, 23514 no COMMIT, hint RN-CORE-39).
   */
  filial_cadastro_id: uuid('filial_cadastro_id'),
  /**
   * Código FDV (0080, T-0175, RN-CORE-59): 00001… por tenant (só número, 5 dígitos ou mais), gerado pelo banco (gatilho usuario_codigo_fdv_emitir) e só de
   * leitura (usuario_codigo_fdv_somente_leitura, 23514). Somente leitura — nunca grave. Nulo só no apagado antes da 0080.
   */
  codigo_fdv: text('codigo_fdv'),
  // --- 0093 (T-0191, RN-CORE-75): casa e base do vendedor/promotor. Dado pessoal: fora do pull e sem macuxi_leitura. ---
  /** Endereço da casa: CEP com 8 dígitos e UF com 2 letras maiúsculas (CHECKs); ponto marcado no mapa, lat e lng juntos. */
  casa_cep: text('casa_cep'),
  casa_logradouro: text('casa_logradouro'),
  casa_numero: text('casa_numero'),
  casa_bairro: text('casa_bairro'),
  casa_cidade: text('casa_cidade'),
  casa_uf: text('casa_uf'),
  casa_lat: numeric('casa_lat', { precision: 9, scale: 6 }),
  casa_lng: numeric('casa_lng', { precision: 9, scale: 6 }),
  /** Base (ponto de partida da rota): 'casa' usa o ponto da casa; 'outro' exige base_lat e base_lng (CHECK); nulo = sem base. */
  base_tipo: text('base_tipo', { enum: ['casa', 'outro'] }),
  base_cep: text('base_cep'),
  base_logradouro: text('base_logradouro'),
  base_numero: text('base_numero'),
  base_bairro: text('base_bairro'),
  base_cidade: text('base_cidade'),
  base_uf: text('base_uf'),
  base_lat: numeric('base_lat', { precision: 9, scale: 6 }),
  base_lng: numeric('base_lng', { precision: 9, scale: 6 }),
  /** Última troca da base (UTC), gravada pela API. */
  base_alterada_em: timestamp('base_alterada_em', { withTimezone: true }),
});

/** Contador do Código FDV (0080, RN-CORE-59): uma linha por tenant, o maior número emitido; só o gatilho grava. Fora do sync. */
export const usuarioCodigoFdvContador = core.table('usuario_codigo_fdv_contador', {
  ...comuns(),
  ultimo_sequencial: bigint('ultimo_sequencial', { mode: 'number' }).notNull().default(0),
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
  /** 0076 (R-20261115-080000-alexandre): código da marca no ERP (ex.: 980), até 30; nulo = sem código. Só exibição (card do Catálogo). */
  marca_codigo: varchar('marca_codigo', { length: 30 }),
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
  /** T-0095 (seção da 0039): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
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
  // --- 0037 (T-0089, RN-VEN-25; desenho T-0089 §3) ---
  /** Prazo médio máximo do cliente em dias (0..365). Nulo = sem teto (§8 P1): todos os prazos ativos ficam habilitados. */
  prazo_medio_max_dias: integer('prazo_medio_max_dias'),
  /**
   * CÓDIGOS das formas de pagamento permitidas (vendedor.forma_pagamento.codigo), SEM FK: a forma é do Vendedor (regra 1,
   * ADR 0027). Nulo ou vazio = todas as ativas (§8 P1). Até 20 códigos de 1..20 caracteres, sem repetir (CHECK).
   */
  formas_pagamento: text('formas_pagamento').array(),
  /** T-0095 (seção da 0039): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
  /** 0053 (T-0115, RN-PES-05): canal do cliente vindo do ERP (1..60 caracteres); nulo = sem canal. Vai no pull e no público da Pesquisa. */
  canal: text('canal'),
  /**
   * 0056 (T-0149, RN-CORE-39, ADR 0040): filial do cliente, NUNCA nula (FK composta cliente_filial_fk). Nulo na escrita vira a
   * filial padrão do tenant (gatilho cliente_filial_padrao). Vai no pull.
   */
  filial_id: uuid('filial_id').notNull(),
  /**
   * 0057 (T-0147, desenho §7): quando o cliente ficou inativo (gatilho cliente_inativado_em: ativo falso -> now(), verdadeiro ->
   * nulo). Relógio da retenção das fotos do PDV (cliente inativo + 5 anos, docs/banco/lgpd.md). Fora do pull.
   */
  inativado_em: timestamp('inativado_em', { withTimezone: true }),
  // --- 0093 (T-0191, RN-CORE-77): origem e precisão da coordenada e geocodificação ("Gerar coordenada"). Fora do pull. ---
  /** De onde veio latitude/longitude; nulo = desconhecida. Backfill da 0093: 'erp' em quem já tinha latitude. */
  coordenada_origem: text('coordenada_origem', { enum: ['erp', 'checkin', 'geocodificacao', 'manual'] }),
  /** Precisão da geocodificação; nulo fora dela. */
  coordenada_precisao: text('coordenada_precisao', { enum: ['numero', 'rua', 'cep'] }),
  /** Última tentativa de geocodificar (UTC). */
  geocodificacao_tentada_em: timestamp('geocodificacao_tentada_em', { withTimezone: true }),
  /** Hash do endereço e do CEP tentados (mesma chave = JA_TENTADO). Sensível pelo nome: fora do SELECT do macuxi_leitura. */
  geocodificacao_chave: text('geocodificacao_chave'),
});

/**
 * Filial (0056, T-0149, RN-CORE-39, ADR 0040): unidade de onde saem as entregas. codigo 1..20 único vivo; nome 1..80; cidade
 * 1..80 e uf ^[A-Z]{2}$, nulas só na padrão recém-nascida. UMA padrão viva por tenant (filial_padrao_uk), sempre ativa e viva
 * (filial_padrao_ativa); trocar a padrão = tirar a marca da atual antes de marcar a nova (mesma transação). A padrão nasce com
 * o tenant (gatilho tenant_semear_filial: código '0001', 'Filial padrão', id idFilialPadrao). Pull escopo tenant.
 * 0059 (T-0159, cabeçalho do PDF pela filial de faturamento): dados fiscais NULOS no banco (o obrigatório é do domain e da
 * carga, R-20261110-220007): cnpj só dígitos 14, único vivo quando preenchido (filial_cnpj_uk); logradouro 1..160; numero
 * 1..20; complemento e bairro 1..80; cep só dígitos 8; telefone 1..30.
 */
export const filial = core.table('filial', {
  ...comuns(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  cidade: text('cidade'),
  uf: text('uf'),
  cnpj: text('cnpj'),
  logradouro: text('logradouro'),
  numero: text('numero'),
  complemento: text('complemento'),
  bairro: text('bairro'),
  cep: text('cep'),
  telefone: text('telefone'),
  padrao: boolean('padrao').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
  /** 0062 (T-0095): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Mais antigo não grava (gatilho <tabela>_versao_erp). Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
  /** 0062 (T-0095): gravada pela API do BKO ao desativar, limpa ao reativar; preenchida, a carga do ERP não reativa (gatilho <tabela>_desligado_no_bko). Fora do pull. */
  desligado_no_bko_em: timestamp('desligado_no_bko_em', { withTimezone: true, precision: 3 }),
});

/** Origem da foto do PDV (0057, T-0147): câmera do app ou galeria (a galeria vale só para as fotos do PDV). */
export const ORIGENS_FOTO_PDV = ['camera', 'galeria'] as const;

/**
 * Tipo de foto do PDV (0057, T-0147, RN-CORE-38): nome 1..60 único vivo sem diferenciar maiúsculas; obrigatorio; sensivel
 * (documento: só admin, analista e supervisor da carteira abrem, ADR 0041); fachada: UM vivo por tenant, nunca sensível, nunca
 * apagado. "Fachada" nasce com o tenant (gatilho tenant_semear_foto_tipo; id idFotoTipoFachada). Pull escopo tenant.
 */
export const fotoTipo = core.table('foto_tipo', {
  ...comuns(),
  nome: text('nome').notNull(),
  obrigatorio: boolean('obrigatorio').notNull().default(false),
  sensivel: boolean('sensivel').notNull().default(false),
  fachada: boolean('fachada').notNull().default(false),
  ordem: integer('ordem').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
});

/**
 * Foto vigente de um tipo de um cliente (0057, T-0147, RN-CORE-38). id = UUID do aparelho. Única viva por (cliente, tipo).
 * arquivo_id = plataforma.arquivo.id (SEM FK, ADR 0010), único no tenant. Pull escopo carteira com arquivo_id NULO quando o
 * tipo é sensível (consulta em docs/banco/core.md, "0057").
 */
export const clienteFoto = core.table('cliente_foto', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  foto_tipo_id: uuid('foto_tipo_id').notNull(),
  arquivo_id: uuid('arquivo_id').notNull(),
  origem: text('origem', { enum: ORIGENS_FOTO_PDV }).notNull().default('camera'),
  enviado_por: uuid('enviado_por').notNull(),
  tirada_em: timestamp('tirada_em', { withTimezone: true }),
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
  /** 0062 (T-0095): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Mais antigo não grava (gatilho <tabela>_versao_erp). Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
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
  /** 0062 (T-0095): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Mais antigo não grava (gatilho <tabela>_versao_erp). Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
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

/** Quem gerou o convite (0036): core.usuario do tenant ou super-admin de plataforma (0035). Espelha o CHECK usuario_convite_criado_por_tipo_valido. */
export const CRIADO_POR_CONVITE = ['usuario', 'super_admin'] as const;

/**
 * Convite de 1º acesso (0036, T-0087, RN-CORE-31). Fora do sync. Token `<tenant_id>.<segredo>`: aqui SÓ o SHA-256 hex do
 * segredo (único por tenant, usuario_convite_token_uk em (tenant_id, token_hash)). Uso único: no máximo 1 pendente (não usado, não revogado, não apagado) por
 * usuário (usuario_convite_pendente_uk) — renovar = revogar o pendente e DEPOIS inserir o novo. usado_em e revogado_em se
 * excluem. Prazo de 7 dias definido pela API (o banco não amarra expira_em ao created_at). criado_por_id sem FK (usuário do
 * tenant ou super-admin, conforme criado_por_tipo; os dois nulos = carga). macuxi_app: select, insert, update (sem delete).
 */
export const usuarioConvite = core.table('usuario_convite', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  token_hash: text('token_hash').notNull(),
  expira_em: timestamp('expira_em', { withTimezone: true }).notNull(),
  usado_em: timestamp('usado_em', { withTimezone: true }),
  revogado_em: timestamp('revogado_em', { withTimezone: true }),
  criado_por_id: uuid('criado_por_id'),
  criado_por_tipo: text('criado_por_tipo', { enum: CRIADO_POR_CONVITE }),
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
  /** 0062 (T-0095): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Mais antigo não grava (gatilho <tabela>_versao_erp). Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
  /** 0090 (T-0186, D2): forma de pagamento como o ERP manda; 1..120; nula = não veio. */
  forma_pagamento: text('forma_pagamento'),
  /** 0090 (T-0186, D3): NF do título (junta as parcelas à nota; índice titulo_nf_ix); 1..60. */
  nf_numero: text('nf_numero'),
  /** 0090: série da NF; só com nf_numero (titulo_nf_serie_com_numero). */
  nf_serie: text('nf_serie'),
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
  /** 0062 (T-0095): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Mais antigo não grava (gatilho <tabela>_versao_erp). Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
  /** 0090 (T-0186, D2/E1): forma de pagamento da NF como o ERP manda; 1..120; nula = não veio. */
  forma_pagamento: text('forma_pagamento'),
  /** 0090 (T-0186, D3): NF original da devolução; só com tipo 'devolucao' (nota_erp_nf_origem_so_devolucao); 1..60. */
  nf_origem_numero: text('nf_origem_numero'),
  /** 0090: série da NF original; só com nf_origem_numero (nota_erp_nf_origem_serie_com_numero). */
  nf_origem_serie: text('nf_origem_serie'),
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
  /** 0062 (T-0095): último `alterado_em` do ERP aplicado (timestamptz(3)); nulo = nunca veio do ERP. Mais antigo não grava (gatilho <tabela>_versao_erp). Fora do pull. */
  erp_alterado_em: timestamp('erp_alterado_em', { withTimezone: true, precision: 3 }),
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

/** Subtipos de notificação conhecidos (0030, T-0039): 'etapa_pendente_checkout' = alerta da etapa pendente no checkout. */
/** 'tarefa' (0064, T-0170, RN-CORE-TAR-07) = aviso da tarefa ao consultor (tipo 'sistema'; único com tarefa_id). */
export const SUBTIPOS_NOTIFICACAO_CONHECIDOS = ['etapa_pendente_checkout', 'tarefa'] as const;

/**
 * Notificação do usuário. Únicos parciais por (usuário, origem_evento_id) e (usuário, envio_id).
 * 0021 (T-0073): recado do dia = recado_do_dia (dia civil do tenant) + recado_do_dia_por, juntos (CHECK _par), só em
 * tipo = 'recado' (CHECK _so_recado), um por pessoa por dia (único vivo notificacao_recado_do_dia_uk).
 * 0030 (T-0039): subtipo (text, nulo, formato ^[a-z_]{1,40}$, sem índice); valores conhecidos em SUBTIPOS_NOTIFICACAO_CONHECIDOS
 * (a lista é do Core, não do banco: subtipo novo não pede migração).
 * 0064 (T-0170): tarefa_id (FK composta core.tarefa) só com subtipo 'tarefa' (gatilho de restrição notificacao_tarefa_subtipo,
 * depois da FK); um aviso por (usuário, tarefa) (único notificacao_tarefa_uk).
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
  /** 0030 (T-0039): marcador estável dentro do tipo; null = sem subtipo. CHECK notificacao_subtipo_formato (^[a-z_]{1,40}$). */
  subtipo: text('subtipo'),
  /** 0064 (T-0170): aviso da tarefa; nulo nas outras notificações. */
  tarefa_id: uuid('tarefa_id'),
});

/**
 * Indicadores da meta mensal = CHECK meta_indicador_valido (o último, da 0066) = INDICADORES_META do contrato
 * (modules/core/contracts/sync.ts; estatico.test.ts compara). 'itens_por_pedido' (0066, T-0170) em centésimos: 3,50 = 350.
 */
export const INDICADORES_META_BANCO = ['venda_cents', 'positivacao', 'cobertura_pct', 'visitas', 'itens_por_pedido'] as const;

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

/** 0064 (T-0170): tipos da tarefa (CHECK tarefa_tipo_valido; espelha TIPOS_TAREFA de modules/core/contracts/tarefa.ts). */
export const TIPOS_TAREFA_BANCO = ['simples', 'foto', 'pesquisa'] as const;
/** 0064 (T-0170): para quem a tarefa foi criada (CHECK tarefa_alvo_valido); só para o BKO mostrar. */
export const ALVOS_TAREFA_BANCO = ['usuarios', 'equipe', 'todos'] as const;

/**
 * Tarefa do consultor como foi cadastrada no BKO (0064, T-0170, RN-CORE-TAR-01..12). id gerado no BKO (idempotência).
 * titulo 1..120; descricao <= 1000; prazo = data civil no fuso do tenant; questionario_id (schema pesquisa, SEM FK) só e sempre
 * no tipo pesquisa; equipe_id só e sempre no alvo equipe; cancelada_em e cancelada_por juntos; motivo <= 300, só na cancelada.
 * Gatilho tarefa_tocar_destinatarios: mudar o que o aparelho mostra anda o updated_at dos destinatários. Fora do pull direto
 * (vai ao aparelho pela linha do destinatário).
 */
export const tarefa = core.table('tarefa', {
  ...comuns(),
  autor_id: uuid('autor_id').notNull(),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  prazo: date('prazo').notNull(),
  cliente_id: uuid('cliente_id'),
  tipo: text('tipo', { enum: TIPOS_TAREFA_BANCO }).notNull(),
  questionario_id: uuid('questionario_id'),
  alvo: text('alvo', { enum: ALVOS_TAREFA_BANCO }).notNull(),
  equipe_id: uuid('equipe_id'),
  cancelada_em: timestamp('cancelada_em', { withTimezone: true }),
  cancelada_por: uuid('cancelada_por'),
  motivo_cancelamento: text('motivo_cancelamento'),
});

/**
 * Uma linha por consultor da tarefa (0064, T-0170): a que vai ao aparelho (pull `tarefa`, escopo proprio). Único vivo por
 * (tarefa, usuário); conclusao_id (UUID do comando `tarefa_conclusao`) único no tenant; concluida_em (hora do aparelho) e
 * recebida_em (hora do servidor) juntos; observacao <= 500; resposta_id = resposta da Pesquisa (SEM FK); suspeita = relógio
 * adiantado (RN-CORE-TAR-06).
 */
export const tarefaDestinatario = core.table('tarefa_destinatario', {
  ...comuns(),
  tarefa_id: uuid('tarefa_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  concluida_em: timestamp('concluida_em', { withTimezone: true }),
  recebida_em: timestamp('recebida_em', { withTimezone: true }),
  conclusao_id: uuid('conclusao_id'),
  observacao: text('observacao'),
  resposta_id: uuid('resposta_id'),
  suspeita: boolean('suspeita').notNull().default(false),
});

/**
 * Frase do dia do Início (0065, T-0170, RN-CORE-41). texto 1..120 depois do trim, único vivo sem diferenciar maiúsculas;
 * padrao_codigo P01..P30 nas 30 do FDV (único por tenant SEM filtro de deleted_at: a padrão removida não volta), nulo nas do
 * tenant. As 30 nascem com o tenant (gatilho tenant_semear_frase_dia; id uuid_de_chave('<tenant>:core.frase_dia:<código>')).
 * Pull escopo tenant (inclui removidas).
 */
export const fraseDia = core.table('frase_dia', {
  ...comuns(),
  texto: text('texto').notNull(),
  ativa: boolean('ativa').notNull().default(true),
  ordem: integer('ordem').notNull(),
  padrao_codigo: text('padrao_codigo'),
});

/** 0065 (T-0170): espelham TIPOS_AVATAR e AVATARES de modules/core/contracts/avatar.ts (CHECKs usuario_avatar_*). */
export const TIPOS_AVATAR_BANCO = ['iniciais', 'avatar', 'foto'] as const;
export const AVATARES_BANCO = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3'] as const;

/**
 * Foto ou avatar do usuário (0065, T-0170, RN-CORE-42): uma linha por troca; a viva é a escolha atual (uma por usuário,
 * usuario_avatar_vivo_uk); sem viva = iniciais. avatar_codigo só e sempre no tipo avatar; arquivo_id (plataforma.arquivo, SEM
 * FK) só e sempre na foto, único no tenant. alterado_em decide quem vence. Pull escopo usuários visíveis.
 */
export const usuarioAvatar = core.table('usuario_avatar', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_AVATAR_BANCO }).notNull(),
  avatar_codigo: text('avatar_codigo', { enum: AVATARES_BANCO }),
  arquivo_id: uuid('arquivo_id'),
  alterado_em: timestamp('alterado_em', { withTimezone: true }).notNull(),
  alterado_por: uuid('alterado_por').notNull(),
});

/** 0066 (T-0170): espelham ESCOPOS_META_PRODUTIVIDADE e INDICADORES_PRODUTIVIDADE de modules/core/contracts/performance.ts. */
export const ESCOPOS_META_PRODUTIVIDADE_BANCO = ['tenant', 'equipe', 'usuario'] as const;
export const INDICADORES_PRODUTIVIDADE_BANCO = [
  'primeiro_checkin', 'ultimo_checkin', 'tma', 'tmd', 'almoco', 'jornada_liquida',
  'fora_rota', 'visitas_dia', 'cobertura_rota', 'raio_checkin', 'km_dia', 'km_cliente',
] as const;

/**
 * Meta de produtividade (0066, T-0170) por escopo tenant|equipe|usuario; equipe_id/usuario_id só e sempre no escopo deles.
 * valor >= 0 na unidade do indicador (faixa no domain); vigencia_inicio 'AAAA-MM'. Único vivo por (tenant, escopo, alvo,
 * indicador, vigência) — meta_produtividade_vigencia_uk. Pull: todas as vivas do tenant.
 */
export const metaProdutividade = core.table('meta_produtividade', {
  ...comuns(),
  escopo: text('escopo', { enum: ESCOPOS_META_PRODUTIVIDADE_BANCO }).notNull(),
  equipe_id: uuid('equipe_id'),
  usuario_id: uuid('usuario_id'),
  indicador: text('indicador', { enum: INDICADORES_PRODUTIVIDADE_BANCO }).notNull(),
  valor: integer('valor').notNull(),
  vigencia_inicio: text('vigencia_inicio').notNull(),
  atualizado_por: uuid('atualizado_por'),
});

/**
 * Resumo diário do km do usuário (0066, T-0170; mantido pelo servidor com os pontos do rastreamento da T-0156 — vazio até
 * lá). Único vivo por (tenant, usuário, data); metros e pontos >= 0; primeiro/último ponto juntos; origem 'rastreamento'.
 * Sem coordenada. Pull com a janela das visitas, escopo de usuário.
 */
export const deslocamentoDia = core.table('deslocamento_dia', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  data: date('data').notNull(),
  metros: integer('metros').notNull().default(0),
  pontos: integer('pontos').notNull().default(0),
  primeiro_ponto_em: timestamp('primeiro_ponto_em', { withTimezone: true }),
  ultimo_ponto_em: timestamp('ultimo_ponto_em', { withTimezone: true }),
  origem: text('origem', { enum: ['rastreamento'] }).notNull().default('rastreamento'),
});

/**
 * Filiais de VENDA do usuário (0077, T-0176, RN-CORE-39; R-20261115-093000/094500): uma linha viva por (usuário, filial) —
 * único parcial usuario_filial_uk. Inclui a de cadastro (usuario.filial_cadastro_id; gatilho adiado
 * usuario_filial_inclui_cadastro). O mínimo de 1 é do domain/API. Remover = soft delete.
 */
export const usuarioFilial = core.table('usuario_filial', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  filial_id: uuid('filial_id').notNull(),
});

/**
 * Último contato do aparelho (0084, T-0180, ADR 0059 §5): uma linha por usuário — usuario_contato_usuario_uk UNIQUE
 * (tenant_id, usuario_id), não parcial, alvo do `on conflict` do contatoDoAparelho (trava de 1 min no SQL). contato_em = instante
 * da última GET /v1/sync/novidades ou POST /v1/sync/push. Fora do sync; lida só por core.produtividade_equipe@1.
 */
export const usuarioContato = core.table('usuario_contato', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  contato_em: timestamp('contato_em', { withTimezone: true }).notNull(),
});

/**
 * Rastreamento no expediente (0089, T-0156, ADR 0061; desenho docs/desenho/tracking.md §5.1), interno: o vendedor não vê
 * nada. Nenhuma das 2 tem grant ao macuxi_leitura (TABELAS_SEM_LEITURA). Nunca registre coordenada em log, erro ou telemetria
 * (desenho §9).
 *
 * Ponto do trajeto: id = UUID do aparelho (push idempotente, on conflict (id) do nothing). latitude/longitude numeric(9,6) e
 * velocidade_ms numeric(6,2) chegam como string no `pg`. Só select e insert para o app; o expurgo
 * (core.expurgar_rastreamento, só o worker) apaga de fato com mais de 90 dias. Fora do sync.
 */
export const pontoTrajeto = core.table('ponto_trajeto', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  aparelho_id: uuid('aparelho_id'),
  capturado_em: timestamp('capturado_em', { withTimezone: true }).notNull(),
  latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
  longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
  precisao_m: integer('precisao_m'),
  velocidade_ms: numeric('velocidade_ms', { precision: 6, scale: 2 }),
});

/** Ausência (férias, folga, afastamento; §4.2), sem motivo: dias no fuso do tenant, de <= ate. Pull do próprio usuário. */
export const ausenciaUsuario = core.table('ausencia_usuario', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  de: date('de').notNull(),
  ate: date('ate').notNull(),
});

export const ORIGENS_DOCUMENTO_BANCO = ['erp', 'escritorio', 'app'] as const;
export const NIVEIS_DOCUMENTO_BANCO = ['nao_ve', 've', 've_envia'] as const;

/**
 * Tipo de documento do cliente (0090, T-0186, D5): nome 1..80 único vivo sem diferenciar maiúsculas; grupo 1..60 (a faixa da
 * Documentação); origem erp|escritorio|app (P1: uma só por tipo); tem_validade. Só online (P15), fora do sync.
 */
export const documentoTipo = core.table('documento_tipo', {
  ...comuns(),
  nome: text('nome').notNull(),
  grupo: text('grupo').notNull(),
  ordem: integer('ordem').notNull().default(0),
  origem: text('origem', { enum: ORIGENS_DOCUMENTO_BANCO }).notNull(),
  tem_validade: boolean('tem_validade').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
});

/**
 * Documento de um cliente (0090, T-0186, D5). arquivo_id = plataforma.arquivo.id SEM FK (ADR 0010), único vivo quando há; nulo
 * = ainda sem arquivo. valido_ate >= data_documento. Só online (P15): nem a linha nem o arquivo vão ao aparelho.
 */
export const documentoCliente = core.table('documento_cliente', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  tipo_id: uuid('tipo_id').notNull(),
  nome: text('nome').notNull(),
  arquivo_id: uuid('arquivo_id'),
  data_documento: date('data_documento').notNull(),
  valido_ate: date('valido_ate'),
  enviado_por: uuid('enviado_por'),
});

/**
 * Matriz tipo × perfil da Documentação (0090, T-0186, §7). perfil_id = plataforma.perfil.id SEM FK (outro schema). Única viva
 * por (tipo, perfil). "ve_envia só nos tipos de origem app" é regra do domain e da API. Só online (P15), fora do sync.
 */
export const documentoPermissao = core.table('documento_permissao', {
  ...comuns(),
  tipo_id: uuid('tipo_id').notNull(),
  perfil_id: uuid('perfil_id').notNull(),
  nivel: text('nivel', { enum: NIVEIS_DOCUMENTO_BANCO }).notNull(),
});

/**
 * Exceção por documento (0090, T-0186, P11): a linha quer dizer "este perfil NÃO vê este documento" (só tira acesso).
 * perfil_id SEM FK (outro schema). Única viva por (documento, perfil). Só online (P15), fora do sync.
 */
export const documentoExcecao = core.table('documento_excecao', {
  ...comuns(),
  documento_id: uuid('documento_id').notNull(),
  perfil_id: uuid('perfil_id').notNull(),
});
