import { describe, expect, it } from 'vitest';
import { linhaDaPendenciaDoPedido, pendenciasDePreenchimento, type EntradaPendencias } from './pendencias-preenchimento';

const ok: EntradaPendencias = { itens: 2, quantidade_invalida: false, pagamento: { tipo: 'ok' }, frete: 'ok', erros_calculo: [] };
const ids = (e: Partial<EntradaPendencias>) => pendenciasDePreenchimento({ ...ok, ...e }).map((p) => p.id);

describe('pendenciasDePreenchimento (RN-CORE-36, RN-VEN-16)', () => {
  it('RN-CORE-36: pedido completo não tem pendência', () => {
    expect(pendenciasDePreenchimento(ok)).toEqual([]);
  });
  it('RN-VEN-16: FOB sem transportadora aponta a aba Entrega', () => {
    const [p] = pendenciasDePreenchimento({ ...ok, frete: 'transportadora' });
    expect(p).toMatchObject({ id: 'frete', aba: 'entrega', texto: 'Transportadora do frete FOB' });
    expect(linhaDaPendenciaDoPedido(p!)).toBe('Transportadora do frete FOB — aba Entrega');
  });
  it('RN-VEN-16: CNPJ inválido da transportadora digitada também é da aba Entrega', () => {
    expect(pendenciasDePreenchimento({ ...ok, frete: 'cnpj' })[0]).toMatchObject({ id: 'frete', aba: 'entrega', texto: 'CNPJ da transportadora' });
  });
  it('RN-CORE-36: prazo sem escolha aponta a aba Venda', () => {
    const [p] = pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'prazo' } });
    expect(linhaDaPendenciaDoPedido(p!)).toBe('Prazo de pagamento — aba Venda');
  });
  it('RN-CORE-36: forma sem escolha aponta a aba Venda', () => {
    expect(pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'forma' } })[0]).toMatchObject({ id: 'forma', texto: 'Forma de pagamento', aba: 'venda' });
  });
  it('RN-VEN-24: forma/prazo recusados pelo cliente trazem a mensagem da regra na aba Venda', () => {
    expect(pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'invalido', mensagem: 'Prazo acima do permitido. Escolha menor.' } })[0]).toMatchObject({ id: 'pagamento', texto: 'Prazo acima do permitido', aba: 'venda' });
  });
  it('RN-CORE-36: sem item e quantidade inválida são da aba Itens', () => {
    expect(pendenciasDePreenchimento({ ...ok, itens: 0 })[0]).toMatchObject({ id: 'sem-item', texto: 'Pelo menos 1 item', aba: 'itens' });
    expect(pendenciasDePreenchimento({ ...ok, quantidade_invalida: true })[0]).toMatchObject({ id: 'quantidade', aba: 'itens' });
  });
  it('RN-CORE-36: erros do cálculo do item vão para Itens e os do pedido (alçada, ajuste) para o Resumo', () => {
    const r = pendenciasDePreenchimento({ ...ok, erros_calculo: ['Caixa 12: sem preço na tabela deste cliente. Remova o item.', 'Desconto efetivo de 20% acima da alçada máxima (15%). Reduza.', 'Pedido: o desconto em R$ passa do total dos itens.'] });
    expect(r.map((p) => p.aba)).toEqual(['itens', 'resumo', 'resumo']);
  });
  it('RN-CORE-36: textos das pendências do cálculo e do pagamento, sem verbo de ordem e sem "Pedido:" (spec §1.2)', () => {
    const t = (m: string) => pendenciasDePreenchimento({ ...ok, erros_calculo: [m] })[0]!;
    expect(t('Caixa 12: sem preço na tabela deste cliente. Remova o item ou peça a atualização da tabela.')).toMatchObject({ texto: 'Caixa 12 sem preço na tabela do cliente', aba: 'itens' });
    expect(t('Caixa 12: a medida CX não está mais disponível. Escolha outra medida.')).toMatchObject({ texto: 'Medida de Caixa 12', aba: 'itens' });
    expect(t('Caixa 12: Desconto e acréscimo são excludentes: use um ou outro. Limpe um dos dois no item.')).toMatchObject({ texto: 'Desconto ou acréscimo de Caixa 12 (só um dos dois)', aba: 'itens' });
    expect(t('Caixa 12: o desconto em R$ passa do preço de tabela. Reduza o desconto do item.')).toMatchObject({ texto: 'Desconto de Caixa 12 acima do preço de tabela', aba: 'itens' });
    expect(t('Pedido: Desconto e acréscimo são excludentes: use um ou outro. Limpe um dos dois nas Condições.')).toMatchObject({ texto: 'Desconto ou acréscimo do pedido (só um dos dois)', aba: 'resumo' });
    expect(t('Pedido: o desconto em R$ passa do total dos itens. Reduza o desconto do pedido.')).toMatchObject({ texto: 'Desconto do pedido acima do total dos itens', aba: 'resumo' });
    expect(t('Desconto efetivo de 25% acima da alçada máxima (20%). Reduza o desconto do pedido ou dos itens.')).toMatchObject({ texto: 'Desconto acima da alçada máxima (20%)', aba: 'resumo' });
    const p = (mensagem: string) => pendenciasDePreenchimento({ ...ok, pagamento: { tipo: 'invalido', mensagem } })[0]!.texto;
    expect(p('Forma de pagamento indisponível. Escolha outra forma na lista.')).toBe('Forma de pagamento (a escolhida saiu da lista)');
    expect(p('Prazo indisponível para esta forma. Escolha outro prazo na lista.')).toBe('Prazo de pagamento (o escolhido não vale para esta forma)');
    expect(p('Este cliente não aceita esta forma de pagamento. Escolha outra forma.')).toBe('Forma de pagamento aceita pelo cliente');
    expect(p('Prazo acima do prazo médio permitido ao cliente. Escolha um prazo menor.')).toBe('Prazo dentro do prazo médio do cliente');
  });
  it('RN-CORE-36: ordem dos campos na tela (Venda, Itens, Entrega) e todas juntas', () => {
    expect(ids({ itens: 0, pagamento: { tipo: 'prazo' }, frete: 'transportadora' })).toEqual(['prazo', 'sem-item', 'frete']);
  });
});
