/**
 * Exceções declaradas à regra 5 do CLAUDE.md (toda tabela com tenant_id e RLS).
 * Os testes de conformidade (db/testes e tests/integracao/banco) leem esta lista.
 */
export const TABELAS_SEM_TENANT_ID = {
  /** O próprio id é o tenant; RLS por `id = plataforma.tenant_atual()`. */
  'plataforma.tenant': 'id é o tenant (RLS por id)',
  /** Controle do executor de migrações; sem RLS e sem acesso do papel de aplicação. */
  'public.macuxi_migracao': 'controle de migrações (sem acesso do macuxi_app)',
  /**
   * Super-admin de plataforma (0035, T-0087, ADR 0029): identidade FORA dos tenants. Sem tenant_id, sem política e sem grant
   * para o macuxi_app; acesso só pelas funções SECURITY DEFINER plataforma.sa_* (ver TABELAS_SO_POR_FUNCAO).
   */
  'plataforma.super_admin': 'super-admin de plataforma, fora dos tenants (ADR 0029); só por função',
  'plataforma.super_admin_desafio': 'desafio da 2ª etapa do login do super-admin (ADR 0029); só por função',
  'plataforma.super_admin_sessao': 'sessão do super-admin (ADR 0029); só por função',
  /** tenant_alvo_id (nulo fora de tenant, sem FK) no lugar de tenant_id: sobrevive à plataforma.excluir_tenant. */
  'plataforma.auditoria_plataforma': 'auditoria append-only do super-admin, sobrevive à exclusão do tenant (ADR 0029); só por função',
  /** Portal só com e-mail e senha (0039, T-0093, ADR 0031): fora dos tenants, só pelas funções plataforma.sa_*. */
  'plataforma.portal_tentativa': 'bloqueio do login do portal por chave HMAC do e-mail (ADR 0031); só por função',
  'plataforma.portal_sessao': 'sessão do portal, super-admin ou admin do cliente (ADR 0031); só por função',
  /** tenant_alvo_id (sem FK) no lugar de tenant_id, como na auditoria_plataforma: não é tabela de tenant. */
  'plataforma.portal_sessao_empresa': 'empresas conferidas no login do portal (ADR 0031); só por função',
  /**
   * Catálogo de planos (0070, ADR 0047 §1): dado da PLATAFORMA, igual para todos os tenants; gravado só pelas funções do dono.
   * Desde a 0081 o macuxi_app LÊ só a linha do plano da assinatura viva do próprio tenant (política isolamento_tenant pelo id).
   */
  'plataforma.plano': 'catálogo de planos da plataforma, fora dos tenants (ADR 0047); o app lê só o plano do próprio tenant (0081)',
  /**
   * Ações da empresa (0072, ADR 0052): empresa_id SEM FK no lugar de tenant_id, de propósito, como a auditoria_plataforma: o
   * backup, a exclusão e o registro da empresa excluída sobrevivem à plataforma.excluir_tenant. Só pelas funções sa_* e do worker.
   */
  'plataforma.backup_empresa': 'backup da empresa, sobrevive à exclusão do tenant (ADR 0052); só por função',
  'plataforma.backup_empresa_parte': 'partes confirmadas do backup da empresa (ADR 0052); só por função',
  'plataforma.exclusao_empresa': 'job da exclusão da empresa, sobrevive à exclusão do tenant (ADR 0052); só por função',
  'plataforma.empresa_excluida': 'registro da empresa excluída, código nunca reaproveitado (ADR 0052, RN-PLA-10); só por função',
  /** Dados legais da Macuxi (0073, rodapé legal): dado da PLATAFORMA, uma linha só; só pelas funções plataforma.sa_* e dados_legais_publicos. */
  'plataforma.dados_legais': 'razão social, CNPJ e site da Macuxi, fora dos tenants (rodape-legal.md §3.2); só por função',
} as const;

/**
 * Tabelas com RLS ligado e FORÇADO e SEM política nem grant para o macuxi_app e o macuxi_worker (0035, ADR 0029; 0039, ADR 0031): a
 * aplicação lê 0 linhas (42501 direto, sem grant) e só chega aos dados pelas funções SECURITY DEFINER revisadas. Têm só a
 * política manutencao (0031). Os testes de conformidade aceitam "sem política para o macuxi_app" SÓ nestas.
 */
export const TABELAS_SO_POR_FUNCAO = [
  'plataforma.super_admin',
  'plataforma.super_admin_desafio',
  'plataforma.super_admin_sessao',
  'plataforma.auditoria_plataforma',
  /** 0039 (T-0093, ADR 0031): bloqueio por chave do e-mail e sessão do portal por empresa. */
  'plataforma.portal_tentativa',
  'plataforma.portal_sessao',
  'plataforma.portal_sessao_empresa',
  /** 0072 (ADR 0052): backup, exclusão e empresa excluída; lidos e gravados só pelas sa_* do portal e pelas funções do worker. */
  'plataforma.backup_empresa',
  'plataforma.backup_empresa_parte',
  'plataforma.exclusao_empresa',
  'plataforma.empresa_excluida',
  /** 0073 (rodapé legal): lida pela dados_legais_publicos (app) e pelas sa_* do portal; gravada só pela sa_gravar_dados_legais. */
  'plataforma.dados_legais',
] as const;

/** Tabelas sem o índice de sync (tenant_id, updated_at, id): não são puxadas pelo app. */
export const TABELAS_FORA_DO_SYNC = [
  'plataforma.evento',
  'plataforma.evento_consumo',
  'plataforma.auditoria',
  /** Autenticação do Core (0004): ficam só na nuvem, nunca vão ao aparelho. */
  'core.sessao',
  'core.dispositivo',
  /** Convite de 1º acesso (0036, T-0087, RN-CORE-31): só o hash do token; o aceite é na API, nunca vai ao aparelho. */
  'core.usuario_convite',
  /** Outbox de e-mail (0040, T-0094, ADR 0032): carga cifrada com a senha; só a API grava e só o despachante lê. */
  'plataforma.email_saida',
  /**
   * Perfis de acesso (0041, T-0111/T-0112, ADR 0033): a API resolve a cada requisição (plataforma.perfis_do_usuario) e o
   * aparelho recebe só as chaves efetivas por GET /v1/me/modulos; as linhas nunca são puxadas.
   */
  'plataforma.perfil',
  'plataforma.perfil_permissao',
  'plataforma.usuario_perfil',
  /** Metadados de arquivo (0005, ADR 0010): a foto vai pela fila de arquivos, a linha nunca é puxada. */
  'plataforma.arquivo',
  /** Diagnóstico do aparelho (0058, T-0158, ADR 0043): o app só envia (POST /v1/diagnosticos); só o portal do super-admin lê. */
  'plataforma.diagnostico',
  /** Assinatura do tenant (0070, ADR 0047 §2): uma por tenant; o portal grava (sa_gravar_assinatura) e a API lê; nunca vai ao aparelho. */
  'plataforma.assinatura',
  /** Histórico das trocas de plano (0081, ADR 0047 §6): só a sa_trocar_plano grava; nunca vai ao aparelho. */
  'plataforma.assinatura_historico',
  /** Pacote da primeira carga (0074, ADR 0054): o aparelho baixa o arquivo pelo manifesto GET /v1/sync/pacotes; as linhas nunca são puxadas. */
  'plataforma.sync_pacote',
  'plataforma.sync_pacote_pedido',
  /** Trabalho sob demanda (0079, T-0174, ADR 0058): só a API e o worker usam. */
  'plataforma.trabalho',
  /** Lote de fotos por ZIP e o relatório por arquivo (0079, T-0174, RN-CAT-14): só o BKO lê; a foto ligada vai ao aparelho pela produto_midia. */
  'catalogo.foto_lote',
  'catalogo.foto_lote_item',
  /** Contador do número legível do pedido (0009, T-0029): uma linha por tenant, só o servidor usa. */
  'vendedor.numeracao_pedido',
  /** Contador do Código FDV (0080, T-0175, RN-CORE-59): uma linha por tenant, só o gatilho de core.usuario grava; o código vai no usuário. */
  'core.usuario_codigo_fdv_contador',
  /** Cota de IA por usuário/dia (0013, RN-CAT-03): só o servidor usa (catalogo.debitar_cota_ia). */
  'catalogo.uso_ia',
  /** Log de busca (0013, RF-CAT-07): só o BKO lê (termos sem resultado). */
  'catalogo.busca_log',
  /** Notas do ERP (0019, T-0066): base do recálculo de core.historico_compra; só o resumo vai ao aparelho. */
  'core.nota_erp',
  /** Devolução do pedido (0050, T-0054, RN-VEN-37): só o servidor grava e soma; o aparelho recebe o devolvido pelo resumo do pedido. */
  'vendedor.pedido_devolucao',
  /** Hub de Integração (0010, T-0032): nada do schema integracao vai ao aparelho (o que o app vê chega pelos eventos). */
  'integracao.conector',
  'integracao.credencial',
  'integracao.politica_versao',
  'integracao.sessao_carga',
  'integracao.sessao_carga_recebido',
  'integracao.lote',
  'integracao.lote_staging',
  'integracao.lote_linha_erro',
  'integracao.registro_atual',
  'integracao.pendencia_inativacao',
  'integracao.inativacao_auditoria',
  'integracao.cursor_entidade',
  'integracao.reconciliacao',
  'integracao.mapeamento',
  'integracao.pedido_fila_erp',
  'integracao.pedido_retorno',
  'integracao.pedido_retorno_erro',
] as const;

/**
 * Colunas que já existem no banco mas ainda NÃO estão no espelho Drizzle do módulo, por trava de outra sessão.
 * Os testes Drizzle x SQL/banco aceitam a coluna com ou sem espelho. Tirar daqui quando o espelho entrar.
 * Vazia desde a T-0070: vendedor.pedido_item (0018: medida, quantidade_embalagem, quantidade_unidades) ganhou espelho em
 * modules/vendedor/db/nuvem.ts, como colunas comuns documentadas "somente leitura — nunca grave" (gatilho pedido_item_medida).
 */
export const COLUNAS_SEM_ESPELHO_DRIZZLE: Readonly<Record<string, readonly string[]>> = {};
