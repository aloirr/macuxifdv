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
export * from './tolerante';
export * from './sync';
export * from './novidades';
export * from './arquivos';
export * from './auditoria';
export * from './acesso';
export * from './permissoes';
export * from './permissoes-perfil';
export * from './perfis';
export * from './cargos';
export * from './acesso-sessao';
export * from './ambiente';
export * from './motor-sync';
export * from './geracao-base';
export * from './shell';
export * from './api';
export * from './sem-filial';
export * from './cookie-sessao';
export * from './conector';
export * from './consultas';
export * from './sync-simulado';
export * from './busca';
export * from './sqlite';
export * from './saude';
export * from './fuso';
export * from './onboarding';
export * from './plataforma';
export * from './email';
export * from './pacotes';
export * from './diagnostico';
export * from './cnpj';
export * from './planos';
export * from './empresa-acoes';
export * from './frase-carga';
