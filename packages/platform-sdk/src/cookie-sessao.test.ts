import { describe, expect, it } from 'vitest';
import { cookieSessaoApagado, COOKIE_SESSAO_VALIDADE_MAX_S, lerCookie, modoDaSessaoWeb, montarCookieSessao, nomeDoCookieSessao } from './cookie-sessao';

/** T-0117 (ADR 0038): regras puras do cookie do token de renovação do BKO. */
describe('cookie de sessão do BKO', () => {
  const T = '00000000-0000-4000-8000-000000000001.AbC_d-123456789012345678';

  it('produção: __Secure-, HttpOnly, Secure, SameSite=Strict, caminho das rotas de sessão, sem Domain', () => {
    expect(montarCookieSessao(T, { seguro: true, maxAgeSegundos: 3600 })).toBe(`__Secure-macuxi_rt=${T}; Max-Age=3600; Path=/api-proxy/auth; HttpOnly; Secure; SameSite=Strict`);
  });

  it('PC: macuxi_rt sem Secure; validade limitada a 90 dias', () => {
    expect(nomeDoCookieSessao(false)).toBe('macuxi_rt');
    expect(montarCookieSessao(T, { seguro: false, maxAgeSegundos: 10 ** 9 })).toBe(`macuxi_rt=${T}; Max-Age=${COOKIE_SESSAO_VALIDADE_MAX_S}; Path=/api-proxy/auth; HttpOnly; SameSite=Strict`);
  });

  it('valor fora do formato de cookie (; , espaço, aspas) lança: nunca injeta atributo', () => {
    for (const v of ['a;Domain=x', 'a b', 'a,b', '"a"', '']) expect(() => montarCookieSessao(v, { seguro: true, maxAgeSegundos: 60 })).toThrow();
  });

  it('apagar: mesmo nome e caminho, Max-Age=0', () => {
    expect(cookieSessaoApagado(true)).toBe('__Secure-macuxi_rt=; Max-Age=0; Path=/api-proxy/auth; HttpOnly; Secure; SameSite=Strict');
  });

  it('lê o cookie pelo nome exato', () => {
    expect(lerCookie(`a=1; __Secure-macuxi_rt=${T}; b=2`, '__Secure-macuxi_rt')).toBe(T);
    expect(lerCookie(`x__Secure-macuxi_rt=1`, '__Secure-macuxi_rt')).toBeNull();
    expect(lerCookie('__Secure-macuxi_rt=', '__Secure-macuxi_rt')).toBeNull();
    expect(lerCookie(undefined, 'a')).toBeNull();
  });

  it('modo: sem cabeçalho = corpo (o app); "1" do próprio site = cookie; outro valor ou outro site = recusado', () => {
    expect(modoDaSessaoWeb({})).toBe('corpo');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': '1' })).toBe('cookie');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': '1', 'sec-fetch-site': 'same-origin' })).toBe('cookie');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': '1', 'sec-fetch-site': 'none' })).toBe('cookie');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': '1', 'sec-fetch-site': 'cross-site' })).toBe('recusado');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': '1', 'sec-fetch-site': 'same-site' })).toBe('recusado');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': 'true' })).toBe('recusado');
    expect(modoDaSessaoWeb({ 'x-macuxi-csrf': ['1', '1'] })).toBe('recusado');
  });
});
