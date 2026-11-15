// ADR 0053: as credenciais do FCM HTTP v1 chegam só ao worker (o despachante envia o push), com os nomes da ADR.
// node --test scripts/ci/*.test.mjs. Confere, sem segredo nenhum: env.modelo × compose.yml × preparar-vm.sh × producao-publicar.yml.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = new URL('../../', import.meta.url);
const ler = (c) => readFileSync(fileURLToPath(new URL(c, RAIZ)), 'utf8').replace(/\r\n/g, '\n');
const NOMES = ['FCM_PROJECT_ID', 'FCM_SERVICE_ACCOUNT_JSON', 'MACUXI_PUSH_ATIVO'];

test('env.modelo: bloco push.env com a conta de serviço, o projeto e a chave do push', () => {
  const modelo = ler('scripts/deploy/producao/env.modelo');
  const inicio = modelo.indexOf('/opt/macuxi/push.env');
  assert.ok(inicio >= 0, 'env.modelo sem o bloco push.env');
  const bloco = modelo.slice(inicio, modelo.indexOf('\n# ----------', inicio));
  assert.deepEqual([...bloco.matchAll(/^([A-Z_]+)=$/gm)].map((m) => m[1]).sort(), NOMES);
});

test('compose: push.env só no worker, opcional', () => {
  const compose = ler('scripts/deploy/producao/compose.yml');
  const corpo = compose.slice(compose.indexOf('\nservices:\n'), compose.indexOf('\nnetworks:\n'));
  const com = [];
  let atual = null;
  for (const linha of corpo.split('\n')) {
    const m = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(linha);
    if (m) atual = m[1];
    else if (atual && /- path: push\.env/.test(linha)) com.push(atual);
  }
  assert.deepEqual(com, ['worker']);
  assert.match(compose, /- path: push\.env\n\s+required: false/);
  assert.doesNotMatch(compose.slice(0, compose.indexOf('\nservices:\n')).replace(/^#.*$/gm, ''), /push\.env/, 'push.env fora das âncoras comuns');
});

test('preparar-vm.sh: push.env entra no acerto de dono e modo 600', () => {
  assert.match(ler('scripts/deploy/producao/preparar-vm.sh'), /for f in [^;]*\bpush\.env\b[^;]*; do/);
});

test('producao-publicar: PROD_FCM_* conferidos juntos e gravados no push.env com a chave do push', () => {
  const wf = ler('.github/workflows/producao-publicar.yml');
  for (const s of ['PROD_FCM_SERVICE_ACCOUNT_JSON', 'PROD_FCM_PROJECT_ID']) {
    assert.ok((wf.match(new RegExp(`secrets\\.${s} \\}\\}`, 'g')) ?? []).length >= 2, `${s} no passo dos secrets e no de gravar`);
  }
  assert.match(wf, /vão juntos/);
  const gravacao = wf.slice(wf.indexOf("printf 'FCM_SERVICE_ACCOUNT_JSON="), wf.indexOf('grava push.env'));
  for (const n of NOMES) assert.ok(gravacao.includes(`${n}=`), `${n} não vai para o push.env`);
  assert.doesNotMatch(wf, /echo[^\n]*\$(FCM_CONTA|PROD_FCM_SERVICE_ACCOUNT_JSON)\b/, 'conta de serviço impressa no log');
});
