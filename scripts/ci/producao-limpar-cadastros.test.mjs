// node --test scripts/ci/*.test.mjs. Confere, sem banco e sem segredo, as travas do producao-limpar-cadastros.yml e que os roteiros
// só chamam as funções da 0099 (ADR 0068: uma regra só, no banco). O teste de banco (simular, apagar, por entidade, restaurar,
// descartar, reenvio e banco sem a 0099) é o scripts/producao/teste/limpar-cadastros.teste.sh, no Postgres local da sessão; o
// da regra em si fica nos testes da 0099 (db/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const wf = ler('.github/workflows/producao-limpar-cadastros.yml');
const limpar = ler('scripts/producao/limpar-cadastros.sql');
const restaurar = ler('scripts/producao/limpar-cadastros-restaurar.sql');
const descartar = ler('scripts/producao/limpar-cadastros-descartar.sql');
const montar = (modo) => execFileSync('bash', [new URL('../producao/montar-limpeza.sh', import.meta.url).pathname, modo], { encoding: 'utf8' });

test('workflow: só manual, PRODUCAO, fila da VM, só leitura do repositório e só numa tag', () => {
  assert.match(wf, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(wf, /^\s+(push|pull_request|schedule|workflow_call):/m);
  assert.match(wf, /environment: PRODUCAO/);
  assert.match(wf, /concurrency:\n {2}group: producao-vm\n {2}cancel-in-progress: false/);
  assert.match(wf, /permissions:\n {2}contents: read\n/);
  assert.match(wf, /\[ "\$GITHUB_REF_TYPE" = tag \]/);
});

test('workflow: frase de confirmação no apagar, no restaurar e no descartar; backup do banco antes do apagar', () => {
  assert.match(wf, /\[ "\$CONFIRMAR" = "APAGAR CADASTROS \$EMPRESA" \]/);
  assert.match(wf, /frase="RESTAURAR CADASTROS \$EMPRESA \$LOTE"/);
  assert.match(wf, /frase="DESCARTAR COPIA \$EMPRESA \$LOTE"/);
  assert.match(wf, /options: \[simular, apagar, restaurar, descartar\]/);
  const backup = wf.indexOf('/opt/macuxi/backup/backup-dbaas.sh');
  assert.ok(backup > 0 && backup < wf.indexOf('name: ${{ inputs.modo }} na VM'), 'o backup do banco vem antes do apagar');
  // o arquivo na VM leva só as linhas do lote (montar-limpeza.sh arquivo)
  assert.match(wf, /bash scripts\/producao\/montar-limpeza\.sh arquivo > arquivo\.sql/);
  assert.match(montar('arquivo'), /\ncopy \(select \* from plataforma\.limpeza_copia where lote = :'lote' and tenant_id = :'tenant'\) to stdout;\n$/);
});

test('workflow: segredos só pelo environment, chave apagada no fim, sem docker no runner', () => {
  for (const s of wf.matchAll(/secrets\.([A-Z_]+)/g)) assert.match(s[1], /^PROD_(SSH_KEY|HOST|SSH_KNOWN_HOSTS|USER)$/);
  assert.match(wf, /acao: limpar\n\s+arquivos: limpeza\.sql arquivo\.sql saida\.txt dump\.txt backup\.txt/);
  assert.match(wf, /if: \$\{\{ always\(\) && steps\.chave\.outcome != 'skipped' \}\}/);
  // docker só dentro do comando remoto (a VM): nenhuma linha do run começa com docker
  assert.doesNotMatch(wf, /^\s+docker /m);
  assert.doesNotMatch(wf, /PGPASSWORD|MACUXI_PG_ADMIN_SENHA/);
});

test('workflow: entidades opcionais só no simular e no apagar; lote do workflow ou do portal', () => {
  assert.match(wf, /\n {6}entidades:\n {8}description: [^\n]+\n {8}required: false\n {8}default: ''\n/);
  assert.match(wf, /\[\[ "\$ENTIDADES" =~ \^\(\[a-z_\]\+\(,\[a-z_\]\+\)\*\)\?\$ \]\]/);
  assert.match(wf, /simular \| apagar\) roteiro=limpar; args=\(-v "empresa=\$EMPRESA" -v "modo=\$MODO" -v "lote=\$LOTE" -v "entidades=\$ENTIDADES"\) ;;/);
  assert.match(wf, /\[\[ "\$LOTE" =~ \^\[0-9\]\{8\}T\[0-9\]\{6\}Z\(-\[0-9a-f\]\{8\}\)\?\$ \]\]/);
});

test('montar-limpeza.sh: o preâmbulo psql sai uma vez, antes do roteiro', () => {
  for (const modo of ['limpar', 'restaurar', 'descartar', 'arquivo']) {
    const sql = montar(modo);
    assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\n'), modo);
    assert.equal(sql.split('\\set VERBOSITY terse').length, 2, modo);
  }
  for (const t of [limpar, restaurar, descartar]) assert.doesNotMatch(t, /\\set (ON_ERROR_STOP|QUIET|VERBOSITY)/);
  // a conferência de lote, 0099 e empresa sai uma vez, do montar, em todos os modos, e a da 0099 vem antes de tudo o que lê
  for (const modo of ['limpar', 'restaurar', 'descartar', 'arquivo']) {
    const sql = montar(modo);
    assert.equal(sql.split('empresa não encontrada').length, 2, modo);
    assert.equal(sql.split('o banco ainda não tem a migração 0099').length, 2, modo);
    assert.ok(sql.indexOf('as tem_0099') < sql.indexOf('tenant_por_codigo'), modo);
  }
  assert.match(montar('limpar'), /p\.proname in \('limpar_cadastros', 'restaurar_limpeza', 'descartar_limpeza'\)\) as tem_0099 \\gset/);
  assert.match(montar('limpar'), /to_regclass\('plataforma\.limpeza_copia'\) is not null/);
  assert.match(montar('limpar'), /:'lote' ~ '\^\[0-9\]\{8\}T\[0-9\]\{6\}Z\(-\[0-9a-f\]\{8\}\)\?\$'/);
  for (const t of [limpar, restaurar, descartar]) assert.doesNotMatch(t, /entradas_ok|achou|tenant_por_codigo|tem_0099/);
});

test('uma regra só: os roteiros chamam as funções da 0099, sem rotina própria nem a cópia antiga', () => {
  assert.equal(existsSync(new URL('../producao/limpar-cadastros-rotina.sql', import.meta.url)), false);
  const pasta = new URL('../producao/', import.meta.url);
  const todos = [wf, ...readdirSync(pasta).filter((f) => /\.(sql|sh)$/.test(f)).map((f) => readFileSync(new URL(f, pasta), 'utf8'))];
  for (const t of todos) {
    assert.doesNotMatch(t, /pg_temp\.|macuxi_limpeza_backup|limpar-cadastros-rotina/);
    // nenhum roteiro escreve direto em tabela: delete, update e insert só dentro das funções do banco
    assert.doesNotMatch(t, /^\s*(with [^\n]*\()?\s*(delete from|update [a-z_]+\.|insert into) /im);
  }
  assert.match(limpar, /from plataforma\.limpar_cadastros\(:'tenant'::uuid, :'lote', string_to_array\(nullif\(:'entidades', ''\), ','\), :'gravar'::boolean\)/);
  assert.match(restaurar, /select \* from plataforma\.restaurar_limpeza\(:'tenant'::uuid, :'lote'\);/);
  assert.match(descartar, /select \* from plataforma\.descartar_limpeza\(:'tenant'::uuid, :'lote'\);/);
});

test('roteiros: commit só no apagar; simular faz rollback; entidades vazias = a empresa inteira', () => {
  assert.match(limpar, /\\if :gravar\ncommit;\n\\echo 'APAGADO: transação confirmada'\n\\else\nrollback;\n\\echo 'SIMULADO: ROLLBACK, nada mudou'\n\\endif\n$/);
  assert.match(limpar, /select :'modo' = 'apagar' as gravar \\gset/);
  assert.match(limpar, /\\if :\{\?entidades\}\n\\else\n\\set entidades ''\n\\endif\n/);
  for (const t of [restaurar, descartar]) assert.match(t, /^begin;\n[\s\S]*\ncommit;\n\\echo '[A-Z]+'\n$/m);
});
