import { describe, expect, it } from 'vitest';
import { CARGOS, CargoSchema, cargoDaBase, HIERARQUIA_DO_CARGO } from './cargos';
import { PERFIS } from './nomes';
describe('cargos do FDV (ADR 0049)', () => {
    it('RN-CORE-53: lista fixa de 5 cargos, validada pelo Zod', () => {
        expect(CARGOS).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo']);
        expect(CargoSchema.parse('promotor')).toBe('promotor');
        expect(CargoSchema.safeParse('diretor').success).toBe(false);
    });
    it('RN-CORE-53: todo perfil base tem um cargo; analista, assistente e admin são administrativo; base desconhecida também', () => {
        expect(PERFIS.map(cargoDaBase)).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo', 'administrativo', 'administrativo']);
        expect(cargoDaBase('personalizado')).toBe('administrativo');
        expect(cargoDaBase('toString')).toBe('administrativo');
    });
    it('RN-CORE-55 e RN-CORE-56: vínculos do cadastro por cargo', () => {
        expect(HIERARQUIA_DO_CARGO.vendedor).toEqual({ supervisor: 'obrigatorio', gerente: 'derivado', nomeEquipe: 'nao' });
        expect(HIERARQUIA_DO_CARGO.promotor).toEqual({ supervisor: 'opcional', gerente: 'obrigatorio', nomeEquipe: 'nao' });
        expect(HIERARQUIA_DO_CARGO.supervisor).toEqual({ supervisor: 'nao', gerente: 'obrigatorio', nomeEquipe: 'obrigatorio' });
        expect(HIERARQUIA_DO_CARGO.gerente.supervisor).toBe('nao');
        expect(HIERARQUIA_DO_CARGO.administrativo).toEqual({ supervisor: 'nao', gerente: 'nao', nomeEquipe: 'nao' });
    });
});
