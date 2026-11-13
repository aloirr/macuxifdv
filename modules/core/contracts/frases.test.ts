import { describe, expect, it } from 'vitest';
import { FraseDiaSyncSchema } from './frases';

const id = (n: number) => `0a100000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('RN-CORE-41: contrato da frase do dia', () => {
  it('RN-CORE-41: código padrão P01..P30 (ou nulo nas do tenant)', () => {
    const l = { id: id(1), updated_at: 'x', deleted_at: null, external_id: null, texto: 'Oi', ativa: true, ordem: 1, padrao_codigo: 'P01' };
    expect(FraseDiaSyncSchema.safeParse(l).success).toBe(true);
    expect(FraseDiaSyncSchema.safeParse({ ...l, padrao_codigo: null }).success).toBe(true);
    expect(FraseDiaSyncSchema.safeParse({ ...l, padrao_codigo: 'X1' }).success).toBe(false);
  });
});
