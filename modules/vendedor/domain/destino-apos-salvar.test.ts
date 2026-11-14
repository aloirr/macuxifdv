import { describe, expect, it } from 'vitest';
import { destinoAposSalvar } from './destino-apos-salvar';

describe('RN-VEN-30: destino depois de salvar o pedido', () => {
  it('RN-VEN-30: com check-in aberto no cliente, volta para a tela inicial do cliente', () => {
    expect(destinoAposSalvar({ clienteId: 'c1', visitaAtivaNoCliente: true })).toEqual({ tela: 'cliente', clienteId: 'c1' });
  });
  it('RN-VEN-30: sem check-in, vai para a lista de Pedidos para ver o pedido com o status', () => {
    expect(destinoAposSalvar({ clienteId: 'c1', visitaAtivaNoCliente: false })).toEqual({ tela: 'pedidos' });
  });
  it('RN-VEN-30: sem cliente conhecido, cai em Pedidos mesmo com visita', () => {
    expect(destinoAposSalvar({ clienteId: '', visitaAtivaNoCliente: true })).toEqual({ tela: 'pedidos' });
  });
});
