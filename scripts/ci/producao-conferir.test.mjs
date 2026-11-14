// Testes da conferência de produção (R-20261114-121700-alexandre). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { conferir, erroDaRef, errosDaEntrada, tagExiste } from './producao-conferir.mjs';

const SHA = '839a082'.padEnd(40, '0');
const ler = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('ref: publicar só roda em tag v*, por push ou disparo manual na tag', () => {
  assert.equal(erroDaRef({ evento: 'push', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), null);
  assert.equal(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), null);
  assert.match(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/heads/main', tag: 'main' }), /só tag v\*/);
  assert.match(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/heads/v1', tag: 'v1' }), /só tag v\*/);
  assert.match(erroDaRef({ evento: 'workflow_run', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), /não publica/);
  assert.match(erroDaRef({ evento: 'push', ref: 'refs/tags/v1 x', tag: 'v1 x' }), /tag inválida/);
});

test('entrada do liberar: vX.Y.Z, SHA de 40 hex e disparo pelo main', () => {
  assert.deepEqual(errosDaEntrada({ versao: 'v1.0.7', sha: SHA, ref: 'refs/heads/main' }), []);
  for (const versao of ['1.0.7', 'v1.0', 'v1.0.7-rc1', 'v01.0.7', 'v1.0.7 ', '', undefined])
    assert.equal(errosDaEntrada({ versao, sha: SHA, ref: 'refs/heads/main' }).length, 1, String(versao));
  for (const sha of ['839a082', SHA.toUpperCase().replace(/0/g, 'A'), `${SHA}0`, 'g'.repeat(40), ''])
    assert.equal(errosDaEntrada({ versao: 'v1.0.7', sha, ref: 'refs/heads/main' }).length, 1, sha);
  assert.match(errosDaEntrada({ versao: 'v1.0.7', sha: SHA, ref: 'refs/heads/nuvem/x' })[0], /pelo main/);
});

test('tag existente: só o nome exato conta (matching-refs devolve por prefixo)', () => {
  assert.equal(tagExiste([{ ref: 'refs/tags/v1.0.7' }], 'v1.0.7'), true);
  assert.equal(tagExiste([{ ref: 'refs/tags/v1.0.70' }], 'v1.0.7'), false);
  assert.equal(tagExiste([], 'v1.0.7'), false);
  assert.equal(tagExiste(null, 'v1.0.7'), false);
});

/** exec falso: cada chave é o primeiro argumento relevante; valor = saída ou Error. */
function execFalso({ main = true, ancestral = true, ci = '1', digest = `sha256:${'a'.repeat(64)}` } = {}) {
  const chamadas = [];
  const exec = (cmd, args) => {
    chamadas.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'rev-parse') { if (!main) throw new Error('x'); return 'abc\n'; }
    if (cmd === 'git' && args[0] === 'merge-base') { if (!ancestral) throw new Error('x'); return ''; }
    if (cmd === 'gh') { if (ci instanceof Error) throw ci; return `${ci}\n`; }
    if (cmd === 'bash') { if (digest instanceof Error) throw digest; return `${digest}\n`; }
    throw new Error(`inesperado: ${cmd}`);
  };
  return { exec, chamadas };
}

const ALVO = { sha: SHA, versao: 'v1.0.7', dono: 'AloirR', repositorio: 'aloirr/macuxifdv' };

test('conferir: no main, CI verde e imagem → api por digest e dono minúsculo', () => {
  const { exec, chamadas } = execFalso();
  const r = conferir(ALVO, exec);
  assert.equal(r.erro, undefined);
  assert.equal(r.dono, 'aloirr');
  assert.equal(r.api, `ghcr.io/aloirr/macuxi-api@sha256:${'a'.repeat(64)}`);
  const gh = chamadas.find((c) => c[0] === 'gh');
  for (const f of [`head_sha=${SHA}`, 'event=push', 'branch=main', 'status=success']) assert.ok(gh.includes(f), f);
  assert.ok(chamadas.find((c) => c[0] === 'bash').includes(`ghcr.io/aloirr/macuxi-api:${SHA}`));
});

test('conferir: cada falha vira erro e para antes do passo seguinte', () => {
  assert.match(conferir(ALVO, execFalso({ main: false }).exec).erro, /origin\/main ausente/);
  assert.match(conferir(ALVO, execFalso({ ancestral: false }).exec).erro, /não está no main/);
  assert.match(conferir(ALVO, execFalso({ ci: '0' }).exec).erro, /CI verde/);
  assert.match(conferir(ALVO, execFalso({ ci: new Error('rede') }).exec).erro, /CI verde/);
  assert.match(conferir(ALVO, execFalso({ digest: '' }).exec).erro, /não está no GHCR/);
  assert.match(conferir(ALVO, execFalso({ digest: new Error('404') }).exec).erro, /não está no GHCR/);
  assert.match(conferir({ ...ALVO, sha: 'abc' }, execFalso().exec).erro, /SHA inválido/);
});

test('workflows: os dois usam a mesma conferência; liberar cria a tag e dispara o publicar na tag', () => {
  const pub = ler('.github/workflows/producao-publicar.yml');
  const lib = ler('.github/workflows/producao-liberar.yml');
  assert.match(pub, /^ {2}workflow_dispatch:/m);
  assert.match(pub, /producao-conferir\.mjs ref/);
  assert.match(pub, /producao-conferir\.mjs conferir/);
  assert.doesNotMatch(pub, /actions\/workflows\/ci\.yml\/runs/, 'conferência duplicada no publicar');
  assert.match(pub, /name: PRODUCAO/);
  assert.match(lib, /producao-conferir\.mjs entrada/);
  assert.match(lib, /producao-conferir\.mjs conferir/);
  assert.match(lib, /contents: write/);
  assert.match(lib, /actions: write/);
  assert.match(lib, /gh workflow run producao-publicar\.yml -R "\$GITHUB_REPOSITORY" --ref "\$VERSAO"/);
  assert.doesNotMatch(lib, /environment:/, 'o liberar não aprova nada: a aprovação é só no PRODUCAO do publicar');
  for (const linha of lib.split('\n').filter((l) => /^\s+(run:|gh |\[\[)/.test(l)))
    assert.doesNotMatch(linha, /\$\{\{/, `interpolação no shell: ${linha.trim()}`);
});
