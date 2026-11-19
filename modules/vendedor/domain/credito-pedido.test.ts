import { describe, expect, it } from 'vitest';
import { disponivelParaAlerta, exigeAprovacaoPorCredito, exigeAprovacaoPorInadimplencia, motivosFinanceirosDoPedido } from './credito-pedido';

const base = { prazo_medio_dias: 28, total_cents: 10_000, limite_informado: true, disponivel_cents: 10_000 };

describe('RN-VEN-12: crédito estourado manda o pedido para aprovação (T-0184, P-6)', () => {
  it('RN-VEN-12: crédito disponível um centavo abaixo do total vai para aprovação', () => {
    expect(exigeAprovacaoPorCredito({ ...base, disponivel_cents: 9_999 })).toBe(true);
  });
  it('RN-VEN-12: crédito disponível igual ao total não vai', () => {
    expect(exigeAprovacaoPorCredito(base)).toBe(false);
    expect(exigeAprovacaoPorCredito({ ...base, disponivel_cents: 10_001 })).toBe(false);
  });
  it('RN-VEN-12: pedido à vista (prazo médio 0) nunca vai por crédito, nem sem limite', () => {
    expect(exigeAprovacaoPorCredito({ ...base, prazo_medio_dias: 0, disponivel_cents: 0 })).toBe(false);
    expect(exigeAprovacaoPorCredito({ ...base, prazo_medio_dias: 0, limite_informado: false })).toBe(false);
  });
  it('RN-VEN-12 (P4 A): cliente sem limite informado pelo ERP, a prazo, vai para aprovação com o motivo crédito', () => {
    expect(exigeAprovacaoPorCredito({ ...base, limite_informado: false, disponivel_cents: 0 })).toBe(true);
  });
  it('RN-VEN-12: disponível negativo e total zero não geram falso positivo além da regra', () => {
    expect(exigeAprovacaoPorCredito({ ...base, disponivel_cents: -500 })).toBe(true);
    expect(exigeAprovacaoPorCredito({ ...base, total_cents: 0, disponivel_cents: 0 })).toBe(false);
  });
});

describe('RN-VEN-13: inadimplência manda para aprovação, também à vista (P1 A)', () => {
  it('RN-VEN-13: atraso acima do limite vai; no limite ou abaixo não', () => {
    expect(exigeAprovacaoPorInadimplencia({ maior_atraso_dias: 6, limite_dias: 5 })).toBe(true);
    expect(exigeAprovacaoPorInadimplencia({ maior_atraso_dias: 5, limite_dias: 5 })).toBe(false);
    expect(exigeAprovacaoPorInadimplencia({ maior_atraso_dias: 0, limite_dias: 5 })).toBe(false);
  });
  it('RN-VEN-13 (P1 A): inadimplente com pedido à vista também vai (o prazo não entra na conta)', () => {
    expect(motivosFinanceirosDoPedido({ ...base, prazo_medio_dias: 0, maior_atraso_dias: 12, limite_dias: 5 })).toEqual(['inadimplencia']);
  });
});

describe('RN-VEN-12 e RN-VEN-13: motivos separados, um por aprovação (P3 B)', () => {
  it('RN-VEN-13: crédito e inadimplência juntos geram os dois motivos, crédito primeiro', () => {
    expect(motivosFinanceirosDoPedido({ ...base, disponivel_cents: 0, maior_atraso_dias: 12, limite_dias: 5 })).toEqual(['credito', 'inadimplencia']);
  });
  it('RN-VEN-12: tudo em ordem = nenhum motivo', () => {
    expect(motivosFinanceirosDoPedido({ ...base, maior_atraso_dias: 0, limite_dias: 5 })).toEqual([]);
  });
});

describe('RN-VEN-12: o aviso offline não bloqueia o envio', () => {
  it('RN-VEN-12: à vista não mostra o aviso de crédito; a prazo sem limite mostra com disponível zero', () => {
    expect(disponivelParaAlerta({ prazo_medio_dias: 0, limite_informado: true, disponivel_cents: 0 })).toBeNull();
    expect(disponivelParaAlerta({ prazo_medio_dias: 28, limite_informado: false, disponivel_cents: 5_000 })).toBe(0);
    expect(disponivelParaAlerta({ prazo_medio_dias: 28, limite_informado: true, disponivel_cents: 5_000 })).toBe(5_000);
    expect(disponivelParaAlerta({ prazo_medio_dias: undefined, limite_informado: true, disponivel_cents: 5_000 })).toBe(5_000);
  });
});
