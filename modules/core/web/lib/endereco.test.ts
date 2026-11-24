import { describe, expect, it } from 'vitest';
import { cepTemOitoDigitos } from '../../contracts';
import { aplicarCep, CENTRO_PADRAO, centroDosClientes, corpoDaCasa, corpoDoEndereco, ENDERECO_VAZIO, enderecoEmBranco, errosDoEndereco, formDoEndereco } from './endereco';

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

describe('RN-CORE-75: Pesquisar CEP preenche o endereço e mantém CEP, número e ponto', () => {
  const achado = { logradouro: 'Av. Djalma Batista', bairro: 'Flores', cidade: 'Manaus', uf: 'AM' };
  it('preenche rua, bairro, cidade e UF; mantém CEP, número e o ponto', () => {
    const f = aplicarCep({ ...ENDERECO_VAZIO, cep: '69053-000', numero: '12', lat: -3.1, lng: -60 }, achado);
    expect(f).toMatchObject({ cep: '69053-000', numero: '12', logradouro: 'Av. Djalma Batista', bairro: 'Flores', cidade: 'Manaus', uf: 'AM', lat: -3.1, lng: -60 });
  });
  it('CEP de outra cidade troca rua e bairro (vazios onde a API não trouxe) e mantém número e ponto', () => {
    const f = aplicarCep({ ...ENDERECO_VAZIO, logradouro: 'Rua A', bairro: 'Centro', numero: '5', lat: -3.1, lng: -60 }, { logradouro: '', bairro: '', cidade: 'Parintins', uf: 'AM' });
    expect(f).toMatchObject({ logradouro: '', bairro: '', cidade: 'Parintins', uf: 'AM', numero: '5', lat: -3.1, lng: -60 });
  });
  it('RN-CORE-75: 00000000 vai à pesquisa (formato com 8 dígitos), mas não passa no Salvar (cepValido)', () => {
    expect(cepTemOitoDigitos('00000-000')).toBe(true);
    expect(errosDoEndereco({ ...completo, cep: '00000000' }, { exigePonto: false }).cep).toBe('CEP inválido.');
    expect(errosDoEndereco({ ...completo, cep: '00000-000' }, { exigePonto: true }).cep).toBe('CEP inválido.');
    expect(errosDoEndereco({ ...completo, cep: '6905' }, { exigePonto: false }).cep).toBe('CEP com 8 dígitos.');
  });
});

describe('RN-CORE-75 (R-20261124-191902-alexandre, item 08): a casa salva sem ponto; a API decide se o ponto gravado fica', () => {
  it('o corpo da casa não leva o ponto da tela; o da base Outro endereço leva', () => {
    expect(corpoDaCasa(completo)).toMatchObject({ cep: '69053000', uf: 'AM', lat: null, lng: null });
    expect(corpoDoEndereco(completo)).toMatchObject({ lat: -3.1, lng: -60 });
  });
});
