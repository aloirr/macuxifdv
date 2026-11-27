import { describe, expect, it } from 'vitest';
import { alterado, CAMPOS_PARAMETROS_PEDIDOS, centavosDoTexto, conferirParametro, conferirPedidoMinimo, OPCOES_CREDITO_EXCEDIDO, OPCOES_ESTOQUE_INSUFICIENTE, SUCESSO_PARAMETRO, textoDeCentavos } from './parametros-pedidos';

const T = CAMPOS_PARAMETROS_PEDIDOS.titulo_vencido_dias;
const V = CAMPOS_PARAMETROS_PEDIDOS.validade_orcamento_dias;

describe('RN-VEN-13 e RN-VEN-18: painéis Parâmetros › Pedidos', () => {
  it('Salvar só liga com valor diferente do salvo', () => {
    expect(alterado(null, 5)).toBe(false);
    expect(alterado('5', 5)).toBe(false);
    expect(alterado('0', 5)).toBe(true);
    expect(alterado('', 5)).toBe(true);
  });
  it('RN-VEN-13 e RN-VEN-18: campo vazio mostra a mensagem da faixa; valor válido passa', () => {
    expect(conferirParametro(T, '0')).toEqual({ ok: true, valor: 0 });
    expect(conferirParametro(T, '')).toEqual({ ok: false, erro: 'Use um número de 0 a 365' });
    expect(conferirParametro(V, '90')).toEqual({ ok: true, valor: 90 });
    expect(conferirParametro(V, '')).toEqual({ ok: false, erro: 'Use um número de 1 a 90' });
  });
  it('cada painel tem o seu texto de sucesso e a ajuda da spec', () => {
    expect(T).toMatchObject({ rotulo: 'Atraso tolerado', sucesso: 'Atraso tolerado salvo.', ajuda: 'De 0 a 365 dias. Acima desse atraso, o pedido do cliente vai para aprovação.' });
    expect(V).toMatchObject({ rotulo: 'Preço vale por', sucesso: 'Preço do orçamento salvo.' });
  });
});

describe('RN-VEN-22: painel Pedido mínimo (dinheiro com vírgula, guardado em centavos)', () => {
  it('RN-VEN-22: converte o texto digitado em centavos e de volta', () => {
    expect(centavosDoTexto('1.500,00')).toBe(150000);
    expect(centavosDoTexto('1500')).toBe(150000);
    expect(centavosDoTexto('1500,5')).toBe(150050);
    expect(centavosDoTexto('0,01')).toBe(1);
    expect(centavosDoTexto('')).toBeNaN();
    expect(centavosDoTexto('abc')).toBeNaN();
    expect(centavosDoTexto('1,234')).toBeNaN();
    expect(textoDeCentavos(150000)).toBe('1.500,00');
    expect(textoDeCentavos(1)).toBe('0,01');
    expect(textoDeCentavos(10_000_000)).toBe('100.000,00');
  });
  it('RN-VEN-22: com "Exigir a partir de" marcada vale de R$ 0,01 a R$ 100.000,00; vazio, zero ou fora mostra a mensagem do domain', () => {
    expect(conferirPedidoMinimo('1.500,00')).toEqual({ ok: true, valor: 150000 });
    expect(conferirPedidoMinimo('100.000,00')).toEqual({ ok: true, valor: 10_000_000 });
    for (const t of ['', '0', '0,00', '100.000,01', 'x']) expect(conferirPedidoMinimo(t)).toEqual({ ok: false, erro: 'Use um valor de R$ 0,01 a R$ 100.000,00' });
  });
  it('RN-VEN-22: o texto de sucesso do painel', () => {
    expect(SUCESSO_PARAMETRO.pedido_minimo_cents).toBe('Pedido mínimo salvo.');
  });
});

describe('RN-VEN-12 e RN-VEN-20: painéis de opções em cartão', () => {
  it('RN-VEN-12: Crédito excedido tem as três opções da spec; só "Enviar para aprovação" traz apoio', () => {
    expect(OPCOES_CREDITO_EXCEDIDO).toEqual([
      { valor: 'aprovacao', rotulo: 'Enviar para aprovação', apoio: 'Quem aprova está em Alçadas.' },
      { valor: 'orcamento', rotulo: 'Só como orçamento' },
      { valor: 'avisar', rotulo: 'Avisar e enviar' },
    ]);
    expect(SUCESSO_PARAMETRO.credito_excedido_acao).toBe('Crédito excedido salvo.');
  });
  it('RN-VEN-20: Estoque insuficiente tem as três opções da spec, sem "Cortar"', () => {
    expect(OPCOES_ESTOQUE_INSUFICIENTE.map((o) => o.valor)).toEqual(['orcamento', 'aprovacao', 'avisar']);
    expect(OPCOES_ESTOQUE_INSUFICIENTE.map((o) => o.apoio)).toEqual([undefined, 'Quem aprova está em Alçadas.', undefined]);
    expect(SUCESSO_PARAMETRO.estoque_insuficiente_acao).toBe('Estoque insuficiente salvo.');
  });
});
