import { describe, expect, it } from 'vitest';
import { acoesDoRodapeCliente } from './rodape-cliente';
const a = (id, destaque) => ({ id, payload: { destaque } });
describe('T-0076: rodapé do Cliente 360 (referência aprovada em 04/11)', () => {
    it('T-0076: o rodapé fica só com a ação de destaque (Novo pedido); "Ver catálogo" e outras sem destaque saem', () => {
        const r = acoesDoRodapeCliente([a('ver-catalogo'), a('novo-pedido', true)]);
        expect(r.map((x) => x.id)).toEqual(['novo-pedido']);
    });
    it('T-0076: sem ação de destaque (módulo do pedido desligado ou promotor, RN-PRO-01) o rodapé fica só com o Visitado', () => {
        expect(acoesDoRodapeCliente([a('ver-catalogo')])).toEqual([]);
        expect(acoesDoRodapeCliente([])).toEqual([]);
    });
});
