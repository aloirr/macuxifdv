/**
 * Cargos do FDV (ADR 0049; RN-CORE-53). Lista FIXA da plataforma, igual em todos os tenants (o admin não cria cargo):
 * cada perfil de acesso tem exatamente um cargo e cada usuário tem exatamente um perfil (RN-CORE-54, fim do multiperfil).
 * Espelha o banco: `plataforma.perfil.cargo` (CHECK `perfil_cargo_valido`) e `plataforma.cargo_da_base(base)` (0069).
 * O cargo não dá permissão (isso é do motor da ADR 0033): diz o lugar na hierarquia e o que o cadastro pede.
 */
import { z } from 'zod';
import type { Perfil } from './nomes';

export const CARGOS = ['vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo'] as const;
export type Cargo = (typeof CARGOS)[number];
export const CargoSchema = z.enum(CARGOS);

export function ehCargo(valor: unknown): valor is Cargo {
  return typeof valor === 'string' && (CARGOS as readonly string[]).includes(valor);
}

/** Cargo de cada perfil base, igual a `plataforma.cargo_da_base`: analista, assistente e admin = administrativo. */
export const CARGO_DA_BASE: Readonly<Record<Perfil, Cargo>> = {
  vendedor: 'vendedor',
  promotor: 'promotor',
  supervisor: 'supervisor',
  gerente: 'gerente',
  analista: 'administrativo',
  assistente: 'administrativo',
  admin: 'administrativo',
};

/** Cargo do perfil base; base desconhecida = `administrativo` (o `else` do banco). */
export function cargoDaBase(base: string): Cargo {
  return Object.hasOwn(CARGO_DA_BASE, base) ? CARGO_DA_BASE[base as Perfil] : 'administrativo';
}

/** Vínculo no cadastro: `obrigatorio`, `opcional` ou `nao` (o campo não existe para o cargo). */
export type ExigenciaVinculo = 'obrigatorio' | 'opcional' | 'nao';

export interface HierarquiaDoCargo {
  /** Supervisor escolhido: a equipe do usuário passa a ser a que o supervisor lidera. */
  supervisor: ExigenciaVinculo;
  /** Gerente escolhido; `derivado` = não se escolhe, é o gerente do supervisor. */
  gerente: ExigenciaVinculo | 'derivado';
  /** Nome da equipe que o usuário lidera (aparece no Início do app da equipe). */
  nomeEquipe: ExigenciaVinculo;
}

/**
 * O que o cadastro de usuário pede por cargo (RN-CORE-55; promotor, RN-CORE-56). O código ERP é obrigatório para todos
 * (RN-CORE-57) e não entra aqui. Promotor com supervisor: o gerente dele tem de ser o gerente do supervisor (o banco também
 * confere: 23514 `promotor_sem_gerente` e `promotor_gerente_do_supervisor`, migração 0069).
 */
export const HIERARQUIA_DO_CARGO: Readonly<Record<Cargo, HierarquiaDoCargo>> = {
  vendedor: { supervisor: 'obrigatorio', gerente: 'derivado', nomeEquipe: 'nao' },
  promotor: { supervisor: 'opcional', gerente: 'obrigatorio', nomeEquipe: 'nao' },
  supervisor: { supervisor: 'nao', gerente: 'obrigatorio', nomeEquipe: 'obrigatorio' },
  gerente: { supervisor: 'nao', gerente: 'nao', nomeEquipe: 'opcional' },
  administrativo: { supervisor: 'nao', gerente: 'nao', nomeEquipe: 'nao' },
};
