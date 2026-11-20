/**
 * Lista "membros da equipe" para outros módulos (RN-VEN-35 pedido em nome; RN-CORE-04 escopo hierárquico), a partir da
 * visão da equipe em cache. A API já entrega só o escopo de quem consulta (supervisor = equipe; gerente = equipes
 * abaixo); aqui só se tira o próprio usuário e se agrupa por líder. Função pura, sem rede.
 */
import type { MembrosDaEquipe, VisaoEquipe } from '../contracts';

export function membrosDaEquipeDaVisao(visao: VisaoEquipe | null | undefined, usuarioId: string | null | undefined): MembrosDaEquipe {
  if (!visao || !usuarioId) return { membros: [], equipes: [] };
  const lideres = new Map(visao.gestores.map((g) => [g.id, g.nome]));
  const membros = visao.membros
    .map((x) => x.membro)
    .filter((m) => m.id !== usuarioId)
    .map((m) => ({ usuario_id: m.id, nome: m.nome, perfil: m.perfil, equipe_id: m.superior_id, ativo: m.ativo }));
  const ids = [...new Set(membros.map((m) => m.equipe_id).filter((e): e is string => e !== null))];
  const equipes = ids
    .map((id) => ({ equipe_id: id, nome: lideres.get(id) ?? 'Equipe' }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { membros, equipes };
}
