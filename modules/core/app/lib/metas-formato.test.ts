import { describe, expect, it } from 'vitest';
import { AGUARDANDO_PEDIDOS, textoDaLinha, textoNecessidadeDiaria } from './metas-formato';

describe('texto das metas (RN-CORE-20..22)', () => {
  it('RN-CORE-20: cobertura em pontos-base vira percentual com vírgula', () => {
    expect(textoDaLinha({ indicador: 'cobertura_pct', meta: 8000, realizado: 6250, atingimento_pct: 7813 })).toMatchObject({ meta: '80,00%', realizado: '62,50%', atingimento: '78,13%' });
  });
  it('T-0170: itens por pedido em centésimos vira média com uma casa', () => {
    expect(textoDaLinha({ indicador: 'itens_por_pedido', meta: 800, realizado: 645, atingimento_pct: 8063 })).toMatchObject({ rotulo: 'Itens por pedido', meta: '8,0', realizado: '6,5' });
  });
  it('RN-CORE-20: realizado ausente mostra "Aguardando pedidos"', () => {
    expect(textoDaLinha({ indicador: 'positivacao', meta: 10, realizado: null, atingimento_pct: null })).toMatchObject({ realizado: AGUARDANDO_PEDIDOS, atingimento: '—' });
  });
  it('RN-CORE-22: necessidade diária nos quatro casos', () => {
    const b = { meta_cents: 1_000_00, necessidade_diaria_cents: 85_72, dias_uteis_restantes: 7, realizado_cents: 400_00 };
    expect(textoNecessidadeDiaria(b)).toContain('por dia útil (7 restantes)');
    expect(textoNecessidadeDiaria({ ...b, necessidade_diaria_cents: 0 })).toBe('Meta de venda batida.');
    expect(textoNecessidadeDiaria({ ...b, dias_uteis_restantes: 0, necessidade_diaria_cents: null })).toBe('Sem dias úteis restantes no mês.');
    expect(textoNecessidadeDiaria({ ...b, meta_cents: null })).toBe('Sem meta de venda definida para o mês.');
    expect(textoNecessidadeDiaria({ ...b, realizado_cents: null })).toBe(AGUARDANDO_PEDIDOS);
  });
});
