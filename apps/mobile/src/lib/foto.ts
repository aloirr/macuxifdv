/**
 * Regra de tamanho das fotos tiradas no app (puro, para teste). Mesma regra do Promotor e da Pesquisa (RN-PES-06):
 * no máximo 1600 px no maior lado, JPEG qualidade 80. Usada pela captura da foto da fachada (RN-CORE-14).
 */
export const FOTO_MAIOR_LADO_PX = 1600;
export const FOTO_QUALIDADE_JPEG = 0.8;
export const PASTA_FOTOS = 'fotos';

/** Redimensionamento a pedir ao manipulador (só um lado, mantém a proporção) ou `null` se já cabe. */
export function redimensionamento(largura: number, altura: number, maior = FOTO_MAIOR_LADO_PX): { width: number } | { height: number } | null {
  if (!(largura > 0) || !(altura > 0)) return null;
  if (Math.max(largura, altura) <= maior) return null;
  return largura >= altura ? { width: maior } : { height: maior };
}

/** Nome do arquivo local da foto: `<id>.jpg` (id = UUID gerado no aparelho; é a referência que o módulo guarda). */
export function nomeArquivoFoto(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('id de foto inválido');
  return `${id.toLowerCase()}.jpg`;
}

/**
 * Caminho local aceito pela fila de arquivos (ADR 0010 §4): relativo aos documentos do app, segmentos simples, sem `..`,
 * sem barra inicial e sem barra invertida (ex.: `fotos/<uuid>.jpg`, o mesmo de `caminhoFoto` do platform-sdk).
 */
export function caminhoLocalValido(caminho: string): boolean {
  // segmentos só com [a-z0-9_-]: `.`, `..`, barra inicial e barra invertida não passam
  return /^([a-z0-9_-]+\/)*[a-z0-9_-]+\.jpg$/i.test(caminho);
}
