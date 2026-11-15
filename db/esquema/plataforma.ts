/**
 * Schema `plataforma` em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas pela
 * migrações db/migrations/0001_plataforma.up.sql, 0003_plataforma_worker.up.sql, 0005_plataforma_arquivo.up.sql, 0022_plataforma_geracao_base.up.sql
 * e 0035_plataforma_super_admin.up.sql (super-admin, só por função), 0039_plataforma_portal_email_senha.up.sql (portal por
 * e-mail e senha, só por função), 0040_core_senha_email_saida.up.sql (outbox de e-mail),
 * 0041_plataforma_perfis_de_acesso.up.sql (perfis de acesso, ADR 0033; cargo e um perfil por usuário desde a
 * 0069_core_cargo_hierarquia.up.sql), 0070_plataforma_plano_assinatura.up.sql (planos e assinatura, ADR 0047),
 * 0072_plataforma_empresa_acoes.up.sql (inativar, backup e excluir a empresa, ADR 0052; só por função),
 * 0073_plataforma_dados_legais.up.sql (dados legais do rodapé, só por função), 0074_plataforma_sync_pacote.up.sql (pacote da
 * primeira carga, ADR 0054), 0079_catalogo_foto_lote.up.sql (tipos de arquivo e trabalho sob demanda, ADR 0058) e
 * 0081_plataforma_planos_troca_licencas.up.sql (histórico das trocas de plano, ADR 0047), para consultas da API.
 *
 * A fonte da verdade é o SQL versionado (constraints, índices, RLS, grants e funções ficam lá);
 * aqui ficam só colunas e chave primária. O teste db/testes/drizzle-x-banco.test.ts confere que as
 * colunas daqui batem com o banco migrado. Perfis e cargos vêm de @macuxi/platform-sdk (fonte única); o CHECK
 * do SQL é comparado com eles em db/testes/estatico.test.ts e db/testes/cargo-hierarquia.db.test.ts.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, date, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { CARGOS, ETAPAS_EXCLUSAO, MOTIVOS_INATIVACAO, NIVEIS_ALCADA, NIVEIS_ESCOPO, PERFIS, SITUACOES_BACKUP, SITUACOES_EXCLUSAO } from '@macuxi/platform-sdk';

export const plataforma = pgSchema('plataforma');

/** Campos comuns obrigatórios (CLAUDE.md regra 5), exceto tenant_id. */
const auditaveis = () => ({
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ...auditaveis(),
});

/** Exceção à regra 5: sem tenant_id (o id é o tenant). */
export const tenant = plataforma.table('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  documento: text('documento'),
  fuso: text('fuso').notNull().default('America/Sao_Paulo'),
  plano: text('plano').notNull().default('piloto'),
  status: text('status', { enum: ['ativo', 'suspenso', 'encerrado'] }).notNull().default('ativo'),
  /**
   * 0022 (T-0079): geração dos dados do tenant. Gira (plataforma.girar_geracao_base, só o dono do banco) no seed --recriar
   * e na restauração de backup; nunca no uso normal. O aparelho compara com o guardado e, se mudou, limpa a cópia local.
   */
  geracao_base: uuid('geracao_base').notNull().defaultRandom(),
  /** 0072 (ADR 0052, RN-PLA-07): quando ficou inativa (status suspenso); null = ativa. CHECK: ativa <=> sem data; motivo só na inativa. */
  inativada_em: timestamp('inativada_em', { withTimezone: true }),
  /** 0072: motivo da inativação, opcional (MOTIVOS_INATIVACAO do SDK; sem texto livre; null = sem motivo). */
  motivo_inativacao: text('motivo_inativacao', { enum: MOTIVOS_INATIVACAO }),
  ...auditaveis(),
});

export const tenantModulo = plataforma.table('tenant_modulo', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  plano: text('plano'),
  licencas: integer('licencas'),
  parametros: jsonb('parametros').$type<Record<string, unknown>>().notNull().default({}),
  ativado_em: timestamp('ativado_em', { withTimezone: true }),
  desativado_em: timestamp('desativado_em', { withTimezone: true }),
});

/**
 * Módulos padrão de cada perfil do tenant (RN-CORE-01). Desde a 0041 (ADR 0033) `perfil` é o CÓDIGO do perfil do tenant
 * (FK perfil_modulo_perfil_fk -> plataforma.perfil (tenant_id, codigo)): um dos 7 de fábrica ou um personalizado.
 */
export const perfilModulo = plataforma.table('perfil_modulo', {
  ...comuns(),
  perfil: text('perfil').notNull(),
  modulo: text('modulo').notNull(),
});

/**
 * Perfil de acesso do tenant (0041, T-0111, ADR 0033 §3). Os 7 de fábrica (codigo = base, fabrica = true, sempre ativos) são
 * semeados em todo tenant; o personalizado nasce de uma base. codigo, base e fabrica são IMUTÁVEIS; codigo é único no tenant
 * entre todos (apagados inclusive). Soft delete (o macuxi_app não apaga linha). Fora do sync.
 */
export const perfil = plataforma.table('perfil', {
  ...comuns(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  descricao: text('descricao'),
  base: text('base', { enum: PERFIS }).notNull(),
  fabrica: boolean('fabrica').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
  /**
   * 0069: o cargo do perfil (um só), sem padrão: quem cria o perfil informa. Os de fábrica e os personalizados que já existiam
   * receberam plataforma.cargo_da_base(base) (promotor -> promotor).
   */
  cargo: text('cargo', { enum: CARGOS }).notNull(),
});

/**
 * O que o tenant mudou numa chave em relação à fábrica do SDK (0041, ADR 0033 §2). Tabela vazia = padrão de fábrica; restaurar
 * o padrão = apagar as linhas. Revogação (concedida = false) sem nível nem alvos. Travas RN-CORE-33, RN-PRO-01 e RN-CORE-04
 * conferidas no banco (gatilho perfil_permissao_travas). Única viva por (tenant, perfil, chave). Fora do sync.
 */
export const perfilPermissao = plataforma.table('perfil_permissao', {
  ...comuns(),
  perfil_id: uuid('perfil_id').notNull(),
  chave: text('chave').notNull(),
  concedida: boolean('concedida').notNull(),
  nivel: text('nivel', { enum: [...NIVEIS_ESCOPO, ...NIVEIS_ALCADA] }),
  /** Códigos de perfil do tenant ou '*' (todos os que não são de base admin). */
  alvos: text('alvos').array(),
});

/**
 * Perfil do usuário (0041, RN-CORE-01; UM por usuário desde a 0069). No máximo um vínculo vivo por (tenant, usuário): restrição
 * de exclusão ADIADA usuario_perfil_um_vivo (23P01 no COMMIT), então a troca pode apagar o antigo e inserir o novo em qualquer
 * ordem na mesma transação. No COMMIT: todo usuário não apagado com o perfil vivo e ativo, da base de core.usuario.perfil (o
 * principal); sempre um admin com a gestão (RN-CORE-35). Trocar core.usuario.perfil para outra base substitui o vínculo (gatilho
 * usuario_perfil_principal). NÃO use `on conflict do nothing` sem alvo nesta tabela: o Postgres recusa restrição adiável como
 * árbitro (use `on conflict (id)`).
 */
export const usuarioPerfil = plataforma.table('usuario_perfil', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  perfil_id: uuid('perfil_id').notNull(),
});

/** Exceção por usuário — Sprint 0 só remove módulo (RN-CORE-01, esclarecimento). */
export const usuarioModulo = plataforma.table('usuario_modulo', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  modulo: text('modulo').notNull(),
  efeito: text('efeito', { enum: ['remover'] }).notNull().default('remover'),
  motivo: text('motivo'),
});

/** Outbox de eventos de domínio (`<modulo>.<entidade>.<fato>@N`). */
export const evento = plataforma.table('evento', {
  ...comuns(),
  nome: text('nome').notNull(),
  modulo: text('modulo').notNull(),
  agregado_id: uuid('agregado_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
  publicado_em: timestamp('publicado_em', { withTimezone: true }),
  tentativas: integer('tentativas').notNull().default(0),
  ultimo_erro: text('ultimo_erro'),
  /** Envelope do SDK (0003): autor e requisição de origem, para rastreio ponta a ponta. */
  usuario_id: uuid('usuario_id'),
  request_id: text('request_id'),
});

/**
 * Consumo idempotente da outbox (ADR 0007): uma linha por (tenant_id, consumidor, evento_id), gravada pelo
 * handler na transação do efeito (`on conflict (tenant_id, consumidor, evento_id) do nothing`).
 */
export const eventoConsumo = plataforma.table('evento_consumo', {
  ...comuns(),
  consumidor: text('consumidor').notNull(),
  evento_id: uuid('evento_id').notNull(),
  processado_em: timestamp('processado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const parametro = plataforma.table('parametro', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  chave: text('chave').notNull(),
  valor: jsonb('valor').notNull(),
});

/** RN-AUD-01. A aplicação só faz SELECT e INSERT (sem UPDATE/DELETE). */
export const auditoria = plataforma.table('auditoria', {
  ...comuns(),
  usuario_id: uuid('usuario_id'),
  modulo: text('modulo').notNull(),
  acao: text('acao').notNull(),
  entidade: text('entidade').notNull(),
  entidade_id: uuid('entidade_id'),
  antes: jsonb('antes'),
  depois: jsonb('depois'),
  request_id: text('request_id'),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Tipos aceitos em plataforma.arquivo (CHECK arquivo_tipo_valido, 0079); o TIPOS_ARQUIVO do platform-sdk fica contido aqui. */
export const TIPOS_ARQUIVO_BANCO = ['image/jpeg', 'image/png', 'image/webp', 'application/zip'] as const;

/**
 * Metadados de arquivo enviado pelo aparelho (0005, ADR 0010). id = UUID do aparelho. O módulo cria a linha
 * 'aguardando' na transação do comando que referencia o arquivo; a rota PUT /v1/arquivos/:id completa
 * ('recebido', sha256, tamanho, chave_armazenamento). Os bytes ficam atrás da porta ArmazenamentoArquivos. Fora do sync.
 */
export const arquivo = plataforma.table('arquivo', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  finalidade: text('finalidade').notNull(),
  entidade: text('entidade').notNull(),
  entidade_id: uuid('entidade_id').notNull(),
  cliente_id: uuid('cliente_id'),
  enviado_por: uuid('enviado_por').notNull(),
  /** 0079 (T-0174, ADR 0058): imagens até 8 MiB e o ZIP do lote de fotos até 500 MiB (CHECK arquivo_tamanho_faixa, por tipo). */
  tipo: text('tipo', { enum: TIPOS_ARQUIVO_BANCO }).notNull().default('image/jpeg'),
  tamanho_bytes: integer('tamanho_bytes'),
  sha256: text('sha256'),
  largura_px: integer('largura_px'),
  altura_px: integer('altura_px'),
  situacao: text('situacao', { enum: ['aguardando', 'recebido'] }).notNull().default('aguardando'),
  recebido_em: timestamp('recebido_em', { withTimezone: true }),
  chave_armazenamento: text('chave_armazenamento'),
  /**
   * 0057 (T-0147, ADR 0041): leitura restrita por perfil. NULO = regra da ADR 0010 (licença + perfil do módulo + carteira);
   * lista (1..7 PERFIS, sem nulo; CHECK arquivo_perfis_leitura_validos) = o usuário precisa de um destes perfis E da carteira.
   */
  perfis_leitura: text('perfis_leitura', { enum: PERFIS }).array(),
});

/**
 * Super-admin de plataforma (0035, T-0087, ADR 0029): FORA dos tenants, sem tenant_id (exceção à regra 5 em
 * db/src/excecoes.ts). RLS forçado SEM política e SEM grant para macuxi_app/macuxi_worker: a aplicação NUNCA consulta estas
 * tabelas direto (42501); usa as funções SECURITY DEFINER plataforma.sa_* (docs/banco/plataforma.md). O espelho existe só
 * para tipar o que as funções devolvem e para o teste Drizzle x banco.
 */
export const superAdmin = plataforma.table('super_admin', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  nome: text('nome').notNull(),
  /** argon2id (formato PHC), nunca a senha. */
  senha_hash: text('senha_hash').notNull(),
  /** AES-256-GCM `v1.<iv>.<tag>.<cifra>` (AAD = id); chave MACUXI_CHAVE_TOTP fora do banco. */
  totp_segredo_cifrado: text('totp_segredo_cifrado'),
  totp_pendente_cifrado: text('totp_pendente_cifrado'),
  totp_confirmado_em: timestamp('totp_confirmado_em', { withTimezone: true }),
  /** Último passo de 30 s aceito (sem reuso). */
  totp_ultimo_passo: bigint('totp_ultimo_passo', { mode: 'number' }),
  /** SHA-256 hex dos códigos de recuperação ainda não usados; nunca sai do banco (as funções devolvem só a contagem). */
  recuperacao_hashes: text('recuperacao_hashes').array().notNull().default(sql`'{}'::text[]`),
  falhas: integer('falhas').notNull().default(0),
  bloqueado_ate: timestamp('bloqueado_ate', { withTimezone: true }),
  ativo: boolean('ativo').notNull().default(true),
  ...auditaveis(),
});

/** 2ª etapa do login (0035): só o SHA-256 do desafio; 5 min; uso único (consumido_em). */
export const superAdminDesafio = plataforma.table('super_admin_desafio', {
  id: uuid('id').primaryKey().defaultRandom(),
  super_admin_id: uuid('super_admin_id').notNull(),
  desafio_hash: text('desafio_hash').notNull(),
  etapa: text('etapa', { enum: ['segundo_fator', 'cadastrar_totp'] }).notNull(),
  expira_em: timestamp('expira_em', { withTimezone: true }).notNull(),
  consumido_em: timestamp('consumido_em', { withTimezone: true }),
  ...auditaveis(),
});

/** Sessão do super-admin (0035): teto de 8 h, revogável, conferida a cada requisição (sa_sessao_valida). */
export const superAdminSessao = plataforma.table('super_admin_sessao', {
  id: uuid('id').primaryKey().defaultRandom(),
  super_admin_id: uuid('super_admin_id').notNull(),
  criada_em: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  ultimo_uso_em: timestamp('ultimo_uso_em', { withTimezone: true }).notNull().defaultNow(),
  expira_em: timestamp('expira_em', { withTimezone: true }).notNull(),
  revogada_em: timestamp('revogada_em', { withTimezone: true }),
  ...auditaveis(),
});

/**
 * Auditoria da plataforma (0035): APPEND-ONLY (gatilho recusa update/delete/truncate para todos). tenant_alvo_id e não
 * tenant_id de propósito: a exclusão de tenant (plataforma.excluir_tenant) apaga toda tabela com tenant_id, e esta sobrevive.
 * Sem dado pessoal: ids, modelo da rota (sem query), status, request_id e prefixo do IP (/24 ou /48).
 */
export const auditoriaPlataforma = plataforma.table('auditoria_plataforma', {
  id: uuid('id').primaryKey().defaultRandom(),
  super_admin_id: uuid('super_admin_id'),
  sessao_id: uuid('sessao_id'),
  tenant_alvo_id: uuid('tenant_alvo_id'),
  acao: text('acao').notNull(),
  metodo: text('metodo'),
  rota: text('rota'),
  status: integer('status'),
  request_id: text('request_id'),
  ip_prefixo: text('ip_prefixo'),
  /** 0039 (ADR 0031): quem agiu no portal; nulo nas linhas antigas, no login sem conta e nos fatos do deploy. */
  ator_tipo: text('ator_tipo', { enum: ['super_admin', 'admin_cliente'] }),
  /** 0039: core.usuario.id do admin do cliente (sem FK: sobrevive à exclusão do tenant). */
  usuario_id: uuid('usuario_id'),
  detalhes: jsonb('detalhes').$type<Record<string, unknown>>().notNull().default({}),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
  ...auditaveis(),
});

/**
 * Bloqueio do login do portal (0039, T-0093, ADR 0031) por CHAVE do e-mail: HMAC-SHA256 hex calculado no Node com o segredo
 * da plataforma (o e-mail nunca chega ao banco por aqui). Igual para e-mail que existe e que não existe. Só por função
 * (plataforma.sa_tentativa_*).
 */
export const portalTentativa = plataforma.table('portal_tentativa', {
  id: uuid('id').primaryKey().defaultRandom(),
  chave: text('chave').notNull(),
  /** 0 a 4; a 5ª falha seguida zera e bloqueia 15 min. */
  falhas: integer('falhas').notNull().default(0),
  bloqueado_ate: timestamp('bloqueado_ate', { withTimezone: true }),
  ...auditaveis(),
});

/**
 * Sessão do portal (0039, ADR 0031): super-admin (super_admin_id) ou admin do cliente (empresa atual em tenant_atual_id e
 * usuario_atual_id; nulas = ainda não escolheu). Teto de 8 h, revogável, conferida a cada requisição (sa_sessao_valida).
 */
export const portalSessao = plataforma.table('portal_sessao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tipo: text('tipo', { enum: ['super_admin', 'admin_cliente'] }).notNull(),
  super_admin_id: uuid('super_admin_id'),
  tenant_atual_id: uuid('tenant_atual_id'),
  usuario_atual_id: uuid('usuario_atual_id'),
  criada_em: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  ultimo_uso_em: timestamp('ultimo_uso_em', { withTimezone: true }).notNull().defaultNow(),
  expira_em: timestamp('expira_em', { withTimezone: true }).notNull(),
  revogada_em: timestamp('revogada_em', { withTimezone: true }),
  ...auditaveis(),
});

/**
 * Empresas conferidas no login do admin do cliente (0039, ADR 0031): 1 a 20 por sessão. tenant_alvo_id e não tenant_id de
 * propósito (como na auditoria_plataforma): não é tabela de tenant.
 */
export const portalSessaoEmpresa = plataforma.table('portal_sessao_empresa', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessao_id: uuid('sessao_id').notNull(),
  tenant_alvo_id: uuid('tenant_alvo_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  /** sessao_versao da conta no login (0040, T-0094): versão diferente na conta = a sessão cai (sa_sessao_valida). >= 0. */
  sessao_versao: integer('sessao_versao').notNull().default(0),
  ...auditaveis(),
});

/** bytea do Postgres (Buffer no node-postgres). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Outbox de e-mail (0040, T-0094, ADR 0032 §6): gravada pela API na MESMA transação da senha (macuxi_app, só select e insert
 * no próprio tenant); o despachante (macuxi_worker, todos os tenants, só linha pendente) envia e zera a carga. carga = texto
 * CIFRADO (AES-256-GCM: destinatário e dados do modelo), só no pendente (CHECK). chave_idempotencia única por tenant (sem
 * '@': nunca o e-mail). ultimo_erro só código curto. Fora do sync.
 */
export const emailSaida = plataforma.table('email_saida', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  modelo: text('modelo', { enum: ['acesso_inicial', 'nova_senha'] }).notNull(),
  chave_idempotencia: text('chave_idempotencia').notNull(),
  carga: bytea('carga'),
  tentativas: integer('tentativas').notNull().default(0),
  proxima_tentativa_em: timestamp('proxima_tentativa_em', { withTimezone: true }).notNull().defaultNow(),
  /** Padrão do banco: now() + 72 h (a validade da senha temporária). */
  expira_em: timestamp('expira_em', { withTimezone: true }).notNull().default(sql`now() + interval '72 hours'`),
  enviado_em: timestamp('enviado_em', { withTimezone: true }),
  falhou_em: timestamp('falhou_em', { withTimezone: true }),
  ultimo_erro: text('ultimo_erro'),
});

/**
 * Diagnóstico do aparelho (0058, T-0158, ADR 0043): só dado técnico; empresa e usuário por id (do token). O app (macuxi_app) só
 * insere as colunas do envio e lê o próprio tenant (repetição idempotente pelo id = UUID do aparelho); protocolo (sequência
 * global plataforma.diagnostico_protocolo_seq), recebido_em e alerta_* são do banco e do worker. O worker lê sem descricao e
 * sem detalhe e marca só alerta_*; o portal lê pelas sa_listar_diagnosticos / sa_diagnostico. Expurgo de 90 dias pela
 * plataforma.expurgar_diagnosticos. Fora do sync.
 */
export const diagnostico = plataforma.table('diagnostico', {
  ...comuns(),
  /** Número legível global ("nº 0042", formatarProtocolo do SDK). Padrão do banco: nextval da sequência; nunca grave. */
  protocolo: bigint('protocolo', { mode: 'number' }).notNull().default(sql`nextval('plataforma.diagnostico_protocolo_seq')`),
  usuario_id: uuid('usuario_id').notNull(),
  perfil: text('perfil', { enum: PERFIS }).notNull(),
  origem: text('origem', { enum: ['botao', 'queda', 'erro_tela'] }).notNull(),
  app: text('app', { enum: ['campo', 'gestao'] }).notNull(),
  versao_app: text('versao_app').notNull(),
  build: text('build'),
  aparelho_fabricante: text('aparelho_fabricante'),
  aparelho_modelo: text('aparelho_modelo'),
  android: text('android'),
  android_api: integer('android_api'),
  /** Rota do expo-router, sem query string nem fragmento (CHECK). */
  tela: text('tela'),
  motivo: text('motivo'),
  /** "O que aconteceu?" já mascarado pela API (mascararDadoPessoal). */
  descricao: text('descricao'),
  /** { erro?, saida_android?, sync?, ultimas_saidas? } (só estas chaves; até 32 KB; ultimas_saidas: até 5 saídas do Android). */
  detalhe: jsonb('detalhe').notNull().default({}),
  /** id do print em plataforma.arquivo (modulo 'plataforma', finalidade 'print_diagnostico'); sem FK. */
  print_id: uuid('print_id'),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull(),
  recebido_em: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  alerta_situacao: text('alerta_situacao', { enum: ['pendente', 'enviado', 'agrupado', 'falhou', 'desligado'] }).notNull().default('pendente'),
  alerta_tentativas: integer('alerta_tentativas').notNull().default(0),
  alerta_proxima_em: timestamp('alerta_proxima_em', { withTimezone: true }),
  alerta_recado_id: text('alerta_recado_id'),
  alerta_em: timestamp('alerta_em', { withTimezone: true }),
});

/** Adicional vendido pelo plano (RN-PLA-01): preço por licença ou por usuário, por mês; `incluidos` null = ilimitado incluso. */
export interface AdicionalDoPlanoLinha {
  adicional: 'promotor' | 'pesquisa' | 'treinamento';
  preco_unitario_centavos: number;
  incluidos: number | null;
}

/**
 * Catálogo de planos (0070, ADR 0047 §1): DADO da plataforma, fora dos tenants (exceção à regra 5, como a super_admin). Gravado só
 * pelas funções do dono; desde a 0081 o macuxi_app lê só o plano da assinatura viva do próprio tenant. Versão nova do plano =
 * linha nova; a antiga ganha deleted_at e as assinaturas continuam apontando para ela. Código único entre os vivos. Licenças
 * por tipo: null = sem limite. Os 4 planos de venda (light, pme, enterprise, corporate) vêm da 0081.
 */
export const plano = plataforma.table('plano', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `^[a-z][a-z0-9_]{1,29}$` (CodigoPlano do SDK). */
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  ordem: integer('ordem').notNull().default(0),
  preco_mensal_centavos: bigint('preco_mensal_centavos', { mode: 'number' }).notNull(),
  licenca_vendedor: integer('licenca_vendedor'),
  licenca_gestor: integer('licenca_gestor'),
  licenca_bko: integer('licenca_bko'),
  licenca_promotor: integer('licenca_promotor'),
  /** Só os 8 módulos do contrato (CHECK). */
  modulos: text('modulos').array().notNull().default(sql`'{}'::text[]`),
  adicionais: jsonb('adicionais').$type<AdicionalDoPlanoLinha[]>().notNull().default([]),
  meses_gratis_anual: integer('meses_gratis_anual').notNull().default(0),
  dias_teste: integer('dias_teste').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
  ...auditaveis(),
});

/**
 * Assinatura do tenant (0070, ADR 0047 §2): uma VIVA por tenant (assinatura_tenant_uk). Gravada só pela
 * plataforma.sa_gravar_assinatura (portal, super-admin); o macuxi_app lê só a do próprio tenant. teste_ate = último dia do
 * teste, inclusive, no fuso do tenant (null = sem teste); CHECK paga ou com teste. Fora do sync.
 */
export const assinatura = plataforma.table('assinatura', {
  ...comuns(),
  plano_id: uuid('plano_id').notNull(),
  ciclo: text('ciclo', { enum: ['mensal', 'anual'] }).notNull().default('mensal'),
  adicionais: jsonb('adicionais').$type<{ adicional: 'promotor' | 'pesquisa' | 'treinamento'; quantidade: number }[]>().notNull().default([]),
  teste_ate: date('teste_ate', { mode: 'string' }),
  paga: boolean('paga').notNull().default(false),
  /** UUID do portal que gravou (chave de idempotência da criação). */
  pedido_id: uuid('pedido_id').notNull(),
});

/**
 * Histórico das trocas de plano (0081, ADR 0047 §6, RN-PLA-05): uma linha por troca, gravada só pela plataforma.sa_trocar_plano
 * (portal, super-admin); o macuxi_app lê só as do próprio tenant. pedido_id = chave de idempotência do portal, única por tenant.
 * Fora do sync.
 */
export const assinaturaHistorico = plataforma.table('assinatura_historico', {
  ...comuns(),
  assinatura_id: uuid('assinatura_id').notNull(),
  pedido_id: uuid('pedido_id').notNull(),
  plano_anterior_id: uuid('plano_anterior_id').notNull(),
  plano_id: uuid('plano_id').notNull(),
  ciclo_anterior: text('ciclo_anterior', { enum: ['mensal', 'anual'] }).notNull(),
  ciclo: text('ciclo', { enum: ['mensal', 'anual'] }).notNull(),
  adicionais_anteriores: jsonb('adicionais_anteriores').$type<{ adicional: 'promotor' | 'pesquisa' | 'treinamento'; quantidade: number }[]>().notNull().default([]),
  adicionais: jsonb('adicionais').$type<{ adicional: 'promotor' | 'pesquisa' | 'treinamento'; quantidade: number }[]>().notNull().default([]),
  /** Módulos que a troca ligou (inseridos ou religados) no tenant_modulo. */
  modulos_ligados: text('modulos_ligados').array().notNull().default(sql`'{}'::text[]`),
  /** Super-admin que trocou (sem FK; a auditoria_plataforma guarda a sessão). */
  super_admin_id: uuid('super_admin_id'),
});

/**
 * Backup da empresa (0072, ADR 0052 §2, RN-PLA-08): um job por linha (id do portal), em_andamento -> pronto | falhou (-> apagado
 * na retenção, RN-PLA-11). empresa_id SEM FK e sem tenant_id: sobrevive à exclusão (exceção à regra 5). Só por função (sa_* do
 * portal e funções do worker); nenhum grant de tabela.
 */
export const backupEmpresa = plataforma.table('backup_empresa', {
  id: uuid('id').primaryKey(),
  empresa_id: uuid('empresa_id').notNull(),
  /** Código da empresa na hora do pedido (vai ao manifesto). */
  codigo: text('codigo').notNull(),
  situacao: text('situacao', { enum: SITUACOES_BACKUP }).notNull().default('em_andamento'),
  consistente: boolean('consistente').notNull().default(false),
  pedido_em: timestamp('pedido_em', { withTimezone: true }).notNull().defaultNow(),
  iniciado_em: timestamp('iniciado_em', { withTimezone: true }),
  concluido_em: timestamp('concluido_em', { withTimezone: true }),
  expira_em: timestamp('expira_em', { withTimezone: true }),
  progresso_pct: integer('progresso_pct').notNull().default(0),
  tamanho_bytes: bigint('tamanho_bytes', { mode: 'number' }),
  tabelas: integer('tabelas'),
  linhas: bigint('linhas', { mode: 'number' }),
  arquivos: integer('arquivos'),
  erro_codigo: text('erro_codigo'),
  /** Concessão do worker (10 min, renovada a cada página e parte). */
  bloqueado_ate: timestamp('bloqueado_ate', { withTimezone: true }),
  super_admin_id: uuid('super_admin_id'),
  sessao_id: uuid('sessao_id'),
  ...auditaveis(),
});

/** Parte confirmada do backup (0072): uma por (backup, tabela), com linhas, bytes e sha256. Só por função. */
export const backupEmpresaParte = plataforma.table('backup_empresa_parte', {
  id: uuid('id').primaryKey().defaultRandom(),
  backup_id: uuid('backup_id').notNull(),
  tabela: text('tabela').notNull(),
  ordem: integer('ordem').notNull(),
  linhas: bigint('linhas', { mode: 'number' }).notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  ...auditaveis(),
});

/**
 * Exclusão da empresa (0072, ADR 0052 §3, RN-PLA-09): job (id do portal), etapa banco -> arquivos -> fim. empresa_id SEM FK:
 * sobrevive à exclusão. contagem = linhas apagadas por tabela. Só por função.
 */
export const exclusaoEmpresa = plataforma.table('exclusao_empresa', {
  id: uuid('id').primaryKey(),
  empresa_id: uuid('empresa_id').notNull(),
  codigo: text('codigo').notNull(),
  backup_id: uuid('backup_id').notNull(),
  situacao: text('situacao', { enum: SITUACOES_EXCLUSAO }).notNull().default('em_andamento'),
  etapa: text('etapa', { enum: ETAPAS_EXCLUSAO }).notNull().default('banco'),
  pedida_em: timestamp('pedida_em', { withTimezone: true }).notNull().defaultNow(),
  concluida_em: timestamp('concluida_em', { withTimezone: true }),
  linhas_apagadas: bigint('linhas_apagadas', { mode: 'number' }),
  arquivos_apagados: bigint('arquivos_apagados', { mode: 'number' }),
  contagem: jsonb('contagem').$type<Record<string, number>>(),
  erro_codigo: text('erro_codigo'),
  bloqueado_ate: timestamp('bloqueado_ate', { withTimezone: true }),
  super_admin_id: uuid('super_admin_id'),
  sessao_id: uuid('sessao_id'),
  ...auditaveis(),
});

/**
 * Empresa excluída (0072, ADR 0052 §3.4, RN-PLA-10): id = o do tenant apagado. O código nunca é reaproveitado (gatilho
 * tenant_codigo_nao_reaproveitado e sortear_codigo_licenca). Só por função.
 */
export const empresaExcluida = plataforma.table('empresa_excluida', {
  id: uuid('id').primaryKey(),
  codigo: text('codigo').notNull(),
  /** CNPJ da empresa (dado da empresa, não pessoal). */
  documento: text('documento'),
  razao_social: text('razao_social').notNull(),
  excluida_em: timestamp('excluida_em', { withTimezone: true }).notNull().defaultNow(),
  backup_id: uuid('backup_id').notNull(),
  exclusao_id: uuid('exclusao_id').notNull(),
  super_admin_id: uuid('super_admin_id'),
  ...auditaveis(),
});

/**
 * Dados legais da Macuxi (0073, rodapé legal; docs/design/telas/rodape-legal.md §3.2): UMA linha só, dado da PLATAFORMA
 * (sem tenant_id, exceção em db/src/excecoes.ts). RLS forçado sem política nem grant para os papéis da aplicação: a API lê
 * por plataforma.dados_legais_publicos() (app) e plataforma.sa_dados_legais() (portal) e grava por
 * plataforma.sa_gravar_dados_legais() (portal, super-admin). O espelho existe só para tipar e para o teste Drizzle x banco.
 */
export const dadosLegais = plataforma.table('dados_legais', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Sem espaços nas pontas, não vazia, até 120 (CHECK); nulo = sem valor. */
  razao_social: text('razao_social'),
  /** Só os 14 dígitos (CHECK); o dígito verificador é conferido no contrato e na API. */
  cnpj: text('cnpj'),
  /** Só o domínio, em minúsculas (CHECK com o DOMINIO_RE do SDK). */
  site: text('site').notNull().default('macuxifdv.com.br'),
  /** plataforma.super_admin.id de quem gravou por último; nulo na linha da migração. */
  atualizado_por: uuid('atualizado_por'),
  ...auditaveis(),
});

/**
 * Pacote pronto da primeira carga (0074, ADR 0054; desenho docs/desenho/T-catalogo-pacote.md §1.4): um .sqlite.gz por
 * (tenant, módulo, partição), gerado pelo worker. particao 'tenant' ou 'filial:<uuid>' (filial_id só e sempre na de filial);
 * chave_armazenamento = 'sync-pacotes/<tenant_id>/<modulo>/<particao>/<id>.sqlite.gz' (CHECK). Uma só linha 'pronto' viva por
 * partição. pronto -> substituido (substituido_em) -> apagado (arquivo_apagado_em). O app só lê; o worker grava. Fora do sync.
 */
export const syncPacote = plataforma.table('sync_pacote', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  particao: text('particao').notNull(),
  filial_id: uuid('filial_id'),
  /** FORMATO_PACOTE_SYNC do SDK (1). */
  formato: integer('formato').notNull().default(1),
  situacao: text('situacao', { enum: ['pronto', 'substituido', 'apagado'] }).notNull().default('pronto'),
  /** Relógio do banco na geração: toda linha viva com updated_at < horizonte está no arquivo (cursor do manifesto). */
  horizonte: timestamp('horizonte', { withTimezone: true }).notNull(),
  geracao_base: uuid('geracao_base').notNull(),
  chave_armazenamento: text('chave_armazenamento').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  md5: text('md5').notNull(),
  /** { <entidade>: linhas } (o mesmo do _pacote.entidades do arquivo). */
  entidades: jsonb('entidades').$type<Record<string, number>>().notNull(),
  substituido_em: timestamp('substituido_em', { withTimezone: true }),
  arquivo_apagado_em: timestamp('arquivo_apagado_em', { withTimezone: true }),
});

/**
 * Pedido de geração de pacote (0074, ADR 0054; desenho §1.4): origem lote (integracao.lote.concluido@1), manifesto (GET
 * /v1/sync/pacotes sem pacote pronto) ou agendado (mais de 24 h com mudança). Um só pendente vivo por partição (insert ... on
 * conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null do nothing). O app só insere
 * (id, tenant_id, modulo, particao, filial_id, origem); o worker atende. Fora do sync.
 */
export const syncPacotePedido = plataforma.table('sync_pacote_pedido', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  particao: text('particao').notNull(),
  filial_id: uuid('filial_id'),
  origem: text('origem', { enum: ['lote', 'manifesto', 'agendado'] }).notNull(),
  situacao: text('situacao', { enum: ['pendente', 'atendido', 'descartado'] }).notNull().default('pendente'),
  gerar_apos: timestamp('gerar_apos', { withTimezone: true }).notNull().defaultNow(),
  tentativas: integer('tentativas').notNull().default(0),
  /** Só código curto (sem dado pessoal). */
  ultimo_erro: text('ultimo_erro'),
  atendido_em: timestamp('atendido_em', { withTimezone: true }),
});

/** Situações de plataforma.trabalho (CHECK trabalho_situacao_valida, 0079). */
export const SITUACOES_TRABALHO_BANCO = ['pendente', 'em_execucao', 'concluido', 'falhou'] as const;

/**
 * Trabalho sob demanda de um módulo (0079, T-0174, ADR 0058): disparado por evento da outbox, executado em fatias pelo worker.
 * Um vivo por (tenant, modulo, nome, alvo_id) (trabalho_alvo_uk: o consumidor grava com insert ... on conflict do nothing).
 * O macuxi_app só lê e insere no próprio tenant; a situação, a trava e os contadores mudam só pelas funções do worker
 * plataforma.trabalho_reservar / trabalho_devolver / trabalho_renovar (SECURITY DEFINER, só tenants ativos). Fora do sync.
 */
export const trabalho = plataforma.table('trabalho', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  nome: text('nome').notNull(),
  /** Entidade do módulo que o trabalho processa (ex.: catalogo.foto_lote.id); sem FK. */
  alvo_id: uuid('alvo_id').notNull(),
  /** Evento da outbox que disparou o trabalho; sem FK (a outbox tem retenção). */
  evento_id: uuid('evento_id'),
  situacao: text('situacao', { enum: SITUACOES_TRABALHO_BANCO }).notNull().default('pendente'),
  tentativas: integer('tentativas').notNull().default(0),
  fatias: integer('fatias').notNull().default(0),
  proxima_em: timestamp('proxima_em', { withTimezone: true }).notNull().defaultNow(),
  travado_ate: timestamp('travado_ate', { withTimezone: true }),
  travado_por: text('travado_por'),
  /** Só código (^[A-Za-z0-9_.:-]{1,100}$): nunca mensagem nem dado pessoal. */
  ultimo_erro: text('ultimo_erro'),
  /** Fim em 'concluido' ou 'falhou' (CHECK trabalho_concluido_coerente). */
  concluido_em: timestamp('concluido_em', { withTimezone: true }),
});
