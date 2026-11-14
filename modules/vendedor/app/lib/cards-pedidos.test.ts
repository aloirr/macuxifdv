import { describe, expect, it } from 'vitest';
import { periodoDe } from '../../domain/busca-periodo';
import { resumoDePedidos } from '../../domain/resumo-pedidos';
import { periodoSemPedidos, quantidadeDoCard, textoDoCard, valorDoCard } from './cards-pedidos';

describe('RN-VEN-43: cards de Pedidos', () => {
  it('RN-VEN-43: texto do card = quantidade · valor; sem resposta, traço', () => {
    expect(textoDoCard({ quantidade: 2, valor_cents: 123400 })).toMatch(/^2 · R\$\s?1\.234,00$/);
    expect(textoDoCard(null)).toBe('—');
  });
  it('RN-VEN-43: o recusado fica fora e o total soma orçamentos e enviados', () => {
    const emitido_em = '2026-11-10T15:00:00Z';
    const r = resumoDePedidos(
      [
        { status: 'received', total_cents: 1000, emitido_em },
        { status: 'rejected', total_cents: 500, emitido_em },
        { tipo: 'orcamento', status: 'draft', total_cents: 200, emitido_em },
      ],
      { periodo: periodoDe('mes', new Date('2026-11-12T12:00:00Z'), 'America/Manaus'), tz: 'America/Manaus' },
    );
    expect(r.total).toEqual({ quantidade: 2, valor_cents: 1200 });
  });
  it('RN-VEN-43: o cartão separa a quantidade em destaque do valor em R$; sem resposta, traço e sem valor', () => {
    const q = { quantidade: 7, valor_cents: 123400 };
    expect(quantidadeDoCard(q)).toBe('7');
    expect(valorDoCard(q)).toMatch(/^R\$\s?1\.234,00$/);
    expect(quantidadeDoCard(null)).toBe('—');
    expect(valorDoCard(null)).toBeNull();
    expect(`${quantidadeDoCard(q)} · ${valorDoCard(q)}`).toBe(textoDoCard(q));
  });
});

describe('RD-0263: período vazio mostra só a frase do vazio', () => {
  const zero = { quantidade: 0, valor_cents: 0 };
  const vazio = { orcamentos: zero, enviados: zero, total: zero };
  it('RN-VEN-43: total zerado e lista do período vazia, sem busca: esconde cartões e chips', () => {
    expect(periodoSemPedidos({ resumo: vazio, itensNoPeriodo: 0, buscando: false })).toBe(true);
  });
  it('com pedido no período (total > 0) os cartões ficam', () => {
    const um = { quantidade: 1, valor_cents: 1000 };
    expect(periodoSemPedidos({ resumo: { orcamentos: zero, enviados: um, total: um }, itensNoPeriodo: 1, buscando: false })).toBe(false);
  });
  it('total zerado mas com rascunho, fila ou recusado na lista do período: os chips seguem úteis', () => {
    expect(periodoSemPedidos({ resumo: vazio, itensNoPeriodo: 2, buscando: false })).toBe(false);
  });
  it('sem resposta do servidor (resumo nulo) não é vazio: o cartão mostra o estado', () => {
    expect(periodoSemPedidos({ resumo: null, itensNoPeriodo: 0, buscando: false })).toBe(false);
  });
  it('buscando: o vazio é da busca, não do período', () => {
    expect(periodoSemPedidos({ resumo: vazio, itensNoPeriodo: 0, buscando: true })).toBe(false);
  });
});
