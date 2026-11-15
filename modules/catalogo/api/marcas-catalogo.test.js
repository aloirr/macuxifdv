/** RN-CAT-13 / RN-CAT-09: as marcas vêm da tabela própria do Catálogo (ADR 0034), sem consultar o Promotor. */
import { describe, expect, it, vi } from 'vitest';
import { MARCAS_DO_CATALOGO } from './repositorio-postgres';
const ID = '00000000-0000-4000-8000-0000000000a1';
describe('MARCAS_DO_CATALOGO', () => {
    it('RN-CAT-13: lê catalogo.marca_concorrente (vivas, inclusive inativas) e devolve id → nome e situação, sem consulta ao Promotor', async () => {
        const query = vi.fn(async (..._args) => ({ rows: [{ id: ID, nome: 'Freiomax', ativo: false }], rowCount: 1 }));
        const consultar = vi.fn();
        const m = await MARCAS_DO_CATALOGO({ consultar }, { query });
        expect(m.get(ID)).toEqual({ nome: 'Freiomax', ativo: false });
        expect(String(query.mock.calls[0]?.[0])).toContain('catalogo.marca_concorrente');
        expect(String(query.mock.calls[0]?.[0])).toContain('deleted_at is null');
        expect(consultar).not.toHaveBeenCalled();
    });
    it('RN-CAT-13: erro do banco não é engolido', async () => {
        const query = vi.fn(async () => {
            throw new Error('falha');
        });
        await expect(MARCAS_DO_CATALOGO({}, { query })).rejects.toThrow('falha');
    });
});
