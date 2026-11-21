import { describe, expect, it } from 'vitest';
import { AppVersaoPublicadaSchema, AppVersaoPublicadaV2Schema, ConsultaAppVersaoSchema, haVersaoNova, rotaAppVersao } from './app-versao';

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

  it('rotaAppVersao pede o contrato V2 (T-0190); sem contrato = antigo; outro contrato = inválido', () => {
    expect(rotaAppVersao('gestao')).toBe('/v1/app/versao?variante=gestao&contrato=2');
    expect(ConsultaAppVersaoSchema.parse({ variante: 'campo' })).toEqual({ variante: 'campo' });
    expect(ConsultaAppVersaoSchema.parse({ variante: 'campo', contrato: '2' })).toEqual({ variante: 'campo', contrato: '2' });
    expect(ConsultaAppVersaoSchema.safeParse({ variante: 'campo', contrato: '3' }).success).toBe(false);
  });
});

describe('AppVersaoPublicadaV2Schema (T-0190, RN-CORE-67: o APK só sai por link temporário do portal)', () => {
  const base = { variante: 'gestao', versao: '1.0.19', publicada_em: '2026-11-21T12:00:00.000Z' };

  it('sem apk_url: é o que a API responde a partir da v1.0.19', () => {
    expect(AppVersaoPublicadaV2Schema.parse(base)).toEqual(base);
    expect(AppVersaoPublicadaV2Schema.parse({ ...base, publicada_em: null })).toEqual({ ...base, publicada_em: null });
  });

  it('aceita apk_url https de servidor antigo (quem lê não quebra), recusa http e chave a mais', () => {
    expect(AppVersaoPublicadaV2Schema.safeParse({ ...base, apk_url: 'https://exemplo.com/g.apk' }).success).toBe(true);
    expect(AppVersaoPublicadaV2Schema.safeParse({ ...base, apk_url: 'http://exemplo.com/g.apk' }).success).toBe(false);
    expect(AppVersaoPublicadaV2Schema.safeParse({ ...base, url: 'https://exemplo.com/g.apk' }).success).toBe(false);
    expect(AppVersaoPublicadaV2Schema.safeParse({ ...base, versao: '1.0.19-rc.1' }).success).toBe(false);
  });

  it('o contrato antigo (apk_url obrigatório) recusa a resposta V2: por isso os apps v1.0.17 e v1.0.18 continuam no antigo', () => {
    expect(AppVersaoPublicadaSchema.safeParse(base).success).toBe(false);
  });
});
