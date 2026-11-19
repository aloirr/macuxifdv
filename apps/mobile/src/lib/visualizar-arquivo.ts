/**
 * Visualizador de arquivos da ficha (T-0186, RD-2356; P15 e P17): o Core chama a porta `abrirArquivo` com a foto de fachada
 * ou o documento do cliente, e o shell só MOSTRA, no visor de foto comum (RD-0088). Puro, para teste: os formatos do visor e o
 * tipo pelos bytes. Só JPEG e PNG, com os bytes em memória.
 */
import { bytesParaBase64 } from './foto-pdv';

/** Os formatos que o visor abre. */
export const FORMATOS_DO_VISOR: readonly string[] = Object.freeze(['jpg', 'jpeg', 'png']);

/** Formato que o visor abre ("jpg" ou "image/jpeg"). */
export function ehImagem(formato: string | null | undefined): boolean {
  if (typeof formato !== 'string') return false;
  const f = formato.trim().toLowerCase().replace(/^image\//, '');
  return FORMATOS_DO_VISOR.includes(f);
}

/** Sem formato, o visor decide pelos bytes; formato que o visor não abre (PDF de um Core antigo) não abre nada. */
export function semFormato(formato: string | null | undefined): boolean {
  return formato == null || formato.trim() === '';
}

export type TipoDosBytes = 'jpeg' | 'png' | null;

/** Tipo pela assinatura dos bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`); `null` = não abre (PDF inclusive). */
export function tipoDosBytes(b: Uint8Array): TipoDosBytes {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

/** Imagem em memória (`data:` URI), nunca no disco. */
export function uriDaImagem(tipo: 'jpeg' | 'png', b: Uint8Array): string {
  return `data:image/${tipo};base64,${bytesParaBase64(b)}`;
}
