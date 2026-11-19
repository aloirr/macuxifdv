import { describe, expect, it } from 'vitest';

import { alertasDoPedido, impedeEnviarPorAlertas, soOrcamentoPorAlertas, textoDoAlertaNoItem, textoDoMaximo, vencidosComEfeito } from './alertas-pedido';

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

  it('RD-0189: a falta da aba aberta não entra em Alertas (fica no campo); as das outras abas entram', () => {
    const faltantes = [{ texto: 'Falta a forma de pagamento', aba: 'Venda' }, { texto: 'Falta a transportadora', aba: 'Entrega' }];
    expect(alertasDoPedido({ cliente, faltantes, aba_atual: 'Venda' }).map((x) => x.texto)).toEqual(['Falta a transportadora']);
    expect(alertasDoPedido({ cliente, faltantes }).map((x) => x.texto)).toEqual(['Falta a forma de pagamento', 'Falta a transportadora']);
  });

  it('RN-CORE-36: informação faltante leva à aba, desliga o enviar e NÃO obriga orçamento', () => {
    const a = alertasDoPedido({ cliente, faltantes: [{ texto: 'Falta a transportadora', aba: 'Entrega' }] });
    expect(a[0]).toMatchObject({ tipo: 'faltante', texto: 'Falta a transportadora', aba: 'Entrega', vai_para: { aba: 'Entrega' }, impede_enviar: true, so_orcamento: false });
    expect(soOrcamentoPorAlertas(a)).toBe(false);
    expect(impedeEnviarPorAlertas(a)).toBe(true);
  });

  it('RN-VEN-13 (RD-0171): bloqueado, inativo e cadastro incompleto têm o mesmo efeito (só orçamento): uma linha, a primeira que vale', () => {
    const tudo = alertasDoPedido({ cliente: { bloqueado: true, ativo: false, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] } });
    expect(tudo.map((x) => x.texto)).toEqual(['Cliente bloqueado']);
    expect(soOrcamentoPorAlertas(tudo)).toBe(true);
    expect(alertasDoPedido({ cliente: { bloqueado: false, ativo: false, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] } }).map((x) => x.texto)).toEqual(['Cliente inativo']);
    expect(alertasDoPedido({ cliente: { ...cliente, cadastro_incompleto: true, campos_faltantes: ['CEP'] } }).map((x) => x.texto)).toEqual(['Cadastro do cliente incompleto']);
  });

  it('RN-VEN-13 (RD-0172): título vencido só vira alerta acima do limite (5 dias), com qualquer prazo (P1 A)', () => {
    const v = { titulos: 1, valor_cents: 5_000, dias: 6 };
    expect(vencidosComEfeito(v, 5)).toBe(v);
    expect(vencidosComEfeito({ ...v, dias: 5 }, 5)).toBeNull();
    expect(vencidosComEfeito({ ...v, dias: 1 }, 5)).toBeNull();
    expect(vencidosComEfeito(null, 5)).toBeNull();
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

describe('RN-VEN-10 (T-0165, RD-0142): a alçada vira uma linha nos Alertas', () => {
  it('RN-VEN-10: acima da alçada, uma linha "Desconto acima da sua alçada", que leva à aba Itens, depois dos outros alertas, sem bloquear o envio', () => {
    const a = alertasDoPedido({ cliente, acima_da_alcada: true, itens_sem_estoque: [{ item: 'p', codigo: 'BIS-400' }] });
    expect(a.map((x) => x.texto)).toEqual(['BIS-400 sem estoque', 'Desconto acima da sua alçada']);
    const l = a[1]!;
    expect(l).toMatchObject({ tipo: 'alcada', vai_para: { aba: 'Itens' }, so_orcamento: false, impede_enviar: false });
    expect(soOrcamentoPorAlertas([l])).toBe(false);
    expect(impedeEnviarPorAlertas([l])).toBe(false);
  });
  it('RN-VEN-10: dentro da alçada não há alerta', () => {
    expect(alertasDoPedido({ cliente, acima_da_alcada: false })).toEqual([]);
  });

  it('RN-VEN-25 (RD-0173): cliente sem nenhuma forma aceita vira UM alerta sempre visível, que impede o envio e leva à aba Venda', () => {
    const a = alertasDoPedido({ cliente, sem_forma_para_o_cliente: true });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ texto: 'Sem forma de pagamento para este cliente', tipo: 'faltante', aba: 'Venda', vai_para: { aba: 'Venda' }, impede_enviar: true, so_orcamento: false });
  });

  it('RN-VEN-42 (RD-0174): o item que a cópia deixou de fora entra em Alertas, uma linha por item, sem efeito no envio', () => {
    const a = alertasDoPedido({ cliente, itens_fora_da_copia: ['AGU-1500 fora da cópia: sem preço', 'CAF-500 fora da cópia: inativo'] });
    expect(a.map((x) => x.texto)).toEqual(['AGU-1500 fora da cópia: sem preço', 'CAF-500 fora da cópia: inativo']);
    expect(soOrcamentoPorAlertas(a)).toBe(false);
    expect(impedeEnviarPorAlertas(a)).toBe(false);
  });

  it('RN-VEN-42 (RD-0175): editar pedido enviado sem sinal vira a linha "Sem sinal para salvar a alteração" e impede salvar', () => {
    const a = alertasDoPedido({ cliente, sem_sinal_para_salvar: true });
    expect(a.map((x) => x.texto)).toEqual(['Sem sinal para salvar a alteração']);
    expect(impedeEnviarPorAlertas(a)).toBe(true);
  });

  it('RN-VEN-11 (RD-0177): o limite do desconto vai embaixo do campo do item como "Máx. 10,0%"', () => {
    expect(textoDoMaximo(10)).toBe('Máx. 10,0%');
  });
});
