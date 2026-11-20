/**
 * Lista "membros da equipe" para slots de outros módulos (RN-VEN-35 pedido em nome; RN-CORE-04 escopo hierárquico), a
 * partir da visão da equipe em cache. A API já entrega só o escopo de quem consulta (supervisor = equipe; gerente =
 * equipes abaixo); aqui só se tira o próprio usuário e se junta o nome da equipe (líder). Função pura, sem rede.
 */
import type { MembroEquipeEmNome, VisaoEquipe } from '../contracts';

export function membrosDaEquipeDaVisao(visao: VisaoEquipe | null | undefined, usuarioId: string | null | undefined): MembroEquipeEmNome[] {
  if (!visao || !usuarioId) return [];
  const lideres = new Map(visao.gestores.map((g) => [g.id, g.nome]));
  return visao.membros
    .map((x) => x.membro)
    .filter((m) => m.id !== usuarioId)
    .map((m) => ({
      usuario_id: m.id,
      nome: m.nome,
      perfil: m.perfil,
      equipe_id: m.superior_id,
      equipe_nome: (m.superior_id && lideres.get(m.superior_id)) || 'Equipe',
      ativo: m.ativo,
    }));
}

/** Vínculo de carteira como vem do pull `carteira` do Core (só o que a regra usa). */
export interface VinculoCarteira {
  cliente_id: string;
  usuario_id: string;
  papel: string;
  deleted_at: string | null;
  fim: string | null;
}

/** Índice da carteira por cliente, feito uma vez por ciclo de sync (um `get` por parada). */
export function indexarCarteiraPorCliente<T extends VinculoCarteira>(vinculos: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const indice = new Map<string, T[]>();
  for (const v of vinculos) {
    const lista = indice.get(v.cliente_id);
    if (lista) lista.push(v);
    else indice.set(v.cliente_id, [v]);
  }
  return indice;
}

/**
 * RN-CORE-52: texto da parada na Rota do Gestão = nome inteiro da vendedora da carteira do cliente (o Core corta o texto).
 * Só quando há exatamente 1 vendedor ativo (0 ou mais de 1 = null); vínculo removido, encerrado (`fim` <= `agora`, ISO UTC)
 * ou de promotor é ignorado; membro inativo também dá o nome. `membros` já vem sem o próprio usuário (RN-CORE-04,
 * `membrosDaEquipeDaVisao`); por isso um vendedor fora da lista dá null.
 */
export function complementoDaParada(vinculosDoCliente: readonly VinculoCarteira[] | undefined, membros: readonly MembroEquipeEmNome[], agora: string): string | null {
  const ids = new Set<string>();
  for (const v of vinculosDoCliente ?? []) {
    if (v.papel === 'vendedor' && v.deleted_at === null && (v.fim === null || v.fim > agora)) ids.add(v.usuario_id);
  }
  if (ids.size !== 1) return null;
  return membros.find((m) => m.usuario_id === [...ids][0])?.nome.trim() || null;
}
