/**
 * Registro dos decodificadores de imagem por assinatura (ADR 0054 §4; R-20261115-074500): tipo → pixels RGBA. Tudo em JS
 * puro, sem binário nativo nem WASM (ADR 0036):
 *   - `image/jpeg`: `jpeg-js` (o mesmo da miniatura da foto do aparelho);
 *   - `image/png` e `image/webp` (com e sem perda, com transparência; animação = 1º quadro): `image-in-browser`.
 * Antes de decodificar, as dimensões do CABEÇALHO (`dimensoesImagem` do SDK) passam pelo teto de `MAX_MEGAPIXELS`: um arquivo
 * pequeno que declara 30.000 × 30.000 é recusado sem alocar os pixels. A transparência é composta sobre branco (a miniatura é
 * JPEG). Quem decide o que é ACEITO é o chamador: a lista do módulo ∩ `tiposDecodificaveis()`.
 */
import { dimensoesImagem, type TipoImagem } from '@macuxi/platform-sdk';
import { ChannelOrder, decodePng, decodeWebP, Format, setDefaultMaxPixels, type MemoryImage } from 'image-in-browser';
import { decodificarJpeg, ErroMiniatura, MAX_MEGAPIXELS, miniaturaDeRgba, orientacaoExif, type ResultadoMiniatura, type Rgba } from './miniatura';

const MAX_PIXELS = MAX_MEGAPIXELS * 1_000_000;
// defesa extra: os decodificadores da biblioteca também param no teto (o cabeçalho já foi conferido aqui)
setDefaultMaxPixels(MAX_PIXELS);

/** RGBA de 8 bits, 1º quadro, transparência composta sobre branco. */
function rgbaDe(img: MemoryImage | undefined): Rgba {
  if (!img || img.width < 1 || img.height < 1) throw new ErroMiniatura('foto ilegível');
  const c = img.convert({ format: Format.uint8, numChannels: 4, skipAnimation: true });
  const bytes = c.getBytes({ order: ChannelOrder.rgba });
  const dados = new Uint8Array(img.width * img.height * 4);
  if (bytes.length < dados.length) throw new ErroMiniatura('foto ilegível');
  for (let i = 0; i < dados.length; i += 4) {
    const a = bytes[i + 3]!;
    for (let k = 0; k < 3; k += 1) dados[i + k] = a === 255 ? bytes[i + k]! : Math.round((bytes[i + k]! * a + 255 * (255 - a)) / 255);
    dados[i + 3] = 255;
  }
  return { largura: img.width, altura: img.height, dados };
}

function comBiblioteca(decodificar: (bytes: Uint8Array) => MemoryImage | undefined): (bytes: Uint8Array) => Rgba {
  return (bytes) => {
    try {
      return rgbaDe(decodificar(bytes));
    } catch (e) {
      if (e instanceof ErroMiniatura) throw e;
      throw new ErroMiniatura(`foto ilegível: ${e instanceof Error ? e.message.slice(0, 120) : 'erro'}`);
    }
  };
}

const DECODIFICADORES: ReadonlyMap<TipoImagem, (bytes: Uint8Array) => Rgba> = new Map<TipoImagem, (bytes: Uint8Array) => Rgba>([
  ['image/jpeg', decodificarJpeg],
  ['image/png', comBiblioteca((data) => decodePng({ data, frameIndex: 0 }))],
  ['image/webp', comBiblioteca((data) => decodeWebP({ data, frameIndex: 0 }))],
]);

/** Tipos com decodificador registrado. */
export function tiposDecodificaveis(): readonly TipoImagem[] {
  return [...DECODIFICADORES.keys()];
}

/** Pixels da imagem. Lança `ErroMiniatura` se o cabeçalho não for do tipo, passar do teto de megapixels ou não decodificar. */
export function decodificarImagem(bytes: Uint8Array, tipo: TipoImagem): Rgba {
  const decodificar = DECODIFICADORES.get(tipo);
  if (!decodificar) throw new ErroMiniatura(`sem decodificador para ${tipo}`);
  const dim = dimensoesImagem(bytes, tipo);
  if (!dim) throw new ErroMiniatura('cabeçalho da foto ilegível');
  if (dim.largura * dim.altura > MAX_PIXELS) throw new ErroMiniatura(`foto acima de ${MAX_MEGAPIXELS} megapixels`);
  const img = decodificar(bytes);
  if (img.largura !== dim.largura || img.altura !== dim.altura) throw new ErroMiniatura('dimensões divergentes do cabeçalho');
  return img;
}

/** Miniatura JPEG (320 px, 30 KB) de JPEG, PNG ou WEBP; a orientação EXIF só vale no JPEG. */
export function miniaturaDeImagem(bytes: Uint8Array, tipo: TipoImagem, op: { lado?: number; bytesMax?: number } = {}): ResultadoMiniatura {
  return miniaturaDeRgba(decodificarImagem(bytes, tipo), tipo === 'image/jpeg' ? orientacaoExif(bytes) : 1, op);
}
