/**
 * Visualizador de arquivos da ficha (T-0186, RD-2356; P15 e P17): o Core chama a porta `abrirArquivo` com a foto de fachada
 * ou o documento do cliente, e o shell só MOSTRA, no visor de foto comum (RD-0088). Puro, para teste: o tipo pelos bytes e a
 * imagem em memória.
 */
import { bytesParaBase64 } from './foto-pdv';

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
