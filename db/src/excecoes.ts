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
} as const;

/**
 * Tabelas com RLS ligado e FORÇADO e SEM política nem grant para o macuxi_app e o macuxi_worker (0035, ADR 0029): a
 * aplicação lê 0 linhas (42501 direto, sem grant) e só chega aos dados pelas funções SECURITY DEFINER revisadas. Têm só a
 * política manutencao (0031). Os testes de conformidade aceitam "sem política para o macuxi_app" SÓ nestas.
 */
export const TABELAS_SO_POR_FUNCAO = [
  'plataforma.super_admin',
  'plataforma.super_admin_desafio',
  'plataforma.super_admin_sessao',
  'plataforma.auditoria_plataforma',
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
  /** Metadados de arquivo (0005, ADR 0010): a foto vai pela fila de arquivos, a linha nunca é puxada. */
  'plataforma.arquivo',
  /** Contador do número legível do pedido (0009, T-0029): uma linha por tenant, só o servidor usa. */
  'vendedor.numeracao_pedido',
  /** Cota de IA por usuário/dia (0013, RN-CAT-03): só o servidor usa (catalogo.debitar_cota_ia). */
  'catalogo.uso_ia',
  /** Log de busca (0013, RF-CAT-07): só o BKO lê (termos sem resultado). */
  'catalogo.busca_log',
  /** Notas do ERP (0019, T-0066): base do recálculo de core.historico_compra; só o resumo vai ao aparelho. */
  'core.nota_erp',
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
