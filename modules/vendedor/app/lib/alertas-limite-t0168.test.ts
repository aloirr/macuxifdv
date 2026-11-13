import { describe, expect, it } from 'vitest';
import { alertasDoPedido, soOrcamentoPorAlertas } from '../../domain/alertas-pedido';
import { botoesDoResumo } from '../../domain/botoes-resumo';
import { abaDaCorrecao, motivoDaRecusa } from './salvar-na-fila';

const CLIENTE = { ativo: true, bloqueado: false } as never;

describe('RN-VEN-11a: Alertas e botões do pedido acima do limite', () => {
  it('RN-VEN-11a: a frase única "Pedido acima do desconto máximo (X%)" entra nos Alertas e a linha da alçada sai', () => {
    const a = alertasDoPedido({ cliente: CLIENTE, acima_do_limite: 80 });
    expect(a.map((x) => x.texto)).toEqual(['Pedido acima do desconto máximo (8,0%)']);
    expect(soOrcamentoPorAlertas(a)).toBe(true);
  });
  it('RN-VEN-11a: sem excesso não há alerta de limite', () => {
    expect(alertasDoPedido({ cliente: CLIENTE, acima_do_limite: null })).toEqual([]);
  });
  it('RN-VEN-11a: acima do limite só "Salvar como orçamento" (o enviar fica desligado)', () => {
    const b = botoesDoResumo({ cliente: CLIENTE, pre_venda_ligada: true, editando: null, pendencias: 0, acima_do_limite: true } as never);
    expect(b.enviar.habilitado).toBe(false);
    expect(b.principal).toBe('orcamento');
  });
  it('RN-VEN-11a: a recusa da API leva ao Resumo, com a frase em português', () => {
    expect(abaDaCorrecao('Pedido acima do desconto máximo do vendedor (8,0%)')).toBe('resumo');
    expect(abaDaCorrecao('desconto_pedido_acima_limite')).toBe('resumo');
    expect(motivoDaRecusa('desconto_pedido_acima_limite')).toBe('Pedido acima do desconto máximo');
  });
});
