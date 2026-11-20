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

export const COMPLEMENTO_PARADA_MAX = 60;

/** Vínculo de carteira como vem do pull `carteira` do Core (só o que a regra usa). */
export interface VinculoCarteira {
  cliente_id: string;
  usuario_id: string;
  papel: string;
  deleted_at: string | null;
  fim: string | null;
}

/**
 * RN-CORE-52: texto da parada na Rota do Gestão = nome da vendedora da carteira do cliente. Só quando há exatamente 1
 * vendedor ativo (0 ou mais de 1 = null); o próprio usuário nunca entra (RN-CORE-04); membro inativo também dá o nome;
 * nome cortado em 60 caracteres. `agora` = ISO UTC, para ignorar vínculo já encerrado.
 */
export function complementoDaParada(clienteId: string, vinculos: readonly VinculoCarteira[], membros: readonly MembroEquipeEmNome[], usuarioId: string | null | undefined, agora: string): string | null {
  const ids = new Set(
    vinculos
      .filter((v) => v.cliente_id === clienteId && v.papel === 'vendedor' && v.deleted_at === null && (v.fim === null || v.fim > agora) && v.usuario_id !== usuarioId)
      .map((v) => v.usuario_id),
  );
  if (ids.size !== 1) return null;
  const nome = membros.find((m) => m.usuario_id === [...ids][0])?.nome.trim();
  return nome ? nome.slice(0, COMPLEMENTO_PARADA_MAX) : null;
}
