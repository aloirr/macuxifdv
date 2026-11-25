import { describe, expect, it } from 'vitest';
import { baseResolvida, pontoDaCasaAposSalvar, casaDoUsuario, linhaDoEndereco, perfilTemEndereco, resumoDaBase } from './base-vendedor';
const casa = { cep: '69053000', logradouro: 'Rua das Palmeiras', numero: '100', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: -3.1, lng: -60.0 };
const outro = { cep: '69010000', logradouro: 'Av. Eduardo Ribeiro', numero: '5', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: -3.13, lng: -60.02 };
const nada = { cep: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, lat: null, lng: null };
describe('RN-CORE-75: base do vendedor', () => {
    it('RN-CORE-75: com base Casa, a base é o endereço e o ponto da casa', () => {
        expect(baseResolvida({ base_tipo: 'casa', casa, base: nada })).toMatchObject({ tipo: 'casa', logradouro: 'Rua das Palmeiras', lat: -3.1, lng: -60.0 });
    });
    it('RN-CORE-75: com Outro endereço, a base é a marcada e a casa não conta', () => {
        expect(baseResolvida({ base_tipo: 'outro', casa, base: outro })).toMatchObject({ tipo: 'outro', logradouro: 'Av. Eduardo Ribeiro', lat: -3.13 });
    });
    it('RN-CORE-75: sem base, ou com Casa sem o ponto marcado, não há base (nem marcador, nem saída fixa)', () => {
        expect(baseResolvida({ base_tipo: null, casa, base: nada })).toBeNull();
        expect(baseResolvida({ base_tipo: 'casa', casa: { ...casa, lat: null, lng: null }, base: nada })).toBeNull();
        expect(baseResolvida({ base_tipo: 'outro', casa, base: { ...outro, lat: null, lng: null } })).toBeNull();
    });
    it('RN-CORE-75: a casa só existe quando algum campo foi preenchido', () => {
        expect(casaDoUsuario(nada)).toBeNull();
        expect(casaDoUsuario(casa)).toMatchObject({ cep: '69053000', cidade: 'Manaus' });
    });
    it('RN-CORE-75: o cartão mostra rua, número e bairro em uma linha; só vendedor e promotor têm endereço', () => {
        expect(resumoDaBase({ logradouro: "Rua das Palmeiras", numero: "100", bairro: "Centro" })).toBe('Rua das Palmeiras, 100 · Centro');
        expect(perfilTemEndereco('vendedor')).toBe(true);
        expect(perfilTemEndereco('promotor')).toBe(true);
        expect(perfilTemEndereco('gerente')).toBe(false);
    });
});
describe('RN-CORE-75: o endereço numa linha', () => {
    it('RN-CORE-75: rua, número, bairro e cidade/UF separados por ponto médio, sem sobras quando falta parte', () => {
        expect(linhaDoEndereco({ logradouro: 'Rua das Palmeiras', numero: '100', bairro: 'Parque 10', cidade: 'Manaus', uf: 'AM' })).toBe('Rua das Palmeiras, 100 · Parque 10 · Manaus/AM');
        expect(linhaDoEndereco({ logradouro: '', numero: '', bairro: '', cidade: 'Manaus', uf: '' })).toBe('Manaus');
    });
});
describe('RN-CORE-75 (R-20261124-191902-alexandre, item 08): mudar o endereço da casa apaga o ponto', () => {
    const gravada = { cep: '69053000', logradouro: 'Av. Djalma Batista', numero: '12', bairro: 'Flores', cidade: 'Manaus', uf: 'AM', lat: -3.1, lng: -60 };
    const nova = { cep: '69053000', logradouro: 'Av. Djalma Batista', numero: '12', bairro: 'Flores', cidade: 'Manaus', uf: 'AM' };
    it('RN-CORE-75: endereço igual mantém o ponto gravado (o que a tela manda não conta)', () => {
        expect(pontoDaCasaAposSalvar(gravada, nova)).toEqual({ lat: -3.1, lng: -60 });
    });
    it.each(['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf'])('RN-CORE-75: mudou %s, o ponto é apagado', (campo) => {
        expect(pontoDaCasaAposSalvar(gravada, { ...nova, [campo]: 'X' })).toEqual({ lat: null, lng: null });
    });
    it('RN-CORE-75: sem casa gravada, o ponto fica nulo', () => {
        expect(pontoDaCasaAposSalvar(null, nova)).toEqual({ lat: null, lng: null });
    });
});
