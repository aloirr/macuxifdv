/**
 * Hierarquia da equipe (RF-CORE-02; RN-CORE-04): gerente → supervisor → vendedor/promotor, derivada de
 * `core.equipe` (árvore, com responsável) e de `core.usuario.equipe_id`. Funções puras; o contrato é
 * `HierarquiaEquipeSchema` (o Gestor usa no escopo).
 */
import type { GestorImediato } from '../contracts/auth';
import type { MembroHierarquia } from '../contracts/hierarquia';

export interface EquipeLinha {
  id: string;
  equipe_pai_id: string | null;
  responsavel_id: string | null;
}

export interface UsuarioLinha {
  id: string;
  nome: string;
  perfil: MembroHierarquia['perfil'];
  equipe_id: string | null;
  ativo: boolean;
}

/**
 * Regra única de superior imediato (RN-CORE-04): o responsável da equipe; se quem está na equipe é o próprio responsável (ou a
 * equipe não tem responsável), sobe pela equipe-pai até achar outro responsável. Ciclo na árvore de equipes termina sem superior.
 * `usuarioId` é null para quem ainda vai entrar na equipe.
 */
export function superiorImediato(equipes: readonly EquipeLinha[], equipeId: string | null, usuarioId: string | null): string | null {
  const porId = new Map(equipes.map((e) => [e.id, e]));
  const vistos = new Set<string>();
  let e = equipeId ? porId.get(equipeId) : undefined;
  while (e && !vistos.has(e.id)) {
    vistos.add(e.id);
    if (e.responsavel_id && e.responsavel_id !== usuarioId) return e.responsavel_id;
    e = e.equipe_pai_id ? porId.get(e.equipe_pai_id) : undefined;
  }
  return null;
}

export function montarHierarquia(equipes: readonly EquipeLinha[], usuarios: readonly UsuarioLinha[]): MembroHierarquia[] {
  return usuarios.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, superior_id: superiorImediato(equipes, u.equipe_id, u.id), ativo: u.ativo }));
}

/** Subordinados diretos e indiretos de `id` (sem ele). Robusto a ciclo. */
export function subordinadosDe(membros: readonly MembroHierarquia[], id: string): string[] {
  const filhos = new Map<string, string[]>();
  for (const m of membros) if (m.superior_id) filhos.set(m.superior_id, [...(filhos.get(m.superior_id) ?? []), m.id]);
  const vistos = new Set<string>([id]);
  const fila = [id];
  while (fila.length > 0) {
    for (const f of filhos.get(fila.shift()!) ?? []) {
      if (vistos.has(f)) continue;
      vistos.add(f);
      fila.push(f);
    }
  }
  vistos.delete(id);
  return [...vistos];
}

/** Recorte do que o usuário enxerga (`ctx.usuariosVisiveis()`); superior fora do recorte vira `null` (não revela quem está acima). */
export function recortarHierarquia(membros: readonly MembroHierarquia[], visiveis: ReadonlySet<string> | 'tenant'): MembroHierarquia[] {
  if (visiveis === 'tenant') return [...membros];
  return membros.filter((m) => visiveis.has(m.id)).map((m) => ({ ...m, superior_id: m.superior_id && visiveis.has(m.superior_id) ? m.superior_id : null }));
}

/**
 * Gestor imediato do Perfil do app: o superior imediato (`superiorImediato`) com id e nome; `null` sem superior ou com superior
 * inativo/inexistente. A API passa as equipes e os usuários inteiros do tenant (não recortados), porque é o próprio usuário quem lê o seu.
 */
export function gestorImediatoDe(equipes: readonly EquipeLinha[], usuarios: readonly UsuarioLinha[], usuarioId: string): GestorImediato | null {
  const u = usuarios.find((x) => x.id === usuarioId);
  const superiorId = u ? superiorImediato(equipes, u.equipe_id, u.id) : null;
  const superior = superiorId ? usuarios.find((x) => x.id === superiorId) : undefined;
  return superior?.ativo ? { id: superior.id, nome: superior.nome } : null;
}
