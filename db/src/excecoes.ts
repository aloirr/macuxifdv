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
  /** Frases da tela de carga (0082, T-0181): cadastro GLOBAL do super-admin, vale para todas as empresas; só por função. */
  'plataforma.frase_carga': 'frases da tela de carga, globais (T-0181); portal pelas sa_*_frase_carga, app pela frases_carga_ativas()',
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
  /** 0082 (T-0181): frases da tela de carga; o app lê pela plataforma.frases_carga_ativas(), o portal pelas sa_*_frase_carga. */
  'plataforma.frase_carga',
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
  /** Contador do número legível do pedido (0009, T-0029): uma linha por tenant, só o servidor usa. */
  'vendedor.numeracao_pedido',
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
