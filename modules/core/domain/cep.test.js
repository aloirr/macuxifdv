import { describe, expect, it } from 'vitest';
import { cepDaBrasilApi, cepDoViaCep } from './cep';
describe('RF-CORE-02 (endereço do usuário): normalização da resposta de CEP', () => {
    it('RN-CORE-75: BrasilAPI vira logradouro, bairro, cidade e UF (sem espaços nas pontas, UF em maiúsculas)', () => {
        expect(cepDaBrasilApi({
            cep: '69053000',
            state: 'am',
            city: ' Manaus ',
            neighborhood: 'Flores',
            street: 'Av. Djalma Batista',
        })).toEqual({ logradouro: 'Av. Djalma Batista', bairro: 'Flores', cidade: 'Manaus', uf: 'AM' });
    });
    it('RN-CORE-75: ViaCEP vira os mesmos campos; `erro: true` e corpo estranho dão null', () => {
        expect(cepDoViaCep({
            cep: '69053-000',
            logradouro: 'Av. Djalma Batista',
            bairro: 'Flores',
            localidade: 'Manaus',
            uf: 'AM',
        })).toEqual({ logradouro: 'Av. Djalma Batista', bairro: 'Flores', cidade: 'Manaus', uf: 'AM' });
        expect(cepDoViaCep({ erro: true })).toBeNull();
        expect(cepDoViaCep('x')).toBeNull();
        expect(cepDaBrasilApi(null)).toBeNull();
    });
    it('RN-CORE-75: CEP geral de cidade (sem rua nem bairro) ainda devolve cidade e UF, com rua e bairro vazios', () => {
        expect(cepDaBrasilApi({ city: 'Coari', state: 'AM', neighborhood: null, street: null })).toEqual({
            logradouro: '',
            bairro: '',
            cidade: 'Coari',
            uf: 'AM',
        });
    });
    it('RN-CORE-75: sem cidade ou sem UF válida a resposta não serve (null)', () => {
        expect(cepDaBrasilApi({ city: '', state: 'AM' })).toBeNull();
        expect(cepDoViaCep({ localidade: 'Manaus', uf: 'AMA' })).toBeNull();
    });
});
