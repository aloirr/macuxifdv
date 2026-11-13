import { describe, expect, it } from 'vitest';
import type { EquipeOpcao, UsuarioItem } from '../../contracts';
import { permilDoTexto, textoDoPermil, acaoDeSenha, corpoDeCriacao, corpoDeEdicao, corpoDeRedefinicao, csvDeUsuarios, errosDoFormulario, etiquetaDeSenha, FORMULARIO_VAZIO, formularioDoUsuario, gerarSenhaNoNavegador, resultadoDeCriar, resultadoDeRedefinir, textoAcessoEnviado, textoDoSuperiorDaEquipe } from './usuarios';
import { senhaServe } from '../../domain';

const u = (extra: Partial<UsuarioItem> = {}): UsuarioItem => ({
  id: '5d000000-0000-4000-8000-000000000001',
  nome: 'Vera "Vendedora"',
  nome_curto: null,
  email: 'vera@exemplo.com.br',
  perfis: [],
  perfil: 'vendedor',
  equipe_id: null,
  equipe_nome: 'Equipe 1',
  superior_id: null,
  superior_nome: 'Sérgio Supervisor',
  ativo: true,
  external_id: 'V-1',
  ultimo_login_em: null,
  trocar_senha: false,
  senha_expira_em: null,
  sem_senha: false,
  desconto_limita_item: true,
  desconto_limita_pedido: false,
  desconto_maximo_pedido_permil: null,
  ...extra,
});

describe('RF-CORE-02: tela Usuários do BKO', () => {
  const ok = { ...FORMULARIO_VAZIO, nome: 'Ana', email: 'ana@exemplo.com.br', senha: 'Abcdef1!', perfis: ['vendedor'] };

  it('RN-CORE-32: formulário válido não tem erros; criar exige senha inicial que atenda a política', () => {
    expect(errosDoFormulario(ok, 'criar')).toEqual([]);
    expect(errosDoFormulario({ ...ok, senha: '123' }, 'criar').map((e) => e.campo)).toEqual(['senha']);
    expect(errosDoFormulario({ ...ok, senha: '' }, 'editar')).toEqual([]);
    expect(errosDoFormulario({ ...ok, perfis: [] }, 'editar').map((e) => e.campo)).toEqual(['perfil']);
  });
  it('RF-CORE-02: nome vazio e e-mail inválido aparecem por campo', () => {
    expect(errosDoFormulario({ ...ok, nome: ' ', email: 'x' }, 'editar').map((e) => e.campo).sort()).toEqual(['email', 'nome']);
  });
  it('RF-CORE-02: campos opcionais vazios viram null no corpo; a edição nunca envia senha', () => {
    const c = corpoDeCriacao({ ...ok, external_id: '  ', equipe_id: '' });
    expect(c).toMatchObject({ external_id: null, equipe_id: null, nome_curto: null, ativo: true, senha: 'Abcdef1!' });
    expect(corpoDeEdicao({ ...ok, external_id: 'V-9' })).not.toHaveProperty('senha');
  });
  it('RN-VEN-11a: "por pedido" ligada exige o número (Obrigatório) e de 0 a 100; desligada, o campo não é cobrado', () => {
    expect(errosDoFormulario({ ...ok, limita_pedido: true, desconto_maximo_pedido: '' }, 'editar')).toEqual([{ campo: 'desconto_maximo_pedido', mensagem: 'Obrigatório' }]);
    expect(errosDoFormulario({ ...ok, limita_pedido: true, desconto_maximo_pedido: '100,1' }, 'editar')[0]?.mensagem).toBe('De 0 a 100');
    expect(errosDoFormulario({ ...ok, limita_pedido: true, desconto_maximo_pedido: '0' }, 'editar')).toEqual([]);
    expect(errosDoFormulario({ ...ok, limita_pedido: false, desconto_maximo_pedido: '' }, 'editar')).toEqual([]);
  });
  it('RN-VEN-11a: o corpo converte % em décimos de % (8,0% = 80) e mantém o valor guardado com "por pedido" desligada', () => {
    expect(permilDoTexto('8,0')).toBe(80);
    expect(permilDoTexto('7,5')).toBe(75);
    expect(textoDoPermil(75)).toBe('7,5');
    expect(textoDoPermil(null)).toBe('');
    expect(corpoDeEdicao({ ...ok, limita_pedido: true, desconto_maximo_pedido: '8,0' })).toMatchObject({ desconto_limita_item: true, desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 });
    expect(corpoDeEdicao({ ...ok, limita_pedido: false, desconto_maximo_pedido: '8,0' })).toMatchObject({ desconto_limita_pedido: false, desconto_maximo_pedido_permil: 80 });
    expect(corpoDeCriacao(ok)).toMatchObject({ desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null });
    expect(formularioDoUsuario(u({ desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 }))).toMatchObject({ limita_pedido: true, desconto_maximo_pedido: '8,0' });
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

describe('RN-CORE-34: senha por e-mail no BKO (T-0094)', () => {
  const agora = new Date('2026-11-07T12:00:00Z');
  const FUSO = 'America/Manaus';
  it('RN-CORE-34: etiquetas — pendente com vencimento no fuso do tenant, vencida, sem validade, "Sem senha" e nenhuma para senha definitiva', () => {
    expect(etiquetaDeSenha(u(), FUSO, agora)).toBeNull();
    expect(etiquetaDeSenha(u({ trocar_senha: true, senha_expira_em: '2026-11-09T18:30:00.000Z' }), FUSO, agora)).toEqual({ texto: 'Troca de senha pendente · vence em 09/11 às 14:30', tom: 'warning' });
    expect(etiquetaDeSenha(u({ trocar_senha: true, senha_expira_em: null }), FUSO, agora)).toEqual({ texto: 'Troca de senha pendente', tom: 'warning' });
    expect(etiquetaDeSenha(u({ trocar_senha: true, senha_expira_em: '2026-11-07T12:00:00.000Z' }), FUSO, agora)).toEqual({ texto: 'Senha temporária vencida', tom: 'danger' });
    expect(etiquetaDeSenha(u({ sem_senha: true }), FUSO, agora)).toEqual({ texto: 'Sem senha', tom: 'neutral' });
  });
  it('RN-CORE-34 (P7): "Redefinir senha" some para admin e para inativo; "Enviar acesso" para quem não tem senha', () => {
    expect(acaoDeSenha(u())).toEqual({ rotulo: 'Redefinir senha' });
    expect(acaoDeSenha(u({ sem_senha: true }))).toEqual({ rotulo: 'Enviar acesso' });
    expect(acaoDeSenha(u({ perfil: 'admin' }))).toBeNull();
    expect(acaoDeSenha(u({ ativo: false }))).toBeNull();
    expect(acaoDeSenha(u({ perfil: 'analista', perfis: [{ codigo: 'analista', base: 'analista', nome: 'Analista' }, { codigo: 'admin', base: 'admin', nome: 'Admin' }] }))).toBeNull();
  });
  it('RN-CORE-34: "Gerar senha" produz 12 caracteres que passam na RN-CORE-32', () => {
    let k = 7;
    const s = gerarSenhaNoNavegador((n) => Uint8Array.from({ length: n }, () => (k = (k * 73 + 41) & 0xff)));
    expect(s).toHaveLength(12);
    expect(senhaServe(s)).toBe(true);
  });
  it('RN-CORE-34: "Enviar acesso" não leva senha (o servidor gera); "Redefinir" envia a informada', () => {
    expect(corpoDeRedefinicao('')).toEqual({});
    expect(corpoDeRedefinicao('Abcdef1!')).toEqual({ senha: 'Abcdef1!' });
  });
  it('RN-CORE-34: os avisos dependem do resultado do e-mail; a senha só aparece quando o e-mail não saiu', () => {
    expect(resultadoDeCriar('enfileirado', 'ana@x.com', 'Abcdef1!')).toEqual({ tipo: 'enviado', texto: 'Usuário criado. O acesso vai para ana@x.com em alguns minutos.' });
    const sem = resultadoDeCriar('indisponivel', 'ana@x.com', 'Abcdef1!');
    expect(sem).toMatchObject({ tipo: 'sem_email', senha: 'Abcdef1!' });
    expect(sem.tipo === 'sem_email' && sem.antes + sem.senha + sem.depois).toBe('Usuário criado, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: Abcdef1!. Ela cria a dela no primeiro acesso.');
    expect(resultadoDeRedefinir('enfileirado', 'ana@x.com', 'Abcdef1!')).toEqual({ tipo: 'enviado', texto: 'Senha redefinida. A senha nova vai para ana@x.com em alguns minutos.' });
    expect(resultadoDeRedefinir('indisponivel', 'ana@x.com', 'Abcdef1!')).toMatchObject({ tipo: 'sem_email' });
    expect(JSON.stringify(resultadoDeCriar('enfileirado', 'ana@x.com', 'Abcdef1!'))).not.toContain('Abcdef1!');
    expect(textoAcessoEnviado('ana@x.com')).toBe('Acesso enviado para ana@x.com.');
  });
});
