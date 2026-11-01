// Testes da guarda do cache do turbo (T-0033, ADR 0013). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { EXCLUSOES_RAIZ, verificar } from './grafo-turbo.mjs';

let raiz;
const escrever = (rel, conteudo) => {
  const abs = join(raiz, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2));
};
const pacote = (dir, nome, deps = {}) =>
  escrever(`${dir}/package.json`, { name: nome, scripts: { lint: 'x', typecheck: 'x', test: 'x' }, dependencies: deps });
const BASE = {
  transit: { dependsOn: ['^transit'] },
  lint: { dependsOn: ['transit'] },
  typecheck: { dependsOn: ['transit'] },
  test: { dependsOn: ['transit'], outputs: [] },
  '//#lint:tests': { inputs: ['tests/**'] },
  '//#typecheck:tests': { inputs: ['tests/**'] },
  '//#test:tests': { cache: false },
};
const turbo = (extra = {}) => escrever('turbo.json', { tasks: { ...BASE, ...extra } });

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'grafo-turbo-'));
  pacote('packages/sdk', '@macuxi/sdk');
  escrever('packages/sdk/src/index.ts', 'export const x = 1;\n');
  pacote('modules/core', '@macuxi/core', { '@macuxi/sdk': 'workspace:*' });
  escrever('modules/core/domain/a.ts', "import { x } from '@macuxi/sdk';\nexport const y = x;\n");
  escrever('tests/a.test.ts', "import { y } from './apoio';\n");
  escrever('tests/apoio.ts', 'export const y = 1;\n');
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

test('grafo declarado e tarefas com transit: sem problema', () => {
  turbo();
  assert.deepEqual(verificar(raiz), []);
});

test('sem a tarefa transit: falha (R1)', () => {
  turbo({ transit: undefined });
  assert.ok(verificar(raiz).some((p) => p.includes('"transit"')));
});

test('lint sem dependsOn transit: falha (R1)', () => {
  turbo({ lint: {} });
  const p = verificar(raiz);
  assert.ok(p.some((x) => x.startsWith('@macuxi/core#lint') && x.includes('R1')));
});

test('import de pacote do workspace não declarado: falha até cobrir nos inputs (R2)', () => {
  pacote('apps/web', 'web');
  escrever('apps/web/a.ts', "import { y } from '@macuxi/core/domain';\n");
  turbo();
  const p = verificar(raiz);
  assert.equal(p.filter((x) => x.startsWith('web#')).length, 3);
  assert.ok(p[0].includes('não declarado'));
  const inputs = ['$TURBO_DEFAULT$', '$TURBO_ROOT$/modules/**', ...EXCLUSOES_RAIZ];
  turbo({
    'web#lint': { dependsOn: ['transit'], inputs },
    'web#typecheck': { dependsOn: ['transit'], inputs },
    'web#test': { dependsOn: ['transit'], inputs },
  });
  assert.deepEqual(verificar(raiz), []);
});

test('import relativo para fora do pacote: falha (R2)', () => {
  escrever('modules/core/domain/b.ts', "export * from '../../../packages/sdk/src/index';\n");
  turbo();
  const p = verificar(raiz);
  assert.ok(p.some((x) => x.startsWith('@macuxi/core#typecheck') && x.includes('packages/sdk/src/index')));
});

test('leitura de arquivo fora do pacote só pesa no test, e cache false dispensa cobertura', () => {
  escrever('modules/core/domain/c.test.ts', "const doc = resolve(__dirname, '../../../docs/x.md');\n");
  turbo();
  let p = verificar(raiz);
  assert.deepEqual(p.map((x) => x.split(':')[0]), ['@macuxi/core#test']);
  turbo({ '@macuxi/core#test': { cache: false } });
  p = verificar(raiz);
  assert.deepEqual(p, []);
});

test('tests/ da raiz importando pacote: exige cobertura em //#lint:tests e //#typecheck:tests', () => {
  escrever('tests/b.test.ts', "import { y } from '@macuxi/core';\n");
  turbo();
  const p = verificar(raiz);
  assert.deepEqual(p.map((x) => x.split(':')[0] + ':' + x.split(':')[1]).sort(), ['//#lint:tests', '//#typecheck:tests']);
  const inputs = ['tests/**', '$TURBO_ROOT$/modules/**', ...EXCLUSOES_RAIZ];
  turbo({ '//#lint:tests': { inputs }, '//#typecheck:tests': { inputs } });
  assert.deepEqual(verificar(raiz), []);
});

test('glob $TURBO_ROOT$ sem excluir .turbo, node_modules e tsbuildinfo: falha (R3)', () => {
  turbo({ '//#lint:tests': { inputs: ['tests/**', '$TURBO_ROOT$/modules/**'] } });
  const p = verificar(raiz);
  assert.equal(p.length, 1);
  assert.match(p[0], /^\/\/#lint:tests: .*\.turbo.*\(R3\)$/);
});

test('o turbo.json real do repositório passa', () => {
  assert.deepEqual(verificar(), []);
});
