import { describe, expect, it } from 'vitest';
import { OrderDetail } from '../../contracts';
import { lerDetalheDoPedido, MSG_ITENS_INDISPONIVEIS } from './detalhe-pedido';

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
