import { describe, expect, it } from 'vitest';
import { ehErroDeConexao, ErroConexaoErp } from '../src/erp/driver';
import { converterParametros } from '../src/erp/postgres';
import { criarConexaoSqlServer, type ModuloMssql, type RequestMssql } from '../src/erp/sqlserver';
import { carregarSqlite } from '../src/util/sqlite';

describe('driver PostgreSQL: parâmetros nomeados', () => {
  it(':nome vira $n (reusa o mesmo índice), datas viram ISO UTC e ::cast é preservado', () => {
    const r = converterParametros('SELECT a::text FROM t WHERE x > :ini OR (x = :ini AND id > :id) LIMIT :limite', { ini: new Date('2026-01-01T00:00:00Z'), id: 'k', limite: 5 });
    expect(r.texto).toBe('SELECT a::text FROM t WHERE x > $1 OR (x = $1 AND id > $2) LIMIT $3');
    expect(r.valores).toEqual(['2026-01-01T00:00:00.000Z', 'k', 5]);
  });
  it('parâmetro usado e não informado é erro claro', () => {
    expect(() => converterParametros('SELECT :falta', {})).toThrow(/:falta/);
  });
});

/** Dublê do `mssql`: registra o SQL e as entradas. */
function dubleMssql() {
  const eventos: string[] = [];
  const entradas: { nome: string; tipo?: unknown; valor: unknown }[] = [];
  const req = (): RequestMssql => ({
    input(nome, tipoOuValor, valor) {
      entradas.push(valor === undefined ? { nome, valor: tipoOuValor } : { nome, tipo: tipoOuValor, valor });
      return this;
    },
    async query(sql) {
      eventos.push(`query:${sql}`);
      if (sql.includes('SERVERPROPERTY')) return { recordset: [{ v: '16.0.1000' }], rowsAffected: [1] };
      if (sql.includes('falha_sql')) throw Object.assign(new Error('violação de chave'), { code: 'EREQUEST' });
      if (sql.includes('cai_rede')) throw Object.assign(new Error('socket'), { code: 'ESOCKET' });
      return { recordset: [{ a: 1 }], rowsAffected: [3, 2] };
    },
  });
  const pool = { connect: async () => (eventos.push('connect'), pool), request: req, close: async () => void eventos.push('close'), on: () => undefined };
  const modulo: ModuloMssql = {
    ConnectionPool: function () {
      return pool;
    } as unknown as ModuloMssql['ConnectionPool'],
    Transaction: function () {
      return { begin: async () => void eventos.push('begin'), commit: async () => void eventos.push('commit'), rollback: async () => void eventos.push('rollback'), request: req };
    } as unknown as ModuloMssql['Transaction'],
    DateTime2: (n) => `datetime2(${n})`,
  };
  return { modulo, eventos, entradas };
}

describe('driver SQL Server (mssql dublê)', () => {
  const opcoes = { host: 'h', banco: 'b', usuario: 'u', senha: 's' };

  it(':nome vira @nome; datas vão como datetime2(3); consulta devolve as linhas', async () => {
    const d = dubleMssql();
    const c = await criarConexaoSqlServer(opcoes, d.modulo);
    const linhas = await c.consultar('SELECT TOP (:limite) * FROM v WHERE alt > :ini AND id > :id', { limite: 10, ini: new Date('2026-01-01T00:00:00Z'), id: 'k' });
    expect(linhas).toEqual([{ a: 1 }]);
    expect(d.eventos).toContain('query:SELECT TOP (@limite) * FROM v WHERE alt > @ini AND id > @id');
    expect(d.entradas.find((e) => e.nome === 'ini')).toMatchObject({ tipo: 'datetime2(3)' });
    expect(d.entradas.find((e) => e.nome === 'limite')?.valor).toBe(10);
  });

  it('testar devolve a versão; executar soma as linhas afetadas', async () => {
    const c = await criarConexaoSqlServer(opcoes, dubleMssql().modulo);
    expect(await c.testar()).toEqual({ versao: '16.0.1000' });
    expect(await c.executar('UPDATE x SET a = :a', { a: 1 })).toEqual({ linhasAfetadas: 5 });
  });

  it('transação confirma no sucesso e desfaz na falha', async () => {
    const d = dubleMssql();
    const c = await criarConexaoSqlServer(opcoes, d.modulo);
    await c.transacao(async (tx) => void (await tx.executar('INSERT 1')));
    await expect(c.transacao(async (tx) => void (await tx.executar('falha_sql')))).rejects.toThrow('violação');
    expect(d.eventos.filter((e) => ['begin', 'commit', 'rollback'].includes(e))).toEqual(['begin', 'commit', 'begin', 'rollback']);
  });

  it('erro de rede vira ErroConexaoErp (transitório); erro de SQL continua erro de SQL', async () => {
    const c = await criarConexaoSqlServer(opcoes, dubleMssql().modulo);
    await expect(c.consultar('cai_rede')).rejects.toBeInstanceOf(ErroConexaoErp);
    await expect(c.consultar('falha_sql')).rejects.not.toBeInstanceOf(ErroConexaoErp);
  });
});

describe('classificação de erros do banco do ERP', () => {
  it('rede, login e classes 08/53/57P do PostgreSQL são de conexão; violação de restrição não é', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'ELOGIN', '08006', '57P01', '53300', '40P01']) expect(ehErroDeConexao({ code })).toBe(true);
    for (const code of ['23503', '42601', 'EREQUEST']) expect(ehErroDeConexao({ code })).toBe(false);
    expect(ehErroDeConexao(new Error('x'))).toBe(false);
    expect(ehErroDeConexao(Object.assign(new AggregateError([{ code: 'ECONNREFUSED' }]), {}))).toBe(true);
  });
});

describe('node:sqlite', () => {
  it('carrega sem emitir o aviso experimental e abre um banco em memória', () => {
    const avisos: string[] = [];
    const ouvinte = (w: Error) => void avisos.push(w.message);
    process.on('warning', ouvinte);
    const { DatabaseSync } = carregarSqlite();
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t(a INTEGER)');
    db.prepare('INSERT INTO t VALUES (?)').run(7);
    expect((db.prepare('SELECT a FROM t').get() as { a: number }).a).toBe(7);
    process.off('warning', ouvinte);
    expect(avisos.filter((m) => /sqlite/i.test(m))).toEqual([]);
  });
});
