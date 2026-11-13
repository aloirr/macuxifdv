// Testes da decisão do demo-publicar (T-0160 item 6, ADR 0044). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JOB_DEPLOY, precisaPublicar } from './demo-mudou.mjs';

test('publica com mudança em apps, modules, packages, db, no que monta a imagem e no deploy da demo', () => {
  for (const a of [
    'apps/api/src/app.ts',
    'modules/core/domain/a.ts',
    'packages/ui/x.tsx',
    'db/migrations/0060.sql',
    'pnpm-lock.yaml',
    'package.json',
    'scripts/deploy/demo/implantar.sh',
  ]) {
    assert.equal(precisaPublicar(['docs/a.md', a]), true, a);
  }
});

test('não publica commit só de docs, .coord, *.md, .github, tests ou scripts de CI', () => {
  assert.equal(
    precisaPublicar([
      'docs/desenho/T-0160.md',
      '.coord/quadro.md',
      'CLAUDE.md',
      '.github/workflows/ci.yml',
      'tests/a.test.ts',
      'scripts/ci/escopo.mjs',
      'scripts/deploy/producao/x.sh',
    ]),
    false,
  );
  assert.equal(precisaPublicar([]), false);
});

test('sem base (nenhum deploy encontrado, erro de git ou da API) = publica', () => {
  assert.equal(precisaPublicar(null), true);
});

test('o nome do job de deploy é o do demo-publicar.yml', () => {
  const wf = readFileSync(new URL('../../.github/workflows/demo-publicar.yml', import.meta.url), 'utf8');
  assert.match(wf, new RegExp(`^ {4}name: ${JOB_DEPLOY}$`, 'm'));
});
