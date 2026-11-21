/**
 * Reprocessar os lotes de uma entidade (RN-INT-15, RN-INT-16), do mais antigo para o mais recente. O mais antigo é o primeiro a
 * expirar (409 `conteudo_expirado`), então um erro dele não pode parar os demais. Só interrompe o erro que `parar` indica (`paraSeNaoForDoLote`).
 */
export interface ResultadoReprocesso {
  reprocessados: string[];
  falhas: { loteId: string; erro: unknown }[];
  /** Lotes ainda a reprocessar: o que parou a execução e os que nem foram tentados. */
  restantes: string[];
  interrompido: unknown | null;
}

export async function reprocessarLotes(
  ids: readonly string[],
  executar: (loteId: string) => Promise<unknown>,
  parar: (erro: unknown) => boolean,
): Promise<ResultadoReprocesso> {
  const r: ResultadoReprocesso = { reprocessados: [], falhas: [], restantes: [], interrompido: null };
  for (const [i, loteId] of ids.entries()) {
    try {
      await executar(loteId);
      r.reprocessados.push(loteId);
    } catch (erro) {
      if (parar(erro)) {
        r.interrompido = erro;
        r.restantes = ids.slice(i);
        break;
      }
      r.falhas.push({ loteId, erro });
    }
  }
  return r;
}

/** Texto curto do resultado: só quantos foram e quais falharam, com a mensagem de cada um. */
export function textoResultadoReprocesso(
  r: ResultadoReprocesso,
  total: number,
  rotulo: (loteId: string) => string,
  mensagem: (erro: unknown) => string,
): string {
  if (r.falhas.length === 0) return 'Reprocessamento iniciado.';
  const inicio = r.reprocessados.length === 0 ? 'Nenhum lote reprocessado.' : `${r.reprocessados.length} de ${total} lotes reprocessados.`;
  return `${inicio} ${r.falhas.map((f) => `Falhou ${rotulo(f.loteId)}: ${mensagem(f.erro)}`).join(' ')}`;
}

const CODIGOS_DO_LOTE = ['conteudo_expirado', 'lote_nao_pode_reprocessar', 'LOTE_NAO_ENCONTRADO'];

/** Só o erro do próprio lote deixa seguir para o próximo; autorização, senha, limite e serviço fora param a fila. */
export const paraSeNaoForDoLote = (codigo: string): boolean => !CODIGOS_DO_LOTE.includes(codigo);
