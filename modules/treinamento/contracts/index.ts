/**
 * Contratos públicos do módulo Treinamento. Fonte da verdade para a API, o app e a web do módulo; tipos via
 * `z.infer`. Outros módulos importam só este arquivo (ex.: o Gestor lê `AdesaoMes` e os payloads dos eventos
 * `treinamento.*@1`). O pedido faturado (evento de nome pendente) é lido por `PedidoFaturadoLido` (leitura tolerante).
 */
export * from './base';
export * from './progresso';
export * from './xp';
export * from './medalha';
export * from './ranking';
export * from './adesao';
export * from './parametros';
export * from './pedido-lido';
export * from './eventos';
