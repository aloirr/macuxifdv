import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as telas importam react-native e não rodam no Node: confere no fonte (mesmo padrão de slot-em-nome.test.ts)
const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), 'utf8');

describe('T-0101: tela de Pedidos', () => {
  const s = fonte('orders-screen.tsx');
  it('Y11: o número usa trechosDoNumero e fonte mono, sem map inline de destacarTrecho(o.number', () => {
    expect(s).toContain('trechosDoNumero(o.number, busca)');
    expect(s).toContain('fonts.mono');
    expect(s).not.toContain('destacarTrecho(o.number');
    expect(s).toContain('order-numero-destaque');
    expect(s).toContain('order-numero-${o.number}');
  });
  it('Y11: destaque com tokens do kit, legível ao sol', () => {
    expect(s).toMatch(/destaque: \{ backgroundColor: colors\.accentSoft, color: colors\.accentInk \}/);
  });
  it('R1: a situação efetiva e o placeholder do Gestão continuam na tela', () => {
    expect(s).toContain('situacaoEfetiva');
    expect(s).toContain('Cliente ou nº');
  });
});

describe('T-0101 (RN-VEN-35): seletor de clientes do novo pedido', () => {
  const s = fonte('new-order-screen.tsx');
  it('usa o CampoBusca do kit e a lib seletor-em-nome', () => {
    expect(s).toContain('<CampoBusca valor={q}');
    expect(s).toContain('testID="picker-search"');
    expect(s).toContain('seletorEmNome(');
    expect(s).toContain('rotuloAcessivelDaOpcao');
    expect(s).not.toContain('SearchBox');
  });
  it('a linha de outra carteira é desabilitada e sem chevron', () => {
    expect(s).toContain('disabled={!o.selecionavel}');
    expect(s).toContain('accessibilityState={o.selecionavel ? undefined : { disabled: true }}');
    expect(s).toContain('{o.selecionavel ? <Icon name="chevron"');
  });
  it('mantém os testIDs das linhas selecionáveis', () => {
    expect(s).toContain('testID={`pick-${c.trade_name}`}');
  });
});

describe('T-0127 (RN-CORE-36, RN-VEN-16): pendências só no Resumo', () => {
  const s = fonte('new-order-screen.tsx');
  it('RN-CORE-36 (RN-VEN-42): o que falta vira linha da área Alertas, no topo de todas as abas; sem o botão "Corrigir frete"', () => {
    expect(s).toContain('<AreaAlertas alertas={alertasDoTopo}');
    expect(s).not.toContain('BlocoPendencias');
    expect(s).not.toContain('PendenciasDoPedido');
    expect(s).not.toContain('Corrigir frete');
    expect(fonte('../components/novo-pedido.tsx')).not.toContain('Corrigir frete');
  });
  it('RN-CORE-36 (RN-VEN-42): sem bolinha nas abas; a falta só vira alerta depois da tentativa (RD-0170)', () => {
    expect(s).not.toContain('abasComPendencia');
    expect(s).toContain('abasDoPedido(calculo.linhas.length)');
    expect(s).toContain('pendenciasDasAbasTentadas(pendencias.filter(');
    expect(s).toContain(', tentou)');
    expect(s).toContain('botoesDoResumo(');
  });
  it('RN-VEN-13 (T-0129): o crédito do cliente é carregado ao abrir o pedido, não só na aba Venda', () => {
    const efeito = s.slice(s.indexOf('void creditoDoCliente(customerId)') - 120, s.indexOf('void creditoDoCliente(customerId)'));
    expect(efeito).toContain('if (sent) return;');
    expect(efeito).not.toContain("aba !== 'venda'");
  });
});

describe('T-0136 (RF-VEN-11): Novo pedido em 4 abas', () => {
  const s = fonte('new-order-screen.tsx');
  it('RF-VEN-11: abre na Venda e as abas seguem Venda · Itens · Entrega · Resumo', () => {
    expect(s).toContain('useState<AbaNovoPedido>(() => abaInicialDoRascunho(draft))');
    expect(fonte('../lib/textos-pedido.ts')).toMatch(/id: 'venda'[\s\S]*id: 'itens'[\s\S]*id: 'entrega'[\s\S]*id: 'resumo'/);
    expect(s).not.toContain('AbaDetalhes');
  });
  it('RF-VEN-11: forma e prazo saem de Itens e vão para a aba Venda; Itens traz Leve mais e Combina no fim', () => {
    const venda = s.slice(s.indexOf("aba === 'venda' ? ("), s.indexOf("aba === 'itens' ? ("));
    expect(venda).toContain('<CardPagamento');
    expect(venda).not.toContain('alertas={alertasVenda}');
    const itens = s.slice(s.indexOf("aba === 'itens' ? ("), s.indexOf("aba === 'entrega' ? ("));
    expect(itens).not.toContain('<CardPagamento');
    expect(itens.indexOf('<FimDaAbaItens')).toBeGreaterThan(itens.indexOf('<DescontoGeral'));
  });
  it('RF-VEN-11: a aba Entrega leva endereço, frete e observações; o prazo médio sai do cabeçalho', () => {
    expect(s).toContain('<AbaEntrega');
    expect(s).not.toContain('prazo médio do cliente ${');
  });
  it('RF-VEN-11: a tela e as abas não têm campo de valor de frete (RN-VEN-16)', () => {
    expect(fonte('../components/novo-pedido-abas.tsx')).not.toMatch(/frete.*valor_cents|testID="frete-valor"/);
  });
});

describe('T-0137 (RF-VEN-11, RN-VEN-38): Resumo completo e os 4 botões', () => {
  const s = fonte('new-order-screen.tsx');
  const abas = fonte('../components/novo-pedido-abas.tsx');
  it('RN-VEN-38: acabou a folha intermediária "Salvar pedido"; cada botão faz o que diz em 1 toque', () => {
    expect(s).not.toContain('FolhaSalvar');
    expect(s).not.toContain('salvarAberto');
    expect(abas).not.toContain('FolhaSalvar');
    expect(s).toContain("sendRef.current('pedido')");
    expect(s).toContain("sendRef.current('orcamento')");
  });
  it('RF-VEN-11: o desconto é só o DescontoCompacto do kit (no item e no geral), sem os 4 botões grandes nem o campo com − e +', () => {
    expect(fonte('../components/desconto-geral.tsx')).toContain('<DescontoCompacto');
    expect(abas).not.toContain('CampoPct');
    expect(abas).not.toContain('CampoReais');
    expect(abas).not.toContain('pedido-ajuste-tipo');
  });
  it('RF-VEN-11: o Resumo mostra cliente, venda, itens, entrega e observações em LinhaResumo', () => {
    for (const id of ['resumo-venda', 'resumo-itens', 'resumo-entrega', 'resumo-obs']) expect(abas).toContain(`testID="${id}"`);
    expect(abas).toContain('resumo-cliente');
  });
  it('RN-VEN-38: a folha Sair do pedido trata Apenas salvar e Apenas salvar não exige o Resumo sem pendência', () => {
    expect(s).toContain("acao === 'apenas_salvar'");
    expect(fonte('../components/saida-do-pedido.tsx')).toContain('apenasSalvar=');
  });
  it('revisão técnica T-0089 (🟡): confirmar o campo não depende de setTimeout; salvar usa o rascunho do render seguinte', () => {
    expect(s).not.toContain('setTimeout(fn');
    expect(s).not.toContain('saveEditRef.current(), 0');
    expect(s).toContain('aposConfirmar');
  });
});
