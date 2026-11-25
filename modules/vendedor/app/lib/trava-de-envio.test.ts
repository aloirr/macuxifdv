import { describe, expect, it } from 'vitest';
import { criarTravaDeEnvio } from './trava-de-envio';

describe('RN-VEN-48: trava do duplo toque no Enviar pedido', () => {
  it('RN-VEN-48: o 2º toque com o 1º em curso é recusado; outra chave segue; solta, volta a valer', () => {
    const t = criarTravaDeEnvio();
    expect(t.prender('c1')).toBe(true);
    expect(t.prender('c1')).toBe(false);
    expect(t.prender('c2')).toBe(true);
    t.soltar('c1');
    expect(t.prender('c1')).toBe(true);
  });
});
