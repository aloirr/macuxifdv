import { describe, expect, it } from 'vitest';
import { AppVersaoPublicadaSchema, haVersaoNova, rotaAppVersao } from './app-versao';

describe('haVersaoNova (item 19, desenho v1017 §2)', () => {
  it.each([
    ['1.0.16', '1.0.17', true],
    ['1.0.9', '1.0.10', true],
    ['1.9.0', '2.0.0', true],
    ['1.0.17', '1.0.17', false],
    ['1.0.17', '1.0.16', false],
    ['2.0.0', '1.99.99', false],
  ])('%s → %s = %s (numérico, não texto)', (atual, publicada, esperado) => {
    expect(haVersaoNova(atual, publicada)).toBe(esperado);
  });

  it.each([
    ['1.0', '1.0.1'],
    ['1.0.16', 'v1.0.17'],
    ['1.0.16', '1.0.17-beta'],
    ['', '1.0.0'],
    ['1.0.16', '01.0.17'],
  ])('inválida (%s, %s) = false', (atual, publicada) => {
    expect(haVersaoNova(atual, publicada)).toBe(false);
  });
});

describe('AppVersaoPublicadaSchema', () => {
  const base = { variante: 'campo', versao: '1.0.17', apk_url: 'https://exemplo.com/campo-1.0.17.apk', publicada_em: null };

  it('aceita https e publicada_em ISO ou null', () => {
    expect(AppVersaoPublicadaSchema.parse(base)).toEqual(base);
    expect(AppVersaoPublicadaSchema.safeParse({ ...base, publicada_em: '2026-11-20T09:50:00.000Z' }).success).toBe(true);
  });

  it('recusa http, versão fora de X.Y.Z, variante desconhecida e chave a mais', () => {
    expect(AppVersaoPublicadaSchema.safeParse({ ...base, apk_url: 'http://exemplo.com/a.apk' }).success).toBe(false);
    expect(AppVersaoPublicadaSchema.safeParse({ ...base, versao: '1.0' }).success).toBe(false);
    expect(AppVersaoPublicadaSchema.safeParse({ ...base, variante: 'web' }).success).toBe(false);
    expect(AppVersaoPublicadaSchema.safeParse({ ...base, tenant_id: 'x' }).success).toBe(false);
  });

  it('rotaAppVersao', () => {
    expect(rotaAppVersao('gestao')).toBe('/v1/app/versao?variante=gestao');
  });
});
