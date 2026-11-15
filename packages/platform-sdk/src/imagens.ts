/**
 * Tipos de imagem reconhecidos pela ASSINATURA (magic bytes), nunca pela extensão (ADR 0054 §3 e §4; RN-CAT-14).
 * Puro TypeScript: só reconhece o tipo e lê largura e altura do cabeçalho, sem decodificar os pixels. Quem decide o que é
 * aceito é o chamador (a lista do módulo ∩ os decodificadores registrados na API, `apps/api/src/decodificadores.ts`).
 */
import { dimensoesJpeg } from './arquivos';

export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoImagem = (typeof TIPOS_IMAGEM)[number];

/** Extensão do original no armazenamento (`<id>.<ext>`); a miniatura é sempre JPEG (`<id>.m320.jpg`). */
export const EXTENSAO_POR_TIPO: Readonly<Record<TipoImagem, 'jpg' | 'png' | 'webp'>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Bytes do começo do arquivo que bastam para `detectarTipoImagem`. */
export const BYTES_ASSINATURA_IMAGEM = 16;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));

/** Tipo pela assinatura: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WEBP `RIFF....WEBP`. `null` = nenhum dos três. */
export function detectarTipoImagem(cabeca: Uint8Array): TipoImagem | null {
  if (cabeca.length >= 3 && cabeca[0] === 0xff && cabeca[1] === 0xd8 && cabeca[2] === 0xff) return 'image/jpeg';
  if (cabeca.length >= 8 && PNG.every((v, i) => cabeca[i] === v)) return 'image/png';
  if (cabeca.length >= 12 && ascii(cabeca, 0, 4) === 'RIFF' && ascii(cabeca, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

function dimensoesPng(b: Uint8Array): { largura: number; altura: number } | null {
  // assinatura (8) + tamanho (4) + "IHDR" (4) + largura (4) + altura (4)
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  const largura = u32be(b, 16);
  const altura = u32be(b, 20);
  return largura > 0 && altura > 0 && largura <= 0x7fffffff && altura <= 0x7fffffff ? { largura, altura } : null;
}

function dimensoesWebp(b: Uint8Array): { largura: number; altura: number } | null {
  if (b.length < 30) return null;
  const pedaco = ascii(b, 12, 4);
  const d = 20; // dados do 1º pedaço
  if (pedaco === 'VP8 ') {
    // quadro-chave: 3 bytes de cabeçalho, código de início 9D 01 2A, largura e altura de 14 bits (little-endian)
    if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
    const largura = (b[d + 6]! | (b[d + 7]! << 8)) & 0x3fff;
    const altura = (b[d + 8]! | (b[d + 9]! << 8)) & 0x3fff;
    return largura > 0 && altura > 0 ? { largura, altura } : null;
  }
  if (pedaco === 'VP8L') {
    if (b[d] !== 0x2f) return null;
    const v = (b[d + 1]! | (b[d + 2]! << 8) | (b[d + 3]! << 16) | (b[d + 4]! << 24)) >>> 0;
    return { largura: (v & 0x3fff) + 1, altura: ((v >>> 14) & 0x3fff) + 1 };
  }
  if (pedaco === 'VP8X') {
    const largura = (b[d + 4]! | (b[d + 5]! << 8) | (b[d + 6]! << 16)) + 1;
    const altura = (b[d + 7]! | (b[d + 8]! << 8) | (b[d + 9]! << 16)) + 1;
    return { largura, altura };
  }
  return null;
}

/**
 * Largura e altura declaradas no cabeçalho, sem decodificar (o decodificador confere o teto de megapixels ANTES de alocar
 * os pixels: um arquivo pequeno pode declarar 30.000 × 30.000). `null` = cabeçalho ilegível ou de outro tipo.
 */
export function dimensoesImagem(bytes: Uint8Array, tipo: TipoImagem): { largura: number; altura: number } | null {
  if (detectarTipoImagem(bytes) !== tipo) return null;
  if (tipo === 'image/jpeg') return dimensoesJpeg(bytes);
  if (tipo === 'image/png') return dimensoesPng(bytes);
  return dimensoesWebp(bytes);
}
