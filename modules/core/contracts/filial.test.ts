import { describe, expect, it } from 'vitest';

import { FilialCriarSchema, FilialEditarSchema } from './filial';

const base = { id: '11111111-1111-4111-8111-111111111111', codigo: '0001', nome: 'Matriz', cidade: 'Manaus' };

describe('RN-CORE-39: UF da filial (2 letras, como no banco)', () => {
  it('RN-CORE-39: aceita 2 letras e normaliza para maiúsculas', () => {
    expect(FilialCriarSchema.parse({ ...base, uf: 'am' }).uf).toBe('AM');
    expect(FilialEditarSchema.parse({ uf: 'rr' }).uf).toBe('RR');
  });
  it('RN-CORE-39: recusa vazia, 3 letras e dígitos', () => {
    for (const uf of ['', 'AMA', 'A1', 'A']) expect(FilialCriarSchema.safeParse({ ...base, uf }).success).toBe(false);
  });
});
