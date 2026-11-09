// Testes do guardião v7 (T-0122): ferramentas MCP (mcp__*) no PreToolUse (node:test, sem dependências).
// Rodar: node --test .claude/hooks/guarda-mcp.test.mjs
// Parte 1: funções puras (guarda-mcp-lib.mjs) com o podeAlterar REAL (scripts/coord-lib.mjs) sobre regras de teste.
// Parte 2: o hook de verdade (guarda-mcp.mjs, stdin → exit code) num repositório git temporário.
// Parte 3: o .claude/settings.json registra o hook para todas as ferramentas MCP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  classificarFerramentaMcp, conferirFerramentaMcp, caminhoRemoto, arquivosDaEntrada, agentesDaMensagem, ehNomeDeLeitura,
} from './guarda-mcp-lib.mjs';
import { podeAlterar, globParaRegex } from '../../scripts/coord-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

const REGRAS = [
  ['.claude/**', 'alexandre'], ['.coord/donos.json', 'alexandre'], ['.coord/recados/anexos/**', 'alexandre'],
  ['.github/**', 'engenheiro-software'], ['scripts/**', 'engenheiro-software'], ['docs/desenho/**', 'engenheiro-software'],
  ['modules/core/**', 'modulo-core'], ['modules/vendedor/**', 'modulo-vendedor'], ['.coord/**', 'gerente-projetos'],
].map(([padrao, dono]) => ({ padrao, dono, re: globParaRegex(padrao) }));
const RAIZ_FALSA = join(tmpdir(), 'macuxi-mcp-sem-arquivos'); // recado "existente" = nenhum (podeAlterar usa existsSync)
const pode = (p) => podeAlterar({ ...p, raiz: RAIZ_FALSA, regras: REGRAS });
const rel = (c) => (c.startsWith('/repo/') ? c.slice('/repo/'.length) : c.startsWith('/') ? null : c);

const PUSH = 'mcp__github__push_files';
const NUVEM_CORE = { agente: 'modulo-core', origem: 'trailer "Agente:" do branch nuvem/T-0099-x' };
const msg = (agente = 'modulo-core') => `T-0099: x\n\nAgente: ${agente}`;
const push = (o = {}) => ({ owner: 'aloirr', repo: 'macuxifdv', branch: 'nuvem/T-0099-x', message: msg(), files: [{ path: 'modules/core/domain/x.ts', content: 'export {}' }], ...o });
/** Junção de recados de teste (ADR 0035): /clone/recados/... = .coord/recados/...; o resto de /clone é do clone. */
const juncao = (c) => (c.startsWith('/clone/recados/') ? { rel: `.coord/recados/${c.slice('/clone/recados/'.length)}` } : c.startsWith('/clone/') ? { bloqueio: 'o clone do repositório de recados só muda pelo coord.mjs' } : null);
const conferir = ({ ferramenta = PUSH, entrada = push(), ident = NUVEM_CORE, subagente = false, somenteLeitura = [] } = {}) =>
  conferirFerramentaMcp({ ferramenta, entrada, ...ident, subagente, podeAlterar: pode, caminhoRelativo: rel, somenteLeitura, porJuncao: juncao });
const bloqueia = (o, re) => {
  const r = conferir(o);
  assert.equal(r.ok, false, JSON.stringify(o));
  assert.match(r.mensagem, /^\[guardião Macuxi\] BLOQUEADO \(ferramenta MCP\):/);
  assert.match(r.mensagem, re, r.mensagem);
  assert.match(r.mensagem, /Não contorne o bloqueio/);
};

// ───────────────────────── Parte 1: funções puras ─────────────────────────

test('v7 mcp: classifica — leitura, merge (fica com o v6), arquivo do GitHub, escrita aceita, proibida, arquivo local, outro', () => {
  const casos = {
    leitura: ['mcp__github__get_me', 'mcp__github__get_file_contents', 'mcp__github__list_pull_requests', 'mcp__github__search_code',
      'mcp__github__pull_request_read', 'mcp__github__issue_read', 'mcp__github__getPullRequest', 'mcp__github__download_workflow_run_artifact',
      'mcp__filesystem__read_file', 'mcp__github__list_branches', 'mcp__Claude_Docs__read',
      'mcp__github__actions_list', 'mcp__github__actions_get', 'mcp__github__projects_list', 'mcp__github__issueRead'],
    merge: ['mcp__github__merge_pull_request', 'mcp__github__enable_pr_auto_merge', 'mcp__github__merge_branch'],
    'github-arquivo': ['mcp__github__push_files', 'mcp__github__create_or_update_file', 'mcp__github__delete_file', 'mcp__github__pushFiles', 'mcp__plugin_github_github__create_or_update_file'],
    'github-escrita': ['mcp__github__create_pull_request', 'mcp__github__update_pull_request', 'mcp__github__update_pull_request_branch',
      'mcp__github__add_issue_comment', 'mcp__github__pull_request_review_write', 'mcp__github__add_comment_to_pending_review',
      'mcp__github__create_branch', 'mcp__github__issue_write', 'mcp__github__request_copilot_review'],
    'github-proibida': ['mcp__github__delete_branch', 'mcp__github__create_repository', 'mcp__github__fork_repository',
      'mcp__github__run_workflow', 'mcp__github__rerun_failed_jobs', 'mcp__github__create_release', 'mcp__github__update_ref',
      'mcp__github__set_secret', 'mcp__github__actions_run_trigger', 'mcp__github__projects_write', 'mcp__github__ferramenta_nova_qualquer'],
    'arquivo-local': [['mcp__filesystem__write_file', { path: 'x.ts', content: '' }], ['mcp__filesystem__edit_file', { path: '/repo/a.ts', edits: [] }],
      ['mcp__fs__move_file', { source: 'a', destination: 'b' }], ['mcp__editor__delete', { paths: ['a', 'b'] }]],
    outro: [['mcp__canva__create_design', { title: 'x' }], ['mcp__Claude_Docs__batch', { container: {} }], ['mcp__claude-code-remote__subscribe_pr_activity', {}],
      ['mcp__filesystem__write_file', {}]],
  };
  for (const [classe, lista] of Object.entries(casos))
    for (const c of lista) {
      const [f, e] = Array.isArray(c) ? c : [c, {}];
      assert.equal(classificarFerramentaMcp(f, e), classe, f);
    }
  for (const f of ['Bash', 'Write', '', 'mcp_github_x']) assert.equal(classificarFerramentaMcp(f), null, f);
  assert.equal(ehNomeDeLeitura('ListIssues'), true);
  assert.equal(ehNomeDeLeitura('getaway_write'), false, 'verbo só como palavra inteira');
});

test('v7 mcp: push_files do agente no branch da tarefa, nos próprios caminhos e com o trailer passa', () => {
  assert.equal(conferir().ok, true, conferir().mensagem);
  assert.equal(conferir({ ferramenta: 'mcp__github__create_or_update_file', entrada: { owner: 'aloirr', repo: 'macuxifdv', branch: 'nuvem/T-0099-x', path: 'modules/core/a.ts', content: 'x', message: msg(), sha: 'abc' } }).ok, true);
  assert.equal(conferir({ entrada: push({ owner: undefined, repo: 'Aloirr/MacuxiFDV', branch: 'refs/heads/nuvem/T-0099-x' }) }).ok, true);
  // recado novo do próprio agente, com o nome e o "de:" certos
  const recado = { path: '.coord/recados/gerente-projetos/R-20261108-120000-modulo-core.md', content: '---\nid: R-20261108-120000-modulo-core\nde: modulo-core\n---\nentrega' };
  assert.equal(conferir({ entrada: push({ files: [recado] }) }).ok, true);
  // o diário do próprio agente
  assert.equal(conferir({ entrada: push({ files: [{ path: '.coord/diario/modulo-core.md', content: 'x' }] }) }).ok, true);
  // subagente do time também grava (é o mesmo agente)
  assert.equal(conferir({ subagente: true }).ok, true);
});

test('v7 mcp: push_files — main, sem branch, outro repositório, caminho estranho e arquivo de outro dono são bloqueados', () => {
  bloqueia({ entrada: push({ branch: 'main' }) }, /nada vai direto ao main pelo MCP/);
  bloqueia({ entrada: push({ branch: 'refs/heads/MAIN' }) }, /nada vai direto ao main/);
  bloqueia({ entrada: push({ branch: undefined }) }, /falta o branch: sem ele o GitHub grava no branch padrão/);
  bloqueia({ entrada: push({ owner: 'outro', repo: 'repo' }) }, /só no repositório aloirr\/macuxifdv \(veio outro\/repo\)/);
  bloqueia({ entrada: push({ owner: undefined, repo: undefined }) }, /falta o repositório/);
  bloqueia({ entrada: push({ files: [] }) }, /nenhum arquivo na chamada/);
  bloqueia({ entrada: push({ files: [{ path: '../fora.ts', content: '' }] }) }, /caminho com "\.\."/);
  bloqueia({ entrada: push({ files: [{ path: 'modules/core/../vendedor/x.ts', content: '' }] }) }, /caminho com "\.\."/);
  bloqueia({ entrada: push({ files: [{ path: '/etc/passwd', content: '' }] }) }, /caminho absoluto/);
  bloqueia({ entrada: push({ files: [{ path: 'modules\\core\\x.ts', content: '' }] }) }, /caminho com "\\"/);
  bloqueia({ entrada: push({ files: [{ path: 'modules/core/a.ts', content: '' }, { path: 'modules/vendedor/api/x.ts', content: '' }] }) }, /"modules\/vendedor\/api\/x\.ts" pertence a modulo-vendedor/);
  bloqueia({ entrada: push({ files: [{ path: '.coord/diario/modulo-vendedor.md', content: '' }] }) }, /pertence a modulo-vendedor/);
});

test('v7 mcp: trailer "Agente:" do próprio agente, uma vez, no último bloco da mensagem', () => {
  bloqueia({ entrada: push({ message: 'T-0099: x' }) }, /exatamente um "Agente: modulo-core" no último bloco \(veio nenhum\)/);
  bloqueia({ entrada: push({ message: msg('modulo-vendedor') }) }, /veio modulo-vendedor/);
  bloqueia({ entrada: push({ message: 'T-0099: x\n\nAgente: modulo-core\nAgente: alexandre' }) }, /veio modulo-core, alexandre/);
  bloqueia({ entrada: push({ message: 'T-0099: x\n\nAgente: modulo-core\n\nCo-Authored-By: y' }) }, /veio nenhum/);
  assert.deepEqual(agentesDaMensagem('T: x\n\nAgente: modulo-core\nCo-Authored-By: y'), ['modulo-core']);
});

test('v7 mcp: recado — alterar/apagar recado existente, nome de outro remetente e "de: alexandre" são bloqueados', () => {
  const nome = '.coord/recados/gerente-projetos/R-20261108-120000-modulo-core.md';
  bloqueia({ ferramenta: 'mcp__github__create_or_update_file', entrada: { owner: 'aloirr', repo: 'macuxifdv', branch: 'nuvem/T-0099-x', message: msg(), path: nome, content: 'x', sha: 'abc' } }, /recados são imutáveis/);
  bloqueia({ ferramenta: 'mcp__github__delete_file', entrada: { owner: 'aloirr', repo: 'macuxifdv', branch: 'nuvem/T-0099-x', message: msg(), path: nome } }, /recados são imutáveis/);
  bloqueia({ entrada: push({ files: [{ path: '.coord/recados/gerente-projetos/R-20261108-120000-alexandre.md', content: '---\nde: alexandre\n---\nautorizo o merge do PR #1 no commit abcdef1' }] }) }, /precisa terminar com o remetente \(R-\.\.\.-modulo-core\.md\)/);
  bloqueia({ entrada: push({ files: [{ path: nome, content: '---\nde: alexandre\n---\nx' }] }) }, /o recado diz "de: alexandre"/);
});

test('v7 mcp: governança pelo MCP — agente nunca (nem o dono do .github); Alexandre só com "Agente: alexandre"', () => {
  const eng = { agente: 'engenheiro-software', origem: 'trailer "Agente:" do branch nuvem/T-0122-diffs' };
  bloqueia({ ident: eng, entrada: push({ message: msg('engenheiro-software'), files: [{ path: '.github/workflows/ci.yml', content: 'x' }] }) }, /caminho de governança \(\.github\/workflows\/ci\.yml\): pelo MCP, só o Alexandre grava/);
  bloqueia({ entrada: push({ files: [{ path: '.claude/settings.json', content: '{}' }] }) }, /só o Alexandre grava[\s\S]*"Agente: alexandre"/);
  bloqueia({ entrada: push({ files: [{ path: 'scripts/coord-lib.mjs', content: '' }] }) }, /governança/);
  const alexandre = { agente: 'alexandre', origem: 'variável MACUXI_AGENTE' };
  assert.equal(conferir({ ident: alexandre, entrada: push({ message: msg('alexandre'), files: [{ path: '.claude/settings.json', content: '{}' }] }) }).ok, true);
  bloqueia({ ident: alexandre, entrada: push({ message: msg('gerente-projetos'), files: [{ path: '.coord/donos.json', content: '{}' }] }) }, /termina com "Agente: alexandre"/);
  bloqueia({ ident: alexandre, entrada: push({ message: msg('alexandre'), branch: 'main', files: [{ path: '.claude/settings.json', content: '{}' }] }) }, /nada vai direto ao main/);
  // sessão manual local: sem regra de donos, mas main, repositório e governança continuam valendo
  const manual = { agente: '', origem: 'sessão manual local' };
  assert.equal(conferir({ ident: manual, entrada: push({ message: 'x', files: [{ path: 'modules/vendedor/x.ts', content: '' }] }) }).ok, true);
  bloqueia({ ident: manual, entrada: push({ branch: 'main' }) }, /nada vai direto ao main/);
  bloqueia({ ident: manual, entrada: push({ message: 'x', files: [{ path: '.github/workflows/ci.yml', content: '' }] }) }, /termina com "Agente: alexandre"/);
});

test('v7 mcp: identidade — subagente fora do time e sessão da nuvem sem agente não gravam', () => {
  bloqueia({ subagente: true, ident: { agente: 'general-purpose', origem: 'subagente (agent_type)' } }, /subagente "general-purpose" não é do time/);
  bloqueia({ ident: { agente: 'subagente-sem-agente', origem: 'subagente sem agent_type (restrito)' }, subagente: true }, /não é do time/);
  bloqueia({ ident: { agente: 'sessao-sem-agente', origem: 'sessão da nuvem sem agente (restrita)' } }, /não tem agente do time identificado/);
});

test('v7 mcp: escrita aceita do GitHub só no repositório oficial; escrita fora da lista é bloqueada; leitura e outro servidor passam', () => {
  assert.equal(conferir({ ferramenta: 'mcp__github__create_pull_request', entrada: { owner: 'aloirr', repo: 'macuxifdv', head: 'nuvem/T-0099-x', base: 'main', title: 'x' } }).ok, true);
  assert.equal(conferir({ ferramenta: 'mcp__github__add_issue_comment', entrada: { owner: 'aloirr', repo: 'macuxifdv', issue_number: 1, body: 'x' } }).ok, true);
  assert.equal(conferir({ ferramenta: 'mcp__github__create_branch', entrada: { owner: 'aloirr', repo: 'macuxifdv', branch: 'nuvem/T-0099-y', from_branch: 'main' } }).ok, true);
  bloqueia({ ferramenta: 'mcp__github__create_pull_request', entrada: { owner: 'outro', repo: 'repo', head: 'x', base: 'main' } }, /escrita só no repositório aloirr\/macuxifdv \(veio outro\/repo\)/);
  bloqueia({ ferramenta: 'mcp__github__create_branch', entrada: { owner: 'aloirr', repo: 'macuxifdv', branch: 'main' } }, /não é recriado/);
  for (const f of ['mcp__github__delete_branch', 'mcp__github__run_workflow', 'mcp__github__create_repository', 'mcp__github__ferramenta_nova'])
    bloqueia({ ferramenta: f, entrada: { owner: 'aloirr', repo: 'macuxifdv' }, ident: { agente: 'alexandre', origem: 'variável MACUXI_AGENTE' } }, /não está entre as escritas aceitas pelo MCP do GitHub/);
  for (const f of ['mcp__github__get_file_contents', 'mcp__github__list_commits', 'mcp__canva__create_design', 'mcp__github__merge_pull_request'])
    assert.equal(conferir({ ferramenta: f, entrada: { owner: 'outro', repo: 'x' } }).ok, true, f);
});

test('v7 mcp: servidor de arquivos local segue os donos (como o guarda-donos) e as pastas somente leitura', () => {
  const W = 'mcp__filesystem__write_file';
  assert.equal(conferir({ ferramenta: W, entrada: { path: '/repo/modules/core/a.ts', content: '' } }).ok, true);
  bloqueia({ ferramenta: W, entrada: { path: '/repo/modules/vendedor/a.ts', content: '' } }, /pertence a modulo-vendedor/);
  bloqueia({ ferramenta: 'mcp__filesystem__move_file', entrada: { source: '/repo/modules/core/a.ts', destination: '/repo/.claude/hooks/x.mjs' } }, /\.claude\/hooks\/x\.mjs" pertence a alexandre/);
  bloqueia({ ferramenta: W, entrada: { path: '/repo/.coord/recados/alexandre/R-1-modulo-core.md', content: '---\nde: alexandre\n---\n' } }, /de: alexandre/);
  bloqueia({ ferramenta: W, entrada: { path: '/fase-m/planilha.xlsx', content: '' }, somenteLeitura: ['/fase-m'] }, /pasta somente leitura \(\/fase-m\)/);
  assert.equal(conferir({ ferramenta: W, entrada: { path: '/tmp/x.txt', content: '' } }).ok, true, 'fora do repositório e fora das pastas somente leitura');
  assert.equal(conferir({ ferramenta: W, entrada: { path: '/repo/modules/vendedor/a.ts' }, ident: { agente: '', origem: 'sessão manual local' } }).ok, true, 'sessão manual local');
  bloqueia({ ferramenta: W, entrada: { path: '/repo/modules/core/a.ts' }, ident: { agente: 'sessao-sem-agente', origem: 'x' } }, /não faz parte do time/);
  // ADR 0035: o clone de recados por fora da junção segue as regras de .coord/recados; o resto do clone é bloqueado
  assert.equal(conferir({ ferramenta: W, entrada: { path: '/clone/recados/gerente-projetos/R-20261108-1-modulo-core.md', content: '---\nde: modulo-core\n---\n' } }).ok, true);
  bloqueia({ ferramenta: W, entrada: { path: '/clone/recados/gerente-projetos/R-20261108-1-alexandre.md', content: '---\nde: alexandre\n---\n' } }, /terminar com o remetente/);
  bloqueia({ ferramenta: W, entrada: { path: '/clone/.git/config', content: '' } }, /"\/clone\/\.git\/config": o clone do repositório de recados só muda pelo coord\.mjs/);
});

test('v7 mcp: funções auxiliares — caminhoRemoto e arquivosDaEntrada', () => {
  assert.deepEqual(caminhoRemoto('./modules/core/x.ts'), { rel: 'modules/core/x.ts' });
  assert.match(caminhoRemoto('a//b').erro, /"\/\/"/);
  assert.match(caminhoRemoto('C:/x').erro, /absoluto/);
  assert.match(caminhoRemoto('').erro, /sem caminho/);
  assert.deepEqual(arquivosDaEntrada('deletefile', { path: 'a' }), [{ caminho: 'a', conteudo: undefined, apaga: true, atualiza: false }]);
  assert.deepEqual(arquivosDaEntrada('pushfiles', { files: [{ path: 'a', content: 'x' }] }), [{ caminho: 'a', conteudo: 'x', apaga: false, atualiza: false }]);
});

// ───────────────────────── Parte 2: o hook de verdade ─────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function escrever(dir, r, conteudo) {
  mkdirSync(dirname(join(dir, r)), { recursive: true });
  writeFileSync(join(dir, r), conteudo);
}
/** Repositório com o hook e um branch nuvem/T-0099-x de commits com o trailer "Agente: modulo-core". */
function criarRepo({ donos } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-mcp-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.claude/settings.json', JSON.stringify({ agent: 'gerente-projetos' }, null, 2));
  escrever(dir, '.coord/donos.json', donos ?? JSON.stringify({ versao: 1, regras: [{ padrao: '.claude/**', dono: 'alexandre' }, { padrao: 'modules/core/**', dono: 'modulo-core' }, { padrao: '**', dono: 'engenheiro-software' }], somente_leitura: [] }));
  escrever(dir, '.coord/recados/gerente-projetos/R-20261101-000000-modulo-core.md', '---\nid: R-20261101-000000-modulo-core\nde: modulo-core\n---\n');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(join(RAIZ_REAL, 'scripts', 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  for (const f of ['guarda-mcp.mjs', 'guarda-mcp-lib.mjs', 'guarda-merge-lib.mjs', 'guarda-bash-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial\n\nAgente: gerente-projetos');
  git(dir, 'checkout', '-q', '-b', 'nuvem/T-0099-x');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'T-0099: início\n\nAgente: modulo-core');
  return dir;
}
function hook(dir, { ferramenta = PUSH, entrada = push(), json = {}, env = {}, bruto } = {}) {
  const base = { ...process.env };
  for (const k of ['MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GH_SIMULADO', 'MACUXI_GUARDA']) delete base[k];
  const dados = { session_id: 's-mcp7', hook_event_name: 'PreToolUse', tool_name: ferramenta, tool_input: entrada, cwd: dir, agent_type: 'gerente-projetos', ...json };
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'guarda-mcp.mjs')], {
    cwd: dir, input: bruto ?? JSON.stringify(dados), encoding: 'utf8', env: { ...base, CLAUDE_CODE_REMOTE: 'true', ...env },
  });
  return { codigo: r.status, erro: r.stderr };
}

test('hook v7 mcp: nuvem do modulo-core — push nos próprios caminhos passa; main, outro dono e governança bloqueiam', () => {
  const dir = criarRepo();
  const ok = hook(dir);
  assert.equal(ok.codigo, 0, ok.erro);
  const main = hook(dir, { entrada: push({ branch: 'main' }) });
  assert.equal(main.codigo, 2);
  assert.match(main.erro, /BLOQUEADO \(ferramenta MCP\): mcp__github__push_files[\s\S]*nada vai direto ao main/);
  const outro = hook(dir, { entrada: push({ files: [{ path: 'apps/api/src/app.ts', content: '' }] }) });
  assert.equal(outro.codigo, 2);
  assert.match(outro.erro, /"apps\/api\/src\/app\.ts" pertence a engenheiro-software/);
  const gov = hook(dir, { entrada: push({ files: [{ path: '.claude/hooks/guarda-mcp.mjs', content: '' }] }) });
  assert.equal(gov.codigo, 2);
  assert.match(gov.erro, /caminho de governança/);
  // recado existente no disco = imutável (o hook usa o repositório local como referência)
  const rec = hook(dir, { ferramenta: 'mcp__github__create_or_update_file', entrada: { owner: 'aloirr', repo: 'macuxifdv', branch: 'nuvem/T-0099-x', message: msg(), path: '.coord/recados/gerente-projetos/R-20261101-000000-modulo-core.md', content: 'x' } });
  assert.equal(rec.codigo, 2);
  assert.match(rec.erro, /recados são imutáveis/);
});

test('hook v7 mcp: leitura e outro servidor passam sem ler o donos.json; erro, entrada ilegível e subagente fora do time bloqueiam; MACUXI_GUARDA=off desliga', () => {
  const quebrado = criarRepo({ donos: '{ isto não é json' });
  assert.equal(hook(quebrado, { ferramenta: 'mcp__github__get_file_contents', entrada: { owner: 'aloirr', repo: 'macuxifdv', path: 'x' } }).codigo, 0, 'leitura passa antes de tudo');
  assert.equal(hook(quebrado, { ferramenta: 'mcp__canva__create_design', entrada: {} }).codigo, 0);
  assert.equal(hook(quebrado, { ferramenta: 'mcp__github__merge_pull_request', entrada: {} }).codigo, 0, 'merge fica com o guarda-merge-mcp');
  const erro = hook(quebrado);
  assert.equal(erro.codigo, 2);
  assert.match(erro.erro, /erro no guardião .*falha fechada/);
  const dir = criarRepo();
  assert.equal(hook(dir, { bruto: '{isto não é json' }).codigo, 2, 'entrada ilegível');
  const sub = hook(dir, { json: { agent_id: 'sub-1', agent_type: 'general-purpose' } });
  assert.equal(sub.codigo, 2);
  assert.match(sub.erro, /subagente "general-purpose" não é do time/);
  assert.equal(hook(dir, { json: { agent_id: 'sub-1', agent_type: 'modulo-core' } }).codigo, 0, 'subagente do time');
  assert.equal(hook(dir, { entrada: push({ branch: 'main' }), env: { MACUXI_GUARDA: 'off' } }).codigo, 0);
  assert.equal(hook(dir, { ferramenta: 'Bash', entrada: { command: 'ls' } }).codigo, 0, 'não é MCP');
});

// ───────────────────────── Parte 3: settings.json ─────────────────────────

test('settings.json v7: o PreToolUse roda o guarda-mcp em TODA ferramenta MCP (e o guarda-merge-mcp continua nas de merge)', () => {
  const s = JSON.parse(readFileSync(join(RAIZ_REAL, '.claude', 'settings.json'), 'utf8'));
  const blocos = s.hooks.PreToolUse.filter((b) => b.hooks.some((h) => h.command === 'node .claude/hooks/guarda-mcp.mjs'));
  assert.equal(blocos.length, 1);
  const re = new RegExp(`^(?:${blocos[0].matcher})$`);
  for (const f of ['mcp__github__push_files', 'mcp__github__create_or_update_file', 'mcp__github__merge_pull_request', 'mcp__filesystem__write_file', 'mcp__plugin_github_github__delete_file'])
    assert.ok(re.test(f), f);
  for (const f of ['Bash', 'Write', 'Edit', 'Read']) assert.equal(re.test(f), false, f);
  assert.equal(s.hooks.PreToolUse.filter((b) => b.hooks.some((h) => h.command === 'node .claude/hooks/guarda-merge-mcp.mjs')).length, 1);
});
