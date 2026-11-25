/**
 * T-0098 (ADR 0037): porta dos pacotes publicados (link temporário do Conector). Formato do manifesto `ultimo.json`, chaves
 * fechadas (nada vem do cliente) e os serviços desligado e em memória que os testes de módulo usam.
 */
import { describe, expect, it } from 'vitest';
import { ErroHttpModulo } from './api';
import { VARIANTES_APP } from './app-versao';
import {
  CODIGO_ARMAZENAMENTO_INDISPONIVEL,
  PRODUTOS_PACOTE,
  chaveDoPacote,
  chaveUltimoPacote,
  criarServicoPacotesMemoria,
  LinkPacoteSchema,
  PacotePublicadoSchema,
  SERVICO_PACOTES_DESLIGADO,
  VALIDADE_LINK_APP_S,
  VALIDADE_LINK_PACOTE_S,
  validadeDoLinkS,
  type ProdutoPacote,
} from './pacotes';

const SHA = 'a'.repeat(64);

describe('PacotePublicadoSchema', () => {
  it('aceita o manifesto completo e o mínimo (versão e arquivo)', () => {
    expect(PacotePublicadoSchema.parse({ versao: '1.3.0', arquivo: 'macuxi-conector-1.3.0-win-x64.zip', tamanho_bytes: 12_345, sha256: SHA, publicado_em: '2026-11-09T12:00:00Z' })).toMatchObject({ versao: '1.3.0' });
    expect(PacotePublicadoSchema.parse({ versao: '1.3.0-rc.1', arquivo: 'c.zip' })).toEqual({ versao: '1.3.0-rc.1', arquivo: 'c.zip' });
  });

  it.each([
    [{ versao: '1.3', arquivo: 'c.zip' }],
    [{ versao: '1.3.0', arquivo: '../c.zip' }],
    [{ versao: '1.3.0', arquivo: 'pasta/c.zip' }],
    [{ versao: '1.3.0', arquivo: 'c c.zip' }],
    [{ versao: '1.3.0', arquivo: 'ultimo.json' }],
    [{ versao: '1.3.0', arquivo: 'c.zip', sha256: 'A'.repeat(64) }],
    [{ versao: '1.3.0', arquivo: 'c.zip', tamanho_bytes: 0 }],
  ])('recusa manifesto fora do formato %#', (m) => {
    expect(PacotePublicadoSchema.safeParse(m).success).toBe(false);
  });
});

describe('LinkPacoteSchema', () => {
  it('é o link que a rota devolve: tira publicado_em e campos a mais, exige url e expira_em', async () => {
    const servico = criarServicoPacotesMemoria({ conector: { versao: '1.3.0', arquivo: 'c.zip', sha256: SHA, publicado_em: '2026-11-09T12:00:00Z' } });
    const link = await servico.linkDoUltimo('conector');
    const r = LinkPacoteSchema.parse({ ...link, extra: 1 });
    expect(Object.keys(r).sort()).toEqual(['arquivo', 'expira_em', 'sha256', 'url', 'versao']);
    expect(LinkPacoteSchema.safeParse({ versao: '1.3.0', arquivo: 'c.zip' }).success).toBe(false);
  });
});

describe('chaves do pacote', () => {
  it('produto da lista fechada e nome sem barra', () => {
    expect(chaveDoPacote('conector', 'c-1.0.0.zip')).toBe('conector/c-1.0.0.zip');
    expect(chaveUltimoPacote('conector')).toBe('conector/ultimo.json');
    expect(() => chaveDoPacote('outro' as ProdutoPacote, 'c.zip')).toThrow();
    expect(() => chaveDoPacote('conector', '../x')).toThrow();
  });

  it('T-0190 (RN-CORE-67): os APKs do Campo e do Gestão são produtos de pacote, um por variante do app', () => {
    expect(PRODUTOS_PACOTE).toEqual(['conector', ...VARIANTES_APP]);
    expect(chaveDoPacote('campo', 'macuxi-campo-1.0.19.apk')).toBe('campo/macuxi-campo-1.0.19.apk');
    expect(chaveUltimoPacote('gestao')).toBe('gestao/ultimo.json');
  });
});

describe('serviços', () => {
  it('desligado: indisponível e 503 ARMAZENAMENTO_INDISPONIVEL (falha fechada)', async () => {
    expect(SERVICO_PACOTES_DESLIGADO.disponivel()).toBe(false);
    const e = await SERVICO_PACOTES_DESLIGADO.linkDoUltimo('conector').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroHttpModulo);
    expect(e).toMatchObject({ status: 503, codigo: CODIGO_ARMAZENAMENTO_INDISPONIVEL });
  });

  it('memória: null sem pacote; com pacote, link com validade a partir do relógio', async () => {
    const agora = new Date('2026-11-09T12:00:00Z');
    expect(await criarServicoPacotesMemoria({}).linkDoUltimo('conector')).toBeNull();
    const s = criarServicoPacotesMemoria({ conector: { versao: '1.3.0', arquivo: 'c.zip', tamanho_bytes: 10 } }, { agora: () => agora });
    const l = await s.linkDoUltimo('conector');
    expect(l).toMatchObject({ versao: '1.3.0', arquivo: 'c.zip', tamanho_bytes: 10 });
    expect(l?.expira_em).toBe(new Date(agora.getTime() + VALIDADE_LINK_PACOTE_S.padrao * 1000).toISOString());
    expect(l?.url.startsWith('https://pacotes.teste/conector/c.zip?')).toBe(true);
  });

  it('ADR 0074 (R-20261124-090942, item 04): link do Campo e do Gestão vale 24 h; o do Conector, a validade configurada', async () => {
    expect(VALIDADE_LINK_APP_S).toBe(24 * 60 * 60);
    expect(validadeDoLinkS('conector', 600)).toBe(600);
    expect(validadeDoLinkS('campo', 600)).toBe(VALIDADE_LINK_APP_S);
    expect(validadeDoLinkS('gestao', 600)).toBe(VALIDADE_LINK_APP_S);
    const agora = new Date('2026-11-24T12:00:00Z');
    const s = criarServicoPacotesMemoria(
      { conector: { versao: '1.3.0', arquivo: 'c.zip' }, campo: { versao: '1.0.34', arquivo: 'campo.apk' }, gestao: { versao: '1.0.34', arquivo: 'gestao.apk' } },
      { agora: () => agora, validadeS: 600 },
    );
    expect((await s.linkDoUltimo('conector'))?.expira_em).toBe('2026-11-24T12:10:00.000Z');
    expect((await s.linkDoUltimo('campo'))?.expira_em).toBe('2026-11-25T12:00:00.000Z');
    expect((await s.linkDoUltimo('gestao'))?.expira_em).toBe('2026-11-25T12:00:00.000Z');
  });

  it('T-0195 (ADR 0070): manifestoDoUltimo devolve o manifesto sem link; desligado = 503', async () => {
    const s = criarServicoPacotesMemoria({ campo: { versao: '1.0.33', arquivo: 'campo.apk', publicado_em: '2026-11-24T12:00:00.000Z' } });
    expect(await s.manifestoDoUltimo?.('campo')).toEqual({ versao: '1.0.33', arquivo: 'campo.apk', publicado_em: '2026-11-24T12:00:00.000Z' });
    expect(await s.manifestoDoUltimo?.('gestao')).toBeNull();
    await expect(SERVICO_PACOTES_DESLIGADO.manifestoDoUltimo?.('campo')).rejects.toMatchObject({ status: 503 });
  });
});
