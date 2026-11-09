import { describe, expect, it } from 'vitest';

import type { AlertaDaVenda } from '../../domain/alertas-venda';
import { alertaDaVendaNoResumo, linhaDaEntregaNoResumo, linhaDaObsNoResumo, linhaDaVendaNoResumo, tabelaDoCredito, TEXTO_SEM_ALERTA, textoDoAlerta, textoDoPrazoMedio } from './textos-venda';

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
  it('RN-VEN-12: crédito em tabela, Limite, Disponível e Prazo médio, na ordem da prancha (T-0141 A)', () => {
    const t = tabelaDoCredito({ tipo: 'dados', limite_cents: 2000000, disponivel_cents: 1790000, alerta: null }, 45);
    expect(t.estado).toBe('tabela');
    expect(t.linhas.map((l) => [l.id, l.rotulo])).toEqual([['limite', 'Limite'], ['disponivel', 'Disponível'], ['prazo', 'Prazo médio']]);
    expect(t.linhas[0]!.valor).toMatch(/^R\$\s20\.000,00$/);
    expect(t.linhas[1]!.valor).toMatch(/^R\$\s17\.900,00$/);
    expect(t.linhas[2]!.valor).toBe('45 dias');
    expect(t.linhas.every((l) => l.tom === undefined)).toBe(true);
    expect(t.apoio).toBeNull();
  });
  it('RN-VEN-12: disponível negativo sai em erro com o sinal − (U+2212)', () => {
    const t = tabelaDoCredito({ tipo: 'dados', limite_cents: 1000000, disponivel_cents: -120000, alerta: null }, 30);
    expect(t.linhas[1]!.valor).toMatch(/^−R\$\s1\.200,00$/);
    expect(t.linhas[1]!.tom).toBe('erro');
  });
  it('RN-VEN-25: sem prazo médio a linha fica com travessão (a forma da tabela não muda)', () => {
    const t = tabelaDoCredito({ tipo: 'dados', limite_cents: 100, disponivel_cents: 100, alerta: null }, null);
    expect(t.linhas).toHaveLength(3);
    expect(t.linhas[2]).toMatchObject({ id: 'prazo', valor: '—' });
  });
  it('RN-VEN-12: cliente sem dados de crédito mostra travessão em Limite e Disponível e a frase de apoio; o prazo continua', () => {
    const t = tabelaDoCredito({ tipo: 'vazio' }, 28);
    expect(t.estado).toBe('tabela');
    expect(t.linhas.map((l) => l.valor)).toEqual(['—', '—', '28 dias']);
    expect(t.apoio).toBe('Sem dados de crédito deste cliente.');
  });
  it('RN-VEN-12: lendo do aparelho (undefined) são barras, nunca R$ 0,00; consulta indisponível (null) some a tabela e orienta', () => {
    expect(tabelaDoCredito(undefined, 45)).toMatchObject({ estado: 'carregando' });
    const i = tabelaDoCredito(null, 45);
    expect(i).toMatchObject({ estado: 'indisponivel', linhas: [], apoio: 'Crédito indisponível agora. Sincronize o aparelho.' });
  });
  it('RN-VEN-25: prazo médio do cliente em dias', () => {
    expect(textoDoPrazoMedio(45)).toBe('45 dias');
    expect(textoDoPrazoMedio(1)).toBe('1 dia');
    expect(textoDoPrazoMedio(null)).toBeNull();
  });
});

describe('linhas do Resumo (RF-VEN-11, T-0137)', () => {
  it('RN-VEN-13: cliente só de orçamento mostra o erro na linha VENDA', () => {
    expect(alertaDaVendaNoResumo({ alertas: [{ tipo: 'bloqueado' }], vencido_aprova: false, alcada: false })).toEqual({ tom: 'erro', texto: 'Cliente bloqueado · só orçamento' });
  });
  it('RN-VEN-10/12/13: "Vai para aprovação" diz o motivo; sem motivo, sem alerta', () => {
    const venc: AlertaDaVenda = { tipo: 'vencido', titulos: 1, valor_cents: 340000, dias: 12 };
    expect(alertaDaVendaNoResumo({ alertas: [venc], vencido_aprova: true, alcada: false })).toEqual({ tom: 'aviso', texto: 'Vai para aprovação (título vencido)' });
    expect(alertaDaVendaNoResumo({ alertas: [{ tipo: 'credito_excedido', disponivel_cents: 0 }], vencido_aprova: false, alcada: true })?.texto).toBe('Vai para aprovação (limite excedido, desconto acima da alçada)');
    expect(alertaDaVendaNoResumo({ alertas: [venc], vencido_aprova: false, alcada: false })).toBeNull();
    expect(alertaDaVendaNoResumo({ alertas: [], vencido_aprova: false, alcada: false })).toBeNull();
  });
  it('RN-VEN-16: entrega com endereço e frete, com a transportadora só no FOB', () => {
    expect(linhaDaEntregaNoResumo({ endereco: 'Rua Pará, 137', modalidade: 'CIF', transportadora: 'Rodonaves' })).toBe('Rua Pará, 137 · CIF');
    expect(linhaDaEntregaNoResumo({ endereco: 'Rua Pará, 137', modalidade: 'FOB', transportadora: 'Rodonaves' })).toBe('Rua Pará, 137 · FOB · Rodonaves');
    expect(linhaDaEntregaNoResumo({ endereco: null, modalidade: 'FOB' })).toBe('Endereço do cadastro · FOB');
  });
  it('RF-VEN-11: venda e observação vazias viram "—"', () => {
    expect(linhaDaVendaNoResumo('Boleto · 28/56 dias')).toBe('Boleto · 28/56 dias');
    expect(linhaDaVendaNoResumo(' ')).toBe('—');
    expect(linhaDaObsNoResumo(undefined)).toBe('—');
    expect(linhaDaObsNoResumo(' entregar de manhã ')).toBe('entregar de manhã');
  });
});
