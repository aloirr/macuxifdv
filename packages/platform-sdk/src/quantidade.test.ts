import { describe, expect, it } from 'vitest';
import {
  CODIGO_FRACAO_BLOQUEADA,
  CODIGO_FRACAO_INVALIDA,
  FatorDecimalSchema,
  MENSAGEM_FRACAO_BLOQUEADA,
  QUANTIDADE_DECIMAL_MAX,
  QuantidadeDecimalSchema,
} from './quantidade';
import * as raiz from './index';

// RN-VEN-02 v3 (ADR 0076 D2 e D4): quantidade e fator no fio são número JSON com até 4 casas.

describe('QuantidadeDecimalSchema (RN-VEN-02 v3)', () => {
  it.each([[1], [3], [1.25], [0.0001], [1.2345], [QUANTIDADE_DECIMAL_MAX]])('aceita %s', (q) => {
    expect(QuantidadeDecimalSchema.parse(q)).toBe(q);
  });

  it.each([[0], [-1], [-1.25], [Number.NaN], [Infinity], [QUANTIDADE_DECIMAL_MAX + 1], ['1.25']])(
    'recusa %s',
    (q) => {
      expect(QuantidadeDecimalSchema.safeParse(q).success).toBe(false);
    },
  );

  it.each([[0.00005], [1.23456]])('%s: mais de 4 casas, com a mensagem do ADR', (q) => {
    const r = QuantidadeDecimalSchema.safeParse(q);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('quantidade deve ter no máximo 4 casas decimais');
  });

  it('teto = 999.999.999,9999', () => {
    expect(QUANTIDADE_DECIMAL_MAX).toBe(999_999_999.9999);
  });
});

describe('FatorDecimalSchema (RN-VEN-15, ADR 0076 D1)', () => {
  it.each([[1], [12], [12.5], [0.3333], [9999]])('aceita %s', (f) => {
    expect(FatorDecimalSchema.parse(f)).toBe(f);
  });

  it.each([[0], [-12], [9999.0001], [10_000], [Number.NaN]])('recusa %s', (f) => {
    expect(FatorDecimalSchema.safeParse(f).success).toBe(false);
  });

  it('mais de 4 casas, com a mensagem do fator', () => {
    const r = FatorDecimalSchema.safeParse(12.00001);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('fator deve ter no máximo 4 casas decimais');
  });
});

describe('códigos do 422 (ADR 0076 D4 e D6)', () => {
  it('valores fixos e exportados pela raiz', () => {
    expect(CODIGO_FRACAO_BLOQUEADA).toBe('quantidade_fracionaria_bloqueada');
    expect(CODIGO_FRACAO_INVALIDA).toBe('quantidade_fracionaria_invalida');
    expect(MENSAGEM_FRACAO_BLOQUEADA).toBe('Quantidade com casas decimais ainda não liberada. Envie a quantidade inteira ou tente de novo mais tarde.');
    expect(raiz.QuantidadeDecimalSchema).toBe(QuantidadeDecimalSchema);
    expect(raiz.fracaoLiberada).toBeTypeOf('function');
  });
});
