// Economia do Actions (ADR 0045). node --test scripts/ci/economia-actions.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decidirCommits, decidirTentativa } from './economia-actions.mjs';

test('tentativa: 1 passa calada, 2 (o rerun permitido) avisa, 3 ou mais fica vermelho', () => {
  assert.deepEqual(decidirTentativa('1'), { codigo: 0, nivel: null, tentativa: 1 });
  assert.equal(decidirTentativa(undefined).codigo, 0, 'fora do Actions');
  assert.equal(decidirTentativa('lixo').codigo, 0);
  const dois = decidirTentativa('2');
  assert.equal(dois.codigo, 0);
  assert.equal(dois.nivel, 'warning');
  assert.match(dois.mensagem, /infraestrutura/);
  for (const n of ['3', '7']) {
    const d = decidirTentativa(n);
    assert.equal(d.codigo, 1, n);
    assert.equal(d.nivel, 'error');
    assert.match(d.mensagem, /um rerun só/);
  }
});

test('commits: 0 ou 1 passa calado; mais de 1 só avisa (nunca vermelho)', () => {
  assert.deepEqual(decidirCommits(0), { codigo: 0, nivel: null });
  assert.deepEqual(decidirCommits(1), { codigo: 0, nivel: null });
  const d = decidirCommits(4);
  assert.equal(d.codigo, 0);
  assert.equal(d.nivel, 'warning');
  assert.match(d.mensagem, /4 commits/);
});
