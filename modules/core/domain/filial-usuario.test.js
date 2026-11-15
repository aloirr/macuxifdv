import { describe, expect, it } from 'vitest';
import { filiaisInexistentes, filiaisDeVendaComCadastro, perfilEditaFilial, usuarioBloqueadoPorFilial, validarFiliaisDoUsuario } from './filial-usuario';
const F1 = '0f000000-0000-4000-8000-000000000001';
const F2 = '0f000000-0000-4000-8000-000000000002';
const F3 = '0f000000-0000-4000-8000-000000000003';
describe('RN-CORE-39: filial de cadastro e filiais de venda do usuário', () => {
    it('RN-CORE-39: a filial de cadastro é obrigatória em qualquer perfil', () => {
        expect(validarFiliaisDoUsuario({ cadastro: F1, venda: [F1] })).toBeNull();
        expect(validarFiliaisDoUsuario({ cadastro: null, venda: [F1] })?.codigo).toBe('USUARIO_FILIAL_CADASTRO_OBRIGATORIA');
        expect(validarFiliaisDoUsuario({ cadastro: undefined, venda: [] })?.codigo).toBe('USUARIO_FILIAL_CADASTRO_OBRIGATORIA');
    });
    it('RN-CORE-39: as filiais de venda têm no mínimo 1 e contêm a de cadastro', () => {
        expect(validarFiliaisDoUsuario({ cadastro: F1, venda: [] })?.codigo).toBe('USUARIO_FILIAL_VENDA_VAZIA');
        expect(validarFiliaisDoUsuario({ cadastro: F1, venda: [F2] })?.codigo).toBe('USUARIO_FILIAL_VENDA_SEM_CADASTRO');
        expect(validarFiliaisDoUsuario({ cadastro: F1, venda: [F2, F1, F3] })).toBeNull();
    });
    it('RN-CORE-39: sem limite de filiais de venda por cargo (várias valem para qualquer um)', () => {
        expect(validarFiliaisDoUsuario({ cadastro: F1, venda: [F1, F2, F3] })).toBeNull();
    });
    it('RN-CORE-39: a de cadastro entra na lista de venda quando falta, sem repetir, e vem primeiro', () => {
        expect(filiaisDeVendaComCadastro(F1, [])).toEqual([F1]);
        expect(filiaisDeVendaComCadastro(F1, [F2])).toEqual([F1, F2]);
        expect(filiaisDeVendaComCadastro(F1, [F2, F1, F2])).toEqual([F1, F2]);
        expect(filiaisDeVendaComCadastro(null, [F2, F2])).toEqual([F2]);
    });
    it('RN-CORE-39: filial inexistente, excluída ou de outro tenant (fora das existentes) é recusada', () => {
        expect(filiaisInexistentes([F1, F2], [F1])).toEqual([F2]);
        expect(filiaisInexistentes([F1, F1], [F1])).toEqual([]);
        expect(filiaisInexistentes([], [])).toEqual([]);
    });
    it('RN-CORE-39: bloqueado é quem está sem filial de cadastro, de qualquer perfil', () => {
        expect(usuarioBloqueadoPorFilial({ filial_cadastro_id: null })).toBe(true);
        expect(usuarioBloqueadoPorFilial({ filial_cadastro_id: undefined })).toBe(true);
        expect(usuarioBloqueadoPorFilial({ filial_cadastro_id: F1 })).toBe(false);
    });
    it('RN-CORE-39: só admin e analista informam a filial (a própria, se bloqueados, ou a de outro usuário)', () => {
        expect(perfilEditaFilial('admin')).toBe(true);
        expect(perfilEditaFilial('analista')).toBe(true);
        for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente'])
            expect(perfilEditaFilial(p)).toBe(false);
    });
});
