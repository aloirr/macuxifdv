// Testes do scripts/ci/pnpm-nativo.mjs (node:test). Rodar: node --test scripts/ci/pnpm-nativo.test.mjs
// Cada teste monta uma pasta .tools/pnpm falsa, com um install.js que imita o do pnpm (troca os bins pelo "binário").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copiasComPlaceholder, ehPlaceholder, pastasTools, principal } from './pnpm-nativo.mjs';

const BINS = ['pnpm', 'pn', 'pnpx', 'pnx'];
const PLACEHOLDER = "# pnpm's native binary replaces this file during installation (see\n# ./install.js).\n";
const INSTALL_OK = `const fs = require('node:fs');
if (process.env.npm_lifecycle_event === 'postinstall') process.exit(0);
for (const b of ${JSON.stringify(BINS)}) fs.writeFileSync(b, '\\x7fELF-falso');
fs.appendFileSync('execucoes.txt', 'x');
`;
const INSTALL_FALHA = "console.error('sem o pacote @pnpm/exe'); process.exit(1);\n";

function montarTools(install = INSTALL_OK) {
  const raiz = mkdtempSync(join(tmpdir(), 'pnpm-nativo-'));
  const tools = join(raiz, '.tools', 'pnpm');
  const real = join(tools, '12.11.2_tmp_1');
  const pacote = join(real, 'node_modules', 'pnpm');
  mkdirSync(pacote, { recursive: true });
  for (const b of BINS) writeFileSync(join(pacote, b), PLACEHOLDER);
  writeFileSync(join(pacote, 'install.js'), install);
  symlinkSync(real, join(tools, '12.11.2'));
  return {
    raiz,
    tools,
    pacote,
    env: { ...process.env, MACUXI_PNPM_TOOLS: tools, npm_lifecycle_event: 'postinstall' },
  };
}

test('pastasTools: PNPM_HOME e XDG_DATA_HOME, sem repetição; MACUXI_PNPM_TOOLS manda', () => {
  assert.deepEqual(pastasTools({ PNPM_HOME: '/p', XDG_DATA_HOME: '/d' }), [
    '/p/.tools/pnpm',
    '/d/pnpm/.tools/pnpm',
  ]);
  assert.deepEqual(pastasTools({ PNPM_HOME: '/d/pnpm', XDG_DATA_HOME: '/d' }), ['/d/pnpm/.tools/pnpm']);
  assert.deepEqual(pastasTools({ MACUXI_PNPM_TOOLS: '/t', PNPM_HOME: '/p' }), ['/t']);
});

test('ehPlaceholder: texto do pnpm sim; binário e arquivo ausente não', () => {
  const { raiz, pacote } = montarTools();
  try {
    assert.equal(ehPlaceholder(join(pacote, 'pnpm')), true);
    writeFileSync(join(pacote, 'pn'), '\x7fELF');
    assert.equal(ehPlaceholder(join(pacote, 'pn')), false);
    assert.equal(ehPlaceholder(join(pacote, 'nao-existe')), false);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('instala o binário uma vez só (link da versão e pasta _tmp contam como uma cópia) e é idempotente', () => {
  const { raiz, tools, pacote, env } = montarTools();
  try {
    assert.equal(copiasComPlaceholder([tools]).length, 1);
    assert.equal(principal([], env), 0);
    for (const b of BINS) assert.equal(ehPlaceholder(join(pacote, b)), false, b);
    assert.equal(readFileSync(join(pacote, 'execucoes.txt'), 'utf8'), 'x');
    // Segunda vez: nada a fazer, o install.js não roda de novo.
    assert.deepEqual(copiasComPlaceholder([tools]), []);
    assert.equal(principal(['--estrito'], env), 0);
    assert.equal(readFileSync(join(pacote, 'execucoes.txt'), 'utf8'), 'x');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('falha do install.js vira aviso (saída 0) e só sai 1 com --estrito', () => {
  const { raiz, pacote, env } = montarTools(INSTALL_FALHA);
  try {
    assert.equal(principal([], env), 0);
    assert.equal(principal(['--estrito'], env), 1);
    assert.equal(ehPlaceholder(join(pacote, 'pnpm')), true);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('sem pasta .tools (CI, PC): não faz nada e sai 0', () => {
  assert.equal(principal(['--estrito'], { MACUXI_PNPM_TOOLS: join(tmpdir(), 'pnpm-nativo-nao-existe') }), 0);
});
