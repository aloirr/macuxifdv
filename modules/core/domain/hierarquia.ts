/**
 * Hierarquia da equipe (RF-CORE-02; RN-CORE-04): gerente → supervisor → vendedor/promotor, derivada de
 * `core.equipe` (árvore, com responsável) e de `core.usuario.equipe_id`. Funções puras; o contrato é
 * `HierarquiaEquipeSchema` (o Gestor usa no escopo).
 */
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
 * Superior direto = responsável da equipe do usuário; se o próprio usuário é o responsável (ou a equipe não tem
 * responsável), sobe pela equipe-pai até achar outro responsável. Ciclo na árvore de equipes termina sem superior.
 */
export function montarHierarquia(equipes: readonly EquipeLinha[], usuarios: readonly UsuarioLinha[]): MembroHierarquia[] {
  const porId = new Map(equipes.map((e) => [e.id, e]));
  const superiorDe = (u: UsuarioLinha): string | null => {
    const vistos = new Set<string>();
    let e = u.equipe_id ? porId.get(u.equipe_id) : undefined;
    while (e && !vistos.has(e.id)) {
      vistos.add(e.id);
      if (e.responsavel_id && e.responsavel_id !== u.id) return e.responsavel_id;
      e = e.equipe_pai_id ? porId.get(e.equipe_pai_id) : undefined;
    }
    return null;
  };
  return usuarios.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, superior_id: superiorDe(u), ativo: u.ativo }));
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
 * Gestor imediato do Perfil do app: o superior direto (`superior_id`) com id e nome; `null` sem superior ou com superior
 * inativo/inexistente. A API calcula com a hierarquia inteira do tenant (não recortada), porque é o próprio usuário quem lê o seu.
 */
export function gestorImediatoDe(membros: readonly MembroHierarquia[], usuarioId: string): { id: string; nome: string } | null {
  const superiorId = membros.find((m) => m.id === usuarioId)?.superior_id;
  const superior = superiorId ? membros.find((m) => m.id === superiorId) : undefined;
  return superior && superior.ativo ? { id: superior.id, nome: superior.nome } : null;
}
