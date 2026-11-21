import { describe, expect, it } from 'vitest';
import { arredondarCoordenada, checkinPodeSubstituirCoordenada, decidirGeracaoDeCoordenada, enderecoPermiteGerar, MENSAGEM_NAO_LOCALIZADO_CADASTRO, MENSAGENS_RECUSA_GERACAO } from './geocodificacao-cliente';

describe('RN-CORE-77: gerar coordenada do cliente', () => {
  it('RN-CORE-77: cliente com coordenada, de qualquer origem, nunca é sobrescrito', () => {
    expect(decidirGeracaoDeCoordenada({ latitude: -3.1, longitude: -60, chaveAtual: 'a', chaveTentada: null })).toEqual({ ok: false, codigo: 'JA_TEM_COORDENADA' });
  });

  it('RN-CORE-77: o endereço que falhou não é tentado de novo enquanto a chave (endereço e CEP) não mudar', () => {
    expect(decidirGeracaoDeCoordenada({ latitude: null, longitude: null, chaveAtual: 'a', chaveTentada: 'a' })).toEqual({ ok: false, codigo: 'JA_TENTADO' });
    expect(decidirGeracaoDeCoordenada({ latitude: null, longitude: null, chaveAtual: 'b', chaveTentada: 'a' })).toEqual({ ok: true });
    expect(decidirGeracaoDeCoordenada({ latitude: null, longitude: null, chaveAtual: 'a', chaveTentada: null })).toEqual({ ok: true });
  });

  it('RN-CORE-77: o check-in aprovado substitui só a coordenada gerada pelo endereço', () => {
    expect(checkinPodeSubstituirCoordenada({ latitude: null, longitude: null, coordenada_origem: null })).toBe(true);
    expect(checkinPodeSubstituirCoordenada({ latitude: -3, longitude: -60, coordenada_origem: 'geocodificacao' })).toBe(true);
    for (const o of ['erp', 'checkin', 'manual'] as const) expect(checkinPodeSubstituirCoordenada({ latitude: -3, longitude: -60, coordenada_origem: o })).toBe(false);
    expect(checkinPodeSubstituirCoordenada({ latitude: -3, longitude: -60, coordenada_origem: null })).toBe(false);
  });

  it('RN-CORE-77: a coordenada do serviço (7 casas) é gravada com 6', () => {
    expect(arredondarCoordenada(-3.1234567)).toBe(-3.123457);
    expect(arredondarCoordenada(-60.5)).toBe(-60.5);
  });

  it('RN-CORE-77: cliente só com a cidade, sem logradouro e sem CEP, não oferece gerar a coordenada', () => {
    expect(enderecoPermiteGerar({ logradouro: null, cep: null })).toBe(false);
    expect(enderecoPermiteGerar({ logradouro: '  ', cep: '123' })).toBe(false);
    expect(enderecoPermiteGerar({ logradouro: 'Rua A', cep: null })).toBe(true);
    expect(enderecoPermiteGerar({ logradouro: null, cep: '69000-000' })).toBe(true);
  });

  it('RN-CORE-77: CEP incompleto não vale como endereço (a API e a tela usam a mesma regra) e o texto de não localizado é um só', () => {
    expect(enderecoPermiteGerar({ logradouro: null, cep: '6900' })).toBe(false);
    expect(enderecoPermiteGerar({ logradouro: '', cep: '69000-000' })).toBe(true);
    expect(MENSAGENS_RECUSA_GERACAO.JA_TENTADO).toBe(MENSAGEM_NAO_LOCALIZADO_CADASTRO);
    expect(MENSAGENS_RECUSA_GERACAO.NAO_LOCALIZADO).toBe(MENSAGEM_NAO_LOCALIZADO_CADASTRO);
  });
});
