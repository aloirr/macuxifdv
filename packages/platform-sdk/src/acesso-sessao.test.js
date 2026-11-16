/** RD-0016: testes que estavam iguais em `apps/mobile/src/lib/acesso.test.ts` e `apps/web/lib/acesso.test.ts`. */
import { describe, expect, it } from 'vitest';
import { entraEm, perfisDaSessao, perfisDeFabricaQueEntram } from './acesso-sessao';
import { NOME_DO_APP, PERFIS_DO_APP } from './perfis';
describe('acesso da sessão pelo motor do SDK (ADR 0033; RD-0016)', () => {
    it('RN-CORE-33: de fábrica, só admin, analista, assistente e gerente entram no BKO (supervisor não), na ordem de PERFIS', () => {
        expect(perfisDeFabricaQueEntram('bko')).toEqual(['gerente', 'analista', 'assistente', 'admin']);
        for (const p of ['vendedor', 'promotor', 'supervisor'])
            expect(entraEm('bko', p)).toBe(false);
    });
    it('RN-CORE-33: o portal é só do admin', () => {
        expect(perfisDeFabricaQueEntram('portal')).toEqual(['admin']);
    });
    it('sem perfil, nada (falha fechada)', () => {
        expect(perfisDaSessao(null)).toEqual([]);
        expect(entraEm('bko', null)).toBe(false);
        expect(entraEm('bko', undefined)).toBe(false);
    });
    it('com os perfis resolvidos pela API, vale o que veio (não o perfil base)', () => {
        const tirouBko = [{ codigo: 'gerente_sem_bko', base: 'gerente', permissoes: { 'acesso.gestao': {} } }];
        expect(entraEm('bko', 'gerente', tirouBko)).toBe(false);
        expect(entraEm('gestao', 'gerente', tirouBko)).toBe(true);
        const deuBko = [{ codigo: 'analista_x', base: 'analista', permissoes: { 'acesso.bko': {} } }];
        expect(entraEm('bko', 'analista', deuBko)).toBe(true);
    });
    it('lista vazia de perfis resolvidos cai no padrão de fábrica', () => {
        expect(entraEm('bko', 'admin', [])).toBe(true);
    });
    it('NOME_DO_APP exportado com os termos das mensagens do login', () => {
        expect(NOME_DO_APP).toEqual({ campo: 'o app Macuxi Campo', gestao: 'o app Macuxi Gestão', web: 'o backoffice (web)' });
    });
    it('RD-0015: PERFIS_DO_APP (mensagem do login, superfície bko da API) é o mesmo que a fábrica do motor diz (paridade, RN-CORE-33)', () => {
        // mantida como lista (perfis.ts não importa o motor: permissoes-perfil já importa perfis.ts); este teste trava a paridade
        expect([...PERFIS_DO_APP.campo].sort()).toEqual(perfisDeFabricaQueEntram('campo').sort());
        expect([...PERFIS_DO_APP.gestao].sort()).toEqual(perfisDeFabricaQueEntram('gestao').sort());
        expect([...PERFIS_DO_APP.web].sort()).toEqual(perfisDeFabricaQueEntram('bko').sort());
    });
});
