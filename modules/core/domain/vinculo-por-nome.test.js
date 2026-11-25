import { describe, expect, it } from 'vitest';
import { decidirVinculoPorNome, normalizarNomeParaVinculo } from './vinculo-por-nome';
const cand = (o = {}) => ({ id: 'u1', nome: 'Maria da Silva', perfil: 'vendedor', ativo: true, external_id: null, email: 'maria@exemplo.com.br', ...o });
describe('RN-CORE-58: vínculo automático por nome (normalização)', () => {
    it('RN-CORE-58: ignora caixa, acentos, espaços repetidos e pontuação', () => {
        expect(normalizarNomeParaVinculo('  MARÍA   da  Silva. ')).toBe('maria da silva');
        expect(normalizarNomeParaVinculo("Ana-Maria D'Ávila_Neto")).toBe('ana maria d avila neto');
        expect(normalizarNomeParaVinculo('Maria, da Silva')).toBe(normalizarNomeParaVinculo('maria da silva'));
    });
    it('RN-CORE-58: nome de uma palavra só não vale para vínculo automático', () => {
        expect(normalizarNomeParaVinculo('Maria')).toBeNull();
        expect(normalizarNomeParaVinculo('  ')).toBeNull();
    });
});
describe('RN-CORE-58: vínculo automático por nome (decisão)', () => {
    it('RN-CORE-58: um único usuário elegível com o mesmo nome completo é vinculado', () => {
        expect(decidirVinculoPorNome('MARIA DA SILVA', [cand({ nome: 'María da Silva' })])).toEqual({ acao: 'vincular', usuario_id: 'u1' });
        expect(decidirVinculoPorNome('Maria da Silva', [cand({ perfil: 'promotor' })])).toEqual({ acao: 'vincular', usuario_id: 'u1' });
    });
    it('RN-CORE-58: sem nome igual, segue o ramo normal (provisório), sem aviso', () => {
        expect(decidirVinculoPorNome('Maria da Silva', [cand({ nome: 'Maria Souza' })])).toEqual({ acao: 'seguir' });
        expect(decidirVinculoPorNome('Maria', [cand({ nome: 'Maria' })])).toEqual({ acao: 'seguir' });
    });
    it('RN-CORE-58: homônimos (dois ou mais usuários com o mesmo nome) não vinculam e avisam', () => {
        expect(decidirVinculoPorNome('Maria da Silva', [cand(), cand({ id: 'u2', nome: 'maria da silva' })])).toEqual({ acao: 'avisar', motivo: 'homonimo', candidatos: 2 });
    });
    it('RN-CORE-58: usuário que já tem outro código ERP não vincula e avisa', () => {
        expect(decidirVinculoPorNome('Maria da Silva', [cand({ external_id: 'VEN-1' })])).toEqual({ acao: 'avisar', motivo: 'outro_codigo', candidatos: 1 });
    });
    it('RN-CORE-58: usuário inativo não vincula e avisa', () => {
        expect(decidirVinculoPorNome('Maria da Silva', [cand({ ativo: false })])).toEqual({ acao: 'avisar', motivo: 'inativo', candidatos: 1 });
    });
    it('RN-CORE-58: perfil incompatível (só vendedor e promotor) segue o ramo normal; o provisório nunca é candidato', () => {
        expect(decidirVinculoPorNome('Maria da Silva', [cand({ perfil: 'gerente' })])).toEqual({ acao: 'seguir' });
        expect(decidirVinculoPorNome('Maria da Silva', [cand({ email: 'erp-1@sem-email.invalid' })])).toEqual({ acao: 'seguir' });
    });
    it('RN-CORE-58: homônimo só conta quem tem perfil compatível', () => {
        expect(decidirVinculoPorNome('Maria da Silva', [cand(), cand({ id: 'u2', perfil: 'admin' })])).toEqual({ acao: 'vincular', usuario_id: 'u1' });
    });
});
