// Testes da identificação do agente nos guardiões (guardião v4, T-0005) — node:test, sem dependências.
// Rodar: node --test .claude/hooks/guarda-agente.test.mjs
// Parte 1: identificarAgente (função pura, scripts/coord-lib.mjs). Parte 2: os hooks de verdade
// (guarda-donos.mjs e guarda-bash.mjs, stdin → exit code) num repositório git temporário com
// cópia de coord-lib.mjs e dos hooks, no branch da sessão simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { identificarAgente, trailersAgente, commitsDoBranch, refsDoGit, branchAtual, arquivoCacheIdentificacao } from '../../scripts/coord-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

// ───────────────────────── Parte 1: identificarAgente ─────────────────────────

const NUVEM = { CLAUDE_CODE_REMOTE: 'true' };
const commit = (corpo, sha = 'abc1234') => ({ sha, corpo });
const ident = (p) => identificarAgente({ agentePadrao: 'gerente-projetos', ...p });

test('identificação: na sessão principal, MACUXI_AGENTE vence argumento, agent_type e branch', () => {
  const r = ident({
    env: { ...NUVEM, MACUXI_AGENTE: ' Modulo-Core ' }, argumento: 'testes', entrada: { agent_type: 'gerente-projetos' },
    branch: () => 'testes/T-0006',
  });
  assert.deepEqual(r, { agente: 'modulo-core', origem: 'variável MACUXI_AGENTE' });
  assert.equal(ident({ env: { MACUXI_AGENTE: 'alexandre' } }).agente, 'alexandre');
  assert.equal(ident({ env: { ...NUVEM, MACUXI_AGENTE: 'alexandre' }, entrada: { agent_type: 'gerente-projetos' } }).agente, 'alexandre');
});

test('identificação (v4): subagente (agent_id) vence MACUXI_AGENTE; a variável vale só para a sessão principal', () => {
  const env = { MACUXI_AGENTE: 'alexandre' };
  assert.deepEqual(ident({ env, entrada: { agent_type: 'modulo-core', agent_id: 'a1' } }), { agente: 'modulo-core', origem: 'subagente (agent_type)' });
  assert.deepEqual(ident({ env: { ...env, ...NUVEM }, argumento: 'testes', entrada: { agent_type: 'testes', agent_id: 'a2' } }), { agente: 'testes', origem: 'subagente (argumento do hook)' });
  assert.equal(ident({ env, entrada: { agent_type: 'gerente-projetos', agent_id: 'a3' }, branch: () => 'alexandre/x' }).agente, 'gerente-projetos');
  const semTipo = ident({ env, entrada: { agent_id: 'a4' } });
  assert.notEqual(semTipo.agente, 'alexandre', 'subagente sem agent_type não herda a variável');
  assert.notEqual(semTipo.agente, '', 'nem é liberado como sessão manual');
});

test('identificação: sessão local de agente mantém o agente de hoje (argumento ou agent_type), mesmo em branch de outro', () => {
  const branch = () => 'modulo-core/T-0003-licencas';
  assert.deepEqual(ident({ argumento: 'testes', branch }), { agente: 'testes', origem: 'argumento do hook' });
  assert.equal(ident({ entrada: { agent_type: 'gerente-projetos' }, branch }).agente, 'gerente-projetos');
  assert.equal(ident({ entrada: { agent_type: 'gerente-projetos' }, env: { CLAUDE_CODE_REMOTE: 'false' }, branch }).agente, 'gerente-projetos');
});

test('identificação: na nuvem, subagente (agent_id ou agent_type diferente do padrão) mantém o próprio agente', () => {
  const branch = () => 'alexandre/T-0005';
  assert.equal(ident({ env: NUVEM, entrada: { agent_type: 'modulo-core', agent_id: 'x1' }, branch }).agente, 'modulo-core');
  assert.equal(ident({ env: NUVEM, entrada: { agent_type: 'gerente-projetos', agent_id: 'x1' }, branch }).agente, 'gerente-projetos');
  assert.equal(ident({ env: NUVEM, entrada: { agent_type: 'testes' }, branch }).agente, 'testes');
});

test('identificação por branch (sessão principal da nuvem ou sessão manual)', () => {
  const e = { env: NUVEM, entrada: { agent_type: 'gerente-projetos' } };
  assert.deepEqual(ident({ ...e, branch: () => 'modulo-core/T-0003-licencas' }), { agente: 'modulo-core', origem: 'branch modulo-core/T-0003-licencas' });
  assert.equal(ident({ ...e, branch: () => 'agente/T-0007-banco-dados' }).agente, 'banco-dados');
  assert.equal(ident({ branch: () => 'testes/T-0006' }).agente, 'testes', 'sessão manual local em branch de agente = trabalhar como ele');
  assert.equal(ident({ branch: () => 'main' }).agente, '', 'sessão manual local no main continua liberada');
});

test('identificação (v4): branch alexandre/* sem MACUXI_AGENTE não dá a identidade alexandre', () => {
  const nuvem = ident({ env: NUVEM, entrada: { agent_type: 'gerente-projetos' }, branch: () => 'alexandre/qualquer-coisa' });
  assert.equal(nuvem.agente, 'gerente-projetos', 'sessão principal da nuvem fica restrita ao agent_type');
  assert.match(nuvem.origem, /não concede alexandre/);
  assert.equal(ident({ entrada: { agent_type: 'modulo-core' }, branch: () => 'alexandre/x' }).agente, 'modulo-core', 'sessão local de agente');
  assert.equal(ident({ branch: () => 'agente/T-0001-alexandre', env: NUVEM, entrada: { agent_type: 'gerente-projetos' } }).agente, 'gerente-projetos');
  assert.notEqual(ident({ env: NUVEM, branch: () => 'alexandre/x' }).agente, 'alexandre', 'nuvem sem agent_type');
  assert.equal(ident({ env: { ...NUVEM, MACUXI_AGENTE: 'alexandre' }, entrada: { agent_type: 'gerente-projetos' }, branch: () => 'alexandre/x' }).agente, 'alexandre', 'com a variável, sim');
});

test('identificação por trailer: nuvem/* usa o "Agente:" único dos commits do branch que o têm', () => {
  const e = { env: NUVEM, entrada: { agent_type: 'gerente-projetos' }, branch: () => 'nuvem/T-0005-guardiao-v4' };
  const r = ident({ ...e, commitsDoBranch: () => [commit('wip sem trailer'), commit('T-0005: x\n\nAgente: modulo-pesquisa\n')] });
  assert.deepEqual(r, { agente: 'modulo-pesquisa', origem: 'trailer "Agente:" do branch nuvem/T-0005-guardiao-v4' });
  assert.equal(ident({ ...e, commitsDoBranch: () => [commit('a\n\nAgente: Modulo-Core'), commit('b\n\nAgente: modulo-core')] }).agente, 'modulo-core');
});

test('identificação (v4): trailer "Agente: alexandre" num nuvem/* não dá a identidade alexandre', () => {
  const e = { env: NUVEM, entrada: { agent_type: 'gerente-projetos' }, branch: () => 'nuvem/T-0005-guardiao-v4' };
  const r = ident({ ...e, commitsDoBranch: () => [commit('T-0005: x\n\nAgente: alexandre\n')] });
  assert.equal(r.agente, 'gerente-projetos');
  assert.match(r.origem, /"Agente: alexandre".*não concede alexandre/);
  assert.equal(ident({ env: NUVEM, branch: e.branch, commitsDoBranch: () => [commit('Agente: alexandre')] }).agente, 'gerente-projetos', 'nuvem sem agent_type: o "agent" do settings.json');
  assert.equal(ident({ branch: e.branch, commitsDoBranch: () => [commit('Agente: alexandre')] }).agente, '', 'sessão manual local continua liberada');
});

test('identificação ambígua → comportamento restrito (agent_type; nuvem sem agente = "agent" do settings.json)', () => {
  const e = { env: NUVEM, entrada: { agent_type: 'gerente-projetos' } };
  const nuvem = (commits) => ident({ ...e, branch: () => 'nuvem/T-0009', commitsDoBranch: () => commits });
  assert.equal(nuvem([]).agente, 'gerente-projetos', 'branch nuvem sem commit próprio');
  assert.equal(nuvem([commit('sem trailer')]).agente, 'gerente-projetos');
  assert.equal(nuvem([commit('Agente: alexandre'), commit('Agente: modulo-core')]).agente, 'gerente-projetos', 'agentes diferentes');
  assert.equal(nuvem([commit('Agente: fulano')]).agente, 'gerente-projetos', 'agente fora do time');
  assert.equal(ident({ ...e, branch: () => 'agente/T-0001-fulano' }).agente, 'gerente-projetos', 'branch de alguém fora do time');
  assert.equal(ident({ ...e, branch: () => 'claude/sessao-xyz' }).agente, 'gerente-projetos', 'branch sem padrão');
  assert.equal(ident({ ...e, branch: () => { throw new Error('sem git'); } }).agente, 'gerente-projetos', 'git indisponível');
  assert.equal(ident({ env: NUVEM, branch: () => null }).agente, 'gerente-projetos', 'nuvem sem nada: restrita, não liberada');
  assert.equal(identificarAgente({ env: NUVEM }).agente, 'sessao-sem-agente', 'nuvem sem agent no settings.json: fora do time');
  assert.equal(ident({ branch: () => null }).agente, '', 'sessão manual local: liberada');
});

test('trailersAgente: minúsculos, sem repetição, só linhas "Agente: <nome>"', () => {
  assert.deepEqual(trailersAgente('x\n\nAgente: alexandre\nAgente: Alexandre\nagente: testes\nNão-Agente: y\nAgente: a b'), ['alexandre', 'testes']);
  assert.deepEqual(trailersAgente(''), []);
});

// ───────────────────────── Parte 2: os hooks de verdade ─────────────────────────

const DONOS = {
  versao: 1,
  regras: [
    { padrao: '.claude/**', dono: 'alexandre' },
    { padrao: 'scripts/coord*.mjs', dono: 'alexandre' },
    { padrao: 'legado/**', dono: 'congelado' },
    { padrao: '.coord/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: 'apps/**', dono: 'engenheiro-software' },
  ],
};
const SETTINGS = { agent: 'gerente-projetos' };

const temporarios = [];
process.on('exit', () => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}

/** Repositório com main (1 commit) e, se `branch`, um branch com 1 commit cuja mensagem é `mensagem`. */
function criarRepo({ branch, mensagem = 'T-0005: trabalho\n\nAgente: alexandre\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-agente-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(dir, '.claude/settings.json', JSON.stringify(SETTINGS, null, 2));
  escrever(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md', '---\nde: modulo-core\n---\n');
  for (const f of ['modules/core/a.ts', 'apps/api/x.ts', 'legado/velho.txt']) escrever(dir, f);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  copyFileSync(join(RAIZ_REAL, 'scripts', 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
  for (const f of ['guarda-donos.mjs', 'guarda-bash.mjs', 'guarda-bash-lib.mjs', 'guarda-merge-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial\n\nAgente: modulo-core');
  if (branch) {
    git(dir, 'checkout', '-q', '-b', branch);
    escrever(dir, 'modules/core/a.ts', 'mudou no branch\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', mensagem);
  }
  return dir;
}

/** Roda um hook com o JSON de uma edição (Write) ou de um Bash; ambiente da sessão isolado. */
function rodarHook(dir, hook, { arquivo, comando, entrada = {}, env = {} }) {
  const base = { ...process.env };
  delete base.MACUXI_AGENTE;
  delete base.CLAUDE_CODE_REMOTE;
  const json = comando
    ? { session_id: 's-agente', tool_use_id: `t-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando }, cwd: dir, ...entrada }
    : { session_id: 's-agente', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, arquivo), content: 'x' }, cwd: dir, ...entrada };
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', hook)], {
    cwd: dir, input: JSON.stringify(json), encoding: 'utf8', env: { ...base, MACUXI_GUARDA: '', ...env },
  });
  return { codigo: r.status, erro: r.stderr };
}
const editar = (dir, arquivo, o = {}) => rodarHook(dir, 'guarda-donos.mjs', { arquivo, ...o });
const bash = (dir, comando, o = {}) => rodarHook(dir, 'guarda-bash.mjs', { comando, ...o });

const SESSAO_NUVEM = { entrada: { agent_type: 'gerente-projetos' }, env: NUVEM };
const ALEXANDRE_NUVEM = { entrada: { agent_type: 'gerente-projetos' }, env: { ...NUVEM, MACUXI_AGENTE: 'alexandre' } };

test('hook (v4): trailer "Agente: alexandre" num nuvem/* não dá poderes de alexandre (sessão principal da nuvem)', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v4' });
  for (const f of ['.claude/hooks/guarda-donos.mjs', 'scripts/coord.mjs', 'apps/api/x.ts']) {
    const r = editar(dir, f, SESSAO_NUVEM);
    assert.equal(r.codigo, 2, `${f} deveria ser barrado: ${r.erro}`);
  }
  assert.match(editar(dir, '.claude/hooks/guarda-donos.mjs', SESSAO_NUVEM).erro, /pertence a alexandre/);
  assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', SESSAO_NUVEM).codigo, 2);
  assert.equal(bash(dir, 'echo y >> scripts/coord-lib.mjs', SESSAO_NUVEM).codigo, 2);
  assert.equal(editar(dir, '.coord/quadro.md', SESSAO_NUVEM).codigo, 0, 'continua como gerente-projetos');
});

test('hook (v4): branch alexandre/* sem MACUXI_AGENTE não dá poderes de alexandre', () => {
  const dir = criarRepo({ branch: 'alexandre/ajuste-guardiao', mensagem: 'sem trailer' });
  assert.equal(editar(dir, '.claude/hooks/guarda-donos.mjs', SESSAO_NUVEM).codigo, 2);
  assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', SESSAO_NUVEM).codigo, 2);
  const dir2 = criarRepo({ branch: 'alexandre/T-0005-x' });
  assert.equal(editar(dir2, 'scripts/coord.mjs', SESSAO_NUVEM).codigo, 2, 'branch alexandre/* + trailer alexandre');
  assert.equal(editar(dir2, 'modules/core/a.ts', { entrada: { agent_type: 'modulo-core' } }).codigo, 0, 'sessão local de agente: o próprio agente');
  assert.equal(editar(dir2, 'scripts/coord.mjs', { entrada: { agent_type: 'modulo-core' } }).codigo, 2);
});

test('hook: sessão da nuvem com MACUXI_AGENTE=alexandre não é barrada em .claude/ nem em scripts/coord*.mjs', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v4' });
  for (const f of ['.claude/hooks/guarda-donos.mjs', '.claude/hooks/novo.test.mjs', 'scripts/coord.mjs', 'apps/api/x.ts']) {
    const r = editar(dir, f, ALEXANDRE_NUVEM);
    assert.equal(r.codigo, 0, `${f}: ${r.erro}`);
  }
  const b = bash(dir, 'echo x > .claude/hooks/x.mjs && echo y >> scripts/coord-lib.mjs', ALEXANDRE_NUVEM);
  assert.equal(b.codigo, 0, b.erro);
});

test('hook: alexandre identificado continua barrado em congelado e em recado existente', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v4' });
  const r = editar(dir, 'legado/velho.txt', ALEXANDRE_NUVEM);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /congelada/);
  assert.equal(editar(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md', ALEXANDRE_NUVEM).codigo, 2);
  assert.equal(bash(dir, 'echo x >> legado/velho.txt', ALEXANDRE_NUVEM).codigo, 2);
});

test('hook: mesma sessão da nuvem sem trailer no branch → comportamento atual (gerente-projetos, barrada)', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v4', mensagem: 'wip sem trailer' });
  const r = editar(dir, '.claude/hooks/guarda-donos.mjs', SESSAO_NUVEM);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /pertence a alexandre/);
  assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', SESSAO_NUVEM).codigo, 2);
});

test('hook: sessão local de agente não muda (agent_type vence o branch)', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v4', mensagem: 'T-0005: x\n\nAgente: modulo-core\n' });
  const local = { entrada: { agent_type: 'gerente-projetos' } };
  assert.equal(editar(dir, '.claude/hooks/guarda-donos.mjs', local).codigo, 2);
  assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', local).codigo, 2);
  assert.equal(editar(dir, '.coord/quadro.md', local).codigo, 0);
});

test('hook: MACUXI_AGENTE identifica o agente nos dois guardiões', () => {
  const dir = criarRepo();
  const alexandre = { entrada: { agent_type: 'gerente-projetos' }, env: { MACUXI_AGENTE: 'alexandre' } };
  assert.equal(editar(dir, '.claude/hooks/guarda-donos.mjs', alexandre).codigo, 0);
  assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', alexandre).codigo, 0);
  const core = { env: { MACUXI_AGENTE: 'modulo-core' } };
  assert.equal(editar(dir, 'modules/core/a.ts', core).codigo, 0);
  const r = editar(dir, 'apps/api/x.ts', core);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /pertence a engenheiro-software/);
  assert.equal(bash(dir, 'echo x > apps/api/x.ts', core).codigo, 2);
  assert.equal(editar(dir, 'modules/core/a.ts', { env: { MACUXI_AGENTE: 'fulano' } }).codigo, 2, 'fora do time');
});

test('hook: agente pelo nome do branch (sessão principal da nuvem)', () => {
  const dir = criarRepo({ branch: 'modulo-core/T-0003-licencas', mensagem: 'sem trailer' });
  assert.equal(editar(dir, 'modules/core/a.ts', SESSAO_NUVEM).codigo, 0);
  assert.equal(editar(dir, '.coord/quadro.md', SESSAO_NUVEM).codigo, 2, 'como modulo-core, não como gerente-projetos');
  assert.equal(bash(dir, 'echo x > .coord/quadro.md', SESSAO_NUVEM).codigo, 2);
});

test('hook: subagente na nuvem é guardado como ele mesmo, não como o agente do branch', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v4', mensagem: 'T-0005: x\n\nAgente: engenheiro-software\n' });
  const sub = { entrada: { agent_type: 'modulo-core', agent_id: 'sub-1' }, env: NUVEM };
  assert.equal(editar(dir, '.claude/hooks/guarda-donos.mjs', sub).codigo, 2);
  assert.equal(editar(dir, 'apps/api/x.ts', sub).codigo, 2, 'não herda o engenheiro-software do trailer');
  assert.equal(editar(dir, 'modules/core/a.ts', sub).codigo, 0);
  assert.equal(bash(dir, 'echo x > scripts/coord.mjs', sub).codigo, 2);
});

test('hook (v4): subagente numa sessão com MACUXI_AGENTE=alexandre continua restrito ao próprio dono', () => {
  const dir = criarRepo();
  for (const env of [{ MACUXI_AGENTE: 'alexandre' }, { ...NUVEM, MACUXI_AGENTE: 'alexandre' }]) {
    const sub = { entrada: { agent_type: 'modulo-core', agent_id: 'sub-2' }, env };
    for (const f of ['.claude/hooks/guarda-donos.mjs', 'scripts/coord.mjs', 'apps/api/x.ts', '.coord/quadro.md']) {
      const r = editar(dir, f, sub);
      assert.equal(r.codigo, 2, `${f} (${env.CLAUDE_CODE_REMOTE ? 'nuvem' : 'local'}): ${r.erro}`);
    }
    assert.equal(editar(dir, 'modules/core/a.ts', sub).codigo, 0);
    assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', sub).codigo, 2);
    assert.equal(bash(dir, 'echo x > apps/api/x.ts', sub).codigo, 2);
    const comArg = rodarHook(dir, 'guarda-donos.mjs', { arquivo: '.claude/hooks/guarda-donos.mjs', entrada: { agent_type: 'testes', agent_id: 'sub-3' }, env });
    assert.equal(comArg.codigo, 2, 'subagente testes também');
  }
});

// ───────────────────────── Parte 3: cache da identificação por HEAD ─────────────────────────

test('commitsDoBranch: cache por HEAD num arquivo temporário (só refaz o git log quando HEAD ou a base mudam)', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-cache', mensagem: 'T-0005: a\n\nAgente: modulo-core\n' });
  const pastaCache = mkdtempSync(join(tmpdir(), 'guarda-cache-'));
  temporarios.push(pastaCache);
  const arq = arquivoCacheIdentificacao(dir, pastaCache);
  assert.equal(existsSync(arq), false);
  const primeiro = commitsDoBranch(dir, { pastaCache });
  assert.deepEqual(primeiro.map((c) => c.corpo), ['Agente: modulo-core']);
  const cache = JSON.parse(readFileSync(arq, 'utf8'));
  assert.equal(cache.chave.split('|')[0], git(dir, 'rev-parse', 'HEAD').trim(), 'chave = HEAD | base');
  // Prova de que o cache é usado: com o mesmo HEAD, devolve o que está no arquivo, sem rodar o git.
  writeFileSync(arq, JSON.stringify({ ...cache, commits: [{ sha: 'x', corpo: 'Agente: testes' }] }));
  assert.deepEqual(commitsDoBranch(dir, { pastaCache }).map((c) => c.corpo), ['Agente: testes']);
  // HEAD novo → recalcula.
  escrever(dir, 'modules/core/b.ts');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'T-0005: b\n\nAgente: banco-dados');
  assert.deepEqual(commitsDoBranch(dir, { pastaCache }).map((c) => c.corpo), ['Agente: banco-dados', 'Agente: modulo-core']);
  // A base mudou (main andou) → recalcula também.
  const cache2 = JSON.parse(readFileSync(arq, 'utf8'));
  git(dir, 'branch', '-f', 'main', 'HEAD~1');
  assert.deepEqual(commitsDoBranch(dir, { pastaCache }).map((c) => c.corpo), ['Agente: banco-dados']);
  assert.notEqual(JSON.parse(readFileSync(arq, 'utf8')).chave, cache2.chave);
});

test('refsDoGit/branchAtual: leem HEAD, branch e base do .git (refs soltas, packed-refs e HEAD destacado)', () => {
  const dir = criarRepo({ branch: 'modulo-core/T-0003-x' });
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  const main = git(dir, 'rev-parse', 'main').trim();
  assert.deepEqual(refsDoGit(dir), { branch: 'modulo-core/T-0003-x', head, base: main });
  git(dir, 'pack-refs', '--all');
  assert.deepEqual(refsDoGit(dir), { branch: 'modulo-core/T-0003-x', head, base: main }, 'packed-refs');
  assert.equal(branchAtual(dir), 'modulo-core/T-0003-x');
  git(dir, 'checkout', '-q', '--detach');
  assert.deepEqual(refsDoGit(dir), { branch: null, head, base: main }, 'HEAD destacado');
  assert.equal(branchAtual(dir), null);
  const fora = mkdtempSync(join(tmpdir(), 'guarda-sem-git-'));
  temporarios.push(fora);
  assert.equal(refsDoGit(fora), null);
});
