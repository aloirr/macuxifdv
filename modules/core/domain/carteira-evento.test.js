import { describe, expect, it } from 'vitest';
import { carteiraParaEvento } from './carteira-evento';
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const linha = (o) => ({ usuario_id: V1, papel: 'vendedor', frequencia_semanas: null, desde: '2026-10-01T12:00:00.000Z', ...o });
describe('RN-CORE-04: carteiraParaEvento (core.cliente.atualizado@1)', () => {
    it('RN-CORE-04: cliente sem vendedor na carteira publica vendedor_id e datas nulos', () => {
        expect(carteiraParaEvento([], true)).toEqual({ vendedor_id: null, ativo: true, frequencia_visita: null, na_carteira_desde: null });
    });
    it('RN-CORE-04: promotor não é dono da carteira de vendas', () => {
        expect(carteiraParaEvento([linha({ papel: 'promotor', usuario_id: V2 })], true).vendedor_id).toBeNull();
    });
    it('RN-GES-01: frequência 1/2/4 semanas vira semanal/quinzenal/mensal; outro valor vira nulo', () => {
        expect(carteiraParaEvento([linha({ frequencia_semanas: 1 })], true).frequencia_visita).toBe('semanal');
        expect(carteiraParaEvento([linha({ frequencia_semanas: 2 })], true).frequencia_visita).toBe('quinzenal');
        expect(carteiraParaEvento([linha({ frequencia_semanas: 4 })], true).frequencia_visita).toBe('mensal');
        expect(carteiraParaEvento([linha({ frequencia_semanas: 3 })], true).frequencia_visita).toBeNull();
    });
    it('RN-GES-02: na_carteira_desde é a entrada do vendedor atual; com vários vendedores vale o mais recente', () => {
        const r = carteiraParaEvento([linha({ usuario_id: V1, desde: '2026-01-01T00:00:00.000Z' }), linha({ usuario_id: V2, desde: '2026-10-15T00:00:00.000Z' })], false);
        expect(r).toMatchObject({ vendedor_id: V2, na_carteira_desde: '2026-10-15T00:00:00.000Z', ativo: false });
    });
});
