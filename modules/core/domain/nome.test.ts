import { describe, expect, it } from 'vitest';
import { primeiroNome, saudacaoComNome } from './nome';

describe('saudação com o nome (Campo e BKO)', () => {
  it('saudação com o primeiro nome e ponto final; sem nome, a saudação com ponto final', () => {
    expect(saudacaoComNome('Boa tarde', 'Lucas Andrade')).toBe('Boa tarde, Lucas.');
    expect(saudacaoComNome('Boa tarde', '')).toBe('Boa tarde.');
  });

  it('R-20261114-145000: o primeiro nome vem inteiro, com a primeira letra maiúscula e o resto minúsculo', () => {
    expect(primeiroNome('MARIA EDUARDA')).toBe('Maria');
    expect(primeiroNome('  lucas  andrade ')).toBe('Lucas');
    expect(primeiroNome('ÉRICA')).toBe('Érica');
    expect(primeiroNome('joão')).toBe('João');
    expect(primeiroNome('ANA-CLARA SOUZA')).toBe('Ana-Clara');
    expect(primeiroNome('')).toBe('');
    expect(saudacaoComNome('Boa tarde', 'MARIA EDUARDA SILVA')).toBe('Boa tarde, Maria.');
    expect(saudacaoComNome('Boa tarde', 'MAXIMILIANO')).toBe('Boa tarde, Maximiliano.');
  });
});
