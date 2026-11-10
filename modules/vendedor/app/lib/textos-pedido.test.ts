import { describe, expect, it } from 'vitest';

import { abaInicialDoRascunho, AVISO_PEDIDO_SALVO, ABA_INICIAL_DO_PEDIDO, abaAnteriorDoPedido, abasDoPedido, proximaAbaDoPedido, type AbaNovoPedido, itemCompacto, linhaDeEntrega, linhasDeTotais, rotuloCurtoDaCondicao, seloDoOrcamento, situacaoDoClienteSync } from './textos-pedido';

describe('rotuloCurtoDaCondicao (referência enxuta, §6.1)', () => {
  it('RN-VEN-14: "À vista", "28 d" e "28/56" cabem no chip', () => {
    expect(rotuloCurtoDaCondicao('À vista')).toBe('À vista');
    expect(rotuloCurtoDaCondicao('28 dias')).toBe('28 d');
    expect(rotuloCurtoDaCondicao('28/56 dias')).toBe('28/56');
    expect(rotuloCurtoDaCondicao('28/56/84')).toBe('28/56/84');
  });
  it('RN-VEN-14: descrição fora do padrão fica como está', () => {
    expect(rotuloCurtoDaCondicao('Boleto 30 dias após a entrega')).toBe('Boleto 30 dias após a entrega');
  });
});

describe('abasDoPedido e folha do Salvar', () => {
  it('RF-VEN-11: quatro abas — Venda, Itens (com a contagem, também 0), Entrega e Resumo', () => {
    expect(abasDoPedido(3)).toEqual([
      { id: 'venda', rotulo: 'Venda' },
      { id: 'itens', rotulo: 'Itens', contador: 3 },
      { id: 'entrega', rotulo: 'Entrega' },
      { id: 'resumo', rotulo: 'Resumo' },
    ]);
    expect(abasDoPedido(0)[1]!.contador).toBe(0);
  });
  it('RF-VEN-11: a tela abre na Venda e o Avançar/voltar seguem Venda → Itens → Entrega → Resumo', () => {
    expect(ABA_INICIAL_DO_PEDIDO).toBe('venda');
    expect(['venda', 'itens', 'entrega'].map((a) => proximaAbaDoPedido(a as AbaNovoPedido))).toEqual(['itens', 'entrega', 'resumo']);
    expect(['resumo', 'entrega', 'itens', 'venda'].map((a) => abaAnteriorDoPedido(a as AbaNovoPedido))).toEqual(['entrega', 'itens', 'venda', null]);
  });
});

describe('seloDoOrcamento (RN-VEN-18)', () => {
  it('aberto: "Orçamento · preço de 10/11"', () => {
    expect(seloDoOrcamento({ situacao: 'aberto', preco_data: '2026-11-10' })).toEqual({ texto: 'Orçamento · preço de 10/11', tom: 'roxo' });
  });
  it('cancelado e convertido (não há vencido)', () => {
    expect(seloDoOrcamento({ situacao: 'cancelado', preco_data: '2026-11-10' }).texto).toBe('Cancelado');
    expect(seloDoOrcamento({ situacao: 'convertido', preco_data: '2026-11-10', pedido_numero: '000015' }).texto).toBe('Virou pedido 000015');
    expect(seloDoOrcamento({ situacao: 'convertido', preco_data: '2026-11-10' }).texto).toBe('Virou pedido');
  });
});

describe('situacaoDoClienteSync (RN-VEN-13 / RN-CORE-17)', () => {
  it('RN-VEN-13: cliente ativo e completo faz pedido', () => {
    expect(situacaoDoClienteSync({ ativo: true })).toEqual({ ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] });
  });
  it('RN-CORE-17: cadastro incompleto leva os campos que faltam', () => {
    expect(situacaoDoClienteSync({ ativo: true, cadastro_incompleto: true, cadastro_campos_faltantes: ['CEP'] })).toMatchObject({ cadastro_incompleto: true, campos_faltantes: ['CEP'] });
  });
  it('RN-VEN-13: cliente bloqueado no financeiro só faz orçamento (pedido recusado)', () => {
    expect(situacaoDoClienteSync({ ativo: true }, { bloqueado: true }).bloqueado).toBe(true);
    expect(situacaoDoClienteSync({ ativo: true }, { bloqueado: false }).bloqueado).toBe(false);
  });
  it('RN-VEN-13: cliente não encontrado no aparelho conta como inativo (só orçamento)', () => {
    expect(situacaoDoClienteSync(null).ativo).toBe(false);
  });
});

describe('Resumo: item compacto, linha de entrega e totais (referência enxuta)', () => {
  it('RF-VEN-11: item compacto "Água mineral 500 ml · 3 FD"', () => {
    expect(itemCompacto('Água mineral 500 ml', 3, 'FD')).toBe('Água mineral 500 ml · 3 FD');
  });
  it('RN-VEN-16: linha "CIF · 28 dias · endereço", sem sobras quando falta algo', () => {
    expect(linhaDeEntrega({ modalidade: 'CIF', prazo: '28 dias', endereco: 'Av. Ajuricaba, 1200' })).toBe('CIF · 28 dias · Av. Ajuricaba, 1200');
    expect(linhaDeEntrega({ modalidade: 'FOB', prazo: '28 dias', endereco: null })).toBe('FOB · 28 dias');
  });
  it('RN-VEN-02: totais com os números da referência (Tabela 398,30 · Descontos 18,51 · Total 379,79)', () => {
    const t = linhasDeTotais({ total_tabela_cents: 39830, desconto_cents: 1851, acrescimo_cents: 0, total_cents: 37979 });
    expect(t.linhas.map((l) => [l.rotulo, l.valor.replace(/s/g, ' ')])).toEqual([
      ['Tabela', 'R$ 398,30'],
      ['Descontos', '− R$ 18,51'],
    ]);
    expect(t.total.valor.replace(/s/g, ' ')).toBe('R$ 379,79');
  });
  it('RN-VEN-03: sem desconto, só a Tabela; acréscimo aparece como Acréscimos', () => {
    expect(linhasDeTotais({ total_tabela_cents: 1000, desconto_cents: 0, acrescimo_cents: 0, total_cents: 1000 }).linhas).toHaveLength(1);
    expect(linhasDeTotais({ total_tabela_cents: 1000, desconto_cents: 0, acrescimo_cents: 20, total_cents: 1020 }).linhas[1]!.rotulo).toBe('Acréscimos');
  });

});

describe('aviso do orçamento salvo (T-0071 V8)', () => {
  it('RN-VEN-18 V8: o aviso do orçamento salvo traz o número com sinal e "salvo no aparelho" sem sinal, sem ponto final', async () => {
    const { avisoDoOrcamentoSalvo } = await import('./textos-pedido');
    expect(avisoDoOrcamentoSalvo('000012')).toBe('Orçamento 000012 salvo');
    expect(avisoDoOrcamentoSalvo(null)).toBe('Orçamento salvo no aparelho');
  });
});

describe('RN-VEN-38 (T-0137): Apenas salvar', () => {
  it('RN-VEN-38: o rascunho guardado reabre no Resumo e o novo abre em Venda', () => {
    expect(abaInicialDoRascunho({ salvo_em: '2026-11-08T14:00:00Z' })).toBe('resumo');
    expect(abaInicialDoRascunho({})).toBe(ABA_INICIAL_DO_PEDIDO);
    expect(abaInicialDoRascunho({ salvo_em: null })).toBe('venda');
  });
  it('RN-VEN-38: o aviso depois de Apenas salvar', () => {
    expect(AVISO_PEDIDO_SALVO).toBe('Pedido salvo');
  });
});
