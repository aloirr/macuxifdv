import { describe, expect, it } from 'vitest';
import type { EquipeOpcao, UsuarioItem } from '../../contracts';
import { corpoDeCriacao, corpoDeEdicao, csvDeUsuarios, errosDoFormulario, FORMULARIO_VAZIO, formularioDoUsuario, textoDoSuperiorDaEquipe } from './usuarios';

const u = (extra: Partial<UsuarioItem> = {}): UsuarioItem => ({
  id: '5d000000-0000-4000-8000-000000000001',
  nome: 'Vera "Vendedora"',
  nome_curto: null,
  email: 'vera@exemplo.com.br',
  perfil: 'vendedor',
  equipe_id: null,
  equipe_nome: 'Equipe 1',
  superior_id: null,
  superior_nome: 'Sérgio Supervisor',
  ativo: true,
  external_id: 'V-1',
  ultimo_login_em: null,
  ...extra,
});

describe('RF-CORE-02: tela Usuários do BKO', () => {
  const ok = { ...FORMULARIO_VAZIO, nome: 'Ana', email: 'ana@exemplo.com.br', senha: 'Abcdef12' };

  it('RF-CORE-02: formulário válido não tem erros; criar exige senha inicial que atenda a política', () => {
    expect(errosDoFormulario(ok, 'criar')).toEqual([]);
    expect(errosDoFormulario({ ...ok, senha: '123' }, 'criar').map((e) => e.campo)).toEqual(['senha']);
    expect(errosDoFormulario({ ...ok, senha: '' }, 'editar')).toEqual([]);
  });
  it('RF-CORE-02: nome vazio e e-mail inválido aparecem por campo', () => {
    expect(errosDoFormulario({ ...ok, nome: ' ', email: 'x' }, 'editar').map((e) => e.campo).sort()).toEqual(['email', 'nome']);
  });
  it('RF-CORE-02: campos opcionais vazios viram null no corpo; a edição nunca envia senha', () => {
    const c = corpoDeCriacao({ ...ok, external_id: '  ', equipe_id: '' });
    expect(c).toMatchObject({ external_id: null, equipe_id: null, nome_curto: null, ativo: true, senha: 'Abcdef12' });
    expect(corpoDeEdicao({ ...ok, external_id: 'V-9' })).not.toHaveProperty('senha');
  });
  it('RF-CORE-02: o formulário de edição nasce do usuário, com senha em branco', () => {
    expect(formularioDoUsuario(u())).toMatchObject({ nome: 'Vera "Vendedora"', external_id: 'V-1', senha: '' });
  });
  it('RN-CORE-04: o superior mostrado deriva da equipe escolhida', () => {
    const eq = (e: Partial<EquipeOpcao>): EquipeOpcao => ({ id: 'e1', nome: 'E1', equipe_pai_id: null, responsavel_id: null, responsavel_nome: null, superior_id: null, superior_nome: null, ...e });
    expect(textoDoSuperiorDaEquipe([], '')).toContain('sem superior');
    expect(textoDoSuperiorDaEquipe([eq({ superior_nome: 'Sérgio' })], 'e1')).toContain('Sérgio');
    expect(textoDoSuperiorDaEquipe([eq({})], 'e1')).toContain('sem superior');
  });
  it('CSV: cabeçalho em português, aspas escapadas, BOM e nada de senha', () => {
    const csv = csvDeUsuarios([u(), u({ ativo: false, equipe_nome: null })]);
    expect(csv.startsWith('﻿"Nome";"E-mail"')).toBe(true);
    expect(csv).toContain('"Vera ""Vendedora"""');
    expect(csv).toContain('"Inativo"');
    expect(csv.toLowerCase()).not.toContain('senha');
  });
});
