import { describe, expect, it } from 'vitest';
import { CONSULTA_USUARIOS_RESUMO, UsuariosResumoEntradaSchema, UsuariosResumoSaidaSchema } from './consultas';
const U = '0e600000-0000-4000-8000-000000000001';
describe('RN-TRE-07: contrato core.usuarios_resumo@1', () => {
    it('nome e entrada: ids opcionais, teto de 500, rejeita campo extra', () => {
        expect(CONSULTA_USUARIOS_RESUMO.nome).toBe('core.usuarios_resumo@1');
        expect(UsuariosResumoEntradaSchema.parse({})).toEqual({ limite: 500 });
        expect(() => UsuariosResumoEntradaSchema.parse({ usuario_ids: Array(501).fill(U) })).toThrow();
        expect(() => UsuariosResumoEntradaSchema.parse({ email: 'x' })).toThrow();
    });
    it('saída: equipe, regional e ativo, sem e-mail', () => {
        const u = { id: U, nome: 'Ana', perfil: 'vendedor', equipe_id: null, regional_id: null, ativo: false };
        expect(UsuariosResumoSaidaSchema.parse({ usuarios: [u], proximo_cursor: null }).usuarios[0]).toEqual(u);
    });
});
