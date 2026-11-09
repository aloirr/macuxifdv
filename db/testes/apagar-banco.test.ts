/**
 * T-0075 — apagar a base efêmera sem superusuário (db/src/apagar-banco.ts). CI do main 6cbcd87 (run 42159762560): o
 * `drop database ... with (force)` do apagar() deu 42501 "permission denied to terminate process" no job com admin sem
 * superusuário, porque uma sessão de outro papel ainda saía da base. Não usa banco: cliente falso; roda sem Postgres.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apagarBancoForcado, BASE_EM_USO, esperaDaTentativa, PRAZO_APAGAR_MS, SEM_PRIVILEGIO, type SessaoNaBase } from '../src/apagar-banco';
import { PASTA_DB } from '../src/config';

const NOME = 'macuxi_teste_abc_1_0a0b0c';

function erroPg(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Cliente falso: cada DROP consome a próxima resposta do roteiro; a consulta de sessões devolve o próximo retrato. */
function clienteFalso(drops: (Error | null)[], retratos: SessaoNaBase[][]) {
  const sqls: string[] = [];
  const c = {
    sqls,
    query: async (sql: string) => {
      sqls.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('pg_stat_activity')) return { rows: retratos.length > 1 ? retratos.shift()! : (retratos[0] ?? []) };
      const r = drops.shift();
      if (r === undefined) throw new Error(`DROP não previsto: ${sql}`);
      if (r) throw r;
      return { rows: [] };
    },
  };
  return c;
}

const forcado = `drop database if exists ${NOME} with (force)`;
const comum = `drop database if exists ${NOME}`;
const negado = () => erroPg(SEM_PRIVILEGIO, 'permission denied to terminate process');
const emUso = () => erroPg(BASE_EM_USO, `database "${NOME}" is being accessed by other users`);
const app: SessaoNaBase[] = [{ quem: 'macuxi_app', n: 1 }];

function opcoesFalsas(prazoMs = PRAZO_APAGAR_MS) {
  let t = 0;
  const esperas: number[] = [];
  const avisos: string[] = [];
  return {
    esperas,
    avisos,
    opcoes: { prazoMs, agora: () => t, esperar: async (ms: number) => { esperas.push(ms); t += ms; }, avisar: (m: string) => { avisos.push(m); } },
  };
}

describe('apagarBancoForcado (sem superusuário, T-0075)', () => {
  it('com superusuário (ou sem sessão alheia) o 1º DROP ... WITH (FORCE) basta', async () => {
    const c = clienteFalso([null], []);
    await apagarBancoForcado(c, NOME);
    expect(c.sqls).toEqual([forcado]);
  });

  it('42501 com sessão do macuxi_app saindo: DROP comum (o Postgres espera e encerra o autovacuum) e pronto', async () => {
    const c = clienteFalso([negado(), null], [app]);
    const { opcoes, esperas, avisos } = opcoesFalsas();
    await apagarBancoForcado(c, NOME, opcoes);
    expect(c.sqls.filter((s) => s.startsWith('drop'))).toEqual([forcado, comum]);
    expect(esperas).toEqual([]);
    expect(avisos).toEqual([]); // uma volta só: quem estava saindo saiu, nada a avisar
  });

  it('sessão que demora a sair: repete com espera crescente até passar', async () => {
    const c = clienteFalso([negado(), emUso(), negado(), emUso(), null], [app]);
    const { opcoes, esperas, avisos } = opcoesFalsas();
    await apagarBancoForcado(c, NOME, opcoes);
    expect(c.sqls.filter((s) => s.startsWith('drop'))).toEqual([forcado, comum, forcado, comum, forcado]);
    expect(esperas).toEqual([100, 200]);
    // passou, mas o log do CI mostra quem segurou a base (sem consulta nem dado pessoal): vazamento não some
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('2 voltas');
    expect(avisos[0]).toContain('macuxi_app (1)');
    expect(avisos[0]).toContain('pool sem end()');
  });

  it('42501 e a sessão já saiu: tenta o FORCE de novo na hora, sem esperar', async () => {
    const c = clienteFalso([negado(), null], [[]]);
    const { opcoes, esperas } = opcoesFalsas();
    await apagarBancoForcado(c, NOME, opcoes);
    expect(c.sqls.filter((s) => s.startsWith('drop'))).toEqual([forcado, forcado]);
    expect(esperas).toEqual([]);
  });

  it('42501 duas vezes seguidas sem ninguém na base é falta de privilégio de verdade: o erro original sobe', async () => {
    const e = negado();
    const c = clienteFalso([e, e], [[]]);
    await expect(apagarBancoForcado(c, NOME, opcoesFalsas().opcoes)).rejects.toBe(e);
  });

  it('R-20261106-042954 🟡 1: o prazo padrão (8 s) fica abaixo do idleTimeoutMillis de 10 s do pg.Pool (pool sem end() não passa escondido)', () => {
    expect(PRAZO_APAGAR_MS).toBe(8_000);
    expect(PRAZO_APAGAR_MS).toBeLessThan(10_000);
  });

  it('conexão vazada (não sai no prazo padrão de 8 s): falha com 42501 e o resumo de quem segura a base, sem dado pessoal', async () => {
    const drops = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? negado() : emUso()));
    const c = clienteFalso(drops, [[{ quem: 'macuxi_app', n: 2 }, { quem: 'autovacuum worker', n: 1 }]]);
    const { opcoes, esperas } = opcoesFalsas();
    const erro = await apagarBancoForcado(c, NOME, opcoes).catch((x: unknown) => x as Error & { code?: string });
    // desiste no prazo padrão: esperou os 8 s (mais no máximo a última volta de 1 s), antes dos 10 s em que o pool fecharia as ociosas
    const esperado = esperas.reduce((a, b) => a + b, 0);
    expect(esperado).toBeGreaterThanOrEqual(PRAZO_APAGAR_MS);
    expect(esperado).toBeLessThan(PRAZO_APAGAR_MS + esperaDaTentativa(99) + 1);
    expect(esperado).toBeLessThan(10_000);
    expect(erro).toBeInstanceOf(Error);
    expect(erro!.code).toBe(SEM_PRIVILEGIO);
    expect(erro!.message).toContain('permission denied to terminate process');
    expect(erro!.message).toContain('macuxi_app (2), autovacuum worker (1)');
  });

  it('outro erro (ex.: base inexistente sem if exists, conexão caída) sobe na hora, sem repetir', async () => {
    const e = erroPg('57P01', 'terminating connection due to administrator command');
    const c = clienteFalso([e], []);
    await expect(apagarBancoForcado(c, NOME, opcoesFalsas().opcoes)).rejects.toBe(e);
    expect(c.sqls).toEqual([forcado]);
  });

  it('nome fora do padrão seguro é recusado antes de qualquer SQL', async () => {
    const c = clienteFalso([], []);
    await expect(apagarBancoForcado(c, 'macuxi; drop table x')).rejects.toThrow();
    expect(c.sqls).toEqual([]);
  });

  it('espera: 100, 200, 400, 800 ms e depois 1 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(esperaDaTentativa)).toEqual([100, 200, 400, 800, 1_000, 1_000]);
  });
});

describe('trava estática: todo DROP DATABASE ... WITH (FORCE) de TS do @macuxi/db passa por apagarBancoForcado', () => {
  function arquivosTs(pasta: string): string[] {
    return readdirSync(pasta).flatMap((n) => {
      const p = join(pasta, n);
      if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : arquivosTs(p);
      return /\.(ts|mts)$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
    });
  }
  it('src/, dbaas/, scripts/, seeds/ e testes/: nenhum drop database com force fora de src/apagar-banco.ts', () => {
    const fora = ['src', 'dbaas', 'scripts', 'seeds', 'testes']
      .flatMap((p) => arquivosTs(join(PASTA_DB, p)))
      .filter((a) => !a.endsWith(join('src', 'apagar-banco.ts')))
      .filter((a) => /drop\s+database\s+(if\s+exists\s+)?\$\{[^}]+\}\s*with\s*\(\s*force\s*\)/i.test(readFileSync(a, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')))
      .map((a) => relative(PASTA_DB, a));
    expect(fora).toEqual([]);
  });
});
