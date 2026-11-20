/**
 * T-0182 (RD-0708): a conferência da cópia da logo no disco é uma só (`copiaGuardada`). Arquivo de 0 byte vale como ausente nas
 * três leituras: a `lib` baixa de novo, e a tela e o PDF não usam a cópia vazia. Apagar a pasta zera o registro junto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  arquivos: new Map<string, number>(),
  pastaApagada: 0,
  gravados: [] as [string, unknown][],
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/services/storage', () => ({
  readJson: async () => null,
  writeJson: async (k: string, v: unknown) => {
    sim.gravados.push([k, v]);
  },
}));
vi.mock('expo-file-system', () => {
  class Directory {
    caminho: string;
    constructor(...partes: unknown[]) {
      this.caminho = partes.slice(1).join('/');
    }
    get exists() {
      return true;
    }
    delete() {
      sim.pastaApagada++;
    }
  }
  class File {
    caminho: string;
    constructor(pasta: Directory, nome: string) {
      this.caminho = `${pasta.caminho}/${nome}`;
    }
    get exists() {
      return sim.arquivos.has(this.caminho);
    }
    get size() {
      return sim.arquivos.get(this.caminho) ?? 0;
    }
    get uri() {
      return `file:///documentos/${this.caminho}`;
    }
    async base64() {
      return 'AAAA';
    }
  }
  return { Directory, File, Paths: { document: 'documentos' } };
});

import { CHAVE_LOGO_EMPRESA, type LogoGuardada } from '@/lib/logo-empresa';

import { dataUriDaLogoGuardada, portaLogoEmpresa, uriDaLogo } from './logo-empresa';

const SHA = 'a'.repeat(64);
const LOGO: LogoGuardada = {
  tenant_id: 't-a',
  sha256: SHA,
  tipo: 'image/png',
  largura_px: 600,
  altura_px: 240,
  caminho: `empresa/t-a/logo-${SHA}.png`,
};
const porta = portaLogoEmpresa(() => {
  throw new Error('sem rede no teste');
});

beforeEach(() => {
  sim.arquivos.clear();
  sim.pastaApagada = 0;
  sim.gravados.length = 0;
});

describe('cópia da logo no disco', () => {
  it('com bytes: as três leituras veem a cópia', async () => {
    sim.arquivos.set(LOGO.caminho, 1234);
    expect(await porta.existeArquivo(LOGO.caminho)).toBe(true);
    expect(uriDaLogo(LOGO)).toBe(`file:///documentos/${LOGO.caminho}`);
    expect(await dataUriDaLogoGuardada(LOGO)).toBe('data:image/png;base64,AAAA');
  });

  it('arquivo de 0 byte ou sem o arquivo = ausente nas três leituras (a lib baixa de novo)', async () => {
    for (const vazio of [true, false]) {
      sim.arquivos.clear();
      if (vazio) sim.arquivos.set(LOGO.caminho, 0);
      expect(await porta.existeArquivo(LOGO.caminho)).toBe(false);
      expect(uriDaLogo(LOGO)).toBeNull();
      expect(await dataUriDaLogoGuardada(LOGO)).toBeNull();
    }
  });

  it('apagarTudo apaga a pasta e zera o registro, uma vez só', async () => {
    await porta.apagarTudo();
    expect(sim.pastaApagada).toBe(1);
    expect(sim.gravados).toEqual([[CHAVE_LOGO_EMPRESA, null]]);
  });
});
