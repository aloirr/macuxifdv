import { describe, expect, it } from 'vitest';
import { cargoDaBase, CARGOS, CODIGOS_HIERARQUIA } from '../contracts/cargos';
import { equipeChefiadaPor, erroDoCodigoErp, errosDaHierarquia, gerenteDaHierarquia, hierarquiaDoCargo, regrasDoCargo, responsavelDaEquipe, type PessoaDaHierarquia } from './cargos';

const GER = 'g1';
const GER2 = 'g2';
const SUP = 's1';
const pessoas: PessoaDaHierarquia[] = [
  { id: GER, cargo: 'gerente', gerente_id: null, ativo: true },
  { id: GER2, cargo: 'gerente', gerente_id: null, ativo: true },
  { id: SUP, cargo: 'supervisor', gerente_id: GER, ativo: true },
  { id: 'v1', cargo: 'vendedor', gerente_id: GER, ativo: true },
  { id: 's-inativo', cargo: 'supervisor', gerente_id: GER, ativo: false },
];
const codigos = (e: { codigo: string }[]) => e.map((x) => x.codigo);

describe('RN-CORE-55/56/57: cargos e hierarquia do cadastro (ADR 0049; R-20261114-153500/153800/154000)', () => {
  it('RN-CORE-53: os cargos são 5, fixos (do SDK); o cargo de fábrica de analista, assistente e admin é Administrativo', () => {
    expect(CARGOS).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo']);
    expect(cargoDaBase('promotor')).toBe('promotor');
    expect(cargoDaBase('analista')).toBe('administrativo');
    expect(cargoDaBase('admin')).toBe('administrativo');
  });

  it('RN-CORE-55: campos por cargo: vendedor pede supervisor (gerente derivado); promotor gerente (supervisor opcional); supervisor gerente e equipe; gerente equipe opcional; sem cargo, nada', () => {
    expect(regrasDoCargo('vendedor')).toEqual({ supervisor: 'obrigatorio', gerente: 'derivado', nomeEquipe: 'nao' });
    expect(regrasDoCargo('promotor')).toEqual({ supervisor: 'opcional', gerente: 'obrigatorio', nomeEquipe: 'nao' });
    expect(regrasDoCargo('supervisor')).toEqual({ supervisor: 'nao', gerente: 'obrigatorio', nomeEquipe: 'obrigatorio' });
    expect(regrasDoCargo('gerente')).toEqual({ supervisor: 'nao', gerente: 'nao', nomeEquipe: 'opcional' });
    expect(regrasDoCargo(null)).toEqual(regrasDoCargo('administrativo'));
  });

  it('o que o cargo não usa é zerado (trocar o perfil não deixa supervisor escondido)', () => {
    expect(hierarquiaDoCargo('administrativo', { supervisor_id: SUP, gerente_id: GER, equipe_nome: 'X' })).toEqual({ supervisor_id: null, gerente_id: null, equipe_nome: null });
    expect(hierarquiaDoCargo('gerente', { supervisor_id: SUP, gerente_id: GER, equipe_nome: 'Regional Norte' })).toEqual({ supervisor_id: null, gerente_id: null, equipe_nome: 'Regional Norte' });
    expect(hierarquiaDoCargo('vendedor', { supervisor_id: SUP, gerente_id: GER })).toEqual({ supervisor_id: SUP, gerente_id: null, equipe_nome: null });
    expect(hierarquiaDoCargo('supervisor', { gerente_id: GER, equipe_nome: '  Norte  ' }).equipe_nome).toBe('Norte');
  });

  it('RN-CORE-55: vendedor: supervisor obrigatório e com cargo Supervisor ativo; o gerente vem do supervisor', () => {
    expect(codigos(errosDaHierarquia('vendedor', {}, pessoas))).toEqual([CODIGOS_HIERARQUIA.supervisorObrigatorio]);
    expect(codigos(errosDaHierarquia('vendedor', { supervisor_id: GER }, pessoas))).toEqual([CODIGOS_HIERARQUIA.supervisorInvalido]);
    expect(codigos(errosDaHierarquia('vendedor', { supervisor_id: 's-inativo' }, pessoas))).toEqual([CODIGOS_HIERARQUIA.supervisorInvalido]);
    expect(errosDaHierarquia('vendedor', { supervisor_id: SUP }, pessoas)).toEqual([]);
    expect(gerenteDaHierarquia('vendedor', { supervisor_id: SUP, gerente_id: GER2 }, pessoas)).toBe(GER);
  });

  it('RN-CORE-56: promotor: gerente obrigatório; supervisor opcional; com supervisor, o gerente tem de ser o dele (R-20261114-154000)', () => {
    expect(codigos(errosDaHierarquia('promotor', {}, pessoas))).toEqual([CODIGOS_HIERARQUIA.gerenteObrigatorio]);
    expect(errosDaHierarquia('promotor', { gerente_id: GER }, pessoas)).toEqual([]);
    expect(errosDaHierarquia('promotor', { gerente_id: GER, supervisor_id: SUP }, pessoas)).toEqual([]);
    expect(codigos(errosDaHierarquia('promotor', { gerente_id: GER2, supervisor_id: SUP }, pessoas))).toEqual([CODIGOS_HIERARQUIA.gerenteDoSupervisor]);
    expect(codigos(errosDaHierarquia('promotor', { gerente_id: SUP }, pessoas))).toEqual([CODIGOS_HIERARQUIA.gerenteInvalido]);
    expect(gerenteDaHierarquia('promotor', { gerente_id: GER }, pessoas)).toBe(GER);
  });

  it('RN-CORE-55: supervisor: gerente com cargo Gerente e o nome da equipe obrigatórios', () => {
    expect(codigos(errosDaHierarquia('supervisor', { equipe_nome: ' ' }, pessoas))).toEqual([CODIGOS_HIERARQUIA.gerenteObrigatorio, CODIGOS_HIERARQUIA.equipeObrigatoria]);
    expect(codigos(errosDaHierarquia('supervisor', { gerente_id: 'v1', equipe_nome: 'Norte' }, pessoas))).toEqual([CODIGOS_HIERARQUIA.gerenteInvalido]);
    expect(errosDaHierarquia('supervisor', { gerente_id: GER, equipe_nome: 'Norte' }, pessoas)).toEqual([]);
  });

  it('RN-CORE-55: gerente (equipe opcional) e administrativo não têm vínculo a conferir', () => {
    expect(errosDaHierarquia('gerente', { supervisor_id: 'qualquer' }, pessoas)).toEqual([]);
    expect(errosDaHierarquia('administrativo', {}, pessoas)).toEqual([]);
  });

  it('RN-CORE-57: o código no ERP é obrigatório', () => {
    expect(erroDoCodigoErp('  ')?.codigo).toBe(CODIGOS_HIERARQUIA.codigoErpObrigatorio);
    expect(erroDoCodigoErp(null)?.campo).toBe('external_id');
    expect(erroDoCodigoErp('V-10')).toBeNull();
  });

  it('RN-CORE-55/56: a equipe em que entra: vendedor na do supervisor; promotor na do supervisor ou, sem ele, na do gerente', () => {
    expect(responsavelDaEquipe('vendedor', { supervisor_id: SUP })).toBe(SUP);
    expect(responsavelDaEquipe('promotor', { supervisor_id: SUP, gerente_id: GER })).toBe(SUP);
    expect(responsavelDaEquipe('promotor', { gerente_id: GER })).toBe(GER);
    expect(responsavelDaEquipe('supervisor', { gerente_id: GER })).toBeNull();
    const equipes = [{ id: 'e2', responsavel_id: SUP }, { id: 'e1', responsavel_id: SUP }, { id: 'e3', responsavel_id: GER }];
    expect(equipeChefiadaPor(equipes, SUP)?.id).toBe('e1');
    expect(equipeChefiadaPor(equipes, 'ninguem')).toBeNull();
  });
});
