import { describe, expect, it } from 'vitest';
import { CODIGO_USUARIO_NAO_EXCLUI, provisorioJaVinculado } from './usuario-sem-exclusao';
describe('RN-CORE-60: usuário nunca é excluído, só inativado', () => {
    it('RN-CORE-60: o provisório já vinculado é o inativo sem código do ERP (nunca deleted_at)', () => {
        expect(provisorioJaVinculado({ ativo: false, external_id: null, deleted_at: null })).toBe(true);
        expect(provisorioJaVinculado({ ativo: true, external_id: 'VEN-9', deleted_at: null })).toBe(false);
        expect(provisorioJaVinculado({ ativo: false, external_id: 'VEN-9', deleted_at: null })).toBe(false); // desligado no BKO, ainda com o código
        expect(provisorioJaVinculado({ ativo: true, external_id: null, deleted_at: null })).toBe(false);
    });
    it('RN-CORE-60: registro legado com deleted_at (vínculo antigo) segue reconhecido como já vinculado', () => {
        expect(provisorioJaVinculado({ ativo: false, external_id: null, deleted_at: '2026-11-10T00:00:00Z' })).toBe(true);
    });
    it('RN-CORE-60: o código do 422 de exclusão é USUARIO_NAO_EXCLUI', () => {
        expect(CODIGO_USUARIO_NAO_EXCLUI).toBe('USUARIO_NAO_EXCLUI');
    });
});
