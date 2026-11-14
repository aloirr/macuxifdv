// Guardião ligado no CI e na nuvem (ADR 0045). node --test scripts/ci/guardiao-ligado.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ehConfigDeAmbiente, ocorrencias, varrerRepositorio, violacoesDoAmbiente } from './guardiao-ligado.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('arquivos olhados: workflows, settings do Claude, devcontainer, package.json e scripts de shell; nunca .env', () => {
  for (const a of [
    '.github/workflows/ci.yml', '.github/actions/x/action.yml', '.claude/settings.json', '.claude/settings.local.json',
    '_instalar/claude/settings.json', '.devcontainer/devcontainer.json', '.vscode/settings.json', 'package.json',
    'apps/api/package.json', 'turbo.json', '.npmrc', 'pnpm-workspace.yaml', 'db/backup/backup-vm.sh',
    'scripts/demo/subir-demo.ps1', '_instalar/subir-demo.cmd', 'x.bat',
  ]) assert.equal(ehConfigDeAmbiente(a), true, a);
  for (const a of ['.env', 'db/.env.example', '.env.producao', 'docs/decisoes/0045.md', '.claude/hooks/guarda-donos.mjs', 'scripts/ci/x.mjs', 'CLAUDE.md']) {
    assert.equal(ehConfigDeAmbiente(a), false, a);
  }
});

test('MACUXI_GUARDA=off em qualquer sintaxe de configuração é proibido', () => {
  for (const linha of [
    'MACUXI_GUARDA: off',
    "  MACUXI_GUARDA: 'off'",
    '      MACUXI_GUARDA: "OFF"',
    '{ "env": { "MACUXI_GUARDA": "off" } }',
    'MACUXI_GUARDA=off pnpm test',
    'export MACUXI_GUARDA=Off',
    "$env:MACUXI_GUARDA = 'off'",
    'set MACUXI_GUARDA=off',
    'run: MACUXI_GUARDA=off node x.mjs # comentário no fim não salva',
  ]) {
    const o = ocorrencias(linha);
    assert.equal(o.length, 1, linha);
    assert.equal(o[0].variavel, 'MACUXI_GUARDA');
  }
});

test('valor por expressão também é proibido (não dá para revisar)', () => {
  for (const linha of ['MACUXI_GUARDA: ${{ vars.GUARDA }}', 'MACUXI_GUARDA=$GUARDA', 'set MACUXI_GUARDA=%GUARDA%', '"MACUXI_GUARDA": "${X}"']) {
    assert.equal(ocorrencias(linha).length, 1, linha);
  }
});

test('MACUXI_GH_SIMULADO com qualquer valor é proibido; vazio passa', () => {
  assert.equal(ocorrencias('MACUXI_GH_SIMULADO: /tmp/gh.mjs').length, 1);
  assert.equal(ocorrencias('"MACUXI_GH_SIMULADO": "x.mjs"').length, 1);
  assert.equal(ocorrencias("MACUXI_GH_SIMULADO: ''").length, 0);
});

test('não contam: vazio, on, outra variável, comentário e menção sem atribuição', () => {
  for (const linha of [
    "MACUXI_GUARDA: ''",
    'MACUXI_GUARDA=',
    'MACUXI_GUARDA: on',
    'MACUXI_GUARDA_CONEXAO: off',
    '# MACUXI_GUARDA=off só no PC do Alexandre',
    '  # MACUXI_GUARDA: off',
    'REM set MACUXI_GUARDA=off',
    ':: set MACUXI_GUARDA=off',
    '// "MACUXI_GUARDA": "off"',
    'env -u MACUXI_GUARDA node x.mjs',
  ]) assert.deepEqual(ocorrencias(linha), [], linha);
});

test('linha certa na ocorrência', () => {
  const o = ocorrencias('env:\n  A: 1\n  MACUXI_GUARDA: off\n');
  assert.equal(o[0].linha, 3);
});

test('ambiente do job: MACUXI_GUARDA=off ou MACUXI_GH_SIMULADO definida = violação', () => {
  assert.deepEqual(violacoesDoAmbiente({}), []);
  assert.deepEqual(violacoesDoAmbiente({ MACUXI_GUARDA: '' }), []);
  assert.equal(violacoesDoAmbiente({ MACUXI_GUARDA: ' OFF ' }).length, 1);
  assert.equal(violacoesDoAmbiente({ MACUXI_GH_SIMULADO: 'x.mjs' }).length, 1);
});

test('o repositório de hoje passa, e o script sai com 1 quando o próprio processo tem MACUXI_GUARDA=off', () => {
  assert.deepEqual(varrerRepositorio(RAIZ), []);
  const env = { ...process.env };
  delete env.MACUXI_GH_SIMULADO;
  const script = join(RAIZ, 'scripts', 'ci', 'guardiao-ligado.mjs');
  const ok = spawnSync(process.execPath, [script], { cwd: RAIZ, encoding: 'utf8', env: { ...env, MACUXI_GUARDA: '' } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const desligado = spawnSync(process.execPath, [script], { cwd: RAIZ, encoding: 'utf8', env: { ...env, MACUXI_GUARDA: 'off' } });
  assert.equal(desligado.status, 1);
  assert.match(desligado.stdout, /::error title=guardião desligado::MACUXI_GUARDA=off/);
});
