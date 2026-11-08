import { describe, expect, it } from 'vitest';

import type { AlertaDaVenda } from '../../domain/alertas-venda';
import { fraseDoFrete, linhaDoLimite, TEXTO_SEM_ALERTA, textoDoAlerta, textoDoPrazoMedio } from './textos-venda';

describe('textos da aba Venda (RF-VEN-11, RN-VEN-12, RN-VEN-13)', () => {
  it('RF-VEN-11: sem alerta, uma linha só', () => {
    expect(TEXTO_SEM_ALERTA).toBe('Cliente liberado · sem título vencido');
  });
  it('RN-VEN-13: bloqueado, inativo e cadastro incompleto dizem "só orçamento" e são erro', () => {
    expect(textoDoAlerta({ tipo: 'bloqueado' })).toEqual({ id: 'bloqueado', tom: 'erro', texto: 'Cliente bloqueado · só orçamento', apoio: null });
    expect(textoDoAlerta({ tipo: 'inativo' }).texto).toBe('Cliente inativo · só orçamento');
    expect(textoDoAlerta({ tipo: 'cadastro_incompleto', campos: ['CNPJ', 'telefone'] })).toMatchObject({ tom: 'erro', texto: 'Cadastro incompleto · só orçamento', apoio: 'Falta: CNPJ, telefone' });
    expect(textoDoAlerta({ tipo: 'cadastro_incompleto', campos: [] }).apoio).toBeNull();
  });
  it('RN-VEN-13: título vencido com quantidade, valor e dias, mais a consequência', () => {
    const t = textoDoAlerta({ tipo: 'vencido', titulos: 1, valor_cents: 340000, dias: 12 });
    expect(t.tom).toBe('aviso');
    expect(t.texto).toMatch(/^Cliente inadimplente · 1 título vencido · R\$\s3\.400,00 · 12 dias$/);
    expect(t.apoio).toBe('Só à vista ou com aprovação');
    expect(textoDoAlerta({ tipo: 'vencido', titulos: 3, valor_cents: 100, dias: 1 }).texto).toContain('3 títulos vencidos');
  });
  it('RN-VEN-12: crédito excedido mostra o disponível (nunca negativo) e manda para aprovação', () => {
    const a: AlertaDaVenda = { tipo: 'credito_excedido', disponivel_cents: 400000 };
    expect(textoDoAlerta(a)).toMatchObject({ tom: 'aviso', apoio: 'Vai para aprovação' });
    expect(textoDoAlerta(a).texto).toMatch(/^Limite excedido · disponível R\$\s4\.000,00$/);
    expect(textoDoAlerta({ tipo: 'credito_excedido', disponivel_cents: -50 }).texto).toMatch(/R\$\s0,00$/);
  });
  it('RN-VEN-12: limite total e disponível numa linha; sem dados, nada', () => {
    expect(linhaDoLimite({ tipo: 'dados', limite_cents: 1000000, disponivel_cents: 400000, alerta: null })).toMatch(/^R\$\s10\.000,00 · disponível R\$\s4\.000,00$/);
    expect(linhaDoLimite({ tipo: 'vazio' })).toBeNull();
    expect(linhaDoLimite(null)).toBeNull();
    expect(linhaDoLimite(undefined)).toBeNull();
  });
  it('RN-VEN-25: prazo médio do cliente em dias', () => {
    expect(textoDoPrazoMedio(45)).toBe('45 dias');
    expect(textoDoPrazoMedio(1)).toBe('1 dia');
    expect(textoDoPrazoMedio(null)).toBeNull();
  });
});

describe('frase do frete na aba Entrega (RN-VEN-16)', () => {
  it('RN-VEN-16: CIF e FOB, uma frase só e sem valor de frete', () => {
    expect(fraseDoFrete({ modalidade: 'CIF' })).toBe('CIF: frete incluso no preço');
    expect(fraseDoFrete({ modalidade: 'FOB', transportadora: 'Rodonaves' })).toBe('FOB: transportadora Rodonaves');
    expect(fraseDoFrete({ modalidade: 'FOB', transportadora: '  ' })).toBe('FOB: escolha a transportadora');
    expect(fraseDoFrete({ modalidade: 'FOB' })).not.toMatch(/R\$/);
  });
});
