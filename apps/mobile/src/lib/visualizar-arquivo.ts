/**
 * Visualizador de arquivos da ficha (T-0186, RD-2356; P15 e P17): o Core chama a porta `abrirArquivo` com o documento do
 * cliente ou o PDF da NF, e o shell só MOSTRA. Puro, para teste: o tipo pelo formato e pelos bytes, a rota e os textos.
 * - imagem: o visor de foto comum (RD-0088), com os bytes só em memória;
 * - PDF: baixado para um arquivo temporário no cache (`<cache>/visualizar/`), apagado ao fechar. Sem compartilhar nem salvar.
 */
import { nomeArquivoFoto } from './foto';
import { bytesParaBase64 } from './foto-pdv';

/** O que o Core passa (título e subtítulo já formatados por ele; `formato` é a dica do documento, ex.: "pdf", "jpg"). */
export interface PedidoAbrirArquivo {
  arquivo_id: string;
  titulo: string;
  subtitulo?: string | undefined;
  formato?: string | null | undefined;
}

export const ROTA_VISOR_ARQUIVO = '/arquivo';
/** Pasta do arquivo temporário, dentro do cache do app. Esvaziada antes de cada download e ao fechar. */
export const PASTA_VISUALIZAR = 'visualizar';
export const MAX_BYTES_ARQUIVO = 20 * 1024 * 1024;
export const TEXTO_SEM_SINAL_ARQUIVO = 'Sem sinal para abrir o arquivo.';
export const TEXTO_ARQUIVO_INDISPONIVEL = 'Não foi possível abrir o arquivo.';
export const TEXTO_PDF_SEM_VISOR = 'Este aparelho ainda não abre PDF.';

/** Formato que já se sabe ser imagem: vai direto ao visor de foto. O resto vai à rota do arquivo, que olha os bytes. */
export function ehImagem(formato: string | null | undefined): boolean {
  return typeof formato === 'string' && /^(image\/|jpe?g$|png$)/i.test(formato.trim());
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

export type TipoDosBytes = 'pdf' | 'jpeg' | 'png' | null;

/** Tipo pela assinatura dos bytes (`%PDF`, JPEG `FF D8 FF`, PNG `89 50 4E 47`); `null` = não abre. */
export function tipoDosBytes(b: Uint8Array): TipoDosBytes {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

/** Imagem em memória (`data:` URI), nunca no disco. */
export function uriDaImagem(tipo: 'jpeg' | 'png', b: Uint8Array): string {
  return `data:image/${tipo};base64,${bytesParaBase64(b)}`;
}
