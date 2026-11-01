// Testes do escopo/matrizes do CI (T-0033, ADR 0014 §custo). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classificar, decidir, MATRIZES } from './escopo.mjs';

test('só caminhos de coordenação (.coord, docs/status, docs/backlog.md, docs/produto) → coordenacao', () => {
  assert.equal(classificar(['.coord/recados/testes/R-1.md', '.coord/diario/testes.md', '.coord/quadro.md', '.coord/lidos/x.txt']), 'coordenacao');
  assert.equal(classificar(['.coord/quadro.md', 'docs/status/demo.md', 'docs/backlog.md', 'docs/produto/07-agentes-e-coordenacao.md']), 'coordenacao');
});

test('resto de docs/** (a Integração lê docs/modulos) e parecidos → completo', () => {
  assert.equal(classificar(['.coord/quadro.md', 'docs/modulos/integracao/hub-api.md']), 'completo');
  assert.equal(classificar(['docs/decisoes/0013-x.md']), 'completo');
  assert.equal(classificar(['docs/backlog.md.bak']), 'completo');
  assert.equal(classificar(['docs/statusx/a.md']), 'completo');
  assert.equal(classificar(['docs/produtos/a.md']), 'completo');
});

test('código, CLAUDE.md, .coordenacao/ e lista vazia → completo', () => {
  assert.equal(classificar(['.coord/quadro.md', 'modules/core/domain/a.ts']), 'completo');
  assert.equal(classificar(['CLAUDE.md']), 'completo');
  assert.equal(classificar(['.coordenacao/x.md']), 'completo');
  assert.equal(classificar([]), 'completo');
  assert.equal(classificar(['', '  ']), 'completo');
});

test('PR e push → matriz enxuta; agendado e manual → completa e escopo completo; sem lista → completo', () => {
  assert.equal(decidir({ evento: 'push', arquivos: ['a.ts'] }).matriz, 'enxuta');
  assert.equal(decidir({ evento: 'pull_request', arquivos: ['a.ts'] }).matriz, 'enxuta');
  for (const evento of ['schedule', 'workflow_dispatch']) {
    const d = decidir({ evento, arquivos: ['.coord/quadro.md'] });
    assert.deepEqual([d.matriz, d.escopo], ['completa', 'completo'], evento);
  }
  assert.equal(decidir({ evento: 'push', arquivos: null }).escopo, 'completo');
});

test('as duas matrizes de tests/ cobrem as mesmas execuções (visitas-campo + resto 1/2 + resto 2/2)', () => {
  const execucoes = (m) => m.integracao.flatMap((p) => p.args.split('|')).sort();
  assert.deepEqual(execucoes(MATRIZES.enxuta), execucoes(MATRIZES.completa));
  assert.equal(execucoes(MATRIZES.completa).length, 3);
});

test('grupos da matriz completa: um por inclusão e o outro pela exclusão dos mesmos pacotes (pacote novo nunca fica de fora)', () => {
  for (const nome of ['typecheck', 'pacotes']) {
    const [incl, excl] = MATRIZES.completa[nome];
    const a = incl.filtro.split(' ').map((f) => f.replace('--filter=', ''));
    const b = excl.filtro.split(' ').map((f) => f.replace('--filter=!', ''));
    assert.deepEqual(a, b, nome);
    assert.equal(MATRIZES.enxuta[nome][0].filtro, '', nome);
    // o grupo único do PR lê o cache dos 2 grupos do main
    assert.deepEqual(MATRIZES.enxuta[nome][0].cache_extra.split(' ').sort(), [incl.cache, excl.cache].sort(), nome);
  }
});

test('CLI num repositório git: PR só de .coord → coordenacao; push com ANTES zerado → completo; agendado → completa', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escopo-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  const script = fileURLToPath(new URL('./escopo.mjs', import.meta.url));
  const rodar = (env) => {
    const out = join(dir, 'saida.txt');
    writeFileSync(out, '');
    execFileSync(process.execPath, [script], { cwd: dir, env: { ...process.env, ...env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
    return Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    writeFileSync(join(dir, 'a.ts'), '1');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'pr');
    mkdirSync(join(dir, '.coord/recados'), { recursive: true });
    writeFileSync(join(dir, '.coord/recados/R.md'), 'x');
    git('add', '-A');
    git('commit', '-qm', 'recado');
    const topo = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-');
    writeFileSync(join(dir, 'b.ts'), '2'); // a base andou (código) depois do PR abrir
    git('add', '-A');
    git('commit', '-qm', 'base andou');
    git('merge', '-q', '--no-ff', 'pr', '-m', 'merge'); // como o refs/pull/N/merge
    let r = rodar({ GITHUB_EVENT_NAME: 'pull_request' });
    assert.equal(r.escopo, 'coordenacao');
    assert.equal(r.matriz, 'enxuta');
    assert.equal(JSON.parse(r.integracao).length, 2);
    r = rodar({ GITHUB_EVENT_NAME: 'push', ANTES: base, DEPOIS: topo });
    assert.equal(r.escopo, 'coordenacao');
    assert.equal(r.matriz, 'enxuta');
    r = rodar({ GITHUB_EVENT_NAME: 'schedule' });
    assert.deepEqual([r.escopo, r.matriz, JSON.parse(r.integracao).length], ['completo', 'completa', 3]);
    r = rodar({ GITHUB_EVENT_NAME: 'push', ANTES: '0000000000000000000000000000000000000000', DEPOIS: topo });
    assert.equal(r.escopo, 'completo');
    r = rodar({ GITHUB_EVENT_NAME: 'push', ANTES: 'naoexiste', DEPOIS: topo });
    assert.equal(r.escopo, 'completo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
