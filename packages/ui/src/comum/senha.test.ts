import { describe, expect, it } from 'vitest';
import {
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  faltasEmOrdem,
  itemDaRepeticao,
  itensDasRegras,
  REGRAS_DA_SENHA,
  resumoComRepeticao,
  resumoDaSenha,
  SENHA_ATENDE_AS_REGRAS,
} from './senha';

const TODAS = ['caracteres', 'letra', 'numero', 'especial'] as const;

describe('RN-CORE-32: frase do que falta na senha (texto aprovado, igual ao mensagemDaSenha do Core)', () => {
  it('nada falta', () => {
    expect(resumoDaSenha([])).toBe(SENHA_ATENDE_AS_REGRAS);
    expect(SENHA_ATENDE_AS_REGRAS).toBe('A senha atende às regras.');
  });

  it('uma falta, sem o tamanho', () => {
    expect(resumoDaSenha(['numero'])).toBe('Falta um número.');
    expect(resumoDaSenha(['letra'])).toBe('Falta uma letra.');
    expect(resumoDaSenha(['especial'])).toBe('Falta um caractere especial.');
  });

  it('duas ou três faltas, sem o tamanho, na ordem da tela', () => {
    expect(resumoDaSenha(['especial', 'numero'])).toBe('Faltam um número e um caractere especial.');
    expect(resumoDaSenha(['especial', 'letra', 'numero'])).toBe('Faltam uma letra, um número e um caractere especial.');
  });

  it('só o tamanho', () => {
    expect(resumoDaSenha(['caracteres'])).toBe('A senha precisa ter pelo menos 8 caracteres.');
  });

  it('o tamanho e mais', () => {
    expect(resumoDaSenha(['numero', 'caracteres'])).toBe('A senha precisa ter pelo menos 8 caracteres. Falta um número.');
    expect(resumoDaSenha([...TODAS])).toBe('A senha precisa ter pelo menos 8 caracteres. Faltam uma letra, um número e um caractere especial.');
  });

  it('repetição e valor desconhecido são ignorados', () => {
    expect(faltasEmOrdem(['numero', 'xyz', 'numero', 'letra'])).toEqual(['letra', 'numero']);
    expect(resumoDaSenha(['xyz'])).toBe(SENHA_ATENDE_AS_REGRAS);
  });
});

describe('RN-CORE-32: itens da lista', () => {
  it('sempre as quatro regras, na ordem da tela', () => {
    expect(itensDasRegras([]).map((i) => i.regra)).toEqual([...REGRAS_DA_SENHA]);
    expect(itensDasRegras([]).map((i) => i.rotulo)).toEqual(['8 caracteres ou mais', 'Uma letra', 'Um número', 'Um caractere especial']);
  });

  it('cumprida = ok; faltando = falta (neutra) enquanto digita', () => {
    const itens = itensDasRegras(['numero', 'especial']);
    expect(itens.map((i) => i.estado)).toEqual(['ok', 'ok', 'falta', 'falta']);
    expect(itens.map((i) => i.rotuloAcessivel)).toEqual(['8 caracteres ou mais: ok', 'Uma letra: ok', 'Um número: falta', 'Um caractere especial: falta']);
  });

  it('destacar (depois de tentar salvar) pinta só as faltas como erro; o texto falado continua "falta"', () => {
    const itens = itensDasRegras(['numero'], true);
    expect(itens.map((i) => i.estado)).toEqual(['ok', 'ok', 'erro', 'ok']);
    expect(itens[2]?.rotuloAcessivel).toBe('Um número: falta');
  });

  it('o exemplo de símbolos fica só no caractere especial', () => {
    expect(itensDasRegras([]).map((i) => i.exemplo)).toEqual([null, null, null, '! @ # $']);
  });
});

describe('RN-CORE-34: "Repita a senha" na "Crie sua senha" (T-0094)', () => {
  it('rótulos dos dois campos', () => {
    expect(CAMPO_SENHA_NOVA).toBe('Senha nova');
    expect(CAMPO_REPITA_A_SENHA).toBe('Repita a senha');
  });

  it('sem repetição (portal, formulário de usuário) ou campo vazio enquanto digita: a linha não aparece', () => {
    expect(itemDaRepeticao(undefined)).toBeNull();
    expect(itemDaRepeticao(undefined, true)).toBeNull();
    expect(itemDaRepeticao('vazia')).toBeNull();
  });

  it('igual = ok; diferente = neutra enquanto digita e erro depois de tentar salvar', () => {
    expect(itemDaRepeticao('igual')).toEqual({ estado: 'ok', texto: 'As senhas conferem.' });
    expect(itemDaRepeticao('igual', true)).toEqual({ estado: 'ok', texto: 'As senhas conferem.' });
    expect(itemDaRepeticao('diferente')).toEqual({ estado: 'falta', texto: 'As senhas não conferem.' });
    expect(itemDaRepeticao('diferente', true)).toEqual({ estado: 'erro', texto: 'As senhas não conferem.' });
  });

  it('vazia depois de tentar salvar = erro "Repita a senha nova."', () => {
    expect(itemDaRepeticao('vazia', true)).toEqual({ estado: 'erro', texto: 'Repita a senha nova.' });
  });

  it('a frase falada junta as regras e a conferência', () => {
    expect(resumoComRepeticao(resumoDaSenha(['numero']), 'diferente')).toBe('Falta um número. As senhas não conferem.');
    expect(resumoComRepeticao(resumoDaSenha([]), 'igual')).toBe('A senha atende às regras. As senhas conferem.');
    expect(resumoComRepeticao(resumoDaSenha([]), 'vazia')).toBe('A senha atende às regras.');
    expect(resumoComRepeticao(resumoDaSenha([]), undefined)).toBe('A senha atende às regras.');
  });
});
