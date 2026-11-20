import { describe, expect, it } from 'vitest';
import { MembroEquipeEmNomeSchema, type MembroEquipe, type VisaoEquipe } from '../contracts';
import { complementoDaParada, indexarCarteiraPorCliente, membrosDaEquipeDaVisao, type VinculoCarteira } from './membros-da-equipe';
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
    expect(complementoDaParada([vc(V1)], eq(V1, 'Vera'), AGORA)).toBe('Vera');
  });
  it('RN-CORE-52: 0 ou mais de 1 vendedor devolve null', () => {
    const ms = membrosDaEquipeDaVisao(visao([m(V1, 'Vera', 'vendedor', S1), m(V2, 'Valter', 'vendedor', S1)], []), G);
    expect(complementoDaParada(undefined, ms, AGORA)).toBeNull();
    expect(complementoDaParada([], ms, AGORA)).toBeNull();
    expect(complementoDaParada([vc(V1), vc(V2)], ms, AGORA)).toBeNull();
    expect(complementoDaParada([vc(V1, { papel: 'promotor' })], ms, AGORA)).toBeNull();
  });
  it('RN-CORE-52: o nome vem inteiro, sem corte (o Core corta o texto)', () => {
    expect(complementoDaParada([vc(V1)], eq(V1, 'A'.repeat(90)), AGORA)).toBe('A'.repeat(90));
  });
  it('RN-CORE-52: membro inativo também devolve o nome', () => {
    expect(complementoDaParada([vc(V1)], eq(V1, 'Vera', false), AGORA)).toBe('Vera');
  });
  it('RN-CORE-52: vínculo removido, encerrado ou de promotor é ignorado', () => {
    expect(complementoDaParada([vc(V1, { deleted_at: AGORA }), vc(V2, { fim: '2026-01-01T00:00:00Z' })], eq(V1, 'Vera'), AGORA)).toBeNull();
    expect(complementoDaParada([vc(V1), vc(V2, { papel: 'promotor' }), vc(V3, { deleted_at: AGORA })], eq(V1, 'Vera'), AGORA)).toBe('Vera');
  });
  it('RN-CORE-04: o próprio usuário já sai da lista de membros; vendedor fora da lista não dá nome', () => {
    const ms = membrosDaEquipeDaVisao(visao([m(S1, 'Sandro', 'supervisor', G), m(V1, 'Vera', 'vendedor', S1)], [m(S1, 'Sandro', 'supervisor', G)]), S1);
    expect(complementoDaParada([vc(S1)], ms, AGORA)).toBeNull();
    expect(complementoDaParada([vc(V1)], ms, AGORA)).toBe('Vera');
  });
});

describe('RN-CORE-52: índice da carteira por cliente', () => {
  it('RN-CORE-52: agrupa os vínculos por cliente, mantendo a ordem, e cliente ausente dá undefined', () => {
    const [C1, C2] = [u(51), u(52)];
    const a = vc(V1, { cliente_id: C1 }), b = vc(V2, { cliente_id: C2 }), c = vc(V3, { cliente_id: C1 });
    const indice = indexarCarteiraPorCliente([a, b, c]);
    expect(indice.size).toBe(2);
    expect(indice.get(C1)).toEqual([a, c]);
    expect(indice.get(C2)).toEqual([b]);
    expect(indice.get(u(99))).toBeUndefined();
  });
});
