// Testes dos recados direto no GitHub (T-0143, ADR 0039): node --test scripts/coord-recados.test.mjs
// Sem rede: um GitHub de mentira (GraphQL + REST compare, com expectedHeadOid de verdade) em memória, usado direto
// pelas funções da coord-lib ou por um servidor HTTP local, para rodar o coord.mjs e o subir-pendentes.mjs de verdade
// em processos separados (concorrência real entre agentes).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  modoDosRecados, podeAlterar, regraDoRecadoNovo, globParaRegex, shaDoBlob, aplicarMudancas, tokenDoAmbiente, ghAuthToken,
  criarClienteDeRecados, atualizarIndiceDeRecados, enviarRecadoNoGitHub, marcarLidosNoGitHub, recadosDaPastaNoGitHub,
  recadosDoIndice, idsDoIndice, lidosDoIndice, ErroRecados, MOTIVO_RECADOS_NO_GITHUB,
  AGENTES, PESSOAS, DESTINOS, REMETENTES_DE_SISTEMA, ehRemetenteDeSistema, remetenteDoRecado, classificarMudancas,
} from './coord-lib.mjs';
import { lerRecadosDoGerente, autorizacoesDoAlexandre } from '../.claude/hooks/guarda-merge-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'token-de-teste-que-nao-pode-vazar';
const MARCA = '/.coord/recados\n/.coord/lidos\n';
const PERDIDA = Symbol('resposta perdida');

const temporarios = [];
after(() => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });
const pastaTemp = (prefixo) => { const d = mkdtempSync(join(tmpdir(), prefixo)); temporarios.push(d); return d; };

const recado = ({ id, de, para, tipo = 'pedido', respondeA = 'null', encerra = 'false', titulo = 'Assunto' }) =>
  `---\nid: ${id}\nde: ${de}\npara: [${para}]\ncc: []\ntipo: ${tipo}\nprioridade: normal\ntarefa: T-0143\nresponde_a: ${respondeA}\nencerra: ${encerra}\ncontrato: null\ncriado_em: 2026-11-09T10:00:00-04:00\n---\n# ${titulo}\n\ncorpo\n`;

// ───────────────────────── GitHub de mentira ─────────────────────────

class GitHubFalso {
  constructor(arquivos = {}) {
    this.commits = new Map();
    this.blobs = new Map();
    this.n = 0;
    this.offline = false;
    this.chamadas = [];
    this.antesDoCommit = null;
    this.perderResposta = false;
    this.head = this.novoCommit(null, arquivos, 'inicial');
  }
  novoCommit(pai, arquivos, msg) {
    for (const t of Object.values(arquivos)) this.blobs.set(shaDoBlob(t), t);
    const oid = createHash('sha1').update(`commit ${++this.n} ${msg}`).digest('hex');
    this.commits.set(oid, { pai, arquivos: { ...arquivos }, msg });
    return oid;
  }
  get arquivos() { return this.commits.get(this.head).arquivos; }
  /** Commit de fora (formulário de issue, Telegram, outro agente). */
  externo(caminho, texto, msg = 'externo') { this.head = this.novoCommit(this.head, { ...this.arquivos, [caminho]: texto }, msg); return this.head; }
  historico() { const r = []; for (let o = this.head; o; o = this.commits.get(o).pai) r.push(this.commits.get(o)); return r.reverse(); }
  ops(nome) { return this.chamadas.filter((c) => c.op === nome).length; }

  responder({ url, metodo = 'GET', corpo, token }) {
    this.chamadas.push({ url, op: corpo?.query?.match(/^\s*(?:query|mutation) (\w+)/)?.[1] || (url.includes('/compare/') ? 'compare' : '?') });
    if (this.offline) return { rede: 'TypeError: fetch failed: ECONNREFUSED' };
    if (token !== TOKEN) return { status: 401, texto: '{"message":"Bad credentials"}' };
    const m = url.match(/\/repos\/[^/]+\/[^/]+\/compare\/([0-9a-f]+)\.\.\.main$/);
    if (m) return this.comparar(m[1]);
    if (url.endsWith('/graphql') && metodo === 'POST') {
      const r = this.graphql(corpo);
      return r === PERDIDA ? { rede: 'resposta perdida' } : { status: 200, texto: JSON.stringify(r) };
    }
    return { status: 404, texto: '{"message":"Not Found"}' };
  }

  arvore(pasta, doisNiveis) {
    const pref = `${pasta}/`;
    const nomes = new Map();
    for (const [c, t] of Object.entries(this.arquivos)) {
      if (!c.startsWith(pref)) continue;
      const partes = c.slice(pref.length).split('/');
      if (partes.length === 1) { nomes.set(partes[0], { name: partes[0], type: 'blob', oid: shaDoBlob(t) }); continue; }
      const d = nomes.get(partes[0]) || { name: partes[0], type: 'tree', oid: `arvore-${partes[0]}`, filhos: [] };
      d.filhos.push({ name: partes[1], type: partes.length === 2 ? 'blob' : 'tree', oid: shaDoBlob(t) });
      nomes.set(partes[0], d);
    }
    return [...nomes.values()].map(({ filhos, ...e }) => ({ ...e, object: e.type === 'tree' && doisNiveis ? { entries: filhos } : {} }));
  }

  graphql({ query, variables: v }) {
    const op = query.match(/^\s*(?:query|mutation) (\w+)/)[1];
    if (op === 'CriarCommit') return this.criarCommit(v.input);
    if (v.dono !== 'aloirr' || v.nome !== 'macuxifdv-recados') {
      return { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: `Could not resolve to a Repository with the name '${v.dono}/${v.nome}'.` }] };
    }
    if (op === 'Blobs') {
      const repo = {};
      for (const [k, oid] of Object.entries(v)) {
        const mm = k.match(/^o(\d+)$/);
        if (mm) repo[`b${mm[1]}`] = this.blobs.has(oid) ? { text: this.blobs.get(oid), isBinary: false } : null;
      }
      return { data: { repository: repo } };
    }
    const alvo = { oid: this.head };
    const errors = [];
    if (op === 'Listagem') {
      alvo.recados = { object: { entries: this.arvore('recados', true) } };
      alvo.lidos = { object: { entries: this.arvore('lidos', false) } };
    } else if (op === 'Arquivo') {
      const t = this.arquivos[v.caminho];
      alvo.arquivo = t === undefined ? null : { oid: shaDoBlob(t), object: { text: t } };
      if (t === undefined) errors.push({ type: 'NOT_FOUND', path: ['repository', 'ref', 'target', 'arquivo'], message: `Could not resolve file for path '${v.caminho}'.` });
    } else if (op === 'Pasta') {
      const e = this.arvore(v.caminho, false);
      alvo.pasta = e.length ? { object: { entries: e } } : null;
    }
    return { data: { repository: { ref: { target: alvo } } }, ...(errors.length ? { errors } : {}) };
  }

  criarCommit(input) {
    if (this.antesDoCommit) { const f = this.antesDoCommit; this.antesDoCommit = null; f(this); }
    if (input.expectedHeadOid !== this.head) {
      return { data: { createCommitOnBranch: null }, errors: [{ type: 'STALE_DATA', message: `Expected branch to point to "${input.expectedHeadOid}" but it did not. Pull and try again.` }] };
    }
    const novos = { ...this.arquivos };
    for (const a of input.fileChanges.additions) novos[a.path] = Buffer.from(a.contents, 'base64').toString('utf8');
    this.head = this.novoCommit(this.head, novos, input.message.headline);
    if (this.perderResposta) { this.perderResposta = false; return PERDIDA; }
    return { data: { createCommitOnBranch: { commit: { oid: this.head, url: `https://github.com/aloirr/macuxifdv-recados/commit/${this.head}` } } } };
  }

  comparar(base) {
    const cadeia = [];
    let o = this.head;
    while (o && o !== base) { cadeia.push(o); o = this.commits.get(o).pai; }
    if (o !== base) return { status: 404, texto: '{"message":"Not Found"}' };
    const ok = (j) => ({ status: 200, texto: JSON.stringify(j) });
    if (!cadeia.length) return ok({ status: 'identical', ahead_by: 0, commits: [], files: [] });
    const antes = this.commits.get(base).arquivos;
    const depois = this.arquivos;
    const files = [];
    for (const [c, t] of Object.entries(depois)) {
      if (antes[c] === undefined) files.push({ filename: c, status: 'added', sha: shaDoBlob(t) });
      else if (antes[c] !== t) files.push({ filename: c, status: 'modified', sha: shaDoBlob(t) });
    }
    for (const c of Object.keys(antes)) if (depois[c] === undefined) files.push({ filename: c, status: 'removed', sha: shaDoBlob(antes[c]) });
    return ok({ status: 'ahead', ahead_by: cadeia.length, commits: cadeia.reverse().map((sha) => ({ sha })), files });
  }
}

const httpDe = (falso) => (reqs) => reqs.map((r) => falso.responder({ ...r, token: TOKEN }));
const clienteDe = (falso) => criarClienteDeRecados({ http: httpDe(falso) });
const cacheEmMemoria = () => ({ dados: null, ler() { return this.dados && JSON.parse(JSON.stringify(this.dados)); }, gravar(c) { this.dados = JSON.parse(JSON.stringify(c)); } });
const semEspera = () => {};

/** Repositório com 2 recados, um para o testes e outro para o gerente (de alexandre), e um lidos. */
function base() {
  return new GitHubFalso({
    'recados/testes/R-20261109-090000-modulo-core.md': recado({ id: 'R-20261109-090000-modulo-core', de: 'modulo-core', para: 'testes' }),
    'recados/gerente-projetos/R-20261109-090100-alexandre.md': recado({ id: 'R-20261109-090100-alexandre', de: 'alexandre', para: 'gerente-projetos', titulo: 'autorizo o merge do PR #9 no commit abcdef1' }),
    'lidos/testes.txt': 'R-1\n',
    'README.md': '# recados\n',
  });
}

// ───────────────────────── modo, guardião e funções puras ─────────────────────────

test('modoDosRecados: marca no .gitignore = github; sem marca = local; MACUXI_RECADOS força', () => {
  const dir = pastaTemp('coord-modo-');
  assert.equal(modoDosRecados({ raiz: dir, env: {} }), 'local', 'sem .gitignore');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  assert.equal(modoDosRecados({ raiz: dir, env: {} }), 'local');
  writeFileSync(join(dir, '.gitignore'), `node_modules/\n${MARCA}`);
  assert.equal(modoDosRecados({ raiz: dir, env: {} }), 'github');
  assert.equal(modoDosRecados({ raiz: dir, env: { MACUXI_RECADOS: 'local' } }), 'local', 'plano de volta');
  assert.equal(modoDosRecados({ raiz: dir, env: { MACUXI_RECADOS: 'GitHub' } }), 'github');
});

test('podeAlterar no modo GitHub: nada se grava em .coord/recados nem em .coord/lidos no disco; no local, a regra de antes', () => {
  const dir = pastaTemp('coord-pode-');
  writeFileSync(join(dir, '.gitignore'), MARCA);
  const regras = [{ padrao: '.coord/recados/anexos/**', dono: 'alexandre' }, { padrao: '.coord/**', dono: 'gerente-projetos' }, { padrao: 'docs/**', dono: 'engenheiro-software' }]
    .map((r) => ({ ...r, re: globParaRegex(r.padrao) }));
  const pode = (agente, rel, env = {}) => podeAlterar({ agente, ferramenta: 'Write', rel, raiz: dir, regras, env, conteudo: `---\nde: ${agente}\n---\n` });
  for (const agente of ['modulo-core', 'alexandre']) {
    for (const rel of [`.coord/recados/testes/R-1-${agente}.md`, `.coord/lidos/${agente}.txt`, '.coord/recados/anexos/a.png']) {
      assert.deepEqual(pode(agente, rel), { ok: false, motivo: MOTIVO_RECADOS_NO_GITHUB }, `${agente} ${rel}`);
    }
  }
  assert.deepEqual(pode('modulo-core', '.coord/recados/testes/R-1-modulo-core.md', { MACUXI_RECADOS: 'local' }), { ok: true }, 'volta: regra de antes');
  assert.deepEqual(pode('modulo-core', '.coord/lidos/modulo-core.txt', { MACUXI_RECADOS: 'local' }), { ok: true });
  assert.equal(pode('engenheiro-software', 'docs/x.md').ok, true, 'fora das pastas de recados nada muda');
  // regras do recado novo, sem disco (as mesmas do guardião v5)
  assert.deepEqual(regraDoRecadoNovo({ agente: 'modulo-core', destino: 'testes', arquivo: 'R-1-modulo-core.md', conteudo: '---\nde: modulo-core\n---\n' }), { ok: true });
  assert.match(regraDoRecadoNovo({ agente: 'modulo-core', destino: 'fulano', arquivo: 'R-1-modulo-core.md' }).motivo, /destino de recado inválido/);
  assert.match(regraDoRecadoNovo({ agente: 'modulo-core', destino: 'testes', arquivo: 'R-1-alexandre.md' }).motivo, /terminar com o remetente/);
  assert.match(regraDoRecadoNovo({ agente: 'modulo-core', destino: 'testes', arquivo: 'R-1-modulo-core.md', conteudo: '---\nde: alexandre\n---\n' }).motivo, /em nome de outro/);
});

test('shaDoBlob é o hash do git (git hash-object), inclusive com acento', () => {
  for (const t of ['', 'R-1\n', recado({ id: 'R-2-modulo-core', de: 'modulo-core', para: 'testes', titulo: 'Ação não é ruptura' })]) {
    assert.equal(shaDoBlob(t), execFileSync('git', ['hash-object', '--stdin'], { input: Buffer.from(t, 'utf8'), encoding: 'utf8' }).trim());
  }
});

test('aplicarMudancas: novo, alterado, removido e renomeado; o que não é recado nem lidos fica de fora', () => {
  const antes = { 'recados/a/R-1-x.md': 'o1', 'recados/a/R-2-x.md': 'o2', 'lidos/x.txt': 'o3' };
  const depois = aplicarMudancas(antes, [
    { status: 'added', filename: 'recados/b/R-3-x.md', sha: 'o4' },
    { status: 'modified', filename: 'lidos/x.txt', sha: 'o5' },
    { status: 'removed', filename: 'recados/a/R-1-x.md', sha: 'o1' },
    { status: 'renamed', filename: 'recados/c/R-2-x.md', previous_filename: 'recados/a/R-2-x.md', sha: 'o2' },
    { status: 'added', filename: 'README.md', sha: 'o6' },
    { status: 'added', filename: 'recados/anexos/foto.png', sha: 'o7' },
  ]);
  assert.deepEqual(depois, { 'recados/b/R-3-x.md': 'o4', 'lidos/x.txt': 'o5', 'recados/c/R-2-x.md': 'o2' });
  assert.deepEqual(antes['recados/a/R-1-x.md'], 'o1', 'função pura: não muda a entrada');
});

test('tokenDoAmbiente: MACUXI_RECADOS_TOKEN, GH_TOKEN, GITHUB_TOKEN e só então o gh; sem nenhum = null', () => {
  const gh = () => 'do-gh';
  assert.deepEqual(tokenDoAmbiente({ env: { MACUXI_RECADOS_TOKEN: ' a ', GH_TOKEN: 'b', GITHUB_TOKEN: 'c' }, gh }), { token: 'a', origem: 'MACUXI_RECADOS_TOKEN' });
  assert.deepEqual(tokenDoAmbiente({ env: { GH_TOKEN: 'b', GITHUB_TOKEN: 'c' }, gh }), { token: 'b', origem: 'GH_TOKEN' });
  assert.deepEqual(tokenDoAmbiente({ env: { GITHUB_TOKEN: 'c' }, gh }), { token: 'c', origem: 'GITHUB_TOKEN' });
  assert.deepEqual(tokenDoAmbiente({ env: {}, gh }), { token: 'do-gh', origem: 'gh auth token' });
  assert.equal(tokenDoAmbiente({ env: {}, gh: () => '' }), null);
});

test('ghAuthToken: até 3 tentativas com espera de 1 s e 2 s; sem o gh (ENOENT) não insiste', () => {
  const rodar = (respostas) => {
    const esperas = [];
    let chamadas = 0;
    const executar = () => {
      const r = respostas[chamadas++];
      if (r instanceof Error) throw r;
      return r;
    };
    return { token: ghAuthToken({ executar, esperar: (ms) => esperas.push(ms) }), chamadas: () => chamadas, esperas };
  };
  const falha = () => Object.assign(new Error('chaveiro ocupado'), { status: 1 });

  const dePrimeira = rodar([`${TOKEN}\n`]);
  assert.deepEqual([dePrimeira.token, dePrimeira.chamadas(), dePrimeira.esperas], [TOKEN, 1, []], 'de primeira: sem espera');

  const naTerceira = rodar([falha(), '', TOKEN]);
  assert.deepEqual([naTerceira.token, naTerceira.chamadas(), naTerceira.esperas], [TOKEN, 3, [1000, 2000]], 'falha e saída vazia contam como tentativa');

  const nunca = rodar([falha(), falha(), falha(), TOKEN]);
  assert.deepEqual([nunca.token, nunca.chamadas(), nunca.esperas], ['', 3, [1000, 2000]], 'para na 3ª tentativa');

  const semGh = rodar([Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), TOKEN]);
  assert.deepEqual([semGh.token, semGh.chamadas(), semGh.esperas], ['', 1, []], 'sem o gh instalado: não espera');

  // Ligado ao tokenDoAmbiente (o gh padrão é o ghAuthToken): a origem aparece, o token só no valor devolvido.
  const respostas = [falha(), TOKEN];
  const viaAmbiente = tokenDoAmbiente({ env: {}, gh: () => ghAuthToken({ executar: () => { const r = respostas.shift(); if (r instanceof Error) throw r; return r; }, esperar: () => {} }) });
  assert.deepEqual(viaAmbiente, { token: TOKEN, origem: 'gh auth token' });
});

test('ghAuthToken: a espera padrão é síncrona e de verdade (Atomics.wait), sem dependência nova', () => {
  let chamadas = 0;
  const inicio = Date.now();
  const token = ghAuthToken({ executar: () => (++chamadas < 3 ? '' : 'ok'), esperas: [30, 60] });
  const passou = Date.now() - inicio;
  assert.equal(token, 'ok');
  assert.equal(chamadas, 3);
  assert.ok(passou >= 85, `esperou ao menos 30 + 60 ms (passou ${passou} ms)`);
});

// ───────────────────────── índice (leitura) ─────────────────────────

test('índice: lista no primeiro uso; depois só o delta (compare) e só os blobs novos; o recado do formulário aparece', () => {
  const gh = base();
  const cliente = clienteDe(gh);
  const cache = cacheEmMemoria();
  const i1 = atualizarIndiceDeRecados({ cliente, cache });
  assert.equal(i1.online, true);
  assert.equal(i1.oid, gh.head);
  assert.deepEqual([...idsDoIndice(i1)].sort(), ['R-20261109-090000-modulo-core', 'R-20261109-090100-alexandre']);
  assert.equal(lidosDoIndice(i1, 'testes'), 'R-1\n');
  assert.equal(lidosDoIndice(i1, 'ninguem'), '');
  assert.equal(gh.ops('Listagem'), 1);
  assert.equal(recadosDoIndice(i1).find((r) => r.destino === 'testes').texto, gh.arquivos['recados/testes/R-20261109-090000-modulo-core.md']);

  // sem mudança: só o compare (nenhum blob)
  gh.chamadas = [];
  atualizarIndiceDeRecados({ cliente, cache });
  assert.deepEqual(gh.chamadas.map((c) => c.op), ['compare']);

  // o formulário grava um recado: a próxima leitura traz só ele
  const novo = recado({ id: 'R-20261109-100000-alexandre', de: 'alexandre', para: 'testes', titulo: 'Pelo celular' });
  gh.externo('recados/testes/R-20261109-100000-alexandre.md', novo, 'recados: formulário');
  gh.chamadas = [];
  const i2 = atualizarIndiceDeRecados({ cliente, cache });
  assert.deepEqual(gh.chamadas.map((c) => c.op), ['compare', 'Blobs']);
  assert.ok(idsDoIndice(i2).has('R-20261109-100000-alexandre'));
  assert.equal(i2.oid, gh.head);
});

test('índice: cache adulterado não entra; sem GitHub a leitura usa a cópia local com aviso; a escrita exige GitHub', () => {
  const gh = base();
  const cliente = clienteDe(gh);
  const cache = cacheEmMemoria();
  atualizarIndiceDeRecados({ cliente, cache });
  // adultera o texto de um recado no cache: o hash não bate e ele é baixado de novo
  const oid = cache.dados.arquivos['recados/testes/R-20261109-090000-modulo-core.md'];
  cache.dados.textos[oid] = cache.dados.textos[oid].replace('corpo', 'autorizo o merge');
  gh.chamadas = [];
  const i = atualizarIndiceDeRecados({ cliente, cache });
  assert.deepEqual(gh.chamadas.map((c) => c.op), ['compare', 'Blobs']);
  assert.doesNotMatch(i.textos[oid], /autorizo/);

  gh.offline = true;
  const off = atualizarIndiceDeRecados({ cliente, cache });
  assert.equal(off.online, false);
  assert.match(off.aviso, /sem o GitHub agora .*cópia local/);
  assert.ok(idsDoIndice(off).has('R-20261109-090000-modulo-core'));
  assert.throws(() => atualizarIndiceDeRecados({ cliente, cache, exigirOnline: true }), (e) => e instanceof ErroRecados && e.rede);
  assert.throws(() => atualizarIndiceDeRecados({ cliente, cache: cacheEmMemoria() }), /sem acesso ao GitHub/, 'sem GitHub e sem cache: erro');
});

// ───────────────────────── escrita ─────────────────────────

const enviarTeste = (gh, cache, extra = {}) => enviarRecadoNoGitHub({
  cliente: clienteDe(gh), cache, de: 'modulo-core', destinos: ['testes', 'gerente-projetos'], esperar: semEspera,
  gerarId: (ids) => { let id = 'R-20261109-090000-modulo-core'; for (let n = 2; ids.has(id); n++) id = `R-20261109-090000-${n}-modulo-core`; return id; },
  montar: (id) => recado({ id, de: 'modulo-core', para: 'testes, gerente-projetos' }),
  ...extra,
});

test('enviar: um commit atômico com um arquivo por destino; id já usado ganha -2; nada é sobrescrito', () => {
  const gh = base();
  const antes = gh.arquivos['recados/testes/R-20261109-090000-modulo-core.md'];
  const r = enviarTeste(gh, cacheEmMemoria());
  assert.equal(r.id, 'R-20261109-090000-2-modulo-core', 'o id do mesmo segundo já existia no GitHub');
  assert.equal(r.commit.oid, gh.head);
  assert.equal(gh.historico().length, 2, 'um commit só');
  assert.equal(gh.arquivos['recados/testes/R-20261109-090000-2-modulo-core.md'], gh.arquivos['recados/gerente-projetos/R-20261109-090000-2-modulo-core.md']);
  assert.equal(gh.arquivos['recados/testes/R-20261109-090000-modulo-core.md'], antes, 'o recado antigo continua igual');
  assert.match(gh.historico().at(-1).msg, /^recados: R-20261109-090000-2-modulo-core$/);
  assert.throws(() => enviarTeste(gh, cacheEmMemoria(), { respondeA: 'R-nao-existe' }), /--responde-a: recado R-nao-existe não encontrado/);
});

test('enviar: o main mudou no meio (outro agente gravou) → relê e tenta de novo; o commit do outro fica', () => {
  const gh = base();
  gh.antesDoCommit = (g) => g.externo('recados/testes/R-20261109-090000-modulo-core-outro.md', 'x', 'outro agente');
  const r = enviarTeste(gh, cacheEmMemoria());
  assert.equal(r.tentativas, 2);
  assert.ok(gh.arquivos['recados/testes/R-20261109-090000-modulo-core-outro.md'], 'o commit do outro continua');
  assert.ok(gh.arquivos[`recados/testes/${r.id}.md`]);
  assert.equal(gh.historico().length, 3);
});

test('enviar: resposta perdida depois do commit → "confirmado na conferência", sem duplicar', () => {
  const gh = base();
  gh.perderResposta = true;
  const r = enviarTeste(gh, cacheEmMemoria());
  assert.equal(r.conferido, true);
  assert.equal(gh.historico().length, 2, 'um commit só');
});

test('enviar: sem GitHub → erro e nada gravado; conferência sem GitHub → "NÃO foi confirmado", nunca "enviado"', () => {
  const gh = base();
  gh.offline = true;
  assert.throws(() => enviarTeste(gh, cacheEmMemoria()), (e) => e instanceof ErroRecados && /sem acesso ao GitHub/.test(e.message));
  assert.equal(gh.historico().length, 1);
  gh.offline = false;
  // a rede cai no meio do commit: a resposta não chega e a conferência também não responde
  const cache = cacheEmMemoria();
  const cliente = clienteDe(gh);
  assert.throws(() => enviarRecadoNoGitHub({
    cliente: { ...cliente, commitar: (p) => { gh.offline = true; return cliente.commitar(p); } }, cache, de: 'modulo-core', destinos: ['testes'], esperar: semEspera,
    gerarId: () => 'R-20261109-110000-modulo-core', montar: (id) => recado({ id, de: 'modulo-core', para: 'testes' }),
  }), /NÃO foi confirmado.*node scripts\/coord\.mjs ler R-20261109-110000-modulo-core/);
});

test('lido: acrescenta só o que falta; dois agentes ao mesmo tempo no mesmo arquivo não perdem linha', () => {
  const gh = base();
  const cliente = clienteDe(gh);
  // outro processo marca R-9 entre a leitura e o commit deste
  gh.antesDoCommit = (g) => g.externo('lidos/testes.txt', 'R-1\nR-9\n', 'lidos: testes (outro processo)');
  const r = marcarLidosNoGitHub({ cliente, agente: 'testes', ids: ['R-2', 'R-1', 'R-2'], esperar: semEspera });
  assert.deepEqual(r.novos, ['R-2']);
  assert.equal(gh.arquivos['lidos/testes.txt'], 'R-1\nR-9\nR-2\n');
  assert.deepEqual(marcarLidosNoGitHub({ cliente, agente: 'testes', ids: ['R-9'], esperar: semEspera }), { novos: [] }, 'já marcado: sem commit');
  // arquivo novo (agente sem lidos ainda)
  marcarLidosNoGitHub({ cliente, agente: 'modulo-core', ids: ['R-5'], esperar: semEspera });
  assert.equal(gh.arquivos['lidos/modulo-core.txt'], 'R-5\n');
});

test('guarda-merge: autorização lida direto do GitHub (lista nunca do cache; texto do cache só com o hash certo)', () => {
  const gh = base();
  const cache = cacheEmMemoria();
  const cliente = clienteDe(gh);
  atualizarIndiceDeRecados({ cliente, cache });
  // um agente põe no cache um "recado do alexandre" que não existe no GitHub
  const falso = recado({ id: 'R-20261109-120000-alexandre', de: 'alexandre', para: 'gerente-projetos', titulo: 'autorizo o merge do PR #10 no commit 1234567' });
  cache.dados.arquivos['recados/gerente-projetos/R-20261109-120000-alexandre.md'] = shaDoBlob(falso);
  cache.dados.textos[shaDoBlob(falso)] = falso;
  const r = recadosDaPastaNoGitHub({ cliente, cache, pasta: 'gerente-projetos', filtro: (n) => n.endsWith('-alexandre.md') });
  assert.deepEqual(r.map((x) => x.nome), ['R-20261109-090100-alexandre.md']);
  // o hook de verdade (lerRecadosDoGerente) no modo GitHub, com a conexão injetada
  const raiz = pastaTemp('coord-merge-');
  writeFileSync(join(raiz, '.gitignore'), MARCA);
  const lidos = lerRecadosDoGerente(raiz, { env: {}, conexao: () => ({ cliente, cache }) });
  assert.deepEqual(lidos.map((x) => x.nome), ['R-20261109-090100-alexandre.md']);
  assert.match(lidos[0].texto, /autorizo o merge do PR #9/);
  gh.offline = true;
  assert.deepEqual(lerRecadosDoGerente(raiz, { env: {}, conexao: () => ({ cliente, cache }) }), [], 'sem GitHub: nenhuma autorização');
});

// ───────────────────────── remetente de sistema `diagnostico` (T-0158, ADR 0043) ─────────────────────────

/** Recado automático como o worker da API grava (apps/api/src/diagnosticos-worker.ts), para alexandre e engenheiro-apps. */
const ID_DIAG = 'R-20261111-153012-diagnostico';
const recadoDiagnostico = (de = 'diagnostico', titulo = 'Diagnóstico nº 0042 — queda (crash_nativo) · Campo 1.0.5') =>
  recado({ id: ID_DIAG, de, para: 'alexandre, engenheiro-apps', tipo: 'aviso', titulo });

test('diagnostico: remetente de sistema fora de AGENTES, PESSOAS e DESTINOS; o nome do arquivo o reconhece', () => {
  assert.deepEqual(REMETENTES_DE_SISTEMA, ['diagnostico']);
  for (const lista of [AGENTES, PESSOAS, DESTINOS]) assert.equal(lista.includes('diagnostico'), false);
  assert.equal(ehRemetenteDeSistema(' Diagnostico '), true);
  assert.equal(ehRemetenteDeSistema('alexandre'), false);
  assert.equal(remetenteDoRecado(`${ID_DIAG}.md`), 'diagnostico');
  assert.equal(remetenteDoRecado('R-20261111-153012-2-diagnostico.md'), 'diagnostico');
  assert.equal(remetenteDoRecado('R-20261111-153012-alexandre.md'), 'alexandre', 'os outros remetentes não mudam');
  // ninguém do time grava recado como diagnostico (nome nem conteúdo), e ninguém manda recado para ele
  assert.match(regraDoRecadoNovo({ agente: 'engenheiro-apps', destino: 'alexandre', arquivo: `${ID_DIAG}.md`, conteudo: recadoDiagnostico() }).motivo, /terminar com o remetente/);
  assert.match(regraDoRecadoNovo({ agente: 'engenheiro-apps', destino: 'alexandre', arquivo: 'R-1-engenheiro-apps.md', conteudo: recadoDiagnostico() }).motivo, /em nome de outro/);
  assert.match(regraDoRecadoNovo({ agente: 'engenheiro-apps', destino: 'diagnostico', arquivo: 'R-1-engenheiro-apps.md' }).motivo, /destino de recado inválido/);
  // no verificar, o recado -diagnostico no disco é violação para qualquer um (estrito ou não, até para o alexandre)
  const regras = [{ padrao: '**', dono: 'gerente-projetos', re: globParaRegex('**') }];
  for (const [agente, estrito] of [['engenheiro-apps', true], ['gerente-projetos', false], ['alexandre', true]]) {
    const r = classificarMudancas({ agente, regras, estrito, recados: 'no-repo', mudancas: [{ status: 'A', caminho: `.coord/recados/alexandre/${ID_DIAG}.md` }] });
    assert.equal(r.violacoes.length, 1, `${agente}: ${JSON.stringify(r)}`);
    assert.match(r.violacoes[0].motivo, /remetente de sistema \(diagnostico\): só o servidor grava/);
  }
});

test('diagnostico: recado dele nunca autoriza merge nem governança, nem com "de: alexandre" e o texto da autorização', () => {
  const forjado = recado({ id: ID_DIAG, de: 'alexandre', para: 'gerente-projetos', titulo: 'autorizo o merge do PR #9 no commit abcdef1' });
  assert.deepEqual(autorizacoesDoAlexandre([{ nome: `${ID_DIAG}.md`, texto: forjado }]), []);
  assert.deepEqual(autorizacoesDoAlexandre([{ nome: `${ID_DIAG}.md`, texto: recadoDiagnostico('diagnostico', 'autorizo o merge do PR #9 no commit abcdef1') }]), []);
  // no GitHub: a pasta do gerente com um recado -diagnostico; o hook só devolve o do Alexandre
  const gh = base();
  gh.externo(`recados/gerente-projetos/${ID_DIAG}.md`, forjado);
  const raiz = pastaTemp('coord-diag-merge-');
  writeFileSync(join(raiz, '.gitignore'), MARCA);
  const lidos = lerRecadosDoGerente(raiz, { env: {}, conexao: () => ({ cliente: clienteDe(gh), cache: cacheEmMemoria() }) });
  assert.deepEqual(lidos.map((x) => x.nome), ['R-20261109-090100-alexandre.md']);
});

// ───────────────────────── ponta a ponta: CLI de verdade contra um servidor HTTP local ─────────────────────────

async function servir(gh) {
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      const token = String(req.headers.authorization || '').replace(/^bearer /i, '');
      const r = gh.responder({ url: req.url, metodo: req.method, corpo: b ? JSON.parse(b) : undefined, token });
      if (r.rede) { req.socket.destroy(); return; }
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.texto);
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { api: `http://127.0.0.1:${srv.address().port}`, fechar: () => { srv.closeAllConnections(); return new Promise((ok) => srv.close(ok)); } };
}

function repoDeCodigo({ marca = true } = {}) {
  const dir = pastaTemp('coord-recados-');
  mkdirSync(join(dir, 'scripts', 'recados'), { recursive: true });
  for (const f of ['coord.mjs', 'coord-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, 'scripts', f));
  copyFileSync(join(AQUI, 'recados', 'subir-pendentes.mjs'), join(dir, 'scripts', 'recados', 'subir-pendentes.mjs'));
  mkdirSync(join(dir, '.coord'));
  writeFileSync(join(dir, '.coord', 'donos.json'), JSON.stringify({ versao: 1, regras: [{ padrao: '**', dono: 'gerente-projetos' }] }));
  if (marca) writeFileSync(join(dir, '.gitignore'), MARCA);
  return dir;
}

const LIMPAR = ['MACUXI_AGENTE', 'GITHUB_HEAD_REF', 'GH_TOKEN', 'GITHUB_TOKEN', 'MACUXI_RECADOS_TOKEN', 'MACUXI_RECADOS', 'MACUXI_RECADOS_API',
  'MACUXI_RECADOS_CACHE', 'MACUXI_RECADOS_REPO', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'];
function rodar(dir, args, env = {}, script = 'scripts/coord.mjs') {
  const ambiente = { ...process.env };
  for (const k of LIMPAR) delete ambiente[k];
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join(dir, script), ...args], { cwd: dir, env: { ...ambiente, ...env } });
    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (erro += d));
    p.on('close', (codigo) => ok({ codigo, saida, erro, tudo: saida + erro }));
  });
}
const amb = (dir, api, extra = {}) => ({ MACUXI_RECADOS_API: api, MACUXI_RECADOS_TOKEN: TOKEN, MACUXI_RECADOS_CACHE: join(dir, '.cache-teste'), ...extra });

test('CLI no modo GitHub: enviar, caixa, ler, fio, pendencias e lido de ponta a ponta; o token não aparece', async () => {
  const gh = base();
  const s = await servir(gh);
  try {
    const dir = repoDeCodigo();
    const env = amb(dir, s.api);
    let r = await rodar(dir, ['caixa', 'testes'], env);
    assert.equal(r.codigo, 0, r.tudo);
    assert.match(r.saida, /R-20261109-090000-modulo-core {2}\[pedido\] de modulo-core/);

    r = await rodar(dir, ['enviar', '--de', 'testes', '--para', 'modulo-core', '--cc', 'gerente-projetos', '--tipo', 'resposta', '--responde-a', 'R-20261109-090000-modulo-core', '--encerra', '--tarefa', 'T-0143', '--assunto', 'Feito', '--corpo', 'Contexto | Fiz | Pronto'], env);
    assert.equal(r.codigo, 0, r.tudo);
    const id = r.saida.match(/Recado (R-\S+) enviado para modulo-core, gerente-projetos \(cc\) \(GitHub aloirr\/macuxifdv-recados@[0-9a-f]{7}\)/)?.[1];
    assert.ok(id, r.saida);
    assert.ok(gh.arquivos[`recados/modulo-core/${id}.md`] && gh.arquivos[`recados/gerente-projetos/${id}.md`]);
    assert.equal(gh.historico().length, 2);

    r = await rodar(dir, ['caixa', 'testes'], env);
    assert.match(r.saida, /nada pendente/, 'encerrado pela resposta lida do GitHub');
    r = await rodar(dir, ['ler', id], env);
    assert.equal(r.saida, `${gh.arquivos[`recados/modulo-core/${id}.md`]}\n`);
    r = await rodar(dir, ['fio', 'R-20261109-090000-modulo-core'], env);
    assert.match(r.saida, new RegExp(`testes → modulo-core {2}\\[resposta, encerra\\]`));
    r = await rodar(dir, ['pendencias'], env);
    assert.match(r.saida, /gerente-projetos \(1\):\n.*R-20261109-090100-alexandre/);
    assert.doesNotMatch(r.saida, /R-20261109-090000-modulo-core/);

    r = await rodar(dir, ['lido', 'gerente-projetos', id], env);
    assert.equal(r.codigo, 0, r.tudo);
    assert.match(r.saida, /1 recado\(s\) marcado\(s\) como lido\(s\) por gerente-projetos \(GitHub/);
    assert.equal(gh.arquivos['lidos/gerente-projetos.txt'], `${id}\n`);
    r = await rodar(dir, ['lido', 'gerente-projetos', id], env);
    assert.match(r.saida, /já estava\(m\) marcado/);
    for (const x of gh.chamadas) assert.doesNotMatch(x.url, new RegExp(TOKEN));
    assert.equal(readdirSync(dir).includes('.coord') && readdirSync(join(dir, '.coord')).sort().join(','), 'donos.json', 'nada gravado em .coord no disco');

    // token errado: erro claro, sem o token na saída
    r = await rodar(dir, ['enviar', '--de', 'testes', '--para', 'modulo-core', '--assunto', 'x'], { ...env, MACUXI_RECADOS_TOKEN: 'outro-token-secreto' });
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /recado NÃO enviado \(nada foi gravado\): .*recusou o token \(MACUXI_RECADOS_TOKEN, HTTP 401\)/);
    assert.doesNotMatch(r.tudo, /outro-token-secreto|token-de-teste/);
  } finally { await s.fechar(); }
});

test('CLI: recado do servidor (de diagnostico) aparece na caixa e no fio e sai com lido; enviar --de diagnostico é recusado', async () => {
  const gh = base();
  gh.externo(`recados/alexandre/${ID_DIAG}.md`, recadoDiagnostico(), 'diagnóstico (servidor)');
  gh.externo(`recados/engenheiro-apps/${ID_DIAG}.md`, recadoDiagnostico(), 'diagnóstico (servidor)');
  const s = await servir(gh);
  try {
    const dir = repoDeCodigo();
    const env = amb(dir, s.api);
    for (const quem of ['alexandre', 'engenheiro-apps']) {
      const r = await rodar(dir, ['caixa', quem], env);
      assert.equal(r.codigo, 0, r.tudo);
      assert.match(r.saida, new RegExp(`${ID_DIAG} {2}\\[aviso\\] de diagnostico`));
    }
    let r = await rodar(dir, ['fio', ID_DIAG], env);
    assert.match(r.saida, /diagnostico → alexandre, engenheiro-apps/);
    r = await rodar(dir, ['lido', 'engenheiro-apps', ID_DIAG], env);
    assert.equal(r.codigo, 0, r.tudo);
    r = await rodar(dir, ['caixa', 'engenheiro-apps'], env);
    assert.doesNotMatch(r.saida, new RegExp(ID_DIAG));
    const antes = gh.historico().length;
    for (const de of ['diagnostico', 'Diagnostico']) {
      r = await rodar(dir, ['enviar', '--de', de, '--para', 'alexandre', '--tipo', 'aviso', '--assunto', 'forjado', '--corpo', 'a | b | c'], env);
      assert.equal(r.codigo, 1, r.tudo);
      assert.match(r.erro, /remetente de sistema, só o servidor grava/);
    }
    r = await rodar(dir, ['enviar', '--de', 'testes', '--para', 'diagnostico', '--assunto', 'x', '--corpo', 'a | b | c'], env);
    assert.equal(r.codigo, 1, r.tudo);
    assert.match(r.erro, /destinatário inválido: diagnostico/);
    r = await rodar(dir, ['caixa', 'diagnostico'], env);
    assert.equal(r.codigo, 1, r.tudo);
    assert.equal(gh.historico().length, antes, 'nada saiu em nome do diagnostico nem para ele');
  } finally { await s.fechar(); }
});

test('CLI sem rede: enviar sai 1 com "NÃO enviado" e nada no GitHub; caixa mostra a cópia local com aviso', async () => {
  const gh = base();
  const s = await servir(gh);
  try {
    const dir = repoDeCodigo();
    const env = amb(dir, s.api);
    assert.equal((await rodar(dir, ['caixa', 'testes'], env)).codigo, 0); // cria o cache
    gh.offline = true;
    let r = await rodar(dir, ['enviar', '--de', 'testes', '--para', 'modulo-core', '--assunto', 'x'], env);
    assert.equal(r.codigo, 1, r.tudo);
    assert.match(r.erro, /^Erro: recado NÃO enviado \(nada foi gravado\): sem acesso ao GitHub/);
    assert.doesNotMatch(r.saida, /enviado para/);
    r = await rodar(dir, ['lido', 'testes', 'R-x'], env);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /NÃO marcado \(nada foi gravado\): sem acesso ao GitHub/);
    r = await rodar(dir, ['caixa', 'testes'], env);
    assert.equal(r.codigo, 0, r.tudo);
    assert.match(r.saida, /^Atenção: sem o GitHub agora .*cópia local/);
    assert.match(r.saida, /R-20261109-090000-modulo-core/);
    gh.offline = false;
    assert.equal(gh.historico().length, 1, 'nada gravado');
    // sem cache e sem rede: erro claro
    r = await rodar(dir, ['caixa', 'testes'], { ...env, MACUXI_RECADOS_API: 'http://127.0.0.1:9', MACUXI_RECADOS_CACHE: join(dir, 'sem-cache') });
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /sem acesso aos recados no GitHub: sem acesso ao GitHub/);
  } finally { await s.fechar(); }
});

test('CLI: vários agentes enviando e marcando ao mesmo tempo, nada se perde', async () => {
  const gh = base();
  const s = await servir(gh);
  try {
    const dir = repoDeCodigo();
    const env = amb(dir, s.api);
    const agentes = ['modulo-core', 'modulo-catalogo', 'testes', 'designer-ux'];
    const r = await Promise.all([
      ...agentes.map((a) => rodar(dir, ['enviar', '--de', a, '--para', 'gerente-projetos', '--assunto', `de ${a}`], { ...env, MACUXI_RECADOS_CACHE: join(dir, `cache-${a}`) })),
      ...['R-a', 'R-b', 'R-c'].map((id) => rodar(dir, ['lido', 'testes', id], env)),
    ]);
    for (const x of r) assert.equal(x.codigo, 0, x.tudo);
    for (const a of agentes) assert.ok(Object.keys(gh.arquivos).some((c) => c.startsWith('recados/gerente-projetos/') && c.endsWith(`-${a}.md`)), a);
    assert.deepEqual(new Set(gh.arquivos['lidos/testes.txt'].split('\n').filter(Boolean)), new Set(['R-1', 'R-a', 'R-b', 'R-c']));
    assert.equal(gh.historico().length, 1 + agentes.length + 3, 'um commit por envio e por marcação');
  } finally { await s.fechar(); }
});

test('CLI: o recado gravado no GitHub tem o mesmo formato do modo local (o formulário e o Telegram dependem dele)', async () => {
  const gh = base();
  const s = await servir(gh);
  try {
    const args = ['enviar', '--de', 'testes', '--para', 'modulo-core,designer-ux', '--tipo', 'aviso', '--prioridade', 'alta', '--contrato', 'core.x.y@1', '--assunto', 'Formato', '--corpo', 'a | b | c'];
    const dirG = repoDeCodigo();
    const g = await rodar(dirG, args, amb(dirG, s.api));
    assert.equal(g.codigo, 0, g.tudo);
    const dirL = repoDeCodigo({ marca: false });
    const l = await rodar(dirL, args, {});
    assert.equal(l.codigo, 0, l.tudo);
    const idG = g.saida.match(/Recado (\S+)/)[1];
    const idL = l.saida.match(/Recado (\S+)/)[1];
    const local = readFileSync(join(dirL, '.coord', 'recados', 'modulo-core', `${idL}.md`), 'utf8');
    const remoto = gh.arquivos[`recados/modulo-core/${idG}.md`];
    const normal = (t, id) => t.replaceAll(id, 'ID').replace(/^criado_em: .*$/m, 'criado_em: X');
    assert.equal(normal(remoto, idG), normal(local, idL));
    assert.equal(gh.arquivos[`recados/designer-ux/${idG}.md`], remoto);
  } finally { await s.fechar(); }
});

test('CLI com proxy no ambiente: o HTTP vai pelo processo filho (NODE_USE_ENV_PROXY) e respeita o NO_PROXY', async () => {
  const gh = base();
  const s = await servir(gh);
  try {
    const dir = repoDeCodigo();
    const r = await rodar(dir, ['caixa', 'testes'], amb(dir, s.api, { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1' }));
    assert.equal(r.codigo, 0, r.tudo);
    assert.match(r.saida, /R-20261109-090000-modulo-core/);
  } finally { await s.fechar(); }
});

test('subir-pendentes: sobe o que falta num commit só, une os lidos, não sobrescreve conflito e pode rodar de novo', async () => {
  const gh = base();
  gh.externo('recados/testes/R-20261109-080000-modulo-vendedor.md', recado({ id: 'R-20261109-080000-modulo-vendedor', de: 'modulo-vendedor', para: 'testes', titulo: 'no GitHub' }));
  const s = await servir(gh);
  try {
    const dir = repoDeCodigo();
    const clone = pastaTemp('clone-recados-');
    const git = (...a) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'T');
    git('config', 'user.email', 't@exemplo.invalid');
    git('config', 'commit.gpgsign', 'false');
    const escrever = (c, t) => { mkdirSync(dirname(join(clone, c)), { recursive: true }); writeFileSync(join(clone, c), t); };
    escrever('recados/testes/R-20261109-090000-modulo-core.md', gh.arquivos['recados/testes/R-20261109-090000-modulo-core.md']);
    escrever('lidos/testes.txt', 'R-1\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    // pendentes do PC: um commit local que não subiu, arquivos novos, lidos alterados e um conflito
    escrever('recados/alexandre/R-20261109-053000-gerente-projetos.md', recado({ id: 'R-20261109-053000-gerente-projetos', de: 'gerente-projetos', para: 'alexandre' }));
    git('add', '-A');
    git('commit', '-q', '-m', 'local sem push');
    escrever('recados/modulo-core/R-20261109-060000-testes.md', recado({ id: 'R-20261109-060000-testes', de: 'testes', para: 'modulo-core' }).replace(/\n/g, '\r\n'));
    escrever('recados/testes/R-20261109-080000-modulo-vendedor.md', 'outro conteúdo com o mesmo caminho\n');
    escrever('lidos/testes.txt', 'R-1\nR-pc\n');
    escrever('lidos/modulo-core.txt', 'R-mc\n');
    const env = amb(dir, s.api);
    const remotoAntes = gh.arquivos['recados/testes/R-20261109-080000-modulo-vendedor.md'];

    let r = await rodar(dir, ['--clone', clone, '--simular'], env, 'scripts/recados/subir-pendentes.mjs');
    assert.equal(r.codigo, 1, r.tudo);
    assert.match(r.saida, /2 recado\(s\)\/anexo\(s\) a subir, 2 arquivo\(s\) de lidos a unir \(2 linha\(s\)\), 0 já no GitHub, 1 conflito/);
    assert.match(r.saida, /Simulação: nada foi gravado/);
    assert.equal(gh.historico().length, 2);

    r = await rodar(dir, ['--clone', clone], env, 'scripts/recados/subir-pendentes.mjs');
    assert.equal(r.codigo, 1, r.tudo);
    assert.match(r.saida, /Subida feita e conferida/);
    assert.match(r.saida, /CONFLITO — 1 arquivo/);
    assert.equal(gh.historico().length, 3, 'um commit só');
    assert.equal(gh.arquivos['recados/testes/R-20261109-080000-modulo-vendedor.md'], remotoAntes, 'conflito não sobrescrito');
    assert.ok(gh.arquivos['recados/alexandre/R-20261109-053000-gerente-projetos.md'], 'commit local sem push');
    assert.doesNotMatch(gh.arquivos['recados/modulo-core/R-20261109-060000-testes.md'], /\r/, 'LF no GitHub');
    assert.equal(gh.arquivos['lidos/testes.txt'], 'R-1\nR-pc\n');
    assert.equal(gh.arquivos['lidos/modulo-core.txt'], 'R-mc\n');
    assert.doesNotMatch(r.tudo, /corpo|token-de-teste/, 'sem conteúdo nem token na saída');

    r = await rodar(dir, ['--clone', clone], env, 'scripts/recados/subir-pendentes.mjs');
    assert.match(r.saida, /0 recado\(s\)\/anexo\(s\) a subir, 0 arquivo\(s\) de lidos a unir \(0 linha\(s\)\), 4 já no GitHub, 1 conflito/);
    assert.equal(gh.historico().length, 3, 'rodar de novo não grava nada');
  } finally { await s.fechar(); }
});
