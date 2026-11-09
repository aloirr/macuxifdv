import { describe, expect, it } from 'vitest';

import { registroDoErro, textoDoUltimoErro } from './erro-de-tela';

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
    expect(registroDoErro({ codigo: 1 }, 'fatal', AGORA).mensagem).toBe('{"codigo":1}');
  });
  it('mensagem longa é truncada em 300 caracteres e a pilha em 6 linhas', () => {
    const e = new Error('a'.repeat(1000));
    e.stack = Array.from({ length: 20 }, (_, i) => `at f${i} (x:1:1)`).join('\n');
    const r = registroDoErro(e, 'tela', AGORA);
    expect(r.mensagem).toHaveLength(300);
    expect(r.pilha?.split('\n')).toHaveLength(6);
  });
  it('linha do Diagnóstico', () => {
    const r = registroDoErro(new Error('quebrou'), 'tela', AGORA, '/m/novo-pedido');
    r.pilha = null;
    expect(textoDoUltimoErro(r, () => 'hoje 17:15')).toBe('Último erro (tela): hoje 17:15 · /m/novo-pedido\nquebrou');
    expect(textoDoUltimoErro(null, () => '')).toBe('Nenhum erro de tela registrado neste aparelho.');
  });
});
