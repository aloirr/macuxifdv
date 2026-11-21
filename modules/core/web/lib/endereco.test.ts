import { describe, expect, it } from 'vitest';
import { CENTRO_PADRAO, centroDosClientes, corpoDoEndereco, ENDERECO_VAZIO, enderecoEmBranco, errosDoEndereco, formDoEndereco } from './endereco';

const completo = { cep: '69053-000', logradouro: ' Rua das Palmeiras ', numero: '100', bairro: 'Centro', cidade: 'Manaus', uf: 'am', lat: -3.1, lng: -60 };

describe('RN-CORE-75: formulário do endereço com ponto no mapa', () => {
  it('endereço completo com ponto não tem erro; o corpo vai com o CEP só em dígitos e a UF maiúscula', () => {
    expect(errosDoEndereco(completo, { exigePonto: true })).toEqual({});
    expect(corpoDoEndereco(completo)).toEqual({ cep: '69053000', logradouro: 'Rua das Palmeiras', numero: '100', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: -3.1, lng: -60 });
  });

  it('CEP com 8 dígitos, UF com 2 letras e o resto preenchido; o ponto só é exigido no Outro endereço', () => {
    const e = errosDoEndereco({ ...ENDERECO_VAZIO, cep: '123', uf: 'X' }, { exigePonto: true });
    expect(Object.keys(e).sort()).toEqual(['bairro', 'cep', 'cidade', 'logradouro', 'numero', 'ponto', 'uf']);
    expect(errosDoEndereco({ ...completo, lat: null, lng: null }, { exigePonto: false })).toEqual({});
    expect(errosDoEndereco({ ...completo, lat: null, lng: null }, { exigePonto: true })).toEqual({ ponto: 'Marque o ponto no mapa.' });
  });

  it('endereço em branco (casa apagada) é reconhecido; o ponto sozinho já conta como preenchido', () => {
    expect(enderecoEmBranco(ENDERECO_VAZIO)).toBe(true);
    expect(enderecoEmBranco({ ...ENDERECO_VAZIO, lat: -3, lng: -60 })).toBe(false);
    expect(formDoEndereco(null)).toEqual(ENDERECO_VAZIO);
    expect(formDoEndereco({ ...corpoDoEndereco(completo) }).cep).toBe('69053-000');
  });

  it('o mapa abre no centro dos clientes com localização; sem nenhum, em Manaus', () => {
    expect(centroDosClientes([{ lat: -3, lng: -60 }, { lat: -4, lng: -62 }, { lat: null, lng: null }])).toEqual([-3.5, -61]);
    expect(centroDosClientes([])).toEqual(CENTRO_PADRAO);
  });
});
