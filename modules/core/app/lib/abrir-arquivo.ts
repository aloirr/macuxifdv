/**
 * Porta única do visualizador de arquivos (T-0186, RD-2356). O shell registra `definirAbrirArquivo` uma vez e o Core a usa para a foto
 * de fachada do PDV, os documentos do cliente e o PDF da NF: só ver, nada é baixado nem guardado. Sem o registro, "Foto do PDV",
 * "Ver PDF" e a seta do documento ficam desligados.
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

/** Decide pelo formato ("pdf" ou o resto, tratado como imagem); sem o shell informar `formatos`, só imagem abre. */
export function podeAbrirFormato(formato: string | null | undefined): boolean {
  const tipo: FormatoAbrivel = formato?.trim().toLowerCase() === 'pdf' ? 'pdf' : 'imagem';
  return formatosAbriveis.includes(tipo);
}

export function abrirArquivoRegistrado(): AbrirArquivo | null {
  return abrirArquivo;
}
