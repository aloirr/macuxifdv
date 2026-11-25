import { describe, expect, it } from 'vitest';
import { REFRESH_DIAS } from '../domain/auth';
import { RefreshRespostaSchema, RotasQuerySchema, SessaoRespostaSchema, SessaoWebRespostaSchema, RefreshWebRespostaSchema, VisitasQuerySchema } from '../contracts';
import { moduloApi } from './index';
const publica = (caminho) => moduloApi.rotasPublicas?.find((r) => r.caminho === caminho);
describe('T-0117 (ADR 0038): as rotas de auth declaram o papel do cookie de sessão do BKO', () => {
    const validade = REFRESH_DIAS * 86_400;
    it('auth/login e auth/senha/trocar emitem o cookie com a validade do refresh do Core', () => {
        expect(publica('auth/login')?.cookieSessao).toEqual({ papel: 'emitir', validadeSegundos: validade });
        expect(publica('auth/senha/trocar')?.cookieSessao).toEqual({ papel: 'emitir', validadeSegundos: validade });
    });
    it('auth/refresh renova e auth/logout encerra; a rota de esqueci-senha não mexe em cookie', () => {
        expect(publica('auth/refresh')?.cookieSessao).toEqual({ papel: 'renovar', validadeSegundos: validade });
        expect(publica('auth/logout')?.cookieSessao).toEqual({ papel: 'encerrar' });
        expect(publica('auth/senha/esqueci')?.cookieSessao).toBeUndefined();
    });
    it('schemas web não têm refresh_token; os do app continuam com ele', () => {
        expect(Object.keys(SessaoWebRespostaSchema.shape)).not.toContain('refresh_token');
        expect(Object.keys(RefreshWebRespostaSchema.shape)).not.toContain('refresh_token');
        expect(Object.keys(SessaoRespostaSchema.shape)).toContain('refresh_token');
        expect(Object.keys(RefreshRespostaSchema.shape)).toContain('refresh_token');
    });
});
describe('T-0140: data inexistente na entrada das rotas do Core é recusada em português (nunca 500)', () => {
    it.each(['2026-02-30', '2026-13-01'])('rotas e visitas recusam %s', (d) => {
        for (const r of [RotasQuerySchema.safeParse({ de: d }), RotasQuerySchema.safeParse({ ate: d }), VisitasQuerySchema.safeParse({ de: d }), VisitasQuerySchema.safeParse({ ate: d })]) {
            expect(r.success).toBe(false);
            if (!r.success)
                expect(r.error.issues[0]?.message).toMatch(/Data inexistente/);
        }
    });
    it('data real continua valendo', () => {
        expect(RotasQuerySchema.safeParse({ de: '2026-02-28' }).success).toBe(true);
        expect(VisitasQuerySchema.safeParse({ ate: '2028-02-29' }).success).toBe(true);
    });
});
