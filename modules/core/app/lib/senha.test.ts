import { ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { textoDoErroDaSenha } from '../../contracts';
import { mensagemDeErroDeLogin } from './login';
import {
  detalhesDaTroca,
  ehSenhaATrocar,
  erroDaTroca,
  erroDaTrocaVoluntaria,
  erroDoEsqueci,
  pedirSenhaTemporaria,
  repeticaoDaSenha,
  subtituloDaTroca,
  textoDeEspera,
  trocarSenhaDoPerfil,
  trocarSenhaPeloApp,
  validarEsqueci,
  validarTroca,
} from './senha';

const erroApi = (codigo: string, detalhes?: Record<string, unknown>, message = 'x') => Object.assign(new Error(message), { codigo, detalhes });
const sessao = {
  access_token: 'a',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'r'.repeat(20),
  usuario: { id: '0b000000-0000-4000-8000-000000000001', nome: 'Vera', nome_curto: null, email: 'v@x.com', perfil: 'vendedor' },
  tenant: { id: '0a000000-0000-4000-8000-0000000000aa', codigo: 'AM4821', nome: 'Alfa', fuso: 'America/Manaus' },
};

describe('RN-CORE-34: Crie sua senha no app', () => {
  it('RN-CORE-34: SENHA_A_TROCAR leva à tela de troca com o motivo; outro erro não', () => {
    expect(detalhesDaTroca(erroApi('SENHA_A_TROCAR', { motivo: 'primeiro_acesso', expira_em: null }))).toEqual({ motivo: 'primeiro_acesso', expira_em: null });
    expect(detalhesDaTroca(erroApi('SENHA_A_TROCAR'))).toEqual({ motivo: 'senha_temporaria', expira_em: null });
    expect(ehSenhaATrocar(erroApi('CREDENCIAIS_INVALIDAS'))).toBe(false);
    expect(subtituloDaTroca('primeiro_acesso')).toBe('É o seu primeiro acesso. Crie uma senha só sua para continuar.');
    expect(subtituloDaTroca('senha_temporaria')).toBe('Você entrou com uma senha temporária. Crie uma senha nova para continuar.');
  });

  it('RN-CORE-32: só envia com a regra da senha cumprida e as duas digitações iguais', () => {
    expect(validarTroca('curta', 'curta')).toMatchObject({ ok: false, repeticao: 'igual' });
    expect(validarTroca('Boa#Senha1', 'Boa#Senha2')).toMatchObject({ ok: false, repeticao: 'diferente', faltas: [] });
    expect(validarTroca('Boa#Senha1', '')).toMatchObject({ ok: false, repeticao: 'vazia' });
    expect(validarTroca('Boa#Senha1', 'Boa#Senha1')).toEqual({ ok: true, faltas: [], repeticao: 'igual' });
    expect(repeticaoDaSenha('a', 'a')).toBe('igual');
  });

  it('RN-CORE-34: as respostas da API viram a frase e a ação do desenho (ciclo-de-senha.md §2)', () => {
    expect(erroDaTroca(erroApi('RN-CORE-34'))).toEqual({ texto: 'A senha nova precisa ser diferente da senha que você recebeu.', acao: 'limpar' });
    expect(erroDaTroca(erroApi('CREDENCIAIS_INVALIDAS'))).toEqual({ texto: 'Esta senha não vale mais. Entre de novo.', acao: 'voltar_ao_login' });
    expect(erroDaTroca(erroApi('SENHA_TEMPORARIA_VENCIDA'))).toMatchObject({ acao: 'voltar_ao_login', texto: expect.stringContaining('venceu') });
    expect(erroDaTroca(erroApi('PERFIL_FORA_DO_APP', undefined, 'O perfil promotor não usa o app Macuxi Gestão.'))).toEqual({ texto: 'O perfil promotor não usa o app Macuxi Gestão.', acao: 'voltar_ao_login' });
    const fraca = erroDaTroca(erroApi('RN-CORE-32', { faltas: ['numero'] }));
    expect(fraca).toEqual({ texto: 'Falta um número.', acao: 'destacar' });
    expect(erroDaTroca(new ErroSemConexao())).toEqual({ texto: 'Conecte-se à internet para criar a sua senha.', acao: 'ficar' });
  });

  it('RN-CORE-32: um texto só para o 422 da senha, sem código técnico (faltas, lista vazia, sem detalhes, longa demais)', () => {
    expect(textoDoErroDaSenha(erroApi('RN-CORE-32', { faltas: ['numero'] }))).toBe('Falta um número.');
    expect(textoDoErroDaSenha(erroApi('RN-CORE-32', { faltas: [] }, 'RN-CORE-32 senha fraca'))).toBe('A senha não pode ser igual ao e-mail.');
    expect(textoDoErroDaSenha(erroApi('RN-CORE-32'))).toBe('A senha não pode ser igual ao e-mail.');
    expect(textoDoErroDaSenha({ code: 'RN-CORE-32', details: { faltas: ['numero'] } })).toBe('Falta um número.');
    expect(textoDoErroDaSenha(erroApi('RN-CORE-32', { faltas: ['caracteres'] }), 'a'.repeat(201))).toBe('A senha pode ter até 200 caracteres.');
    expect(erroDaTroca(erroApi('RN-CORE-32', { faltas: ['caracteres'] }), 'a'.repeat(201)).texto).toBe('A senha pode ter até 200 caracteres.');
  });

  it('RN-CORE-34: troca pela API pública com o app da variante e valida a sessão devolvida (a senha atual vai só no corpo)', async () => {
    const chamadas: Array<{ caminho: string; corpo: Record<string, unknown> }> = [];
    const post = async (caminho: string, corpo: unknown) => {
      chamadas.push({ caminho, corpo: corpo as Record<string, unknown> });
      return sessao;
    };
    const r = await trocarSenhaPeloApp(post, { codigo_empresa: ' am4821 ', email: 'v@x.com', senha_atual: 'Temp#1234', senha_nova: 'Boa#Senha1' }, 'campo', { id: '5d000000-0000-4000-8000-000000000001', nome: 'Pixel' });
    expect(r.usuario.perfil).toBe('vendedor');
    expect(chamadas[0]!.caminho).toBe('/auth/senha/trocar');
    expect(chamadas[0]!.corpo).toMatchObject({ codigo_empresa: 'AM4821', app: 'campo', senha_atual: 'Temp#1234', senha_nova: 'Boa#Senha1', dispositivo_nome: 'Pixel' });
    await expect(trocarSenhaPeloApp(async () => ({ lixo: true }), { codigo_empresa: 'AM4821', email: 'v@x.com', senha_atual: 'x', senha_nova: 'Boa#Senha1' }, 'gestao')).rejects.toBeTruthy();
  });

  it('RN-CORE-34: o login mostra o texto certo para a senha vencida e, como rede de segurança, para a troca pendente', () => {
    expect(mensagemDeErroDeLogin(erroApi('SENHA_TEMPORARIA_VENCIDA'))).toBe('Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa.');
    expect(mensagemDeErroDeLogin(erroApi('SENHA_A_TROCAR'))).toBe('Você precisa criar uma senha nova. Atualize o app para continuar.');
  });
});

describe('RN-CORE-34: Esqueci a senha no app', () => {
  it('RN-CORE-34: valida campo vazio e e-mail sem formato', () => {
    expect(validarEsqueci({ codigo_empresa: '', email: '' })).toEqual({ codigo_empresa: 'Informe o código da empresa e o e-mail.', email: 'Informe o código da empresa e o e-mail.' });
    expect(validarEsqueci({ codigo_empresa: 'AM4821', email: 'sem-arroba' })).toEqual({ email: 'Informe um e-mail válido, como nome@empresa.com.br.' });
    expect(validarEsqueci({ codigo_empresa: 'AM4821', email: 'a@b.com' })).toEqual({});
  });

  it('RN-CORE-34: 429 diz em quantos minutos (mínimo 1); sem internet e erro geral têm frase própria', () => {
    expect(textoDeEspera(30)).toBe('em 1 minuto');
    expect(textoDeEspera(61)).toBe('em 2 minutos');
    expect(erroDoEsqueci(erroApi('MUITAS_TENTATIVAS', { retry_after_s: 600 }))).toBe('Muitos pedidos seguidos. Tente de novo em 10 minutos.');
    expect(erroDoEsqueci(new ErroSemConexao())).toBe('Conecte-se à internet para pedir uma senha temporária.');
    expect(erroDoEsqueci(erroApi('X'))).toBe('Não foi possível pedir agora. Tente de novo em alguns minutos.');
  });

  it('RN-CORE-34: o pedido vai ao endpoint público só com código e e-mail', async () => {
    const chamadas: Array<{ caminho: string; corpo: unknown }> = [];
    await pedirSenhaTemporaria(async (caminho, corpo) => void chamadas.push({ caminho, corpo }), { codigo_empresa: ' am4821 ', email: ' v@x.com ' });
    expect(chamadas).toEqual([{ caminho: '/auth/senha/esqueci', corpo: { codigo_empresa: 'AM4821', email: 'v@x.com' } }]);
  });
});

describe('T-0178: Trocar senha no Perfil', () => {
  it('RN-CORE-34: senha atual errada (401) → Banner vermelho e limpa só a atual', () => {
    expect(erroDaTrocaVoluntaria(erroApi('CREDENCIAIS_INVALIDAS'))).toEqual({ texto: 'A senha atual está errada. Digite de novo.', tom: 'danger', efeito: 'limpar_atual' });
  });
  it('RN-CORE-34: senha nova igual à atual (422) → texto único e limpa as duas novas', () => {
    expect(erroDaTrocaVoluntaria(erroApi('RN-CORE-34', undefined, 'A senha nova precisa ser diferente da atual.'))).toEqual({ texto: 'A senha nova precisa ser diferente da atual.', tom: 'danger', efeito: 'limpar_novas' });
  });
  it('RN-CORE-32: 422 com faltas fica sem Banner (a lista mostra); igual ao e-mail ganha Banner', () => {
    expect(erroDaTrocaVoluntaria(erroApi('RN-CORE-32', { faltas: ['caracteres'] }), 'abc')).toEqual({ texto: null, tom: 'danger', efeito: 'destacar' });
    expect(erroDaTrocaVoluntaria(erroApi('RN-CORE-32', { faltas: [] }))).toEqual({ texto: 'A senha não pode ser igual ao e-mail.', tom: 'danger', efeito: 'destacar' });
  });
  it('RN-CORE-34: sem internet → aviso amarelo; 423/429 usam o texto do login; o resto, a frase de tentar de novo', () => {
    expect(erroDaTrocaVoluntaria(new ErroSemConexao('x'))).toMatchObject({ texto: 'Conecte-se à internet para trocar a senha.', tom: 'warning', efeito: 'nenhum' });
    expect(erroDaTrocaVoluntaria(erroApi('USUARIO_BLOQUEADO')).texto).toBe(mensagemDeErroDeLogin(erroApi('USUARIO_BLOQUEADO')));
    expect(erroDaTrocaVoluntaria(erroApi('MUITAS_TENTATIVAS')).texto).toBe(mensagemDeErroDeLogin(erroApi('MUITAS_TENTATIVAS')));
    expect(erroDaTrocaVoluntaria(erroApi('X'))).toMatchObject({ texto: 'Não foi possível trocar agora. Tente de novo em alguns minutos.', tom: 'danger' });
  });
  it('RN-CORE-34: chama POST /auth/senha/trocar com código e e-mail da sessão e devolve a sessão nova', async () => {
    let chamada: { caminho: string; corpo: Record<string, unknown> } | null = null;
    const post = async (caminho: string, corpo: unknown) => {
      chamada = { caminho, corpo: corpo as Record<string, unknown> };
      return sessao;
    };
    const r = await trocarSenhaDoPerfil(post, { codigo_empresa: 'AM4821', email: 'v@x.com', senha_atual: 'Atual#123', senha_nova: 'Nova#Senha1' }, 'campo', { id: '0d000000-0000-4000-8000-000000000001' });
    expect(chamada).toMatchObject({ caminho: '/auth/senha/trocar', corpo: { codigo_empresa: 'AM4821', email: 'v@x.com', senha_atual: 'Atual#123', senha_nova: 'Nova#Senha1', app: 'campo', dispositivo_id: '0d000000-0000-4000-8000-000000000001' } });
    expect(r.usuario.email).toBe('v@x.com');
  });
});
