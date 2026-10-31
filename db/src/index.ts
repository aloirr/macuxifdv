/**
 * @macuxi/db — utilitários de banco do Macuxi FDV (dono: banco-dados).
 * A API usa `comTenant` (contexto de tenant por transação) com a URL do papel macuxi_app.
 */
export { lerConfig, urlAdmin, urlApp, PAPEL_APP, type ConfigBanco } from './config';
export { comTenant, definirTenant } from './contexto';
export { migrarUp, migrarDown, lerMigracoes, listarAplicadas } from './migrador';
export { garantirPapelApp, diagnosticarPapelApp } from './papeis';
export { hashSenha, verificarSenha } from './senha';
