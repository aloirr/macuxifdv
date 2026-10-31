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
] as const;
