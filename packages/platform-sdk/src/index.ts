/**
 * @macuxi/platform-sdk — o contrato entre a plataforma e os módulos:
 * manifesto (defineModule), módulos efetivos, pontos de extensão, barramento de eventos,
 * registro de sync e verificação de acesso. Puro TypeScript (roda na API, na web e no app).
 * Clientes HTTP/sessão para telas ficam em subcaminhos (`@macuxi/platform-sdk/web`).
 */
export * from './nomes';
export * from './manifesto';
export * from './modulos-efetivos';
export * from './extensoes';
export * from './eventos';
export * from './sync';
export * from './acesso';
export * from './permissoes';
export * from './perfis';
export * from './motor-sync';
export * from './shell';
export * from './sync-simulado';
