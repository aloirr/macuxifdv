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

/**
 * Por que a busca NÃO foi feita (`DesfechoBusca` com `buscou: false`). Nesses casos não se sabe se há acerto: quem chama
 * cai no caminho de reserva (ex.: varrer em memória), nunca conclui "nenhum produto".
 * - `consulta_vazia`: nada pesquisável (vazia, só símbolos, 1 letra no prefixo).
 * - `modulo_indisponivel`: as migrações locais do módulo dono do índice falharam (SQLite).
 * - `indice_invalido`: tabelas do índice ausentes ou com colunas diferentes das declaradas (SQLite).
 * - `erro_busca`: o mecanismo recusou a consulta (erro do FTS5; o log leva só o tamanho, nunca o texto).
 * - `sem_busca`: o armazenamento não tem a extensão `busca` (só pelo motor).
 * - `indeterminado`: armazenamento de fora do SDK só com `buscar` devolveu lista vazia (não distingue os casos).
 * - `indexando`: o índice está sendo (re)montado a partir das linhas locais (L-1) em segundo plano; só com a opção
 *   `buscaSemEsperarIndexacao` do adaptador SQLite (T-0088, aditivo). Quem chama varre até o índice ficar pronto.
 */
export type MotivoSemBusca =
  | 'consulta_vazia'
  | 'modulo_indisponivel'
  | 'indice_invalido'
  | 'erro_busca'
  | 'sem_busca'
  | 'indeterminado'
  | 'indexando';

/**
 * Desfecho da busca (T-0052, R-20261105-145745): `buscou: true` com `resultados: []` = "busquei e não achei" (dá para
 * concluir que não há acerto); `buscou: false` = "não consegui buscar", com o motivo.
 */
export type DesfechoBusca =
  | { readonly buscou: true; readonly resultados: ResultadoBusca[] }
  | { readonly buscou: false; readonly motivo: MotivoSemBusca };

/** Extensão opcional do armazenamento (`ArmazenamentoSync.busca`). */
export interface BuscaTextoSync {
  /**
   * Até `limite` chaves em ordem de relevância. Consulta vazia/1 letra/hostil = lista vazia; nunca lança por entrada.
   * Lista vazia também quando NÃO conseguiu buscar (compatibilidade); para separar os casos, `buscarComDesfecho`.
   */
  buscar(indice: string, consulta: ConsultaTexto): Promise<ResultadoBusca[]>;
  /**
   * Igual a `buscar`, mas diz se buscou (`resultados`: mesmo conteúdo e ordem de `buscar`) ou por que não buscou.
   * Opcional para não quebrar armazenamentos de fora do SDK; os do SDK (SQLite e `comBuscaEmJs`) implementam.
   */
  buscarComDesfecho?(indice: string, consulta: ConsultaTexto): Promise<DesfechoBusca>;
  /** Fim do sync: reconstrói índices marcados (carga em massa) e otimiza depois de muitas mudanças. */
  finalizar?(): Promise<void>;
  /**
   * Gancho de reindexação marcada (T-0084): guarda o fuso do tenant para a indexação e confere `versaoDocumentos` de
   * cada índice; versão diferente da guardada = índice marcado para reindexar (em segundo plano na busca; esperado no
   * `finalizar`). O motor chama antes de cada busca e antes do `finalizar`. Barato quando nada mudou; nunca lança.
   */
  conferirVersoes?(ctx: { fuso?: string }): Promise<void>;
}
