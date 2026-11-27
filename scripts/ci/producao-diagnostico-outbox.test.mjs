// node --test scripts/ci/*.test.mjs. Confere, sem banco e sem segredo, a consulta de um cliente do producao-diagnostico-outbox.yml
// (v1.0.39, Teste 003, R-20261126-184213): a entrada validada, o valor entre aspas no \set e o bloco sem a mensagem nem o payload.
// O teste no banco (macuxi_leitura, só leitura, dois tenants) roda na sessão, no Postgres local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wf = readFileSync(
  new URL('../../.github/workflows/producao-diagnostico-outbox.yml', import.meta.url),
  'utf8',
);
const passo = wf.split('- name: entradas e consulta')[1].split('\n      - name:')[0];
const run = passo.split('        run: |\n')[1].replace(/^ {10}/gm, '');

const montar = (cliente) => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  try {
    const r = spawnSync('bash', ['-c', run], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RUNNER_TEMP: dir,
        EMPRESAS: 'alfa',
        CONTAGEM_CATALOGO: 'false',
        CONTAGEM_INTEGRACAO: 'false',
        CLIENTE_EXTERNAL_ID: cliente,
      },
    });
    return {
      status: r.status,
      saida: r.stdout,
      sql: r.status === 0 ? readFileSync(join(dir, 'consulta.sql'), 'utf8') : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('cliente: vazio não consulta; válido entra entre aspas no \\set (sem interpolar ":max")', () => {
  assert.match(montar('  ').sql, /^\\set tem_cliente false$/m);
  const { sql } = montar(' CLI:max/01 ');
  assert.match(sql, /^\\set tem_cliente true\n\\set cliente_eid 'CLI:max\/01'$/m);
});

test('cliente: aspas, espaço, barra invertida, ponto e vírgula e mais de 200 caracteres param com ::error::', () => {
  for (const v of ["A'B", 'A"B', 'A B', 'A\\B', 'A;B', 'A\nB', 'A'.repeat(201)]) {
    const r = montar(v);
    assert.equal(r.status, 1, JSON.stringify(v));
    assert.match(r.saida, /::error::external_id de cliente inválido/);
  }
});

test('cliente: K1 a K4 filtram o tenant e nunca leem nome, documento, mensagem nem payload', () => {
  const bloco = run.split('\\if :tem_cliente')[1].split('\\endif')[0];
  const selects = bloco.split(/\\echo 'K\d/).slice(1);
  assert.equal(selects.length, 4);
  for (const s of selects)
    assert.match(s, /\.tenant_id = \(select id from plataforma\.tenant_por_codigo\('__CODIGO__'\)\)/);
  const sql = bloco.replace(/^\\echo .*$/gm, '');
  assert.doesNotMatch(sql, /\b(nome|razao_social|documento|cnpj|cpf|mensagem|payload)\b/);
});
