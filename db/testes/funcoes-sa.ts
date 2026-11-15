/**
 * Funções SECURITY DEFINER do portal de plataforma, na forma do regprocedure. EXECUTE só ao macuxi_portal desde a 0038
 * (T-0091; nunca PUBLIC, o macuxi_app nem o macuxi_worker).
 *
 * FUNCOES_SA_0035: as 20 da 0035 (T-0087, ADR 0029; na 0035, EXECUTE ao macuxi_app). Valem até a 0038: a 0039 apaga 14
 * delas e reescreve as outras 6 (o down da 0039 as recria). Usadas pelos testes estáticos da 0035 e da 0038 e pelos bancos
 * efêmeros parados nessas versões.
 */
export const FUNCOES_SA_0035 = [
  'plataforma.sa_existe()',
  'plataforma.sa_criar_primeiro(text, text, text)',
  'plataforma.sa_para_login(text)',
  'plataforma.sa_por_id(uuid)',
  'plataforma.sa_registrar_falha(uuid)',
  'plataforma.sa_registrar_sucesso(uuid)',
  'plataforma.sa_gravar_totp_pendente(uuid, text)',
  'plataforma.sa_confirmar_totp(uuid, bigint, text[])',
  'plataforma.sa_marcar_passo(uuid, bigint)',
  'plataforma.sa_usar_recuperacao(uuid, text)',
  'plataforma.sa_regerar_recuperacao(uuid, text[])',
  'plataforma.sa_abrir_desafio(uuid, text)',
  'plataforma.sa_ver_desafio(text)',
  'plataforma.sa_abrir_sessao(text)',
  'plataforma.sa_sessao_valida(uuid)',
  'plataforma.sa_revogar(uuid)',
  'plataforma.sa_auditar(jsonb)',
  'plataforma.sa_listar_tenants(uuid)',
  'plataforma.sa_tenant_ativo(uuid, uuid)',
  'plataforma.sa_provisionar_tenant(uuid, jsonb)',
] as const;

/** As 14 da 0035 que a 0039 (T-0093, ADR 0031) apaga: convite, TOTP, recuperação, desafio e o login por conta. */
export const FUNCOES_SA_REMOVIDAS_0039 = [
  'plataforma.sa_existe()',
  'plataforma.sa_criar_primeiro(text, text, text)',
  'plataforma.sa_para_login(text)',
  'plataforma.sa_por_id(uuid)',
  'plataforma.sa_registrar_falha(uuid)',
  'plataforma.sa_registrar_sucesso(uuid)',
  'plataforma.sa_gravar_totp_pendente(uuid, text)',
  'plataforma.sa_confirmar_totp(uuid, bigint, text[])',
  'plataforma.sa_marcar_passo(uuid, bigint)',
  'plataforma.sa_usar_recuperacao(uuid, text)',
  'plataforma.sa_regerar_recuperacao(uuid, text[])',
  'plataforma.sa_abrir_desafio(uuid, text)',
  'plataforma.sa_ver_desafio(text)',
  'plataforma.sa_abrir_sessao(text)',
] as const;

/**
 * As 12 sa_* públicas da 0039 (T-0093, ADR 0031; a 0040 recria 4 com as mesmas assinaturas e a 0041 não mexe): login só com
 * e-mail e senha, bloqueio por chave do e-mail, sessão por empresa. EXECUTE só ao macuxi_portal. Contrato com o Core e a API:
 * R-20261107-150432-banco-dados. O banco migrado até o fim tem também as da 0042 (FUNCOES_SA_ATUAIS).
 */
export const FUNCOES_SA = [
  'plataforma.sa_tentativa_estado(text)',
  'plataforma.sa_tentativa_falha(text)',
  'plataforma.sa_tentativa_sucesso(text)',
  'plataforma.sa_contas_para_login(text)',
  'plataforma.sa_abrir_sessao_portal(jsonb)',
  'plataforma.sa_escolher_empresa(uuid, uuid)',
  'plataforma.sa_sessao_valida(uuid)',
  'plataforma.sa_revogar(uuid)',
  'plataforma.sa_auditar(jsonb)',
  'plataforma.sa_listar_tenants(uuid)',
  'plataforma.sa_tenant_ativo(uuid, uuid)',
  'plataforma.sa_provisionar_tenant(uuid, jsonb)',
] as const;

/**
 * As 2 sa_* da 0042 (T-0094, padrão de fábrica da T-0111; R-20261107-185546): o super-admin lista os admins da empresa e
 * redefine a senha de um deles (senha temporária de 72 h, e-mail na outbox). EXECUTE só ao macuxi_portal.
 */
export const FUNCOES_SA_0042 = [
  'plataforma.sa_admins_da_empresa(uuid, uuid)',
  'plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea)',
] as const;

/**
 * As 2 sa_* da 0058 (T-0158, ADR 0043; R-20261110-114603-engenheiro-software): o super-admin lista os diagnósticos dos
 * aparelhos (filtros e keyset) e abre o detalhe (com a chave do print). EXECUTE só ao macuxi_portal; admin do cliente = 42501.
 */
export const FUNCOES_SA_0058 = ['plataforma.sa_listar_diagnosticos(uuid, jsonb)', 'plataforma.sa_diagnostico(uuid, uuid)'] as const;

/**
 * As 14 sa_* públicas do banco parado entre a 0042 e a 0057: as 12 da 0039/0040 (FUNCOES_SA) + as 2 da 0042. Use nas
 * conferências de bancos efêmeros migrados até uma versão dessa faixa (ex.: o up/down da 0042).
 */
export const FUNCOES_SA_ATE_0057 = [...FUNCOES_SA, ...FUNCOES_SA_0042] as const;

/** As 16 sa_* públicas do banco parado entre a 0058 e a 0069: as 14 até a 0057 (FUNCOES_SA_ATE_0057) + as 2 da 0058. */
export const FUNCOES_SA_ATE_0069 = [...FUNCOES_SA_ATE_0057, ...FUNCOES_SA_0058] as const;

/**
 * A sa_* da 0070 (ADR 0047; planos e licenças): o super-admin grava a assinatura da empresa criada pelo passo "Empresa com
 * plano" (apps/api/src/planos-portal.ts). EXECUTE só ao macuxi_portal; admin do cliente = 42501.
 */
export const FUNCOES_SA_0070 = ['plataforma.sa_gravar_assinatura(uuid, uuid, jsonb)'] as const;

/** As 17 sa_* públicas do banco parado na 0070 ou na 0071: as 16 até a 0069 (FUNCOES_SA_ATE_0069) + a da 0070. */
export const FUNCOES_SA_ATE_0071 = [...FUNCOES_SA_ATE_0069, ...FUNCOES_SA_0070] as const;

/**
 * As 8 sa_* da 0072 (ADR 0052; inativar, backup e excluir a empresa no portal): só super-admin (sessão inválida 28000, admin do
 * cliente 42501). EXECUTE só ao macuxi_portal.
 */
export const FUNCOES_SA_0072 = [
  'plataforma.sa_inativar_tenant(uuid, uuid, text)',
  'plataforma.sa_reativar_tenant(uuid, uuid)',
  'plataforma.sa_pedir_backup(uuid, uuid, uuid)',
  'plataforma.sa_listar_backups(uuid, uuid, uuid)',
  'plataforma.sa_pedir_exclusao(uuid, uuid, uuid, uuid, text)',
  'plataforma.sa_ler_exclusao(uuid, uuid)',
  'plataforma.sa_reautenticar(uuid)',
  'plataforma.sa_acoes_das_empresas(uuid)',
] as const;

/** As 25 sa_* públicas do banco parado na 0072: as 17 até a 0071 (FUNCOES_SA_ATE_0071) + as 8 da 0072. */
export const FUNCOES_SA_ATE_0072 = [...FUNCOES_SA_ATE_0071, ...FUNCOES_SA_0072] as const;

/**
 * As 2 sa_* da 0073 (rodapé legal, docs/design/telas/rodape-legal.md §3.2): o super-admin lê e grava os dados legais da Macuxi
 * (razão social, CNPJ e site). EXECUTE só ao macuxi_portal; admin do cliente = 42501. A leitura pública
 * (plataforma.dados_legais_publicos(), do macuxi_app) não é sa_* e fica em DADOS_LEGAIS_PUBLICOS.
 */
export const FUNCOES_SA_0073 = ['plataforma.sa_dados_legais(uuid)', 'plataforma.sa_gravar_dados_legais(uuid, jsonb)'] as const;
/** A leitura pública dos dados legais (0073): SECURITY DEFINER, sem sessão; EXECUTE só ao macuxi_app. */
export const DADOS_LEGAIS_PUBLICOS = 'plataforma.dados_legais_publicos()';

/** As 27 sa_* públicas do banco parado na 0073 (até a 0083): as 25 até a 0072 (FUNCOES_SA_ATE_0072) + as 2 da 0073. */
export const FUNCOES_SA_ATE_0083 = [...FUNCOES_SA_ATE_0072, ...FUNCOES_SA_0073] as const;

/**
 * As 3 sa_* da 0084 (ADR 0047; planos e licenças no portal, apps/api/src/planos-portal.ts): o catálogo (super-admin e admin do
 * cliente), a ficha da empresa (admin do cliente só a da sessão) e a troca de plano (só super-admin). EXECUTE só ao macuxi_portal.
 */
export const FUNCOES_SA_0084 = [
  'plataforma.sa_listar_planos(uuid)',
  'plataforma.sa_assinatura_da_empresa(uuid, uuid)',
  'plataforma.sa_trocar_plano(uuid, uuid, jsonb)',
] as const;

/**
 * As sa_* públicas do banco migrado até a ÚLTIMA (0084): as 27 até a 0083 (FUNCOES_SA_ATE_0083) + as 3 da 0084 = 30. Use esta
 * lista nas conferências pelo catálogo do banco migrado até o fim; a FUNCOES_SA continua sendo a do banco parado na 0039, 0040
 * ou 0041. Lote que acrescentar sa_* entre a 0075 e a 0083 entra em FUNCOES_SA_ATE_0083.
 */
export const FUNCOES_SA_ATUAIS = [...FUNCOES_SA_ATE_0083, ...FUNCOES_SA_0084] as const;

/**
 * Funções do worker da 0072 (ADR 0052): SECURITY DEFINER, EXECUTE só ao macuxi_worker (o tenant sai da linha do job).
 */
export const FUNCOES_WORKER_0072 = [
  'plataforma.tenant_esta_ativo(uuid)',
  'plataforma.pegar_backup()',
  'plataforma.tabelas_do_backup(uuid)',
  'plataforma.exportar_backup_pagina(uuid, text, jsonb, integer)',
  'plataforma.registrar_parte_backup(uuid, text, bigint, bigint, text)',
  'plataforma.fechar_backup(uuid, jsonb)',
  'plataforma.backups_vencidos(integer)',
  'plataforma.marcar_backup_apagado(uuid)',
  'plataforma.pegar_exclusao()',
  'plataforma.executar_exclusao(uuid)',
  'plataforma.fechar_exclusao(uuid, jsonb)',
] as const;

/** Interna (SECURITY INVOKER, sem EXECUTE para ninguém além do dono), chamada de dentro das sa_*: assinatura da 0039. */
export const SA_INTERNA = 'plataforma.sa_registrar_auditoria(text, uuid, uuid, uuid, uuid, text, jsonb)';
/** A interna da 0035 (5 argumentos), que a 0039 troca pela SA_INTERNA. */
export const SA_INTERNA_0035 = 'plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb)';
/** Do deploy (0039): sem EXECUTE para app, worker ou portal; só a conexão de administração (dono) chama. */
export const CRIAR_SUPER_ADMIN = 'plataforma.criar_super_admin(jsonb)';
