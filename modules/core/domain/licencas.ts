/**
 * Licenças de módulo por usuário (RN-CORE-01, RN-CORE-03).
 *
 * A regra mora em `@macuxi/platform-sdk` (`modulosEfetivos`, ADR 0004), porque `packages/*` não pode importar
 * `modules/*` (fronteiras). O Core a consome aqui, com o vocabulário do módulo, e tem os testes de regra
 * (S0-040). A API chama esta função A CADA REQUISIÇÃO: o resultado nunca é gravado no JWT (S0-055).
 */
import { modulosEfetivos, type Manifesto, type ModuloId } from '@macuxi/platform-sdk';

export interface EntradaLicencas {
  manifestos: readonly Manifesto[];
  /** Ativos no tenant. */
  ativosNoTenant: readonly ModuloId[];
  /** Padrão do perfil do usuário. */
  doPerfil: readonly ModuloId[];
  /** Exceções do usuário: só REMOVEM módulo (esclarecimento do doc 03; acrescentar está no backlog). */
  removidosDoUsuario?: readonly ModuloId[];
}

/** RN-CORE-01/03: tenant ∩ perfil − exceções; core sempre; dependência inativa remove o dependente. */
export function calcularModulosEfetivos(e: EntradaLicencas): ModuloId[] {
  return modulosEfetivos(e);
}

/** O módulo está efetivo para o usuário? É o que a API checa por requisição (403 MODULO_INATIVO se não). */
export function moduloEstaAtivo(efetivos: Iterable<ModuloId>, modulo: ModuloId): boolean {
  return modulo === 'core' || [...efetivos].includes(modulo);
}

/** RN-CORE-01: o core não pode ser desativado em nenhum nível (tenant, perfil ou usuário). */
export function podeDesativarModulo(modulo: ModuloId): boolean {
  return modulo !== 'core';
}

/** Módulos que saem entre duas listas de efetivos (RN-CORE-02: dados locais e fila precisam de tratamento). */
export function modulosRemovidos(antes: Iterable<ModuloId>, depois: Iterable<ModuloId>): ModuloId[] {
  const d = new Set(depois);
  return [...antes].filter((m) => !d.has(m));
}
