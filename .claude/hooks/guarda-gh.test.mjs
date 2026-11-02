// Testes do guardião v6 (T-0050): onde o hook acha o gh (PATH e, no Windows, as pastas do instalador) e a opção
// --subject (título do squash) no gh pr merge. Rodar: node --test .claude/hooks/guarda-gh.test.mjs
// Parte 1: funções puras (localizarGh com PATH/plataforma/disco injetados; validarComandoMerge/conferirMerge).
// Parte 2: o hook de verdade (guarda-bash.mjs) com um gh falso só no PATH (sem MACUXI_GH_SIMULADO).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, chmodSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { localizarGh, consultarPrGh, consultarPrRest, validarComandoMerge, conferirMerge, acharMerges, REPO_OFICIAL } from './guarda-merge-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const GH = ['gh', 'pr', 'merge'].join(' '); // por extenso só na hora (o próprio guardião lê os comandos desta sessão)
const MERGE = `${GH} 36 -R ${REPO_OFICIAL} --squash --match-head-commit ${HEAD}`;

// ───────────────────────── Parte 1: funções puras ─────────────────────────

test('v6 gh: localizarGh — PATH primeiro; no Windows, %ProgramFiles% e %LOCALAPPDATA% do instalador; não achou = null', () => {
  const so = (...caminhos) => (c) => caminhos.includes(c);
  // Linux/macOS: só o PATH
  assert.equal(localizarGh({ env: { PATH: '/usr/bin:/opt/gh/bin' }, plataforma: 'linux', existe: so('/opt/gh/bin/gh') }), '/opt/gh/bin/gh');
  assert.equal(localizarGh({ env: { PATH: '/usr/bin' }, plataforma: 'linux', existe: so('/opt/gh/bin/gh') }), null);
  assert.equal(localizarGh({ env: { PATH: '.:bin' }, plataforma: 'linux', existe: () => true }), null, 'pasta relativa no PATH não vale');
  assert.equal(localizarGh({ env: {}, plataforma: 'linux', existe: () => true }), null);
  // Windows (o caso deste PC): gh fora do PATH do processo do hook, em C:\Program Files\GitHub CLI\gh.exe
  const win = { Path: 'C:\\Windows\\system32;C:\\Windows', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\domon\\AppData\\Local' };
  assert.equal(localizarGh({ env: win, plataforma: 'win32', existe: so('C:\\Program Files\\GitHub CLI\\gh.exe') }), 'C:\\Program Files\\GitHub CLI\\gh.exe');
  assert.equal(localizarGh({ env: win, plataforma: 'win32', existe: so('C:\\Users\\domon\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe') }), 'C:\\Users\\domon\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe');
  // PATH vence (nome da variável sem diferenciar maiúsculas no Windows; aspas na pasta aceitas)
  const noPath = { ...win, Path: `${win.Path};"D:\\Ferramentas\\gh"` };
  assert.equal(localizarGh({ env: noPath, plataforma: 'win32', existe: so('D:\\Ferramentas\\gh\\gh.exe', 'C:\\Program Files\\GitHub CLI\\gh.exe') }), 'D:\\Ferramentas\\gh\\gh.exe');
  assert.equal(localizarGh({ env: { PATH: 'C:\\x', PROGRAMFILES: 'C:\\Program Files' }, plataforma: 'win32', existe: so('C:\\Program Files\\GitHub CLI\\gh.exe') }), 'C:\\Program Files\\GitHub CLI\\gh.exe');
  assert.equal(localizarGh({ env: win, plataforma: 'win32', existe: () => false }), null);
  assert.equal(localizarGh({ env: { ...win, ProgramFiles: 'Program Files' }, plataforma: 'win32', existe: (c) => c.includes('GitHub CLI') && !c.startsWith('C:\\Users') }), null, 'ProgramFiles relativo não vale');
  // nas pastas do instalador do Windows só no Windows
  assert.equal(localizarGh({ env: { PATH: '/usr/bin', ProgramFiles: '/pf' }, plataforma: 'linux', existe: so('/pf/GitHub CLI/gh.exe') }), null);
});

test('v6 gh: sem gh = falha fechada nas duas consultas (gh pr view e gh api)', () => {
  const env = { PATH: '/nao/existe' };
  const v = consultarPrGh(36, { env, plataforma: 'linux' });
  assert.equal(v.ok, false);
  assert.match(v.erro, /gh não encontrado \(PATH; no Windows também %ProgramFiles%\\GitHub CLI\\gh\.exe e %LOCALAPPDATA%\\Programs\\GitHub CLI\\gh\.exe\)/);
  assert.match(consultarPrRest(36, { env, plataforma: 'linux' }).erro, /gh não encontrado/);
  const r = conferirMerge({ comando: MERGE, agente: 'gerente-projetos', origem: 'sessão local (agent_type)', consultarPr: (pr) => consultarPrGh(pr, { env, plataforma: 'linux' }) });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /não deu para conferir o PR #36 no GitHub \(gh não encontrado/);
});

test('v6 gh: --subject (título do squash) aceito em todas as formas; o resto das regras do v5 continua', () => {
  const G = { agente: 'gerente-projetos', origem: 'sessão local (agent_type)' };
  const consulta = { ok: true, headRefOid: HEAD, arquivos: ['modules/x.ts'], total: 1 };
  for (const extra of [
    '--subject "T-0048: Conector 1.2.1 — correções da revisão final da T-0023 (#36)"',
    '--subject="T-0048: x (#36)"',
    '-t "T-0048: x"',
    '--subject "T-0048: x" --body "Agente: modulo-integracao"',
    `--subject 'T-0048: merge do conector (#36)' --body "Resumo.\n\nAgente: modulo-integracao"`,
    '--subject "[PRONTO PARA MERGE] T-0048: x"',
  ]) {
    const comando = `${MERGE} ${extra}`;
    assert.deepEqual(validarComandoMerge(acharMerges(comando).merges[0]).erros, [], extra);
    const r = conferirMerge({ comando, ...G, consultarPr: () => consulta });
    assert.equal(r.ok, true, `${extra}\n${r.mensagem}`);
  }
  // o modelo da mensagem de bloqueio mostra o --subject
  assert.match(conferirMerge({ comando: `${MERGE} --admin`, ...G, consultarPr: () => consulta }).mensagem, /--match-head-commit <sha> \[--subject "<título do squash>"\] --body/);
  // --subject sem valor, com $(...) ou repetindo opção proibida continua barrado
  assert.match(conferirMerge({ comando: `${MERGE} --subject`, ...G, consultarPr: () => consulta }).mensagem, /--subject sem valor/);
  assert.match(conferirMerge({ comando: `${MERGE} --subject "$(cat titulo.txt)"`, ...G, consultarPr: () => consulta }).mensagem, /sem \$VAR, \$\(\.\.\.\)/);
  assert.match(conferirMerge({ comando: `${MERGE} --subject "x" --admin`, ...G, consultarPr: () => consulta }).mensagem, /--admin .*proibido/);
});

// ───────────────────────── Parte 2: o hook de verdade, gh só no PATH ─────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });
const posix = process.platform !== 'win32';

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}
/** Pasta só com o git (link), para o PATH do hook não ter o gh do sistema. */
function pastaComGit() {
  const pasta = mkdtempSync(join(tmpdir(), 'guarda-gh-bin-'));
  temporarios.push(pasta);
  const real = String(process.env.PATH || '').split(delimiter).map((p) => join(p, 'git')).find((c) => existsSync(c));
  if (real) symlinkSync(real, join(pasta, 'git'));
  return pasta;
}
/** gh falso (gh pr view do v5): script node atrás de um "gh" executável. */
function ghFalso() {
  const pasta = mkdtempSync(join(tmpdir(), 'guarda-gh-falso-'));
  temporarios.push(pasta);
  writeFileSync(join(pasta, 'gh.mjs'), `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(pasta, 'chamadas.log'))}, args.join(' ') + '\\n');
if (args[0] !== 'pr' || args[1] !== 'view') process.exit(1);
process.stdout.write(JSON.stringify({ headRefOid: ${JSON.stringify(HEAD)}, changedFiles: 1, files: [{ path: 'modules/core/x.ts' }] }));
`);
  writeFileSync(join(pasta, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(pasta, 'gh.mjs'))} "$@"\n`);
  chmodSync(join(pasta, 'gh'), 0o755);
  return { pasta, log: join(pasta, 'chamadas.log') };
}
function criarRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-gh-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.coord/donos.json', JSON.stringify({ versao: 1, regras: [{ padrao: '**', dono: 'engenheiro-software' }], somente_leitura: [] }));
  escrever(dir, '.claude/settings.json', JSON.stringify({ agent: 'gerente-projetos' }));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of ['coord-lib.mjs', 'coord.mjs']) copyFileSync(join(RAIZ_REAL, 'scripts', f), join(dir, 'scripts', f));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  for (const f of ['guarda-bash.mjs', 'guarda-bash-lib.mjs', 'guarda-merge-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial\n\nAgente: gerente-projetos');
  return dir;
}
function hook(dir, comando, PATH) {
  const env = { ...process.env, PATH, MACUXI_GUARDA: '' };
  for (const k of ['MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GH_SIMULADO']) delete env[k];
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'guarda-bash.mjs')], {
    cwd: dir, encoding: 'utf8', env,
    input: JSON.stringify({ session_id: `s-gh-${dir}`, tool_use_id: `t-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando }, cwd: dir, agent_type: 'gerente-projetos' }),
  });
  return { codigo: r.status, erro: r.stderr };
}

test('hook v6 gh: gh fora do PATH = bloqueado (falha fechada); gh achado no PATH = merge com --subject passa', { skip: !posix && 'gh falso é script sh' }, () => {
  const dir = criarRepo();
  const soGit = pastaComGit();
  const comando = `${MERGE} --subject "T-0048: Conector 1.2.1 (#36)" --body "Agente: modulo-integracao"`;
  const sem = hook(dir, comando, soGit);
  assert.equal(sem.codigo, 2);
  assert.match(sem.erro, /não deu para conferir o PR #36 no GitHub \(gh não encontrado \(PATH/);
  const gh = ghFalso();
  const com = hook(dir, comando, `${gh.pasta}${delimiter}${soGit}`);
  assert.equal(com.codigo, 0, com.erro);
  assert.deepEqual(readFileSync(gh.log, 'utf8').trim().split('\n'), [`pr view 36 -R ${REPO_OFICIAL} --json files,headRefOid,changedFiles`]);
});
