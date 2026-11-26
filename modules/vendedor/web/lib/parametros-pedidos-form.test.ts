import { describe, expect, it } from 'vitest';
import { corpoDosParametrosPedidos, errosDosParametrosPedidos, formDosParametrosPedidos, podeSalvarPedidos } from './parametros-pedidos-form';

const salvo = formDosParametrosPedidos({ validade_orcamento_dias: 7, titulo_vencido_dias: 5 });

describe('BKO > Parâmetros > Pedidos: validade do orçamento e dias de atraso', () => {
  it('RN-VEN-18: o formulário nasce com os valores salvos e Salvar começa desligado', () => {
    expect(salvo).toEqual({ validade: '7', atraso: '5' });
    expect(podeSalvarPedidos(salvo, salvo)).toBe(false);
  });
  it('RN-VEN-18: validade de 1 a 90; 0, 91, vazio e texto dão erro', () => {
    for (const v of ['0', '91', '', 'abc', '1,5', '-3']) expect(errosDosParametrosPedidos({ ...salvo, validade: v }).validade, v).toBe('Informe de 1 a 90 dias.');
    for (const v of ['1', '90', ' 30 ']) expect(errosDosParametrosPedidos({ ...salvo, validade: v }).validade, v).toBeUndefined();
  });
  it('RN-VEN-13: atraso de 0 a 365; 366 e vazio dão erro, 0 vale', () => {
    for (const v of ['366', '', 'x']) expect(errosDosParametrosPedidos({ ...salvo, atraso: v }).atraso, v).toBe('Informe de 0 a 365 dias.');
    for (const v of ['0', '365']) expect(errosDosParametrosPedidos({ ...salvo, atraso: v }).atraso, v).toBeUndefined();
  });
  it('RN-VEN-18: o corpo do PUT leva só o campo que mudou; com erro Salvar não liga', () => {
    expect(corpoDosParametrosPedidos({ ...salvo, atraso: '0' }, salvo)).toEqual({ titulo_vencido_dias: 0 });
    expect(corpoDosParametrosPedidos({ validade: '15', atraso: '10' }, salvo)).toEqual({ validade_orcamento_dias: 15, titulo_vencido_dias: 10 });
    expect(podeSalvarPedidos({ ...salvo, validade: '120' }, salvo)).toBe(false);
    expect(podeSalvarPedidos({ ...salvo, validade: '30' }, salvo)).toBe(true);
  });
});
