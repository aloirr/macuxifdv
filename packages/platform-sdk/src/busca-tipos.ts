/**
 * Tipos da busca textual (desenho T-0008 §2) usados pelo motor e pelo adaptador. Separados de `busca.ts` para o motor
 * (`motor-sync.ts`) não depender da implementação da busca (sem ciclo entre arquivos).
 */
/** Um grupo por termo digitado (termo + sinônimos). Alternativa com várias palavras = frase. */
export interface ConsultaTexto {
  grupos: readonly (readonly string[])[];
  /** O último grupo é o que está sendo digitado: casa por prefixo (só com ≥ 2 caracteres). */
  prefixoNoUltimo: boolean;
  /** Padrão 200 (sobra para os filtros do módulo depois; a tela mostra 50). */
  limite?: number;
}

export interface ResultadoBusca {
  chave: string;
  /** Menor = melhor (como o `bm25`). */
  pontuacao: number;
}

/** Extensão opcional do armazenamento (`ArmazenamentoSync.busca`). */
export interface BuscaTextoSync {
  /** Até `limite` chaves em ordem de relevância. Consulta vazia/1 letra/hostil = lista vazia; nunca lança por entrada. */
  buscar(indice: string, consulta: ConsultaTexto): Promise<ResultadoBusca[]>;
  /** Fim do sync: reconstrói índices marcados (carga em massa) e otimiza depois de muitas mudanças. */
  finalizar?(): Promise<void>;
}
