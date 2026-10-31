/** Abstração do banco do ERP: o resto do Conector não sabe se é SQL Server ou PostgreSQL. */
export type Parametros = Record<string, unknown>;
export type Linha = Record<string, unknown>;

export interface ExecutorSql {
  /** SQL com parâmetros nomeados `:nome`. Datas (`Date`) são UTC. */
  consultar(sql: string, params?: Parametros): Promise<Linha[]>;
  executar(sql: string, params?: Parametros): Promise<{ linhasAfetadas: number }>;
}

export interface ConexaoErp extends ExecutorSql {
  readonly tipo: 'sqlserver' | 'postgres';
  /** Versão do servidor (teste de conexão). */
  testar(): Promise<{ versao: string }>;
  /** Executa `fn` numa transação: confirma se retornar, desfaz se lançar. */
  transacao<T>(fn: (tx: ExecutorSql) => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
}

/** Erro de conexão/indisponibilidade (transitório) × erro do SQL/regra do ERP (definitivo). */
export class ErroConexaoErp extends Error {
  constructor(message: string, readonly causa?: unknown) {
    super(message);
    this.name = 'ErroConexaoErp';
  }
}

const CODIGOS_REDE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE', 'ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ELOGIN', 'EAI_AGAIN', 'ENETUNREACH']);

/** Heurística: o erro é de conexão (vale tentar de novo depois) e não de SQL/regra? */
export function ehErroDeConexao(e: unknown): boolean {
  if (e instanceof ErroConexaoErp) return true;
  const err = e as { code?: unknown; errors?: unknown[] } | null;
  if (!err) return false;
  if (Array.isArray(err.errors) && err.errors.length > 0) return err.errors.some(ehErroDeConexao);
  const code = typeof err.code === 'string' ? err.code : '';
  if (CODIGOS_REDE.has(code)) return true;
  // PostgreSQL: classe 08 (conexão), 53 (recursos), 57P (desligando), 40001/40P01 (serialização/deadlock)
  return /^(08|53|57P)/.test(code) || code === '40001' || code === '40P01';
}
