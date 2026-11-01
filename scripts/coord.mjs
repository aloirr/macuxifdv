#!/usr/bin/env node
// CLI do protocolo de recados do time Macuxi — igual para todos os agentes.
//
//   node scripts/coord.mjs enviar --de <agente> --para <a,b> [--cc <c>] --tipo <tipo> --assunto "..."
//        [--corpo "..." | --arquivo caminho.md] [--tarefa T-0001] [--prioridade alta|normal|baixa]
//        [--responde-a <id>] [--encerra] [--contrato modulo.entidade.fato@1]
//        --de alexandre só na sessão do Alexandre: MACUXI_AGENTE=alexandre ou terminal fora do Claude
//        Code (sem CLAUDECODE); com MACUXI_AGENTE=<agente>, o --de tem de ser esse agente (v5, T-0044).
//   node scripts/coord.mjs caixa <agente>           recados abertos/não lidos do agente
//   node scripts/coord.mjs lido <agente> <id> [...]  marca avisos/entregas/respostas como lidos
//   node scripts/coord.mjs ler <id>                 mostra um recado
//   node scripts/coord.mjs fio <id>                 mostra a conversa (recado + respostas)
//   node scripts/coord.mjs pendencias               visão geral para o gerente (abertos por destinatário)
//   node scripts/coord.mjs dono <caminho>           quem é o dono do caminho
//   node scripts/coord.mjs verificar [agente] [--base <ref>] [--por-dono]
//        confere os arquivos alterados contra .coord/donos.json (primeira regra vence):
//        sem --base   árvore de trabalho × HEAD; arquivo de outro dono é só informativo
//                     ("Outros donos"), porque vários agentes dividem a mesma árvore
//        --base <ref> diff do branch: merge-base(HEAD, <ref>)...HEAD + não commitados e não
//                     rastreados; arquivo de outro dono é VIOLAÇÃO (uso no CI: --base origin/main)
//        sempre VIOLAÇÃO: caminho sem-dono ou congelado, recado existente alterado/apagado.
//        exceções (iguais às do guardião): recado NOVO em .coord/recados/<destino>/ e
//        .coord/diario/<agente>.md e .coord/lidos/<agente>.txt do próprio agente.
//        recado novo com o nome de outro remetente e diário/lidos de outro agente são desse
//        outro (informativo sem --base, VIOLAÇÃO com --base).
//        agente omitido: do branch <agente>/T-nnnn[-assunto], agente/T-nnnn-<agente> ou
//        alexandre/... (local ou GITHUB_HEAD_REF no CI); com --base, senão, do trailer
//        "Agente: <nome>" — todos os commits do PR com o mesmo agente (nuvem/* exige o trailer;
//        sem trailer, faltando em algum commit ou agentes diferentes → erro 2).
//        sem agente e sem --base: lista agrupada por dono (recados pelo remetente).
//        --por-dono   lista as alterações agrupadas por dono (sem agente).
//        saída: 0 = sem violação · 1 = violação · 2 = erro de uso ou de git.
//   node scripts/coord.mjs verificar --por-commit <de>..<até>
//        confere CADA commit do intervalo (git log <de>..<até>) contra o agente do trailer
//        "Agente: <nome>" DAQUELE commit, com as regras e exceções do --base (estrito).
//        commit de merge é ignorado; commit sem trailer (ou com agente desconhecido ou
//        ambíguo) → código 2 com a lista; alexandre nunca viola por dono; intervalo vazio = OK.
//        uso no CI, no push ao main: verificar --por-commit "$ANTES..$DEPOIS".
//        regra "o lock acompanha a dependência" (--base e --por-commit): pnpm-lock.yaml e
//        allowBuilds/onlyBuiltDependencies do pnpm-workspace.yaml são aceitos para o agente quando,
//        no mesmo PR/commit, ele alterou o package.json de um pacote que é dele; a saída lista
//        "lock acompanhando dependência de <pacote>" para revisão do engenheiro-software.
//        "alexandre" pelo trailer (ou pelo branch alexandre/*) é aceito e marcado na saída como
//        "identidade alexandre declarada por trailer" (o CI de governança cobre o resto).
//   node scripts/coord.mjs governanca --base <ref>
//        caminhos de governança alterados no diff do branch (merge-base(HEAD, <ref>)...HEAD +
//        não commitados): .claude/**, .coord/donos.json, scripts/coord*.mjs e .github/**.
//        saída: 0 = nenhum · 1 = algum (com a lista; o PR exige revisão do Alexandre) · 2 = erro.
//        uso no CI, só em pull_request: governanca --base origin/$BASE_REF.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  RAIZ, AGENTES, DESTINOS, TIPOS, TIPOS_QUE_EXIGEM_ENCERRAMENTO,
  carregarDonos, donoDe, caminhoRelativo, podeAlterar,
  PESSOAS, classificarMudancas, agruparPorDono, agenteDoBranch, agenteDosTrailers, trailersAgente,
  WORKSPACE_PNPM, workspaceMudouSoEmBuilds, mudancasDeGovernanca, CAMINHOS_DE_GOVERNANCA,
} from './coord-lib.mjs';

const PASTA = join(RAIZ, '.coord', 'recados');
const [, , cmd, ...resto] = process.argv;

function opcoes(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) o[k] = true;
      else { o[k] = v; i++; }
    } else o._.push(a);
  }
  return o;
}
const lista = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const falhar = (m) => { console.error(`Erro: ${m}`); process.exit(1); };

function agoraLocal() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  const loc = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return { iso: `${loc}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`, compacto: loc.replace(/[-:]/g, '').replace('T', '-') };
}

function parse(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const mm = linha.match(/^([a-z_]+):\s*(.*?)\s*(#.*)?$/i);
    if (!mm) continue;
    let v = mm[2];
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === 'null' || v === '') v = null;
    else if (v === 'true' || v === 'false') v = v === 'true';
    else v = v.replace(/^"(.*)"$/, '$1');
    meta[mm[1]] = v;
  }
  return { meta, corpo: m[2] };
}

function todosRecados() {
  const vistos = new Map();
  if (!existsSync(PASTA)) return [];
  for (const dest of readdirSync(PASTA)) {
    const dir = join(PASTA, dest);
    let arqs = [];
    try { arqs = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of arqs) {
      const r = parse(readFileSync(join(dir, f), 'utf8'));
      if (!r || !r.meta.id) continue;
      const atual = vistos.get(r.meta.id) || { ...r, pastas: [] };
      atual.pastas.push(dest);
      vistos.set(r.meta.id, atual);
    }
  }
  return [...vistos.values()].sort((a, b) => String(a.meta.criado_em).localeCompare(String(b.meta.criado_em)));
}

function encerrados(recs) {
  const s = new Set();
  for (const r of recs) if (r.meta.encerra && r.meta.responde_a) s.add(r.meta.responde_a);
  return s;
}
function lidosDe(agente) {
  const arq = join(RAIZ, '.coord', 'lidos', `${agente}.txt`);
  return existsSync(arq) ? new Set(readFileSync(arq, 'utf8').split(/\r?\n/).filter(Boolean)) : new Set();
}
const titulo = (r) => (r.corpo.match(/^#\s+(.+)$/m) || [null, '(sem assunto)'])[1];
const idade = (r) => {
  const h = (Date.now() - new Date(r.meta.criado_em).getTime()) / 36e5;
  return h < 24 ? `${Math.max(0, Math.round(h))}h` : `${Math.round(h / 24)}d`;
};
const linha = (r) =>
  `  ${r.meta.prioridade === 'alta' ? '!' : ' '} ${r.meta.id}  [${r.meta.tipo}] de ${r.meta.de} · ${idade(r)}${r.meta.tarefa ? ' · ' + r.meta.tarefa : ''}\n      ${titulo(r)}`;

function abertosPara(agente, recs, fechados) {
  const lidos = lidosDe(agente);
  return recs.filter((r) => {
    const direto = (r.meta.para || []).includes(agente) || (r.meta.para || []).includes('todos');
    const copia = (r.meta.cc || []).includes(agente);
    if ((!direto && !copia) || r.meta.de === agente) return false;
    if (fechados.has(r.meta.id)) return false;
    if (direto && TIPOS_QUE_EXIGEM_ENCERRAMENTO.includes(r.meta.tipo)) return true;
    return !lidos.has(r.meta.id); // informativo ou cópia: some ao marcar como lido
  });
}

// ---------------------------------------------------------------- verificar
const USO_VERIFICAR = [
  'uso: node scripts/coord.mjs verificar [agente] [--base <ref>] [--por-dono]',
  '     node scripts/coord.mjs verificar --por-commit <de>..<até>   (cada commit contra o agente do próprio trailer)',
  `  agente: ${PESSOAS.join(', ')}`,
  '  sem agente: inferido do branch <agente>/T-nnnn[-assunto], agente/T-nnnn-<agente> ou alexandre/... (ou GITHUB_HEAD_REF);',
  '              com --base, também do trailer "Agente: <nome>" de todos os commits do PR (obrigatório em nuvem/*);',
  '              sem --base e sem agente: lista as alterações agrupadas por dono',
  '  exemplos: node scripts/coord.mjs verificar modulo-core',
  '            node scripts/coord.mjs verificar modulo-core --base origin/main',
].join('\n');

class ErroUso extends Error {}
const erroUso = (m, uso = true) => { throw new ErroUso(uso ? `${m}\n${USO_VERIFICAR}` : m); };

function git(args, { falha } = {}) {
  try {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (falha === null) return null;
    erroUso(`${falha || 'falha no git'} (git ${args.join(' ')}: ${String(e.stderr || e.message).trim()})`, false);
  }
}

/** "A\0caminho\0M\0outro\0" → [{status, caminho}] */
function lerNameStatusZ(out) {
  const t = String(out || '').split('\0');
  const r = [];
  for (let i = 0; i + 1 < t.length; i += 2) if (t[i]) r.push({ status: t[i], caminho: t[i + 1] });
  return r;
}

/** Arquivos alterados contra `base` (merge-base) ou contra HEAD, somando os não rastreados. */
function coletarMudancas(base) {
  if (git(['rev-parse', '--is-inside-work-tree'], { falha: null }) === null) erroUso('não é um repositório git', false);
  const VAZIA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // árvore vazia do git
  const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { falha: null })?.trim() || null;
  let ref;
  let descricao;
  if (base) {
    if (!head) erroUso('--base exige ao menos um commit no HEAD', false);
    const alvo = git(['rev-parse', '--verify', '-q', `${base}^{commit}`], { falha: null })?.trim();
    if (!alvo) erroUso(`ref não encontrada: ${base}. Num checkout limpo (CI) busque a base antes: git fetch origin main (ou actions/checkout com fetch-depth: 0)`, false);
    const mb = git(['merge-base', 'HEAD', alvo], { falha: null })?.trim();
    if (!mb) {
      const raso = git(['rev-parse', '--is-shallow-repository'], { falha: null })?.trim() === 'true';
      erroUso(`sem merge-base entre HEAD e "${base}"${raso ? ': o clone é raso (shallow); use git fetch --unshallow ou actions/checkout com fetch-depth: 0' : ''}`, false);
    }
    ref = mb;
    descricao = `merge-base de HEAD com ${base} (${mb.slice(0, 7)}) + não commitados`;
  } else {
    ref = head || VAZIA;
    descricao = head ? 'árvore de trabalho × HEAD' : 'árvore de trabalho (repositório sem commits)';
  }
  // `git diff <ref>` compara a árvore de trabalho (inclui o que está no índice) com <ref>;
  // com <ref> = merge-base equivale a <merge-base>...HEAD somado ao que não foi commitado.
  const rastreados = lerNameStatusZ(git(['-c', 'core.quotepath=off', 'diff', '--name-status', '--no-renames', '-z', ref, '--']));
  const novos = String(git(['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).map((caminho) => ({ status: 'A', caminho }));
  return { mudancas: [...rastreados, ...novos], descricao, mb: base ? ref : null };
}

/** Branch atual (nulo com HEAD destacado) e o do PR no CI (GITHUB_HEAD_REF). */
function branches() {
  const local = git(['rev-parse', '--abbrev-ref', 'HEAD'], { falha: null })?.trim();
  return { local: local && local !== 'HEAD' ? local : null, ci: process.env.GITHUB_HEAD_REF || null };
}

/** Agente pelo branch local ou pelo do CI; erro de uso se o branch indica alguém fora do time. */
function agentePeloBranch({ local, ci }) {
  let nuvem = null;
  for (const [b, rotulo] of [[local, ''], [ci, ' (GITHUB_HEAD_REF)']]) {
    if (!b) continue;
    const r = agenteDoBranch(b);
    if (r.erro) erroUso(r.erro);
    if (r.agente) return { agente: r.agente, origem: `branch ${b}${rotulo}` };
    if (r.nuvem && !nuvem) nuvem = b;
  }
  return { agente: null, nuvem };
}

/** Commits do PR (sem merges) entre o merge-base e HEAD, com o corpo da mensagem. */
function commitsDoPr(mb) {
  const out = git(['log', '--no-merges', '--format=%H%x1f%s%x1f%B%x1e', `${mb}..HEAD`]);
  return String(out).split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean).map((s) => {
    const [sha, assunto, corpo] = s.split('\x1f');
    return { sha, assunto, corpo };
  });
}

function agentePelosTrailers(mb, nuvem) {
  const commits = commitsDoPr(mb);
  const r = agenteDosTrailers(commits);
  if (r.agente) return { agente: r.agente, origem: `trailer "Agente:" de ${commits.length} commit(s) do PR` };
  if (nuvem) {
    const det = r.erro === 'sem-trailer' ? '' : `: ${r.mensagem}`;
    erroUso(`o branch ${nuvem} exige o trailer "Agente: <nome>" em todos os commits do PR${det}`);
  }
  if (r.erro === 'sem-trailer') erroUso('informe o agente ou use branch <agente>/T-nnnn (ou o trailer "Agente: <nome>" em todos os commits do PR)');
  erroUso(r.mensagem);
}

/** Conteúdo de <ref>:<caminho> no git ('' se não existir). */
function conteudoNoGit(ref, caminho) {
  return git(['show', `${ref}:${caminho}`], { falha: null }) ?? '';
}

/** O pnpm-workspace.yaml do --base mudou só em allowBuilds/onlyBuiltDependencies (merge-base × árvore)? */
function workspaceSoBuildsBase(mb) {
  return () => {
    let depois = '';
    try { depois = readFileSync(join(RAIZ, WORKSPACE_PNPM), 'utf8'); } catch { depois = ''; }
    return workspaceMudouSoEmBuilds(conteudoNoGit(mb, WORKSPACE_PNPM), depois);
  };
}

/** Idem, num commit (contra o primeiro pai). */
function workspaceSoBuildsCommit(sha) {
  return () => {
    const pai = git(['rev-parse', '--verify', '-q', `${sha}^1`], { falha: null })?.trim();
    return workspaceMudouSoEmBuilds(pai ? conteudoNoGit(pai, WORKSPACE_PNPM) : '', conteudoNoGit(sha, WORKSPACE_PNPM));
  };
}

const TITULO_ACOMPANHANDO = 'Lock acompanhando dependência (aceito — revisão do engenheiro-software)';
const DECLARADA_TRAILER = 'identidade alexandre declarada por trailer';
const DECLARADA_BRANCH = 'identidade alexandre declarada por branch';

function imprimirLista(tituloSecao, itens, fmt) {
  if (!itens.length) return;
  console.log(`\n${tituloSecao} (${itens.length}):`);
  for (const i of itens) console.log(`  ${i.status} ${i.caminho}${fmt(i)}`);
}

/** Lista agrupada por dono (sem agente): recados pelo remetente, diário/lidos pelo agente. */
function listarPorDono(mudancas, descricao, regras) {
  const { grupos, violacoes } = agruparPorDono({ mudancas, regras });
  console.log(`Alterações por dono — ${descricao}`);
  for (const [d, itens] of Object.entries(grupos).sort()) console.log(`${d} (${itens.length}):\n` + itens.map((i) => `  ${i.status} ${i.caminho}`).join('\n'));
  imprimirLista('VIOLAÇÃO', violacoes, (i) => ` → dono: ${i.dono} — ${i.motivo}`);
  const total = mudancas.length ? `${Object.values(grupos).flat().length + violacoes.length} arquivo(s) alterado(s)` : 'nenhum arquivo alterado';
  if (violacoes.length) {
    console.log(`\nResultado: VIOLAÇÃO — ${violacoes.length} de ${total} fora das regras (sem-dono, congelado ou recado).`);
    process.exit(1);
  }
  console.log(`\nResultado: OK — ${total}, nenhum sem-dono, congelado ou recado alterado.`);
  process.exit(0);
}

/** Arquivos alterados por um commit contra o primeiro pai (commit raiz: contra a árvore vazia). */
function mudancasDoCommit(sha) {
  return lerNameStatusZ(git(['-c', 'core.quotepath=off', 'diff-tree', '--root', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z', sha, '--']));
}

/**
 * `verificar --por-commit <de>..<até>`: cada commit (sem merges) contra o agente do próprio trailer.
 * Saída 0 = sem violação · 1 = violação · 2 = commit sem trailer/agente inválido ou ambíguo, ou erro de git.
 */
function verificarPorCommit(intervalo, regras) {
  const m = String(intervalo).match(/^([^.\s]+)\.\.([^.\s]+)$/);
  if (!m) erroUso(`--por-commit exige um intervalo <de>..<até> (ex.: --por-commit origin/main..HEAD); recebido: ${intervalo}`);
  if (git(['rev-parse', '--is-inside-work-tree'], { falha: null }) === null) erroUso('não é um repositório git', false);
  const [, de, ate] = m;
  if (/^0+$/.test(de)) erroUso(`o início do intervalo é ${de} (push que criou o branch?): informe um commit existente como <de>`, false);
  for (const ref of [de, ate]) {
    if (!git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { falha: null })?.trim())
      erroUso(`ref não encontrada: ${ref}. No CI use actions/checkout com fetch-depth: 0 (ou git fetch do commit)`, false);
  }
  const out = git(['log', '--reverse', '--format=%H%x1f%P%x1f%s%x1f%B%x1e', `${de}..${ate}`]);
  const commits = String(out).split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean).map((s) => {
    const [sha, pais, assunto, corpo] = s.split('\x1f');
    return { sha, curto: sha.slice(0, 7), merge: pais.trim().split(/\s+/).filter(Boolean).length > 1, assunto, corpo: corpo || '' };
  });
  console.log(`Verificação de donos por commit — ${de}..${ate} (${commits.length} commit(s))`);
  if (!commits.length) {
    console.log('\nResultado: OK — nenhum commit no intervalo.');
    process.exit(0);
  }
  const semAgente = [];
  const comViolacao = [];
  const declarados = [];
  const acompanhando = [];
  let conferidos = 0;
  for (const c of commits) {
    const cab = `\n== ${c.curto} ${c.assunto}`;
    if (c.merge) { console.log(`${cab}\n   commit de merge — ignorado`); continue; }
    const nomes = trailersAgente(c.corpo);
    const invalidos = nomes.filter((n) => !PESSOAS.includes(n));
    if (!nomes.length || invalidos.length || nomes.length > 1) {
      const motivo = !nomes.length ? 'sem o trailer "Agente: <nome>"'
        : invalidos.length ? `trailer "Agente: ${invalidos.join(', ')}" não é um agente do time`
          : `agente ambíguo: ${[...nomes].sort().join(', ')}`;
      console.log(`${cab}\n   ERRO: ${motivo}`);
      semAgente.push({ ...c, motivo });
      continue;
    }
    const agente = nomes[0];
    conferidos++;
    const r = classificarMudancas({
      agente, mudancas: mudancasDoCommit(c.sha), regras, estrito: true, lockAcompanha: true, workspaceSoBuilds: workspaceSoBuildsCommit(c.sha),
    });
    console.log(`${cab} — agente: ${agente} (trailer)`);
    if (agente === 'alexandre') {
      console.log(`   Atenção: ${DECLARADA_TRAILER} (aceita aqui; o CI de governança cobre o resto)`);
      declarados.push(c);
    }
    imprimirLista('  OK', r.ok, () => '');
    imprimirLista('  Exceções do protocolo', r.excecoes, (i) => ` — ${i.motivo}`);
    imprimirLista(`  ${TITULO_ACOMPANHANDO}`, r.acompanhando, (i) => ` → dono: ${i.dono} — ${i.motivo}`);
    if (r.acompanhando.length) acompanhando.push({ ...c, agente, itens: r.acompanhando });
    imprimirLista('  Outros donos (informativo — alexandre pode alterar)', r.outros, (i) => ` → ${i.dono}`);
    imprimirLista('  VIOLAÇÃO', r.violacoes, (i) => ` → dono: ${i.dono} — ${i.motivo}`);
    if (r.violacoes.length) comViolacao.push({ ...c, agente, n: r.violacoes.length });
  }
  if (declarados.length) {
    console.log(`\nAtenção: ${DECLARADA_TRAILER} em ${declarados.length} commit(s) (o CI de governança cobre o resto):`);
    for (const c of declarados) console.log(`  ${c.curto} ${c.assunto}`);
  }
  if (acompanhando.length) {
    console.log(`\nRevisão do engenheiro-software — lock acompanhando dependência em ${acompanhando.length} commit(s):`);
    for (const c of acompanhando) console.log(`  ${c.curto} (${c.agente}) — ${[...new Set(c.itens.map((i) => i.motivo))].join('; ')}`);
  }
  if (comViolacao.length) {
    console.log(`\nVIOLAÇÃO em ${comViolacao.length} commit(s):`);
    for (const c of comViolacao) console.log(`  ${c.curto} (${c.agente}) — ${c.n} arquivo(s) fora das regras`);
  }
  if (semAgente.length) {
    console.error(`\nErro: ${semAgente.length} commit(s) sem agente identificável pelo trailer "Agente: <nome>":`);
    for (const c of semAgente) console.error(`  ${c.curto} ${c.assunto} — ${c.motivo}`);
    process.exit(2);
  }
  if (comViolacao.length) {
    console.log(`\nResultado: VIOLAÇÃO — ${comViolacao.length} de ${conferidos} commit(s) conferido(s).`);
    process.exit(1);
  }
  console.log(`\nResultado: OK — ${conferidos} commit(s) conferido(s), nenhuma violação.`);
  process.exit(0);
}

function verificar(args) {
  try {
    const o = opcoes(args.flatMap((a) => (/^--[^=]+=/.test(a) ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a])));
    for (const k of Object.keys(o)) if (k !== '_' && k !== 'base' && k !== 'por-dono' && k !== 'por-commit') erroUso(`opção desconhecida: --${k}`);
    if (o._.length > 1) erroUso(`argumentos demais: ${o._.join(' ')}`);
    if (o.base === true || o.base === '') erroUso('--base exige uma ref (ex.: --base origin/main)');
    const base = o.base || null;
    const regras = carregarDonos();

    if ('por-commit' in o) {
      if (o['por-commit'] === true || o['por-commit'] === '') erroUso('--por-commit exige um intervalo <de>..<até>');
      if (o._.length || base || o['por-dono']) erroUso('--por-commit não se combina com agente, --base ou --por-dono (o agente vem do trailer de cada commit)');
      verificarPorCommit(o['por-commit'], regras);
    }

    if (o['por-dono']) {
      const { mudancas, descricao } = coletarMudancas(base);
      listarPorDono(mudancas, descricao, regras);
    }

    // Ordem: agente informado > branch (local ou GITHUB_HEAD_REF) > trailers dos commits (só com --base).
    let agente = o._[0];
    let origem = 'informado';
    let nuvem = null;
    if (agente && !PESSOAS.includes(agente)) erroUso(`agente desconhecido: ${agente}`);
    if (!agente) ({ agente, origem, nuvem } = agentePeloBranch(branches()));

    const { mudancas, descricao, mb } = coletarMudancas(base);
    if (!agente) {
      // Sem --base a árvore é compartilhada: sem agente, só a lista por dono (os commits não dizem quem mexeu nela).
      if (!base) listarPorDono(mudancas, descricao, regras);
      if (!mudancas.length) {
        console.log(`Verificação de donos — sem agente\nComparação: ${descricao}\n\nResultado: OK — nenhum arquivo alterado.`);
        process.exit(0);
      }
      ({ agente, origem } = agentePelosTrailers(mb, nuvem));
    }

    const r = classificarMudancas({
      agente, mudancas, regras, estrito: Boolean(base), lockAcompanha: Boolean(base), workspaceSoBuilds: base ? workspaceSoBuildsBase(mb) : false,
    });
    const declarada = agente !== 'alexandre' ? '' : origem.startsWith('trailer') ? DECLARADA_TRAILER : origem.startsWith('branch') ? DECLARADA_BRANCH : '';
    console.log(`Verificação de donos — agente: ${agente} (${origem})`);
    console.log(`Comparação: ${descricao}`);
    if (declarada) console.log(`Atenção: ${declarada} (aceita aqui; o CI de governança cobre o resto).`);
    imprimirLista('OK', r.ok, () => '');
    imprimirLista('Exceções do protocolo', r.excecoes, (i) => ` — ${i.motivo}`);
    imprimirLista(TITULO_ACOMPANHANDO, r.acompanhando, (i) => ` → dono: ${i.dono} — ${i.motivo}`);
    imprimirLista(base ? 'Outros donos (informativo — alexandre pode alterar)' : 'Outros donos (informativo — não muda o resultado)', r.outros, (i) => ` → ${i.dono}`);
    imprimirLista('VIOLAÇÃO', r.violacoes, (i) => ` → dono: ${i.dono} — ${i.motivo}`);
    const total = mudancas.length ? `${r.ok.length + r.excecoes.length + r.acompanhando.length + r.outros.length + r.violacoes.length} arquivo(s) alterado(s)` : 'nenhum arquivo alterado';
    if (r.violacoes.length) {
      console.log(`\nResultado: VIOLAÇÃO — ${r.violacoes.length} de ${total} fora das regras para ${agente}.`);
      process.exit(1);
    }
    const revisao = r.acompanhando.length ? ` (${r.acompanhando.length} com lock acompanhando dependência: revisão do engenheiro-software)` : '';
    console.log(`\nResultado: OK — ${total}, nenhuma violação para ${agente}${revisao}.`);
    process.exit(0);
  } catch (e) {
    if (!(e instanceof ErroUso)) throw e;
    console.error(`Erro: ${e.message}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- governanca
const USO_GOVERNANCA = [
  'uso: node scripts/coord.mjs governanca --base <ref>',
  `  lista os caminhos de governança alterados no diff do branch: ${CAMINHOS_DE_GOVERNANCA.join(', ')}`,
  '  saída: 0 = nenhum · 1 = algum (o PR exige revisão do Alexandre) · 2 = erro de uso ou de git',
  '  exemplo (CI, só em pull_request): node scripts/coord.mjs governanca --base origin/$BASE_REF',
].join('\n');

function governanca(args) {
  try {
    const o = opcoes(args.flatMap((a) => (/^--[^=]+=/.test(a) ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a])));
    for (const k of Object.keys(o)) if (k !== '_' && k !== 'base') throw new ErroUso(`opção desconhecida: --${k}\n${USO_GOVERNANCA}`);
    if (o._.length) throw new ErroUso(`argumento inesperado: ${o._.join(' ')}\n${USO_GOVERNANCA}`);
    if (!o.base || o.base === true) throw new ErroUso(`--base exige uma ref (ex.: --base origin/main)\n${USO_GOVERNANCA}`);
    const { mudancas, descricao } = coletarMudancas(o.base);
    const achados = mudancasDeGovernanca(mudancas);
    console.log(`Governança — ${descricao}`);
    console.log(`Caminhos de governança: ${CAMINHOS_DE_GOVERNANCA.join(', ')}`);
    if (achados.length) {
      imprimirLista('Caminhos de governança alterados', achados, () => '');
      console.log(`\nResultado: GOVERNANÇA — ${achados.length} arquivo(s) de governança alterado(s): o PR exige revisão do Alexandre (sem merge automático).`);
      process.exit(1);
    }
    console.log(`\nResultado: OK — nenhum caminho de governança alterado (${mudancas.length} arquivo(s) no diff).`);
    process.exit(0);
  } catch (e) {
    if (!(e instanceof ErroUso)) throw e;
    console.error(`Erro: ${e.message}`);
    process.exit(2);
  }
}

switch (cmd) {
  case 'enviar': {
    const o = opcoes(resto);
    const de = o.de;
    const para = lista(o.para);
    const cc = lista(o.cc);
    const tipo = o.tipo || 'pedido';
    if (!AGENTES.includes(de) && de !== 'alexandre') falhar(`--de inválido. Use um de: ${AGENTES.join(', ')}, alexandre`);
    // Guardião v5 (T-0044): recado como alexandre só da sessão dele — MACUXI_AGENTE=alexandre ou o
    // terminal dele, fora do Claude Code (sem CLAUDECODE). O guarda-bash também barra o --de alheio,
    // inclusive de subagente (que herda MACUXI_AGENTE).
    const naSessao = String(process.env.MACUXI_AGENTE || '').trim().toLowerCase();
    if (de === 'alexandre' && (naSessao ? naSessao !== 'alexandre' : Boolean(process.env.CLAUDECODE)))
      falhar('--de alexandre só na sessão do Alexandre (MACUXI_AGENTE=alexandre ou o terminal dele, fora do Claude Code). Envie com o seu nome: --de <agente>');
    if (naSessao && naSessao !== 'alexandre' && PESSOAS.includes(naSessao) && de !== naSessao)
      falhar(`esta sessão é de ${naSessao} (MACUXI_AGENTE): envie com --de ${naSessao}`);
    if (!para.length) falhar('informe --para');
    for (const p of [...para, ...cc]) if (!DESTINOS.includes(p)) falhar(`destinatário inválido: ${p}`);
    if (!TIPOS.includes(tipo)) falhar(`--tipo inválido. Use: ${TIPOS.join(', ')}`);
    if (!o.assunto || o.assunto === true) falhar('informe --assunto');
    const prioridade = ['alta', 'normal', 'baixa'].includes(o.prioridade) ? o.prioridade : 'normal';
    if (o['responde-a']) {
      const ids = new Set(todosRecados().map((r) => r.meta.id));
      if (!ids.has(o['responde-a'])) falhar(`--responde-a: recado ${o['responde-a']} não encontrado`);
    }
    if (tipo === 'bloqueio' && !cc.includes('gerente-projetos') && !para.includes('gerente-projetos')) cc.push('gerente-projetos');
    let corpo = '';
    if (o.arquivo && o.arquivo !== true) corpo = readFileSync(o.arquivo, 'utf8');
    else if (o.corpo && o.corpo !== true) {
      const partes = String(o.corpo).split('|').map((s) => s.trim());
      corpo = partes.length >= 3
        ? `## Contexto\n${partes[0]}\n\n## O que preciso / o que mudou\n${partes[1]}\n\n## Pronto quando\n${partes.slice(2).join(' | ')}\n`
        : `${o.corpo}\n`;
    } else corpo = '## Contexto\n\n## O que preciso / o que mudou\n\n## Pronto quando\n';
    const t = agoraLocal();
    let id = `R-${t.compacto}-${de}`;
    const existentes = new Set(todosRecados().map((r) => r.meta.id));
    for (let n = 2; existentes.has(id); n++) id = `R-${t.compacto}-${n}-${de}`;
    const conteudo = [
      '---',
      `id: ${id}`,
      `de: ${de}`,
      `para: [${para.join(', ')}]`,
      `cc: [${cc.join(', ')}]`,
      `tipo: ${tipo}`,
      `prioridade: ${prioridade}`,
      `tarefa: ${o.tarefa && o.tarefa !== true ? o.tarefa : 'null'}`,
      `responde_a: ${o['responde-a'] || 'null'}`,
      `encerra: ${o.encerra ? 'true' : 'false'}`,
      `contrato: ${o.contrato && o.contrato !== true ? o.contrato : 'null'}`,
      `criado_em: ${t.iso}`,
      '---',
      `# ${o.assunto}`,
      '',
      corpo,
    ].join('\n');
    const regras = carregarDonos();
    for (const d of new Set([...para, ...cc])) {
      const dir = join(PASTA, d);
      mkdirSync(dir, { recursive: true });
      const rel = `.coord/recados/${d}/${id}.md`;
      if (AGENTES.includes(de)) {
        const r = podeAlterar({ agente: de, ferramenta: 'Write', rel, regras });
        if (!r.ok) falhar(r.motivo);
      }
      writeFileSync(join(RAIZ, rel), conteudo, 'utf8');
    }
    console.log(`Recado ${id} enviado para ${[...para, ...cc.map((c) => c + ' (cc)')].join(', ')}`);
    break;
  }

  case 'caixa': {
    const agente = resto[0];
    if (!DESTINOS.includes(agente)) falhar('informe o agente: node scripts/coord.mjs caixa <agente>');
    const recs = todosRecados();
    const abertos = abertosPara(agente, recs, encerrados(recs));
    if (!abertos.length) { console.log(`Caixa de ${agente}: nada pendente.`); break; }
    const exige = (r) => TIPOS_QUE_EXIGEM_ENCERRAMENTO.includes(r.meta.tipo) && ((r.meta.para || []).includes(agente) || (r.meta.para || []).includes('todos'));
    const acao = abertos.filter(exige);
    const info = abertos.filter((r) => !exige(r));
    console.log(`Caixa de ${agente}: ${acao.length} exigem ação, ${info.length} informativos não lidos`);
    if (acao.length) console.log('\nExigem ação (responda com --responde-a; quem resolve usa --encerra):\n' + acao.map(linha).join('\n'));
    if (info.length) console.log('\nInformativos (marque com: node scripts/coord.mjs lido ' + agente + ' <id>):\n' + info.map(linha).join('\n'));
    break;
  }

  case 'lido': {
    const [agente, ...ids] = resto;
    if (!DESTINOS.includes(agente) || !ids.length) falhar('uso: lido <agente> <id> [...]');
    const dir = join(RAIZ, '.coord', 'lidos');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${agente}.txt`), ids.map((i) => i + '\n').join(''), 'utf8');
    console.log(`${ids.length} recado(s) marcado(s) como lido(s) por ${agente}.`);
    break;
  }

  case 'ler': {
    const r = todosRecados().find((x) => x.meta.id === resto[0]);
    if (!r) falhar('recado não encontrado');
    console.log(readFileSync(join(PASTA, r.pastas[0], `${r.meta.id}.md`), 'utf8'));
    break;
  }

  case 'fio': {
    const recs = todosRecados();
    const raiz = recs.find((x) => x.meta.id === resto[0]);
    if (!raiz) falhar('recado não encontrado');
    const fio = [raiz];
    const ids = new Set([raiz.meta.id]);
    for (const r of recs) if (ids.has(r.meta.responde_a)) { fio.push(r); ids.add(r.meta.id); }
    for (const r of fio) console.log(`${r.meta.criado_em}  ${r.meta.de} → ${(r.meta.para || []).join(', ')}  [${r.meta.tipo}${r.meta.encerra ? ', encerra' : ''}]\n  ${titulo(r)}\n${r.corpo.split('\n').slice(1).join('\n').trim().replace(/^/gm, '    ')}\n`);
    break;
  }

  case 'pendencias': {
    const recs = todosRecados();
    const fechados = encerrados(recs);
    const abertos = recs.filter((r) => TIPOS_QUE_EXIGEM_ENCERRAMENTO.includes(r.meta.tipo) && !fechados.has(r.meta.id));
    if (!abertos.length) { console.log('Nenhuma pendência aberta entre os agentes.'); break; }
    const bloqueios = abertos.filter((r) => r.meta.tipo === 'bloqueio');
    if (bloqueios.length) console.log(`BLOQUEIOS (${bloqueios.length}):\n` + bloqueios.map(linha).join('\n') + '\n');
    const porDest = {};
    for (const r of abertos) for (const d of r.meta.para || []) (porDest[d] ||= []).push(r);
    for (const [d, rs] of Object.entries(porDest).sort()) console.log(`${d} (${rs.length}):\n` + rs.map(linha).join('\n'));
    break;
  }

  case 'dono': {
    const rel = caminhoRelativo(resto[0] || '');
    if (!rel) falhar('caminho fora do repositório');
    console.log(`${rel} → ${donoDe(rel, carregarDonos())}`);
    break;
  }

  case 'verificar': {
    verificar(resto);
    break;
  }

  case 'governanca': {
    governanca(resto);
    break;
  }

  default:
    console.log(ajuda());
}

/** Ajuda = bloco de comentários do topo deste arquivo. */
function ajuda() {
  const linhas = readFileSync(new URL(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
  const fim = linhas.findIndex((l) => !l.startsWith('//'));
  return linhas.slice(0, fim < 0 ? linhas.length : fim).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}
