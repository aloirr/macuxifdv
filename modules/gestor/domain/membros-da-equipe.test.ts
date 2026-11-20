import { describe, expect, it } from 'vitest';
import { MembroEquipeEmNomeSchema, type MembroEquipe, type VisaoEquipe } from '../contracts';
import { complementoDaParada, membrosDaEquipeDaVisao, type VinculoCarteira } from './membros-da-equipe';
import { u } from './fixtures';

const G = u(1), S1 = u(2), S2 = u(3), V1 = u(11), V2 = u(12), V3 = u(13);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null, ativo = true): MembroEquipe => ({ id, nome, perfil, superior_id, ativo });
const visao = (membros: MembroEquipe[], gestores: MembroEquipe[]): VisaoEquipe =>
  ({ data: '2026-11-20', gestores, equipes: [], membros: membros.map((membro) => ({ membro })), calculado_em: '2026-11-20T12:00:00Z' }) as unknown as VisaoEquipe;

describe('RN-VEN-35 / RN-CORE-04: membros da equipe a partir da visão em cache', () => {
  it('RN-CORE-04: supervisor recebe só a equipe que a visão traz, sem o próprio usuário', () => {
    const v = visao([m(S1, 'Sandro', 'supervisor', G), m(V1, 'Vera', 'vendedor', S1), m(V2, 'Valter', 'vendedor', S1)], [m(S1, 'Sandro', 'supervisor', G)]);
    const r = membrosDaEquipeDaVisao(v, S1);
    expect(r.map((x) => x.usuario_id)).toEqual([V1, V2]);
    expect(r.every((x) => x.equipe_nome === 'Sandro')).toBe(true);
  });
  it('RN-CORE-04: gerente recebe as equipes abaixo agrupáveis, com o nome do líder em ordem alfabética', () => {
    const v = visao([m(V3, 'Vitor', 'vendedor', S2), m(V1, 'Vera', 'vendedor', S1)], [m(S2, 'Sueli', 'supervisor', G), m(S1, 'Sandro', 'supervisor', G)]);
    const r = membrosDaEquipeDaVisao(v, G);
    expect(r.map((x) => x.equipe_nome)).toEqual(['Sueli', 'Sandro']);
    expect(r.find((x) => x.usuario_id === V3)?.equipe_id).toBe(S2);
  });
  it('RN-VEN-35: vendedor inativo continua na lista com ativo false', () => {
    const r = membrosDaEquipeDaVisao(visao([m(V1, 'Vera', 'vendedor', S1, false)], [m(S1, 'Sandro', 'supervisor', G)]), S1);
    expect(r).toEqual([{ usuario_id: V1, nome: 'Vera', perfil: 'vendedor', equipe_id: S1, equipe_nome: 'Sandro', ativo: false }]);
  });
  it('RN-VEN-35: sem cache ou sem usuário, a lista vem vazia', () => {
    expect(membrosDaEquipeDaVisao(null, S1)).toEqual([]);
    expect(membrosDaEquipeDaVisao(visao([m(V1, 'Vera', 'vendedor', S1)], []), null)).toEqual([]);
  });
  it('RN-VEN-35: a saída respeita o schema do contrato', () => {
    const v = visao([m(V1, 'Vera', 'vendedor', S1)], [m(S1, 'Sandro', 'supervisor', G)]);
    expect(membrosDaEquipeDaVisao(v, S1).every((x) => MembroEquipeEmNomeSchema.safeParse(x).success)).toBe(true);
  });
});

const C = u(50), AGORA = '2026-11-20T12:00:00Z';
const vc = (usuario_id: string, over: Partial<VinculoCarteira> = {}): VinculoCarteira => ({ cliente_id: C, usuario_id, papel: 'vendedor', deleted_at: null, fim: null, ...over });
const eq = (v: string, nome: string, ativo = true) => membrosDaEquipeDaVisao(visao([m(v, nome, 'vendedor', S1, ativo)], [m(S1, 'Sandro', 'supervisor', G)]), G);

describe('RN-CORE-52 / RN-CORE-04: complemento da parada na Rota do Gestão', () => {
  it('RN-CORE-52: um vendedor na carteira devolve o nome dele', () => {
    expect(complementoDaParada(C, [vc(V1)], eq(V1, 'Vera'), G, AGORA)).toBe('Vera');
  });
  it('RN-CORE-52: 0 ou mais de 1 vendedor devolve null', () => {
    const ms = membrosDaEquipeDaVisao(visao([m(V1, 'Vera', 'vendedor', S1), m(V2, 'Valter', 'vendedor', S1)], []), G);
    expect(complementoDaParada(C, [], ms, G, AGORA)).toBeNull();
    expect(complementoDaParada(C, [vc(V1), vc(V2)], ms, G, AGORA)).toBeNull();
    expect(complementoDaParada(C, [vc(V1, { papel: 'promotor' })], ms, G, AGORA)).toBeNull();
  });
  it('RN-CORE-52: nome acima de 60 caracteres é cortado em 60', () => {
    expect(complementoDaParada(C, [vc(V1)], eq(V1, 'A'.repeat(90)), G, AGORA)).toBe('A'.repeat(60));
  });
  it('RN-CORE-52: membro inativo também devolve o nome', () => {
    expect(complementoDaParada(C, [vc(V1)], eq(V1, 'Vera', false), G, AGORA)).toBe('Vera');
  });
  it('RN-CORE-04: o próprio usuário nunca entra; vínculo removido ou encerrado não conta', () => {
    expect(complementoDaParada(C, [vc(S1)], eq(V1, 'Vera'), S1, AGORA)).toBeNull();
    expect(complementoDaParada(C, [vc(S1), vc(V1)], eq(V1, 'Vera'), S1, AGORA)).toBe('Vera');
    expect(complementoDaParada(C, [vc(V1, { deleted_at: AGORA }), vc(V2, { fim: '2026-01-01T00:00:00Z' })], eq(V1, 'Vera'), G, AGORA)).toBeNull();
  });
});
