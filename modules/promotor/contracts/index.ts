/**
 * Contratos públicos do módulo Promotor (coletas de trade e indicador do dia). Fonte da verdade para a API,
 * o app e a web do módulo; tipos via `z.infer`. Outros módulos importam só este arquivo (ex.: o Gestor lê
 * `IndicadorPromotorDia`). Eventos `promotor.*@1` estão declarados no manifesto.
 */
export * from './coletas';
export * from './indicador';
