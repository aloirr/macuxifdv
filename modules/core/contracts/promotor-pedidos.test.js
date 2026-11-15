import { describe, expect, it } from 'vitest';
import { CONSULTA_PROMOTOR_VE_PEDIDOS, PROMOTOR_VE_PEDIDOS_PADRAO, PromotorVePedidosPutSchema } from './promotor-pedidos';
describe('RN-CORE-01: contrato core.promotor_ve_pedidos@1', () => {
    it('nome versionado, entrada vazia e saída { ligado }', () => {
        expect(CONSULTA_PROMOTOR_VE_PEDIDOS.nome).toBe('core.promotor_ve_pedidos@1');
        expect(CONSULTA_PROMOTOR_VE_PEDIDOS.entrada.parse({})).toEqual({});
        expect(() => CONSULTA_PROMOTOR_VE_PEDIDOS.entrada.parse({ tenant_id: 'x' })).toThrow();
        expect(CONSULTA_PROMOTOR_VE_PEDIDOS.saida.parse({ ligado: false })).toEqual({ ligado: false });
        expect(() => CONSULTA_PROMOTOR_VE_PEDIDOS.saida.parse({ ligado: 'sim' })).toThrow();
    });
    it('o padrão é ligado e o corpo do PUT é só { ligado: boolean }', () => {
        expect(PROMOTOR_VE_PEDIDOS_PADRAO).toBe(true);
        expect(PromotorVePedidosPutSchema.parse({ ligado: true })).toEqual({ ligado: true });
        expect(() => PromotorVePedidosPutSchema.parse({})).toThrow();
        expect(() => PromotorVePedidosPutSchema.parse({ ligado: true, extra: 1 })).toThrow();
    });
});
