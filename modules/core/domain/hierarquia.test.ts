import { describe, expect, it } from 'vitest';
import { gestorImediatoDe, montarHierarquia, recortarHierarquia, subordinadosDe, superiorImediato } from './hierarquia';

const equipes = [
  { id: 'regional', equipe_pai_id: null, responsavel_id: 'ger' },
  { id: 'eq1', equipe_pai_id: 'regional', responsavel_id: 'sup' },
  { id: 'eq2', equipe_pai_id: 'regional', responsavel_id: null },
];
const usuarios = [
  { id: 'adm', nome: 'Admin', perfil: 'admin' as const, equipe_id: null, ativo: true },
  { id: 'ger', nome: 'Gerente', perfil: 'gerente' as const, equipe_id: 'regional', ativo: true },
  { id: 'sup', nome: 'Supervisor', perfil: 'supervisor' as const, equipe_id: 'eq1', ativo: true },
  { id: 'v1', nome: 'Vendedor 1', perfil: 'vendedor' as const, equipe_id: 'eq1', ativo: true },
  { id: 'p1', nome: 'Promotor', perfil: 'promotor' as const, equipe_id: 'eq1', ativo: true },
  { id: 'v2', nome: 'Vendedor 2', perfil: 'vendedor' as const, equipe_id: 'eq2', ativo: true },
];
const sup = (h: ReturnType<typeof montarHierarquia>, id: string) => h.find((m) => m.id === id)?.superior_id;

describe('hierarquia da equipe (RF-CORE-02; RN-CORE-04)', () => {
  const h = montarHierarquia(equipes, usuarios);

  it('RN-CORE-04: vendedor e promotor respondem ao responsável da equipe (supervisor)', () => {
    expect(sup(h, 'v1')).toBe('sup');
    expect(sup(h, 'p1')).toBe('sup');
  });
  it('RN-CORE-04: o responsável sobe para o responsável da equipe-pai (supervisor → gerente)', () => {
    expect(sup(h, 'sup')).toBe('ger');
  });
  it('RN-CORE-04: equipe sem responsável sobe para o da equipe-pai; o topo não tem superior', () => {
    expect(sup(h, 'v2')).toBe('ger');
    expect(sup(h, 'ger')).toBeNull();
    expect(sup(h, 'adm')).toBeNull();
  });
  it('RN-CORE-04: gerente vê as equipes abaixo; supervisor, a equipe; vendedor, ninguém', () => {
    expect(subordinadosDe(h, 'ger').sort()).toEqual(['p1', 'sup', 'v1', 'v2']);
    expect(subordinadosDe(h, 'sup').sort()).toEqual(['p1', 'v1']);
    expect(subordinadosDe(h, 'v1')).toEqual([]);
  });
  it('RN-CORE-04: ciclo de equipes (dado corrompido) não trava nem repete ninguém', () => {
    const ciclo = montarHierarquia(
      [
        { id: 'a', equipe_pai_id: 'b', responsavel_id: 'x' },
        { id: 'b', equipe_pai_id: 'a', responsavel_id: 'y' },
      ],
      [
        { id: 'x', nome: 'X', perfil: 'supervisor', equipe_id: 'a', ativo: true },
        { id: 'y', nome: 'Y', perfil: 'supervisor', equipe_id: 'b', ativo: true },
      ],
    );
    expect(ciclo).toHaveLength(2);
    expect(subordinadosDe(ciclo, 'x').length).toBeLessThanOrEqual(1);
  });
  it('RN-CORE-04: o recorte do usuário não revela quem está acima (superior fora do conjunto vira null)', () => {
    const r = recortarHierarquia(h, new Set(['sup', 'v1', 'p1']));
    expect(r.map((m) => m.id).sort()).toEqual(['p1', 'sup', 'v1']);
    expect(sup(r, 'sup')).toBeNull();
    expect(sup(r, 'v1')).toBe('sup');
  });
  it('RN-CORE-04: recorte "tenant" devolve a árvore inteira', () => {
    expect(recortarHierarquia(h, 'tenant')).toHaveLength(6);
  });
});

describe('gestor imediato do Perfil (RN-CORE-04)', () => {
  it('RN-CORE-04: o gestor imediato é o superior imediato (id e nome); sem superior, null', () => {
    expect(gestorImediatoDe(equipes, usuarios, 'v1')).toEqual({ id: 'sup', nome: 'Supervisor' });
    expect(gestorImediatoDe(equipes, usuarios, 'sup')).toEqual({ id: 'ger', nome: 'Gerente' });
    expect(gestorImediatoDe(equipes, usuarios, 'ger')).toBeNull();
    expect(gestorImediatoDe(equipes, usuarios, 'inexistente')).toBeNull();
  });
  it('RN-CORE-04: superior inativo não aparece como gestor imediato', () => {
    expect(gestorImediatoDe(equipes, usuarios.map((u) => (u.id === 'sup' ? { ...u, ativo: false } : u)), 'v1')).toBeNull();
  });
});

describe('superior imediato derivado da equipe (RF-CORE-02; RN-CORE-04)', () => {
  it('RN-CORE-04: o superior de quem entra na equipe é o responsável dela', () => {
    expect(superiorImediato(equipes, 'eq1', null)).toBe('sup');
  });
  it('RN-CORE-04: equipe sem responsável sobe para o responsável da equipe-pai', () => {
    expect(superiorImediato(equipes, 'eq2', null)).toBe('ger');
  });
  it('RN-CORE-04: sem equipe (ou equipe desconhecida) não há superior', () => {
    expect(superiorImediato(equipes, null, null)).toBeNull();
    expect(superiorImediato(equipes, 'nada', null)).toBeNull();
  });
});
