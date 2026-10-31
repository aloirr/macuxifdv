/**
 * Escopo de dados por perfil (RN-CORE-04). A API filtra a consulta por este escopo; o `domain` decide qual é
 * e confere se um cliente está dentro. O Core resolve o conjunto de clientes a partir de carteira/equipe.
 */
import { escopoDoPerfil, verificarCarteira, type Escopo, type Perfil } from '@macuxi/platform-sdk';

export type { Escopo };

/** vendedor/promotor → carteira própria; supervisor → equipe; gerente → equipes abaixo; analista/assistente/admin → tenant. */
export function escopoDeCarteira(perfil: Perfil): Escopo {
  return escopoDoPerfil(perfil);
}

export interface ConjuntosDoUsuario {
  /** Clientes da carteira do próprio usuário. */
  propria: ReadonlySet<string>;
  /** Clientes das carteiras da equipe direta (supervisor). */
  equipe: ReadonlySet<string>;
  /** Clientes das equipes abaixo (gerente). */
  equipesAbaixo: ReadonlySet<string>;
}

/** Resolve os clientes visíveis; `'tenant'` = sem filtro de carteira (o RLS ainda isola o tenant, RN-CORE-05). */
export function clientesVisiveis(perfil: Perfil, c: ConjuntosDoUsuario): ReadonlySet<string> | 'tenant' {
  switch (escopoDeCarteira(perfil)) {
    case 'carteira':
      return c.propria;
    case 'equipe':
      return new Set([...c.propria, ...c.equipe]);
    case 'equipes_abaixo':
      return new Set([...c.propria, ...c.equipe, ...c.equipesAbaixo]);
    case 'tenant':
      return 'tenant';
  }
}

export function clienteNoEscopo(clienteId: string, visiveis: ReadonlySet<string> | 'tenant'): boolean {
  return verificarCarteira(clienteId, visiveis).ok;
}
