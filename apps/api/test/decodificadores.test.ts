/**
 * ADR 0058 §4 (RN-CAT-14, R-20261115-074500): decodificadores por assinatura em JS puro — JPEG (`jpeg-js`), PNG e WEBP
 * (`image-in-browser`) — e a miniatura JPEG de qualquer um deles. Teto de 30 MP conferido pelo cabeçalho antes de alocar.
 */
import { BYTES_MAX_MINIATURA_ARQUIVO, detectarTipoImagem } from '@macuxi/platform-sdk';
import { decode, encode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { decodificarImagem, miniaturaDeImagem, tiposDecodificaveis } from '../src/decodificadores';
import { ErroMiniatura } from '../src/miniatura';
import { IMAGENS_TESTE } from './imagens-teste';

/** JPEG real (sem EXIF) com `largura`×`altura` em vermelho. */
function jpeg(largura: number, altura: number): Uint8Array {
  const dados = Buffer.alloc(largura * altura * 4);
  for (let i = 0; i < dados.length; i += 4) dados.set([200, 30, 30, 255], i);
  return new Uint8Array(encode({ width: largura, height: altura, data: dados }, 80).data);
}

describe('decodificadores registrados por assinatura (ADR 0058 §4)', () => {
  it('JPEG, PNG e WEBP têm decodificador; nada além', () => {
    expect([...tiposDecodificaveis()].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it.each([
    ['JPEG', () => jpeg(40, 30), 'image/jpeg'],
    ['PNG', () => IMAGENS_TESTE.png, 'image/png'],
    ['PNG com transparência', () => IMAGENS_TESTE.pngAlfa, 'image/png'],
    ['WEBP com perda (VP8)', () => IMAGENS_TESTE.webpComPerda, 'image/webp'],
    ['WEBP sem perda (VP8L)', () => IMAGENS_TESTE.webpSemPerda, 'image/webp'],
    ['WEBP com transparência (VP8X)', () => IMAGENS_TESTE.webpAlfa, 'image/webp'],
  ] as const)('%s decodifica em RGBA 40×30', (_n, bytes, tipo) => {
    const b = bytes();
    expect(detectarTipoImagem(b)).toBe(tipo);
    const img = decodificarImagem(b, tipo);
    expect(img).toMatchObject({ largura: 40, altura: 30 });
    expect(img.dados.length).toBe(40 * 30 * 4);
    for (let i = 3; i < img.dados.length; i += 4) expect(img.dados[i]).toBe(255); // transparência já composta
  });

  it('PNG opaco: o pixel (0,0) é o vermelho da imagem; com transparência 50% sobre branco, o verde clareia', () => {
    const opaco = decodificarImagem(IMAGENS_TESTE.png, 'image/png');
    expect([...opaco.dados.subarray(0, 3)]).toEqual([200, 30, 30]);
    const alfa = decodificarImagem(IMAGENS_TESTE.pngAlfa, 'image/png');
    // (0, 200, 30) com alfa 128 sobre branco ≈ (127, 227, 142)
    expect(alfa.dados[0]).toBeGreaterThan(120);
    expect(alfa.dados[1]).toBeGreaterThan(220);
  });

  it('tipo que não bate com a assinatura, corpo truncado ou lixo → ErroMiniatura (vira foto_ilegivel)', () => {
    expect(() => decodificarImagem(IMAGENS_TESTE.png, 'image/webp')).toThrow(ErroMiniatura);
    expect(() => decodificarImagem(IMAGENS_TESTE.webpComPerda.subarray(0, 40), 'image/webp')).toThrow(ErroMiniatura);
    expect(() => decodificarImagem(IMAGENS_TESTE.png.subarray(0, 40), 'image/png')).toThrow(ErroMiniatura);
    expect(() => decodificarImagem(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0]), 'image/jpeg')).toThrow(ErroMiniatura);
  });

  it('PNG que declara 30.000 × 30.000 (900 MP) é recusado pelo cabeçalho, sem alocar', () => {
    const grande = new Uint8Array(IMAGENS_TESTE.png);
    new DataView(grande.buffer).setUint32(16, 30_000);
    new DataView(grande.buffer).setUint32(20, 30_000);
    expect(() => decodificarImagem(grande, 'image/png')).toThrow(/megapixels/);
  });

  it.each([
    ['image/png', () => IMAGENS_TESTE.png],
    ['image/webp', () => IMAGENS_TESTE.webpAlfa],
    ['image/jpeg', () => jpeg(1600, 1200)],
  ] as const)('miniatura de %s sai JPEG, maior lado ≤ 320 e ≤ 30 KB', (tipo, bytes) => {
    const m = miniaturaDeImagem(bytes(), tipo);
    expect(detectarTipoImagem(m.bytes)).toBe('image/jpeg');
    expect(Math.max(m.largura, m.altura)).toBeLessThanOrEqual(320);
    expect(m.bytes.length).toBeLessThanOrEqual(BYTES_MAX_MINIATURA_ARQUIVO);
    const d = decode(m.bytes);
    expect([d.width, d.height]).toEqual([m.largura, m.altura]);
  });
});
