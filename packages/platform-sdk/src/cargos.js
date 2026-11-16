/**
 * Cargos do FDV (ADR 0049; RN-CORE-53). Lista FIXA da plataforma, igual em todos os tenants (o admin não cria cargo):
 * cada perfil de acesso tem exatamente um cargo e cada usuário tem exatamente um perfil (RN-CORE-54, fim do multiperfil).
 */
import { z } from 'zod';
export const CARGOS = ['vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo'];
export const CargoSchema = z.enum(CARGOS);
/** Cargo de cada perfil base (igual a `plataforma.cargo_da_base`). */
export const CARGO_DA_BASE = {
    vendedor: 'vendedor',
    promotor: 'promotor',
    supervisor: 'supervisor',
    gerente: 'gerente',
    analista: 'administrativo',
    assistente: 'administrativo',
    admin: 'administrativo',
};
/** Cargo do perfil base; base desconhecida = `administrativo` (o `else` do banco). */
export function cargoDaBase(base) {
    return Object.hasOwn(CARGO_DA_BASE, base) ? CARGO_DA_BASE[base] : 'administrativo';
}
/**
 * O que o cadastro de usuário pede por cargo (RN-CORE-55; promotor, RN-CORE-56). O código ERP é obrigatório para todos
 * (RN-CORE-57) e não entra aqui. Promotor com supervisor: o gerente dele tem de ser o gerente do supervisor.
 */
export const HIERARQUIA_DO_CARGO = {
    vendedor: { supervisor: 'obrigatorio', gerente: 'derivado', nomeEquipe: 'nao' },
    promotor: { supervisor: 'opcional', gerente: 'obrigatorio', nomeEquipe: 'nao' },
    supervisor: { supervisor: 'nao', gerente: 'obrigatorio', nomeEquipe: 'obrigatorio' },
    gerente: { supervisor: 'nao', gerente: 'nao', nomeEquipe: 'opcional' },
    administrativo: { supervisor: 'nao', gerente: 'nao', nomeEquipe: 'nao' },
};
