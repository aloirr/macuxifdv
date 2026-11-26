import { describe, expect, it } from 'vitest';
import { alterado, CAMPOS_PARAMETROS_PEDIDOS, conferirParametro } from './parametros-pedidos';

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
