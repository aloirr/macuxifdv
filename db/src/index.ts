/**
 * @macuxi/db — utilitários de banco do Macuxi FDV (dono: banco-dados).
 * A API usa `comTenant` (contexto de tenant por transação) com a URL do papel macuxi_app.
 */
export { lerConfig, lerConfigApp, exigirBancoDemo, ehBancoLocal, HOSTS_LOCAIS, AMBIENTE_DEMO, urlAdmin, urlApp, urlWorker, urlPortal, urlLeitura, PAPEL_APP, PAPEL_WORKER, PAPEL_PORTAL, PAPEL_LEITURA, type ConfigBanco } from './config';
export { comTenant, definirTenant } from './contexto';
export { migrarUp, migrarDown, lerMigracoes, listarAplicadas } from './migrador';
export { garantirPapelApp, garantirPapelWorker, garantirPapelPortal, diagnosticarPapelApp } from './papeis';
export { hashSenha, verificarSenha } from './senha';
export { idPerfilFabrica, idUsuarioPerfil } from './ids';
