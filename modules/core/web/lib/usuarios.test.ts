import { describe, expect, it } from 'vitest';
import type { EquipeOpcao, UsuarioItem } from '../../contracts';
import { permilDoTexto, textoDoPermil, acaoDeSenha, corpoDeCriacao, corpoDeEdicao, corpoDeRedefinicao, errosDoFormulario, etiquetaDeSenha, FORMULARIO_VAZIO, formularioDoUsuario, gerarSenhaNoNavegador, opcoesDeChefia, pessoasDaLista, resultadoDeCriar, resultadoDeRedefinir, seloDoUsuario, textoAcessoEnviado, textoDoSuperiorDaEquipe, provisoriosParaVincular, podeVincularErp, corpoDeVinculoErp, textoDoVinculoErp, tituloDaConfirmacaoDoVinculo, emailParaLista, codigoFdvParaLista } from './usuarios';
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
    expect(resultadoDeCriar('enfileirado', 'ana@x.com', 'Abcdef1!')).toEqual({ tipo: 'enviado', texto: 'Usuário criado. O acesso vai para ana@x.com.' });
    const sem = resultadoDeCriar('indisponivel', 'ana@x.com', 'Abcdef1!');
    expect(sem).toMatchObject({ tipo: 'sem_email', senha: 'Abcdef1!' });
    expect(sem.tipo === 'sem_email' && sem.antes + sem.senha + sem.depois).toBe('Usuário criado, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: Abcdef1!.');
    expect(resultadoDeRedefinir('enfileirado', 'ana@x.com', 'Abcdef1!')).toEqual({ tipo: 'enviado', texto: 'Senha redefinida e enviada para ana@x.com.' });
    expect(resultadoDeRedefinir('indisponivel', 'ana@x.com', 'Abcdef1!')).toMatchObject({ tipo: 'sem_email' });
    expect(JSON.stringify(resultadoDeCriar('enfileirado', 'ana@x.com', 'Abcdef1!'))).not.toContain('Abcdef1!');
    expect(textoAcessoEnviado('ana@x.com')).toBe('Acesso enviado para ana@x.com.');
  });
});

describe('RN-CORE-55/56/57 (0069): hierarquia e código no ERP na gaveta Novo usuário (R-20261114-153500/153800/154000)', () => {
  const G1 = '5d000000-0000-4000-8000-0000000000a1';
  const G2 = '5d000000-0000-4000-8000-0000000000a2';
  const S1 = '5d000000-0000-4000-8000-0000000000b1';
  const S2 = '5d000000-0000-4000-8000-0000000000b2';
  const lista = [
    u({ id: G1, nome: 'Gil', cargo: 'gerente' }),
    u({ id: G2, nome: 'Gabi', cargo: 'gerente', ativo: false }),
    u({ id: S2, nome: 'Sara', cargo: 'supervisor', gerente_id: G1 }),
    u({ id: S1, nome: 'Rui', cargo: 'supervisor', gerente_id: G2 }),
  ];
  const ok = { ...FORMULARIO_VAZIO, nome: 'Ana', email: 'ana@exemplo.com.br', senha: 'Abcdef1!', perfis: ['vendedor'], external_id: 'V-10' };

  it('RN-CORE-57: sem código no ERP a gaveta para no campo, para todos os cargos', () => {
    expect(errosDoFormulario({ ...ok, external_id: ' ' }, 'editar', { cargo: 'administrativo', pessoas: [] })).toEqual([{ campo: 'external_id', mensagem: 'Informe o código no ERP.' }]);
  });

  it('supervisores e gerentes ativos, por nome; o supervisor do promotor só entre os do gerente escolhido', () => {
    expect(opcoesDeChefia(lista, 'gerente').map((x) => x.nome)).toEqual(['Gil']);
    expect(opcoesDeChefia(lista, 'supervisor').map((x) => x.nome)).toEqual(['Rui', 'Sara']);
    expect(opcoesDeChefia(lista, 'supervisor', G1).map((x) => x.nome)).toEqual(['Sara']);
  });

  it('a tela confere a mesma regra da API: vendedor sem supervisor e promotor sem gerente param no campo', () => {
    const pessoas = pessoasDaLista(lista);
    expect(errosDoFormulario(ok, 'criar', { cargo: 'vendedor', pessoas }).map((e) => e.campo)).toEqual(['supervisor_id']);
    expect(errosDoFormulario({ ...ok, supervisor_id: S2 }, 'criar', { cargo: 'vendedor', pessoas })).toEqual([]);
    expect(errosDoFormulario(ok, 'criar', { cargo: 'promotor', pessoas }).map((e) => e.mensagem)).toEqual(['Escolha o gerente.']);
    expect(errosDoFormulario({ ...ok, gerente_id: G1, supervisor_id: S1 }, 'criar', { cargo: 'promotor', pessoas }).map((e) => e.campo)).toEqual(['gerente_id']);
    expect(errosDoFormulario({ ...ok, gerente_id: G1 }, 'criar', { cargo: 'supervisor', pessoas }).map((e) => e.campo)).toEqual(['equipe_nome']);
    expect(errosDoFormulario(ok, 'criar', { cargo: 'administrativo', pessoas })).toEqual([]);
  });

  it('o corpo leva só a hierarquia do cargo; sem cargo, nada de hierarquia (como antes)', () => {
    const f = { ...ok, supervisor_id: S2, gerente_id: G1, equipe_nome: 'Norte' };
    expect(corpoDeCriacao(f, 'vendedor')).toMatchObject({ supervisor_id: S2, gerente_id: null, equipe_nome: null });
    expect(corpoDeCriacao(f, 'supervisor')).toMatchObject({ supervisor_id: null, gerente_id: G1, equipe_nome: 'Norte' });
    expect(corpoDeEdicao(f, 'administrativo')).toMatchObject({ supervisor_id: null, gerente_id: null, equipe_nome: null });
    expect(corpoDeEdicao(f, 'gerente')).toMatchObject({ supervisor_id: null, gerente_id: null, equipe_nome: 'Norte' });
    expect(corpoDeEdicao(f)).not.toHaveProperty('supervisor_id');
  });

  it('editar abre com a hierarquia gravada; o nome da equipe só para o supervisor', () => {
    expect(formularioDoUsuario(u({ cargo: 'vendedor', supervisor_id: S2, gerente_id: G1 }))).toMatchObject({ supervisor_id: S2, gerente_id: G1, equipe_nome: '' });
    expect(formularioDoUsuario(u({ cargo: 'supervisor', gerente_id: G1, equipe_nome: 'Norte' })).equipe_nome).toBe('Norte');
  });
});

describe('usuario-bloqueio §2: seloDoUsuario (um selo por linha, hora no fuso do tenant)', () => {
  const AGORA = new Date('2026-11-15T00:30:00Z'); // 20h30 em Manaus (UTC-4), dia 14
  const M = 'America/Manaus';
  it('inativo vale mais que o bloqueio (quem resolve é o Reativar)', () => {
    expect(seloDoUsuario(u({ ativo: false, bloqueio: 'admin' }), AGORA, M)).toEqual({ tom: 'neutral', texto: 'Inativo', bloqueado: false });
  });
  it('bloqueio do admin: "Bloqueado", danger', () => {
    expect(seloDoUsuario(u({ bloqueio: 'admin', bloqueio_ate: null }), AGORA, M)).toEqual({ tom: 'danger', texto: 'Bloqueado', bloqueado: true });
  });
  it('bloqueio por tentativas: "Bloqueado até HHhMM" no fuso do tenant, warning', () => {
    expect(seloDoUsuario(u({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-15T00:55:00.000Z' }), AGORA, M)).toEqual({ tom: 'warning', texto: 'Bloqueado até 20h55', bloqueado: true });
    expect(seloDoUsuario(u({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-15T13:05:00.000Z' }), new Date('2026-11-15T13:00:00Z'), M)?.texto).toBe('Bloqueado até 09h05');
  });
  it('virada da meia-noite em Manaus: 03h59 UTC vira 23h59 do dia anterior; 04h10 UTC vira 00h10', () => {
    expect(seloDoUsuario(u({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-15T03:59:00.000Z' }), new Date('2026-11-15T03:50:00Z'), M)?.texto).toBe('Bloqueado até 23h59');
    expect(seloDoUsuario(u({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-15T04:10:00.000Z' }), new Date('2026-11-15T03:58:00Z'), M)?.texto).toBe('Bloqueado até 00h10');
  });
  it('bloqueio por tentativas vencido: sem selo', () => {
    expect(seloDoUsuario(u({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-15T00:30:00.000Z' }), AGORA, M)).toBeNull();
  });
  it('sem bloqueio (0 a 4 senhas erradas não aparecem): sem selo', () => {
    expect(seloDoUsuario(u({ bloqueio: null, bloqueio_ate: null }), AGORA, M)).toBeNull();
    expect(seloDoUsuario(u({}), AGORA, M)).toBeNull();
  });
});

describe('RN-CORE-58/59: Vincular vendedor do ERP e Código FDV no BKO (spec erp-vinculo)', () => {
  const real = u({ id: '5d000000-0000-4000-8000-0000000000a1', nome: 'Carla Souza', external_id: null });
  const prov = (n: string, extra: Partial<UsuarioItem> = {}) => u({ id: `5d000000-0000-4000-8000-0000000000b${n}`, nome: `PROV ${n}`, provisorio: true, external_id: `V-0${n}`, email: 'erp-1@sem-email.invalid', ...extra });
  it('RN-CORE-58: só são opções os provisórios ativos, com código, do mesmo perfil', () => {
    const itens = [real, prov('2'), prov('1'), prov('3', { perfil: 'promotor' }), prov('4', { ativo: false }), prov('5', { external_id: null }), u({ id: '5d000000-0000-4000-8000-0000000000c1', external_id: 'V-9' })];
    expect(provisoriosParaVincular(itens, real).map((x) => x.nome)).toEqual(['PROV 1', 'PROV 2']);
  });
  it('RN-CORE-58: o botão só aparece para vendedor ou promotor real, sem Código no ERP e com provisório do mesmo perfil', () => {
    const itens = [real, prov('1')];
    expect(podeVincularErp(itens, real)).toBe(true);
    expect(podeVincularErp([real], real)).toBe(false);
    expect(podeVincularErp(itens, { ...real, external_id: 'V-7' })).toBe(false);
    expect(podeVincularErp(itens, { ...real, perfil: 'supervisor' })).toBe(false);
    expect(podeVincularErp(itens, { ...real, provisorio: true })).toBe(false);
  });
  it('RN-CORE-58: corpo, título e aviso do vínculo', () => {
    expect(corpoDeVinculoErp(real.id)).toEqual({ usuario_id: real.id });
    expect(tituloDaConfirmacaoDoVinculo(prov('1'), real)).toBe('Vincular o provisório V-01 a Carla Souza?');
    expect(textoDoVinculoErp({ clientes_movidos: 38, ja_vinculado: false }, 'Carla Souza')).toBe('Vínculo feito: 38 clientes passaram para Carla Souza.');
    expect(textoDoVinculoErp({ clientes_movidos: 1, ja_vinculado: false }, 'Carla Souza')).toBe('Vínculo feito: 1 cliente passou para Carla Souza.');
    expect(textoDoVinculoErp({ clientes_movidos: 0, ja_vinculado: true }, 'Carla Souza')).toBe('Carla Souza já estava vinculado.');
  });
  it('RN-CORE-59: a lista mostra o Código FDV e "—" no e-mail do provisório', () => {
    expect(emailParaLista(prov('1'))).toBe('—');
    expect(emailParaLista(real)).toBe('vera@exemplo.com.br');
    expect(codigoFdvParaLista({ codigo_fdv: '00007' })).toBe('00007');
    expect(codigoFdvParaLista({ codigo_fdv: null })).toBe('—');
    expect(codigoFdvParaLista({})).toBe('—');
  });
});
