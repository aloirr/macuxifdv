/**
 * Domain da Pesquisa: funções puras, sem I/O — rodam no app (offline), na web e na API.
 * Cada regra cita a RN/RF de origem (docs/modulos/pesquisa/regras.md). A API sempre revalida.
 * Os tipos vêm de `../contracts` (Zod).
 */
export * from './util';
export * from './parametros';
export * from './resposta-item';
export * from './condicional';
export * from './questionario';
export * from './resposta';
export * from './publico';
export * from './checkout';
export * from './idempotencia';
export * from './resultados';
