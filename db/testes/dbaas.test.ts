/**
 * T-0075 — teste de compatibilidade do DBaaS PostgreSQL da Magalu: funções puras do relatório (db/dbaas/relatorio.ts) e
 * travas estáticas do script da VM (db/dbaas/teste-compatibilidade.sh). Não usa banco: roda também sem Postgres.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PASTA_DB } from '../src/config';
import {
  classificarErroConexao,
  formatarItem,
  indicesDoPlano,
  mascarar,
  montarMarkdown,
  nomeBaseTeste,
  percentil,
  primeiraLinhaUtil,
  problemasSearchPath,
  resumir,
  resumirVitest,
  SAIDA,
  searchPathDoProconfig,
  tentativasTls,
  versaoAtende,
  versaoVitestDoLock,
  type Item,
} from '../dbaas/relatorio';

const item = (grupo: Item['grupo'], codigo: string, ok: boolean): Item => ({ grupo, codigo, titulo: `item ${codigo}`, situacao: ok ? 'ok' : 'falha' });

describe('relatório do DBaaS (T-0075)', () => {
  it('mascarar troca a senha, a forma URL-encoded e a credencial de URL postgres://', () => {
    const s = 'p@ss/w0rd:x';
    const texto = `falhou com ${s} em postgres://macuxi_admin:${encodeURIComponent(s)}@172.18.3.212:5432/postgres e postgresql://u:outra@h/b`;
    const r = mascarar(texto, [s]);
    expect(r).not.toContain(s);
    expect(r).not.toContain(encodeURIComponent(s));
    expect(r).not.toContain('outra');
    expect(r).toContain('postgres://***@172.18.3.212:5432/postgres');
    // segredo curto (ou vazio) não vira máscara de tudo
    expect(mascarar('abc', ['', 'a'])).toBe('abc');
  });

  it('nome da base de teste tem a data e a hora UTC e cabe em validarNomeBanco', () => {
    const n = nomeBaseTeste(new Date('2026-11-05T15:30:12.345Z'));
    expect(n).toBe('macuxi_dbaas_20261105_153012');
    expect(n).toMatch(/^[a-z_][a-z0-9_]{0,62}$/);
  });

  it('percentil pelo vizinho mais próximo', () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentil(v, 95)).toBe(19);
    expect(percentil(v, 50)).toBe(10);
    expect(percentil([7], 95)).toBe(7);
    expect(Number.isNaN(percentil([], 95))).toBe(true);
  });

  it('versaoAtende compara por partes numéricas', () => {
    expect(versaoAtende('0.8.2', '0.8.0')).toBe(true);
    expect(versaoAtende('0.8', '0.8.0')).toBe(true);
    expect(versaoAtende('0.7.4', '0.8.0')).toBe(false);
    expect(versaoAtende('0.10.0', '0.8.0')).toBe(true);
  });

  it('tentativas de TLS seguem a semântica do libpq (prefer cai para sem TLS; require não confere certificado)', () => {
    expect(tentativasTls('prefer')).toEqual(['no-verify', 'disable']);
    expect(tentativasTls('require')).toEqual(['no-verify']);
    expect(tentativasTls('verify-full')).toEqual(['verify-full']);
    expect(tentativasTls('disable')).toEqual(['disable']);
    expect(tentativasTls('allow')).toBeNull();
  });

  it('classifica os erros de conexão do pg', () => {
    expect(classificarErroConexao(new Error('no pg_hba.conf entry for host "10.0.0.5", user "macuxi_admin", database "postgres", no encryption')).tipo).toBe('tls');
    expect(classificarErroConexao(new Error('no pg_hba.conf entry for host "10.0.0.5", user "x", database "y", SSL encryption')).tipo).toBe('pg_hba');
    expect(classificarErroConexao(new Error('The server does not support SSL connections')).tipo).toBe('tls');
    expect(classificarErroConexao(Object.assign(new Error('password authentication failed for user "macuxi_admin"'), { code: '28P01' })).tipo).toBe('autenticacao');
    expect(classificarErroConexao(new AggregateError([Object.assign(new Error('connect ECONNREFUSED 172.18.3.212:5432'), { code: 'ECONNREFUSED' })])).tipo).toBe('recusada');
    expect(classificarErroConexao(new Error('Connection terminated due to connection timeout')).tipo).toBe('tempo');
  });

  it('search_path de SECURITY DEFINER: fixo, sem public/$user e com pg_temp por último', () => {
    expect(problemasSearchPath('pg_catalog, plataforma, pg_temp')).toEqual([]);
    expect(problemasSearchPath('""')).toEqual([]);
    expect(problemasSearchPath(null)).toEqual(['sem search_path fixo']);
    expect(problemasSearchPath('"$user", public')).toEqual(['search_path com public ou $user', 'pg_temp não é o último do search_path']);
    expect(problemasSearchPath('pg_temp, plataforma')).toEqual(['pg_temp não é o último do search_path']);
    expect(searchPathDoProconfig(['work_mem=64MB', 'search_path=pg_catalog, core, pg_temp'])).toBe('pg_catalog, core, pg_temp');
    expect(searchPathDoProconfig(null)).toBeNull();
  });

  it('código de saída: pré-requisitos e critérios decidem; complementares não; limpeza tem código próprio', () => {
    expect(resumir([item('pre', 'P1', true), item('c1', 'C1.1', true), item('comp', 'X1', false)]).codigo).toBe(SAIDA.OK);
    expect(resumir([item('c3', 'C3.4', false), item('limpeza', 'L1', false)]).codigo).toBe(SAIDA.FALHA);
    expect(resumir([item('c2', 'C2.3', true), item('limpeza', 'L1', false)]).codigo).toBe(SAIDA.LIMPEZA);
    expect(resumir([item('c4', 'C4.2', false)]).linha).toContain('C4.2');
  });

  it('linha e Markdown só com ✅/❌, sem senha', () => {
    expect(formatarItem({ ...item('c2', 'C2.3', true), detalhe: '27 aplicadas', ms: 1234 })).toBe('✅ C2.3 item C2.3 (1.2 s) — 27 aplicadas');
    const md = montarMarkdown(
      { quando: '2026-11-05T15:30:12Z', alvo: '172.18.3.212:5432', versoes: ['Servidor: PostgreSQL 16.4'], duracaoMs: 61_000 },
      [item('c1', 'C1.2', true), { ...item('c3', 'C3.4', false), subitens: ['db/testes/x.test.ts: 1 caso'] }, item('c4', 'C4.2', true)],
      'Limit\n  -> Index Scan using dbaas_produto_embedding_hnsw',
    );
    expect(md).toContain('## Critério 1');
    expect(md).toContain('- ❌ C3.4 item C3.4');
    expect(md).toContain('  - db/testes/x.test.ts: 1 caso');
    expect(md).toContain('Index Scan using dbaas_produto_embedding_hnsw');
    expect(md).toContain('Código de saída: 1');
  });

  it('resume o JSON do reporter do Vitest por arquivo', () => {
    const r = resumirVitest({
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 1,
      numPendingTests: 0,
      testResults: [
        { name: '/app/db/testes/a.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }] },
        {
          name: '/app/db/testes/b.test.ts',
          status: 'failed',
          assertionResults: [{ status: 'passed' }, { fullName: 'b falha', status: 'failed', failureMessages: ['\nError: permission denied to set parameter "session_replication_role"\n    at x'] }],
        },
      ],
    });
    expect(r.arquivos).toBe(2);
    expect(r.arquivosVerdes).toBe(1);
    expect(r.falhas).toEqual([{ arquivo: 'db/testes/b.test.ts', casos: ['b falha'], mensagem: 'Error: permission denied to set parameter "session_replication_role"' }]);
    expect(resumirVitest(null).arquivos).toBe(0);
    expect(primeiraLinhaUtil('\n   at a\nok')).toBe('ok');
  });

  it('acha o índice no plano JSON e a versão do Vitest no lock', () => {
    const plano = [{ Plan: { 'Node Type': 'Limit', Plans: [{ 'Node Type': 'Index Scan', 'Index Name': 'dbaas_produto_embedding_hnsw' }] } }];
    expect(indicesDoPlano(plano)).toEqual(['dbaas_produto_embedding_hnsw']);
    expect(indicesDoPlano([{ Plan: { 'Node Type': 'Seq Scan' } }])).toEqual([]);
    expect(versaoVitestDoLock('packages:\n\n  vitest@3.2.7:\n    resolution: x\n')).toBe('3.2.7');
    expect(versaoVitestDoLock('nada')).toBeNull();
  });
});

describe('script da VM (db/dbaas/teste-compatibilidade.sh)', () => {
  const sh = readFileSync(join(PASTA_DB, 'dbaas', 'teste-compatibilidade.sh'), 'utf8');

  it('LF, sem xtrace e sem a senha em argv do docker', () => {
    expect(sh).not.toContain('\r');
    expect(sh).not.toMatch(/set\s+-[a-z]*x|xtrace/);
    // a senha vai pelo stdin do contêiner; nunca "-e DBAAS_SENHA" (iria para o docker inspect) nem "=valor" em argv
    expect(sh).not.toMatch(/-e\s+"?DBAAS_SENHA(=|\s|"|$)/m);
    expect(sh).toContain("printf '%s\\n' \"$DBAAS_SENHA\" | docker run -i");
    expect(sh).toContain('-e DBAAS_SENHA_STDIN=1');
  });

  it('recusa host local e não entra na rede do compose da demo', () => {
    expect(sh).toMatch(/localhost \| 127\.\* \| 0\.0\.0\.0 \| ::1 \| postgres \|/);
    expect(sh).not.toMatch(/--network\s+(macuxi|interna)/);
    expect(sh).not.toMatch(/--env-file|\/opt\/macuxi\/\.env/);
  });
});
