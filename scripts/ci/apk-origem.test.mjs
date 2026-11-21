// Testes da execução de origem do apk-publicar.yml (T-0190). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { commitDaTag, conferirOrigem, erroDaOrigem, WORKFLOW_BUILD } from './apk-origem.mjs';

const SHA = '3823e3217d8911825f729a4b3e7c5a4902ba98d2';
const OUTRO = 'a'.repeat(40);
const ANOTADA = 'b'.repeat(40);
const REPO = 'dono/repo';
const base = { versao: '1.0.18', runId: '44863193919', caminho: WORKFLOW_BUILD, conclusao: 'success', sha: SHA };

test('tag certa passa: head_branch = v<versão> e a tag aponta para o head_sha', () => {
  assert.equal(erroDaOrigem({ ...base, ramo: 'v1.0.18', tagSha: SHA }), null);
});

test('main continua aceito', () => {
  assert.equal(erroDaOrigem({ ...base, ramo: 'main', tagSha: null }), null);
});

test('tag errada falha: outra versão, tag ausente ou a mesma tag em outro SHA', () => {
  assert.match(erroDaOrigem({ ...base, ramo: 'v1.0.17', tagSha: SHA }), /não é da tag v1\.0\.18 nem do main/);
  assert.match(erroDaOrigem({ ...base, ramo: 'v1.0.180', tagSha: SHA }), /não é da tag/);
  assert.match(erroDaOrigem({ ...base, ramo: 'v1.0.18', tagSha: null }), /não existe/);
  assert.match(erroDaOrigem({ ...base, ramo: 'v1.0.18', tagSha: OUTRO }), /aponta para a{40}/);
});

test('branch qualquer falha', () => {
  for (const ramo of ['nuvem/x', 'alexandre/v1019', 'mainx', 'refs/heads/main', '1.0.18', '', undefined])
    assert.match(erroDaOrigem({ ...base, ramo, tagSha: SHA }), /não é da tag/, String(ramo));
});

test('workflow, conclusão, versão e head_sha inválidos falham antes do branch', () => {
  assert.match(erroDaOrigem({ ...base, caminho: '.github/workflows/ci.yml', ramo: 'main' }), /não é do android-build/);
  assert.match(erroDaOrigem({ ...base, conclusao: 'failure', ramo: 'main' }), /não terminou verde/);
  assert.match(erroDaOrigem({ ...base, conclusao: '', ramo: 'main' }), /não terminou verde/);
  assert.match(erroDaOrigem({ ...base, sha: 'abc', ramo: 'main' }), /head_sha/);
  for (const versao of ['v1.0.18', '1.0', '01.0.18', '1.0.18 ', ''])
    assert.match(erroDaOrigem({ ...base, versao, ramo: `v${versao}`, tagSha: SHA }), /versão inválida/, versao);
});

/** gh api falso: mapa caminho → saída (string) ou ausente (404, lança). */
function apiFalsa(mapa) {
  const chamadas = [];
  const api = (args) => {
    chamadas.push(args[1]);
    if (!(args[1] in mapa)) throw new Error('HTTP 404');
    return mapa[args[1]];
  };
  return { api, chamadas };
}

test('commitDaTag: tag leve, tag anotada resolvida e tag ausente', () => {
  const leve = apiFalsa({ [`repos/${REPO}/git/ref/tags/v1.0.18`]: `commit\t${SHA}` });
  assert.equal(commitDaTag({ repositorio: REPO, tag: 'v1.0.18' }, leve.api), SHA);
  const anotada = apiFalsa({
    [`repos/${REPO}/git/ref/tags/v1.0.18`]: `tag\t${ANOTADA}`,
    [`repos/${REPO}/git/tags/${ANOTADA}`]: `commit\t${SHA}`,
  });
  assert.equal(commitDaTag({ repositorio: REPO, tag: 'v1.0.18' }, anotada.api), SHA);
  assert.equal(commitDaTag({ repositorio: REPO, tag: 'v1.0.18' }, apiFalsa({}).api), null);
});

test('conferirOrigem: uma chamada ao run e, só na tag, a resolução da tag', () => {
  const run = `repos/${REPO}/actions/runs/44863193919`;
  const ref = `repos/${REPO}/git/ref/tags/v1.0.18`;
  const ok = apiFalsa({ [run]: `${WORKFLOW_BUILD}\tsuccess\tv1.0.18\t${SHA}`, [ref]: `commit\t${SHA}` });
  assert.equal(conferirOrigem({ versao: '1.0.18', runId: '44863193919', repositorio: REPO }, ok.api), null);
  assert.deepEqual(ok.chamadas, [run, ref]);

  const movida = apiFalsa({ [run]: `${WORKFLOW_BUILD}\tsuccess\tv1.0.18\t${SHA}`, [ref]: `commit\t${OUTRO}` });
  assert.match(conferirOrigem({ versao: '1.0.18', runId: '44863193919', repositorio: REPO }, movida.api), /aponta para/);

  const outraVersao = apiFalsa({ [run]: `${WORKFLOW_BUILD}\tsuccess\tv1.0.18\t${SHA}`, [ref]: `commit\t${SHA}` });
  assert.match(conferirOrigem({ versao: '1.0.19', runId: '44863193919', repositorio: REPO }, outraVersao.api), /não é da tag v1\.0\.19/);
  assert.deepEqual(outraVersao.chamadas, [run]);

  const branch = apiFalsa({ [run]: `${WORKFLOW_BUILD}\tsuccess\tnuvem/x\t${SHA}` });
  assert.match(conferirOrigem({ versao: '1.0.18', runId: '44863193919', repositorio: REPO }, branch.api), /nem do main/);

  assert.match(conferirOrigem({ versao: '1.0.18', runId: '1', repositorio: REPO }, apiFalsa({}).api), /não foi encontrada/);
  assert.match(conferirOrigem({ versao: '1.0.18', runId: '1; rm', repositorio: REPO }, apiFalsa({}).api), /run_id inválido/);
});

test('apk-publicar.yml chama o script com checkout antes e sem a regra antiga "só main"', () => {
  const yml = readFileSync(new URL('../../.github/workflows/apk-publicar.yml', import.meta.url), 'utf8');
  const iCheckout = yml.indexOf('actions/checkout@v4');
  const iScript = yml.indexOf('node scripts/ci/apk-origem.mjs');
  assert.ok(iCheckout > 0 && iScript > iCheckout, 'checkout antes da conferência');
  assert.ok(yml.indexOf('gh run download') > iScript, 'conferência antes do download');
  assert.doesNotMatch(yml, /"\$RAMO" != "main"/);
});
