import { describe, expect, it } from 'vitest';
import {
  AppVersaoPublicadaSchema,
  AppVersaoPublicadaV2Schema,
  CABECALHO_APP,
  CODIGO_APP_DESATUALIZADO,
  ConsultaAppVersaoSchema,
  criarPortaVersaoAppMemoria,
  ErroAppDesatualizadoSchema,
  haVersaoNova,
  lerCabecalhoApp,
  MENSAGEM_APP_DESATUALIZADO,
  PRAZO_ATUALIZACAO_APP_MS,
  rotaAppVersao,
  situacaoDaVersao,
  valorCabecalhoApp,
} from './app-versao';
import { varianteDoPerfil } from './perfis';

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

describe('situacaoDaVersao (RN-CORE-80, T-0195, ADR 0070)', () => {
  const PUB = '2026-11-24T12:00:00.000Z';
  const depois = (ms: number) => new Date(Date.parse(PUB) + ms);
  const H = 3_600_000;
  const MIN = 60_000;
  const base = { atual: '1.0.32', publicada: '1.0.33', publicadaEm: PUB };
  const PRAZO = '2026-11-25T12:00:00.000Z';

  it('prazo de 24 h exatas', () => {
    expect(PRAZO_ATUALIZACAO_APP_MS).toBe(24 * H);
  });

  it.each([
    ['logo depois da publicação', 0, 'aviso'],
    ['23h59', 23 * H + 59 * MIN, 'aviso'],
    ['1 ms antes das 24 h', 24 * H - 1, 'aviso'],
    ['24h00 em ponto', 24 * H, 'bloqueada'],
    ['24h01', 24 * H + MIN, 'bloqueada'],
    ['dias depois', 30 * 24 * H, 'bloqueada'],
  ])('versão menor, %s = %s, com o prazo', (_rotulo, ms, esperado) => {
    expect(situacaoDaVersao({ ...base, agora: depois(ms) })).toEqual({ situacao: esperado, prazoAte: PRAZO });
  });

  it('publicação "no futuro" (relógio do aparelho atrasado) = aviso', () => {
    expect(situacaoDaVersao({ ...base, agora: depois(-2 * H) })).toEqual({ situacao: 'aviso', prazoAte: PRAZO });
  });

  it('fuso com deslocamento conta o mesmo instante', () => {
    expect(situacaoDaVersao({ ...base, publicadaEm: '2026-11-24T08:00:00-04:00', agora: depois(24 * H) }).situacao).toBe('bloqueada');
  });

  it.each([
    ['igual à publicada', '1.0.33', '1.0.33'],
    ['maior que a publicada (build novo antes do manifesto)', '1.0.34', '1.0.33'],
    ['maior pelo número, não pelo texto', '1.0.10', '1.0.9'],
  ])('%s = atual, sem prazo', (_r, atual, publicada) => {
    expect(situacaoDaVersao({ atual, publicada, publicadaEm: PUB, agora: depois(48 * H) })).toEqual({ situacao: 'atual', prazoAte: null });
  });

  it.each([
    ['instalada inválida', 'v1.0.32', '1.0.33'],
    ['publicada inválida', '1.0.32', '1.0.33-rc.1'],
    ['instalada vazia', '', '1.0.33'],
  ])('%s = atual (nunca bloqueia sem versão válida)', (_r, atual, publicada) => {
    expect(situacaoDaVersao({ atual, publicada, publicadaEm: PUB, agora: depois(48 * H) })).toEqual({ situacao: 'atual', prazoAte: null });
  });

  it('nenhuma publicada = atual', () => {
    expect(situacaoDaVersao({ atual: '1.0.32', publicada: null, publicadaEm: null, agora: depois(48 * H) })).toEqual({ situacao: 'atual', prazoAte: null });
  });

  it.each([null, 'ontem', '2026-13-45T00:00:00Z', '2026-11-24'])('hora da publicação desconhecida ou inválida (%s) = aviso sem prazo, nunca bloqueia', (publicadaEm) => {
    expect(situacaoDaVersao({ ...base, publicadaEm, agora: depois(48 * H) })).toEqual({ situacao: 'aviso', prazoAte: null });
  });

  it('relógio inválido = aviso sem prazo', () => {
    expect(situacaoDaVersao({ ...base, agora: new Date(Number.NaN) })).toEqual({ situacao: 'aviso', prazoAte: null });
  });
});

describe('cabeçalho do app (T-0195, ADR 0070 §D2)', () => {
  it('nome e formato <variante>/<X.Y.Z>, ida e volta', () => {
    expect(CABECALHO_APP).toBe('x-macuxi-app');
    expect(valorCabecalhoApp('campo', '1.0.33')).toBe('campo/1.0.33');
    expect(lerCabecalhoApp(valorCabecalhoApp('gestao', '1.2.0'))).toEqual({ variante: 'gestao', versao: '1.2.0' });
    expect(lerCabecalhoApp(' campo/1.0.33 ')).toEqual({ variante: 'campo', versao: '1.0.33' });
  });

  it.each([undefined, '', 'campo', 'web/1.0.0', 'campo/1.0', 'campo/v1.0.33', 'campo/1.0.33-rc.1', 'campo/01.0.0', ['campo/1.0.33', 'campo/1.0.34'], 'campo/1.0.33'.padEnd(40, ' ')])(
    '%j = null (não bloqueia)',
    (valor) => {
      expect(lerCabecalhoApp(valor)).toBeNull();
    },
  );

  it('valorCabecalhoApp recusa versão fora de X.Y.Z', () => {
    expect(() => valorCabecalhoApp('campo', '1.0.33-dev')).toThrow();
  });
});

describe('426 APP_DESATUALIZADO, porta e variante do perfil (T-0195)', () => {
  it('corpo com variante, versão publicada, publicação e prazo; chave a mais recusa', () => {
    const corpo = {
      codigo: CODIGO_APP_DESATUALIZADO,
      mensagem: MENSAGEM_APP_DESATUALIZADO,
      detalhes: { variante: 'campo', versao_publicada: '1.0.33', publicada_em: '2026-11-24T12:00:00.000Z', prazo_ate: '2026-11-25T12:00:00.000Z' },
    };
    expect(ErroAppDesatualizadoSchema.parse(corpo)).toEqual(corpo);
    expect(ErroAppDesatualizadoSchema.safeParse({ ...corpo, detalhes: { ...corpo.detalhes, apk_url: 'https://x' } }).success).toBe(false);
    expect(MENSAGEM_APP_DESATUALIZADO).toBe('Versão desatualizada, reinstale para continuar.');
  });

  it('porta de memória', async () => {
    const p = criarPortaVersaoAppMemoria({ campo: { versao: '1.0.33', publicada_em: null } }, { variante: 'campo', versao: '1.0.32' });
    expect(p.doCliente).toEqual({ variante: 'campo', versao: '1.0.32' });
    expect(await p.publicada('campo')).toEqual({ versao: '1.0.33', publicada_em: null });
    expect(await p.publicada('gestao')).toBeNull();
  });

  it('varianteDoPerfil: vendedor e promotor = campo; supervisor e gerente = gestao; perfis só do BKO = null', () => {
    expect(varianteDoPerfil('vendedor')).toBe('campo');
    expect(varianteDoPerfil('promotor')).toBe('campo');
    expect(varianteDoPerfil('supervisor')).toBe('gestao');
    expect(varianteDoPerfil('gerente')).toBe('gestao');
    expect(varianteDoPerfil('admin')).toBeNull();
    expect(varianteDoPerfil('analista')).toBeNull();
    expect(varianteDoPerfil(null)).toBeNull();
  });
});
