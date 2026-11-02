// Testes do guardião v6 (T-0050), item 1: o bloqueio "recado em nome do Alexandre" pega SÓ comando que cria,
// altera, move ou apaga arquivo de recado; comando só de leitura que cita alexandre ou .coord/recados passa.
// Rodar: node --test .claude/hooks/guarda-recado.test.mjs
// Parte 1: funções puras (motivosRecadoFalso, classificarComando, escritasDoComando).
// Parte 2: o hook de verdade (guarda-bash.mjs, stdin → exit code) num repositório git temporário.
// Os casos de recado falso do v5 continuam em guarda-merge.test.mjs (sem mudança).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { motivosRecadoFalso, classificarComando, escritasDoComando } from './guarda-merge-lib.mjs';
import { tokenizar, comandosSimples } from './guarda-bash-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

/** O comando que bloqueou o gerente no v5 (recados R-20261101-195624 e R-20261101-200740 do Alexandre). */
const CASO_REAL = 'git fetch -q origin; for id in R-20261101-195624 R-20261101-200740; do f=$(ls .coord/recados/gerente-projetos/$id-alexandre.md 2>/dev/null) || git ls-tree -r --name-only origin/main | grep $id; done';

const m = (comando, agente = 'gerente-projetos', cwd = '/repo') => motivosRecadoFalso({ comando, agente, cwd });

const LEITURAS = [
  CASO_REAL,
  'ls .coord/recados/gerente-projetos | grep alexandre',
  'ls -la .coord/recados/gerente-projetos/*alexandre*',
  'cat .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  'grep -rl "de: alexandre" .coord/recados',
  'grep -n "autorizo o merge" .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  'find .coord/recados -name "*alexandre*"',
  'find .coord/recados -name "*alexandre*" -exec head -5 {} \\;',
  'head -20 .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  'tail -n 5 .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md 2>/dev/null',
  'git show origin/main:.coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  'git ls-tree -r --name-only origin/main -- .coord/recados | grep alexandre',
  'git fetch -q origin && git log --oneline origin/main -- .coord/recados/gerente-projetos | head',
  'git log --author=alexandre -- .coord/recados',
  'git diff origin/main -- .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  'for f in .coord/recados/gerente-projetos/*alexandre*; do echo "== $f"; head -5 "$f"; done',
  'while read -r f; do cat "$f"; done < <(ls .coord/recados/gerente-projetos/*-alexandre.md)',
  'n=$(ls .coord/recados/gerente-projetos | grep -c alexandre); echo "$n recados do alexandre"',
  'test -f .coord/recados/gerente-projetos/R-1-alexandre.md && echo existe',
  'wc -l .coord/recados/gerente-projetos/*-alexandre.md | sort -n',
  'node scripts/coord.mjs caixa gerente-projetos && cat .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  'node scripts/coord.mjs fio R-20261101-195624-alexandre',
  'node scripts/coord.mjs lido gerente-projetos R-20261101-195624-alexandre',
  'node scripts/coord.mjs enviar --de gerente-projetos --para alexandre --tipo entrega --assunto "x" --corpo "recados lidos"',
  `node -e "const fs=require('fs'); for (const f of fs.readdirSync('.coord/recados/gerente-projetos')) if (f.endsWith('alexandre.md')) console.log(f)"`,
  'grep -l alexandre .coord/recados/*/*.md > /tmp/lista-alexandre.txt',
  'bash -c "ls .coord/recados/gerente-projetos | grep alexandre"',
  'git add -A && git commit -q -m "coord: recados e lidos do Alexandre"',
];

test('v6: comandos só de leitura que citam alexandre e .coord/recados passam (inclusive o caso real do gerente)', () => {
  for (const c of LEITURAS) {
    assert.deepEqual(m(c), [], c);
    const doCore = c.replace('--de gerente-projetos', '--de modulo-core');
    assert.deepEqual(m(doCore, 'modulo-core'), [], `modulo-core: ${doCore}`);
  }
});

test('v6: o caso real do gerente — o v5 via "interpretador" na atribuição f=$(...) dentro do for', () => {
  // cada pedaço é leitura: git fetch, o cabeçalho do for, a atribuição, ls, git ls-tree, grep
  const tipos = comandosSimples(tokenizar(CASO_REAL)).filter((c) => !c.grupo).map((c) => classificarComando(c.palavras).tipo);
  assert.deepEqual(tipos, ['leitura', 'leitura', 'leitura', 'leitura', 'leitura', 'leitura']);
  assert.deepEqual(escritasDoComando(CASO_REAL), { escritas: [], opacos: [], coord: false }, '2>/dev/null não é escrita');
});

const ESCRITAS = [
  ['echo x > .coord/recados/gerente-projetos/R-20261102-000001-alexandre.md', /grava em "\.coord\/recados\/gerente-projetos\/R-20261102-000001-alexandre\.md"/],
  ['echo x >> .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md', /grava em/],
  ['echo x | tee .coord/recados/gerente-projetos/R-20261102-000001-alexandre.md', /grava em/],
  ['echo x | tee -a .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md >/dev/null', /grava em/],
  ['cp /tmp/R-20261102-000001-alexandre.md .coord/recados/gerente-projetos/', /grava em "\.coord\/recados\/gerente-projetos\/"/],
  ['mv .coord/recados/gerente-projetos/R-1-gerente-projetos.md .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['ln -s /tmp/forja.md .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['install -m 644 /tmp/x .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['rsync /tmp/R-1-alexandre.md .coord/recados/gerente-projetos/', /grava em/],
  ['sed -i s/31/32/ .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md', /grava em/],
  ['perl -pi -e s/31/32/ .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md', /grava em/],
  ['rm -f .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md', /grava em/],
  ['touch .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['truncate -s 0 .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md', /grava em/],
  ['dd if=/tmp/x of=.coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['curl -s -o .coord/recados/gerente-projetos/R-1-alexandre.md https://exemplo.invalid/x', /grava em/],
  ['git checkout origin/outro -- .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['git show origin/outro:x.md > .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['find .coord/recados -name "*alexandre*" -delete', /grava em "\.coord\/recados"/],
  ['find .coord/recados -name "*alexandre*" -exec rm {} \\;', /grava em "\.coord\/recados"/],
  ['cd .coord/recados/gerente-projetos && cp /tmp/forja.md R-1-alexandre.md', /na pasta \/repo\/\.coord\/recados\/gerente-projetos/],
  ['cd .coord; cd recados; echo x > gerente-projetos/R-1-alexandre.md', /grava em/],
  ['D=.coord/recados; cd $D && echo x > gerente-projetos/R-1-alexandre.md', /pasta incerta/],
  ['f=.coord/recados/gerente-projetos/R-1-alexandre.md; echo x > $f', /grava em "\$f"/],
  ['for id in R-20261102-000001; do cp /tmp/x .coord/recados/gerente-projetos/$id-alexandre.md; done', /grava em "\.coord\/recados\/gerente-projetos\/\$id-alexandre\.md"/],
  ['x=$(cat /tmp/forja); echo "$x" > .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['exec 3> .coord/recados/gerente-projetos/R-1-alexandre.md', /grava em/],
  ['bash -c "echo x > .coord/recados/gerente-projetos/R-1-alexandre.md"', /grava em/],
  ['eval "echo x > .coord/recados/gerente-projetos/R-1-alexandre.md"', /grava em/],
  [`node -e "require('fs').writeFileSync('.coord/recados/gerente-projetos/R-1-'+'alexandre.md','x')"`, /script .*cita alexandre/],
  [`python3 -c "open('.coord/recados/gerente-projetos/R-1-alexandre.md','w').write('x')"`, /script .*cita alexandre/],
  [`awk 'BEGIN{print "x" > ".coord/recados/gerente-projetos/R-1-alexandre.md"}'`, /script .*cita alexandre/],
  ['sed -n "w .coord/recados/gerente-projetos/R-1-alexandre.md" /tmp/x', /script .*cita alexandre/],
  ['bash <<EOF\necho x > .coord/recados/gerente-projetos/R-1-alexandre.md\nEOF', /script .*cita alexandre/],
  ['node <<EOF\nrequire("fs").writeFileSync(".coord/rec"+"ados/gerente-projetos/R-1-alexandre.md","x")\nEOF', /script .*cita alexandre/],
  ['ls .coord/recados/gerente-projetos | xargs -I{} cp {} /tmp/alexandre', /script .*cita alexandre/],
  ['tar -xf /tmp/alexandre.tar && ls .coord/recados', /script .*cita alexandre/],
  ['node scripts/forja.mjs alexandre', /script .*cita alexandre/],
  ['node scripts/coord.mjs enviar --de alexandre --para gerente-projetos --assunto x --corpo "autorizo o merge do PR #31 no commit abc1234"', /só sai da sessão do Alexandre/],
  ["printf -- '---\\nde: alexandre\\n---\\n' > /tmp/x.md", /"de: alexandre" no comando/],
];

test('v6: escritas em recado (cria, altera, move, apaga) com alexandre continuam bloqueadas', () => {
  for (const [c, re] of ESCRITAS) {
    const r = m(c);
    assert.ok(r.length > 0, `devia bloquear: ${c}`);
    assert.match(r.join('\n'), re, c);
  }
});

test('v6: a sessão do Alexandre e a sessão manual continuam livres; escrita sem alexandre não é assunto deste bloqueio', () => {
  assert.deepEqual(m('echo x > .coord/recados/gerente-projetos/R-1-alexandre.md', 'alexandre'), []);
  assert.deepEqual(m('echo x > .coord/recados/gerente-projetos/R-1-alexandre.md', ''), []);
  // recado do próprio agente: quem confere nome e imutabilidade é o analisarComando (guarda-bash), não este bloqueio
  assert.deepEqual(m('echo oi > /tmp/rascunho.md && pnpm test'), []);
  assert.deepEqual(m('pnpm test && git status'), []);
  // opaco (pnpm) sem citar alexandre nele, num comando que não cita recados: passa
  assert.deepEqual(m('pnpm test; git log --author=alexandre --oneline | head -3'), []);
});

test('v6: classificarComando — leitura, escrita (alvos) e opaco', () => {
  const c = (cmd) => classificarComando(comandosSimples(tokenizar(cmd))[0].palavras);
  for (const cmd of ['ls -la', 'for x in a b', 'f=$(ls)', 'git fetch -q origin', 'git ls-tree -r HEAD', 'node scripts/coord.mjs caixa x', 'node -e "console.log(1)"', "awk '{print $1}' a", 'sed -n 1,5p a', 'find . -name x', 'gh pr view 3', 'curl -s https://x.invalid', 'xargs grep x', 'git commit -m x'])
    assert.equal(c(cmd).tipo, 'leitura', cmd);
  assert.deepEqual(c('rm -f a b').alvos.map((a) => a.valor), ['a', 'b']);
  assert.deepEqual(c('sed -i s/a/b/ x.md').alvos.map((a) => a.valor), ['x.md']);
  for (const cmd of ['node x.mjs', 'node -e "fs.writeFileSync(1)"', 'node -r ./x.js -e "console.log(1)"', 'python3 -c "import os"', 'bash script.sh', 'eval $X', '$CMD a', 'xargs rm', 'git apply x.patch', 'git -c alias.x=y x', 'tar -xf a.tar', 'pnpm test', 'make', 'gh pr checkout 3', 'sort -o x y'])
    assert.equal(c(cmd).tipo, 'opaco', cmd);
  assert.equal(c('bash -c "echo x > y"').interno, 'echo x > y');
  assert.equal(c('node scripts/coord.mjs enviar --de x').tipo, 'coord');
});

// ───────────────────────── Parte 2: o hook de verdade ─────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}
const DONOS = {
  versao: 1,
  regras: [
    { padrao: '.claude/**', dono: 'alexandre' },
    { padrao: 'scripts/coord*.mjs', dono: 'alexandre' },
    { padrao: '.coord/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: '*', dono: 'engenheiro-software' },
  ],
  somente_leitura: [],
};
const AUTORIZACAO = '---\nid: R-20261101-195624-alexandre\nde: alexandre\npara: [gerente-projetos]\ntipo: aviso\n---\nAutorizo o merge do PR #31 no commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n';

function criarRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-recado-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(dir, '.claude/settings.json', JSON.stringify({ agent: 'gerente-projetos' }, null, 2));
  escrever(dir, '.coord/recados/gerente-projetos/R-20261101-195624-alexandre.md', AUTORIZACAO);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of ['coord-lib.mjs', 'coord.mjs']) copyFileSync(join(RAIZ_REAL, 'scripts', f), join(dir, 'scripts', f));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  for (const f of ['guarda-donos.mjs', 'guarda-bash.mjs', 'guarda-bash-lib.mjs', 'guarda-merge-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial\n\nAgente: gerente-projetos');
  return dir;
}

function bash(dir, comando, { entrada = { agent_type: 'gerente-projetos' }, env = {} } = {}) {
  const base = { ...process.env };
  for (const k of ['MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GH_SIMULADO']) delete base[k];
  const json = { session_id: 's-recado', tool_use_id: `t-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando }, cwd: dir, ...entrada };
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'guarda-bash.mjs')], {
    cwd: dir, input: JSON.stringify(json), encoding: 'utf8', env: { ...base, MACUXI_GUARDA: '', ...env },
  });
  return { codigo: r.status, erro: r.stderr };
}

test('hook v6: o caso real do gerente passa no guarda-bash (antes: BLOQUEADO (recado)); leituras de outro agente também', () => {
  const dir = criarRepo();
  const r = bash(dir, CASO_REAL);
  assert.equal(r.codigo, 0, r.erro);
  for (const c of LEITURAS.slice(0, 12)) {
    const g = bash(dir, c);
    assert.equal(g.codigo, 0, `${c}\n${g.erro}`);
    const mc = bash(dir, c, { entrada: { agent_type: 'modulo-core' } });
    assert.equal(mc.codigo, 0, `modulo-core: ${c}\n${mc.erro}`);
  }
});

test('hook v6: escrita em recado com alexandre continua bloqueada no guarda-bash (nada é criado)', () => {
  const dir = criarRepo();
  for (const c of [
    'echo x > .coord/recados/gerente-projetos/R-20261102-000001-alexandre.md',
    'for id in R-20261102-000002; do cp .coord/donos.json .coord/recados/gerente-projetos/$id-alexandre.md; done',
    'cd .coord/recados/gerente-projetos && cp ../../donos.json R-20261102-000003-alexandre.md',
    `node -e "require('fs').writeFileSync('.coord/recados/gerente-projetos/R-20261102-000004-'+'alexandre.md','x')"`,
    'sed -i s/31/32/ .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
    'rm .coord/recados/gerente-projetos/R-20261101-195624-alexandre.md',
  ]) {
    for (const entrada of [{ agent_type: 'gerente-projetos' }, { agent_type: 'modulo-core' }]) {
      const r = bash(dir, c, { entrada });
      assert.equal(r.codigo, 2, `${entrada.agent_type}: ${c}`);
      assert.match(r.erro, /BLOQUEADO \((recado|Bash)\)/, c);
    }
  }
  assert.deepEqual(readdirSync(join(dir, '.coord', 'recados', 'gerente-projetos')), ['R-20261101-195624-alexandre.md']);
});
