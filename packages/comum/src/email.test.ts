import { describe, expect, it } from 'vitest';
import { ehEmail } from './email';

describe('ehEmail (RD-0020, T-0094)', () => {
  it('aceita o formato mínimo e recusa espaço, dois @, sem domínio e não texto', () => {
    expect(ehEmail('ana@empresa.com.br')).toBe(true);
    expect(ehEmail('a.b+c@x.io')).toBe(true);
    for (const x of ['', 'ana', 'ana@', 'ana@empresa', '@empresa.com', 'ana @empresa.com', 'ana@@empresa.com', ' ana@empresa.com', null, 42]) expect(ehEmail(x), String(x)).toBe(false);
  });
  it('recusa acima de 254 caracteres', () => {
    expect(ehEmail(`${'a'.repeat(250)}@x.io`)).toBe(false);
  });
});
