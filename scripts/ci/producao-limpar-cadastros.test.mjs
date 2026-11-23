// node --test scripts/ci/*.test.mjs. Confere, sem banco e sem segredo, as travas do producao-limpar-cadastros.yml e da rotina
// scripts/producao/limpar-cadastros-rotina.sql. O teste de banco (simular, apagar, restaurar e reenvio) é o
// scripts/producao/teste/limpar-cadastros.teste.sh, no Postgres local da sessão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const wf = ler('.github/workflows/producao-limpar-cadastros.yml');
const rotina = ler('scripts/producao/limpar-cadastros-rotina.sql');
const limpar = ler('scripts/producao/limpar-cadastros.sql');
const restaurar = ler('scripts/producao/limpar-cadastros-restaurar.sql');

test('workflow: só manual, PRODUCAO, fila da VM, só leitura do repositório e só numa tag', () => {
  assert.match(wf, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(wf, /^\s+(push|pull_request|schedule|workflow_call):/m);
  assert.match(wf, /environment: PRODUCAO/);
  assert.match(wf, /concurrency:\n {2}group: producao-vm\n {2}cancel-in-progress: false/);
  assert.match(wf, /permissions:\n {2}contents: read\n/);
  assert.match(wf, /\[ "\$GITHUB_REF_TYPE" = tag \]/);
});

test('workflow: confirmação literal no apagar e no restaurar', () => {
  assert.match(wf, /\[ "\$CONFIRMAR" = "APAGAR CADASTROS \$EMPRESA" \]/);
  assert.match(wf, /\[ "\$CONFIRMAR" = "RESTAURAR CADASTROS \$EMPRESA \$LOTE" \]/);
  assert.match(wf, /options: \[simular, apagar, restaurar\]/);
});

test('workflow: segredos só pelo environment, chave apagada no fim, sem docker no runner', () => {
  for (const s of wf.matchAll(/secrets\.([A-Z_]+)/g)) assert.match(s[1], /^PROD_(SSH_KEY|HOST|SSH_KNOWN_HOSTS|USER)$/);
  assert.match(wf, /acao: limpar\n\s+arquivos: limpeza\.sql saida\.txt dump\.txt/);
  assert.match(wf, /if: \$\{\{ always\(\) && steps\.chave\.outcome != 'skipped' \}\}/);
  // docker só dentro do comando remoto (a VM): nenhuma linha do run começa com docker
  assert.doesNotMatch(wf, /^\s+docker /m);
  assert.doesNotMatch(wf, /PGPASSWORD|MACUXI_PG_ADMIN_SENHA/);
});

test('montar-limpeza.sh: ON_ERROR_STOP antes da rotina e do roteiro', () => {
  const sql = execFileSync('bash', [new URL('../producao/montar-limpeza.sh', import.meta.url).pathname, 'limpar'], { encoding: 'utf8' });
  assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\n'));
  assert.ok(sql.indexOf('create or replace function pg_temp.macuxi_limpar_cadastros') < sql.indexOf('from pg_temp.macuxi_limpar_cadastros('));
  const r = execFileSync('bash', [new URL('../producao/montar-limpeza.sh', import.meta.url).pathname, 'restaurar'], { encoding: 'utf8' });
  assert.ok(r.startsWith('\\set ON_ERROR_STOP on\n'));
});

test('rotina: físico só no Hub; usuários, perfis, conectores e credenciais ficam fora da cascata', () => {
  const lista = (nome) => [...rotina.match(new RegExp(`${nome} constant text\\[\\] := array\\[([^\\]]+)\\]`))[1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
  for (const t of lista('c_fisico')) assert.match(t, /^integracao\./);
  const fica = lista('c_fica');
  for (const t of ['core.usuario', 'core.usuario_filial', 'integracao.conector', 'integracao.credencial', 'integracao.credencial_erp', 'integracao.mapeamento'])
    assert.ok(fica.includes(t), `${t} fica`);
  // o schema plataforma inteiro fica fora da cascata, menos plataforma.arquivo
  assert.match(rotina, /and \(n\.nspname <> 'plataforma' or c\.relname = 'arquivo'\)/);
  // DELETE só no modo físico; a rotina não abre nem fecha transação
  assert.equal([...rotina.matchAll(/delete from/g)].length, 1);
  assert.doesNotMatch(rotina, /^\s*(begin|commit|rollback);/m);
  assert.match(rotina, /cópia de segurança|macuxi_limpeza_backup/);
  assert.match(rotina, /revoke all on public\.macuxi_limpeza_backup from public/);
});

test('roteiro: commit só no apagar; simular faz rollback; restaurar não apaga nada', () => {
  assert.match(limpar, /\\if :gravar\ncommit;/);
  assert.match(limpar, /\\else\nrollback;\n\\echo\n\\echo 'SIMULADO: ROLLBACK/);
  assert.match(limpar, /select :'modo' = 'apagar' as gravar \\gset/);
  assert.match(limpar, /\\set VERBOSITY terse/);
  assert.doesNotMatch(restaurar, /delete from|truncate/i);
  assert.match(restaurar, /\\set VERBOSITY terse/);
});
