/**
 * @macuxi/db — utilitários de banco do Macuxi FDV (dono: banco-dados).
 * A API usa `comTenant` (contexto de tenant por transação) com a URL do papel macuxi_app.
 */
export { lerConfig, lerConfigApp, exigirBancoDemo, ehBancoLocal, HOSTS_LOCAIS, AMBIENTE_DEMO, urlAdmin, urlApp, urlWorker, PAPEL_APP, PAPEL_WORKER, type ConfigBanco } from './config';
export { comTenant, definirTenant } from './contexto';
export { migrarUp, migrarDown, lerMigracoes, listarAplicadas } from './migrador';
export { garantirPapelApp, garantirPapelWorker, diagnosticarPapelApp } from './papeis';
export { hashSenha, verificarSenha } from './senha';
