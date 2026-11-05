/**
 * Papéis de login da aplicação (db/src/papeis.ts) — B0 do plano B do DBaaS (T-0075, 05/11): o CREATE leva os atributos;
 * o papel existente recebe só LOGIN e a senha (nenhum atributo citado no ALTER ROLE, que no PG 16 exige superusuário);
 * os atributos do existente são conferidos em pg_roles e um atributo indevido falha com mensagem clara, sem alterar
 * nada; a senha vai como verificador SCRAM quando o servidor usa scram-sha-256.
 * Estático (sempre, cliente falso) + banco (papéis descartáveis macuxi_tpapel_*, apagados no fim; nada da fixture muda).
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ATRIBUTOS_DO_PAPEL, atributosIndevidos, comandoDoPapel, garantirPapelDeLogin, mensagemAtributosIndevidos, senhaDoPapel, type AtributosPapel,
} from '../src/papeis';
import { verificadorScram } from '../src/scram';
import { banco, semBanco } from './estado';
import { comCliente } from './util';

const CERTOS: AtributosPapel = { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false };
const SCRAM = /^SCRAM-SHA-256\$(\d+):[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

/** Cliente pg falso: `papel` = linha de pg_roles (undefined = não existe); `cifra`/`iteracoes` = current_setting. */
function clienteFalso(papel: AtributosPapel | undefined, cifra: string | null = 'scram-sha-256', iteracoes: string | null = '4096') {
  const consultas: string[] = [];
  const cliente = {
    host: 'localhost',
    consultas,
    escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
    query: async (sql: string) => {
      consultas.push(sql);
      if (sql.startsWith('select rolsuper')) return { rows: papel ? [papel] : [], rowCount: papel ? 1 : 0 };
      if (sql.includes("current_setting('password_encryption'")) return { rows: [{ cifra, iteracoes }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return cliente as typeof cliente & Parameters<typeof garantirPapelDeLogin>[0];
}

const comandoDeRole = (consultas: string[]) => consultas.filter((q) => /^(create|alter) role /.test(q));

describe('papéis: regras puras (estático)', () => {
  it('atributosIndevidos: ordem fixa e só os ligados', () => {
    expect(atributosIndevidos(CERTOS)).toEqual([]);
    expect(atributosIndevidos({ ...CERTOS, rolbypassrls: true, rolsuper: true })).toEqual(['SUPERUSER', 'BYPASSRLS']);
    expect(atributosIndevidos({ rolsuper: true, rolbypassrls: true, rolcreatedb: true, rolcreaterole: true, rolreplication: true })).toEqual([
      'SUPERUSER', 'BYPASSRLS', 'CREATEDB', 'CREATEROLE', 'REPLICATION',
    ]);
  });

  it('comandoDoPapel: CREATE leva os atributos; ALTER só LOGIN e senha; nome de papel validado', () => {
    expect(comandoDoPapel('macuxi_app', false, "'x'")).toBe(`create role macuxi_app ${ATRIBUTOS_DO_PAPEL} password 'x'`);
    expect(ATRIBUTOS_DO_PAPEL).toBe('login nosuperuser nobypassrls nocreatedb nocreaterole noreplication');
    const alter = comandoDoPapel('macuxi_app', true, "'x'");
    expect(alter).toBe("alter role macuxi_app login password 'x'");
    expect(alter).not.toMatch(/superuser|bypassrls|replication|createdb|createrole/i);
    expect(() => comandoDoPapel('macuxi_app; drop role x', true, "'x'")).toThrow(/Nome de papel inválido/);
    expect(() => comandoDoPapel('Macuxi', false, "'x'")).toThrow(/Nome de papel inválido/);
  });

  it('senhaDoPapel: verificador SCRAM com as iterações do servidor; texto com md5, sem configuração ou fora do ASCII', () => {
    const s = senhaDoPapel('app-forte', { cifra: 'scram-sha-256', iteracoes: '4096' });
    expect(s.forma).toBe('scram');
    expect(s.valor).toMatch(SCRAM);
    expect(s.valor).not.toContain('app-forte');
    expect(SCRAM.exec(senhaDoPapel('app-forte', { cifra: 'scram-sha-256', iteracoes: '10000' }).valor)![1]).toBe('10000');
    // PG < 16 não tem scram_iterations: 4096, o fixo do servidor
    expect(SCRAM.exec(senhaDoPapel('app-forte', { cifra: 'scram-sha-256', iteracoes: null }).valor)![1]).toBe('4096');
    // mesmo sal = mesmo verificador que o cálculo de db/src/scram.ts
    const sal = randomBytes(16);
    expect(senhaDoPapel('app-forte', { cifra: 'scram-sha-256', iteracoes: 4096 }, sal).valor).toBe(verificadorScram('app-forte', sal, 4096));
    expect(senhaDoPapel('app-forte', { cifra: 'md5', iteracoes: '4096' })).toEqual({ valor: 'app-forte', forma: 'texto' });
    expect(senhaDoPapel('app-forte', { cifra: null, iteracoes: null })).toEqual({ valor: 'app-forte', forma: 'texto' });
    expect(senhaDoPapel('com espaço', { cifra: 'scram-sha-256', iteracoes: '4096' })).toEqual({ valor: 'com espaço', forma: 'texto' });
    expect(senhaDoPapel('senhaçã', { cifra: 'scram-sha-256', iteracoes: '4096' }).forma).toBe('texto');
    expect(senhaDoPapel('x', { cifra: 'scram-sha-256', iteracoes: 'abc' }).forma).toBe('texto');
  });

  it('verificadorScram confere com o exemplo da RFC 7677 (user/pencil)', () => {
    const sal = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const m = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verificadorScram('pencil', sal, 4096))!;
    expect(m[1]).toBe('W22ZaJ0SNY7soEsUEjb6gQ==');
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const mensagem = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    expect(createHmac('sha256', Buffer.from(m[3]!, 'base64')).update(mensagem).digest('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    const guardada = Buffer.from(m[2]!, 'base64');
    const prova = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const assinatura = createHmac('sha256', guardada).update(mensagem).digest();
    expect(createHash('sha256').update(Buffer.from(prova.map((b, i) => b ^ assinatura[i]!))).digest().equals(guardada)).toBe(true);
    expect(() => verificadorScram('com espaço')).toThrow();
  });

  it('mensagemAtributosIndevidos diz o papel, os atributos e a correção', () => {
    expect(mensagemAtributosIndevidos('macuxi_app', ['SUPERUSER', 'BYPASSRLS'])).toMatch(
      /O papel macuxi_app já existe com SUPERUSER, BYPASSRLS: .*alter role macuxi_app nosuperuser nobypassrls/,
    );
  });
});

describe('garantirPapelDeLogin com cliente falso (estático)', () => {
  it('papel novo: CREATE com os atributos e o verificador SCRAM, na transação com advisory lock', async () => {
    const c = clienteFalso(undefined);
    await garantirPapelDeLogin(c, 'macuxi_app', 'app-forte');
    expect(c.consultas[0]).toBe('begin');
    expect(c.consultas[1]).toMatch(/^select pg_advisory_xact_lock/);
    expect(c.consultas.at(-1)).toBe('commit');
    const [cmd, ...resto] = comandoDeRole(c.consultas);
    expect(resto).toEqual([]);
    expect(cmd).toMatch(new RegExp(`^create role macuxi_app ${ATRIBUTOS_DO_PAPEL} password 'SCRAM-SHA-256\\$4096:`));
    expect(c.consultas.join('\n')).not.toContain('app-forte');
  });

  it('papel existente com atributos certos: só LOGIN e senha, nenhum atributo citado', async () => {
    const c = clienteFalso(CERTOS);
    await garantirPapelDeLogin(c, 'macuxi_worker', 'worker-forte');
    const cmds = comandoDeRole(c.consultas);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatch(/^alter role macuxi_worker login password 'SCRAM-SHA-256\$4096:[^']+'$/);
    expect(cmds[0]).not.toMatch(/superuser|bypassrls|replication|createdb|createrole/i);
    expect(c.consultas.at(-1)).toBe('commit');
  });

  it('papel existente com SUPERUSER/BYPASSRLS: erro claro, nenhum CREATE/ALTER, rollback', async () => {
    const c = clienteFalso({ ...CERTOS, rolsuper: true, rolbypassrls: true });
    await expect(garantirPapelDeLogin(c, 'macuxi_app', 'app-forte')).rejects.toThrow(/O papel macuxi_app já existe com SUPERUSER, BYPASSRLS/);
    expect(comandoDeRole(c.consultas)).toEqual([]);
    expect(c.consultas.at(-1)).toBe('rollback');
    for (const coluna of ['rolcreatedb', 'rolcreaterole', 'rolreplication'] as const) {
      const d = clienteFalso({ ...CERTOS, [coluna]: true });
      await expect(garantirPapelDeLogin(d, 'macuxi_app', 'app-forte')).rejects.toThrow(/já existe com (CREATEDB|CREATEROLE|REPLICATION)/);
      expect(comandoDeRole(d.consultas)).toEqual([]);
    }
  });

  it('servidor com md5: senha em texto, como antes (comportamento sem SCRAM inalterado)', async () => {
    const c = clienteFalso(CERTOS, 'md5');
    await garantirPapelDeLogin(c, 'macuxi_app', 'app-forte');
    expect(comandoDeRole(c.consultas)).toEqual(["alter role macuxi_app login password 'app-forte'"]);
  });

  it('senha vazia é recusada sem tocar no banco', async () => {
    const c = clienteFalso(undefined);
    await expect(garantirPapelDeLogin(c, 'macuxi_app', '')).rejects.toThrow(/vazia/);
    expect(c.consultas).toEqual([]);
  });
});

describe.skipIf(semBanco())('garantirPapelDeLogin no Postgres dos testes (papéis descartáveis)', () => {
  const sufixo = randomBytes(4).toString('hex');
  const NOVO = `macuxi_tpapel_${sufixo}_n`;
  const NOLOGIN = `macuxi_tpapel_${sufixo}_l`;
  const RUIM = `macuxi_tpapel_${sufixo}_r`;
  const admin = <T>(fn: (c: pg.Client) => Promise<T>) => comCliente(banco().urlAdmin, fn);
  const atributos = (c: pg.Client, papel: string) =>
    c.query<AtributosPapel & { rolcanlogin: boolean }>(
      'select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin from pg_roles where rolname = $1',
      [papel],
    ).then((r) => r.rows[0]);
  /** Conecta como o papel no banco dos testes e devolve current_user (prova que LOGIN e a senha valem). */
  const entrarComo = async (papel: string, senha: string) => {
    const url = new URL(banco().urlAdmin);
    url.username = papel;
    url.password = senha;
    return comCliente(url.toString(), (c) => c.query<{ u: string }>('select current_user as u').then((r) => r.rows[0]!.u));
  };
  afterAll(async () => {
    await admin(async (c) => {
      for (const p of [NOVO, NOLOGIN, RUIM]) await c.query(`drop role if exists ${p}`);
    });
  });

  it('papel novo nasce com LOGIN e os atributos certos; a senha fica como SCRAM e o login funciona', async () => {
    await admin(async (c) => {
      await garantirPapelDeLogin(c, NOVO, 'senha-nova-1');
      expect(await atributos(c, NOVO)).toEqual({ ...CERTOS, rolcanlogin: true });
      const cifra = (await c.query<{ v: string }>("select current_setting('password_encryption') as v")).rows[0]!.v;
      const guardada = (await c.query<{ s: string }>('select rolpassword as s from pg_authid where rolname = $1', [NOVO])).rows[0]!.s;
      if (cifra === 'scram-sha-256') expect(guardada).toMatch(SCRAM);
    });
    expect(await entrarComo(NOVO, 'senha-nova-1')).toBe(NOVO);
  });

  it('papel existente NOLOGIN (como a 0001/0003 criam): ganha LOGIN e a senha; a troca de senha vale; atributos intactos', async () => {
    await admin(async (c) => {
      await c.query(`create role ${NOLOGIN} nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
      await garantirPapelDeLogin(c, NOLOGIN, 'senha-um');
      expect(await atributos(c, NOLOGIN)).toEqual({ ...CERTOS, rolcanlogin: true });
    });
    expect(await entrarComo(NOLOGIN, 'senha-um')).toBe(NOLOGIN);
    await admin((c) => garantirPapelDeLogin(c, NOLOGIN, 'senha-dois'));
    expect(await entrarComo(NOLOGIN, 'senha-dois')).toBe(NOLOGIN);
    await expect(entrarComo(NOLOGIN, 'senha-um')).rejects.toThrow();
  });

  it('papel existente com BYPASSRLS/CREATEDB: falha com mensagem clara e nada muda (nem senha, nem LOGIN, nem atributo)', async () => {
    await admin(async (c) => {
      await c.query(`create role ${RUIM} nologin bypassrls createdb`);
      await expect(garantirPapelDeLogin(c, RUIM, 'senha-ruim')).rejects.toThrow(new RegExp(`O papel ${RUIM} já existe com BYPASSRLS, CREATEDB`));
      expect(await atributos(c, RUIM)).toEqual({ ...CERTOS, rolbypassrls: true, rolcreatedb: true, rolcanlogin: false });
      expect((await c.query<{ s: string | null }>('select rolpassword as s from pg_authid where rolname = $1', [RUIM])).rows[0]!.s).toBeNull();
      // a conexão continua usável (rollback feito)
      expect((await c.query<{ n: number }>('select 1 as n')).rows[0]!.n).toBe(1);
    });
  });

  it('os papéis da aplicação no banco dos testes seguem com os atributos certos (garantirPapelApp/Worker do globalSetup)', async () => {
    await admin(async (c) => {
      expect(await atributos(c, 'macuxi_app')).toEqual({ ...CERTOS, rolcanlogin: true });
      if (banco().urlWorker) expect(await atributos(c, 'macuxi_worker')).toEqual({ ...CERTOS, rolcanlogin: true });
    });
  });
});
