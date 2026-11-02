/**
 * LEGADO DA FASE M — ponte única entre o mock-api e as regras que viraram domain de módulo (T-0001, A2).
 *
 * Na Fase M havia um só `@fv/domain`; no monorepo modular ele foi repartido entre `@macuxi/comum`
 * (dinheiro, calendário), `modules/core/domain` e `modules/vendedor/domain`. O mock-api é um servidor de
 * DESENVOLVIMENTO que simula a API de todos os módulos a partir de planilhas e some quando `apps/api`
 * cobrir as rotas (T-0004). Por isso, e só aqui, um app lê o domain dos módulos por caminho relativo —
 * exceção registrada na regra `app-importa-interno-de-modulo` do dependency-cruiser (desenho T-0001 §15).
 */
export * from '@macuxi/comum';
export * from '../../../../modules/core/domain/index';
export * from '../../../../modules/vendedor/domain/index';
// Nome repetido nas duas origens (CNPJ/CPF no comum; pedido/orçamento no Vendedor, T-0053): vale o do comum.
export type { TipoDocumento } from '@macuxi/comum';
