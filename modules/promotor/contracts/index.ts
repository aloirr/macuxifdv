/**
 * Contratos públicos do módulo Promotor (coletas de trade e indicador do dia). Fonte da verdade para a API,
 * o app e a web do módulo; tipos via `z.infer`. Outros módulos importam só este arquivo (ex.: o Gestor lê
 * `IndicadorPromotorDia`). Eventos `promotor.*@1`: payloads Zod em `./eventos` (T-0040), nomes no manifesto.
 */
export * from './coletas';
export * from './indicador';
export * from './eventos';
export * from './cadastros';
export * from './entidades';
export * from './relatorios';
export * from './cadastros-bko';
export * from './consultas';
