import { describe, expect, it } from 'vitest';

import { alertasDoPedido, impedeEnviarPorAlertas, soOrcamentoPorAlertas, textoDoAlertaNoItem } from './alertas-pedido';

const cliente = { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] as string[] };

describe('RN-VEN-42: área única Alertas do pedido', () => {
  it('RN-VEN-42: sem problema, a lista é vazia (a área nem aparece)', () => {
    expect(alertasDoPedido({ cliente })).toEqual([]);
  });

  it('RN-VEN-11: um alerta por item acima do máximo, "<código> acima do desconto máximo", levando ao popup do item', () => {
    const a = alertasDoPedido({ cliente, itens_acima_do_maximo: [{ item: 'i1', codigo: 'AGU-1500' }, { item: 'i2', codigo: 'CAF-500' }] });
    expect(a.map((x) => x.texto)).toEqual(['AGU-1500 acima do desconto máximo', 'CAF-500 acima do desconto máximo']);
    expect(a[0]).toMatchObject({ tipo: 'maximo', vai_para: { item: 'i1' }, so_orcamento: true });
  });

  it('RN-VEN-20: produto sem estoque entra e o pedido só sai como orçamento', () => {
    const a = alertasDoPedido({ cliente, itens_sem_estoque: [{ item: 'i3', codigo: 'BIS-400' }] });
    expect(a[0]).toMatchObject({ texto: 'BIS-400 sem estoque', tipo: 'estoque', so_orcamento: true });
    expect(soOrcamentoPorAlertas(a)).toBe(true);
  });

  it('RN-CORE-36: informação faltante leva à aba, desliga o enviar e NÃO obriga orçamento', () => {
    const a = alertasDoPedido({ cliente, faltantes: [{ texto: 'Falta a transportadora', aba: 'Entrega' }] });
    expect(a[0]).toMatchObject({ tipo: 'faltante', texto: 'Falta a transportadora', aba: 'Entrega', vai_para: { aba: 'Entrega' }, impede_enviar: true, so_orcamento: false });
    expect(soOrcamentoPorAlertas(a)).toBe(false);
    expect(impedeEnviarPorAlertas(a)).toBe(true);
  });

  it('RN-VEN-13: cliente bloqueado, inativo e cadastro incompleto só permitem orçamento', () => {
    const a = alertasDoPedido({ cliente: { bloqueado: true, ativo: false, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] } });
    expect(a.map((x) => x.texto)).toEqual(['Cliente bloqueado', 'Cliente inativo', 'Cadastro do cliente incompleto']);
    expect(soOrcamentoPorAlertas(a)).toBe(true);
  });

  it('RN-VEN-12 e RN-VEN-13: crédito e título vencido vêm depois dos que impedem o envio e não forçam orçamento', () => {
    const a = alertasDoPedido({
      cliente,
      vencidos: { titulos: 2, valor_cents: 10_000, dias: 12 },
      disponivel_cents: 100,
      total_cents: 500,
      itens_sem_estoque: [{ item: 'i3', codigo: 'BIS-400' }],
      faltantes: [{ texto: 'Falta a forma de pagamento', aba: 'Venda' }],
    });
    expect(a.map((x) => x.tipo)).toEqual(['faltante', 'estoque', 'credito', 'titulo']);
    expect(a.map((x) => x.texto).slice(2)).toEqual(['Limite de crédito excedido', 'Título vencido']);
  });

  it('RN-VEN-42: ordem cliente, faltante, máximo, estoque', () => {
    const a = alertasDoPedido({
      cliente: { ...cliente, bloqueado: true },
      faltantes: [{ texto: 'Falta a transportadora', aba: 'Entrega' }],
      itens_acima_do_maximo: [{ item: 'a', codigo: 'A-1' }],
      itens_sem_estoque: [{ item: 'b', codigo: 'B-1' }],
    });
    expect(a.map((x) => x.tipo)).toEqual(['cliente', 'faltante', 'maximo', 'estoque']);
  });

  it('RN-VEN-40: a recusa vira alerta com o motivo curto, sem ponto final', () => {
    const a = alertasDoPedido({ cliente, recusas: ['AGU-1500 acima do desconto máximo', 'Cliente sem limite.'] });
    expect(a.map((x) => x.texto)).toEqual(['AGU-1500 acima do desconto máximo', 'Cliente sem limite']);
    expect(a.every((x) => x.tipo === 'recusa' && !x.so_orcamento)).toBe(true);
  });

  it('RN-VEN-42: no popup do item o código sai', () => {
    const a = alertasDoPedido({ cliente, itens_acima_do_maximo: [{ item: 'i1', codigo: 'AGU-1500', maximo_pct: 10 }], itens_sem_estoque: [{ item: 'i1', codigo: 'AGU-1500' }] });
    expect(a.map((x) => textoDoAlertaNoItem(x))).toEqual(['Acima do desconto máximo de 10,0%', 'Sem estoque']);
  });

  it('RN-VEN-42: o TalkBack lê a aba e o convite a corrigir só quando a linha é tocável', () => {
    const [f] = alertasDoPedido({ cliente, faltantes: [{ texto: 'Falta a transportadora', aba: 'Entrega' }] });
    expect(f!.leitura).toBe('Falta a transportadora, aba Entrega. Toque duas vezes para corrigir.');
    const [c] = alertasDoPedido({ cliente: { ...cliente, bloqueado: true } });
    expect(c!.leitura).toBe('Cliente bloqueado.');
  });
});
