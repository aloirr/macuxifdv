import { describe, expect, it } from 'vitest';
import { REGRA_DA_SENHA, SENHA_MAX_CARACTERES, SENHA_MIN_CARACTERES, faltasNaSenha, mensagemDaSenha, senhaServe } from './senha';

describe('RN-CORE-32: senha com 8+ caracteres, letra, número e caractere especial', () => {
  it('RN-CORE-32: senha completa não tem falta', () => {
    expect(faltasNaSenha('Abcdef1!')).toEqual([]);
    expect(senhaServe('Abcdef1!')).toBe(true);
  });
  it('RN-CORE-32: aponta cada falta isolada', () => {
    expect(faltasNaSenha('abcdefg!')).toEqual(['numero']);
    expect(faltasNaSenha('1234567!')).toEqual(['letra']);
    expect(faltasNaSenha('abcdefg1')).toEqual(['especial']);
    expect(faltasNaSenha('Ab1!')).toEqual(['caracteres']);
  });
  it('RN-CORE-32: combinações de faltas vêm na ordem caracteres, letra, número, especial', () => {
    expect(faltasNaSenha('abcdefgh')).toEqual(['numero', 'especial']);
    expect(faltasNaSenha('12345678')).toEqual(['letra', 'especial']);
    expect(faltasNaSenha('!!!!!!!!')).toEqual(['letra', 'numero']);
    expect(faltasNaSenha('a')).toEqual(['caracteres', 'numero', 'especial']);
    expect(faltasNaSenha('')).toEqual(['caracteres', 'letra', 'numero', 'especial']);
  });
  it('RN-CORE-32: letra acentuada vale como letra', () => {
    expect(faltasNaSenha('ção1234!')).toEqual([]);
    expect(faltasNaSenha('ÇÃO1234!')).toEqual([]);
  });
  it('RN-CORE-32: espaço é permitido mas não conta como especial', () => {
    expect(faltasNaSenha('abc 1234')).toEqual(['especial']);
    expect(faltasNaSenha('abc 123!')).toEqual([]);
  });
  it('RN-CORE-32: não há trim (espaços do meio contam no tamanho; nas pontas invalidam)', () => {
    expect(faltasNaSenha('a  1!   b')).toEqual([]);
    expect(faltasNaSenha('  a1!   ')).toEqual(['espaco']);
  });
  it('RN-CORE-32: emoji conta como um caractere (ponto de código) e como especial', () => {
    expect(faltasNaSenha('abc123😀')).toEqual(['caracteres']);
    expect(faltasNaSenha('abcd123😀')).toEqual([]);
    expect(faltasNaSenha('a1😀😀😀😀😀😀')).toEqual([]);
  });
  it('RN-CORE-32: limites de 8 e de 200 caracteres', () => {
    expect(SENHA_MIN_CARACTERES).toBe(8);
    expect(SENHA_MAX_CARACTERES).toBe(200);
    expect(faltasNaSenha('Abcde1!')).toEqual(['caracteres']); // 7
    expect(faltasNaSenha('Abcdef1!')).toEqual([]); // 8
    expect(faltasNaSenha(`${'a'.repeat(197)}1!A`)).toEqual([]); // 200
    expect(faltasNaSenha(`${'a'.repeat(198)}1!A`)).toEqual(['caracteres']); // 201
    expect(faltasNaSenha(`${'😀'.repeat(198)}a1`)).toEqual([]); // 200 pontos de código (400 unidades UTF-16)
  });
  it('RN-CORE-32: texto da ajuda do campo aprovado pelo designer-ux', () => {
    expect(REGRA_DA_SENHA).toBe('Pelo menos 8 caracteres, com letra, número e caractere especial.');
  });
  it('RN-CORE-32: a mensagem diz o que falta', () => {
    expect(mensagemDaSenha([])).toBeNull();
    expect(mensagemDaSenha(['numero'])).toBe('Falta um número.');
    expect(mensagemDaSenha(['letra'])).toBe('Falta uma letra.');
    expect(mensagemDaSenha(['especial'])).toBe('Falta um caractere especial.');
    expect(mensagemDaSenha(['numero', 'especial'])).toBe('Faltam um número e um caractere especial.');
    expect(mensagemDaSenha(['letra', 'numero', 'especial'])).toBe('Faltam uma letra, um número e um caractere especial.');
    expect(mensagemDaSenha(['caracteres'])).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(mensagemDaSenha(['caracteres', 'numero'])).toBe('A senha precisa ter pelo menos 8 caracteres. Falta um número.');
    expect(mensagemDaSenha(['caracteres'], 'a'.repeat(201))).toBe('A senha pode ter até 200 caracteres.');
  });
});

describe('RN-CORE-32: espaço no começo ou no fim invalida a senha (criação e troca)', () => {
  it('RN-CORE-32: espaço na ponta é uma falta e a mensagem é a constante única', () => {
    expect(faltasNaSenha(' Abcdef1!')).toEqual(['espaco']);
    expect(faltasNaSenha('Abcdef1! ')).toEqual(['espaco']);
    expect(senhaServe(' Abcdef1!')).toBe(false);
    expect(mensagemDaSenha(['espaco'])).toBe('A senha não pode começar nem terminar com espaço.');
    expect(mensagemDaSenha(faltasNaSenha(' ab'))).toBe('A senha não pode começar nem terminar com espaço.');
  });
  it('RN-CORE-32: espaço no meio continua valendo', () => {
    expect(faltasNaSenha('Abc def1!')).toEqual([]);
  });
});
