/**
 * Contratos públicos do módulo Gestor: painel do dia, ranking, alertas, fila de aprovação, pedido em nome e os
 * espelhos dos payloads dos eventos consumidos. Fonte da verdade para a API, o app Gestão e o BKO; tipos via `z.infer`.
 * Dinheiro em centavos; instantes ISO UTC; o fuso do tenant só vale para o "dia" e para a exibição.
 */
export * from './base';
export * from './parametros';
export * from './eventos-consumidos';
export * from './painel';
export * from './equipe';
export * from './ranking';
export * from './alerta';
export * from './aprovacao';
export * from './pedido-em-nome';
export * from './visao';
