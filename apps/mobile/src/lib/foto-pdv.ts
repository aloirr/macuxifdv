/**
 * Visualizador da foto do PDV no shell (T-0147, RN-CORE-38; desenho docs/desenho/T-0147.md §5 e imagem aprovada
 * docs/design/telas/T-0147-fotos-pdv.png, quadro 3). Puro, para teste: parâmetros da rota, ordem das fontes e textos.
 *
 * O Core chama `abrir({ arquivo_id, titulo, subtitulo })` (porta registrada pelo shell) e a tela abre:
 * 1. o arquivo local `fotos/<arquivo_id>.jpg` (foto tirada ou escolhida neste aparelho), também sem sinal;
 * 2. senão, `GET /v1/arquivos/<arquivo_id>` com o token da sessão (precisa de sinal). Os bytes ficam só na memória da tela
 *    (`data:` URI), nunca no disco: vale para a fachada e para os documentos sensíveis que o Gestão abre (resposta
 *    `no-store`, desenho §5).
 */
import { nomeArquivoFoto } from './foto';

/** O que o Core passa ao abrir a foto (o título e o subtítulo já vêm formatados pelo módulo, no fuso do tenant). */
export interface PedidoVerFoto {
  arquivo_id: string;
  /** Ex.: nome do cliente ("Atacadinho Cachoeirinha"). */
  titulo?: string;
  /** Ex.: "Fachada · 08/11/2026". */
  subtitulo?: string;
}

export const ROTA_FOTO_PDV = '/foto-pdv';
export const TEXTO_SEM_SINAL_FOTO = 'Sem sinal para abrir a foto.';
export const TEXTO_FOTO_INDISPONIVEL = 'Não foi possível abrir a foto.';
export const ROTULO_FECHAR_FOTO = 'Fechar a foto';
/** Teto do download (a foto do aparelho tem 1600 px / JPEG 80, bem abaixo disso). */
export const MAX_BYTES_FOTO = 10 * 1024 * 1024;

/** Parâmetros da rota do visualizador (o `arquivo_id` precisa ser UUID: vira nome de arquivo e caminho da API). */
export function rotaDoVisualizador(p: PedidoVerFoto): { pathname: typeof ROTA_FOTO_PDV; params: Record<string, string> } {
  nomeArquivoFoto(p.arquivo_id); // lança se não for UUID
  return {
    pathname: ROTA_FOTO_PDV,
    params: { arquivo: p.arquivo_id.toLowerCase(), ...(p.titulo ? { titulo: p.titulo } : {}), ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) },
  };
}

function um(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Lê os parâmetros da rota; `null` = arquivo ausente ou inválido (a tela volta). */
export function pedidoDaRota(params: Record<string, string | string[] | undefined>): PedidoVerFoto | null {
  const arquivo = um(params.arquivo);
  if (!arquivo) return null;
  try {
    nomeArquivoFoto(arquivo);
  } catch {
    return null;
  }
  const titulo = um(params.titulo);
  const subtitulo = um(params.subtitulo);
  return { arquivo_id: arquivo.toLowerCase(), ...(titulo ? { titulo } : {}), ...(subtitulo ? { subtitulo } : {}) };
}

export type FonteFoto = { tipo: 'local'; uri: string } | { tipo: 'nuvem' } | { tipo: 'erro'; mensagem: string };

/** Ordem das fontes: arquivo local primeiro (vale sem sinal); sem ele, a nuvem só com sinal. */
export function fonteDaFoto(local: string | null, online: boolean, temNuvem: boolean): FonteFoto {
  if (local) return { tipo: 'local', uri: local };
  if (!temNuvem) return { tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL };
  if (!online) return { tipo: 'erro', mensagem: TEXTO_SEM_SINAL_FOTO };
  return { tipo: 'nuvem' };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 dos bytes (para o `data:` URI da imagem em memória; não é transporte). */
export function bytesParaBase64(bytes: Uint8Array): string {
  const partes: string[] = [];
  const BLOCO = 3 * 4096;
  for (let inicio = 0; inicio < bytes.length; inicio += BLOCO) {
    const fim = Math.min(inicio + BLOCO, bytes.length);
    let s = '';
    for (let i = inicio; i < fim; i += 3) {
      const a = bytes[i]!;
      const b = i + 1 < fim ? bytes[i + 1]! : 0;
      const c = i + 2 < fim ? bytes[i + 2]! : 0;
      const n = (a << 16) | (b << 8) | c;
      s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
      s += i + 1 < fim ? B64[(n >> 6) & 63]! : '=';
      s += i + 2 < fim ? B64[n & 63]! : '=';
    }
    partes.push(s);
  }
  return partes.join('');
}

/** Bytes de JPEG → `data:image/jpeg;base64,...`; `null` se os bytes não forem JPEG (assinatura FF D8 FF). */
export function uriDeJpeg(bytes: Uint8Array): string | null {
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return `data:image/jpeg;base64,${bytesParaBase64(bytes)}`;
}
