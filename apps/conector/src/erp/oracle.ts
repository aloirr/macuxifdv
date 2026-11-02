/**
 * Driver Oracle (pacote `oracledb`, modo THIN: JavaScript puro, SEM Oracle Instant Client; este arquivo nunca inicializa o
 * cliente nativo). Foi pensado para a mesma regra do resto do Conector: o SQL do cliente roda com parâmetros nomeados `:nome`,
 * que o Oracle já entende como binds. Nenhum valor é concatenado no SQL.
 *
 * - Binds: só os `:nome` que aparecem no SQL (fora de literais e comentários) vão ao driver; `Date` vai como TIMESTAMP WITH TIME ZONE
 *   (instante exato, sem depender do fuso do processo); `null`/`undefined` viram NULL; boolean vira 1/0.
 * - Sessão: a cada conexão fixa `TIME_ZONE = '+00:00'`, formatos NLS ISO e `NLS_NUMERIC_CHARACTERS = '.,'`, para o texto devolvido não
 *   depender do idioma do servidor nem do fuso do Node.
 * - Tipos (contrato: datas UTC, dinheiro em centavos inteiros): DATE / TIMESTAMP / TIMESTAMP WITH [LOCAL] TIME ZONE chegam como texto ISO
 *   e viram `Date` UTC (o THIN leria DATE/TIMESTAMP com o fuso LOCAL do processo; por isso não usamos a conversão nativa).
 *   NUMBER chega como TEXTO e vira número só quando é inteiro seguro; decimal fica texto exato ("19.99"), que o mapeamento
 *   `centavos_de_decimal` converte sem ponto flutuante. CLOB/NCLOB viram texto (colunas JSON).
 * - Paginação (chave `erp.paginacao`): se a consulta não usa `:limite`, o Conector aplica o limite — `offset` (Oracle 12c+:
 *   `OFFSET :macuxi_offset ROWS FETCH NEXT :limite ROWS ONLY`) ou `rownum` (11g: `SELECT * FROM (<consulta>) WHERE ROWNUM <= :limite`).
 *   Se a consulta já usa `:limite`, ela é executada como está (paginação manual do técnico do cliente).
 * - Nomes de coluna voltam em minúsculas (o Oracle devolve MAIÚSCULAS para alias sem aspas).
 */
import { parametrosDaConsulta, trocarParametros } from '../config/esquema';
import { ehErroDeConexao, ErroConexaoErp, type ConexaoErp, type ExecutorSql, type Linha, type Parametros } from './driver';

export type ModoPaginacao = 'offset' | 'rownum';

export interface OpcoesOracle {
  host: string;
  porta?: number;
  /** Nome do SERVIÇO (service name) do banco, não o SID. */
  banco: string;
  usuario: string;
  senha: string;
  /** `true` usa `tcps://` (TLS). `false` (padrão do Oracle on-premise): TCP simples. */
  criptografar?: boolean;
  /** `true` desliga a conferência do DN do certificado do servidor (`sslServerDNMatch`). */
  confiarCertificado?: boolean;
  /** Pasta do wallet PEM (`ewallet.pem`) para TLS com certificado próprio. */
  carteira?: string;
  paginacao?: ModoPaginacao;
  timeoutMs?: number;
}

/** Subconjunto do `oracledb` usado aqui (permite dublê nos testes). */
export interface ModuloOracle {
  createPool(atributos: Record<string, unknown>): Promise<PoolOracle>;
  OUT_FORMAT_OBJECT: number;
  DB_TYPE_DATE: unknown;
  DB_TYPE_TIMESTAMP: unknown;
  DB_TYPE_TIMESTAMP_TZ: unknown;
  DB_TYPE_TIMESTAMP_LTZ: unknown;
  DB_TYPE_NUMBER: unknown;
  DB_TYPE_VARCHAR: unknown;
  DB_TYPE_CLOB: unknown;
  DB_TYPE_NCLOB: unknown;
}
export interface MetadadoColuna {
  name: string;
  dbType: unknown;
}
export interface RespostaFetch {
  type?: unknown;
  converter?: (valor: unknown) => unknown;
}
export interface OpcoesExecucao {
  outFormat: number;
  autoCommit: boolean;
  fetchTypeHandler: (m: MetadadoColuna) => RespostaFetch | undefined;
}
export interface ConexaoOracleDriver {
  execute(sql: string, binds: Record<string, unknown>, opcoes: OpcoesExecucao): Promise<{ rows?: Record<string, unknown>[]; rowsAffected?: number }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
  callTimeout?: number;
  oracleServerVersionString?: string;
}
export interface PoolOracle {
  getConnection(): Promise<ConexaoOracleDriver>;
  close(drainTimeSeconds?: number): Promise<void>;
}

/** Ajustes de sessão: texto previsível, independente de idioma/fuso do servidor ou do processo Node. */
export const ALTER_SESSION =
  `ALTER SESSION SET TIME_ZONE = '+00:00' NLS_NUMERIC_CHARACTERS = '.,' NLS_DATE_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS' ` +
  `NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF3' NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'`;

// ---------- paginação ----------

/** Tira espaços e `;` do fim. A quebra de linha antes do que vem depois (OFFSET, `)`) protege contra comentário `-- ...` na última linha. */
function aparar(sql: string): string {
  return sql.replace(/[\s;]+$/g, '');
}

export interface ConsultaPaginada {
  sql: string;
  /** Nomes de bind extras que a paginação criou (valores calculados por `valoresPaginacao`). */
  extras: string[];
}

/**
 * Aplica o limite à consulta do cliente (que NÃO usa `:limite`). A leitura é por cursor (keyset), então o deslocamento é 0; o
 * parâmetro `offset` existe para quem precisar de página numerada.
 */
export function paginarConsulta(sql: string, modo: ModoPaginacao, comOffset = false): ConsultaPaginada {
  const base = aparar(sql);
  if (modo === 'offset') return { sql: `${base}\nOFFSET :macuxi_offset ROWS FETCH NEXT :limite ROWS ONLY`, extras: ['macuxi_offset'] };
  if (!comOffset) return { sql: `SELECT * FROM (\n${base}\n) WHERE ROWNUM <= :limite`, extras: [] };
  return {
    sql: `SELECT * FROM (SELECT macuxi_t.*, ROWNUM macuxi_rn FROM (\n${base}\n) macuxi_t WHERE ROWNUM <= :macuxi_fim) WHERE macuxi_rn > :macuxi_offset`,
    extras: ['macuxi_fim', 'macuxi_offset'],
  };
}

/** Consulta que já traz `:limite` é paginação manual do técnico: roda como está. */
export function usaLimiteProprio(sql: string): boolean {
  return parametrosDaConsulta(sql).includes('limite');
}

// ---------- conversão de tipos ----------

/** Texto ISO de data/hora do Oracle (formatos de sessão acima) → `Date`. Sem fuso explícito = UTC (a sessão está em +00:00). */
export function dataOracle(texto: string): Date | null {
  const t = texto.trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/.exec(t);
  if (!m) return null;
  const ms = (m[3] ?? '').slice(0, 3).padEnd(3, '0');
  const d = new Date(`${m[1]}T${m[2]}.${ms}${m[4] ?? 'Z'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Expande notação científica de um NUMBER em texto para decimal simples. */
function expandirExponencial(t: string): string | null {
  const m = /^(-?)(\d*)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(t);
  if (!m) return null;
  const [, sinal = '', inteiro = '', frac = '', exp = '0'] = m;
  const digitos = `${inteiro}${frac}`;
  const ponto = inteiro.length + Number(exp);
  if (Math.abs(ponto) > 400) return null;
  let r: string;
  if (ponto <= 0) r = `0.${'0'.repeat(-ponto)}${digitos}`;
  else if (ponto >= digitos.length) r = `${digitos}${'0'.repeat(ponto - digitos.length)}`;
  else r = `${digitos.slice(0, ponto)}.${digitos.slice(ponto)}`;
  return `${sinal}${r}`;
}

/**
 * NUMBER em texto → número quando é inteiro seguro; senão texto decimal exato e normalizado ("0.5", "-12.34", sem zeros à direita).
 * Dinheiro nunca passa por ponto flutuante aqui.
 */
export function numeroOracle(texto: string): number | string {
  let t = texto.trim();
  if (t === '') return t;
  const exp = expandirExponencial(t);
  if (exp !== null) t = exp;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m) return texto;
  const sinal = m[1] ?? '';
  const inteiro = (m[2] ?? '').replace(/^0+(?=\d)/, '') || '0';
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac === '') {
    const n = Number(`${sinal}${inteiro}`);
    return Number.isSafeInteger(n) ? (n === 0 ? 0 : n) : `${sinal}${inteiro}`;
  }
  return `${sinal}${inteiro}.${frac}`;
}

/** Decide, por coluna, o que o driver devolve (texto no formato de sessão) e converte. */
export function criarFetchTypeHandler(m: ModuloOracle): OpcoesExecucao['fetchTypeHandler'] {
  const texto = (conv?: (v: string) => unknown) => ({ type: m.DB_TYPE_VARCHAR, converter: (v: unknown) => (v === null || v === undefined ? null : conv ? conv(String(v)) : String(v)) });
  return (meta) => {
    const t = meta.dbType;
    if (t === m.DB_TYPE_DATE || t === m.DB_TYPE_TIMESTAMP || t === m.DB_TYPE_TIMESTAMP_TZ || t === m.DB_TYPE_TIMESTAMP_LTZ) {
      // data que não parece ISO fica como veio (texto): o mapeamento tenta e, se falhar, aponta o campo no erro da linha
      return texto((s) => dataOracle(s) ?? s);
    }
    if (t === m.DB_TYPE_NUMBER) return texto(numeroOracle);
    if (t === m.DB_TYPE_CLOB || t === m.DB_TYPE_NCLOB) return texto();
    return undefined;
  };
}

// ---------- binds ----------

export function prepararBinds(sql: string, params: Parametros = {}, m: ModuloOracle): Record<string, unknown> {
  const usados = new Set<string>();
  trocarParametros(sql, (nome) => {
    if (!(nome in params)) throw new Error(`Parâmetro :${nome} usado no SQL, mas não informado.`);
    usados.add(nome);
    return `:${nome}`;
  });
  const binds: Record<string, unknown> = {};
  for (const nome of usados) {
    const v = params[nome];
    if (v instanceof Date) binds[nome] = { val: v, type: m.DB_TYPE_TIMESTAMP_TZ };
    else if (v === undefined || v === null) binds[nome] = { val: null, type: m.DB_TYPE_VARCHAR };
    else if (typeof v === 'boolean') binds[nome] = v ? 1 : 0;
    else if (typeof v === 'bigint') binds[nome] = v.toString();
    else binds[nome] = v;
  }
  return binds;
}

// ---------- erros ----------

const ERROS_CONEXAO_ORACLE = /\b(NJS-(500|501|503|510|040|521)|ORA-(03113|03114|03135|01033|01034|01089|12170|12537|12541|12543|12545|12571))\b/;

/** Falha de rede/indisponibilidade do Oracle (vale tentar depois) × erro de SQL/regra (definitivo). */
export function ehErroConexaoOracle(e: unknown): boolean {
  if (ehErroDeConexao(e)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return ERROS_CONEXAO_ORACLE.test(msg);
}

function dicaPaginacao(e: unknown, modo: ModoPaginacao): Error | null {
  const msg = e instanceof Error ? e.message : '';
  if (modo === 'offset' && /ORA-00933|ORA-00905|ORA-00920/.test(msg)) {
    return new Error(`${msg.split('\n')[0]} — o Oracle pode ser anterior à 12c (sem OFFSET/FETCH): configure "erp.paginacao": "rownum" ou escreva a consulta com :limite.`);
  }
  return null;
}

// ---------- conexão ----------

export async function criarConexaoOracle(o: OpcoesOracle, injetado?: ModuloOracle): Promise<ConexaoErp> {
  // `oracledb` é carregado sob demanda (e nunca inicializa o cliente nativo): fica no modo THIN, que é o padrão do pacote.
  const m: ModuloOracle = injetado ?? ((await import('oracledb')).default as unknown as ModuloOracle);
  const modo: ModoPaginacao = o.paginacao ?? 'offset';
  const esquema = o.criptografar ? 'tcps://' : '';
  const timeoutMs = o.timeoutMs ?? 30_000;
  const fetchTypeHandler = criarFetchTypeHandler(m);
  let pool: PoolOracle | null = null;
  let abrindo: Promise<PoolOracle> | null = null;

  const obterPool = (): Promise<PoolOracle> => {
    if (pool) return Promise.resolve(pool);
    abrindo ??= m
      .createPool({
        user: o.usuario,
        password: o.senha,
        connectString: `${esquema}${o.host}:${o.porta ?? (o.criptografar ? 2484 : 1521)}/${o.banco}`,
        poolMin: 0,
        poolMax: 3,
        poolIncrement: 1,
        poolTimeout: 30,
        queueTimeout: timeoutMs,
        connectTimeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        ...(o.criptografar ? { sslServerDNMatch: !o.confiarCertificado } : {}),
        ...(o.carteira ? { walletLocation: o.carteira } : {}),
      })
      .then((p) => (pool = p))
      .catch((e: unknown) => {
        abrindo = null;
        throw e;
      });
    return abrindo;
  };

  const proteger = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (ehErroConexaoOracle(e)) {
        // T-0048: o pool quebrado é fechado na hora (sem esperar o poolTimeout); o próximo uso abre outro
        const antigo = pool;
        pool = null;
        abrindo = null;
        void antigo?.close(0).catch(() => undefined);
        const codigo = /\b(ORA-\d{5}|NJS-\d{3})\b/.exec(e instanceof Error ? e.message : '')?.[1] ?? (e as { code?: string }).code ?? 'sem código';
        throw new ErroConexaoErp(`Banco do ERP indisponível (${codigo})`, e);
      }
      throw e;
    }
  };

  /** Abre a conexão do pool, fixa a sessão e fecha ao final. */
  const comConexao = async <T>(fn: (c: ConexaoOracleDriver) => Promise<T>): Promise<T> => {
    const p = await obterPool();
    const c = await p.getConnection();
    try {
      c.callTimeout = timeoutMs;
      await c.execute(ALTER_SESSION, {}, { outFormat: m.OUT_FORMAT_OBJECT, autoCommit: false, fetchTypeHandler });
      return await fn(c);
    } finally {
      await c.close().catch(() => undefined);
    }
  };

  const executorDe = (c: ConexaoOracleDriver, autoCommit: boolean): ExecutorSql => ({
    async consultar(sql, params = {}) {
      let texto = sql;
      let p = params;
      if (params.limite !== undefined && !usaLimiteProprio(sql)) {
        const limite = Number(params.limite);
        if (!Number.isInteger(limite) || limite < 1) throw new Error('Parâmetro :limite deve ser um inteiro maior que zero.');
        const deslocamento = params.offset === undefined ? 0 : Number(params.offset);
        const pag = paginarConsulta(sql, modo, deslocamento > 0);
        texto = pag.sql;
        p = { ...params, macuxi_offset: deslocamento, macuxi_fim: deslocamento + limite };
      }
      const binds = prepararBinds(texto, p, m);
      let res;
      try {
        res = await c.execute(texto, binds, { outFormat: m.OUT_FORMAT_OBJECT, autoCommit: false, fetchTypeHandler });
      } catch (e) {
        throw (texto !== sql ? dicaPaginacao(e, modo) : null) ?? e;
      }
      return (res.rows ?? []).map((r) => {
        const linha: Linha = {};
        for (const [k, v] of Object.entries(r)) if (k.toLowerCase() !== 'macuxi_rn') linha[k.toLowerCase()] = v;
        return linha;
      });
    },
    async executar(sql, params = {}) {
      const res = await c.execute(sql, prepararBinds(sql, params, m), { outFormat: m.OUT_FORMAT_OBJECT, autoCommit, fetchTypeHandler });
      return { linhasAfetadas: res.rowsAffected ?? 0 };
    },
  });

  return {
    tipo: 'oracle',
    consultar: (sql, params) => proteger(() => comConexao((c) => executorDe(c, false).consultar(sql, params))),
    executar: (sql, params) => proteger(() => comConexao((c) => executorDe(c, true).executar(sql, params))),
    async testar() {
      return proteger(() =>
        comConexao(async (c) => {
          await c.execute('SELECT 1 AS ok FROM DUAL', {}, { outFormat: m.OUT_FORMAT_OBJECT, autoCommit: false, fetchTypeHandler });
          return { versao: `Oracle ${c.oracleServerVersionString ?? '?'} (driver thin)` };
        }),
      );
    },
    transacao: (fn) =>
      proteger(() =>
        comConexao(async (c) => {
          try {
            const r = await fn(executorDe(c, false));
            await c.commit();
            return r;
          } catch (e) {
            await c.rollback().catch(() => undefined);
            throw e;
          }
        }),
      ),
    async fechar() {
      const p = pool ?? (abrindo ? await abrindo.catch(() => null) : null);
      pool = null;
      abrindo = null;
      await p?.close(0).catch(() => undefined);
    },
  };
}
