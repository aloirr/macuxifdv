import { describe, expect, it } from 'vitest';
import { CONSULTA_MARCAS, EVENTO_MARCA_CONCORRENTE_ALTERADA, MarcaConcorrenteAlteradaSchema, MarcasEntradaSchema, entidadeMarcaConcorrente } from './marcas';
const ID = '00000000-0000-4000-8000-0000000000a1';
describe('RN-CAT-13: contratos das marcas concorrentes (ADR 0034)', () => {
    it('RN-CAT-13: nomes versionados @1', () => {
        expect(CONSULTA_MARCAS.nome).toBe('catalogo.marcas@1');
        expect(EVENTO_MARCA_CONCORRENTE_ALTERADA.nome).toBe('catalogo.marca_concorrente.alterada@1');
        expect(entidadeMarcaConcorrente.nome).toBe('marca_concorrente');
    });
    it('RN-CAT-13: entrada da consulta é strict, padrão sem inativas, até 500 ids', () => {
        expect(MarcasEntradaSchema.parse({}).incluir_inativas).toBe(false);
        expect(MarcasEntradaSchema.safeParse({ extra: 1 }).success).toBe(false);
        expect(MarcasEntradaSchema.safeParse({ ids: Array(501).fill(ID) }).success).toBe(false);
    });
    it('RN-CAT-13: o evento é strict e aceita só os 4 fatos', () => {
        const ok = { id: ID, nome: 'Cofap', ativo: true, external_id: null, fato: 'criada', alterada_em: '2026-11-08T10:00:00Z' };
        expect(MarcaConcorrenteAlteradaSchema.safeParse(ok).success).toBe(true);
        expect(MarcaConcorrenteAlteradaSchema.safeParse({ ...ok, fato: 'apagada' }).success).toBe(false);
        expect(MarcaConcorrenteAlteradaSchema.safeParse({ ...ok, usuario: 'x' }).success).toBe(false);
    });
});
