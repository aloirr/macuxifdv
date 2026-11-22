/**
 * Domain do módulo Integracao: regras puras do Hub `/integracao/v1` (RN-INT-01..09).
 * Sem I/O: a API grava/lê; aqui só decide.
 */
export * from './cancelamento';
export * from './parametros';
export * from './envelope';
export * from './erros';
export * from './idempotencia';
export { sha256Hex } from '@macuxi/platform-sdk/sha256';
export * from './ordem';
export * from './cursor';
export * from './sessao';
export * from './reconciliacao';
export * from './estados';
export * from './versao';
export * from './lote-idempotencia';
export * from './credencial';
export * from './conector-versao';
export * from './limites';
export * from './linhas-invalidas';
export * from './inativacao';
export * from './aplicacao';
export * from './pedido-fila';
export * from './monitor';
export * from './topologia';
export * from './permissoes';
export * from './cadastro-incompleto';
export * from './medidas';
export * from './pagamento';
export * from './catalogo-produto';
export * from './vendedor-filial';
export * from './marca-desconhecida';
export * from './pedido-versao';
export * from './linha-arquivo-legado';
export * from './mapeamento';
export * from './status-lote';
export * from './resumo-pedidos-erp';
