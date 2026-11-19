/**
 * Portão do rastreamento pela API pública do Core (T-0156; ADR 0061 decisão 2): o shell do Campo (tarefa `macuxi-trajeto`) usa a mesma
 * função da API e do Core. Arquivo à parte: o `domain/rastreamento` importa tipos de `contracts`, e a reexportação aqui evita o ciclo
 * de execução no `index`.
 */
export { CARGOS_RASTREADOS, podeRastrear, type EntradaRastreio, type ResultadoRastreio } from '../domain/rastreamento';
