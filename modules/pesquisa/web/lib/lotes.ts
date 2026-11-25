/**
 * Busca em lotes (UX-34): executa `buscar` para todos os ids, no máximo `tamanho` por vez em paralelo, sem descartar nenhum.
 * Id para o qual `ausente(erro)` é verdadeiro (ex.: 404) vira `null`; qualquer outra falha deixa o id fora do resultado
 * (a tela mostra "indisponível", não "sem cadastro"), sem derrubar os demais.
 */
export const TAMANHO_LOTE = 10;

type Retorno<T> = { v: T | null } | null;

export async function buscarEmLotes<T>(
  ids: readonly string[],
  buscar: (id: string) => Promise<T>,
  ausente: (erro: unknown) => boolean,
  tamanho = TAMANHO_LOTE,
): Promise<Record<string, T | null>> {
  const resultado: Record<string, T | null> = {};
  for (let i = 0; i < ids.length; i += tamanho) {
    const lote = ids.slice(i, i + tamanho);
    const respostas = await Promise.all(
      lote.map((id) =>
        buscar(id).then(
          (v): Retorno<T> => ({ v }),
          (e): Retorno<T> => (ausente(e) ? { v: null } : null),
        ),
      ),
    );
    lote.forEach((id, j) => {
      const r = respostas[j];
      if (r) resultado[id] = r.v;
    });
  }
  return resultado;
}
