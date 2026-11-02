// Testes do guardião v6 (T-0050), item 2: merge de PR pela ferramenta MCP do GitHub (node:test, sem dependências).
// Rodar: node --test .claude/hooks/guarda-merge-mcp.test.mjs
// Parte 1: funções puras (guarda-merge-lib.mjs) com a consulta ao GitHub injetada.
// Parte 2: consultarPrRest com o gh SIMULADO (MACUXI_GH_SIMULADO = script node no lugar do gh).
// Parte 3: o hook de verdade (guarda-merge-mcp.mjs, stdin → exit code) num repositório git temporário.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  conferirMergeMcp, tipoFerramentaMerge, validarEntradaMergeMcp, motivoIdentidadeMcp, avaliarChecks, consultarPrRest,
  ultimoBlocoDaMensagem, REPO_OFICIAL,
} from './guarda-merge-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OUTRO = 'ffffeeeeddddccccbbbbaaaa9999888877776666';
const FERRAMENTA = 'mcp__github__merge_pull_request';
const VERDE = { verde: true, detalhe: '9 check(s) verdes' };
const COMUM = { ok: true, headRefOid: HEAD, arquivos: ['modules/core/domain/x.ts', 'docs/produto/07.md'], total: 2, estado: 'open', mesclado: false, ciPr: VERDE, ciMain: VERDE };
const GOV = { ...COMUM, arquivos: ['modules/core/domain/x.ts', '.claude/hooks/guarda-bash.mjs', '.github/workflows/ci.yml'], total: 3 };
/** Sessão da nuvem de um agente de módulo (branch nuvem/* + trailer "Agente: modulo-core"). */
const NUVEM_CORE = { agente: 'modulo-core', origem: 'trailer "Agente:" do branch nuvem/T-0099-x', nuvem: true };
const GERENTE_LOCAL = { agente: 'gerente-projetos', origem: 'sessão local (agent_type)', nuvem: false };

const mensagem = (agente = 'modulo-core', sha = HEAD) => `Resumo do PR.\n\nHead-SHA: ${sha}\nAgente: ${agente}`;
const entradaOk = (o = {}) => ({ owner: 'aloirr', repo: 'macuxifdv', pullNumber: 40, merge_method: 'squash', commit_title: 'T-0099: x (#40)', commit_message: mensagem(), ...o });
const recado = (id, corpo, de = 'alexandre') => ({ nome: `${id}.md`, texto: `---\nid: ${id}\nde: ${de}\npara: [gerente-projetos]\ntipo: aviso\n---\n${corpo}\n` });
const AUTORIZA_40 = recado('R-20261102-120000-alexandre', `Conferi. Autorizo o merge do PR #40 no commit ${HEAD}.`);

const conferir = ({ entrada = entradaOk(), ident = NUVEM_CORE, consulta = COMUM, recados = [], ferramenta = FERRAMENTA, subagente = false } = {}) => {
  const chamadas = [];
  const r = conferirMergeMcp({ ferramenta, entrada, ...ident, subagente, consultarPr: (pr) => { chamadas.push(pr); return consulta; }, lerRecados: () => recados });
  return { ...r, chamadas };
};

// ───────────────────────── Parte 1: funções puras ─────────────────────────

test('v6 mcp: reconhece a ferramenta de merge e as variações de nome; o resto não é merge', () => {
  for (const f of ['mcp__github__merge_pull_request', 'mcp__github__mergePullRequest', 'mcp__plugin_github_github__merge_pull_request', 'mcp__github-enterprise__merge_pr', 'mcp__gh__merge_pull_request', 'mcp__outro__merge_pull_request'])
    assert.equal(tipoFerramentaMerge(f), 'merge-pr', f);
  assert.equal(tipoFerramentaMerge('mcp__github__enable_pr_auto_merge'), 'auto-merge');
  assert.equal(tipoFerramentaMerge('mcp__github__enable_auto_merge'), 'auto-merge');
  assert.equal(tipoFerramentaMerge('mcp__github__merge_branch'), 'outro-merge');
  for (const f of ['mcp__github__create_pull_request', 'mcp__github__update_pull_request_branch', 'mcp__github__get_pull_request', 'mcp__github__list_merge_queue', 'mcp__canva__merge_designs', 'Bash', 'Write', ''])
    assert.equal(tipoFerramentaMerge(f), null, f);
});

test('v6 mcp: PR comum de sessão da nuvem com CI do PR e do main verdes passa; consulta o GitHub uma vez', () => {
  const r = conferir();
  assert.equal(r.ok, true, r.mensagem);
  assert.deepEqual(r.chamadas, [40]);
  assert.deepEqual(r.governanca, []);
  // variações aceitas: repo "owner/nome", pullNumber em texto, sha num campo próprio (igual ao Head-SHA)
  assert.equal(conferir({ entrada: entradaOk({ owner: undefined, repo: 'Aloirr/MacuxiFDV', pullNumber: '40', sha: HEAD }) }).ok, true);
  assert.equal(conferir({ entrada: entradaOk({ commit_message: 'Resumo.\n\nAgente: modulo-core', sha: HEAD }) }).ok, true, 'sha só no campo');
  // o gerente local e o agente local também fazem o merge de PR comum
  assert.equal(conferir({ ident: GERENTE_LOCAL }).ok, true);
  assert.equal(conferir({ ident: { agente: 'engenheiro-software', origem: 'variável MACUXI_AGENTE', nuvem: false } }).ok, true);
});

test('v6 mcp: identidade — subagente, alexandre, sessão sem agente e identidade restrita/ambígua são bloqueados sem consultar', () => {
  const casos = [
    [{ ident: NUVEM_CORE, subagente: true }, /subagente \(modulo-core\) nunca faz merge/],
    [{ ident: { agente: 'alexandre', origem: 'variável MACUXI_AGENTE', nuvem: true } }, /sessão do Alexandre pelo Claude não faz merge/],
    [{ ident: { agente: '', origem: 'sessão manual local' } }, /sessão sem agente/],
    [{ ident: { agente: 'sessao-sem-agente', origem: 'sessão da nuvem sem agente (restrita)', nuvem: true } }, /não tem agente do time identificado/],
    [{ ident: { agente: 'gerente-projetos', origem: 'sessão da nuvem sem agente (restrita)', nuvem: true } }, /não vale para merge/],
    [{ ident: { agente: 'modulo-core', origem: 'agent_type (fonte ausente ou ambígua)', nuvem: true } }, /não vale para merge/],
  ];
  for (const [o, re] of casos) {
    const r = conferir(o);
    assert.equal(r.ok, false, JSON.stringify(o));
    assert.match(r.mensagem, re);
    assert.match(r.mensagem, /^\[guardião Macuxi\] BLOQUEADO \(merge pelo MCP do GitHub\):/);
    assert.deepEqual(r.chamadas, [], 'não gasta a consulta');
  }
  assert.equal(motivoIdentidadeMcp({ agente: 'modulo-core', origem: 'branch modulo-core/T-0099-x' }), null);
});

test('v6 mcp: parâmetros — só squash, SHA de 40 do head, Agente: no último bloco, repositório oficial, nada além', () => {
  const casos = [
    [{ merge_method: undefined }, /falta merge_method: "squash"/],
    [{ merge_method: 'merge' }, /merge_method "merge" é proibido/],
    [{ merge_method: 'rebase' }, /merge_method "rebase" é proibido/],
    [{ commit_message: 'Resumo.\n\nAgente: modulo-core' }, /falta o SHA esperado do head/],
    [{ commit_message: mensagem('modulo-core', HEAD.slice(0, 7)) }, /não tem 40 caracteres/],
    [{ sha: OUTRO }, /SHA esperado repetido com valores diferentes/],
    [{ commit_message: `Head-SHA: ${HEAD}` }, /exatamente um "Agente: <nome>" no último bloco \(veio 0\)/],
    [{ commit_message: undefined, sha: HEAD }, /falta commit_message com o trailer "Agente:/],
    [{ commit_message: `x\n\nHead-SHA: ${HEAD}\nAgente: modulo-core\nAgente: alexandre` }, /exatamente um "Agente:/],
    [{ commit_message: mensagem('fulano') }, /"Agente: fulano" não é do time/],
    [{ owner: 'outro' }, /só no repositório aloirr\/macuxifdv \(veio outro\/macuxifdv\)/],
    [{ owner: undefined, repo: undefined }, /falta o repositório/],
    [{ pullNumber: undefined }, /falta o número do PR/],
    [{ pullNumber: 'nuvem/T-0099-x' }, /o PR tem de ser o número/],
    [{ admin: true }, /parâmetro\(s\) não aceito\(s\) no merge: admin/],
    [{ pullNumber: 40, pull_number: 41 }, /pullNumber e pull_number com valores diferentes/],
    [{ commit_title: 'x\n\nAgente: alexandre' }, /commit_title com quebra de linha/],
  ];
  for (const [o, re] of casos) {
    const r = conferir({ entrada: entradaOk(o) });
    assert.equal(r.ok, false, JSON.stringify(o));
    assert.match(r.mensagem, re, JSON.stringify(o));
    assert.deepEqual(r.chamadas, [], `não consulta: ${JSON.stringify(o)}`);
  }
  const auto = conferir({ ferramenta: 'mcp__github__enable_pr_auto_merge' });
  assert.match(auto.mensagem, /auto-merge\) é proibido/);
  assert.match(conferir({ ferramenta: 'mcp__github__merge_branch' }).mensagem, /não é merge de PR/);
  assert.deepEqual(ultimoBlocoDaMensagem('só o assunto'), []);
  assert.equal(validarEntradaMergeMcp(entradaOk()).agenteDoCommit, 'modulo-core');
});

test('v6 mcp: SHA divergente do head, PR fechado, CI do PR vermelho/rodando e CI do main vermelho bloqueiam', () => {
  const div = conferir({ entrada: entradaOk({ commit_message: mensagem('modulo-core', OUTRO) }) });
  assert.equal(div.ok, false);
  assert.match(div.mensagem, /o head do PR #40 é a1b2c3d4.* e o SHA esperado é ffffeeee.*o PR mudou depois da conferência/);
  assert.match(conferir({ consulta: { ...COMUM, estado: 'closed' } }).mensagem, /o PR #40 não está aberto \(estado: closed\)/);
  assert.match(conferir({ consulta: { ...COMUM, mesclado: true, estado: 'closed' } }).mensagem, /já mesclado/);
  const ciPr = conferir({ consulta: { ...COMUM, ciPr: avaliarChecks({ total_count: 2, check_runs: [{ name: 'lint', status: 'completed', conclusion: 'failure' }, { name: 'ci-ok', status: 'completed', conclusion: 'success' }] }) } });
  assert.equal(ciPr.ok, false);
  assert.match(ciPr.mensagem, /o CI do PR #40 \(head a1b2c3d4e5f6\) não está verde: vermelho \(lint: failure\)/);
  const rodando = conferir({ consulta: { ...COMUM, ciPr: avaliarChecks({ total_count: 1, check_runs: [{ name: 'testes', status: 'in_progress', conclusion: null }] }) } });
  assert.match(rodando.mensagem, /ainda rodando \(testes\)/);
  const main = conferir({ consulta: { ...COMUM, ciMain: avaliarChecks({ total_count: 1, check_runs: [{ name: 'testes', status: 'completed', conclusion: 'cancelled' }] }) } });
  assert.equal(main.ok, false);
  assert.match(main.mensagem, /o CI do main não está verde: vermelho \(testes: cancelled\).*Main vermelho = nenhum merge/);
});

test('v6 mcp: sem gh/rede para conferir = bloqueia (falha fechada), inclusive lista de arquivos incompleta', () => {
  const fora = conferir({ consulta: { ok: false, erro: 'gh api repos/aloirr/macuxifdv/pulls/40 falhou: error connecting to api.github.com' } });
  assert.equal(fora.ok, false);
  assert.match(fora.mensagem, /não deu para conferir o PR #40 no GitHub \(gh api .* error connecting.*falha fechada/);
  assert.equal(conferir({ consulta: null }).ok, false, "consulta vazia");
  assert.equal(conferirMergeMcp({ ferramenta: FERRAMENTA, entrada: entradaOk(), ...NUVEM_CORE, consultarPr: () => { throw new Error('gh não encontrado'); } }).ok, false);
  assert.equal(conferirMergeMcp({ ferramenta: FERRAMENTA, entrada: entradaOk(), ...NUVEM_CORE }).ok, false, 'sem função de consulta');
  assert.match(conferir({ consulta: { ...COMUM, total: 5 } }).mensagem, /devolveu 2 de 5 arquivos/);
  // avaliarChecks: sem checks, lista incompleta, resposta estranha
  assert.equal(avaliarChecks({ total_count: 0, check_runs: [] }).verde, false);
  assert.match(avaliarChecks({ total_count: 150, check_runs: [{ name: 'a', status: 'completed', conclusion: 'success' }] }).detalhe, /1 de 150/);
  assert.equal(avaliarChecks({ check_runs: [{ name: 'a', status: 'completed', conclusion: 'success' }] }).verde, false, 'sem total_count');
  assert.equal(avaliarChecks(null).verde, false);
  assert.equal(avaliarChecks({ total_count: 2, check_runs: [{ name: 'a', status: 'completed', conclusion: 'skipped' }, { name: 'b', status: 'completed', conclusion: 'neutral' }] }).verde, true);
});

test('v6 mcp: PR de governança — nuvem nunca; local só o gerente com o recado do Alexandre (mesmo N e SHA) e Agente: alexandre', () => {
  // nuvem: bloqueado mesmo com autorização
  const nuvem = conferir({ consulta: GOV, recados: [AUTORIZA_40] });
  assert.equal(nuvem.ok, false);
  assert.match(nuvem.mensagem, /altera caminho de governança \(\.claude\/hooks\/guarda-bash\.mjs, \.github\/workflows\/ci\.yml\): sessão da nuvem não faz esse merge/);
  assert.deepEqual(nuvem.governanca, ['.claude/hooks/guarda-bash.mjs', '.github/workflows/ci.yml']);
  const gerenteNuvem = conferir({ consulta: GOV, recados: [AUTORIZA_40], ident: { agente: 'gerente-projetos', origem: 'variável MACUXI_AGENTE', nuvem: true }, entrada: entradaOk({ commit_message: mensagem('alexandre') }) });
  assert.match(gerenteNuvem.mensagem, /sessão da nuvem não faz esse merge/);
  // local, gerente, sem autorização
  const gEntrada = entradaOk({ commit_message: mensagem('alexandre') });
  const sem = conferir({ consulta: GOV, ident: GERENTE_LOCAL, entrada: gEntrada });
  assert.equal(sem.ok, false);
  assert.match(sem.mensagem, /não há recado do Alexandre \(de: alexandre, em \.coord\/recados\/gerente-projetos\) com "autorizo o merge do PR #40 no commit a1b2c3d4/);
  // local, gerente, com a autorização certa → passa
  const com = conferir({ consulta: GOV, ident: GERENTE_LOCAL, entrada: gEntrada, recados: [AUTORIZA_40] });
  assert.equal(com.ok, true, com.mensagem);
  assert.equal(com.autorizacao, 'R-20261102-120000-alexandre');
  // autorização de outro PR ou de outro commit não vale
  assert.equal(conferir({ consulta: GOV, ident: GERENTE_LOCAL, entrada: gEntrada, recados: [recado('R-20261102-120001-alexandre', `autorizo o merge do PR #4 no commit ${HEAD}`)] }).ok, false);
  const velha = conferir({ consulta: GOV, ident: GERENTE_LOCAL, entrada: gEntrada, recados: [recado('R-20261102-120002-alexandre', `autorizo o merge do PR #40 no commit ${OUTRO}`)] });
  assert.match(velha.mensagem, /mas no commit ffffeeee.*NÃO faça o merge/);
  // recado falso (nome de outro remetente, ou de: de outro) não autoriza
  assert.equal(conferir({ consulta: GOV, ident: GERENTE_LOCAL, entrada: gEntrada, recados: [recado('R-20261102-120003-gerente-projetos', `Autorizo o merge do PR #40 no commit ${HEAD}`)] }).ok, false);
  assert.equal(conferir({ consulta: GOV, ident: GERENTE_LOCAL, entrada: gEntrada, recados: [recado('R-20261102-120004-alexandre', `Autorizo o merge do PR #40 no commit ${HEAD}`, 'gerente-projetos')] }).ok, false);
  // com autorização, mas trailer de outro agente no squash (CI da T-0049 deixaria o main vermelho)
  assert.match(conferir({ consulta: GOV, ident: GERENTE_LOCAL, recados: [AUTORIZA_40] }).mensagem, /termina com "Agente: alexandre"/);
  // com autorização, mas outro agente local, ou o gerente identificado só pelo branch/trailer
  assert.match(conferir({ consulta: GOV, ident: { agente: 'modulo-core', origem: 'sessão local (agent_type)' }, entrada: gEntrada, recados: [AUTORIZA_40] }).mensagem, /só o gerente-projetos na sessão local/);
  assert.match(conferir({ consulta: GOV, ident: { agente: 'gerente-projetos', origem: 'branch gerente-projetos/T-0099-x' }, entrada: gEntrada, recados: [AUTORIZA_40] }).mensagem, /só o gerente-projetos na sessão local/);
  // com autorização, mas CI vermelho: não passa
  assert.equal(conferir({ consulta: { ...GOV, ciMain: { verde: false, detalhe: 'vermelho' } }, ident: GERENTE_LOCAL, entrada: gEntrada, recados: [AUTORIZA_40] }).ok, false);
  // arquivo renomeado PARA fora da governança conta pelo caminho antigo (consultarPrRest inclui previous_filename)
  assert.equal(conferir({ consulta: { ...COMUM, arquivos: ['docs/x.mjs', 'scripts/coord-lib.mjs'], total: 1 } }).ok, false);
});

// ───────────────────────── Parte 2: consultarPrRest com gh simulado ─────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

/** gh simulado (API REST): responde `gh api <caminho>` por um mapa JSON; ou falha/lixo/lentidão conforme GH_SIMULADO_MODO. */
const GH_FALSO = `import { readFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.GH_SIMULADO_LOG) appendFileSync(process.env.GH_SIMULADO_LOG, args.join(' ') + '\\n');
const modo = process.env.GH_SIMULADO_MODO || 'ok';
if (modo === 'fora') { process.stderr.write('error connecting to api.github.com\\n'); process.exit(1); }
if (modo === 'lixo') { process.stdout.write('<html>erro</html>'); process.exit(0); }
if (modo === 'lento') { setTimeout(() => {}, 60000); }
else {
  if (args.length !== 2 || args[0] !== 'api') { process.stderr.write('argumentos inesperados: ' + args.join(' ') + '\\n'); process.exit(1); }
  const respostas = JSON.parse(readFileSync(process.env.GH_SIMULADO_API, 'utf8'));
  if (!(args[1] in respostas)) { process.stderr.write('HTTP 404: Not Found (' + args[1] + ')\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(respostas[args[1]]));
}
`;
const R = `repos/${REPO_OFICIAL}`;
const runs = (...lista) => ({ total_count: lista.length, check_runs: lista.map(([name, conclusion, status = 'completed']) => ({ name, status, conclusion })) });
const VERDES = runs(['lint', 'success'], ['testes', 'success'], ['ci-ok', 'success'], ['build', 'skipped']);

/** Respostas da API para um PR: {pr, head, arquivos: [nome | {filename, previous_filename}], ...}. Pagina de 100 em 100. */
function respostasDoPr({ pr = 40, head = HEAD, arquivos = ['modules/core/domain/x.ts'], estado = 'open', mesclado = false, ciPr = VERDES, ciMain = VERDES, total } = {}) {
  const lista = arquivos.map((a) => (typeof a === 'string' ? { filename: a, status: 'modified' } : a));
  const r = { [`${R}/pulls/${pr}`]: { number: pr, state: estado, merged: mesclado, head: { sha: head }, base: { ref: 'main' }, changed_files: total ?? lista.length } };
  for (let p = 1; p === 1 || (p - 1) * 100 < lista.length; p++) r[`${R}/pulls/${pr}/files?per_page=100&page=${p}`] = lista.slice((p - 1) * 100, p * 100);
  if (lista.length && lista.length % 100 === 0) r[`${R}/pulls/${pr}/files?per_page=100&page=${lista.length / 100 + 1}`] = [];
  r[`${R}/commits/${head}/check-runs?per_page=100`] = ciPr;
  r[`${R}/commits/main/check-runs?per_page=100`] = ciMain;
  return r;
}

function ghFalso(respostas) {
  const fora = mkdtempSync(join(tmpdir(), 'guarda-merge-mcp-gh-'));
  temporarios.push(fora);
  writeFileSync(join(fora, 'gh.mjs'), GH_FALSO);
  writeFileSync(join(fora, 'api.json'), JSON.stringify(respostas));
  return { gh: join(fora, 'gh.mjs'), api: join(fora, 'api.json'), log: join(fora, 'chamadas.log') };
}
const envGh = (g, modo = 'ok') => ({ PATH: process.env.PATH, MACUXI_GH_SIMULADO: g.gh, GH_SIMULADO_API: g.api, GH_SIMULADO_LOG: g.log, GH_SIMULADO_MODO: modo });
const chamadasGh = (g) => (existsSync(g.log) ? readFileSync(g.log, 'utf8').trim().split('\n').filter(Boolean) : []);

test('v6 mcp: consultarPrRest lê PR, arquivos (paginados, com o nome antigo dos renomeados) e os check-runs do PR e do main', () => {
  const arquivos = [...Array.from({ length: 149 }, (_, i) => `modules/core/a${i}.ts`), { filename: 'docs/coord.mjs', previous_filename: 'scripts/coord.mjs', status: 'renamed' }];
  const g = ghFalso(respostasDoPr({ arquivos }));
  const c = consultarPrRest(40, { env: envGh(g) });
  assert.equal(c.ok, true, c.erro);
  assert.equal(c.headRefOid, HEAD);
  assert.equal(c.total, 150);
  assert.equal(c.arquivos.length, 151);
  assert.ok(c.arquivos.includes('scripts/coord.mjs'), 'caminho antigo do renomeado');
  assert.equal(c.estado, 'open');
  assert.deepEqual([c.ciPr.verde, c.ciMain.verde], [true, true]);
  assert.deepEqual(chamadasGh(g), [
    `api ${R}/pulls/40`,
    `api ${R}/pulls/40/files?per_page=100&page=1`,
    `api ${R}/pulls/40/files?per_page=100&page=2`,
    `api ${R}/commits/${HEAD}/check-runs?per_page=100`,
    `api ${R}/commits/main/check-runs?per_page=100`,
  ]);
  const r = conferirMergeMcp({ ferramenta: FERRAMENTA, entrada: entradaOk(), ...NUVEM_CORE, consultarPr: () => c });
  assert.match(r.mensagem, /altera caminho de governança \(scripts\/coord\.mjs\)/, 'renomear arquivo de governança para fora continua sendo governança');
});

test('v6 mcp: consultarPrRest — gh fora do ar, resposta que não é JSON, PR inexistente e lentidão = falha fechada', () => {
  const g = ghFalso(respostasDoPr());
  assert.match(consultarPrRest(40, { env: envGh(g, 'fora') }).erro, /falhou: error connecting to api\.github\.com/);
  assert.match(consultarPrRest(40, { env: envGh(g, 'lixo') }).erro, /não é JSON/);
  assert.match(consultarPrRest(41, { env: envGh(g) }).erro, /HTTP 404/);
  assert.match(consultarPrRest(40, { env: envGh(g, 'lento'), timeout: 400 }).erro, /não respondeu/);
  let t = 0;
  assert.match(consultarPrRest(40, { env: envGh(g), prazo: 1000, agora: () => (t += 600) }).erro, /prazo de 1 s .*estourado/);
  assert.match(consultarPrRest(40, { env: { ...envGh(g), MACUXI_GH_SIMULADO: join(tmpdir(), 'nao-existe-gh.mjs') } }).erro, /falhou/);
});

// ───────────────────────── Parte 3: o hook de verdade ─────────────────────────

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}

/** Repositório com o hook e um branch nuvem/T-0099-x de commits com o trailer "Agente: modulo-core". */
function criarRepo(respostas = { ...respostasDoPr(), ...respostasDoPr({ pr: 41, arquivos: ['modules/core/x.ts', '.claude/settings.json'] }) }) {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-merge-mcp-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.claude/settings.json', JSON.stringify({ agent: 'gerente-projetos' }, null, 2));
  escrever(dir, '.coord/donos.json', JSON.stringify({ versao: 1, regras: [{ padrao: '**', dono: 'engenheiro-software' }], somente_leitura: [] }));
  escrever(dir, '.coord/recados/gerente-projetos/R-20261101-000000-modulo-core.md', '---\nid: R-20261101-000000-modulo-core\nde: modulo-core\n---\n');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(join(RAIZ_REAL, 'scripts', 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  for (const f of ['guarda-merge-mcp.mjs', 'guarda-merge-lib.mjs', 'guarda-bash-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial\n\nAgente: gerente-projetos');
  git(dir, 'checkout', '-q', '-b', 'nuvem/T-0099-x');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'T-0099: início\n\nAgente: modulo-core');
  return { dir, ...ghFalso(respostas) };
}

function hook(repo, { ferramenta = FERRAMENTA, entrada = entradaOk(), json = {}, env = {}, modo = 'ok', bruto } = {}) {
  const base = { ...process.env };
  for (const k of ['MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GH_SIMULADO', 'MACUXI_GUARDA']) delete base[k];
  const dados = { session_id: 's-mcp', hook_event_name: 'PreToolUse', tool_name: ferramenta, tool_input: entrada, cwd: repo.dir, agent_type: 'gerente-projetos', ...json };
  const r = spawnSync(process.execPath, [join(repo.dir, '.claude', 'hooks', 'guarda-merge-mcp.mjs')], {
    cwd: repo.dir, input: bruto ?? JSON.stringify(dados), encoding: 'utf8',
    env: { ...base, CLAUDE_CODE_REMOTE: 'true', ...envGh(repo, modo), ...env },
  });
  return { codigo: r.status, erro: r.stderr };
}

test('hook v6 mcp: sessão da nuvem do modulo-core faz o merge do PR comum (exit 0); o de governança é bloqueado (exit 2)', () => {
  const repo = criarRepo();
  const ok = hook(repo);
  assert.equal(ok.codigo, 0, ok.erro);
  assert.equal(chamadasGh(repo).length, 4, 'PR, arquivos, CI do PR, CI do main');
  const gov = hook(repo, { entrada: entradaOk({ pullNumber: 41, commit_message: mensagem('alexandre') }) });
  assert.equal(gov.codigo, 2);
  assert.match(gov.erro, /BLOQUEADO \(merge pelo MCP do GitHub\)[\s\S]*\.claude\/settings\.json\): sessão da nuvem não faz esse merge/);
  // mesmo com o recado de autorização no disco da nuvem
  escrever(repo.dir, '.coord/recados/gerente-projetos/R-20261102-120000-alexandre.md', recado('R-20261102-120000-alexandre', `Autorizo o merge do PR #41 no commit ${HEAD}`).texto);
  assert.equal(hook(repo, { entrada: entradaOk({ pullNumber: 41, commit_message: mensagem('alexandre') }) }).codigo, 2);
});

test('hook v6 mcp: gerente local — governança sem autorização bloqueia; com o recado do Alexandre (PR + SHA) passa', () => {
  const repo = criarRepo();
  const local = { env: { CLAUDE_CODE_REMOTE: '' }, entrada: entradaOk({ pullNumber: 41, commit_message: mensagem('alexandre') }) };
  const sem = hook(repo, local);
  assert.equal(sem.codigo, 2);
  assert.match(sem.erro, /não há recado do Alexandre .*"autorizo o merge do PR #41 no commit a1b2c3d4/);
  escrever(repo.dir, '.coord/recados/gerente-projetos/R-20261102-120000-alexandre.md', recado('R-20261102-120000-alexandre', `Conferi. Autorizo o merge do PR #41 no commit ${HEAD}.`).texto);
  const com = hook(repo, local);
  assert.equal(com.codigo, 0, com.erro);
  // SHA esperado divergente do head: bloqueia mesmo autorizado
  const div = hook(repo, { ...local, entrada: entradaOk({ pullNumber: 41, commit_message: mensagem('alexandre', OUTRO) }) });
  assert.equal(div.codigo, 2);
  assert.match(div.erro, /o PR mudou depois da conferência/);
});

test('hook v6 mcp: CI vermelho, sem rede, entrada ilegível e subagente bloqueiam; ferramenta que não é merge passa sem consultar', () => {
  const vermelho = criarRepo(respostasDoPr({ ciMain: runs(['testes', 'failure'], ['ci-ok', 'failure']) }));
  const r = hook(vermelho);
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /o CI do main não está verde: vermelho \(testes: failure; ci-ok: failure\)/);
  const repo = criarRepo();
  const fora = hook(repo, { modo: 'fora' });
  assert.equal(fora.codigo, 2);
  assert.match(fora.erro, /não deu para conferir o PR #40 no GitHub .*error connecting/);
  assert.equal(hook(repo, { bruto: '{isto não é json' }).codigo, 2, 'entrada ilegível');
  assert.match(hook(repo, { json: { agent_id: 'sub-1', agent_type: 'modulo-core' } }).erro, /subagente \(modulo-core\) nunca faz merge/);
  assert.match(hook(repo, { env: { MACUXI_AGENTE: 'alexandre' } }).erro, /sessão do Alexandre pelo Claude não faz merge/);
  const antes = chamadasGh(repo).length;
  assert.equal(hook(repo, { ferramenta: 'mcp__github__get_pull_request', entrada: { owner: 'aloirr', repo: 'macuxifdv', pullNumber: 40 } }).codigo, 0);
  assert.equal(hook(repo, { ferramenta: 'mcp__github__create_pull_request', entrada: {} }).codigo, 0);
  assert.equal(chamadasGh(repo).length, antes, 'não consultou o gh');
  assert.equal(hook(repo, { env: { MACUXI_GUARDA: 'off' }, modo: 'fora' }).codigo, 0, 'MACUXI_GUARDA=off desliga, como nos outros guardiões');
});

test('settings.json: o matcher do PreToolUse pega as ferramentas MCP de merge e roda o guarda-merge-mcp com prazo', () => {
  const s = JSON.parse(readFileSync(join(RAIZ_REAL, '.claude', 'settings.json'), 'utf8'));
  const blocos = s.hooks.PreToolUse.filter((b) => b.hooks.some((h) => h.command === 'node .claude/hooks/guarda-merge-mcp.mjs'));
  assert.equal(blocos.length, 1);
  const re = new RegExp(`^(?:${blocos[0].matcher})$`);
  for (const f of ['mcp__github__merge_pull_request', 'mcp__github__mergePullRequest', 'mcp__plugin_github_github__merge_pull_request', 'mcp__github__enable_pr_auto_merge', 'mcp__github__merge_branch'])
    assert.ok(re.test(f), f);
  for (const f of ['Bash', 'Write', 'mcp__github__create_pull_request']) assert.equal(re.test(f), false, f);
  assert.ok(blocos[0].hooks[0].timeout >= 100, 'prazo do hook maior que o prazo da consulta (80 s)');
});
