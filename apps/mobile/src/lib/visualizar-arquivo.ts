/**
 * Visualizador de arquivos da ficha (T-0186, RD-2356; P15 e P17): o Core chama a porta `abrirArquivo` com a foto de fachada
 * ou o documento do cliente, e o shell só MOSTRA. Puro, para teste: os formatos do visor, o tipo pelos bytes, a rota e os textos.
 * Só imagem (visor de foto comum, RD-0088), com os bytes em memória; o PDF fica para a v1.0.16.
 */
import type { PedidoAbrirArquivo } from '@macuxi/core/app';

import { nomeArquivoFoto } from './foto';
import { bytesParaBase64 } from './foto-pdv';

export const ROTA_VISOR_ARQUIVO = '/arquivo';
/** Os formatos que o visor abre, registrados no Core (`definirFormatosDoVisor`) para a tela esconder a ação do resto. */
export const FORMATOS_DO_VISOR: readonly string[] = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'heic']);
export const MAX_BYTES_ARQUIVO = 20 * 1024 * 1024;
/** O mesmo texto da ficha do Core ("Sem internet" + "Tentar de novo"). */
export const TEXTO_SEM_INTERNET = 'Sem internet';
export const TEXTO_ARQUIVO_INDISPONIVEL = 'Não foi possível abrir o arquivo.';

/** Formato que o visor abre ("jpg" ou "image/jpeg"). */
export function ehImagem(formato: string | null | undefined): boolean {
  if (typeof formato !== 'string') return false;
  const f = formato.trim().toLowerCase().replace(/^image\//, '');
  return FORMATOS_DO_VISOR.includes(f);
}

/** Sem formato, a rota do arquivo decide pelos bytes; formato que o visor não abre (PDF de um Core antigo) não abre nada. */
export function semFormato(formato: string | null | undefined): boolean {
  return formato == null || formato.trim() === '';
}

function um(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Rota do visor do arquivo; lança se o arquivo não for UUID. */
export function rotaDoArquivo(p: PedidoAbrirArquivo): { pathname: typeof ROTA_VISOR_ARQUIVO; params: Record<string, string> } {
  nomeArquivoFoto(p.arquivo_id); // lança se não for UUID
  return { pathname: ROTA_VISOR_ARQUIVO, params: { arquivo: p.arquivo_id.toLowerCase(), titulo: p.titulo, ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) } };
}

/** Lê os parâmetros da rota; `null` = arquivo ausente ou inválido (a tela volta). */
export function pedidoDaRotaArquivo(params: Record<string, string | string[] | undefined>): PedidoAbrirArquivo | null {
  const arquivo = um(params.arquivo);
  if (!arquivo) return null;
  try {
    nomeArquivoFoto(arquivo);
  } catch {
    return null;
  }
  const subtitulo = um(params.subtitulo);
  return { arquivo_id: arquivo.toLowerCase(), titulo: um(params.titulo) ?? '', ...(subtitulo ? { subtitulo } : {}) };
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
