import { describe, expect, it } from 'vitest';

import { abasDoPedido, itemCompacto, linhaDeEntrega, linhasDeTotais, rotuloCurtoDaCondicao, seloDoOrcamento, situacaoDoClienteSync, textoDaFaixa, tituloDaFolhaSalvar } from './textos-pedido';

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

describe('textoDaFaixa (aba Resumo)', () => {
  const limite = 5;
  it('RN-VEN-10: dentro da alçada = "4,6% · dentro da alçada" com o ✓ do tom', () => {
    expect(textoDaFaixa({ desconto_efetivo_pct: 4.6, nivel: null, bloqueado: false }, limite)).toEqual({ texto: '4,6% · dentro da alçada', tom: 'ok', icone: 'check' });
  });
  it('RN-VEN-10: acima da alçada do vendedor mostra quem aprova', () => {
    expect(textoDaFaixa({ desconto_efetivo_pct: 8, nivel: 'supervisor', bloqueado: false }, limite)).toEqual({ texto: '8,0% · vai para o supervisor', tom: 'aviso', icone: 'alert' });
    expect(textoDaFaixa({ desconto_efetivo_pct: 12, nivel: 'gerente', bloqueado: false }, limite)?.texto).toBe('12,0% · vai para o gerente');
  });
  it('RN-VEN-10: acima da alçada máxima bloqueia', () => {
    expect(textoDaFaixa({ desconto_efetivo_pct: 16, nivel: null, bloqueado: true }, limite)).toEqual({ texto: '16,0% · acima da alçada', tom: 'erro', icone: 'alert' });
  });
  it('RN-VEN-03: acréscimo (efetivo negativo) sem ícone, e zero sem faixa', () => {
    expect(textoDaFaixa({ desconto_efetivo_pct: -2, nivel: null, bloqueado: false }, limite)).toEqual({ texto: 'Acréscimo 2,0%', tom: 'ok', icone: null });
    expect(textoDaFaixa({ desconto_efetivo_pct: 0, nivel: null, bloqueado: false }, limite)).toBeNull();
  });
});

describe('abasDoPedido e folha do Salvar', () => {
  it('RF-VEN-11: três abas — Itens (com a contagem), Detalhes e Resumo', () => {
    expect(abasDoPedido(3)).toEqual([
      { id: 'itens', rotulo: 'Itens', contador: 3 },
      { id: 'detalhes', rotulo: 'Detalhes' },
      { id: 'resumo', rotulo: 'Resumo' },
    ]);
    expect(abasDoPedido(0)[0]!.contador).toBeNull();
  });
  it('RN-VEN-18: título da folha', () => {
    expect(tituloDaFolhaSalvar()).toBe('Salvar pedido');
  });
});

describe('seloDoOrcamento (RN-VEN-18)', () => {
  it('aberto: "Orçamento · até 10/11"', () => {
    expect(seloDoOrcamento({ situacao: 'aberto', validade_data: '2026-11-10' })).toEqual({ texto: 'Orçamento · até 10/11', tom: 'roxo' });
  });
  it('vencido, cancelado e convertido', () => {
    expect(seloDoOrcamento({ situacao: 'expirado', validade_data: '2026-11-10' }).texto).toBe('Vencido');
    expect(seloDoOrcamento({ situacao: 'cancelado', validade_data: '2026-11-10' }).texto).toBe('Cancelado');
    expect(seloDoOrcamento({ situacao: 'convertido', validade_data: '2026-11-10', pedido_numero: '000015' }).texto).toBe('Virou pedido 000015');
    expect(seloDoOrcamento({ situacao: 'convertido', validade_data: '2026-11-10' }).texto).toBe('Virou pedido');
  });
});

describe('situacaoDoClienteSync (RN-VEN-13 / RN-CORE-17)', () => {
  it('RN-VEN-13: cliente ativo e completo faz pedido', () => {
    expect(situacaoDoClienteSync({ ativo: true })).toEqual({ ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] });
  });
  it('RN-CORE-17: cadastro incompleto leva os campos que faltam', () => {
    expect(situacaoDoClienteSync({ ativo: true, cadastro_incompleto: true, cadastro_campos_faltantes: ['CEP'] })).toMatchObject({ cadastro_incompleto: true, campos_faltantes: ['CEP'] });
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
