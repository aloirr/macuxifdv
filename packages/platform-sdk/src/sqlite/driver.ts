/**
 * Driver mínimo de SQLite (desenho T-0008 §3.3): o adaptador (`armazenamento.ts`) não conhece a biblioteca.
 * - Aparelho: `expo-sqlite` (driver no shell, `apps/mobile/src/services/sqlite-expo.ts`, P4 — depende do build EAS).
 * - Testes e Node: `node:sqlite` (`@macuxi/platform-sdk/sqlite-node`, nunca pelo índice: o Metro não pode vê-lo).
 * Valores sempre por parâmetro; nomes de tabela só de listas validadas (nunca texto livre).
 */
export type ValorSql = string | number | null;

export interface ComandoPreparado {
  rodar(params: readonly ValorSql[]): Promise<void>;
  finalizar(): Promise<void>;
}

export interface DriverSqlite {
  /** DDL/PRAGMA, várias instruções separadas por `;`. */
  executar(sql: string): Promise<void>;
  rodar(sql: string, params?: readonly ValorSql[]): Promise<{ alteradas: number }>;
  todas<T>(sql: string, params?: readonly ValorSql[]): Promise<T[]>;
  primeira<T>(sql: string, params?: readonly ValorSql[]): Promise<T | null>;
  preparar(sql: string): Promise<ComandoPreparado>;
  /**
   * Executa `fn` numa transação exclusiva (tudo ou nada). Dentro dela, use SÓ o `tx` recebido (no expo-sqlite é outra
   * conexão). Chamada aninhada no `tx` roda direto na transação de fora.
   */
  transacaoExclusiva<T>(fn: (tx: DriverSqlite) => Promise<T>): Promise<T>;
  /**
   * ADR 0054 (opcional): `ATTACH DATABASE <caminho> AS <apelido>` NESTA conexão (use o `tx` da transação exclusiva).
   * `apelido` só de lista fixa (`[a-z_]+`), nunca texto livre. Sem ela, o adaptador não importa pacote.
   */
  anexar?(caminho: string, apelido: string): Promise<void>;
  /** ADR 0054: `DETACH DATABASE <apelido>` na mesma conexão do `anexar`. */
  desanexar?(apelido: string): Promise<void>;
  fechar(): Promise<void>;
}
