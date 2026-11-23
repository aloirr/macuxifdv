// node --test scripts/ci/*.test.mjs. Confere, sem banco e sem segredo, as travas do producao-limpar-cadastros.yml e da rotina
// scripts/producao/limpar-cadastros-rotina.sql. O teste de banco (simular, apagar, restaurar, descartar e reenvio) é o
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
const descartar = ler('scripts/producao/limpar-cadastros-descartar.sql');
const montar = (modo) => execFileSync('bash', [new URL('../producao/montar-limpeza.sh', import.meta.url).pathname, modo], { encoding: 'utf8' });
const lista = (texto, nome) => [...texto.match(new RegExp(`${nome}(?: constant)? text\\[\\] := array\\[([^\\]]+)\\]`))[1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);

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
  assert.match(montar('arquivo'), /\ncopy \(select \* from public\.macuxi_limpeza_backup where lote = :'lote' and tenant_id = :'tenant'\) to stdout;\n$/);
});

test('workflow: segredos só pelo environment, chave apagada no fim, sem docker no runner', () => {
  for (const s of wf.matchAll(/secrets\.([A-Z_]+)/g)) assert.match(s[1], /^PROD_(SSH_KEY|HOST|SSH_KNOWN_HOSTS|USER)$/);
  assert.match(wf, /acao: limpar\n\s+arquivos: limpeza\.sql arquivo\.sql saida\.txt dump\.txt backup\.txt/);
  assert.match(wf, /if: \$\{\{ always\(\) && steps\.chave\.outcome != 'skipped' \}\}/);
  // docker só dentro do comando remoto (a VM): nenhuma linha do run começa com docker
  assert.doesNotMatch(wf, /^\s+docker /m);
  assert.doesNotMatch(wf, /PGPASSWORD|MACUXI_PG_ADMIN_SENHA/);
});

test('montar-limpeza.sh: o preâmbulo psql sai uma vez, antes do roteiro', () => {
  for (const modo of ['limpar', 'restaurar', 'descartar', 'arquivo']) {
    const sql = montar(modo);
    assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\n'), modo);
    assert.equal(sql.split('\\set VERBOSITY terse').length, 2, modo);
  }
  const sql = montar('limpar');
  assert.ok(sql.indexOf('create or replace function pg_temp.macuxi_limpar_cadastros') < sql.indexOf('from pg_temp.macuxi_limpar_cadastros('));
  for (const t of [rotina, limpar, restaurar, descartar]) assert.doesNotMatch(t, /\\set (ON_ERROR_STOP|QUIET|VERBOSITY)/);
  // a conferência de lote e empresa sai uma vez, do montar, em todos os modos
  for (const modo of ['limpar', 'restaurar', 'descartar', 'arquivo']) assert.equal(montar(modo).split('empresa não encontrada').length, 2, modo);
  for (const t of [limpar, restaurar, descartar]) assert.doesNotMatch(t, /entradas_ok|achou|tenant_por_codigo/);
});

test('rotina: físico = Hub, filas e projeção; restaurar volta o mesmo conjunto; o que fica não entra na cascata', () => {
  const fisico = [...lista(rotina, 'c_hub'), ...lista(rotina, 'c_filas')];
  assert.match(rotina, /c_fisico constant text\[\] := c_hub \|\| c_filas;/);
  for (const t of fisico) assert.match(t, /^(integracao\.|gestor\.projecao_fato$)/);
  assert.deepEqual([...lista(restaurar, 'v_fisico')].sort(), [...fisico].sort());
  const fica = lista(rotina, 'c_fica');
  for (const t of ['core.filial', 'core.equipe', 'integracao.conector', 'integracao.credencial', 'integracao.credencial_erp', 'integracao.mapeamento'])
    assert.ok(fica.includes(t), `${t} fica`);
  // do schema plataforma, só arquivo e os vínculos do usuário entram na cascata (tenant, perfis, parâmetros e licenças ficam)
  assert.deepEqual(lista(rotina, 'c_plataforma'), ['arquivo', 'usuario_perfil', 'usuario_modulo']);
  assert.match(rotina, /and \(n\.nspname <> 'plataforma' or c\.relname = any \(c_plataforma\)\)/);
  // usuários: saem todos menos os administradores (perfil principal ou vínculo vivo com perfil de base admin), e o token cai
  assert.match(rotina, /u\.deleted_at is null and u\.perfil <> 'admin'\n\s+and not exists \(select 1 from plataforma\.usuario_perfil up join plataforma\.perfil pf [\s\S]*? pf\.base = 'admin'\);/);
  assert.match(rotina, /update core\.usuario u set sessao_versao = u\.sessao_versao \+ 1/);
  // para core.usuario, só as colunas de posse levam a linha; as de autoria (autor_id, *_por) ficam como histórico
  assert.deepEqual(lista(rotina, 'c_posse'), ['usuario_id', 'vendedor_id', 'promotor_id']);
  assert.match(rotina, /where x\.alvo <> 'core\.usuario' or x\.coluna = any \(c_posse\);/);
  // DELETE só no modo físico; a rotina não abre nem fecha transação; trava o Hub
  assert.equal([...rotina.matchAll(/delete from/g)].length, 1);
  assert.doesNotMatch(rotina, /^\s*(begin|commit|rollback);/m);
  assert.match(rotina, /lock table integracao\.lote, integracao\.registro_atual, integracao\.sessao_carga in share row exclusive mode;/);
  assert.match(rotina, /revoke all on public\.macuxi_limpeza_backup from public/);
});

test('roteiros: commit só no apagar; simular faz rollback; restaurar não apaga nada; descartar só a cópia', () => {
  assert.match(limpar, /\\if :gravar\ncommit;\n\\echo 'APAGADO: transação confirmada'\n\\else\nrollback;\n\\echo 'SIMULADO: ROLLBACK, nada mudou'\n\\endif\n$/);
  assert.match(limpar, /select :'modo' = 'apagar' as gravar \\gset/);
  assert.doesNotMatch(restaurar, /delete from|truncate/i);
  assert.deepEqual([...descartar.matchAll(/delete from ([a-z_.]+)/g)].map((m) => m[1]), ['public.macuxi_limpeza_backup']);
});
