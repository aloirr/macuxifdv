import { describe, expect, it } from 'vitest';
import { assinarTokenPlataforma, chaveDeTentativa, exigirSegredoPlataforma, verificarTokenPlataforma } from './seguranca-plataforma';
const SEGREDO = 'segredo-da-plataforma-diferente-do-tenant-0123456789';
const SUB = '0a000000-0000-4000-8000-0000000000aa';
const SID = '0a000000-0000-4000-8000-0000000000bb';
const TID = '0a000000-0000-4000-8000-0000000000cc';
const agora = new Date('2026-11-07T12:00:00Z');
const depois = new Date(agora.getTime() + 15 * 60_000);
describe('ADR 0031: token do portal e chave de tentativas', () => {
    it('ADR 0031: a chave de tentativas é HMAC de 64 hex, estável por e-mail e diferente por segredo', () => {
        const a = chaveDeTentativa(SEGREDO, 'ana@x.com');
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(chaveDeTentativa(SEGREDO, 'ana@x.com')).toBe(a);
        expect(chaveDeTentativa(SEGREDO, 'bia@x.com')).not.toBe(a);
        expect(chaveDeTentativa(`${SEGREDO}x`, 'ana@x.com')).not.toBe(a);
    });
    it('ADR 0031: token sa e cli (com e sem tid) fazem o caminho de ida e volta', () => {
        const sa = verificarTokenPlataforma(assinarTokenPlataforma({ sub: SUB, sid: SID, typ: 'sa' }, agora, depois, SEGREDO), agora, SEGREDO);
        expect(sa).toMatchObject({ typ: 'sa', sub: SUB, sid: SID, amr: ['pwd'], aud: 'macuxi-plataforma' });
        const cli = verificarTokenPlataforma(assinarTokenPlataforma({ sub: SUB, sid: SID, typ: 'cli', tid: TID }, agora, depois, SEGREDO), agora, SEGREDO);
        expect(cli).toMatchObject({ typ: 'cli', tid: TID });
        const semEmpresa = verificarTokenPlataforma(assinarTokenPlataforma({ sub: SID, sid: SID, typ: 'cli' }, agora, depois, SEGREDO), agora, SEGREDO);
        expect(semEmpresa?.tid).toBeUndefined();
    });
    it('ADR 0031: recusa vencido, segredo errado, adulterado e tid em token de super-admin', () => {
        const t = assinarTokenPlataforma({ sub: SUB, sid: SID, typ: 'cli', tid: TID }, agora, depois, SEGREDO);
        expect(verificarTokenPlataforma(t, new Date(depois.getTime() + 1000), SEGREDO)).toBeNull();
        expect(verificarTokenPlataforma(t, agora, 'outro-segredo-com-mais-de-32-caracteres-xx')).toBeNull();
        const [c, p, s] = t.split('.');
        const adulterado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), tid: SUB })).toString('base64url');
        expect(verificarTokenPlataforma(`${c}.${adulterado}.${s}`, agora, SEGREDO)).toBeNull();
        const saComTid = assinarTokenPlataforma({ sub: SUB, sid: SID, typ: 'sa', tid: TID }, agora, depois, SEGREDO);
        expect(verificarTokenPlataforma(saComTid, agora, SEGREDO)).toBeNull();
    });
    it('ADR 0031: segredo ausente ou curto = erro de configuração (falha fechada)', () => {
        expect(() => exigirSegredoPlataforma(undefined)).toThrow();
        expect(() => exigirSegredoPlataforma('curto')).toThrow();
        expect(exigirSegredoPlataforma(SEGREDO)).toBe(SEGREDO);
    });
});
