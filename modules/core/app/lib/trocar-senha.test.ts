import { ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { TEXTOS_CRIE_SENHA, TEXTOS_TROCAR_SENHA } from '../../contracts';
import { erroDaTrocaVoluntaria, precheckDaTrocaVoluntaria, trocarMinhaSenha } from './trocar-senha';

const erroApi = (codigo: string, detalhes?: Record<string, unknown>) =>
  Object.assign(new Error('x'), { codigo, detalhes });
const sessao = {
  access_token: 'a',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'r'.repeat(20),
  usuario: {
    id: '0b000000-0000-4000-8000-000000000001',
    nome: 'Vera',
    nome_curto: null,
    email: 'v@x.com',
    perfil: 'vendedor',
  },
  tenant: {
    id: '0a000000-0000-4000-8000-0000000000aa',
    codigo: 'AM4821',
    nome: 'Alfa',
    fuso: 'America/Manaus',
  },
};

describe('RF-CORE-01 / RN-CORE-32 / RN-CORE-34: precheck da troca voluntária (antes de chamar a API)', () => {
  it('RN-CORE-32: senha nova fraca não envia e o foco vai para a senha nova', () => {
    expect(precheckDaTrocaVoluntaria('Atual#123', 'abc', 'abc')).toMatchObject({
      ok: false,
      foco: 'nova',
    });
  });
  it('RN-CORE-32: senhas diferentes não enviam; o foco vai para "Repita a senha"', () => {
    expect(precheckDaTrocaVoluntaria('Atual#123', 'Boa#Senha1', 'Boa#Senha2')).toMatchObject({
      ok: false,
      foco: 'repita',
    });
  });
  it('RF-CORE-01: senha atual vazia não envia; o foco vai para "Senha atual"', () => {
    expect(precheckDaTrocaVoluntaria('', 'Boa#Senha1', 'Boa#Senha1')).toMatchObject({
      ok: false,
      atualVazia: true,
      foco: 'atual',
    });
  });
  it('RN-CORE-32: tudo certo envia', () => {
    expect(precheckDaTrocaVoluntaria('Atual#123', 'Boa#Senha1', 'Boa#Senha1')).toMatchObject({ ok: true });
  });
});

describe('RN-CORE-32 / RN-CORE-34: respostas da API na troca voluntária (spec §5)', () => {
  it('RF-CORE-01: 401 CREDENCIAIS_INVALIDAS = senha atual errada, limpa a atual', () => {
    expect(erroDaTrocaVoluntaria(erroApi('CREDENCIAIS_INVALIDAS'))).toEqual({
      texto: TEXTOS_TROCAR_SENHA.atualErrada,
      tom: 'danger',
      acao: 'limpar_atual',
    });
  });
  it('RN-CORE-34: 422 RN-CORE-34 = "diferente da atual", limpa as novas', () => {
    expect(erroDaTrocaVoluntaria(erroApi('RN-CORE-34'))).toEqual({
      texto: TEXTOS_TROCAR_SENHA.igualAAtual,
      tom: 'danger',
      acao: 'limpar_novas',
    });
  });
  it('RN-CORE-32: 422 com faltas não tem aviso (a lista mostra); sem faltas é "igual ao e-mail"', () => {
    expect(erroDaTrocaVoluntaria(erroApi('RN-CORE-32', { faltas: ['numero'] }))).toEqual({
      texto: null,
      tom: 'danger',
      acao: 'destacar',
    });
    expect(erroDaTrocaVoluntaria(erroApi('RN-CORE-32', { faltas: [] }))).toEqual({
      texto: TEXTOS_CRIE_SENHA.igualAoEmail,
      tom: 'danger',
      acao: 'destacar',
    });
  });
  it('RF-CORE-01: sem internet = aviso warning e fica', () => {
    expect(erroDaTrocaVoluntaria(new ErroSemConexao())).toEqual({
      texto: TEXTOS_TROCAR_SENHA.semInternet,
      tom: 'warning',
      acao: 'ficar',
    });
  });
  it('RF-CORE-01: bloqueio e muitas tentativas usam o texto do login', () => {
    expect(erroDaTrocaVoluntaria(erroApi('MUITAS_TENTATIVAS')).texto).toBe('Muitas tentativas. Tente de novo em 5 minutos.');
    expect(erroDaTrocaVoluntaria(erroApi('USUARIO_BLOQUEADO'))).toMatchObject({
      tom: 'danger',
      acao: 'ficar',
    });
  });
  it('RF-CORE-01: 5xx e outros viram o texto genérico com a ação', () => {
    expect(erroDaTrocaVoluntaria(Object.assign(new Error('x'), { status: 500 }))).toEqual({
      texto: TEXTOS_TROCAR_SENHA.outro,
      tom: 'danger',
      acao: 'ficar',
    });
  });
});

describe('RN-CORE-34: trocarMinhaSenha monta o corpo e devolve a sessão nova', () => {
  it('RN-CORE-34: envia codigo, e-mail, atual, nova, app e aparelho; nada de confirmação; devolve a sessão', async () => {
    let enviado: { caminho: string; corpo: Record<string, unknown> } | null = null;
    const r = await trocarMinhaSenha(
      async (caminho, corpo) => {
        enviado = { caminho, corpo: corpo as Record<string, unknown> };
        return sessao;
      },
      { codigoEmpresa: ' am4821 ', email: ' v@x.com ' },
      { senha_atual: 'Atual#123', senha_nova: 'Boa#Senha1' },
      'campo',
      { id: '0c000000-0000-4000-8000-000000000001' },
    );
    expect(r.usuario.email).toBe('v@x.com');
    expect(enviado!.caminho).toBe('/auth/senha/trocar');
    expect(enviado!.corpo).toMatchObject({
      codigo_empresa: 'AM4821',
      email: 'v@x.com',
      senha_atual: 'Atual#123',
      senha_nova: 'Boa#Senha1',
      app: 'campo',
      dispositivo_id: '0c000000-0000-4000-8000-000000000001',
    });
    expect(Object.keys(enviado!.corpo)).not.toContain('repita');
  });
});
