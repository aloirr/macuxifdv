import { describe, expect, it } from 'vitest';
import { CriarUsuarioRequestSchema, EditarUsuarioRequestSchema, UsuarioItemSchema } from './usuarios';
import { UsuarioSyncSchema } from './sync';
describe('RN-CORE-59: contrato do Código FDV (aditivo, só de leitura)', () => {
    it('RN-CORE-59: UsuarioItem e UsuarioSync trazem codigo_fdv (nulo até a migração)', () => {
        expect(UsuarioItemSchema.shape.codigo_fdv.parse(null)).toBeNull();
        expect(UsuarioItemSchema.shape.codigo_fdv.parse('00001')).toBe('00001');
        expect(UsuarioSyncSchema.shape.codigo_fdv.parse(undefined)).toBeNull();
    });
    it('RN-CORE-59: criar e editar deixam passar codigo_fdv no schema para a API recusar com 422 (strict daria 400)', () => {
        expect(EditarUsuarioRequestSchema.safeParse({ codigo_fdv: '00009' }).success).toBe(true);
        expect(EditarUsuarioRequestSchema.safeParse({ campo_novo: 1 }).success).toBe(false);
        expect(CriarUsuarioRequestSchema.safeParse({ nome: 'A', email: 'a@b.com', senha: 'x', codigo_fdv: '00009' }).success).toBe(true);
    });
});
