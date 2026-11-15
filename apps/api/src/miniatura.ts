/**
 * T-0097 b: versão reduzida da foto (miniatura de lista e busca do Catálogo), gerada na API na PRIMEIRA LEITURA de
 * `GET /v1/arquivos/:id/miniatura` e guardada no mesmo armazenamento, ao lado do original (`<id>.m320.jpg`). Assim vale
 * também para as fotos que já estavam lá, e o upload continua rápido.
 *
 * - Maior lado até `LADO_MINIATURA_ARQUIVO_PX` (320), nunca amplia; redução por média de área (caixa), boa para fator > 2.
 * - Respeita a orientação EXIF (a câmera grava em pé com a tag 6/8): a miniatura sai já girada, sem EXIF.
 * - Teto de `BYTES_MAX_MINIATURA_ARQUIVO` (30 KB): baixa a qualidade (80 → 30) e, se preciso, o lado (×0,8) até caber.
 * - Decodificação com limite de resolução e memória (`jpeg-js`, JS puro, sem binário nativo: ver ADR 0036).
 */
import { BYTES_MAX_MINIATURA_ARQUIVO, LADO_MINIATURA_ARQUIVO_PX } from '@macuxi/platform-sdk';
import { decode, encode } from 'jpeg-js';

/** Resolução máxima decodificada (o app manda 1600 px; câmera crua de 48 MP é recusada). Vale para JPEG, PNG e WEBP. */
export const MAX_MEGAPIXELS = 30;
const MAX_MEMORIA_MB = 256;
const QUALIDADES = [80, 70, 60, 50, 40, 30] as const;
const LADO_MINIMO = 64;

export class ErroMiniatura extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroMiniatura';
  }
}

/** Chave da miniatura no armazenamento: `<...>/<id>.jpg|.png|.webp` → `<...>/<id>.m320.jpg` (a miniatura é sempre JPEG). */
export function chaveDaMiniatura(chaveOriginal: string): string {
  const m = /^(.*\/[0-9a-f-]{36})\.(jpg|png|webp)$/.exec(chaveOriginal);
  if (!m) throw new Error('chave de arquivo inválida');
  return `${m[1]}.m320.jpg`;
}

/** Orientação EXIF (1 a 8) do JPEG; 1 quando não há EXIF ou a tag é ilegível. */
export function orientacaoExif(bytes: Uint8Array): number {
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marcador = bytes[i + 1]!;
    if (marcador === 0xda || marcador === 0xd9) break; // início dos dados ou fim
    const tamanho = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (tamanho < 2) break;
    const ini = i + 4;
    if (marcador === 0xe1 && ini + 6 <= bytes.length && String.fromCharCode(...bytes.subarray(ini, ini + 4)) === 'Exif') {
      const tiff = ini + 6;
      const le = bytes[tiff] === 0x49; // 'II' little-endian, 'MM' big-endian
      const u16 = (p: number) => (p + 2 > bytes.length ? -1 : le ? bytes[p]! | (bytes[p + 1]! << 8) : (bytes[p]! << 8) | bytes[p + 1]!);
      const u32 = (p: number) =>
        p + 4 > bytes.length ? -1 : le ? (bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16) | (bytes[p + 3]! << 24)) >>> 0 : ((bytes[p]! << 24) | (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!) >>> 0;
      const ifd = tiff + u32(tiff + 4);
      const n = u16(ifd);
      for (let k = 0; k < n && k < 512; k += 1) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i = ini + tamanho - 2;
  }
  return 1;
}

export interface Rgba {
  largura: number;
  altura: number;
  dados: Uint8Array;
}

/** Redução por média de área: cada pixel de destino é a média dos pixels de origem que caem nele. */
function reduzir(o: Rgba, largura: number, altura: number): Rgba {
  const soma = new Float64Array(largura * altura * 3);
  const conta = new Uint32Array(largura * altura);
  for (let y = 0; y < o.altura; y += 1) {
    const ty = Math.min(altura - 1, Math.floor((y * altura) / o.altura));
    for (let x = 0; x < o.largura; x += 1) {
      const tx = Math.min(largura - 1, Math.floor((x * largura) / o.largura));
      const s = (y * o.largura + x) * 4;
      const d = ty * largura + tx;
      soma[d * 3] = soma[d * 3]! + o.dados[s]!;
      soma[d * 3 + 1] = soma[d * 3 + 1]! + o.dados[s + 1]!;
      soma[d * 3 + 2] = soma[d * 3 + 2]! + o.dados[s + 2]!;
      conta[d] = conta[d]! + 1;
    }
  }
  const dados = new Uint8Array(largura * altura * 4);
  for (let d = 0; d < largura * altura; d += 1) {
    const c = conta[d] || 1;
    dados[d * 4] = Math.round(soma[d * 3]! / c);
    dados[d * 4 + 1] = Math.round(soma[d * 3 + 1]! / c);
    dados[d * 4 + 2] = Math.round(soma[d * 3 + 2]! / c);
    dados[d * 4 + 3] = 255;
  }
  return { largura, altura, dados };
}

/** Aplica a orientação EXIF (2 a 8) aos pixels: o resultado é a foto como deve ser vista. */
function orientar(o: Rgba, orientacao: number): Rgba {
  if (orientacao <= 1 || orientacao > 8) return o;
  const troca = orientacao >= 5; // 5 a 8 giram 90°: largura e altura trocam
  const largura = troca ? o.altura : o.largura;
  const altura = troca ? o.largura : o.altura;
  const dados = new Uint8Array(largura * altura * 4);
  for (let y = 0; y < o.altura; y += 1) {
    for (let x = 0; x < o.largura; x += 1) {
      let dx: number;
      let dy: number;
      switch (orientacao) {
        case 2: dx = o.largura - 1 - x; dy = y; break;
        case 3: dx = o.largura - 1 - x; dy = o.altura - 1 - y; break;
        case 4: dx = x; dy = o.altura - 1 - y; break;
        case 5: dx = y; dy = x; break;
        case 6: dx = o.altura - 1 - y; dy = x; break;
        case 7: dx = o.altura - 1 - y; dy = o.largura - 1 - x; break;
        default: dx = y; dy = o.largura - 1 - x; break; // 8
      }
      const s = (y * o.largura + x) * 4;
      const d = (dy * largura + dx) * 4;
      dados[d] = o.dados[s]!;
      dados[d + 1] = o.dados[s + 1]!;
      dados[d + 2] = o.dados[s + 2]!;
      dados[d + 3] = 255;
    }
  }
  return { largura, altura, dados };
}

/** Tamanho que cabe em `lado` x `lado` mantendo a proporção, sem ampliar. */
export function tamanhoReduzido(largura: number, altura: number, lado: number): { largura: number; altura: number } {
  const f = Math.min(1, lado / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * f)), altura: Math.max(1, Math.round(altura * f)) };
}

export interface ResultadoMiniatura {
  bytes: Uint8Array;
  largura: number;
  altura: number;
  qualidade: number;
}

/** Pixels RGBA do JPEG, com os tetos de resolução e memória. Lança `ErroMiniatura` se não decodificar. */
export function decodificarJpeg(original: Uint8Array): Rgba {
  try {
    const d = decode(original, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS, maxMemoryUsageInMB: MAX_MEMORIA_MB });
    return { largura: d.width, altura: d.height, dados: d.data };
  } catch (e) {
    throw new ErroMiniatura(`foto ilegível para a miniatura: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Gera a miniatura (JPEG) da foto JPEG. Lança `ErroMiniatura` se o original não for um JPEG decodificável dentro dos
 * limites ou se nem com o lado mínimo couber no teto (não acontece com foto real). PNG e WEBP: `miniaturaDeImagem`.
 */
export function gerarMiniatura(
  original: Uint8Array,
  op: { lado?: number; bytesMax?: number } = {},
): ResultadoMiniatura {
  return miniaturaDeRgba(decodificarJpeg(original), orientacaoExif(original), op);
}

/** Reduz, aplica a orientação EXIF (1 = nenhuma) e codifica em JPEG até caber no teto de bytes. */
export function miniaturaDeRgba(img: Rgba, orientacao: number, op: { lado?: number; bytesMax?: number } = {}): ResultadoMiniatura {
  const ladoMax = op.lado ?? LADO_MINIATURA_ARQUIVO_PX;
  const bytesMax = op.bytesMax ?? BYTES_MAX_MINIATURA_ARQUIVO;
  // a orientação troca largura e altura (5 a 8): o lado máximo vale para a foto já girada, que tem o mesmo maior lado
  for (let lado = ladoMax; lado >= LADO_MINIMO; lado = Math.floor(lado * 0.8)) {
    const t = tamanhoReduzido(img.largura, img.altura, lado);
    const pequena = orientar(t.largura === img.largura && t.altura === img.altura ? img : reduzir(img, t.largura, t.altura), orientacao);
    for (const q of QUALIDADES) {
      const bytes = new Uint8Array(encode({ width: pequena.largura, height: pequena.altura, data: pequena.dados }, q).data);
      if (bytes.length <= bytesMax) return { bytes, largura: pequena.largura, altura: pequena.altura, qualidade: q };
    }
  }
  throw new ErroMiniatura('miniatura não coube no teto de bytes');
}
