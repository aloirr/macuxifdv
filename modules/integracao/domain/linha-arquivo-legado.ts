/**
 * Lotes legados de arquivo: a carga por CSV no BKO saiu na v1.0.22 (a integração é só por Conector ou API), mas o staging dos lotes
 * antigos guarda a linha física de cada registro (`linhas_arquivo`). Ao reprocessar um desses lotes, os erros e avisos do Hub (que vêm
 * com o índice do lote) seguem ganhando "Linha N do arquivo:" para o operador achar a linha na planilha original. Sem mapa
 * (lote do Conector ou da API), nada muda.
 */
const JA_ANOTADA = /^Linha \d+ do arquivo:/;

export function anotarLinhaDoArquivo<T extends { indice: number; mensagem: string }>(itens: readonly T[], linhasArquivo: readonly number[] | null | undefined): T[] {
  if (!linhasArquivo || linhasArquivo.length === 0) return [...itens];
  return itens.map((i) => {
    const n = linhasArquivo[i.indice];
    if (n === undefined || JA_ANOTADA.test(i.mensagem)) return i;
    return { ...i, mensagem: `Linha ${n} do arquivo: ${i.mensagem}`.slice(0, 1000) };
  });
}
