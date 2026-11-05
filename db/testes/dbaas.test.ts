/**
 * T-0075 — teste de compatibilidade do DBaaS PostgreSQL da Magalu: funções puras do relatório (db/dbaas/relatorio.ts) e
 * travas estáticas do script da VM (db/dbaas/teste-compatibilidade.sh). Não usa banco: roda também sem Postgres.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PASTA_DB } from '../src/config';
import { createHash, createHmac } from 'node:crypto';
import {
  classificarErroConexao,
  classificarSuite,
  ehBloqueioDePrivilegio,
  formatarItem,
  LEGENDA_SAIDA,
  ordemExclusao,
  secaoPlanoB,
  verificadorScram,
  type ChaveEstrangeira,
  type MedicoesPlanoB,
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

describe('plano B do DBaaS sem SUPERUSER/BYPASSRLS (T-0075, 2ª versão)', () => {
  it('⚠️ (alternativa) nos critérios dá o código PLANO_B; ❌ continua mandando; ⚠️ em complementar não muda o código', () => {
    const alt = (grupo: Item['grupo'], codigo: string): Item => ({ grupo, codigo, titulo: `item ${codigo}`, situacao: 'alternativa' });
    expect(resumir([item('pre', 'P1', true), alt('c2', 'C2.7'), alt('c3', 'C3.2')]).codigo).toBe(SAIDA.PLANO_B);
    expect(resumir([item('pre', 'P1', true), alt('c2', 'C2.7')]).linha).toContain('plano B');
    expect(resumir([alt('c2', 'C2.7'), item('c4', 'C4.1', false)]).codigo).toBe(SAIDA.FALHA);
    expect(resumir([alt('c2', 'C2.7'), item('c4', 'C4.1', false)]).linha).toContain('⚠️ só pelo caminho alternativo: C2.7');
    expect(resumir([alt('c2', 'C2.7'), item('limpeza', 'L3', false)]).codigo).toBe(SAIDA.LIMPEZA);
    expect(resumir([item('c1', 'C1.2', true), alt('planob', 'B2')]).codigo).toBe(SAIDA.OK);
    expect(formatarItem(alt('c2', 'C2.7'))).toBe('⚠️ C2.7 item C2.7');
    expect(LEGENDA_SAIDA).toContain('5 = só com o plano B');
    expect(montarMarkdown({ quando: 'x', alvo: 'y', versoes: [], duracaoMs: 1 }, [alt('c2', 'C2.7')], null, ['## Plano B — teste'])).toMatch(
      /## Plano B — teste[\s\S]*Código de saída: 5/,
    );
  });

  it('reconhece erro de privilégio do DBaaS (e não confunde com erro de schema)', () => {
    expect(ehBloqueioDePrivilegio('permission denied to alter role')).toBe(true);
    expect(ehBloqueioDePrivilegio('new row violates row-level security policy for table "tenant"')).toBe(true);
    expect(ehBloqueioDePrivilegio('permission denied to set parameter "session_replication_role"')).toBe(true);
    expect(ehBloqueioDePrivilegio('Only roles with the SUPERUSER attribute may change the SUPERUSER attribute.')).toBe(true);
    expect(ehBloqueioDePrivilegio('relation "core.cliente" does not exist')).toBe(false);
    expect(ehBloqueioDePrivilegio('expected 3 to be 2')).toBe(false);
  });

  it('verificador SCRAM-SHA-256 confere com o exemplo da RFC 7677 (user/pencil)', () => {
    const sal = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const v = verificadorScram('pencil', sal, 4096);
    const m = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(v);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('W22ZaJ0SNY7soEsUEjb6gQ==');
    const guardada = Buffer.from(m![2]!, 'base64');
    const servidor = Buffer.from(m![3]!, 'base64');
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const mensagem = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    // ServerSignature da RFC
    expect(createHmac('sha256', servidor).update(mensagem).digest('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    // ClientProof da RFC: ClientKey = prova XOR HMAC(StoredKey, mensagem); SHA-256(ClientKey) = StoredKey
    const prova = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const assinatura = createHmac('sha256', guardada).update(mensagem).digest();
    const chaveCliente = Buffer.from(prova.map((b, i) => b ^ assinatura[i]!));
    expect(createHash('sha256').update(chaveCliente).digest().equals(guardada)).toBe(true);
    // a senha nunca aparece no verificador; sal aleatório muda o verificador
    expect(verificadorScram('a1b2c3d4')).not.toContain('a1b2c3d4');
    expect(verificadorScram('a1b2c3d4')).not.toBe(verificadorScram('a1b2c3d4'));
    expect(() => verificadorScram('com espaço')).toThrow();
  });

  it('ordem de exclusão do tenant: filhas antes das mães, ciclo quebrado pela FK anulável, autorreferência ignorada', () => {
    const fk = (nome: string, filha: string, mae: string, anulavel = false, colunas = ['x']): ChaveEstrangeira => ({ nome, filha, mae, colunas, anulavel });
    const simples = ordemExclusao(['core.cliente', 'vendedor.pedido', 'vendedor.pedido_item'], [
      fk('item_pedido_fk', 'vendedor.pedido_item', 'vendedor.pedido'),
      fk('pedido_cliente_fk', 'vendedor.pedido', 'core.cliente'),
      fk('cliente_matriz_fk', 'core.cliente', 'core.cliente', true),
      fk('pedido_tenant_fk', 'vendedor.pedido', 'plataforma.tenant'),
    ]);
    expect(simples.erro).toBeNull();
    expect(simples.passos).toEqual([
      { tipo: 'apagar', tabela: 'vendedor.pedido_item' },
      { tipo: 'apagar', tabela: 'vendedor.pedido' },
      { tipo: 'apagar', tabela: 'core.cliente' },
    ]);
    const ciclo = ordemExclusao(['core.equipe', 'core.usuario'], [
      fk('usuario_equipe_fk', 'core.usuario', 'core.equipe', true, ['equipe_id']),
      fk('equipe_supervisor_fk', 'core.equipe', 'core.usuario', false, ['supervisor_id']),
    ]);
    expect(ciclo.erro).toBeNull();
    expect(ciclo.passos[0]).toEqual({ tipo: 'anular', tabela: 'core.usuario', colunas: ['equipe_id'], fk: 'usuario_equipe_fk' });
    expect(ciclo.passos.slice(1)).toEqual([
      { tipo: 'apagar', tabela: 'core.equipe' },
      { tipo: 'apagar', tabela: 'core.usuario' },
    ]);
    const travado = ordemExclusao(['a.x', 'a.y'], [fk('x_y', 'a.x', 'a.y'), fk('y_x', 'a.y', 'a.x')]);
    expect(travado.erro).toContain('ciclo de FK sem coluna anulável entre: a.x, a.y');
  });

  it('suíte: ❌ só por falha real; bloqueio de privilégio (inclusive no globalSetup) é ⚠️; trava local não reprova', () => {
    const trava = /fora do ambiente local/i;
    const base = { arquivos: 2, arquivosVerdes: 1, casos: 3, casosVerdes: 2, casosFalhos: 1, casosPulados: 0 };
    const falha = (mensagem: string) => ({ ...base, falhas: [{ arquivo: 'db/testes/x.test.ts', casos: ['x'], mensagem }] });
    expect(classificarSuite(falha('new row violates row-level security policy for table "tenant"'), '', trava).situacao).toBe('alternativa');
    expect(classificarSuite(falha('expected 0 to be 1'), '', trava).situacao).toBe('falha');
    expect(classificarSuite(falha('Seed da Fase M fora do ambiente local'), '', trava).situacao).toBe('ok');
    const vazia = { ...base, arquivos: 0, arquivosVerdes: 0, falhas: [] };
    expect(classificarSuite(vazia, 'error: permission denied to alter role', trava).situacao).toBe('alternativa');
    expect(classificarSuite(vazia, 'Error: Cannot find module', trava).situacao).toBe('falha');
  });

  it('seção "Plano B" traz B0–B3 com custo e o que foi medido; o atalho do mgc_superuser só aparece se ele der BYPASSRLS', () => {
    const med: MedicoesPlanoB = {
      adminIgnoraRls: false,
      replicacaoPermitida: false,
      mgc: { existe: true, setRole: true, superusuario: false, ignoraRls: false },
      bypassConcedivel: false,
      vectorDireto: true,
      vectorViaMgc: null,
      b1: { ok: true, variante: 'papel macuxi_dbaas_manutencao', tabelas: 98 },
      b2: { ok: true, passos: 90, anuladas: ['core.usuario (usuario_equipe_fk)'], gatilhos: ['core.x: g'], erro: null },
      logRegistraPapel: false,
      suiteBloqueada: true,
    };
    const texto = secaoPlanoB(med).join('\n');
    for (const trecho of ['## Plano B', '**B0', '**B1', '**B2', '**B3', 'Custo:', 'papeis.ts', 'conferir-rls.sql', 'excluir_tenant', 'SET app.tenant_id', '98 tabelas']) {
      expect(texto).toContain(trecho);
    }
    expect(texto).not.toContain('Atalho medido');
    const comAtalho = secaoPlanoB({ ...med, mgc: { existe: true, setRole: true, superusuario: false, ignoraRls: true } }).join('\n');
    expect(comAtalho).toContain('Atalho medido');
  });
});

describe('script do contêiner (db/dbaas/teste-compatibilidade.ts)', () => {
  const ts = readFileSync(join(PASTA_DB, 'dbaas', 'teste-compatibilidade.ts'), 'utf8');

  it('não usa os caminhos do @macuxi/db que fazem ALTER ROLE com atributo (criarBanco, garantirPapel*)', () => {
    const codigo = ts.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l));
    expect(codigo.filter((l) => /\bcriarBanco\b|\bgarantirPapelApp\b|\bgarantirPapelWorker\b/.test(l))).toEqual([]);
    expect(codigo.filter((l) => /alter role/i.test(l) && /no(superuser|bypassrls|replication)/i.test(l))).toEqual([]);
    expect(ts).toContain('verificadorScram(senha)');
  });

  it('a limpeza apaga bases e papéis de teste no finally e no --so-limpar; tentativas de privilégio ficam em transação desfeita', () => {
    expect(ts).toMatch(/finally \{[\s\S]*await limpar\(/);
    expect(ts).toContain("'L3'");
    expect(ts).toContain("rolname like 'macuxi\\\\_dbaas\\\\_%'");
    expect(ts).toContain("tentar(c, 'alter role current_user bypassrls')");
    expect((ts.match(/await c\.query\('rollback'\)\.catch/g) ?? []).length).toBeGreaterThanOrEqual(4);
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
