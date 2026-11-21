import { describe, expect, it } from 'vitest';
import { ErroHttpModulo } from './api';
import { CODIGO_GEOCODIFICADOR_INDISPONIVEL, GEOCODIFICADOR_DESLIGADO, chaveGeocodificacao, numeroDaPorta, type EnderecoGeocodificacao } from './geocodificador';

const END: EnderecoGeocodificacao = {
  logradouro: 'Rua São João',
  numero: '120',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69005-010',
};

describe('chaveGeocodificacao (RN-CORE-77: só tenta de novo quando o endereço ou o CEP muda)', () => {
  it('é SHA-256 em 64 hex minúsculos', () => {
    expect(chaveGeocodificacao(END)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o mesmo endereço escrito de outro jeito dá a mesma chave (acento, caixa, pontuação, espaço, CEP formatado)', () => {
    const outro = { ...END, logradouro: '  RUA  SAO JOAO. ', bairro: 'centro', cidade: 'MANAUS', uf: 'am', cep: '69005010' };
    expect(chaveGeocodificacao(outro)).toBe(chaveGeocodificacao(END));
  });

  it('muda quando o CEP, o número, o logradouro ou a cidade mudam', () => {
    const base = chaveGeocodificacao(END);
    expect(chaveGeocodificacao({ ...END, cep: '69005-020' })).not.toBe(base);
    expect(chaveGeocodificacao({ ...END, numero: '121' })).not.toBe(base);
    expect(chaveGeocodificacao({ ...END, logradouro: 'Rua São José' })).not.toBe(base);
    expect(chaveGeocodificacao({ ...END, cidade: 'Iranduba' })).not.toBe(base);
  });

  it('"S/N", "SN", "0" e vazio são o mesmo "sem número"', () => {
    const sem = chaveGeocodificacao({ ...END, numero: null });
    for (const n of ['S/N', 's/n', 'SN', '0', '']) expect(chaveGeocodificacao({ ...END, numero: n })).toBe(sem);
    expect(numeroDaPorta('12-A')).toBe('12a');
  });
});

describe('GEOCODIFICADOR_DESLIGADO', () => {
  it('não está disponível e localizar dá 503 GEOCODIFICADOR_INDISPONIVEL sem o endereço na mensagem', async () => {
    expect(GEOCODIFICADOR_DESLIGADO.disponivel()).toBe(false);
    const erro = await GEOCODIFICADOR_DESLIGADO.localizar(END).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroHttpModulo);
    expect((erro as ErroHttpModulo).status).toBe(503);
    expect((erro as ErroHttpModulo).codigo).toBe(CODIGO_GEOCODIFICADOR_INDISPONIVEL);
    expect((erro as Error).message).not.toMatch(/Jo[aã]o|Manaus|69005/i);
  });
});
