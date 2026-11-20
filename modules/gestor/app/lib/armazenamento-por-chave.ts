/**
 * Armazenamento compartilhado por chave (parte pura): N pedidos com a mesma chave chamam o carregador uma vez só;
 * chave nova carrega de novo e descarta a antiga. Com `igual`, o valor só é trocado quando os dados mudam, mantendo a
 * mesma referência para quem já o tem. Enquanto a chave nova carrega, vale o valor anterior.
 */
export interface ArmazenamentoPorChave<T> {
  obter(): T;
  solicitar(chave: string, carregar: () => Promise<T>): void;
  assinar(ouvinte: () => void): () => void;
}

export function criarArmazenamentoPorChave<T>(inicial: T, igual: (a: T, b: T) => boolean = Object.is): ArmazenamentoPorChave<T> {
  let valor = inicial;
  let chaveAtual: string | null = null;
  const ouvintes = new Set<() => void>();
  return {
    obter: () => valor,
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => void ouvintes.delete(ouvinte);
    },
    solicitar(chave, carregar) {
      if (chave === chaveAtual) return;
      chaveAtual = chave;
      void carregar()
        .then((novo) => {
          if (chave !== chaveAtual || igual(valor, novo)) return;
          valor = novo;
          ouvintes.forEach((o) => o());
        })
        .catch(() => undefined);
    },
  };
}
