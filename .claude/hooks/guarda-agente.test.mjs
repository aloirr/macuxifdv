// Testes da identificação do agente nos guardiões (guardião v3, T-0005) — node:test, sem dependências.
// Rodar: node --test .claude/hooks/guarda-agente.test.mjs
// Parte 1: identificarAgente (função pura, scripts/coord-lib.mjs). Parte 2: os hooks de verdade
// (guarda-donos.mjs e guarda-bash.mjs, stdin → exit code) num repositório git temporário com
// cópia de coord-lib.mjs e dos hooks, no branch da sessão simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { identificarAgente, trailersAgente } from '../../scripts/coord-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

// ───────────────────────── Parte 1: identificarAgente ─────────────────────────

const NUVEM = { CLAUDE_CODE_REMOTE: 'true' };
const commit = (corpo, sha = 'abc1234') => ({ sha, corpo });
const ident = (p) => identificarAgente({ agentePadrao: 'gerente-projetos', ...p });

test('identificação: MACUXI_AGENTE vence todas as outras fontes', () => {
  const r = ident({
    env: { ...NUVEM, MACUXI_AGENTE: ' Modulo-Core ' }, argumento: 'testes', entrada: { agent_type: 'gerente-projetos', agent_id: 'a1' },
    branch: () => 'alexandre/ajuste',
  });
  assert.deepEqual(r, { agente: 'modulo-core', origem: 'variável MACUXI_AGENTE' });
  assert.equal(ident({ env: { MACUXI_AGENTE: 'alexandre' } }).agente, 'alexandre');
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
  assert.equal(ident({ ...e, branch: () => 'alexandre/qualquer-coisa' }).agente, 'alexandre');
  assert.equal(ident({ branch: () => 'testes/T-0006' }).agente, 'testes', 'sessão manual local em branch de agente');
  assert.equal(ident({ branch: () => 'main' }).agente, '', 'sessão manual no main continua liberada');
});

test('identificação por trailer: nuvem/* usa o "Agente:" do último commit do branch que o tem', () => {
  const e = { env: NUVEM, entrada: { agent_type: 'gerente-projetos' }, branch: () => 'nuvem/T-0005-guardiao-v3' };
  const r = ident({ ...e, commitsDoBranch: () => [commit('wip sem trailer'), commit('T-0005: x\n\nAgente: alexandre\n')] });
  assert.deepEqual(r, { agente: 'alexandre', origem: 'trailer "Agente:" do branch nuvem/T-0005-guardiao-v3' });
  assert.equal(ident({ ...e, commitsDoBranch: () => [commit('a\n\nAgente: Modulo-Pesquisa')] }).agente, 'modulo-pesquisa');
});

test('identificação ambígua → comportamento anterior (argumento || agent_type)', () => {
  const e = { env: NUVEM, entrada: { agent_type: 'gerente-projetos' } };
  const nuvem = (commits) => ident({ ...e, branch: () => 'nuvem/T-0009', commitsDoBranch: () => commits });
  assert.equal(nuvem([]).agente, 'gerente-projetos', 'branch nuvem sem commit próprio');
  assert.equal(nuvem([commit('sem trailer')]).agente, 'gerente-projetos');
  assert.equal(nuvem([commit('Agente: alexandre'), commit('Agente: modulo-core')]).agente, 'gerente-projetos', 'agentes diferentes');
  assert.equal(nuvem([commit('Agente: fulano')]).agente, 'gerente-projetos', 'agente fora do time');
  assert.equal(ident({ ...e, branch: () => 'agente/T-0001-fulano' }).agente, 'gerente-projetos', 'branch de alguém fora do time');
  assert.equal(ident({ ...e, branch: () => 'claude/sessao-xyz' }).agente, 'gerente-projetos', 'branch sem padrão');
  assert.equal(ident({ ...e, branch: () => { throw new Error('sem git'); } }).agente, 'gerente-projetos', 'git indisponível');
  assert.equal(ident({ env: NUVEM, branch: () => null }).agente, '', 'sem nada: sessão manual');
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
  for (const f of ['guarda-donos.mjs', 'guarda-bash.mjs', 'guarda-bash-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
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

test('hook: sessão da nuvem como alexandre (trailer do branch nuvem/*) não é barrada em .claude/ nem em scripts/coord*.mjs', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v3' });
  for (const f of ['.claude/hooks/guarda-donos.mjs', '.claude/hooks/novo.test.mjs', 'scripts/coord.mjs', 'apps/api/x.ts']) {
    const r = editar(dir, f, SESSAO_NUVEM);
    assert.equal(r.codigo, 0, `${f}: ${r.erro}`);
  }
  const b = bash(dir, 'echo x > .claude/hooks/x.mjs && echo y >> scripts/coord-lib.mjs', SESSAO_NUVEM);
  assert.equal(b.codigo, 0, b.erro);
});

test('hook: alexandre identificado continua barrado em congelado e em recado existente', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v3' });
  const r = editar(dir, 'legado/velho.txt', SESSAO_NUVEM);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /congelada/);
  assert.equal(editar(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md', SESSAO_NUVEM).codigo, 2);
  assert.equal(bash(dir, 'echo x >> legado/velho.txt', SESSAO_NUVEM).codigo, 2);
});

test('hook: mesma sessão da nuvem sem trailer no branch → comportamento atual (gerente-projetos, barrada)', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v3', mensagem: 'wip sem trailer' });
  const r = editar(dir, '.claude/hooks/guarda-donos.mjs', SESSAO_NUVEM);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /pertence a alexandre/);
  assert.equal(bash(dir, 'echo x > .claude/hooks/x.mjs', SESSAO_NUVEM).codigo, 2);
});

test('hook: sessão local de agente não muda (agent_type vence o branch)', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v3' });
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
  const dir2 = criarRepo({ branch: 'alexandre/ajuste-guardiao', mensagem: 'sem trailer' });
  assert.equal(editar(dir2, '.claude/hooks/guarda-donos.mjs', SESSAO_NUVEM).codigo, 0);
});

test('hook: subagente na nuvem é guardado como ele mesmo, não como o agente do branch', () => {
  const dir = criarRepo({ branch: 'nuvem/T-0005-guardiao-v3' });
  const sub = { entrada: { agent_type: 'modulo-core', agent_id: 'sub-1' }, env: NUVEM };
  assert.equal(editar(dir, '.claude/hooks/guarda-donos.mjs', sub).codigo, 2);
  assert.equal(editar(dir, 'modules/core/a.ts', sub).codigo, 0);
  assert.equal(bash(dir, 'echo x > scripts/coord.mjs', sub).codigo, 2);
});
