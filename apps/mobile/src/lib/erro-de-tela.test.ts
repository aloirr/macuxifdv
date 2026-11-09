import { describe, expect, it } from 'vitest';

import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import { deveGravarErro, mensagemDoErroParaSuporte, registroDoErro, textoDoUltimoErro } from './erro-de-tela';

const AGORA = new Date('2026-11-08T21:15:00Z');

describe('erro de tela (relato de 08/11: o app fechava no Novo pedido)', () => {
  it('guarda mensagem, origem, rota e o começo da pilha', () => {
    const e = new Error('Rendered more hooks than during the previous render.');
    e.stack = `Error: ${e.message}\n    at OrderEditor (index.bundle:1:2)\n    at renderWithHooks (index.bundle:3:4)`;
    const r = registroDoErro(e, 'tela', AGORA, '/m/novo-pedido');
    expect(r).toEqual({
      quando: '2026-11-08T21:15:00.000Z',
      origem: 'tela',
      onde: '/m/novo-pedido',
      mensagem: 'Rendered more hooks than during the previous render.',
      pilha: 'at OrderEditor (index.bundle:1:2)\nat renderWithHooks (index.bundle:3:4)',
    });
  });
  it('nome do erro quando não é o genérico; texto e objeto lançados', () => {
    expect(registroDoErro(new TypeError('x is undefined'), 'fatal', AGORA).mensagem).toBe('TypeError: x is undefined');
    expect(registroDoErro('falhou', 'fatal', AGORA)).toMatchObject({ mensagem: 'falhou', pilha: null, onde: null });
    // objeto lançado: só as chaves, nunca os valores (revisão R-20261108-215731)
    expect(registroDoErro({ codigo: 1 }, 'fatal', AGORA).mensagem).toBe('Objeto lançado {codigo}');
    const r = registroDoErro({ nome: 'Fulano de Tal', documento: '12345678000190', codigo: 1 }, 'fatal', AGORA);
    expect(r.mensagem).toBe('Objeto lançado {nome, documento, codigo}');
    expect(JSON.stringify(r)).not.toMatch(/Fulano|12345678000190/);
    expect(registroDoErro(null, 'fatal', AGORA).mensagem).toBe('Valor lançado: null');
    expect(registroDoErro(42, 'fatal', AGORA).mensagem).toBe('Valor lançado do tipo number');
  });
  it('mensagem longa é truncada em 300 caracteres e a pilha em 6 linhas', () => {
    const e = new Error('a'.repeat(1000));
    e.stack = Array.from({ length: 20 }, (_, i) => `at f${i} (x:1:1)`).join('\n');
    const r = registroDoErro(e, 'tela', AGORA);
    expect(r.mensagem).toHaveLength(300);
    expect(r.pilha?.split('\n')).toHaveLength(6);
  });
  it('linha do Diagnóstico com os textos do kit (efeito do erro, sem "fatal" na tela)', () => {
    const r = registroDoErro(new Error('quebrou'), 'tela', AGORA, '/m/novo-pedido');
    r.pilha = null;
    expect(textoDoUltimoErro(r, () => 'hoje 17:15')).toBe('Último erro do app: hoje 17:15 · mostrou a tela de erro · /m/novo-pedido\nquebrou');
    expect(textoDoUltimoErro({ ...r, origem: 'fatal', onde: null }, () => 'hoje 17:15')).toBe('Último erro do app: hoje 17:15 · o app fechou\nquebrou');
    expect(textoDoUltimoErro(null, () => '')).toBe('Nenhum erro do app registrado neste aparelho.');
  });
});

describe('sem dado pessoal e sem perder a causa (revisão R-20261108-214923)', () => {
  it('e-mail, CNPJ e telefone saem mascarados no registro (mensagem e pilha); UUID e arquivo do bundle ficam', () => {
    const e = new Error('Cliente ana@x.com.br, CNPJ 12.345.678/0001-90, tel (92) 99123-4567');
    e.stack = 'Error: x\nat abrir (index.bundle:12:3) id 9f3c2b1a-7d4e-4c8f-a1b2-c3d4e5f6a7b8 joao@y.com';
    const r = registroDoErro(e, 'tela', AGORA);
    expect(r.mensagem).toBe('Cliente [e-mail], CNPJ [cnpj], tel [telefone]'); // máscara única do @macuxi/comum (R-20261109-034101)
    expect(r.pilha).toBe('Error: x\nat abrir (index.bundle:12:3) id 9f3c2b1a-7d4e-4c8f-a1b2-c3d4e5f6a7b8 [e-mail]');
    expect(mascararDadoPessoal('pedido 000010')).toBe('pedido 000010');
  });
  it('telefone sem DDD também sai mascarado; pilha, UUID, data e pedido curto ficam (E8 do testes, R-20261109-000339)', () => {
    expect(mascararDadoPessoal('ligar 99123-4567 ou 3234-5678 ou 991234567')).toBe('ligar [telefone] ou [telefone] ou [telefone]');
    expect(mascararDadoPessoal('at f (index.android.bundle:1234:56789)')).toBe('at f (index.android.bundle:1234:56789)');
    expect(mascararDadoPessoal('id 550e8400-e29b-41d4-a716-446655440000')).toBe('id 550e8400-e29b-41d4-a716-446655440000');
    expect(mascararDadoPessoal('em 2026-11-08T21:11:00.000Z, pedido 1234')).toBe('em 2026-11-08T21:11:00.000Z, pedido 1234');
  });
  it('o não fatal não grava por cima do fatal nem da tela de erro; tela, raiz e fatal sempre gravam', () => {
    expect(deveGravarErro(null, 'nao-fatal')).toBe(true);
    expect(deveGravarErro({ origem: 'nao-fatal' }, 'nao-fatal')).toBe(true);
    expect(deveGravarErro({ origem: 'fatal' }, 'nao-fatal')).toBe(false);
    expect(deveGravarErro({ origem: 'tela' }, 'nao-fatal')).toBe(false);
    expect(deveGravarErro({ origem: 'fatal' }, 'fatal')).toBe(true);
    expect(deveGravarErro({ origem: 'fatal' }, 'tela')).toBe(true);
  });
  it('mensagem ao suporte no padrão da T-0088: "app versão · título", quando e onde, mensagem e pilha', () => {
    const r = { quando: '2026-11-08T21:15:00.000Z', origem: 'tela' as const, onde: '/m/novo-pedido', mensagem: 'quebrou', pilha: 'at OrderEditor (index.bundle:1:2)' };
    expect(mensagemDoErroParaSuporte(r, { app: 'Macuxi Campo 1.0.1', titulo: 'Não foi possível mostrar esta tela' })).toBe(
      'Macuxi Campo 1.0.1 · Não foi possível mostrar esta tela\n2026-11-08T21:15:00.000Z · /m/novo-pedido\nquebrou\nat OrderEditor (index.bundle:1:2)',
    );
  });
});
