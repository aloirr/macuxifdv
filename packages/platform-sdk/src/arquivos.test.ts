import { describe, expect, it } from 'vitest';
import { caminhoFoto, dimensoesJpeg, ehJpeg, validarNovoArquivo } from './arquivos';

const ID = '0f000000-0000-4000-8000-0000000000aa';

/** JPEG mínimo: SOI, APP0 (16 bytes), SOF0 com 640×480, EOI. Suficiente para a assinatura e as dimensões. */
function jpegDeTeste(largura = 640, altura = 480, extra = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 0xff, largura >> 8, largura & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...new Array<number>(extra).fill(0), 0xff, 0xd9]);
}

describe('ADR 0010: regras puras dos arquivos', () => {
  it('caminho padrão da foto é fotos/<uuid>.jpg (o mesmo da câmera do shell); id inválido é erro', () => {
    expect(caminhoFoto(ID.toUpperCase())).toBe(`fotos/${ID}.jpg`);
    expect(() => caminhoFoto('../x')).toThrow(/UUID/);
  });

  it('assinatura JPEG FF D8 FF; PNG e vazio não passam', () => {
    expect(ehJpeg(jpegDeTeste())).toBe(true);
    expect(ehJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(ehJpeg(new Uint8Array())).toBe(false);
  });

  it('dimensões lidas do SOF (sem decodificar); sem SOF = null', () => {
    expect(dimensoesJpeg(jpegDeTeste(1600, 1200))).toEqual({ largura: 1600, altura: 1200 });
    expect(dimensoesJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(dimensoesJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
  });

  it('validarNovoArquivo: UUIDs, snake_case e tipo aceito', () => {
    expect(validarNovoArquivo({ id: ID, finalidade: 'fachada', entidade: 'visita', entidade_id: ID, cliente_id: null })).toEqual([]);
    const p = validarNovoArquivo({ id: 'x', finalidade: 'Fachada', entidade: 'visita-x', entidade_id: ID, cliente_id: 'y', tipo: 'image/png' as never });
    expect(p).toHaveLength(5);
  });
});
