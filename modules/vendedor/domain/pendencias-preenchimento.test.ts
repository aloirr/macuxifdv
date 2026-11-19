import { describe, expect, it } from 'vitest';
import { pendenciasDePreenchimento, type CodigoErroPagamento, type EntradaPendencias, type ErroDeCalculo } from './pendencias-preenchimento';

const ok: EntradaPendencias = { itens: 2, quantidade_invalida: false, pagamento: { tipo: 'ok' }, frete: 'ok', erros_calculo: [] };
const ids = (e: Partial<EntradaPendencias>) => pendenciasDePreenchimento({ ...ok, ...e }).map((p) => p.id);

describe('pendenciasDePreenchimento (RN-CORE-36, RN-VEN-16)', () => {
  it('RN-CORE-36: pedido completo não tem pendência', () => {
    expect(pendenciasDePreenchimento(ok)).toEqual([]);
  });
  it('RN-VEN-16: FOB sem transportadora aponta a aba Entrega', () => {
    const [p] = pendenciasDePreenchimento({ ...ok, frete: 'transportadora' });
    expect(p).toMatchObject({ id: 'frete', aba: 'entrega', texto: 'Transportadora do frete FOB' });
  });
  it('RN-VEN-16: CNPJ inválido da transportadora digitada também é da aba Entrega', () => {
    expect(pendenciasDePreenchimento({ ...ok, frete: 'cnpj' })[0]).toMatchObject({ id: 'frete', aba: 'entrega', texto: 'CNPJ da transportadora' });
  });
  it('RN-CORE-36: prazo sem escolha aponta a aba Venda', () => {
    const [p] = pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'prazo' } });
    expect(p).toMatchObject({ texto: 'Prazo de pagamento', aba: 'venda' });
  });
  it('RN-CORE-36: forma sem escolha aponta a aba Venda', () => {
    expect(pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'forma' } })[0]).toMatchObject({ id: 'forma', texto: 'Forma de pagamento', aba: 'venda' });
  });
  it('RN-VEN-24: forma/prazo recusados pelo cliente trazem a mensagem da regra na aba Venda', () => {
    expect(pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'invalido', codigo: 'forma_nao_aceita', mensagem: 'x' } })[0]).toMatchObject({ id: 'pagamento', texto: 'Forma de pagamento aceita pelo cliente', aba: 'venda' });
  });
  it('RN-CORE-36: sem item e quantidade inválida são da aba Itens', () => {
    expect(pendenciasDePreenchimento({ ...ok, itens: 0 })[0]).toMatchObject({ id: 'sem-item', texto: 'Pelo menos 1 item', aba: 'itens' });
    expect(pendenciasDePreenchimento({ ...ok, quantidade_invalida: true })[0]).toMatchObject({ id: 'quantidade', aba: 'itens' });
  });
  it('RN-CORE-36: erros do cálculo do item vão para Itens e os do pedido (alçada, ajuste) para o Resumo', () => {
    const r = pendenciasDePreenchimento({
      ...ok,
      erros_calculo: [
        { codigo: 'sem_preco', alvo: { item: 'Caixa 12' }, mensagem: 'qualquer texto' },
        { codigo: 'acima_alcada', alvo: 'pedido', mensagem: 'qualquer texto', limite: '15%' },
        { codigo: 'desconto_acima_total', alvo: 'pedido', mensagem: 'qualquer texto' },
      ],
    });
    expect(r.map((p) => p.aba)).toEqual(['itens', 'resumo', 'resumo']);
  });
  it('RN-CORE-36 / RD-0037: o texto e a aba vêm do código, não da mensagem (texto da mensagem pode mudar à vontade)', () => {
    const t = (codigo: ErroDeCalculo['codigo'], alvo: ErroDeCalculo['alvo'], limite?: string) => pendenciasDePreenchimento({ ...ok, erros_calculo: [{ codigo, alvo, mensagem: 'x', limite }] })[0]!;
    const caixa = { item: 'Caixa 12' };
    expect(t('sem_preco', caixa)).toMatchObject({ texto: 'Caixa 12 sem preço na tabela do cliente', aba: 'itens' });
    expect(t('medida_indisponivel', caixa)).toMatchObject({ texto: 'Medida de Caixa 12', aba: 'itens' });
    expect(t('desconto_e_acrescimo', caixa)).toMatchObject({ texto: 'Desconto ou acréscimo de Caixa 12 (só um dos dois)', aba: 'itens' });
    expect(t('desconto_acima_tabela', caixa)).toMatchObject({ texto: 'Desconto de Caixa 12 acima do preço de tabela', aba: 'itens' });
    expect(t('desconto_e_acrescimo', 'pedido')).toMatchObject({ texto: 'Desconto ou acréscimo do pedido (só um dos dois)', aba: 'resumo' });
    expect(t('desconto_acima_total', 'pedido')).toMatchObject({ texto: 'Desconto do pedido acima do total dos itens', aba: 'resumo' });
    expect(t('acima_alcada', 'pedido', '20%')).toMatchObject({ texto: 'Desconto acima da alçada máxima (20%)', aba: 'resumo' });
    const p = (codigo: CodigoErroPagamento) => pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'invalido', codigo, mensagem: 'x' } })[0]!;
    expect(p('forma_indisponivel')).toMatchObject({ texto: 'Forma de pagamento (a escolhida saiu da lista)', aba: 'venda' });
    expect(p('prazo_indisponivel').texto).toBe('Prazo de pagamento (o escolhido não vale para esta forma)');
    expect(p('forma_nao_aceita').texto).toBe('Forma de pagamento aceita pelo cliente');
  });
  it('RN-CORE-36: ordem dos campos na tela (Venda, Itens, Entrega) e todas juntas', () => {
    expect(ids({ itens: 0, pagamento: { tipo: 'prazo' }, frete: 'transportadora' })).toEqual(['prazo', 'sem-item', 'frete']);
  });
});
