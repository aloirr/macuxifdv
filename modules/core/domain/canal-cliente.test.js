import { describe, expect, it } from 'vitest';
import { CANAL_MAX, canalDoClienteDoErp } from './canal-cliente';
describe('canalDoClienteDoErp (T-0115, RN-PES-05, integracao.cliente.atualizado@1)', () => {
    it('RN-PES-05: canal ausente no payload não altera o que o Core já tem', () => {
        expect(canalDoClienteDoErp({})).toEqual({});
        expect(canalDoClienteDoErp({ canal: undefined })).toEqual({});
    });
    it('RN-PES-05: canal nulo ou em branco limpa; o texto vem aparado, sem espaços repetidos', () => {
        expect(canalDoClienteDoErp({ canal: null })).toEqual({ canal: null });
        expect(canalDoClienteDoErp({ canal: '   ' })).toEqual({ canal: null });
        expect(canalDoClienteDoErp({ canal: '  Atacado   Alimentar ' })).toEqual({ canal: 'Atacado Alimentar' });
    });
    it('RN-PES-05: canal maior que o limite é cortado no limite', () => {
        expect(canalDoClienteDoErp({ canal: 'x'.repeat(CANAL_MAX + 5) }).canal).toHaveLength(CANAL_MAX);
    });
});
