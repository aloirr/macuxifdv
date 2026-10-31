/**
 * Driver SQL Server (pacote `mssql`/tedious, JS puro). Parâmetros `:nome` viram `@nome`.
 * O módulo `mssql` é carregado sob demanda e pode ser injetado (testes com dublê).
 * Datas vão como `datetime2(3)` em UTC; tedious lê `datetime`/`datetime2` como UTC (`useUTC`).
 */
import { trocarParametros } from '../config/esquema';
import { ehErroDeConexao, ErroConexaoErp, type ConexaoErp, type ExecutorSql, type Parametros } from './driver';

export interface OpcoesSqlServer {
  host: string;
  porta?: number;
  banco: string;
  usuario: string;
  senha: string;
  instancia?: string;
  criptografar?: boolean;
  confiarCertificado?: boolean;
  timeoutMs?: number;
}

/** Subconjunto do `mssql` usado aqui (permite dublê nos testes). */
export interface ModuloMssql {
  ConnectionPool: new (cfg: Record<string, unknown>) => PoolMssql;
  Transaction: new (pool: PoolMssql) => TransacaoMssql;
  DateTime2: (escala?: number) => unknown;
}
export interface RequestMssql {
  input(nome: string, tipoOuValor: unknown, valor?: unknown): RequestMssql;
  query(sql: string): Promise<{ recordset?: Record<string, unknown>[]; rowsAffected: number[] }>;
}
export interface PoolMssql {
  connect(): Promise<PoolMssql>;
  request(): RequestMssql;
  close(): Promise<void>;
  on(evento: string, fn: (e: unknown) => void): unknown;
}
export interface TransacaoMssql {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  request(): RequestMssql;
}

/** SQL `:nome` → `@nome`, registrando as entradas na request. */
export function preparar(sql: string, params: Parametros = {}, req: RequestMssql, m: ModuloMssql): string {
  const usados = new Set<string>();
  const texto = trocarParametros(sql, (nome) => {
    if (!(nome in params)) throw new Error(`Parâmetro :${nome} usado no SQL, mas não informado.`);
    usados.add(nome);
    return `@${nome}`;
  });
  for (const nome of usados) {
    const v = params[nome];
    if (v instanceof Date) req.input(nome, m.DateTime2(3), v);
    else req.input(nome, v === undefined ? null : v);
  }
  return texto;
}

export async function criarConexaoSqlServer(o: OpcoesSqlServer, injetado?: ModuloMssql): Promise<ConexaoErp> {
  const m: ModuloMssql = injetado ?? ((await import('mssql')).default as unknown as ModuloMssql);
  const pool = new m.ConnectionPool({
    server: o.host,
    port: o.instancia ? undefined : (o.porta ?? 1433),
    database: o.banco,
    user: o.usuario,
    password: o.senha,
    connectionTimeout: o.timeoutMs ?? 30_000,
    requestTimeout: o.timeoutMs ?? 30_000,
    pool: { max: 3, min: 0, idleTimeoutMillis: 30_000 },
    options: { encrypt: o.criptografar ?? true, trustServerCertificate: o.confiarCertificado ?? false, instanceName: o.instancia, useUTC: true },
  });
  pool.on('error', () => undefined);
  let conectado: Promise<unknown> | null = null;
  const conectar = () => (conectado ??= pool.connect().catch((e) => ((conectado = null), Promise.reject(e))));

  const proteger = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      await conectar();
      return await fn();
    } catch (e) {
      if (ehErroDeConexao(e)) {
        conectado = null;
        throw new ErroConexaoErp(`Banco do ERP indisponível (${(e as { code?: string }).code ?? 'sem código'})`, e);
      }
      throw e;
    }
  };

  const executorDe = (criar: () => RequestMssql): ExecutorSql => ({
    async consultar(sql, params) {
      const req = criar();
      return (await req.query(preparar(sql, params, req, m))).recordset ?? [];
    },
    async executar(sql, params) {
      const req = criar();
      const r = await req.query(preparar(sql, params, req, m));
      return { linhasAfetadas: r.rowsAffected.reduce((a, b) => a + b, 0) };
    },
  });

  const base = executorDe(() => pool.request());
  return {
    tipo: 'sqlserver',
    consultar: (sql, params) => proteger(() => base.consultar(sql, params)),
    executar: (sql, params) => proteger(() => base.executar(sql, params)),
    async testar() {
      const r = await proteger(() => pool.request().query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(40)) AS v"));
      return { versao: String(r.recordset?.[0]?.v ?? '?') };
    },
    transacao: (fn) =>
      proteger(async () => {
        const tx = new m.Transaction(pool);
        await tx.begin();
        try {
          const r = await fn(executorDe(() => tx.request()));
          await tx.commit();
          return r;
        } catch (e) {
          await tx.rollback().catch(() => undefined);
          throw e;
        }
      }),
    async fechar() {
      await pool.close().catch(() => undefined);
    },
  };
}
