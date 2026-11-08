/**
 * T-0094 (🟡 2 da revisão de UX da fatia W, R-20261108-054817; spec docs/design/ciclo-de-senha.md §2 item 8 e §3
 * Confirmação item 4): ao voltar da "Crie sua senha", do "Esqueci a senha" ou pelo voltar do Android, o login reabre com
 * o código da empresa E o e-mail preenchidos. A senha nunca volta.
 */
import { describe, expect, it } from 'vitest';

import { ETAPA_INICIAL, etapaDeVolta, propsDoLogin } from './etapa-login';

describe('etapaDeVolta', () => {
  it('guarda o aviso, o código e o e-mail (sem espaços nas pontas)', () => {
    expect(etapaDeVolta('Link vencido.', ' DIST01 ', ' ana@uma.com ')).toEqual({ tipo: 'entrar', aviso: 'Link vencido.', codigo: 'DIST01', email: 'ana@uma.com' });
  });
  it('vazio ou ausente vira "sem valor" (o login usa o código salvo no aparelho)', () => {
    expect(etapaDeVolta(undefined, '  ', '')).toEqual(ETAPA_INICIAL);
  });
  it('nunca carrega a senha', () => {
    expect(Object.keys(etapaDeVolta(null, 'DIST01', 'ana@uma.com'))).not.toContain('senha_atual');
  });
});

describe('propsDoLogin', () => {
  it('primeira abertura: o código salvo no aparelho e nenhum e-mail', () => {
    expect(propsDoLogin(ETAPA_INICIAL, 'DIST01')).toEqual({ key: 'salvo|', codigoSalvo: 'DIST01', aviso: null });
  });
  it('de volta da troca ou do pedido: o código e o e-mail digitados, e a tela renasce (key nova)', () => {
    const props = propsDoLogin(etapaDeVolta(null, 'DIST02', 'ana@uma.com'), 'DIST01');
    expect(props).toEqual({ key: 'DIST02|ana@uma.com', codigoSalvo: 'DIST02', aviso: null, emailInicial: 'ana@uma.com' });
    expect(props.key).not.toBe(propsDoLogin(etapaDeVolta(null, 'DIST02', 'bia@uma.com'), 'DIST01').key);
  });
  it('sem código salvo nem digitado: campo vazio', () => {
    expect(propsDoLogin(ETAPA_INICIAL, null).codigoSalvo).toBeNull();
  });
});
