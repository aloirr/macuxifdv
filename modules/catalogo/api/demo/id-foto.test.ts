import { describe, expect, it } from 'vitest';
import { idDaFoto } from './id-foto';

describe('carga de fotos da demo (T-0097)', () => {
  it('RF-CAT-03: o id da foto é um UUID estável por produto (a carga repetida não duplica)', () => {
    const p = '11111111-1111-4111-8111-111111111111';
    expect(idDaFoto(p)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idDaFoto(p)).toBe(idDaFoto(p.toUpperCase()));
    expect(idDaFoto(p)).not.toBe(idDaFoto('22222222-2222-4222-8222-222222222222'));
  });
});
