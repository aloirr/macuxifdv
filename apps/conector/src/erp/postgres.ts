/**
 * Driver PostgreSQL (pacote `pg`). Parâmetros `:nome` viram `$1…`. Datas viram texto ISO em UTC (a coluna decide o tipo),
 * e `timestamp` sem fuso é lido como UTC — a view do ERP deve entregar horários em UTC.
 */
import pg from 'pg';
import { trocarParametros } from '../config/esquema';
import { ehErroDeConexao, ErroConexaoErp, type ConexaoErp, type ExecutorSql, type Linha, type Parametros } from './driver';

export interface OpcoesPostgres {
  host: string;
  porta?: number;
  banco: string;
  usuario: string;
  senha: string;
  ssl?: boolean;
  confiarCertificado?: boolean;
  timeoutMs?: number;
}

export function converterParametros(sql: string, params: Parametros = {}): { texto: string; valores: unknown[] } {
  const ordem: string[] = [];
  const texto = trocarParametros(sql, (nome) => {
    if (!(nome in params)) throw new Error(`Parâmetro :${nome} usado no SQL, mas não informado.`);
    let i = ordem.indexOf(nome);
    if (i === -1) i = ordem.push(nome) - 1;
    return `$${i + 1}`;
  });
  const valores = ordem.map((n) => {
    const v = params[n];
    return v instanceof Date ? v.toISOString() : v === undefined ? null : v;
  });
  return { texto, valores };
}

const tipos = {
  getTypeParser(oid: number, formato?: 'text' | 'binary') {
    // timestamp sem fuso (1114): interpretar como UTC; demais: padrão do pg
    if (oid === 1114) return (s: string) => new Date(`${s.replace(' ', 'T')}Z`);
    return pg.types.getTypeParser(oid, formato as 'text');
  },
};

type Cliente = { query: (t: string, v: unknown[]) => Promise<{ rows: Linha[]; rowCount: number | null }> };

function executorDe(c: Cliente): ExecutorSql {
  return {
    async consultar(sql, params) {
      const { texto, valores } = converterParametros(sql, params);
      return (await c.query(texto, valores)).rows;
    },
    async executar(sql, params) {
      const { texto, valores } = converterParametros(sql, params);
      return { linhasAfetadas: (await c.query(texto, valores)).rowCount ?? 0 };
    },
  };
}

export function criarConexaoPostgres(o: OpcoesPostgres): ConexaoErp {
  const pool = new pg.Pool({
    host: o.host,
    port: o.porta ?? 5432,
    database: o.banco,
    user: o.usuario,
    password: o.senha,
    max: 3,
    connectionTimeoutMillis: o.timeoutMs ?? 30_000,
    statement_timeout: o.timeoutMs ?? 30_000,
    ssl: o.ssl ? { rejectUnauthorized: !o.confiarCertificado } : false,
    types: tipos,
  });
  // erro em conexão ociosa não pode derrubar o processo
  pool.on('error', () => undefined);

  const proteger = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (ehErroDeConexao(e)) throw new ErroConexaoErp(`Banco do ERP indisponível (${(e as { code?: string }).code ?? 'sem código'})`, e);
      throw e;
    }
  };

  const base = executorDe(pool as unknown as Cliente);
  return {
    tipo: 'postgres',
    consultar: (sql, params) => proteger(() => base.consultar(sql, params)),
    executar: (sql, params) => proteger(() => base.executar(sql, params)),
    async testar() {
      const r = await proteger(() => pool.query<{ v: string }>('select version() as v'));
      return { versao: r.rows[0]?.v ?? '?' };
    },
    transacao: (fn) =>
      proteger(async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(executorDe(c as unknown as Cliente));
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          throw e;
        } finally {
          c.release();
        }
      }),
    async fechar() {
      await pool.end().catch(() => undefined);
    },
  };
}
