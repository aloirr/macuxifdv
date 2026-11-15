import { describe, expect, it } from 'vitest';
import { BLOQUEIO_LOGIN_MINUTOS, estadoDoLogin, estadoDoRefresh, expiracaoDoAcesso, expiracaoDoRefresh, MAX_FALHAS_LOGIN, registrarFalhaDeLogin, zerarFalhasDeLogin, } from './auth';
const t0 = new Date('2026-10-31T12:00:00Z');
const mais = (min) => new Date(t0.getTime() + min * 60_000);
describe('RF-CORE-01: bloqueio por tentativas de login', () => {
    it('RF-CORE-01: 4 falhas seguidas ainda não bloqueiam; a 5ª bloqueia por 15 min', () => {
        let c = { falhas: 0, bloqueioAte: null };
        for (let i = 1; i < MAX_FALHAS_LOGIN; i++) {
            c = registrarFalhaDeLogin(c, t0);
            expect(c.bloqueioAte).toBeNull();
        }
        c = registrarFalhaDeLogin(c, t0);
        expect(c.falhas).toBe(MAX_FALHAS_LOGIN);
        expect(c.bloqueioAte).toEqual(mais(BLOQUEIO_LOGIN_MINUTOS));
    });
    it('RF-CORE-01: passado o bloqueio, a contagem recomeça do zero', () => {
        const c = registrarFalhaDeLogin({ falhas: 5, bloqueioAte: mais(15) }, mais(16));
        expect(c).toEqual({ falhas: 1, bloqueioAte: null });
    });
    it('RF-CORE-01: senha certa zera a contagem', () => {
        expect(zerarFalhasDeLogin()).toEqual({ falhas: 0, bloqueioAte: null });
    });
    it('RF-CORE-01: estado do login — inativo, bloqueio do admin, bloqueio por tentativas e liberado', () => {
        const base = { ativo: true, bloqueadoEm: null, bloqueioAte: null, agora: t0 };
        expect(estadoDoLogin(base)).toBe('ok');
        expect(estadoDoLogin({ ...base, ativo: false })).toBe('inativo');
        expect(estadoDoLogin({ ...base, bloqueadoEm: t0 })).toBe('bloqueado_admin');
        expect(estadoDoLogin({ ...base, bloqueioAte: mais(5) })).toBe('bloqueado_tentativas');
        expect(estadoDoLogin({ ...base, bloqueioAte: mais(-1) })).toBe('ok');
    });
});
describe('RF-CORE-01: refresh rotativo (doc 04)', () => {
    const base = { expiraEm: mais(60), usadoEm: null, revogadoEm: null, agora: t0 };
    it('RF-CORE-01: refresh novo vale; expirado, usado e revogado não', () => {
        expect(estadoDoRefresh(base)).toBe('valido');
        expect(estadoDoRefresh({ ...base, expiraEm: mais(-1) })).toBe('expirado');
        expect(estadoDoRefresh({ ...base, usadoEm: mais(-5) })).toBe('reutilizado');
        expect(estadoDoRefresh({ ...base, revogadoEm: mais(-5) })).toBe('revogado');
    });
    it('RF-CORE-01: acesso dura 15 min e o refresh 30 dias', () => {
        expect(expiracaoDoAcesso(t0)).toEqual(mais(15));
        expect(expiracaoDoRefresh(t0)).toEqual(new Date('2026-11-30T12:00:00Z'));
    });
});
