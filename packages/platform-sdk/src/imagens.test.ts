import { describe, expect, it } from 'vitest';
import { detectarTipoImagem, dimensoesImagem, EXTENSAO_POR_TIPO, TIPOS_IMAGEM } from './imagens';

/** Imagens reais de 40×30 (gravadas pelo Pillow): WEBP com perda (`VP8 `), sem perda (`VP8L`), com transparência (`VP8X`) e PNG. */
const b64 = (s: string) => new Uint8Array(atobBytes(s));
function atobBytes(s: string): number[] {
  const t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s.replace(/=+$/, '')) {
    buf = (buf << 6) | t.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}
const WEBP_COM_PERDA = b64(
  'UklGRooAAABXRUJQVlA4IH4AAACwBQCdASooAB4APm0wlUekIqIhKrgIAIANiWMAd+FwBggH6Ae//doHSqgI/mJ0i7t1VPgxh4AA/vDDzXy7HcDmbG/gvicqB38hyofW0uf//q1V8lm//5aq+Szf/9Sz/FSScvfNA4+DgiOL9pscp8LAOMVvMyHvwGkc79AAAAA=',
);
const WEBP_SEM_PERDA = b64('UklGRi4AAABXRUJQVlA4TCIAAAAvJ0AHAA8wHoP8j//5Dx6oadsIKn+0ZdD1u9sj+p/yAeox');
const WEBP_ALFA = b64(
  'UklGRm4AAABXRUJQVlA4WAoAAAAQAAAAJwAAHQAAQUxQSAoAAAABB1DAiAhERP8DVlA4ID4AAABwAwCdASooAB4APm02l0ikIyIhJWgAgA2JZwB2APwAAF8XVTAA/tDK//+YJX5BvIX//7Wh9Wh9Wh/JIAAAAA==',
);
const PNG = b64(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAO0lEQVR4nO3SsQ0AMAgDQZNBzP6bsFWyA5Gg+e+taxxla6OzogJPFtJtj8vZh3k1MDAwMDAwMDAw8HcPHHwERg2o3qgAAAAASUVORK5CYII=',
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x1e, 0x00, 0x28, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

describe('ADR 0058 §4 (RN-CAT-14): tipo da imagem pela assinatura, nunca pela extensão', () => {
  it('reconhece JPEG, PNG e WEBP; GIF, PDF, ZIP e vazio são null', () => {
    expect(detectarTipoImagem(JPEG)).toBe('image/jpeg');
    expect(detectarTipoImagem(PNG)).toBe('image/png');
    for (const w of [WEBP_COM_PERDA, WEBP_SEM_PERDA, WEBP_ALFA]) expect(detectarTipoImagem(w)).toBe('image/webp');
    const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(detectarTipoImagem(enc('GIF89a\x01\x00'))).toBeNull();
    expect(detectarTipoImagem(enc('%PDF-1.7\n'))).toBeNull();
    expect(detectarTipoImagem(enc('PK\x03\x04'))).toBeNull();
    expect(detectarTipoImagem(enc('RIFF\x00\x00\x00\x00WAVE'))).toBeNull();
    expect(detectarTipoImagem(new Uint8Array())).toBeNull();
  });

  it('dimensões pelo cabeçalho: JPEG (SOF), PNG (IHDR), WEBP VP8, VP8L e VP8X', () => {
    expect(dimensoesImagem(JPEG, 'image/jpeg')).toEqual({ largura: 40, altura: 30 });
    expect(dimensoesImagem(PNG, 'image/png')).toEqual({ largura: 40, altura: 30 });
    expect(dimensoesImagem(WEBP_COM_PERDA, 'image/webp')).toEqual({ largura: 40, altura: 30 });
    expect(dimensoesImagem(WEBP_SEM_PERDA, 'image/webp')).toEqual({ largura: 40, altura: 30 });
    expect(dimensoesImagem(WEBP_ALFA, 'image/webp')).toEqual({ largura: 40, altura: 30 });
  });

  it('tipo informado diferente da assinatura ou cabeçalho cortado → null', () => {
    expect(dimensoesImagem(PNG, 'image/jpeg')).toBeNull();
    expect(dimensoesImagem(PNG.subarray(0, 20), 'image/png')).toBeNull();
    expect(dimensoesImagem(WEBP_COM_PERDA.subarray(0, 25), 'image/webp')).toBeNull();
  });

  it('PNG que declara 30.000 × 30.000 em poucos bytes: as dimensões saem do cabeçalho (o decodificador recusa antes de alocar)', () => {
    const grande = new Uint8Array(PNG);
    new DataView(grande.buffer).setUint32(16, 30_000);
    new DataView(grande.buffer).setUint32(20, 30_000);
    expect(dimensoesImagem(grande, 'image/png')).toEqual({ largura: 30_000, altura: 30_000 });
  });

  it('cada tipo tem a extensão do original', () => {
    expect(TIPOS_IMAGEM.map((t) => EXTENSAO_POR_TIPO[t])).toEqual(['jpg', 'png', 'webp']);
  });
});
