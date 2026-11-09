// Testes das junções de recados (ADR 0035, T-0139) no guardião e na coord-lib (node:test, sem dependências).
// Rodar: node --test .claude/hooks/guarda-juncao.test.mjs
// Depois do corte, .coord/recados e .coord/lidos são junções (mklink /J) para o clone do macuxifdv-recados.
// Nada no guardião resolve caminho por realpath: pela junção o caminho segue dentro da raiz e as regras são as de
// sempre. Os casos novos são o caminho de verdade no clone (volta a ser .coord/recados/...), o resto do clone
// (bloqueado), o git que grava no clone (bloqueado), o git clean -x (bloqueado) e a foto do PostToolUse (git status
// do clone com os caminhos de .coord/). Num Linux (CI), a "junção" vira link simbólico de pasta: mesmo efeito.
// T-0143 (ADR 0039): com os recados direto no GitHub (padrão com a marca), nada se grava pela junção; as junções só
// voltam no plano de volta, com MACUXI_RECADOS=local. Por isso este arquivo roda com MACUXI_RECADOS=local, e o
// último teste confere o bloqueio no modo GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, symlinkSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { juncoesDeRecados, relativoPorJuncao, globParaRegex } from '../../scripts/coord-lib.mjs';
import { analisarComando, lerStatus, statusDoClone, doCloneParaRepo, relativoDaRaiz } from './guarda-bash-lib.mjs';

process.env.MACUXI_RECADOS = 'local'; // plano de volta da ADR 0039: junções e pastas no disco

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');
const barras = (p) => p.replace(/\\/g, '/');

const DONOS = {
  versao: 1,
  regras: [
    { padrao: '.claude/**', dono: 'alexandre' },
    { padrao: 'scripts/coord*.mjs', dono: 'alexandre' },
    { padrao: '.coord/recados/anexos/**', dono: 'alexandre' },
    { padrao: '.coord/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: '*', dono: 'engenheiro-software' },
  ],
  somente_leitura: [],
};
const REGRAS = DONOS.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));
const EXISTENTE = 'recados/testes/R-20261031-000000-modulo-core.md';

const temporarios = [];
process.on('exit', () => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}
function iniciar(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

/**
 * Cenário depois do corte: repositório de código (com cópia dos hooks e da coord-lib) e clone de recados irmão,
 * com .coord/recados e .coord/lidos em junção para o clone e a marca no .gitignore.
 */
function cenario() {
  const pai = mkdtempSync(join(tmpdir(), 'guarda-juncao-'));
  temporarios.push(pai);
  const repo = join(pai, 'macuxifdv');
  const clone = join(pai, 'macuxifdv-recados');
  mkdirSync(repo);
  mkdirSync(clone);
  iniciar(clone);
  escrever(clone, EXISTENTE, '---\nid: R-20261031-000000-modulo-core\nde: modulo-core\n---\n# Olá\n');
  escrever(clone, 'lidos/modulo-core.txt', 'R-1\n');
  escrever(clone, 'README.md', '# recados\n');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'inicial');
  iniciar(repo);
  escrever(repo, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(repo, '.gitignore', '/.coord/recados\n/.coord/lidos\n');
  escrever(repo, 'modules/core/a.ts');
  mkdirSync(join(repo, 'scripts'));
  mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true });
  copyFileSync(join(RAIZ_REAL, 'scripts', 'coord-lib.mjs'), join(repo, 'scripts', 'coord-lib.mjs'));
  for (const f of ['guarda-bash.mjs', 'guarda-bash-lib.mjs', 'guarda-merge-lib.mjs', 'guarda-donos.mjs']) copyFileSync(join(AQUI, f), join(repo, '.claude', 'hooks', f));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'inicial');
  symlinkSync(join(clone, 'recados'), join(repo, '.coord', 'recados'), 'junction');
  symlinkSync(join(clone, 'lidos'), join(repo, '.coord', 'lidos'), 'junction');
  return { pai, repo, clone };
}

function rodar(repo, hook, entrada, env = {}) {
  const base = { ...process.env };
  delete base.MACUXI_AGENTE;
  delete base.CLAUDE_CODE_REMOTE;
  const r = spawnSync(process.execPath, [join(repo, '.claude', 'hooks', hook)], {
    cwd: repo, input: JSON.stringify(entrada), encoding: 'utf8', env: { ...base, MACUXI_GUARDA: '', ...env },
  });
  return { codigo: r.status, erro: r.stderr, saida: r.stdout };
}
let seq = 0;
const escrita = (repo, caminho, agente, conteudo) => rodar(repo, 'guarda-donos.mjs', {
  session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: agente, cwd: repo,
  tool_input: { file_path: caminho, ...(conteudo === undefined ? {} : { content: conteudo }) },
});
const bash = (repo, evento, comando, agente, id = `toolu_j${++seq}`) => rodar(repo, 'guarda-bash.mjs', {
  session_id: 's-juncao', tool_use_id: id, hook_event_name: evento, tool_name: 'Bash', agent_type: agente, cwd: repo,
  tool_input: { command: comando },
});

// ───────────────────────── coord-lib: juncoesDeRecados e relativoPorJuncao ─────────────────────────

test('juncoesDeRecados: sem junção (antes do corte, nuvem, CI) não mapeia nada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-juncao-sem-'));
  temporarios.push(dir);
  mkdirSync(join(dir, '.coord', 'recados'), { recursive: true });
  assert.deepEqual(juncoesDeRecados(dir), { mapas: [], clone: null });
  assert.deepEqual(juncoesDeRecados(join(dir, 'nao-existe')), { mapas: [], clone: null });
});

test('juncoesDeRecados: com as duas junções devolve os destinos e a raiz do clone', () => {
  const { repo, clone } = cenario();
  const j = juncoesDeRecados(repo);
  const real = (p) => barras(execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').realpathSync.native(${JSON.stringify(p)}))`], { encoding: 'utf8' }));
  assert.deepEqual(j.mapas.map((m) => m.rel), ['.coord/recados', '.coord/lidos']);
  assert.equal(j.mapas[0].real.toLowerCase(), real(join(clone, 'recados')).toLowerCase());
  assert.equal(j.clone.toLowerCase(), real(clone).toLowerCase());
});

test('juncoesDeRecados: realpath injetável; destinos em pastas diferentes não têm raiz de clone', () => {
  const realpath = (p) => barras(p).replace(/\/repo\/\.coord\/(recados|lidos)$/, '/fora/$1');
  const j = juncoesDeRecados('/repo', { realpath });
  assert.deepEqual(j, { mapas: [{ rel: '.coord/recados', real: '/fora/recados' }, { rel: '.coord/lidos', real: '/fora/lidos' }], clone: '/fora' });
  const separado = juncoesDeRecados('/repo', { realpath: (p) => barras(p).replace('/repo/.coord/lidos', '/x/lidos').replace('/repo/.coord/recados', '/y/recados') });
  assert.equal(separado.clone, null);
});

test('relativoPorJuncao: destino mapeado vira .coord/...; resto do clone = clone; fora = null (Windows sem diferença de caixa)', () => {
  const j = { mapas: [{ rel: '.coord/recados', real: 'C:/macuxifdv-recados/recados' }, { rel: '.coord/lidos', real: 'C:/macuxifdv-recados/lidos' }], clone: 'C:/macuxifdv-recados' };
  assert.deepEqual(relativoPorJuncao('C:\\macuxifdv-recados\\recados\\testes\\R-1-modulo-core.md', j), { rel: '.coord/recados/testes/R-1-modulo-core.md' });
  assert.deepEqual(relativoPorJuncao('c:/MACUXIFDV-RECADOS/Lidos/testes.txt', j), { rel: '.coord/lidos/testes.txt' });
  assert.deepEqual(relativoPorJuncao('C:/macuxifdv-recados/recados', j), { rel: '.coord/recados' });
  assert.deepEqual(relativoPorJuncao('C:/macuxifdv-recados/.github/workflows/issue-recado.yml', j), { clone: true });
  assert.deepEqual(relativoPorJuncao('C:/macuxifdv-recados', j), { clone: true });
  assert.equal(relativoPorJuncao('C:/macuxifdv-recados-backup/recados/x.md', j), null);
  assert.equal(relativoPorJuncao('C:/macuxifdv/.coord/recados/x.md', j), null, 'o caminho pela junção já está dentro da raiz');
  assert.equal(relativoPorJuncao('C:/x', { mapas: [], clone: null }), null);
});

// ───────────────────────── guarda-donos (Write/Edit) ─────────────────────────

test('guarda-donos: pelo caminho de verdade do clone valem as regras de .coord/recados e .coord/lidos', () => {
  const { repo, clone } = cenario();
  const proprio = join(clone, 'recados', 'gerente-projetos', 'R-20261108-100000-modulo-core.md');
  assert.equal(escrita(repo, proprio, 'modulo-core', '---\nde: modulo-core\n---\n# x\n').codigo, 0);
  const falso = escrita(repo, join(clone, 'recados', 'gerente-projetos', 'R-20261108-100000-alexandre.md'), 'modulo-core', '---\nde: alexandre\n---\n');
  assert.equal(falso.codigo, 2);
  assert.match(falso.erro, /BLOQUEADO/);
  const existente = escrita(repo, join(clone, ...EXISTENTE.split('/')), 'modulo-core');
  assert.equal(existente.codigo, 2);
  assert.match(existente.erro, /recados são imutáveis/);
  assert.equal(escrita(repo, join(clone, 'lidos', 'modulo-core.txt'), 'modulo-core').codigo, 0);
  const alheio = escrita(repo, join(clone, 'lidos', 'testes.txt'), 'modulo-core');
  assert.equal(alheio.codigo, 2);
  assert.match(alheio.erro, /pertence a testes/);
});

test('guarda-donos: o resto do clone (.github, README, .git) é bloqueado; pela junção a regra é a de sempre', () => {
  const { repo, clone } = cenario();
  for (const c of [join(clone, '.github', 'workflows', 'issue-recado.yml'), join(clone, 'README.md'), join(clone, '.git', 'config')]) {
    const r = escrita(repo, c, 'gerente-projetos');
    assert.equal(r.codigo, 2, c);
    assert.match(r.erro, /clone do repositório de recados só muda/);
  }
  const pelaJuncao = escrita(repo, join(repo, '.coord', ...EXISTENTE.split('/')), 'modulo-core');
  assert.equal(pelaJuncao.codigo, 2);
  assert.match(pelaJuncao.erro, /recados são imutáveis/);
  assert.equal(escrita(repo, join(repo, '.coord', 'recados', 'testes', 'R-20261108-100001-modulo-core.md'), 'modulo-core', '---\nde: modulo-core\n---\n').codigo, 0);
});

// ───────────────────────── guarda-bash (PreToolUse) ─────────────────────────

test('guarda-bash: escrita pelo caminho do clone segue as regras; resto do clone, git que grava nele e git clean -x bloqueados', () => {
  const { repo, clone } = cenario();
  const c = barras(clone);
  const casos = [
    [`rm ${c}/${EXISTENTE}`, /recados são imutáveis/],
    [`echo x >> ${c}/lidos/testes.txt`, /pertence a testes/],
    [`echo x > ${c}/README.md`, /clone do repositório de recados só muda/],
    [`git -C ${c} commit -qm x`, /git commit no clone de recados/],
    [`git -C ${c} push origin main`, /git push no clone de recados/],
    [`cd ${c} && git reset --hard`, /no clone de recados/],
    ['cd .coord/recados && git pull', /git pull no clone de recados/],
    [`git -C ${c} config remote.origin.url x`, /git config no clone de recados/],
    ['git clean -fdx', /git clean -x\/-X apagaria os recados/],
  ];
  for (const [comando, motivo] of casos) {
    const r = bash(repo, 'PreToolUse', comando, 'modulo-core');
    assert.equal(r.codigo, 2, `${comando}\n${r.erro}`);
    assert.match(r.erro, motivo, comando);
  }
  for (const comando of [`git -C ${c} log --oneline -3`, `git -C ${c} status`, `cat ${c}/${EXISTENTE}`, `echo x >> ${c}/lidos/modulo-core.txt`, 'git clean -fd modules/core', 'node scripts/coord.mjs caixa modulo-core']) {
    const r = bash(repo, 'PreToolUse', comando, 'modulo-core');
    assert.equal(r.codigo, 0, `${comando}\n${r.erro}`);
  }
});

test('analisarComando: sem junção, git no mesmo caminho e git clean -x seguem a regra de antes', () => {
  const amb = { existe: () => false, ehDiretorio: () => false, sujos: () => [], rastreadosSob: () => [], ler: () => null };
  const r = analisarComando({ comando: 'git -C C:/macuxifdv-recados commit -m x && git clean -fdx', agente: 'modulo-core', cwd: 'C:/macuxifdv', raiz: 'C:/macuxifdv', regras: REGRAS, amb });
  assert.deepEqual(r.violacoes, []);
});

// ───────────────────────── foto do PostToolUse (git status do clone) ─────────────────────────

test('lerStatus/statusDoClone: o git status do clone entra com os caminhos de .coord/', () => {
  const { repo, clone } = cenario();
  const j = juncoesDeRecados(repo);
  escrever(clone, 'recados/testes/R-20261108-110000-modulo-core.md', '---\nde: modulo-core\n---\n');
  appendFileSync(join(clone, 'lidos', 'modulo-core.txt'), 'R-2\n');
  const st = lerStatus(repo, j);
  assert.ok(st.some((e) => e.xy === '??' && e.rel === '.coord/recados/testes/R-20261108-110000-modulo-core.md'), JSON.stringify(st));
  assert.ok(st.some((e) => e.xy.trim() === 'M' && e.rel === '.coord/lidos/modulo-core.txt'), JSON.stringify(st));
  assert.ok(!st.some((e) => e.rel.startsWith('.coord/recados') && !e.rel.includes('/testes/')), 'a junção ignorada não aparece no repositório de código');
  assert.equal(doCloneParaRepo('README.md', j), null);
  assert.deepEqual(statusDoClone({ mapas: [], clone: null }), []);
  assert.deepEqual(statusDoClone(j, () => '?? recados/x/R-1-modulo-core.md\0?? README.md\0'), [{ xy: '??', rel: '.coord/recados/x/R-1-modulo-core.md' }]);
});

test('PostToolUse: recado alterado no clone por comando opaco aparece no aviso com o caminho de .coord/', () => {
  const { repo, clone } = cenario();
  const id = 'toolu_opaco';
  assert.equal(bash(repo, 'PreToolUse', 'node gera.mjs', 'modulo-core', id).codigo, 0);
  appendFileSync(join(clone, ...EXISTENTE.split('/')), 'editado\n');
  const pos = bash(repo, 'PostToolUse', 'node gera.mjs', 'modulo-core', id);
  assert.equal(pos.codigo, 0, pos.erro);
  assert.match(pos.saida, /\.coord\/recados\/testes\/R-20261031-000000-modulo-core\.md/);
  assert.equal(readFileSync(join(clone, ...EXISTENTE.split('/')), 'utf8').endsWith('editado\n'), true, 'o guardião não desfaz nada');
  assert.equal(relativoDaRaiz(barras(join(repo, '.coord', 'recados')), barras(repo)), '.coord/recados');
});

// ───────────────────────── T-0143: recados direto no GitHub ─────────────────────────

test('T-0143: no modo GitHub (marca, sem MACUXI_RECADOS=local), escrita pela junção ou pelo clone é bloqueada', () => {
  const { repo, clone } = cenario();
  const github = { MACUXI_RECADOS: '' };
  const conteudo = '---\nid: R-20261109-130000-modulo-core\nde: modulo-core\n---\n# x\n';
  for (const caminho of [
    join(repo, '.coord', 'recados', 'testes', 'R-20261109-130000-modulo-core.md'),
    join(clone, 'recados', 'testes', 'R-20261109-130000-modulo-core.md'),
    join(repo, '.coord', 'lidos', 'modulo-core.txt'),
  ]) {
    const r = rodar(repo, 'guarda-donos.mjs', {
      session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Write', agent_type: 'modulo-core', cwd: repo,
      tool_input: { file_path: caminho, content: conteudo },
    }, github);
    assert.equal(r.codigo, 2, `${caminho}: ${r.erro}`);
    assert.match(r.erro, /direto no GitHub/);
  }
  // no modo local (volta), a mesma escrita pela junção passa
  assert.equal(escrita(repo, join(repo, '.coord', 'recados', 'testes', 'R-20261109-130000-modulo-core.md'), 'modulo-core', conteudo).codigo, 0);
});
