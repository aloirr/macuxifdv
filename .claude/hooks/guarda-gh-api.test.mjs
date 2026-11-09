// Testes do guardião v7 (T-0122): `gh api` só de leitura no hook do Bash (node:test, sem dependências).
// Rodar: node --test .claude/hooks/guarda-gh-api.test.mjs
// Parte 1: funções puras (analisarGhApi, conferirGhApi; compatibilidade com o acharMerges do v5).
// Parte 2: o hook de verdade (guarda-bash.mjs, stdin → exit code) num repositório git temporário.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { analisarGhApi, conferirGhApi, acharMerges, conferirMerge } from './guarda-merge-lib.mjs';
import { tokenizar, comandosSimples } from './guarda-bash-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');
// "gh api" por extenso só na hora (o próprio guardião lê os comandos desta sessão)
const API = ['gh', 'api'].join(' ');
const MG = ['mer', 'ge'].join('');

/** Palavras depois de "api" (como o hook passa para analisarGhApi). */
const args = (resto) => {
  const [cmd] = comandosSimples(tokenizar(`${API} ${resto}`));
  return cmd.palavras.slice(2);
};
const ler = (resto) => analisarGhApi(args(resto));

// ───────────────────────── Parte 1: funções puras ─────────────────────────

test('v7 gh api: leitura — GET implícito/explícito, HEAD, --paginate/--jq/-H, $VAR e "merge" na consulta passam', () => {
  for (const resto of [
    'user',
    'repos/aloirr/macuxifdv/pulls/31',
    '-X GET search/code -f q=coord',
    '--method GET search/issues -f q="is:pr is:open"',
    '--method=get repos/aloirr/macuxifdv/commits/main/check-runs',
    '-XGET repos/aloirr/macuxifdv/pulls',
    '-X HEAD repos/aloirr/macuxifdv',
    `repos/aloirr/macuxifdv/pulls/31/${MG}`, // GET .../merge só diz se o PR foi mesclado
    `repos/aloirr/macuxifdv/pulls?state=closed --paginate --jq '.[] | select(.${MG}d_at != null) | .number'`,
    'repos/aloirr/macuxifdv/pulls/$PR --jq .head.sha',
    '"repos/aloirr/macuxifdv/pulls/${N}/files" --paginate -q ".[].filename"',
    '-H "Accept: application/vnd.github+json" -i --silent repos/aloirr/macuxifdv/actions/runs?per_page=5',
    `-X GET repos/aloirr/macuxifdv/pulls -f state=open -F per_page=100 --jq '.[] | "\\(.number) \\(.title)"'`,
    "graphql -f query='query { viewer { login } }'",
    "graphql -f query='{ repository(owner: \"aloirr\", name: \"macuxifdv\") { pullRequest(number: 31) { mergeable } } }' -F n=31",
    "graphql -f query='# comentário\nquery($n: Int!) { viewer { login } }' -F n=$N",
  ]) {
    const r = ler(resto);
    assert.equal(r.leitura, true, `${resto} → ${r.motivo}`);
  }
  assert.equal(ler('user').metodo, 'GET');
  assert.equal(ler("graphql -f query='query { viewer { login } }'").metodo, 'POST', 'GraphQL de consulta é POST, mas é leitura');
});

test('v7 gh api: escrita — POST/PUT/PATCH/DELETE, campos sem -X, --input, mutation, método incerto e opção desconhecida', () => {
  const casos = [
    ['repos/aloirr/macuxifdv/issues -f title=x', /método POST grava/],
    ['-X POST repos/aloirr/macuxifdv/issues/1/comments -f body=oi', /método POST grava/],
    ['-X PUT repos/aloirr/macuxifdv/contents/.claude/settings.json -f message=x -f content=eA==', /método PUT grava/],
    ['--method PATCH repos/aloirr/macuxifdv/pulls/31 -f base=main', /método PATCH grava/],
    ['-X DELETE repos/aloirr/macuxifdv/git/refs/heads/nuvem/x', /método DELETE grava/],
    ['--method=delete repos/aloirr/macuxifdv/branches/main/protection', /método DELETE grava/],
    ['repos/aloirr/macuxifdv/git/refs --input ref.json', /método POST grava/],
    ['-X GET repos/x -X POST', /método POST grava/], // vale o último -X, como no gh
    ['-X $METODO repos/aloirr/macuxifdv/pulls', /método do gh api incerto/],
    ["graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'", /mutation/],
    ["-X GET graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'", /mutation/],
    ['$ENDPOINT -f query="mutation { x }"', /mutation/],
    ['graphql -F query=@consulta.graphql', /de \$VAR ou de arquivo/],
    ['graphql -f query="$CONSULTA"', /de \$VAR ou de arquivo/],
    ['graphql -f query=\'query { a }\' -f query=\'query { b }\'', /exatamente um -f query/],
    ['graphql -f owner=aloirr', /exatamente um -f query/],
    ['--novo-flag repos/x', /não reconhece/],
    ['repos/x outro-posicional', /não reconhece/],
    ['-X', /não reconhece/],
    ['', /sem endpoint/],
  ];
  for (const [resto, re] of casos) {
    const r = ler(resto);
    assert.equal(r.leitura, false, resto);
    assert.match(r.motivo, re, resto);
  }
});

test('v7 gh api: conferirGhApi acha o gh api em ; && | $(...) e com -R antes; leitura passa, escrita bloqueia', () => {
  for (const cmd of [
    `${API} user -q .login`,
    `git fetch origin main && ${API} repos/aloirr/macuxifdv/pulls/31 --jq .${MG}able | head -1`,
    `echo $(${API} repos/aloirr/macuxifdv/pulls/31/${MG})`,
    `${API} -X GET search/code -f q='coord repo:aloirr/macuxifdv' --paginate | jq -r '.items[].path' | sort -u`,
    `${API} repos/aloirr/macuxifdv/pulls --jq '.[].number' | while read n; do echo $n; done`,
    'gh pr list -R aloirr/macuxifdv --json number,title', // não é gh api
    `echo "${API} -X DELETE repos/x"`, // só texto
    'ls; pnpm test',
  ]) {
    const r = conferirGhApi(cmd);
    assert.equal(r.ok, true, `${cmd}\n${r.mensagem || ''}`);
  }
  assert.equal(conferirGhApi(`${API} user && ${API} rate_limit`).leituras, 2);
  for (const [cmd, re] of [
    [`${API} -X POST repos/aloirr/macuxifdv/issues -f title=x`, /gh api POST repos\/aloirr\/macuxifdv\/issues: método POST grava/],
    [`git status; ${API} -X PUT repos/aloirr/macuxifdv/contents/x -f content=eA==`, /método PUT grava/],
    [`X=$(${API} -X DELETE repos/aloirr/macuxifdv/git/refs/heads/x)`, /método DELETE grava/],
    [`bash -c "${API} -X POST repos/x/issues -f title=y"`, /gh api dentro de bash -c/],
    [`node -e "require('child_process').execSync('${API} -X PATCH repos/x')"`, /gh api dentro de bash -c, eval/],
  ]) {
    const r = conferirGhApi(cmd);
    assert.equal(r.ok, false, cmd);
    assert.match(r.mensagem, /^\[guardião Macuxi\] BLOQUEADO \(gh api\): o gh api só é aceito para LEITURA:/);
    assert.match(r.mensagem, re, cmd);
    assert.match(r.mensagem, /Não contorne o bloqueio/);
  }
  // gh api visível + script que não o executa: passa (a menção é a do próprio gh api visível)
  assert.equal(conferirGhApi(`${API} repos/x/pulls --jq '.[].number' | node scripts/somar.mjs`).ok, true);
});

test('v7 gh api × v5: leitura com $VAR ou "merge" não é mais merge escondido; escrita de merge continua com a mensagem do merge', () => {
  for (const cmd of [
    `${API} repos/aloirr/macuxifdv/pulls/$PR --jq .${MG}d`,
    `${API} -X GET repos/aloirr/macuxifdv/pulls/31/${MG}`,
    `${API} repos/aloirr/macuxifdv/pulls --jq '.[] | select(.${MG}d_at)'`,
    `${API} graphql -f query='query { repository(owner: "aloirr", name: "macuxifdv") { pullRequest(number: 31) { ${MG}d } } }'`,
  ]) {
    assert.deepEqual(acharMerges(cmd), { merges: [], bloqueios: [] }, cmd);
    assert.equal(conferirMerge({ comando: cmd, agente: 'modulo-core', origem: 'x' }).ok, true, cmd);
    assert.equal(conferirGhApi(cmd).ok, true, cmd);
  }
  for (const cmd of [
    `${API} -X PUT repos/aloirr/macuxifdv/pulls/31/${MG} -f ${MG}_method=squash`,
    `${API} graphql -f query='mutation { ${MG}PullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`,
    `${API} -X PUT repos/aloirr/macuxifdv/pulls/$PR/${MG}`,
  ]) {
    const r = acharMerges(cmd);
    assert.ok(r.bloqueios.some((b) => /API do GitHub/.test(b)), cmd);
    assert.equal(conferirGhApi(cmd).ok, false, cmd);
  }
});

// ───────────────────────── Parte 2: o hook de verdade (guarda-bash.mjs) ─────────────────────────

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function escrever(dir, rel, conteudo) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}
function criarRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-gh-api-'));
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
function hook(dir, comando, { env = {}, json = {} } = {}) {
  const base = { ...process.env };
  for (const k of ['MACUXI_AGENTE', 'CLAUDE_CODE_REMOTE', 'MACUXI_GH_SIMULADO', 'MACUXI_GUARDA']) delete base[k];
  const r = spawnSync(process.execPath, [join(dir, '.claude', 'hooks', 'guarda-bash.mjs')], {
    cwd: dir, encoding: 'utf8', env: { ...base, ...env },
    input: JSON.stringify({ session_id: `s-api-${Math.random()}`, tool_use_id: `t-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando }, cwd: dir, ...json }),
  });
  return { codigo: r.status, erro: r.stderr };
}

test('hook v7: gh api de leitura passa (agente, nuvem e sessão manual); escrita bloqueia para todos; MACUXI_GUARDA=off desliga', () => {
  const dir = criarRepo();
  const leitura = `${API} repos/aloirr/macuxifdv/pulls/$PR --jq '.${MG}d'`;
  const escrita = `${API} -X PUT repos/aloirr/macuxifdv/contents/.claude/settings.json -f message=x -f content=eA==`;
  const sessoes = [
    { json: { agent_type: 'modulo-core' } },
    { json: { agent_type: 'gerente-projetos' }, env: { CLAUDE_CODE_REMOTE: 'true' } },
    { env: { MACUXI_AGENTE: 'alexandre' } },
    {}, // sessão manual local
  ];
  for (const s of sessoes) {
    const ok = hook(dir, leitura, s);
    assert.equal(ok.codigo, 0, `${JSON.stringify(s)}\n${ok.erro}`);
    const r = hook(dir, escrita, s);
    assert.equal(r.codigo, 2, JSON.stringify(s));
    assert.match(r.erro, /BLOQUEADO \(gh api\)[\s\S]*método PUT grava no GitHub/);
  }
  assert.equal(hook(dir, escrita, { env: { MACUXI_GUARDA: 'off' } }).codigo, 0);
  // merge pela API continua com a mensagem do merge (v5)
  const m = hook(dir, `${API} -X PUT repos/aloirr/macuxifdv/pulls/31/${MG}`, { json: { agent_type: 'gerente-projetos' } });
  assert.equal(m.codigo, 2);
  assert.match(m.erro, /BLOQUEADO \(gh pr merge\)[\s\S]*API do GitHub/);
});
