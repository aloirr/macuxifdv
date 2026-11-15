// Consulta só leitura na produção (R-20261115-073000-alexandre, item 5): catálogo, entrada, recusa de dado pessoal,
// transação READ ONLY e o caminho até o banco (workflow × compose × preparar-vm). node --test scripts/ci/*.test.mjs.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TERMOS_SENSIVEIS, analisarArquivo, analisarSaida, colunaPessoal, lerCatalogo, montarScript, argumentosPsql, paraMarkdown, validarEntrada,
  valorPermitido,
} from '../producao/consulta.mjs';

const RAIZ = new URL('../../', import.meta.url);
const ler = (c) => readFileSync(fileURLToPath(new URL(c, RAIZ)), 'utf8').replace(/\r\n/g, '\n');
const CATALOGO = lerCatalogo();

const arquivo = (blocos, parametros = 'external_id') =>
  `-- descricao: teste\n-- parametros: ${parametros}\n${blocos}`;
const bloco = (sql, colunas = 'id', rotulo = 'q') => `-- @consulta ${rotulo}\n-- @colunas ${colunas}\n${sql}\n`;
const problemas = (sql, colunas) => analisarArquivo('teste', arquivo(bloco(sql, colunas))).problemas;
const OK = "select u.id from core.usuario u where u.tenant_id = :'tenant_id';";

// ---------- catálogo ----------

test('catálogo real: sem problema, e as primeiras consultas (Anderson e "Sem preço") existem', () => {
  assert.deepEqual(CATALOGO.problemas, []);
  assert.ok(CATALOGO.consultas.has('vendedor-erp'));
  assert.ok(CATALOGO.consultas.has('catalogo-sem-preco'));
  assert.deepEqual(CATALOGO.consultas.get('vendedor-erp').parametros, ['external_id']);
  assert.deepEqual(CATALOGO.consultas.get('catalogo-sem-preco').parametros, []);
});

test('catálogo real: nenhuma consulta filtra ou devolve nome (o "nome ilike" do diagnóstico saiu)', () => {
  for (const c of CATALOGO.consultas.values()) {
    for (const b of c.blocos) {
      assert.doesNotMatch(b.sql, /\bnome\s+i?like\b/i, `${c.nome}/${b.rotulo}`);
      for (const col of b.colunas) assert.equal(colunaPessoal(col), false, `${c.nome}/${b.rotulo}: ${col}`);
    }
  }
});

test('workflow: as opções de consulta são exatamente o catálogo', () => {
  const wf = ler('.github/workflows/producao-consulta.yml');
  const opcoes = /consulta:\n(?:\s+[a-z].*\n)*?\s+options: \[([^\]]*)\]/.exec(wf)?.[1].split(/\s*,\s*/);
  assert.deepEqual(opcoes, [...CATALOGO.consultas.keys()].sort());
});

test('bloco válido passa', () => {
  assert.deepEqual(problemas(OK), []);
});

test('só SELECT/WITH, um comando por bloco', () => {
  assert.match(problemas("update core.usuario set ativo = false where tenant_id = :'tenant_id';").join(), /começar por select|palavra proibida: update/);
  assert.match(problemas(`${OK} ${OK}`).join(), /um comando por bloco/);
  assert.match(problemas(OK.slice(0, -1)).join(), /um comando por bloco/);
});

test('escrita escondida em CTE, função, trava ou meta-comando é recusada', () => {
  const casos = [
    ["with x as (delete from core.carteira where tenant_id = :'tenant_id' returning id) select id from x;", /delete/],
    ["select id from core.usuario where tenant_id = :'tenant_id' for update;", /for update|update/],
    ["select set_config('app.tenant_id', 'x', false) as id from core.usuario where tenant_id = :'tenant_id';", /set_config/],
    ["select pg_sleep(60) as id from core.usuario where tenant_id = :'tenant_id';", /pg_sleep/],
    ["select plataforma.sa_revogar(id) as id from core.usuario where tenant_id = :'tenant_id';", /função com schema/],
    ["select id into temp t from core.usuario where tenant_id = :'tenant_id';", /into/],
    ["select id from core.usuario where tenant_id = :'tenant_id' \\g /tmp/x;", /meta-comando/],
    ["select $$x$$ as id from core.usuario where tenant_id = :'tenant_id';", /cifrão/],
  ];
  for (const [sql, re] of casos) assert.match(problemas(sql).join(' | '), re, sql);
});

test('palavra proibida dentro de literal ou comentário não conta; updated_at não é update', () => {
  assert.deepEqual(problemas("select u.id from core.usuario u -- delete aqui\n where u.tenant_id = :'tenant_id' and u.perfil <> 'drop' and u.updated_at is not null;"), []);
});

test('variáveis: só tenant_id e os parâmetros declarados, sempre citadas', () => {
  assert.match(problemas("select id from core.usuario where tenant_id = :'tenant_id' and external_id = :'outro';").join(), /variável não permitida: outro/);
  assert.match(problemas("select id from core.usuario where tenant_id = :'tenant_id' and external_id = :external_id;").join(), /citada/);
  const semParam = analisarArquivo('teste', arquivo(bloco("select id from core.usuario where tenant_id = :'tenant_id' and external_id = :'external_id';"), 'nenhum'));
  assert.match(semParam.problemas.join(), /sem declarar/);
  assert.deepEqual(problemas("select id::text as id from core.usuario where tenant_id = :'tenant_id' and created_at > '2026-01-01 10:00';"), []);
});

test('sem filtro por tenant é recusado', () => {
  assert.match(problemas('select id from core.usuario;').join(), /tenant_id/);
});

// ---------- dado pessoal ----------

test('coluna de saída com nome, e-mail, CPF/CNPJ, telefone ou endereço é recusada; flag é aceita', () => {
  for (const c of ['nome', 'email', 'cpf', 'cnpj', 'cpf_cnpj', 'documento', 'telefone', 'celular', 'endereco', 'logradouro', 'cep',
    'bairro', 'razao_social', 'nome_fantasia', 'cliente_nome', 'email_do_vendedor', 'senha_hash', 'payload', 'ultimo_erro']) {
    assert.equal(colunaPessoal(c), true, c);
  }
  for (const c of ['id', 'perfil', 'sem_email', 'nome_vazio', 'tem_telefone', 'sem_senha', 'clientes', 'provisorio']) {
    assert.equal(colunaPessoal(c), false, c);
  }
  assert.match(problemas("select u.id as nome from core.usuario u where u.tenant_id = :'tenant_id';", 'nome').join(), /dado pessoal: nome/);
});

test('coluna pessoal no SQL só como flag (is null, like no e-mail, coalesce(trim) vazio, = ou in com literal)', () => {
  const sql = (expr) => `select ${expr} as x from core.usuario u where u.tenant_id = :'tenant_id';`;
  assert.match(problemas(sql('u.nome'), 'x').join(), /coluna pessoal "nome"/);
  assert.match(problemas(sql('u.email'), 'x').join(), /coluna pessoal "email"/);
  assert.match(problemas(sql('lower(u.email)'), 'x').join(), /coluna pessoal "email"/);
  assert.match(problemas("select r.payload->>'telefone' as x from integracao.registro_atual r where r.tenant_id = :'tenant_id';", 'x').join(), /telefone/);
  assert.match(problemas("select r.payload as x from integracao.registro_atual r where r.tenant_id = :'tenant_id';", 'x').join(), /payload/);
  assert.match(problemas(sql("(u.nome like '%a%')"), 'x').join(), /coluna pessoal "nome"/);
  assert.match(problemas(sql("(u.email like :'external_id')"), 'x').join(), /email/);
  for (const ok of ['(u.email is null)', "(u.email like '%@sem-email.invalid')",
    "(coalesce(trim(u.nome), '') = '')", "(u.nome = 'x')", "(u.nome in ('a', 'b'))"]) {
    assert.deepEqual(problemas(sql(ok), 'x'), [], ok);
  }
  assert.deepEqual(problemas("select (coalesce(trim(r.payload->>'nome'), '') = '') as x from integracao.registro_atual r where r.tenant_id = :'tenant_id' and r.payload->>'vendedor_external_id' = 'V';", 'x'), []);
});

test('coluna sensível (hash, token, senha, segredo, chave, carga, cifrad) é recusada até como flag; a view da senha passa', () => {
  const sql = (expr) => `select ${expr} as x from core.usuario u where u.tenant_id = :'tenant_id';`;
  for (const ruim of ['(u.senha_hash is null)', '(u.senha_temporaria_hash is not null)', '(t.token_hash is null)', '(c.chave is null)',
    '(x.segredo_cifrado is null)', "(r.payload->>'token' is null)", '(l.carga is null)']) {
    assert.match(problemas(sql(ruim), 'x').join(), /coluna sensível/, ruim);
  }
  assert.deepEqual(problemas("select (not s.tem_senha) as sem_senha from core.usuario u join core.v_leitura_usuario_senha s on s.id = u.id where u.tenant_id = :'tenant_id';", 'sem_senha'), []);
});

// Mesma lista do banco (RD-0526). Fonte: COLUNA_SENSIVEL_LEITURA de db/src/papeis.ts; sem ela, o regex da migração 0078.
// Antes do merge da 0078 (branch do banco-dados) nenhuma das duas existe e o teste fica pulado com o motivo; depois dele a
// migração é permanente no main, então o pulo não volta: constante ou regex ausentes, ou lista diferente, falham.
test('TERMOS_SENSIVEIS igual ao COLUNA_SENSIVEL_LEITURA do banco (db/src/papeis.ts ou migração 0078)', (t) => {
  const papeis = ler('db/src/papeis.ts');
  const migracao = 'db/migrations/0078_plataforma_papel_leitura.up.sql';
  const temMigracao = existsSync(fileURLToPath(new URL(migracao, RAIZ)));
  let lista = /export const COLUNA_SENSIVEL_LEITURA\s*=\s*'\(([^')]+)\)'/.exec(papeis)?.[1];
  let fonte = 'db/src/papeis.ts';
  if (!lista && temMigracao) {
    lista = /attname ~ '\(([^')]+)\)'/.exec(ler(migracao))?.[1];
    fonte = migracao;
  }
  if (!lista && !temMigracao) {
    t.skip('migração 0078 (macuxi_leitura) ainda fora deste branch: sem lista do banco para comparar');
    return;
  }
  assert.ok(lista, `COLUNA_SENSIVEL_LEITURA não encontrada em db/src/papeis.ts nem o regex attname em ${migracao}`);
  assert.deepEqual([...TERMOS_SENSIVEIS].sort(), lista.split('|').sort(), `lista de colunas sensíveis diferente de ${fonte}`);
});

test('asterisco é recusado (select *, x.*); count(*) passa', () => {
  assert.match(problemas("select * from core.usuario u where u.tenant_id = :'tenant_id';").join(), /asterisco/);
  assert.match(problemas("select u.* from core.usuario u where u.tenant_id = :'tenant_id';").join(), /asterisco/);
  assert.deepEqual(problemas("select count(*) as id from core.usuario u where u.tenant_id = :'tenant_id';"), []);
});

test('valores da saída: contagem, id, flag, data e código passam; e-mail, documento, telefone e texto com espaço não', () => {
  for (const v of ['', 't', 'f', '158', '0', '12.500', '3f1c2a9e-1b2c-4d5e-8f90-1234567890ab', '2026-11-15', '2026-11-15 11:01:00.123+00',
    'VEN-000034', 'PAF.1434', 'referencia_ausente', 'integracao.cliente.atualizado@1', 'filial_external_id']) {
    assert.equal(valorPermitido(v), true, v);
  }
  for (const v of ['anderson@exemplo.com', '123.456.789-09', '12.345.678/0001-90', '92991234567', '12345678909', 'Anderson Lima',
    '(92) 99123-4567', 'Rua A, 10', '69000-000']) {
    assert.equal(valorPermitido(v), false, v);
  }
});

// ---------- entrada ----------

test('entrada: consulta fora do catálogo, tenant e external_id inválidos são recusados', () => {
  const v = (e) => validarEntrada(e, CATALOGO);
  assert.throws(() => v({ consulta: 'select 1', tenant: 'AM2808' }), /fora do catálogo/);
  assert.throws(() => v({ consulta: '../x', tenant: 'AM2808' }), /fora do catálogo/);
  assert.throws(() => v({ consulta: 'catalogo-sem-preco', tenant: "AM2808'; drop" }), /tenant inválido/);
  assert.throws(() => v({ consulta: 'catalogo-sem-preco', tenant: 'XX2808' }), /tenant inválido/);
  assert.throws(() => v({ consulta: 'vendedor-erp', tenant: 'AM2808', external_id: '' }), /external_id inválido/);
  assert.throws(() => v({ consulta: 'vendedor-erp', tenant: 'AM2808', external_id: "VEN' or 1=1" }), /external_id inválido/);
  assert.throws(() => v({ consulta: 'vendedor-erp', tenant: 'AM2808', external_id: 'VEN 34' }), /external_id inválido/);
  assert.throws(() => v({ consulta: 'vendedor-erp', tenant: 'AM2808', external_id: 'a:b' }), /external_id inválido/);
  assert.throws(() => v({ consulta: 'catalogo-sem-preco', tenant: 'AM2808', external_id: 'VEN-000034' }), /não usa external_id/);
  const ok = v({ consulta: 'vendedor-erp', tenant: 'AM2808', external_id: ' VEN-000034 ' });
  assert.deepEqual(ok.parametros, { external_id: 'VEN-000034' });
  assert.equal(v({ consulta: 'catalogo-sem-preco', tenant: 'thathyany' }).tenant, 'thathyany');
});

// ---------- transação READ ONLY ----------

test('script do psql: transação READ ONLY, timeout curto, confere o modo, tenant pelo código e rollback no fim', () => {
  const e = validarEntrada({ consulta: 'vendedor-erp', tenant: 'AM2808', external_id: 'VEN-000034' }, CATALOGO);
  const s = montarScript(e.consulta);
  const linhas = s.split('\n');
  assert.equal(linhas[0], '\\set ON_ERROR_STOP on');
  assert.equal(linhas[1], 'begin isolation level repeatable read, read only;');
  assert.match(s, /set local statement_timeout = '15s';/);
  assert.match(s, /current_setting\('transaction_read_only'\) as somente_leitura \\gset\n\\if :somente_leitura\n\\else\n.*\nselect 1 \/ 0;\n\\endif/);
  assert.match(s, /plataforma\.tenant_por_codigo\(:'tenant'\) \\gset/);
  assert.match(s, /set_config\('app\.tenant_id', :'tenant_id', true\)/);
  assert.equal(linhas.filter((l) => l.trim()).at(-1), 'rollback;');
  assert.doesNotMatch(s, /\bcommit\b/i);
  assert.doesNotMatch(s, /AM2808|VEN-000034/, 'valores só como variável do psql');
  assert.equal((s.match(/^\\echo '### /gm) || []).length, e.consulta.blocos.length);
  const args = argumentosPsql(e);
  assert.deepEqual(args.slice(-6), ['-v', 'tenant=AM2808', '-v', 'external_id=VEN-000034', '-f', '-']);
  assert.ok(args.includes('--csv') && args.includes('ON_ERROR_STOP=1'));
});

test('compose: pgleitura entra como macuxi_leitura, sessão só leitura, sem admin.env', () => {
  const compose = ler('scripts/deploy/producao/compose.yml');
  const ini = compose.indexOf('\n  pgleitura:\n');
  assert.ok(ini > 0, 'serviço pgleitura');
  const svc = compose.slice(ini, compose.indexOf('\n\n', ini));
  assert.match(svc, /PGUSER=macuxi_leitura/);
  assert.match(svc, /unset MACUXI_PG_LEITURA_SENHA/);
  assert.match(svc, /- path: leitura\.env/);
  assert.doesNotMatch(svc, /admin\.env|ADMIN/);
  assert.match(svc, /PGOPTIONS: '[^']*-c default_transaction_read_only=on[^']*-c statement_timeout=15s/);
  const banco = compose.slice(compose.indexOf('\n  banco:\n'), compose.indexOf('\n  tenant:\n'));
  assert.match(banco, /- path: leitura\.env\n\s+required: false/);
});

test('preparar-vm e env.modelo: leitura.env gerado na VM (600), nunca regenerado', () => {
  const vm = ler('scripts/deploy/producao/preparar-vm.sh');
  assert.match(vm, /grep -q '\^MACUXI_PG_LEITURA_SENHA=' "\$LEITURA_ENV" \|\| \{ printf 'MACUXI_PG_LEITURA_SENHA=%s\\n' "\$\(openssl rand -hex 32\)"/);
  assert.match(vm, /chmod 600 "\$LEITURA_ENV"/);
  assert.match(ler('scripts/deploy/producao/env.modelo'), /\/opt\/macuxi\/leitura\.env[\s\S]*\nMACUXI_PG_LEITURA_SENHA=\n/);
});

test('workflow: manual, só do main, environment PRODUCAO, pgleitura, sem secret de banco e sem CSV no log', () => {
  const wf = ler('.github/workflows/producao-consulta.yml');
  assert.match(wf, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(wf, /^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(wf, /\[ "\$REF" = refs\/heads\/main \]/);
  assert.match(wf, /environment: PRODUCAO/);
  assert.match(wf, /run --rm --no-deps -T pgleitura psql/);
  assert.doesNotMatch(wf, /pgcliente|PROD_PG_|admin\.env/);
  assert.match(wf, /> "\$RUNNER_TEMP\/saida\.csv"/);
  assert.doesNotMatch(wf, /cat "\$RUNNER_TEMP\/saida\.csv"/);
  assert.match(wf, /consulta\.mjs relatorio/);
  assert.match(wf, /GITHUB_STEP_SUMMARY/);
  assert.match(wf, /actions\/upload-artifact@v4/);
});

test('workflow: entradas nunca interpoladas direto no shell (só por env)', () => {
  const wf = ler('.github/workflows/producao-consulta.yml');
  const blocosRun = [...wf.matchAll(/^( +)run: \|\n((?:\1 {2}.*\n|\s*\n)*)/gm)].map((m) => m[2]);
  assert.ok(blocosRun.length >= 4);
  for (const r of blocosRun) assert.doesNotMatch(r, /\$\{\{/);
});

// ---------- saída ----------

const CONSULTA_TESTE = analisarArquivo('teste', arquivo(
  bloco("select u.id, (u.email is null) as sem_email, count(*) as n from core.usuario u where u.tenant_id = :'tenant_id' group by 1, 2;", 'id, sem_email, n', 'um')
  + bloco("select count(*) as total from core.cliente c where c.tenant_id = :'tenant_id';", 'total', 'dois'),
  'nenhum',
));

test('saída do psql conferida: blocos, colunas declaradas, flag booleana e valores permitidos', () => {
  assert.deepEqual(CONSULTA_TESTE.problemas, []);
  const boa = "### um\nid,sem_email,n\n3f1c2a9e-1b2c-4d5e-8f90-1234567890ab,t,158\n### dois\ntotal\n7\n";
  const secoes = analisarSaida(boa, CONSULTA_TESTE);
  assert.deepEqual(secoes.map((s) => s.linhas), [[['3f1c2a9e-1b2c-4d5e-8f90-1234567890ab', 't', '158']], [['7']]]);
  const md = paraMarkdown(secoes, { consulta: CONSULTA_TESTE, tenant: 'AM2808', parametros: {} });
  assert.match(md, /\| id \| sem_email \| n \|/);
  assert.match(md, /READ ONLY/);

  assert.throws(() => analisarSaida('### um\nid,email,n\nx,t,1\n### dois\ntotal\n1\n', CONSULTA_TESTE), /colunas diferentes/);
  assert.throws(() => analisarSaida('### um\nid,sem_email,n\nx,ana@x.com,1\n### dois\ntotal\n1\n', CONSULTA_TESTE), /não booleano/);
  assert.throws(() => analisarSaida('### um\nid,sem_email,n\n"Anderson Lima",t,1\n### dois\ntotal\n1\n', CONSULTA_TESTE), /fora das formas/);
  assert.throws(() => analisarSaida('### um\nid,sem_email,n\nx,t,12345678909\n### dois\ntotal\n1\n', CONSULTA_TESTE), /fora das formas/);
  assert.throws(() => analisarSaida('### um\nid,sem_email,n\n', CONSULTA_TESTE), /esperados 2 blocos/);
  assert.throws(() => analisarSaida('lixo\n### um\nid,sem_email,n\n### dois\ntotal\n', CONSULTA_TESTE), /fora de bloco/);
  const erro = (() => { try { analisarSaida('### um\nid,sem_email,n\nx,t,ana@x.com\n### dois\ntotal\n1\n', CONSULTA_TESTE); } catch (e) { return e.message; } })();
  assert.doesNotMatch(erro, /ana@x\.com/, 'a mensagem de erro não repete o valor');
});

test('CLI relatorio: saída recusada não publica nada (código 1, stdout vazio)', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'consulta-'));
  const saida = join(dir, 'saida.csv');
  writeFileSync(saida, '### filiais\nid,codigo\n');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../producao/consulta.mjs', import.meta.url)), 'relatorio', saida], {
    env: { ...process.env, CONSULTA: 'catalogo-sem-preco', TENANT: 'AM2808', EXTERNAL_ID: '' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /saída recusada/);
});
