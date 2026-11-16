/**
 * Domain do Gestor: funções puras, sem I/O — rodam no app (offline), na web e na API. Cada regra cita a RN/RF de origem
 * (docs/modulos/gestor/regras.md). RN-PRO-01: nada aqui cria pedido; o motor do pedido é do Vendedor (extensão
 * `pedido.criar_em_nome`). A regra de alçada de aprovação também é do Vendedor.
 */
export * from './numeros';
export * from './parametros';
export * from './horario-comercial';
export * from './projecao';
export * from './apuracao';
export * from './painel';
export * from './equipe';
export * from './ranking';
export * from './aprovacoes';
export * from './alertas';
export * from './campos-regra';
export * from './produtividade-do-dia';
export * from './pedido-em-nome';
export * from './visao';
export * from './sincronizacao';
export * from './alertas-pendencia-checkout';
export * from './etapa-pendente-equipe';
