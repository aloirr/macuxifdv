/**
 * Adaptador Oracle (T-0023): testes de unidade com dublê do `oracledb` (SQL gerado, binds, paginação nos dois modos, conversão de tipos,
 * erros) + teste de integração que só roda com um Oracle real (MACUXI_ORACLE_URL); sem ele PULA com aviso.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { ErroConexaoErp } from '../src/erp/driver';
import { abrirConexaoErp } from '../src/erp/fabrica';
import {
  ALTER_SESSION,
  criarConexaoOracle,
  criarFetchTypeHandler,
  dataOracle,
  ehErroConexaoOracle,
  numeroOracle,
  paginarConsulta,
  prepararBinds,
  usaLimiteProprio,
  type ConexaoOracleDriver,
  type ModuloOracle,
  type OpcoesExecucao,
} from '../src/erp/oracle';
import { decimalParaCentavos, mapearEValidar } from '../src/mapeamento';
import { configDeTeste } from './suporte/ambiente';

// ---------- dublê do driver ----------
const T = {
  DATE: Symbol('DATE'), TIMESTAMP: Symbol('TIMESTAMP'), TIMESTAMP_TZ: Symbol('TIMESTAMP_TZ'), TIMESTAMP_LTZ: Symbol('TIMESTAMP_LTZ'),
  NUMBER: Symbol('NUMBER'), VARCHAR: Symbol('VARCHAR'), CLOB: Symbol('CLOB'), NCLOB: Symbol('NCLOB'), RAW: Symbol('RAW'),
};
interface Execucao { sql: string; binds: Record<string, unknown>; opcoes: OpcoesExecucao }

function criarDuble(opcoes: { rows?: Record<string, unknown>[]; falhar?: (sql: string) => Error | null } = {}) {
  const execs: Execucao[] = [];
  const eventos: string[] = [];
  const atributos: Record<string, unknown>[] = [];
  let abertas = 0;
  const conexao = (): ConexaoOracleDriver => {
    abertas++;
    return {
      oracleServerVersionString: '19.3.0.0.0',
      async execute(sql, binds, o) {
        const erro = opcoes.falhar?.(sql);
        if (erro) throw erro;
        execs.push({ sql, binds, opcoes: o });
        return sql.startsWith('ALTER SESSION') || sql.startsWith('SELECT 1') ? { rows: [] } : { rows: opcoes.rows ?? [], rowsAffected: 1 };
      },
      async commit() { eventos.push('commit'); },
      async rollback() { eventos.push('rollback'); },
      async close() { abertas--; eventos.push('close'); },
    };
  };
  const modulo: ModuloOracle = {
    async createPool(attrs) {
      atributos.push(attrs);
      const n = atributos.length;
      return { getConnection: async () => conexao(), close: async () => void eventos.push(n === 1 ? 'pool.close' : `pool${n}.close`) };
    },
    OUT_FORMAT_OBJECT: 4002,
    DB_TYPE_DATE: T.DATE, DB_TYPE_TIMESTAMP: T.TIMESTAMP, DB_TYPE_TIMESTAMP_TZ: T.TIMESTAMP_TZ, DB_TYPE_TIMESTAMP_LTZ: T.TIMESTAMP_LTZ,
    DB_TYPE_NUMBER: T.NUMBER, DB_TYPE_VARCHAR: T.VARCHAR, DB_TYPE_CLOB: T.CLOB, DB_TYPE_NCLOB: T.NCLOB,
  };
  return { modulo, execs, eventos, atributos, abertas: () => abertas, consultasDeNegocio: () => execs.filter((e) => !e.sql.startsWith('ALTER SESSION')) };
}
const base = { host: 'orahost', banco: 'ORCLPDB1', usuario: 'macuxi_leitura', senha: 'segredo-do-banco' };

const SQL_DELTA = 'SELECT codigo AS external_id, alterado_em FROM vw_macuxi_cliente WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND codigo > :cursor_external_id) ORDER BY alterado_em, codigo';
const PARAMS_DELTA = { cursor_alterado_em: new Date('2026-03-01T10:00:00.000Z'), cursor_alterado_em_ms: Date.parse('2026-03-01T10:00:00.000Z'), cursor_external_id: 'c1', limite: 6 };

describe('Oracle: conexão (modo thin, sem Instant Client)', () => {
  it('monta o pool com Easy Connect host:porta/serviço, pool pequeno e timeouts; sessão fixada em UTC/NLS a cada conexão', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle({ ...base, timeoutMs: 20_000 }, d.modulo);
    expect(erp.tipo).toBe('oracle');
    await erp.consultar(SQL_DELTA, PARAMS_DELTA);
    expect(d.atributos[0]).toMatchObject({ user: 'macuxi_leitura', connectString: 'orahost:1521/ORCLPDB1', poolMin: 0, poolMax: 3, connectTimeout: 20, queueTimeout: 20_000 });
    expect(d.atributos[0]).not.toHaveProperty('sslServerDNMatch');
    expect(d.execs[0]?.sql).toBe(ALTER_SESSION);
    expect(ALTER_SESSION).toMatch(/TIME_ZONE = '\+00:00'.*NLS_NUMERIC_CHARACTERS = '\.,'.*NLS_DATE_FORMAT.*NLS_TIMESTAMP_FORMAT.*NLS_TIMESTAMP_TZ_FORMAT/s);
    expect(d.abertas()).toBe(0); // a conexão volta ao pool
    await erp.fechar();
    expect(d.eventos).toContain('pool.close');
  });

  it('TLS: criptografar usa tcps:// (porta 2484 por padrão), confiarCertificado desliga a conferência do DN e a carteira vai ao driver', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle({ ...base, criptografar: true, confiarCertificado: true, carteira: 'C:\\wallet' }, d.modulo);
    await erp.consultar(SQL_DELTA, PARAMS_DELTA);
    expect(d.atributos[0]).toMatchObject({ connectString: 'tcps://orahost:2484/ORCLPDB1', sslServerDNMatch: false, walletLocation: 'C:\\wallet' });
    const d2 = criarDuble();
    await (await criarConexaoOracle({ ...base, criptografar: true, porta: 2490 }, d2.modulo)).consultar(SQL_DELTA, PARAMS_DELTA);
    expect(d2.atributos[0]).toMatchObject({ connectString: 'tcps://orahost:2490/ORCLPDB1', sslServerDNMatch: true });
  });

  it('o código do adaptador nunca inicializa o cliente nativo (somente thin) e o pacote real carrega em thin', async () => {
    const fonte = readFileSync(join(__dirname, '..', 'src', 'erp', 'oracle.ts'), 'utf8');
    expect(fonte).not.toMatch(/initOracleClient\s*\(/);
    expect(fonte).not.toMatch(/thin\s*=\s*false/);
    const real = (await import('oracledb')).default as unknown as { thin: boolean; versionString?: string };
    expect(real.thin).toBe(true);
  });

  it('a fábrica abre o adaptador Oracle (sem conectar até a primeira consulta)', async () => {
    const cfg = interpretarConfig(JSON.stringify(configOracle()), 'json');
    const erp = await abrirConexaoErp(cfg.erp, 'senha-qualquer');
    expect(erp.tipo).toBe('oracle');
    await erp.fechar();
  });

  it('testar() informa a versão do servidor e o modo thin', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle(base, d.modulo);
    expect(await erp.testar()).toEqual({ versao: 'Oracle 19.3.0.0.0 (driver thin)' });
  });
});

describe('Oracle: consultas parametrizadas (binds), nunca valor concatenado', () => {
  it('só os :nomes que aparecem no SQL viram binds; Date vai como TIMESTAMP WITH TIME ZONE; o SQL com :limite próprio roda como está', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle(base, d.modulo);
    const comLimite = `${SQL_DELTA} FETCH FIRST :limite ROWS ONLY`;
    await erp.consultar(comLimite, PARAMS_DELTA);
    const e = d.consultasDeNegocio()[0] as Execucao;
    expect(e.sql).toBe(comLimite); // paginação manual do técnico: nada é reescrito
    expect(Object.keys(e.binds).sort()).toEqual(['cursor_alterado_em', 'cursor_external_id', 'limite']); // cursor_alterado_em_ms não está no SQL
    expect(e.binds.cursor_alterado_em).toEqual({ val: PARAMS_DELTA.cursor_alterado_em, type: T.TIMESTAMP_TZ });
    expect(e.binds.cursor_external_id).toBe('c1');
    expect(e.binds.limite).toBe(6);
    expect(e.opcoes).toMatchObject({ outFormat: 4002, autoCommit: false });
  });

  it('valor malicioso fica no bind e nunca entra no texto do SQL', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle(base, d.modulo);
    const veneno = "x'; DROP TABLE cliente; --";
    await erp.consultar(SQL_DELTA, { ...PARAMS_DELTA, cursor_external_id: veneno });
    const e = d.consultasDeNegocio()[0] as Execucao;
    expect(e.sql).not.toContain('DROP');
    expect(e.binds.cursor_external_id).toBe(veneno);
  });

  it('parâmetro usado no SQL mas não informado é erro explícito; null/boolean/bigint viram binds seguros; literal e comentário não contam', () => {
    const m = criarDuble().modulo;
    expect(() => prepararBinds('SELECT :a FROM dual', {}, m)).toThrow('Parâmetro :a usado no SQL, mas não informado.');
    const b = prepararBinds("SELECT ':nao_bind', :n, :b, :g, :v FROM dual /* :comentario */ -- :outro", { n: null, b: true, g: 10n, v: 'ok' }, m);
    expect(b).toEqual({ n: { val: null, type: T.VARCHAR }, b: 1, g: '10', v: 'ok' });
  });

  it('executar: autoCommit ligado fora de transação; dados do pedido como binds tipados', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle(base, d.modulo);
    const r = await erp.executar('INSERT INTO ped_entrada (uuid, criado_em, total_cents) VALUES (:pedido_uuid, :criado_em, :total_cents)', {
      pedido_uuid: 'u-1', criado_em: new Date('2026-03-10T11:00:00Z'), total_cents: 3000,
    });
    expect(r.linhasAfetadas).toBe(1);
    const e = d.consultasDeNegocio()[0] as Execucao;
    expect(e.opcoes.autoCommit).toBe(true);
    expect(e.binds).toEqual({ pedido_uuid: 'u-1', criado_em: { val: new Date('2026-03-10T11:00:00Z'), type: T.TIMESTAMP_TZ }, total_cents: 3000 });
  });

  it('transação: confirma ao terminar, desfaz se lançar, e sempre devolve a conexão', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle(base, d.modulo);
    await erp.transacao(async (tx) => {
      await tx.executar('INSERT INTO t VALUES (:a)', { a: 1 });
    });
    expect(d.eventos).toEqual(['commit', 'close']);
    expect(d.consultasDeNegocio()[0]?.opcoes.autoCommit).toBe(false);
    d.eventos.length = 0;
    await expect(
      erp.transacao(async (tx) => {
        await tx.executar('INSERT INTO t VALUES (:a)', { a: 1 });
        throw new Error('regra do ERP');
      }),
    ).rejects.toThrow('regra do ERP');
    expect(d.eventos).toEqual(['rollback', 'close']);
    expect(d.abertas()).toBe(0);
  });

  it('colunas voltam em minúsculas (o Oracle devolve MAIÚSCULAS) e a coluna auxiliar da paginação por ROWNUM some', async () => {
    const d = criarDuble({ rows: [{ EXTERNAL_ID: 'c1', ALTERADO_EM: new Date('2026-03-01T10:00:00Z'), MACUXI_RN: 1 }] });
    const erp = await criarConexaoOracle({ ...base, paginacao: 'rownum' }, d.modulo);
    const linhas = await erp.consultar(SQL_DELTA, { ...PARAMS_DELTA, offset: 100 });
    expect(Object.keys(linhas[0] as object).sort()).toEqual(['alterado_em', 'external_id']);
  });
});

describe('Oracle: paginação (erp.paginacao)', () => {
  it('offset (12c+): acrescenta OFFSET/FETCH ao SELECT com ORDER BY, com binds', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle({ ...base, paginacao: 'offset' }, d.modulo);
    await erp.consultar(SQL_DELTA, PARAMS_DELTA);
    const e = d.consultasDeNegocio()[0] as Execucao;
    expect(e.sql).toBe(`${SQL_DELTA}\nOFFSET :macuxi_offset ROWS FETCH NEXT :limite ROWS ONLY`);
    expect(e.binds.limite).toBe(6);
    expect(e.binds.macuxi_offset).toBe(0); // leitura por cursor (keyset): sempre a primeira página do filtro
  });

  it('offset é o padrão quando a configuração não diz nada', async () => {
    const d = criarDuble();
    await (await criarConexaoOracle(base, d.modulo)).consultar(SQL_DELTA, PARAMS_DELTA);
    expect(d.consultasDeNegocio()[0]?.sql).toContain('FETCH NEXT :limite ROWS ONLY');
  });

  it('rownum (11g): envolve o SELECT ordenado numa vista inline com ROWNUM <= :limite', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle({ ...base, paginacao: 'rownum' }, d.modulo);
    await erp.consultar(SQL_DELTA, PARAMS_DELTA);
    const e = d.consultasDeNegocio()[0] as Execucao;
    expect(e.sql).toBe(`SELECT * FROM (\n${SQL_DELTA}\n) WHERE ROWNUM <= :limite`);
    expect(Object.keys(e.binds).sort()).toEqual(['cursor_alterado_em', 'cursor_external_id', 'limite']);
    expect(e.binds.limite).toBe(6);
  });

  it('rownum com deslocamento (página numerada): janela por ROWNUM com binds de fim e início', async () => {
    const p = paginarConsulta('SELECT a FROM t ORDER BY a;', 'rownum', true);
    expect(p.sql).toBe('SELECT * FROM (SELECT macuxi_t.*, ROWNUM macuxi_rn FROM (\nSELECT a FROM t ORDER BY a\n) macuxi_t WHERE ROWNUM <= :macuxi_fim) WHERE macuxi_rn > :macuxi_offset');
    const d = criarDuble();
    const erp = await criarConexaoOracle({ ...base, paginacao: 'rownum' }, d.modulo);
    await erp.consultar('SELECT a FROM t ORDER BY a', { limite: 10, offset: 20 });
    expect(d.consultasDeNegocio()[0]?.binds).toEqual({ macuxi_fim: 30, macuxi_offset: 20 });
  });

  it('ponto e vírgula final e comentário na última linha não quebram a paginação', () => {
    expect(paginarConsulta('SELECT 1 FROM dual ORDER BY 1 ;  \n', 'offset').sql).toBe('SELECT 1 FROM dual ORDER BY 1\nOFFSET :macuxi_offset ROWS FETCH NEXT :limite ROWS ONLY');
    const comComentario = paginarConsulta('SELECT 1 FROM dual ORDER BY 1 -- ordem', 'offset').sql;
    expect(comComentario).toBe('SELECT 1 FROM dual ORDER BY 1 -- ordem\nOFFSET :macuxi_offset ROWS FETCH NEXT :limite ROWS ONLY');
  });

  it(':limite no SQL (inclusive escrito pelo técnico) desliga a paginação do Conector; em literal/comentário não conta', () => {
    expect(usaLimiteProprio('SELECT * FROM t FETCH FIRST :limite ROWS ONLY')).toBe(true);
    expect(usaLimiteProprio("SELECT ':limite' FROM t -- :limite")).toBe(false);
  });

  it('limite inválido é erro claro (nunca vira SQL malformado)', async () => {
    const d = criarDuble();
    const erp = await criarConexaoOracle(base, d.modulo);
    await expect(erp.consultar(SQL_DELTA, { ...PARAMS_DELTA, limite: 0 })).rejects.toThrow(/:limite deve ser um inteiro/);
    await expect(erp.consultar(SQL_DELTA, { ...PARAMS_DELTA, limite: '5; DROP' })).rejects.toThrow(/:limite deve ser um inteiro/);
  });

  it('Oracle anterior à 12c no modo offset: o erro ORA-00933 vem com a dica de usar rownum', async () => {
    const d = criarDuble({ falhar: (sql) => (sql.includes('OFFSET') ? new Error('ORA-00933: SQL command not properly ended') : null) });
    const erp = await criarConexaoOracle({ ...base, paginacao: 'offset' }, d.modulo);
    await expect(erp.consultar(SQL_DELTA, PARAMS_DELTA)).rejects.toThrow(/anterior à 12c.*"erp\.paginacao": "rownum"/s);
  });
});

describe('Oracle: tipos → contrato (datas UTC ISO, dinheiro em centavos inteiros)', () => {
  const handler = criarFetchTypeHandler(criarDuble().modulo);
  const converter = (tipo: symbol, valor: unknown) => {
    const r = handler({ name: 'X', dbType: tipo });
    return r?.converter ? r.converter(valor) : valor;
  };

  it('DATE / TIMESTAMP / TIMESTAMP WITH LOCAL TIME ZONE chegam como texto (formato de sessão, UTC) e viram Date UTC', () => {
    expect(handler({ name: 'X', dbType: T.DATE })?.type).toBe(T.VARCHAR);
    expect(converter(T.DATE, '2026-03-10T11:30:15')).toEqual(new Date('2026-03-10T11:30:15.000Z'));
    expect(converter(T.TIMESTAMP, '2026-03-10T11:30:15.123')).toEqual(new Date('2026-03-10T11:30:15.123Z'));
    expect(converter(T.TIMESTAMP_LTZ, '2026-03-10T11:30:15.5')).toEqual(new Date('2026-03-10T11:30:15.500Z'));
  });

  it('TIMESTAMP WITH TIME ZONE respeita o deslocamento do valor (instante exato em UTC)', () => {
    expect(converter(T.TIMESTAMP_TZ, '2026-03-10T08:30:15.000-03:00')).toEqual(new Date('2026-03-10T11:30:15.000Z'));
    expect(converter(T.TIMESTAMP_TZ, '2026-03-10T11:30:15.000+00:00')).toEqual(new Date('2026-03-10T11:30:15.000Z'));
    expect((converter(T.TIMESTAMP_TZ, '2026-03-10T08:30:15.000-03:00') as Date).toISOString()).toBe('2026-03-10T11:30:15.000Z');
  });

  it('data fora do formato esperado fica como texto (o mapeamento aponta o campo) e nulo continua nulo', () => {
    expect(dataOracle('10/03/2026')).toBeNull();
    expect(converter(T.DATE, '10/03/2026')).toBe('10/03/2026');
    expect(converter(T.DATE, null)).toBeNull();
  });

  it('NUMBER chega como texto: inteiro seguro vira number; decimal fica texto exato (sem ponto flutuante)', () => {
    expect(handler({ name: 'X', dbType: T.NUMBER })?.type).toBe(T.VARCHAR);
    expect(converter(T.NUMBER, '42')).toBe(42);
    expect(converter(T.NUMBER, '-7')).toBe(-7);
    expect(converter(T.NUMBER, '19.99')).toBe('19.99');
    expect(converter(T.NUMBER, '.5')).toBe('0.5'); // o Oracle omite o zero à esquerda
    expect(converter(T.NUMBER, '-.25')).toBe('-0.25');
    expect(converter(T.NUMBER, '19.90')).toBe('19.9');
    expect(converter(T.NUMBER, '12.00')).toBe(12);
    expect(converter(T.NUMBER, '9007199254740993')).toBe('9007199254740993'); // além de 2^53: texto, nada de arredondar
    expect(numeroOracle('1E-7')).toBe('0.0000001');
    expect(numeroOracle('1.5E+3')).toBe(1500);
    expect(numeroOracle('abc')).toBe('abc');
    expect(converter(T.NUMBER, null)).toBeNull();
  });

  it('CLOB/NCLOB (colunas JSON) chegam como texto; outros tipos seguem o padrão do driver', () => {
    expect(handler({ name: 'X', dbType: T.CLOB })?.type).toBe(T.VARCHAR);
    expect(handler({ name: 'X', dbType: T.NCLOB })?.type).toBe(T.VARCHAR);
    expect(converter(T.CLOB, '[{"nome":"x"}]')).toBe('[{"nome":"x"}]');
    expect(handler({ name: 'X', dbType: T.VARCHAR })).toBeUndefined();
    expect(handler({ name: 'X', dbType: T.RAW })).toBeUndefined();
  });

  it('o fetchTypeHandler é entregue ao driver em toda execução', async () => {
    const d = criarDuble();
    await (await criarConexaoOracle(base, d.modulo)).consultar(SQL_DELTA, PARAMS_DELTA);
    expect(typeof d.consultasDeNegocio()[0]?.opcoes.fetchTypeHandler).toBe('function');
  });

  it('dinheiro: NUMBER(12,2) em texto vira centavos inteiros sem erro de ponto flutuante (mapeamento centavos_de_decimal)', () => {
    // 19.99 * 100 em ponto flutuante dá 1998.9999999999998; 1.005 * 100 dá 100.49999999999999
    expect(19.99 * 100).not.toBe(1999);
    expect(decimalParaCentavos('19.99')).toBe(1999);
    expect(decimalParaCentavos('1.005')).toBe(101);
    expect(decimalParaCentavos('0.5')).toBe(50);
    expect(decimalParaCentavos('-2.345')).toBe(-235);
    expect(decimalParaCentavos('1234567890.12')).toBe(123456789012);
    expect(decimalParaCentavos('0.004')).toBe(0);
    expect(decimalParaCentavos('1,5')).toBeNull();
    expect(decimalParaCentavos('99999999999999999.99')).toBeNull();
  });

  it('ponta a ponta: linha do Oracle (colunas minúsculas, NUMBER em texto, datas Date) → registro do contrato', () => {
    const cfg = configDeTeste('http://127.0.0.1:1', '.').entidades.cliente;
    const campos = { ...(cfg?.campos ?? {}), bloqueado: { coluna: 'bloqueado', transformar: 'booleano' as const }, limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal' as const } };
    const m = mapearEValidar('cliente', { ...(cfg as NonNullable<typeof cfg>), campos }, [
      { external_id: 'c1', alterado_em: dataOracle('2026-03-10T11:30:15.250'), razao_social: 'Mercado Sol', bloqueado: 0, limite: '1500.99' },
    ]);
    expect(m.problemas).toEqual([]);
    expect(m.registros[0]).toMatchObject({ external_id: 'c1', alterado_em: '2026-03-10T11:30:15.250Z', limite_credito_cents: 150099, bloqueado: false });
  });
});

describe('Oracle: erros (conexão × SQL)', () => {
  it('falha de rede/indisponibilidade vira ErroConexaoErp (transitório, o Conector tenta depois); erro de SQL passa como está', async () => {
    for (const msg of ['NJS-503: connection to host orahost port 1521 terminated unexpectedly', 'ORA-12541: TNS:no listener', 'ORA-03113: end-of-file on communication channel', 'NJS-500: connection to the database was lost']) {
      const d = criarDuble({ falhar: (sql) => (sql.startsWith('ALTER') ? new Error(msg) : null) });
      const erp = await criarConexaoOracle(base, d.modulo);
      await expect(erp.consultar(SQL_DELTA, PARAMS_DELTA), msg).rejects.toBeInstanceOf(ErroConexaoErp);
    }
    const d = criarDuble({ falhar: (sql) => (sql.includes('vw_macuxi') ? new Error('ORA-00942: table or view does not exist') : null) });
    const erp = await criarConexaoOracle(base, d.modulo);
    const e = await erp.consultar(SQL_DELTA, PARAMS_DELTA).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(ErroConexaoErp);
    expect((e as Error).message).toContain('ORA-00942');
    expect(d.abertas()).toBe(0);
  });

  it('T-0048: no erro de conexão o pool quebrado é FECHADO (não fica preso até o poolTimeout) e o próximo uso abre um novo', async () => {
    let cair = true;
    const d = criarDuble({ falhar: (sql) => (cair && sql.startsWith('ALTER') ? new Error('ORA-03113: end-of-file on communication channel') : null) });
    const erp = await criarConexaoOracle(base, d.modulo);
    await expect(erp.consultar(SQL_DELTA, PARAMS_DELTA)).rejects.toBeInstanceOf(ErroConexaoErp);
    await Promise.resolve();
    expect(d.eventos).toContain('pool.close');
    cair = false;
    await erp.consultar(SQL_DELTA, PARAMS_DELTA);
    expect(d.atributos).toHaveLength(2); // pool novo
    expect(d.eventos).not.toContain('pool2.close');
  });

  it('a mensagem de indisponibilidade não carrega a senha nem o texto bruto do driver', async () => {
    const d = criarDuble({ falhar: (sql) => (sql.startsWith('ALTER') ? new Error('NJS-503: falha com password=segredo-do-banco') : null) });
    const erp = await criarConexaoOracle(base, d.modulo);
    const e = (await erp.consultar(SQL_DELTA, PARAMS_DELTA).catch((x: unknown) => x)) as Error;
    expect(e.message).toBe('Banco do ERP indisponível (NJS-503)');
  });

  it('classificação: login inválido (ORA-01017) e objeto inexistente não são "conexão"', () => {
    expect(ehErroConexaoOracle(new Error('ORA-01017: invalid credential or not authorized'))).toBe(false);
    expect(ehErroConexaoOracle(new Error('ORA-00942: table or view does not exist'))).toBe(false);
    expect(ehErroConexaoOracle(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
  });
});

describe('Oracle: configuração', () => {
  it('aceita tipo oracle com paginação e carteira; consulta sem :limite vale só para Oracle', () => {
    const cfg = interpretarConfig(JSON.stringify(configOracle({ paginacao: 'rownum', carteira: 'C:\\wallet' })), 'json');
    expect(cfg.erp).toMatchObject({ tipo: 'oracle', paginacao: 'rownum', carteira: 'C:\\wallet' });
    expect(() => interpretarConfig(JSON.stringify({ ...configOracle(), erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u', criptografar: false } }), 'json')).toThrow(/:limite/);
    expect(interpretarConfig(JSON.stringify(configOracle()), 'json').erp.paginacao).toBe('offset');
  });

  it('o cursor continua obrigatório no Oracle, e paginação inválida e carteira fora do Oracle são recusadas', () => {
    const semCursor = configOracle();
    (semCursor.entidades.cliente as { consulta: string }).consulta = 'SELECT * FROM v ORDER BY 1';
    expect(() => interpretarConfig(JSON.stringify(semCursor), 'json')).toThrow(/:cursor_alterado_em/);
    expect(() => interpretarConfig(JSON.stringify(configOracle({ paginacao: 'limit' })), 'json')).toThrow(/paginacao/);
    const pg = { ...configOracle(), erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u', carteira: 'x' } };
    (pg.entidades.cliente as { consulta: string }).consulta += ' LIMIT :limite';
    expect(() => interpretarConfig(JSON.stringify(pg), 'json')).toThrow(/erp\.carteira só vale para o Oracle/);
  });

  it('o exemplo de configuração para Oracle (exemplos/conector.oracle.exemplo.json) é válido', () => {
    const texto = readFileSync(join(__dirname, '..', 'exemplos', 'conector.oracle.exemplo.json'), 'utf8');
    const cfg = interpretarConfig(texto, 'json');
    expect(cfg.erp.tipo).toBe('oracle');
    expect(cfg.pedidos?.gravacao.cabecalho).toContain(':pedido_uuid');
  });
});

function configOracle(erp: Record<string, unknown> = {}) {
  return {
    hub: { url: 'https://hub.exemplo.com', conectorId: 'cnx-ora-1' },
    erp: { tipo: 'oracle', host: 'orahost', banco: 'ORCLPDB1', usuario: 'macuxi_leitura', criptografar: false, ...erp },
    entidades: {
      cliente: {
        consulta: SQL_DELTA,
        campos: { external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social' },
      },
    },
  } as { hub: Record<string, unknown>; erp: Record<string, unknown>; entidades: { cliente: Record<string, unknown> } };
}

// ---------- integração com Oracle real (opcional) ----------
const urlOracle = process.env.MACUXI_ORACLE_URL;
if (!urlOracle) {
  console.warn('\n[conector] MACUXI_ORACLE_URL não definida (ex.: usuario/senha@host:1521/servico): teste de integração com Oracle real PULADO. Os testes de unidade com dublê do driver rodaram.\n');
}

describe.skipIf(!urlOracle)('Oracle real (MACUXI_ORACLE_URL)', () => {
  const partes = /^([^/]+)\/([^@]+)@([^:/]+)(?::(\d+))?\/(.+)$/.exec(urlOracle ?? '');
  it('MACUXI_ORACLE_URL tem o formato usuario/senha@host:porta/servico', () => {
    expect(partes, 'formato esperado: usuario/senha@host:1521/servico').not.toBeNull();
  });

  it('consulta paginada nos dois modos, datas em UTC e dinheiro exato, contra o banco real (somente leitura: usa DUAL)', async () => {
    const [, usuario, senha, host, porta, servico] = partes as RegExpExecArray;
    for (const paginacao of ['offset', 'rownum'] as const) {
      const erp = await criarConexaoOracle({ host: host as string, porta: porta ? Number(porta) : 1521, banco: servico as string, usuario: usuario as string, senha: senha as string, paginacao, timeoutMs: 20_000 });
      try {
        expect((await erp.testar()).versao).toMatch(/Oracle .*thin/);
        const sql = `SELECT LEVEL AS n, TO_TIMESTAMP_TZ('2026-03-10 08:30:15 -03:00','YYYY-MM-DD HH24:MI:SS TZH:TZM') AS em_tz, CAST(TIMESTAMP '2026-03-10 11:30:15' AS DATE) AS em_data,
          CAST(19.99 AS NUMBER(12,2)) AS preco FROM DUAL CONNECT BY LEVEL <= 10 ORDER BY 1`;
        const linhas = await erp.consultar(sql, { limite: 3 });
        expect(linhas.map((l) => l.n)).toEqual([1, 2, 3]);
        expect(linhas[0]?.em_tz).toEqual(new Date('2026-03-10T11:30:15.000Z'));
        expect(linhas[0]?.em_data).toEqual(new Date('2026-03-10T11:30:15.000Z'));
        expect(decimalParaCentavos(String(linhas[0]?.preco))).toBe(1999);
        // bind de data: ida e volta sem deslocamento de fuso
        const eco = await erp.consultar("SELECT TO_CHAR(CAST(:d AS TIMESTAMP WITH TIME ZONE), 'YYYY-MM-DD\"T\"HH24:MI:SS TZH:TZM') AS txt FROM DUAL", { d: new Date('2026-03-10T11:30:15.000Z') });
        expect(String(eco[0]?.txt)).toContain('2026-03-10T11:30:15 +00:00');
      } finally {
        await erp.fechar();
      }
    }
  });
});
