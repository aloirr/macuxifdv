/**
 * Exceções declaradas à regra 5 do CLAUDE.md (toda tabela com tenant_id e RLS).
 * Os testes de conformidade (db/testes e tests/integracao/banco) leem esta lista.
 */
export const TABELAS_SEM_TENANT_ID = {
  /** O próprio id é o tenant; RLS por `id = plataforma.tenant_atual()`. */
  'plataforma.tenant': 'id é o tenant (RLS por id)',
  /** Controle do executor de migrações; sem RLS e sem acesso do papel de aplicação. */
  'public.macuxi_migracao': 'controle de migrações (sem acesso do macuxi_app)',
} as const;

/** Tabelas sem o índice de sync (tenant_id, updated_at, id): não são puxadas pelo app. */
export const TABELAS_FORA_DO_SYNC = [
  'plataforma.evento',
  'plataforma.evento_consumo',
  'plataforma.auditoria',
  /** Autenticação do Core (0004): ficam só na nuvem, nunca vão ao aparelho. */
  'core.sessao',
  'core.dispositivo',
  /** Metadados de arquivo (0005, ADR 0010): a foto vai pela fila de arquivos, a linha nunca é puxada. */
  'plataforma.arquivo',
  /** Contador do número legível do pedido (0009, T-0029): uma linha por tenant, só o servidor usa. */
  'vendedor.numeracao_pedido',
  /** Cota de IA por usuário/dia (0013, RN-CAT-03): só o servidor usa (catalogo.debitar_cota_ia). */
  'catalogo.uso_ia',
  /** Log de busca (0013, RF-CAT-07): só o BKO lê (termos sem resultado). */
  'catalogo.busca_log',
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
