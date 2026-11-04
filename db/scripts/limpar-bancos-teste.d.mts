/** Tipos do script node puro limpar-bancos-teste.mjs (usados pelo teste db/testes/banco-dos-testes.test.ts). */
export declare const PADROES_TESTE: readonly RegExp[];
export declare const IDADE_MIN_HORAS_PADRAO: number;
export declare function ehBancoDeTeste(nome: string, protegidos: readonly string[]): boolean;
export declare function instanteDoNome(nome: string): number | null;
export interface BancoListado {
  datname: string;
  datistemplate: boolean;
  conexoes: number;
  /** Data (ms) do arquivo PG_VERSION do banco, ou null se não deu para ler. */
  criadoEm: number | null;
}
export declare function classificar<T extends BancoListado>(
  bancos: readonly T[],
  opcoes: { protegidos: readonly string[]; agora: number; idadeMinMs: number; forcar: boolean },
): { ficam: T[]; ocupados: T[]; recentes: T[]; apagaveis: T[] };
