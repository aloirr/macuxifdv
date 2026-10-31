import { describe, expect, it } from 'vitest';
import { caminhoFoto } from '@macuxi/platform-sdk';
import { caminhoLocalValido, nomeArquivoFoto, PASTA_FOTOS, redimensionamento } from './foto';

describe('foto da fachada (RN-CORE-14; tamanho da RN-PES-06)', () => {
  it('reduz o maior lado para 1600 px mantendo a proporção', () => {
    expect(redimensionamento(4000, 3000)).toEqual({ width: 1600 });
    expect(redimensionamento(3000, 4000)).toEqual({ height: 1600 });
    expect(redimensionamento(3000, 3000)).toEqual({ width: 1600 });
  });

  it('não mexe em foto que já cabe ou sem dimensão conhecida', () => {
    expect(redimensionamento(1600, 1200)).toBeNull();
    expect(redimensionamento(800, 600)).toBeNull();
    expect(redimensionamento(0, 0)).toBeNull();
  });

  it('o arquivo local é <uuid>.jpg; id fora do formato é recusado (sem caminho arbitrário)', () => {
    expect(nomeArquivoFoto('0E000000-0000-4000-8000-000000000001')).toBe('0e000000-0000-4000-8000-000000000001.jpg');
    expect(() => nomeArquivoFoto('../x')).toThrow();
  });

  it('ADR 0010: o caminho da fila de arquivos (platform-sdk) é o mesmo onde a câmera grava; caminho arbitrário é recusado', () => {
    const id = '0e000000-0000-4000-8000-000000000001';
    expect(caminhoFoto(id)).toBe(`${PASTA_FOTOS}/${nomeArquivoFoto(id)}`);
    expect(caminhoLocalValido(caminhoFoto(id))).toBe(true);
    for (const ruim of ['../x.jpg', '/fotos/x.jpg', 'fotos/../x.jpg', 'fotos\\a.jpg', 'fotos/x.png', ''])
      expect(caminhoLocalValido(ruim)).toBe(false);
  });
});
