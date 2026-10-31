/**
 * Regras de fronteira do monorepo (docs/produto/04, regra inegociável 1).
 * A configuração mora em packages/config; este arquivo só a aplica na raiz.
 * Rodar: `pnpm fronteiras`.
 */
module.exports = require('@macuxi/config/dependency-cruiser');
