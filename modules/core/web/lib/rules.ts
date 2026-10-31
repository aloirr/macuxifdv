/**
 * Regras de tela do módulo Core no BKO (permissão por perfil e ordenação). O servidor também bloqueia;
 * aqui só decidimos o que mostrar. Regra de negócio continua em `modules/core/domain`.
 *
 * As cores dos faróis (`coverageTone`, `projectionTone`, `integratedTone`, `TONE_*`) moram em `@macuxi/ui/web`.
 * As funções `canX` abaixo usam o papel da Fase M (`Role`) e espelham as ações declaradas em
 * `manifest.acoes` (`rota.editar`, `meta.fechar_periodo`, `plano_rv.editar`); as páginas usam `usePode`
 * (platform-sdk/react), e o teste "permissões por perfil" confere que as duas visões não divergem.
 */
import type { Role, SellerGoals } from '../../contracts';

/** Aprovar/recusar pedido fora da alçada: só gestor (e admin). */
export const canApprove = (role: Role | undefined) => role === 'manager' || role === 'admin';
/** Parâmetros (plano de RV e alçadas): só o perfil analista edita. */
export const canEditParams = (role: Role | undefined) => role === 'analyst';
/** Fechar/reabrir mês e exportar para o RH. */
export const canManagePeriod = (role: Role | undefined) => role === 'analyst' || role === 'manager' || role === 'admin';
/** Incluir cliente na rota da semana. */
export const canEditRoutes = (role: Role | undefined) => role === 'analyst' || role === 'manager' || role === 'admin';
/** Perfis que usam a web do BKO (vendedor usa o app). */
export const BKO_ROLES: Role[] = ['manager', 'analyst', 'bko_assistant', 'admin'];

export type GoalsSort = 'projection' | 'incentive' | 'name';

/** Ordena a tabela de metas: projeção e RV do maior para o menor; nome em ordem alfabética. */
export function sortSellerGoals(sellers: SellerGoals[], by: GoalsSort): SellerGoals[] {
  const list = [...sellers];
  if (by === 'name') return list.sort((a, b) => a.short_name.localeCompare(b.short_name, 'pt-BR'));
  if (by === 'incentive') return list.sort((a, b) => b.incentive_cents - a.incentive_cents || a.short_name.localeCompare(b.short_name, 'pt-BR'));
  return list.sort((a, b) => b.revenue_projected_pct - a.revenue_projected_pct || a.short_name.localeCompare(b.short_name, 'pt-BR'));
}
