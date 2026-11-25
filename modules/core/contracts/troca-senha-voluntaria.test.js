import { ErroSemConexao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { AVISO_APARELHO_LIMPO } from './dispositivo';
import { TEXTOS_CRIE_SENHA, TEXTOS_TROCAR_SENHA } from './ciclo-senha';
import { erroDaTrocaVoluntaria, mensagemDeErroDeLogin, precheckDaTrocaVoluntaria } from './troca-senha-voluntaria';
const erroApi = (codigo, detalhes) => Object.assign(new Error('x'), { codigo, detalhes });
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
    it('RF-CORE-01: DISPOSITIVO_BLOQUEADO usa o aviso do aparelho limpo e fica', () => {
        expect(erroDaTrocaVoluntaria(erroApi('DISPOSITIVO_BLOQUEADO'))).toEqual({ texto: AVISO_APARELHO_LIMPO, tom: 'danger', acao: 'ficar' });
    });
    it('RF-CORE-01: bloqueio e muitas tentativas usam o texto do login', () => {
        expect(erroDaTrocaVoluntaria(erroApi('MUITAS_TENTATIVAS')).texto).toBe(mensagemDeErroDeLogin(erroApi('MUITAS_TENTATIVAS')));
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
