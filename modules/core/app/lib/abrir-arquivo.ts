/**
 * Porta única do visualizador de arquivos (T-0186, RD-2356). O shell registra `definirAbrirArquivo` uma vez e o Core a usa para a foto
 * de fachada do PDV e os documentos do cliente: só ver, nada é baixado nem guardado. A porta abre imagem (JPEG e PNG); o PDF só abre
 * quando o shell o informar em `formatos`, a partir da v1.0.16. Sem o registro, "Foto do PDV" e a seta do documento ficam desligados.
 */
export interface PedidoAbrirArquivo {
  arquivo_id: string;
  titulo: string;
  subtitulo?: string;
  /** "pdf", "jpg"...; ausente = o visualizador decide pelo arquivo. */
  formato?: string | null;
}
export type AbrirArquivo = (p: PedidoAbrirArquivo) => void;

let abrirArquivo: AbrirArquivo | null = null;

export type FormatoAbrivel = 'imagem' | 'pdf';
export interface OpcoesAbrirArquivo {
  /** Formatos que o shell sabe abrir; ausente = só imagem (o PDF fica para a v1.0.16). */
  formatos?: readonly FormatoAbrivel[];
}

let formatosAbriveis: readonly FormatoAbrivel[] = ['imagem'];

export function definirAbrirArquivo(fn: AbrirArquivo | null, opcoes?: OpcoesAbrirArquivo): void {
  abrirArquivo = fn;
  formatosAbriveis = opcoes?.formatos ?? ['imagem'];
}

/** Nome curto em minúsculas: "JPG", ".png", "image/jpeg" e "application/pdf" viram "jpg", "png", "jpeg" e "pdf". */
export function normalizarFormato(formato: string | null | undefined): string {
  const t = (formato ?? '').trim().toLowerCase();
  return (t.includes('/') ? t.split('/').pop() ?? '' : t).replace(/^\./, '');
}

/** Só JPEG e PNG são imagem que o visor abre; o PDF só se o shell informar `formatos` com 'pdf'. Qualquer outro fica sem a ação. */
export function podeAbrirFormato(formato: string | null | undefined): boolean {
  const f = normalizarFormato(formato);
  if (f === 'jpg' || f === 'jpeg' || f === 'png') return formatosAbriveis.includes('imagem');
  if (f === 'pdf') return formatosAbriveis.includes('pdf');
  return false;
}

export function abrirArquivoRegistrado(): AbrirArquivo | null {
  return abrirArquivo;
}
