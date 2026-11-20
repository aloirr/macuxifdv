import { describe, expect, it } from 'vitest';
import { MembrosDaEquipeSaidaSchema, type MembroEquipe, type VisaoEquipe } from '../contracts';
import { membrosDaEquipeDaVisao } from './membros-da-equipe';
import { u } from './fixtures';

const G = u(1), S1 = u(2), S2 = u(3), V1 = u(11), V2 = u(12), V3 = u(13);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null, ativo = true): MembroEquipe => ({ id, nome, perfil, superior_id, ativo });
const visao = (membros: MembroEquipe[], gestores: MembroEquipe[]): VisaoEquipe =>
  ({ data: '2026-11-20', gestores, equipes: [], membros: membros.map((membro) => ({ membro })), calculado_em: '2026-11-20T12:00:00Z' }) as unknown as VisaoEquipe;

describe('RN-VEN-35 / RN-CORE-04: membros da equipe a partir da visão em cache', () => {
  it('RN-CORE-04: supervisor recebe só a equipe que a visão traz, sem o próprio usuário', () => {
    const v = visao([m(S1, 'Sandro', 'supervisor', G), m(V1, 'Vera', 'vendedor', S1), m(V2, 'Valter', 'vendedor', S1)], [m(S1, 'Sandro', 'supervisor', G)]);
    const r = membrosDaEquipeDaVisao(v, S1);
    expect(r.membros.map((x) => x.usuario_id)).toEqual([V1, V2]);
    expect(r.equipes).toEqual([{ equipe_id: S1, nome: 'Sandro' }]);
  });
  it('RN-CORE-04: gerente recebe as equipes abaixo agrupáveis, com o nome do líder em ordem alfabética', () => {
    const v = visao([m(V3, 'Vitor', 'vendedor', S2), m(V1, 'Vera', 'vendedor', S1)], [m(S2, 'Sueli', 'supervisor', G), m(S1, 'Sandro', 'supervisor', G)]);
    const r = membrosDaEquipeDaVisao(v, G);
    expect(r.equipes.map((e) => e.nome)).toEqual(['Sandro', 'Sueli']);
    expect(r.membros.find((x) => x.usuario_id === V3)?.equipe_id).toBe(S2);
  });
  it('RN-VEN-35: vendedor inativo continua na lista com ativo false', () => {
    const r = membrosDaEquipeDaVisao(visao([m(V1, 'Vera', 'vendedor', S1, false)], [m(S1, 'Sandro', 'supervisor', G)]), S1);
    expect(r.membros).toEqual([{ usuario_id: V1, nome: 'Vera', perfil: 'vendedor', equipe_id: S1, ativo: false }]);
  });
  it('RN-VEN-35: sem cache ou sem usuário, a lista vem vazia', () => {
    expect(membrosDaEquipeDaVisao(null, S1)).toEqual({ membros: [], equipes: [] });
    expect(membrosDaEquipeDaVisao(visao([m(V1, 'Vera', 'vendedor', S1)], []), null)).toEqual({ membros: [], equipes: [] });
  });
  it('RN-VEN-35: a saída respeita o schema do contrato', () => {
    const v = visao([m(V1, 'Vera', 'vendedor', S1)], [m(S1, 'Sandro', 'supervisor', G)]);
    expect(MembrosDaEquipeSaidaSchema.safeParse(membrosDaEquipeDaVisao(v, S1)).success).toBe(true);
  });
});
