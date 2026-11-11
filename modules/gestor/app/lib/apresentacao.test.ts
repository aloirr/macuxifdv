import { describe, expect, it } from 'vitest';
import { formatBRL } from '@macuxi/comum';
import { STATUS_DIA, TIPOS_ALERTA, MOTIVOS_APROVACAO, INDICADORES_RANKING } from '../../contracts';
import { linhaDeMotivos, fracao, INDICADOR_ROTULO, MOTIVO_ROTULO, nomesDaVisao, rotuloDoPrazo, STATUS_DIA_ROTULO, TIPO_ALERTA_ROTULO, TOM_PARA_CHIP, valorDoIndicador } from './apresentacao';

describe('apresentação das telas do Gestor', () => {
  it('todo status, motivo, tipo de alerta e indicador do contrato tem rótulo em português', () => {
    for (const s of STATUS_DIA) expect(STATUS_DIA_ROTULO[s].label).toBeTruthy();
    for (const m of MOTIVOS_APROVACAO) expect(MOTIVO_ROTULO[m]).toBeTruthy();
    for (const t of TIPOS_ALERTA) expect(TIPO_ALERTA_ROTULO[t]).toBeTruthy();
    for (const i of INDICADORES_RANKING) expect(INDICADOR_ROTULO[i]).toBeTruthy();
  });

  it('RN-GES-03: o prazo vem calculado; a tela só escreve e colore', () => {
    expect(rotuloDoPrazo({ situacao: 'vencido', horas_restantes: -3.4 })).toEqual({ label: 'Vencido há 3 h úteis', tom: 'danger' });
    expect(rotuloDoPrazo({ situacao: 'vencendo', horas_restantes: 1 })).toEqual({ label: 'Vence em 1 h útil', tom: 'warning' });
    expect(rotuloDoPrazo({ situacao: 'no_prazo', horas_restantes: 0.2 })).toEqual({ label: 'No prazo · menos de 1 h útil', tom: 'success' });
  });

  it('RF-GES-03: valor do indicador em centavos, percentual ou contagem; sem dado = traço', () => {
    expect(valorDoIndicador('vendas_cents', 123_456, formatBRL)).toBe(formatBRL(123_456));
    expect(valorDoIndicador('cobertura_pct', 87.5, formatBRL)).toBe('87,5%');
    expect(valorDoIndicador('pedidos', 12, formatBRL)).toBe('12');
    expect(valorDoIndicador('ruptura_pct', null, formatBRL)).toBe('—');
  });

  it('nomes da visão por id e fração legível', () => {
    expect(nomesDaVisao(null).size).toBe(0);
    expect(nomesDaVisao({ membros: [{ membro: { id: 'a', nome: 'Vera' } } as never] }).get('a')).toBe('Vera');
    expect(fracao(3, 5)).toBe('3 de 5');
    expect(fracao(2, 0)).toBe('2');
  });

  it('T-0072: todo tom do Gestor tem um tom de ChipEstado (cor sempre com texto)', () => {
    expect(TOM_PARA_CHIP).toEqual({ success: 'sucesso', warning: 'aviso', danger: 'erro', accent: 'destaque', neutral: 'neutro' });
  });

  it('RN-VEN-10/42: a alçada não aparece em rótulo de motivo e o desconto entra uma vez só', () => {
    for (const m of MOTIVOS_APROVACAO) expect(MOTIVO_ROTULO[m].toLowerCase()).not.toContain('alçada');
    const pct = (n: number) => `${n}%`;
    expect(linhaDeMotivos(['desconto', 'credito'], 8, pct)).toBe('Desconto 8% · Crédito do cliente');
    expect(linhaDeMotivos(['preco_minimo'], 0, pct)).toBe('Acima do desconto máximo');
    // desconto só informação vai depois dos motivos; crédito com saldo aparece uma vez
    expect(linhaDeMotivos(['credito'], 3, pct)).toBe('Crédito do cliente · desconto 3%');
    expect(linhaDeMotivos(['credito'], 0, pct, 'R$ 1.200')).toBe('Crédito disponível R$ 1.200');
    expect(linhaDeMotivos(['desconto', 'credito'], 8, pct, 'R$ 1.200')).toBe('Desconto 8% · Crédito disponível R$ 1.200');
  });
});
