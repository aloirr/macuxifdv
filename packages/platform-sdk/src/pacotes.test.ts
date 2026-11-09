/**
 * T-0098 (ADR 0037): porta dos pacotes publicados (link temporário do Conector). Formato do manifesto `ultimo.json`, chaves
 * fechadas (nada vem do cliente) e os serviços desligado e em memória que os testes de módulo usam.
 */
import { describe, expect, it } from 'vitest';
import { ErroHttpModulo } from './api';
import {
  CODIGO_ARMAZENAMENTO_INDISPONIVEL,
  chaveDoPacote,
  chaveUltimoPacote,
  criarServicoPacotesMemoria,
  PacotePublicadoSchema,
  SERVICO_PACOTES_DESLIGADO,
  VALIDADE_LINK_PACOTE_S,
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

describe('chaves do pacote', () => {
  it('produto da lista fechada e nome sem barra', () => {
    expect(chaveDoPacote('conector', 'c-1.0.0.zip')).toBe('conector/c-1.0.0.zip');
    expect(chaveUltimoPacote('conector')).toBe('conector/ultimo.json');
    expect(() => chaveDoPacote('outro' as ProdutoPacote, 'c.zip')).toThrow();
    expect(() => chaveDoPacote('conector', '../x')).toThrow();
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
});
