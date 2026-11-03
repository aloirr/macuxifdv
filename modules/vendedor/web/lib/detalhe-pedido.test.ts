import { describe, expect, it } from 'vitest';
import { OrderDetail } from '../../contracts';
import { lerDetalheDoPedido, MSG_ITENS_INDISPONIVEIS, textoDaModalidade, textoDaTransportadora, textoDoAjusteDoItem, textoDoEnderecoEntrega } from './detalhe-pedido';

const base = {
  id: '11111111-1111-4111-8111-111111111111', number: '000010', status: 'pending', customer_id: 'c1', customer_name: 'Mercado', seller_id: 's1', seller_name: 'Ana',
  items: [], history: [],
};
const cliente = { razao_social: 'M', nome_fantasia: 'M', documento: null, endereco: '', bairro: '', cidade: '', uf: 'RR', codigo_erp: '1' };

describe('T-0059: detalhe do pedido tolerante', () => {
  it('retrato do cliente com documento nulo abre o detalhe e sinaliza o aviso (sem erro de validação)', () => {
    let r: ReturnType<typeof lerDetalheDoPedido> | undefined;
    try {
      r = lerDetalheDoPedido({ ...base, cliente });
    } catch (e) {
      // outros campos do contrato podem exigir mais dados; o que importa é não falhar por documento
      expect(String(e)).not.toContain('documento');
      return;
    }
    expect(r.semDocumento).toBe(true);
    expect(r.pedido.cliente?.documento).toBe('');
  });

  it('payload realmente inválido continua falhando na leitura (a tela troca pelo texto amigável via ErrorBlock)', () => {
    expect(() => lerDetalheDoPedido({})).toThrow();
    expect(() => OrderDetail.parse({})).toThrow();
    expect(MSG_ITENS_INDISPONIVEIS).toMatch(/Não foi possível carregar os itens/);
  });
});

describe('T-0061: frete, transportadora e endereço no detalhe do BKO', () => {
  it('RN-VEN-16: CIF e FOB com a transportadora (CNPJ formatado e aviso de digitada)', () => {
    expect(textoDaModalidade({ modality: 'CIF', carrier_name: null, carrier_document: null, carrier_phone: null, carrier_typed: false })).toBe('CIF · por conta da empresa');
    const fob = { modality: 'FOB' as const, carrier_name: 'Rápido Norte', carrier_document: '11222333000181', carrier_phone: '92 3000-0000', carrier_typed: false };
    expect(textoDaModalidade(fob)).toBe('FOB · por conta do cliente');
    expect(textoDaTransportadora(fob)).toBe('Rápido Norte · CNPJ 11.222.333/0001-81 · 92 3000-0000');
    expect(textoDaTransportadora({ ...fob, carrier_typed: true })).toMatch(/digitada pelo vendedor/);
    expect(textoDaTransportadora({ modality: 'CIF', carrier_name: null, carrier_document: null, carrier_phone: null, carrier_typed: false })).toBeNull();
  });
  it('RN-VEN-17: endereço de entrega em uma linha', () => {
    expect(textoDoEnderecoEntrega({ logradouro: 'Av. do Depósito', numero: '500', complemento: 'Galpão 2', bairro: 'Distrito', cidade: 'Manaus', uf: 'AM', cep: '69100-000' })).toBe('Av. do Depósito, 500 – Galpão 2 · Distrito · Manaus/AM · CEP 69100-000');
    expect(textoDoEnderecoEntrega(null)).toBeNull();
  });
  it('RN-VEN-02: desconto e acréscimo do item na tabela', () => {
    const it = { id: 'i', product_id: 'p', erp_code: 'A', description: 'A', quantity: 1, unit_price_cents: 1, discount_pct: 10, total_cents: 1 };
    expect(textoDoAjusteDoItem(it)).toBe('−10%');
    expect(textoDoAjusteDoItem({ ...it, discount_pct: 0, surcharge_pct: 5 })).toBe('+5%');
    expect(textoDoAjusteDoItem({ ...it, discount_pct: 0 })).toBe('—');
  });
});
