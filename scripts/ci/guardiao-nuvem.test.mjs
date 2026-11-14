// Guardião na nuvem (ADR 0045): os hooks de .claude/settings.json rodam em Linux/container, como nas sessões do
// claude.ai/code e no runner do CI. node:test, sem dependências. Rodar: node --test scripts/ci/guardiao-nuvem.test.mjs
// Roda os hooks DE VERDADE (os arquivos do repositório, não cópias), por processo filho, com o JSON do hook no stdin e
// caminhos absolutos dentro da raiz. A identidade vem de fonte que não depende do branch (subagente com agent_id, ou
// MACUXI_AGENTE na sessão principal); o caso "sessão da nuvem sem agente" só usa alvos barrados para qualquer identidade
// que o branch possa dar. MACUXI_GUARDA, MACUXI_AGENTE, CLAUDE_CODE_REMOTE e MACUXI_GH_SIMULADO saem do ambiente do filho.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = join(RAIZ, '.claude', 'hooks');
const POSIX = process.platform !== 'win32';

function ambiente(extra = {}) {
  const env = { ...process.env };
  for (const k of ['MACUXI_GUARDA', 'MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GH_SIMULADO']) delete env[k];
  return { ...env, ...extra };
}

/** Roda um hook (arquivo em .claude/hooks ou a linha de comando do settings.json, pelo shell) com o JSON no stdin. */
function rodar({ hook, linha, entrada, env = {} }) {
  const opcoes = { cwd: RAIZ, input: JSON.stringify(entrada), encoding: 'utf8', env: ambiente(env), timeout: 60_000 };
  const r = linha ? spawnSync(linha, { ...opcoes, shell: true }) : spawnSync(process.execPath, [join(HOOKS, hook)], opcoes);
  assert.equal(r.error, undefined, `o hook não rodou: ${r.error}`);
  return { codigo: r.status, erro: r.stderr || '' };
}

const SUB = (agente) => ({ agent_id: `sub-${agente}`, agent_type: agente });
const write = (arquivo, extra = {}) => ({
  session_id: 's-nuvem', hook_event_name: 'PreToolUse', tool_name: 'Write',
  tool_input: { file_path: arquivo, content: 'x' }, cwd: RAIZ, ...extra,
});
const bash = (comando, extra = {}) => ({
  session_id: 's-nuvem', tool_use_id: `t-${process.hrtime.bigint()}`, hook_event_name: 'PreToolUse', tool_name: 'Bash',
  tool_input: { command: comando }, cwd: RAIZ, ...extra,
});
const abs = (rel) => join(RAIZ, ...rel.split('/'));

test('a raiz e os alvos são caminhos POSIX absolutos (Linux/container)', { skip: !POSIX && 'só em Linux/macOS' }, () => {
  assert.ok(RAIZ.startsWith('/'), RAIZ);
  assert.ok(!/^[A-Za-z]:/.test(RAIZ) && !RAIZ.includes('\\'), RAIZ);
  assert.ok(abs('modules/core/x.ts').startsWith(`${RAIZ}/modules/core/`));
});

test('guarda-donos: subagente libera o próprio caminho e bloqueia o de outro dono e a governança', () => {
  const eng = SUB('engenheiro-software');
  for (const f of ['scripts/ci/sonda-nuvem.mjs', 'docs/decisoes/sonda.md', 'packages/platform-sdk/sonda.ts']) {
    const r = rodar({ hook: 'guarda-donos.mjs', entrada: write(abs(f), eng) });
    assert.equal(r.codigo, 0, `${f}: ${r.erro}`);
  }
  const outro = rodar({ hook: 'guarda-donos.mjs', entrada: write(abs('modules/core/sonda.ts'), eng) });
  assert.equal(outro.codigo, 2);
  assert.match(outro.erro, /BLOQUEADO.*pertence a modulo-core/);
  for (const f of ['.claude/hooks/sonda.mjs', '.claude/settings.json', 'scripts/coord.mjs', '.coord/donos.json']) {
    const r = rodar({ hook: 'guarda-donos.mjs', entrada: write(abs(f), eng) });
    assert.equal(r.codigo, 2, `${f} deveria ser barrado`);
    assert.match(r.erro, /pertence a alexandre/);
  }
  // caminho relativo resolve na raiz, igual ao absoluto
  assert.equal(rodar({ hook: 'guarda-donos.mjs', entrada: write('modules/core/sonda.ts', eng) }).codigo, 2);
});

test('guarda-donos: sessão principal da nuvem com MACUXI_AGENTE é esse agente', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true', MACUXI_AGENTE: 'modulo-core' };
  const principal = { agent_type: 'gerente-projetos' };
  assert.equal(rodar({ hook: 'guarda-donos.mjs', entrada: write(abs('modules/core/sonda.ts'), principal), env }).codigo, 0);
  const r = rodar({ hook: 'guarda-donos.mjs', entrada: write(abs('apps/api/sonda.ts'), principal), env });
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /pertence a engenheiro-software/);
});

test('guarda-donos: sessão principal da nuvem sem agente declarado fica restrita (nunca liberada como a manual local)', () => {
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const principal = { agent_type: 'gerente-projetos' };
  // Qualquer identidade que o branch atual possa dar (gerente-projetos ou um agente do trailer) é barrada nestes alvos.
  for (const f of ['.claude/hooks/sonda.mjs', 'scripts/coord-lib.mjs', '.coord/donos.json']) {
    assert.equal(rodar({ hook: 'guarda-donos.mjs', entrada: write(abs(f), principal), env }).codigo, 2, f);
  }
  // sem agent_type nenhum também: na nuvem cai no "agent" do settings.json, nunca em liberado
  assert.equal(rodar({ hook: 'guarda-donos.mjs', entrada: write(abs('.claude/hooks/sonda.mjs')), env }).codigo, 2);
});

test('guarda-bash: escrita em caminho alheio bloqueia (relativo e absoluto POSIX); leitura e caminho próprio passam', () => {
  const eng = SUB('engenheiro-software');
  for (const c of ['echo x > modules/core/sonda.ts', `echo x > ${abs('modules/core/sonda.ts')}`, `cp README.md ${abs('.claude/hooks/sonda.mjs')}`]) {
    const r = rodar({ hook: 'guarda-bash.mjs', entrada: bash(c, eng) });
    assert.equal(r.codigo, 2, `${c}: deveria bloquear`);
    assert.match(r.erro, /guardião|BLOQUEADO/i);
  }
  for (const c of ['ls docs', 'git status --short', `cat ${abs('package.json')}`, 'node scripts/coord.mjs dono modules/core/x.ts']) {
    const r = rodar({ hook: 'guarda-bash.mjs', entrada: bash(c, eng) });
    assert.equal(r.codigo, 0, `${c}: ${r.erro}`);
  }
});

test('guarda-bash: gh api de escrita bloqueia para qualquer sessão (sem rede)', () => {
  const r = rodar({ hook: 'guarda-bash.mjs', entrada: bash('gh api -X POST repos/aloirr/macuxifdv/issues -f title=x', SUB('engenheiro-software')) });
  assert.equal(r.codigo, 2);
  const nuvem = rodar({ hook: 'guarda-bash.mjs', entrada: bash('gh api -X DELETE repos/aloirr/macuxifdv/git/refs/heads/x'), env: { CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(nuvem.codigo, 2);
});

test('settings.json: os comandos dos hooks são "node <caminho relativo POSIX>" que existe e rodam pelo shell do Linux', () => {
  const settings = JSON.parse(readFileSync(join(RAIZ, '.claude', 'settings.json'), 'utf8'));
  const linhas = Object.values(settings.hooks || {}).flat().flatMap((g) => (g.hooks || []).map((h) => ({ matcher: g.matcher, comando: h.command })));
  assert.ok(linhas.length >= 4, 'hooks configurados');
  for (const { comando } of linhas) {
    const m = /^node (\.claude\/hooks\/[\w.-]+\.mjs)$/.exec(comando);
    assert.ok(m, `comando fora do padrão (Windows, binário ou caminho absoluto?): ${comando}`);
    assert.ok(existsSync(join(RAIZ, m[1])), `${m[1]} não existe`);
  }
  // A linha exata do settings.json, pelo shell (/bin/sh no Linux), a partir da raiz.
  const donos = linhas.find((l) => /Write/.test(l.matcher)).comando;
  const doBash = linhas.find((l) => l.matcher === 'Bash').comando;
  assert.equal(rodar({ linha: donos, entrada: write(abs('modules/core/sonda.ts'), SUB('engenheiro-software')) }).codigo, 2);
  assert.equal(rodar({ linha: donos, entrada: write(abs('scripts/ci/sonda.mjs'), SUB('engenheiro-software')) }).codigo, 0);
  assert.equal(rodar({ linha: doBash, entrada: bash('echo x > modules/core/sonda.ts', SUB('engenheiro-software')) }).codigo, 2);
  assert.equal(rodar({ linha: doBash, entrada: bash('ls', SUB('engenheiro-software')) }).codigo, 0);
});

test('nenhum hook depende de caminho do Windows nem de binário só do Windows', () => {
  const arquivos = readdirSync(HOOKS).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => join(HOOKS, f));
  arquivos.push(join(RAIZ, 'scripts', 'coord-lib.mjs'));
  const PERMITIDOS = new Set(["'git'", "'gh'", 'gh', 'process.execPath']);
  for (const arq of arquivos) {
    const codigo = readFileSync(arq, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    // processos filhos: só git, gh (achado no PATH) e o próprio node; nada de shell (execSync/exec)
    for (const m of codigo.matchAll(/(?<![.\w$])(execFileSync|spawnSync|execFile|spawn|execSync|exec)\(\s*([^,)\s]+)/g)) {
      assert.ok(m[1] !== 'execSync' && m[1] !== 'exec', `${arq}: ${m[0]} (shell)`);
      assert.ok(PERMITIDOS.has(m[2]), `${arq}: processo filho "${m[2]}" (só git, gh e node)`);
    }
    // binário do Windows (cmd.exe, powershell, mklink...) só entraria por shell: nenhum processo filho com shell: true
    assert.doesNotMatch(codigo, /\bshell:\s*true/, `${arq}: processo filho com shell`);
    // literal de caminho com letra de drive só como dado (nunca como requisito): não pode ser lido/testado direto
    assert.doesNotMatch(codigo, /\b(readFileSync|existsSync|statSync|readdirSync|realpathSync(\.native)?|join|resolve)\(\s*['"`][A-Za-z]:[\\/]/, `${arq}: caminho do Windows como requisito`);
  }
});
