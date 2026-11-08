import { describe, expect, it } from 'vitest';
import { alertasDaVenda, tomDoAlerta, type EntradaAlertasDaVenda } from './alertas-venda';

const livre = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] as string[] };
const base: EntradaAlertasDaVenda = { cliente: livre, vencidos: null, disponivel_cents: 400000, total_cents: 10000 };
const tipos = (e: Partial<EntradaAlertasDaVenda>) => alertasDaVenda({ ...base, ...e }).map((a) => a.tipo);

describe('alertasDaVenda (RF-VEN-11, RN-VEN-12, RN-VEN-13)', () => {
  it('RN-VEN-13: cliente liberado, sem título vencido e com crédito não tem alerta', () => {
    expect(alertasDaVenda(base)).toEqual([]);
  });
  it('RN-VEN-13: bloqueado, inativo e cadastro incompleto são erro (só orçamento)', () => {
    expect(alertasDaVenda({ ...base, cliente: { ...livre, bloqueado: true } })).toEqual([{ tipo: 'bloqueado' }]);
    expect(alertasDaVenda({ ...base, cliente: { ...livre, ativo: false } })).toEqual([{ tipo: 'inativo' }]);
    const [a] = alertasDaVenda({ ...base, cliente: { ...livre, cadastro_incompleto: true, campos_faltantes: ['CNPJ'] } });
    expect(a).toEqual({ tipo: 'cadastro_incompleto', campos: ['CNPJ'] });
    expect(tomDoAlerta(a!)).toBe('erro');
  });
  it('RN-VEN-13: título vencido traz quantidade, valor e dias e é aviso', () => {
    const [a] = alertasDaVenda({ ...base, vencidos: { titulos: 1, valor_cents: 340000, dias: 12 } });
    expect(a).toEqual({ tipo: 'vencido', titulos: 1, valor_cents: 340000, dias: 12 });
    expect(tomDoAlerta(a!)).toBe('aviso');
  });
  it('RN-VEN-13: zero títulos vencidos não gera alerta', () => {
    expect(tipos({ vencidos: { titulos: 0, valor_cents: 0, dias: 0 } })).toEqual([]);
  });
  it('RN-VEN-12: crédito excedido quando o total passa do disponível', () => {
    expect(alertasDaVenda({ ...base, total_cents: 400001 })).toEqual([{ tipo: 'credito_excedido', disponivel_cents: 400000 }]);
    expect(tipos({ total_cents: 400000 })).toEqual([]);
  });
  it('RN-VEN-12: disponível negativo vale como zero e qualquer total excede', () => {
    expect(tipos({ disponivel_cents: -500, total_cents: 1 })).toEqual(['credito_excedido']);
  });
  it('RN-VEN-12: sem dados de crédito não há alerta de crédito', () => {
    expect(tipos({ disponivel_cents: null, total_cents: 99999999 })).toEqual([]);
  });
  it('RF-VEN-11: erro antes de aviso, e na ordem bloqueado, vencido, crédito', () => {
    expect(tipos({ cliente: { ...livre, bloqueado: true }, vencidos: { titulos: 2, valor_cents: 1, dias: 3 }, total_cents: 500000 })).toEqual(['bloqueado', 'vencido', 'credito_excedido']);
    expect(tipos({ cliente: { ...livre, ativo: false }, vencidos: { titulos: 1, valor_cents: 1, dias: 3 } })).toEqual(['inativo', 'vencido']);
  });
});
