import { describe, expect, it } from 'vitest';
import { CODIGO_MODULO_INATIVO, erroModuloInativo, ErroModuloInativoSchema, MeusModulosRespostaSchema, STATUS_MODULO_INATIVO } from './modulos';
const ok = {
    modulos: [
        { id: 'core', versao: '0.1.0' },
        { id: 'vendedor', versao: '1.2.0', parametros: { raio_checkin_m: 200 } },
    ],
    versao_licencas: 'v7',
    calculado_em: '2026-10-31T12:00:00Z',
};
describe('contrato GET /v1/me/modulos', () => {
    it('RN-CORE-01: aceita lista com versões e parâmetros; parâmetros ausentes viram {}', () => {
        const r = MeusModulosRespostaSchema.parse(ok);
        expect(r.modulos[0].parametros).toEqual({});
        expect(r.modulos[1].parametros).toEqual({ raio_checkin_m: 200 });
    });
    it('RN-CORE-01: lista sem o core é inválida (core sempre ativo)', () => {
        expect(MeusModulosRespostaSchema.safeParse({ ...ok, modulos: [{ id: 'vendedor', versao: '1.0.0' }] }).success).toBe(false);
    });
    it('RN-CORE-01: módulo repetido, módulo desconhecido e versão fora do semver são inválidos', () => {
        expect(MeusModulosRespostaSchema.safeParse({ ...ok, modulos: [...ok.modulos, { id: 'core', versao: '0.1.0' }] }).success).toBe(false);
        expect(MeusModulosRespostaSchema.safeParse({ ...ok, modulos: [{ id: 'core', versao: '0.1.0' }, { id: 'teste_x', versao: '1.0.0' }] }).success).toBe(false);
        expect(MeusModulosRespostaSchema.safeParse({ ...ok, modulos: [{ id: 'core', versao: '1' }] }).success).toBe(false);
    });
    it('RN-CORE-01: exige versao_licencas para o app detectar mudança no sync', () => {
        const { versao_licencas: _v, ...sem } = ok;
        expect(MeusModulosRespostaSchema.safeParse(sem).success).toBe(false);
    });
});
describe('contrato do erro MODULO_INATIVO', () => {
    it('RN-CORE-02: o erro é 403 com codigo MODULO_INATIVO e o módulo em detalhes', () => {
        const e = erroModuloInativo('vendedor');
        expect(STATUS_MODULO_INATIVO).toBe(403);
        expect(ErroModuloInativoSchema.parse(e)).toEqual(e);
        expect(e.codigo).toBe(CODIGO_MODULO_INATIVO);
        expect(e.detalhes?.modulo).toBe('vendedor');
    });
    it('RN-CORE-02: outro código não passa como MODULO_INATIVO', () => {
        expect(ErroModuloInativoSchema.safeParse({ codigo: 'PERFIL_SEM_ACESSO', mensagem: 'x' }).success).toBe(false);
    });
});
