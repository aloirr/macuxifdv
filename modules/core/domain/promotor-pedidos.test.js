import { describe, expect, it } from 'vitest';
import { PARAMETRO_PROMOTOR_VE_PEDIDOS } from '../contracts';
import { perfilPodeEscreverPedido, perfilRecebeHistoricoDeCompra, perfilPodeVerPedidos, promotorVePedidos, promotorVePedidosDasLinhas } from './promotor-pedidos';
const linha = (valor, extra = {}) => ({ modulo: 'core', chave: 'promotor_ve_pedidos', valor, ...extra });
describe('RN-CORE-01 / RN-PRO-01: opção promotor_ve_pedidos (padrão ligado)', () => {
    it('a chave do parâmetro é promotor_ve_pedidos', () => {
        expect(PARAMETRO_PROMOTOR_VE_PEDIDOS).toBe('promotor_ve_pedidos');
    });
    it('ausência de registro = ligado (padrão do tenant novo)', () => {
        expect(promotorVePedidos(undefined)).toBe(true);
        expect(promotorVePedidos(null)).toBe(true);
        expect(promotorVePedidosDasLinhas([])).toBe(true);
    });
    it('só o valor false desliga; valor inválido cai no padrão ligado (nunca esconde por engano)', () => {
        expect(promotorVePedidos(false)).toBe(false);
        expect(promotorVePedidos(true)).toBe(true);
        expect(promotorVePedidos('false')).toBe(true);
        expect(promotorVePedidos(0)).toBe(true);
        expect(promotorVePedidos({})).toBe(true);
    });
    it('lê o valor efetivo das linhas sincronizadas; removido ou de outro módulo/chave não conta', () => {
        expect(promotorVePedidosDasLinhas([linha(false)])).toBe(false);
        expect(promotorVePedidosDasLinhas([linha(true)])).toBe(true);
        expect(promotorVePedidosDasLinhas([linha(false, { deleted_at: '2030-01-01T00:00:00Z' })])).toBe(true);
        expect(promotorVePedidosDasLinhas([{ modulo: 'vendedor', chave: 'promotor_ve_pedidos', valor: false }])).toBe(true);
        expect(promotorVePedidosDasLinhas([{ modulo: 'core', chave: 'checkin.raio_m', valor: false }])).toBe(true);
    });
    it('RN-PRO-01: a opção só controla a LEITURA do promotor; vendedor, gestor e demais perfis não mudam', () => {
        expect(perfilPodeVerPedidos('promotor', true)).toBe(true);
        expect(perfilPodeVerPedidos('promotor', false)).toBe(false);
        for (const p of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']) {
            expect(perfilPodeVerPedidos(p, false)).toBe(true);
            expect(perfilPodeVerPedidos(p, true)).toBe(true);
        }
    });
    it('RN-PRO-01: promotor nunca escreve pedido, com a opção ligada ou desligada', () => {
        expect(perfilPodeEscreverPedido('promotor')).toBe(false);
        expect(perfilPodeEscreverPedido('vendedor')).toBe(true);
    });
});
describe('RN-PRO-01 / T-0077 D2: histórico de compras segue promotor_ve_pedidos', () => {
    it('RN-PRO-01: promotor só recebe o histórico de compras com a opção ligada', () => {
        expect(perfilRecebeHistoricoDeCompra('promotor', true)).toBe(true);
        expect(perfilRecebeHistoricoDeCompra('promotor', false)).toBe(false);
    });
    it('RN-PRO-01: demais perfis recebem o histórico independentemente da opção', () => {
        for (const p of ['vendedor', 'supervisor', 'gerente', 'admin']) {
            expect(perfilRecebeHistoricoDeCompra(p, false)).toBe(true);
            expect(perfilRecebeHistoricoDeCompra(p, true)).toBe(true);
        }
    });
});
