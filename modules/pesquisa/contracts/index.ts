/**
 * Contratos públicos do módulo Pesquisa. Fonte da verdade para a API, o app e a web do módulo; tipos via `z.infer`.
 * Outros módulos importam só este arquivo (ex.: o Gestor lê `RespostaRegistradaV1`).
 */
export * from './base';
export * from './pergunta';
export * from './regra';
export * from './publico';
export * from './questionario';
export * from './resposta';
export * from './resultado';
export * from './parametros';
export * from './eventos';
export * from './api';
export * from './entidades';
