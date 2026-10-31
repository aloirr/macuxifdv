// Guardião de donos para o Bash — biblioteca (funções puras + acesso ao git/disco injetável).
// Usada por .claude/hooks/guarda-bash.mjs (PreToolUse/PostToolUse) e pelos testes
// (.claude/hooks/guarda-bash.test.mjs). Sem dependências externas.
//
// Antes do comando (PreToolUse): lê o comando com um analisador de shell simples e bloqueia só a
// escrita EVIDENTE em caminho de outro dono (> e >>, tee, sed -i, perl -i, cp/mv/install com
// destino, rm, touch, truncate, git checkout/restore de arquivo, git rm/mv, git reset --hard,
// git stash, git clean -f). Em dúvida ($VAR, $(...), glob, ~, xargs, scripts), não bloqueia.
// Depois do comando (PostToolUse): compara o git status (+ data e tamanho de cada arquivo) de
// antes × depois e acusa só o que mudou no disco durante o comando, sem desfazer nada sozinho.
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { AGENTES, podeAlterar, classificarMudancas } from '../../scripts/coord-lib.mjs';

// ───────────────────────────── caminhos ─────────────────────────────

const barras = (p) => String(p).replace(/\\/g, '/');
const ehWindows = (raiz) => /^[A-Za-z]:\//.test(barras(raiz));

/**
 * Caminho absoluto (com "/") a partir do cwd. Aceita "C:\x", "C:/x", "/c/x" (Git Bash, quando a
 * raiz é do Windows) e relativos com "\" ou "/". Retorna null quando não dá para saber ("~/x").
 */
export function absoluto(alvo, cwd, raiz) {
  let a = barras(alvo);
  if (a.startsWith('~')) return null;
  if (ehWindows(raiz)) {
    const m = a.match(/^\/([A-Za-z])(\/.*)?$/);
    if (m) a = `${m[1].toUpperCase()}:${m[2] || '/'}`;
  }
  let abs;
  if (/^[A-Za-z]:\//.test(a) || a.startsWith('/')) abs = a;
  else if (cwd) abs = `${barras(cwd).replace(/\/+$/, '')}/${a}`;
  else return null;
  const drive = abs.match(/^[A-Za-z]:/)?.[0] || '';
  return drive + posix.normalize(abs.slice(drive.length) || '/');
}

/** Relativo à raiz ("" = a própria raiz) ou null se estiver fora do repositório. */
export function relativoDaRaiz(abs, raiz) {
  if (abs == null) return null;
  const r = barras(raiz).replace(/\/+$/, '');
  const cmp = ehWindows(raiz) ? (s) => s.toLowerCase() : (s) => s;
  const a = abs.replace(/\/+$/, '');
  if (cmp(a) === cmp(r)) return '';
  if (cmp(a).startsWith(cmp(r) + '/')) return a.slice(r.length + 1);
  return null;
}

// ───────────────────────────── analisador de shell ─────────────────────────────

const OPERADORES = ['&>>', '&>', '>>', '>|', '>&', '<<<', '<<-', '<<', '<&', '<>', '&&', '||', ';;', '|&', '>', '<', '|', '&', ';', '(', ')'];
const REDIRECOES = new Set(['&>>', '&>', '>>', '>|', '>&', '<<<', '<<-', '<<', '<&', '<>', '>', '<']);
const ESCAPAVEIS_FORA = ' \t\'"\\$`;&|<>(){}*?[]#~!\n';

/** Fim de "$(...)", "${...}", "$VAR" ou "`...`" começando em i. */
function fimSubstituicao(s, i) {
  if (s[i] === '`') {
    const j = s.indexOf('`', i + 1);
    return j < 0 ? s.length : j + 1;
  }
  const abre = s[i + 1];
  const fecha = abre === '(' ? ')' : abre === '{' ? '}' : null;
  if (!fecha) {
    if (/[@*#?$!0-9-]/.test(abre || '')) return i + 2;
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
    return j;
  }
  let nivel = 0;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === abre) nivel++;
    else if (s[j] === fecha && --nivel === 0) return j + 1;
  }
  return s.length;
}

/**
 * Quebra o comando em tokens: {tipo:'palavra', valor, incerto} · {tipo:'op', valor} ·
 * {tipo:'redir', valor, fd}. "incerto" = depende de expansão ($VAR, $(...), glob, ~).
 * O corpo de here-doc é descartado.
 */
export function tokenizar(cmd) {
  const s = String(cmd);
  const tokens = [];
  const heredocs = [];
  let esperaDelim = null;
  let cur = null;
  let incerto = false;
  let soDigitos = true; // palavra atual só com dígitos sem aspas (ex.: "2" de 2>arq)
  const flush = () => {
    if (cur === null) return;
    if (esperaDelim) heredocs.push({ delim: cur, tabs: esperaDelim === '<<-' });
    else tokens.push({ tipo: 'palavra', valor: cur, incerto });
    esperaDelim = null;
    cur = null;
    incerto = false;
    soDigitos = true;
  };
  const add = (txt, literal = true) => {
    cur = (cur ?? '') + txt;
    if (!literal || !/^\d*$/.test(txt)) soDigitos = false;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') {
      flush();
      tokens.push({ tipo: 'op', valor: '\n' });
      i++;
      while (heredocs.length) {
        const { delim, tabs } = heredocs.shift();
        while (i < s.length) {
          let fim = s.indexOf('\n', i);
          if (fim < 0) fim = s.length;
          let linha = s.slice(i, fim).replace(/\r$/, '');
          if (tabs) linha = linha.replace(/^\t+/, '');
          i = fim + 1;
          if (linha === delim) break;
        }
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { flush(); i++; continue; }
    if (c === '#' && cur === null) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      add(j < 0 ? s.slice(i + 1) : s.slice(i + 1, j), false);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === '"') {
      add('', false);
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && '"\\$`\n'.includes(s[i + 1] ?? 'x')) { add(s[i + 1], false); i += 2; continue; }
        if (s[i] === '$' || s[i] === '`') {
          const j = fimSubstituicao(s, i);
          if (j > i + 1) { incerto = true; add(s.slice(i, j), false); i = j; continue; }
        }
        add(s[i], false);
        i++;
      }
      i++;
      continue;
    }
    if (c === '\\') {
      const prox = s[i + 1];
      if (prox === '\n') { i += 2; continue; }
      if (prox !== undefined && ESCAPAVEIS_FORA.includes(prox)) { add(prox, false); i += 2; continue; }
      add('\\', false); // barra invertida do Windows (C:\pasta\arq) fica como está
      i++;
      continue;
    }
    if (c === '$' || c === '`') {
      const j = fimSubstituicao(s, i);
      if (j > i + 1) { incerto = true; add(s.slice(i, j), false); i = j; continue; }
      add(c, false);
      i++;
      continue;
    }
    if (c === '*' || c === '?' || c === '[' || ((c === '{' || c === '}') && cur !== null) || (c === '~' && cur === null)) {
      incerto = true;
      add(c, false);
      i++;
      continue;
    }
    if (';&|<>()'.includes(c)) {
      if ((c === '<' || c === '>') && s[i + 1] === '(') { // <(...) e >(...)
        const j = fimSubstituicao(s.slice(0, i) + '$' + s.slice(i + 1), i);
        incerto = true;
        add(s.slice(i, j), false);
        i = j;
        continue;
      }
      let fd = null;
      if ((c === '>' || c === '<') && cur && soDigitos) { fd = cur; cur = null; incerto = false; soDigitos = true; }
      else flush();
      const op = OPERADORES.find((o) => s.startsWith(o, i));
      i += op.length;
      if (REDIRECOES.has(op)) {
        tokens.push({ tipo: 'redir', valor: op, fd });
        if (op === '<<' || op === '<<-') esperaDelim = op;
      } else tokens.push({ tipo: 'op', valor: op });
      continue;
    }
    add(c);
    i++;
  }
  flush();
  return tokens;
}

/** Agrupa os tokens em comandos simples: {palavras, redirs:[{op, fd, alvo}]} ou {grupo:'('|')'}. */
export function comandosSimples(tokens) {
  const lista = [];
  let atual = { palavras: [], redirs: [] };
  const fechar = (sep) => {
    if (atual.palavras.length || atual.redirs.length) lista.push(atual);
    atual = { palavras: [], redirs: [] };
    if (sep === '(' || sep === ')') lista.push({ grupo: sep });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.tipo === 'op') { fechar(t.valor); continue; }
    if (t.tipo === 'redir') {
      const prox = tokens[i + 1];
      if (t.valor !== '<<' && t.valor !== '<<-' && prox?.tipo === 'palavra') {
        atual.redirs.push({ op: t.valor, fd: t.fd, alvo: prox });
        i++;
      }
      continue;
    }
    atual.palavras.push(t);
  }
  fechar(null);
  return lista;
}

// ───────────────────────────── alvos de escrita por comando ─────────────────────────────

const PALAVRAS_CHAVE = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'time', 'esac']);
const PREFIXOS = new Set(['sudo', 'command', 'builtin', 'nohup', 'exec', 'nice', 'stdbuf', 'doas']);
/** Comandos que não alteram arquivos (sem redirecionamento): dispensam a foto do git status. */
const SO_LEITURA = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'pwd', 'echo', 'printf', 'which', 'type', 'stat', 'file', 'tree', 'du', 'df', 'date', 'whoami', 'true', 'false', 'test', '[', 'diff', 'cmp', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'jq', 'sleep', 'export', 'set', 'unset']);
const GIT_SO_LEITURA = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'grep', 'shortlog', 'describe', 'merge-base', 'cat-file', 'ls-tree', 'remote', 'fetch', 'config', 'reflog', 'version', 'help', 'branch', 'tag', 'rev-list', 'for-each-ref', 'show-ref', 'var']);
const DESCARTE = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$|^nul$/i;

const nomeBase = (p) => barras(p).replace(/\/+$/, '').split('/').pop();
const PONTO = { valor: '.', incerto: false, raiz: true };

/** Separa opções e argumentos. `comArg`: opções curtas com argumento; `longasComArg`: idem, longas. */
function opcoes(args, comArg = '', longasComArg = []) {
  const opts = [];
  const pos = [];
  let fim = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = a.valor;
    if (fim || a.incerto || !v.startsWith('-') || v === '-') { pos.push(a); continue; }
    if (v === '--') { fim = true; continue; }
    if (v.startsWith('--')) {
      const k = v.indexOf('=');
      const nome = k < 0 ? v : v.slice(0, k);
      if (k < 0 && longasComArg.includes(nome)) opts.push({ nome, valor: args[++i]?.valor });
      else opts.push({ nome, valor: k < 0 ? undefined : v.slice(k + 1) });
      continue;
    }
    for (let k = 1; k < v.length; k++) {
      if (comArg.includes(v[k])) {
        opts.push({ nome: `-${v[k]}`, valor: k + 1 < v.length ? v.slice(k + 1) : args[++i]?.valor });
        break;
      }
      opts.push({ nome: `-${v[k]}` });
    }
  }
  return {
    pos,
    tem: (...n) => opts.some((o) => n.includes(o.nome)),
    valor: (...n) => opts.find((o) => n.includes(o.nome))?.valor,
  };
}

/** sed -i / perl -i: arquivos editados no lugar. Sem -e, o primeiro argumento é o script. */
function alvosNoLugar(args, ehPerl) {
  let noLugar = false;
  let temScript = false;
  let fim = false;
  const arquivos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = a.valor;
    if (fim || a.incerto || !v.startsWith('-') || v === '-') {
      if (!temScript) temScript = true;
      else arquivos.push(a);
      continue;
    }
    if (v === '--') { fim = true; continue; }
    if (v.startsWith('--')) {
      if (v === '--in-place' || v.startsWith('--in-place=')) noLugar = true;
      else if (v === '--expression' || v === '--file') { temScript = true; i++; }
      else if (v.startsWith('--expression=') || v.startsWith('--file=')) temScript = true;
      continue;
    }
    for (let k = 1; k < v.length; k++) {
      const l = v[k];
      if (l === 'i') { noLugar = true; break; } // o resto do grupo é o sufixo do backup
      if (l === 'e' || l === 'f' || (ehPerl && l === 'E')) { temScript = true; if (k + 1 === v.length) i++; break; }
      if (ehPerl ? '0lFIMmdDxC'.includes(l) : l === 'l') { if (!ehPerl && k + 1 === v.length) i++; break; }
    }
  }
  return noLugar ? arquivos : [];
}

function alvosGit(args, ctx, res) {
  let i = 0;
  while (i < args.length && args[i].valor.startsWith('-')) {
    const v = args[i].valor;
    if (v === '-C') { res.cwdGit = args[i + 1] && !args[i + 1].incerto ? args[i + 1].valor : null; i += 2; continue; }
    if (['-c', '--git-dir', '--work-tree', '--namespace'].includes(v)) { i += 2; continue; }
    i++;
  }
  const sub = args[i]?.valor;
  if (!sub || args[i].incerto) return;
  if (GIT_SO_LEITURA.has(sub)) { res.soLeitura = !res.temRedir; return; }
  const resto = args.slice(i + 1);
  const iSep = resto.findIndex((a) => a.valor === '--');
  const antes = iSep >= 0 ? resto.slice(0, iSep) : resto;
  const depois = iSep >= 0 ? resto.slice(iSep + 1) : [];
  const push = (alvo, acao, extra = {}) => res.alvos.push({ alvo, acao, recursivo: true, ...extra });
  switch (sub) {
    case 'checkout': {
      const o = opcoes(antes, 'bB', ['--orphan', '--conflict']);
      if (o.tem('-b', '-B', '--orphan', '-p', '--patch')) return;
      if (iSep >= 0) {
        for (const a of depois) push(a, o.pos.length ? 'restaurar-ref' : 'restaurar');
        return;
      }
      // sem "--": argumento que existe no disco é caminho; o resto é ref/branch
      const caminhos = o.pos.filter((a) => !a.incerto && ctx.existe(a.valor));
      const temRef = caminhos.length < o.pos.length;
      for (const a of caminhos) push(a, temRef ? 'restaurar-ref' : 'restaurar');
      if (!caminhos.length && o.tem('-f', '--force')) push(PONTO, 'sujos');
      return;
    }
    case 'restore': {
      const o = opcoes(resto, 's', ['--source', '--pathspec-from-file']);
      if (o.tem('-p', '--patch') || (o.tem('-S', '--staged') && !o.tem('-W', '--worktree'))) return;
      const acao = o.valor('-s', '--source') != null ? 'restaurar-ref' : 'restaurar';
      for (const a of o.pos) push(a, acao);
      return;
    }
    case 'reset':
      if (resto.some((a) => ['--hard', '--merge', '--keep'].includes(a.valor))) push(PONTO, 'sujos');
      return;
    case 'stash': {
      const primeiro = resto[0] && !resto[0].valor.startsWith('-') ? resto[0].valor : null;
      if (primeiro && primeiro !== 'push' && primeiro !== 'save') return;
      const o = opcoes(primeiro ? antes.slice(1) : antes, 'm', ['--message', '--pathspec-from-file']);
      const caminhos = iSep >= 0 ? depois : primeiro === 'save' ? [] : o.pos;
      for (const a of caminhos.length ? caminhos : [PONTO]) {
        push(a, 'sujos');
        if (o.tem('-u', '--include-untracked', '-a', '--all')) push(a, 'nao-rastreados');
      }
      return;
    }
    case 'clean': {
      const o = opcoes(resto, 'e', ['--exclude']);
      if (!o.tem('-f', '--force') || o.tem('-n', '--dry-run', '-i', '--interactive')) return;
      for (const a of o.pos.length ? o.pos : [{ valor: '.', incerto: false }]) push(a, 'nao-rastreados'); // só a pasta atual
      return;
    }
    case 'rm': {
      const o = opcoes(resto);
      if (o.tem('--cached', '-n', '--dry-run')) return;
      for (const a of o.pos) push(a, 'apagar');
      return;
    }
    case 'mv': {
      const o = opcoes(resto);
      if (o.tem('-n', '--dry-run') || o.pos.length < 2) return;
      copiarMover(o.pos.slice(0, -1), o.pos[o.pos.length - 1], null, false, true, ctx, res);
      return;
    }
    default:
  }
}

/** cp/mv/install: destino (arquivo ou pasta) e, no mv, as origens (somem). */
function copiarMover(fontes, destino, pastaDestino, semPasta, mover, ctx, res) {
  if (mover) for (const f of fontes) res.alvos.push({ alvo: f, acao: 'apagar', recursivo: true });
  const pasta = pastaDestino ?? destino;
  if (!pasta || pasta.incerto) return;
  const ehPasta = pastaDestino != null || (!semPasta && (fontes.length > 1 || ctx.ehDiretorio(pasta.valor)));
  for (const f of fontes) {
    if (!ehPasta) { res.alvos.push({ alvo: destino, acao: 'escrever', recursivo: true }); continue; }
    if (f.incerto) continue;
    const alvo = { valor: `${barras(pasta.valor).replace(/\/+$/, '')}/${nomeBase(f.valor)}`, incerto: false };
    res.alvos.push({ alvo, acao: 'escrever', recursivo: true });
  }
}

/**
 * O que um comando simples altera.
 * @returns {{alvos: {alvo, acao, recursivo?}[], soLeitura: boolean, cd?: string|null, cwdGit?: string|null, subcomando?: string}}
 *  acao: 'escrever' | 'apagar' | 'restaurar' (git: arquivos sujos voltam ao índice/HEAD)
 *        | 'restaurar-ref' (git: arquivos rastreados vêm de outro ref) | 'sujos' (todos os sujos
 *        sob o caminho: reset --hard, stash) | 'nao-rastreados' (git clean, stash -u).
 */
export function alvosDoComando(cmd, ctx) {
  const res = { alvos: [], soLeitura: true, temRedir: false };
  for (const r of cmd.redirs) {
    if (r.op === '<' || r.op === '<<<' || r.op === '<&') continue;
    if (r.op === '>&' && /^(\d+|-)$/.test(r.alvo.valor)) continue;
    if (!r.alvo.incerto && DESCARTE.test(r.alvo.valor)) continue;
    res.soLeitura = false;
    res.temRedir = true;
    res.alvos.push({ alvo: r.alvo, acao: 'escrever' });
  }
  const p = cmd.palavras.slice();
  for (;;) {
    if (!p.length) return res;
    const v = p[0].valor;
    if (!p[0].incerto && /^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) p.shift();
    else if (PALAVRAS_CHAVE.has(v)) p.shift();
    else if (PREFIXOS.has(v) || v === 'env' || v === 'timeout') {
      p.shift();
      while (p.length && (p[0].valor.startsWith('-') || (v === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p[0].valor)))) p.shift();
      if (v === 'timeout') p.shift();
    } else break;
  }
  if (p[0].incerto) { res.soLeitura = false; return res; }
  const nome = nomeBase(p[0].valor).replace(/\.exe$/i, '').toLowerCase();
  const args = p.slice(1);
  if (nome === 'cd' || nome === 'pushd') {
    const a = args.find((x) => !x.valor.startsWith('-'));
    res.cd = a && !a.incerto ? a.valor : null;
    return res;
  }
  if (SO_LEITURA.has(nome)) return res;
  res.soLeitura = false;
  const escrever = (lista) => { for (const a of lista) res.alvos.push({ alvo: a, acao: 'escrever' }); };
  switch (nome) {
    case 'bash': case 'sh': case 'zsh': case 'dash': {
      const i = args.findIndex((a) => /^-[a-z]*c$/.test(a.valor));
      if (i >= 0 && args[i + 1] && !args[i + 1].incerto) res.subcomando = args[i + 1].valor;
      break;
    }
    case 'tee': escrever(opcoes(args).pos); break;
    case 'sed': escrever(alvosNoLugar(args, false)); break;
    case 'perl': escrever(alvosNoLugar(args, true)); break;
    case 'touch': escrever(opcoes(args, 'dtr').pos); break;
    case 'truncate': escrever(opcoes(args, 'sr').pos); break;
    case 'rm': case 'unlink': case 'shred':
      for (const a of opcoes(args, nome === 'shred' ? 'nsu' : '').pos) res.alvos.push({ alvo: a, acao: 'apagar', recursivo: true });
      break;
    case 'cp': case 'mv': case 'install': {
      const o = opcoes(args, nome === 'install' ? 'tSmogM' : 'tS', ['--target-directory', '--suffix', '--mode', '--owner', '--group']);
      const t = o.valor('-t', '--target-directory');
      const pastaDestino = t == null ? null : { valor: t, incerto: false };
      if (!pastaDestino && o.pos.length < 2) break;
      const fontes = pastaDestino ? o.pos : o.pos.slice(0, -1);
      const destino = pastaDestino ? null : o.pos[o.pos.length - 1];
      copiarMover(fontes, destino, pastaDestino, o.tem('-T', '--no-target-directory'), nome === 'mv', ctx, res);
      break;
    }
    case 'git': alvosGit(args, ctx, res); break;
    default:
  }
  return res;
}

// ───────────────────────────── análise completa (PreToolUse) ─────────────────────────────

/**
 * Diz se o comando Bash escreve, de forma evidente, em caminho de outro dono.
 * @param {object} p
 * @param {string} p.comando
 * @param {string} p.agente
 * @param {string|null} p.cwd   pasta onde o comando roda (entrada.cwd do hook)
 * @param {string} p.raiz       raiz do repositório
 * @param {any[]} p.regras      regras de donos (carregarDonos)
 * @param {string[]} [p.somenteLeitura]  pastas fora do repo que ninguém altera
 * @param {Set<string>} [p.permitidos]   "acao:rel" que o agente pode desfazer (acusados no PostToolUse)
 * @param {{existe(abs: string): boolean, ehDiretorio(abs: string): boolean, sujos(): {xy: string, rel: string}[], rastreadosSob(rel: string): string[]}} p.amb
 * @returns {{violacoes: {rel: string, motivo: string}[], soLeitura: boolean}}
 */
export function analisarComando({ comando, agente, cwd, raiz, regras, somenteLeitura = [], permitidos = new Set(), amb }) {
  const violacoes = [];
  const vistos = new Set();
  let soLeitura = true;
  const acusar = (rel, motivo) => {
    if (!vistos.has(rel)) { vistos.add(rel); violacoes.push({ rel, motivo }); }
  };
  const doTime = AGENTES.includes(agente);
  const conferir = (rel, acao) => {
    if (!doTime) return acusar(rel, `o agente "${agente}" não faz parte do time; só os agentes de .claude/agents podem alterar o repositório.`);
    if (permitidos.has(`${acao}:${rel}`)) return;
    if (/^\.coord\/recados\/[^/]+\/[^/]+$/i.test(rel) && amb.existe(`${barras(raiz).replace(/\/+$/, '')}/${rel}`))
      return acusar(rel, 'recados são imutáveis: responda com um recado novo (node scripts/coord.mjs enviar --responde-a <id>)');
    const r = podeAlterar({ agente, ferramenta: 'Write', rel, raiz, regras });
    if (!r.ok) acusar(rel, r.motivo);
  };
  const minus = (x) => barras(x).toLowerCase().replace(/\/+$/, '');

  const analisar = (texto, cwdInicial, profundidade) => {
    let cwdAtual = cwdInicial;
    const pilha = [];
    for (const cmd of comandosSimples(tokenizar(texto))) {
      if (cmd.grupo === '(') { pilha.push(cwdAtual); continue; }
      if (cmd.grupo === ')') { if (pilha.length) cwdAtual = pilha.pop(); continue; }
      const abs = (v, base = cwdAtual) => absoluto(v, base, raiz);
      const ctx = {
        existe: (v) => { const a = abs(v); return a ? amb.existe(a) : false; },
        ehDiretorio: (v) => { const a = abs(v); return a ? amb.ehDiretorio(a) : false; },
      };
      const r = alvosDoComando(cmd, ctx);
      if (!r.soLeitura) soLeitura = false;
      if ('cd' in r) { cwdAtual = r.cd == null ? null : abs(r.cd); continue; }
      if (r.subcomando && profundidade < 3) analisar(r.subcomando, cwdAtual, profundidade + 1);
      const cwdCmd = r.cwdGit === undefined ? cwdAtual : r.cwdGit === null ? null : abs(r.cwdGit);
      for (const t of r.alvos) {
        if (t.alvo.incerto) continue; // em dúvida, não bloqueia (o PostToolUse confere)
        const a = t.alvo.raiz ? barras(raiz).replace(/\/+$/, '') : abs(t.alvo.valor, cwdCmd);
        if (!a) continue;
        const rel = relativoDaRaiz(a, raiz);
        if (rel === null) {
          const pasta = somenteLeitura.find((sl) => minus(a) === minus(sl) || minus(a).startsWith(minus(sl) + '/'));
          if (pasta) acusar(a, `"${t.alvo.valor}" está numa pasta somente leitura (${pasta}). Copie o que precisar para dentro do repositório.`);
          continue;
        }
        const sob = (x) => rel === '' || x === rel || x.startsWith(rel + '/');
        if (t.acao === 'restaurar' || t.acao === 'sujos') {
          for (const s of amb.sujos()) if (s.xy !== '??' && sob(s.rel)) conferir(s.rel, 'restaurar');
        } else if (t.acao === 'nao-rastreados') {
          for (const s of amb.sujos()) if (s.xy === '??' && sob(s.rel)) conferir(s.rel, 'apagar');
        } else if (t.acao === 'restaurar-ref') {
          for (const f of amb.rastreadosSob(rel)) conferir(f, 'restaurar');
        } else if (!(t.recursivo && amb.ehDiretorio(a))) {
          if (rel !== '') conferir(rel, t.acao);
        } else {
          const arquivos = [...amb.rastreadosSob(rel), ...amb.sujos().filter((s) => s.xy === '??' && sob(s.rel)).map((s) => s.rel)];
          for (const f of arquivos) conferir(f, t.acao);
          if (t.acao === 'escrever' && !arquivos.length && rel !== '') conferir(`${rel}/<novo-arquivo>`, t.acao);
        }
      }
    }
  };
  analisar(comando, cwd, 0);
  return { violacoes, soLeitura };
}

export function mensagemPre(agente, violacoes) {
  const linhas = violacoes.slice(0, 15).map((v) => ` - ${v.motivo}`);
  const mais = violacoes.length > 15 ? `\n   ... e mais ${violacoes.length - 15} arquivo(s)` : '';
  return (
    `[guardião Macuxi] BLOQUEADO (Bash): o comando alteraria arquivo(s) fora dos caminhos de ${agente}:\n` +
    `${linhas.join('\n')}${mais}\n` +
    'Não contorne o bloqueio (outro comando, cópia, renomeação ou script): peça ao dono por recado.'
  );
}

// ───────────────────────────── git e disco (ambiente real) ─────────────────────────────

function git(raiz, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, windowsHide: true,
    });
  } catch {
    return null;
  }
}

/** git status: [{xy, rel}] (sem renomeações; inclui não rastreados). null se o git falhar. */
export function lerStatus(raiz) {
  const saida = git(raiz, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  if (saida === null) return null;
  return saida.split('\0').filter(Boolean).map((e) => ({ xy: e.slice(0, 2), rel: e.slice(3) }));
}

/** Ambiente real; o git status é lido uma vez só por execução. */
export function ambienteReal(raiz) {
  let st;
  const status = () => (st === undefined ? (st = lerStatus(raiz)) : st);
  return {
    status,
    existe: (abs) => existsSync(abs),
    ehDiretorio: (abs) => { try { return statSync(abs).isDirectory(); } catch { return false; } },
    sujos: () => status() || [],
    rastreadosSob: (rel) => (git(raiz, ['ls-files', '-z', '--', rel === '' ? '.' : rel]) || '').split('\0').filter(Boolean),
  };
}

// ───────────────────────────── foto antes × depois (PostToolUse) ─────────────────────────────

/** [mtimeMs, tamanho] do arquivo; [null, null] se não existir. */
export function statDe(raiz, rel) {
  try {
    const st = statSync(join(raiz, rel));
    return [st.mtimeMs, st.size];
  } catch {
    return [null, null];
  }
}

/** Conflito de merge (UU, AA, DD...): produzido pelo próprio git (pull/merge), não é acusado. */
const CONFLITO = /U|^AA$|^DD$/;

/** Foto: {rel: [xy, mtimeMs|null, tamanho|null]} dos arquivos sujos e não rastreados. */
export function fotografar(raiz, status) {
  const estado = {};
  for (const { xy, rel } of status) if (!CONFLITO.test(xy)) estado[rel] = [xy, ...statDe(raiz, rel)];
  return estado;
}

/**
 * O que mudou NO DISCO entre as fotos (função pura). Mudança só no índice (git add, commit) não conta.
 * Arquivo limpo antes e sujo depois só conta se a data dele for >= `inicio` (hora da foto de antes),
 * para não acusar o que outro agente alterou em paralelo antes do comando.
 * @param {{inicio: number, estado: object}} antes
 * @param {object} depois                  foto de depois
 * @param {(rel: string) => [number|null, number|null]} statAtual  data e tamanho atuais
 * @returns {{status: 'A'|'M'|'D', caminho: string, antes: 'limpo'|'sujo'|'novo'}[]}
 */
export function compararFotos(antes, depois, statAtual) {
  const mudancas = [];
  const ant = antes.estado || {};
  for (const [rel, [xy, mt, tam]] of Object.entries(depois)) {
    const a = ant[rel];
    if (a) {
      if (a[1] === mt && a[2] === tam) continue;
      const status = mt === null ? 'D' : a[1] === null && xy === '??' ? 'A' : 'M';
      mudancas.push({ status, caminho: rel, antes: a[0] === '??' ? 'novo' : 'sujo' });
    } else {
      if (mt !== null && mt < antes.inicio) continue;
      mudancas.push({ status: xy === '??' ? 'A' : mt === null ? 'D' : 'M', caminho: rel, antes: 'limpo' });
    }
  }
  for (const [rel, [xy, mt, tam]] of Object.entries(ant)) {
    if (rel in depois) continue;
    const [mt2, tam2] = statAtual(rel);
    if (mt2 === mt && tam2 === tam) continue; // sumiu do status sem mexer no disco (commit/add)
    mudancas.push({ status: mt2 === null ? 'D' : 'M', caminho: rel, antes: xy === '??' ? 'novo' : 'sujo' });
  }
  return mudancas;
}

/** Mudanças fora dos caminhos do agente (mesma regra do `verificar --base`). */
export function violacoesDasMudancas({ agente, mudancas, regras }) {
  const doTime = AGENTES.includes(agente);
  const { violacoes } = classificarMudancas({ agente: doTime ? agente : '\u0000nenhum', mudancas, regras, estrito: true });
  const antes = new Map(mudancas.map((m) => [m.caminho, m.antes]));
  return violacoes.map((v) => ({
    ...v,
    antes: antes.get(v.caminho),
    motivo: doTime ? v.motivo : `o agente "${agente}" não faz parte do time`,
  }));
}

/** Como desfazer cada arquivo acusado (o guardião libera exatamente esse comando). */
export function comoDesfazer(v) {
  if (v.antes === 'limpo') return v.status === 'A' ? `rm -- "${v.caminho}"` : `git restore -- "${v.caminho}"`;
  return null;
}

/** Texto devolvido ao agente no PostToolUse. */
export function mensagemPos(agente, violacoes) {
  const linhas = violacoes.slice(0, 30).map((v) => {
    const fato = v.status === 'A' ? 'criado' : v.status === 'D' ? 'apagado' : 'alterado';
    const cmd = comoDesfazer(v);
    const como = cmd
      ? `desfaça com: ${cmd}`
      : 'já estava alterado antes deste comando (possivelmente por outro agente): NÃO descarte; avise o dono por recado para conferir';
    return ` - ${v.caminho} (${fato}; dono: ${v.dono}) → ${como}`;
  });
  const mais = violacoes.length > 30 ? `\n   ... e mais ${violacoes.length - 30} arquivo(s)` : '';
  return (
    `[guardião Macuxi] ATENÇÃO: o último comando Bash alterou ${violacoes.length} arquivo(s) fora dos caminhos de ${agente}:\n` +
    `${linhas.join('\n')}${mais}\n` +
    'Nada foi desfeito automaticamente. ' +
    (violacoes.some(comoDesfazer) ? 'Desfaça você mesmo agora (o guardião libera os comandos indicados) e peça a mudança ' : 'Peça a mudança ') +
    `ao dono por recado: node scripts/coord.mjs enviar --de ${agente} --para <dono> --tipo pedido --assunto "..." --corpo "...". ` +
    'Se não foi este comando (outro agente em paralelo), avise o gerente-projetos.'
  );
}

/**
 * Atualiza a lista de arquivos acusados (o que o agente pode desfazer):
 * mantém os que continuam sujos e soma os novos que estavam limpos antes do comando.
 * @returns {Record<string, {status: string}>}
 */
export function atualizarAcusados(acusados, violacoes, sujosAgora) {
  const sujos = new Set(sujosAgora.map((s) => s.rel));
  const novo = {};
  for (const [rel, info] of Object.entries(acusados || {})) if (sujos.has(rel)) novo[rel] = info;
  for (const v of violacoes) if (comoDesfazer(v) && sujos.has(v.caminho)) novo[v.caminho] = { status: v.status };
  return novo;
}

/** Tira das mudanças o desfazer de arquivos acusados antes (voltaram ao normal: limpos ou apagados). */
export function descontarDesfeitos(mudancas, acusados, sujosAgora) {
  const sujos = new Set(sujosAgora.map((s) => s.rel));
  return mudancas.filter((m) => !(acusados && m.caminho in acusados && !sujos.has(m.caminho)));
}

/** "acao:rel" liberados no PreToolUse para desfazer o que foi acusado. */
export function permitidosDe(acusados) {
  const s = new Set();
  for (const [rel, { status }] of Object.entries(acusados || {})) s.add(`${status === 'A' ? 'apagar' : 'restaurar'}:${rel}`);
  return s;
}

// ───────────────────────────── arquivos temporários do hook ─────────────────────────────

export const PASTA_TEMP = join(tmpdir(), 'macuxi-guarda');
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 24);

/** Foto de um comando: tool_use_id (ou sessão + comando, se o Claude Code não mandar o id). */
export function arquivoFoto(entrada, pasta = PASTA_TEMP) {
  const id = entrada.tool_use_id || `cmd:${entrada.tool_input?.command || ''}`;
  return join(pasta, `foto-${hash(`${entrada.session_id || ''}|${id}`)}.json`);
}
export function arquivoAcusados(entrada, agente, pasta = PASTA_TEMP) {
  return join(pasta, `acusados-${hash(`${entrada.session_id || ''}|${agente}`)}.json`);
}

export function lerJson(arq, padrao) {
  try { return JSON.parse(readFileSync(arq, 'utf8')); } catch { return padrao; }
}
export function gravarJson(arq, dados) {
  try {
    mkdirSync(join(arq, '..'), { recursive: true });
    writeFileSync(arq, JSON.stringify(dados));
    return true;
  } catch {
    return false; // sem pasta temporária: o PostToolUse só não confere
  }
}
export function apagarArquivo(arq) {
  try { unlinkSync(arq); } catch { /* já não existe */ }
}

/** Remove fotos esquecidas (comando negado pelo usuário: o PostToolUse não roda). */
export function limparAntigos(pasta = PASTA_TEMP, maxIdadeMs = 6 * 3600 * 1000) {
  try {
    const agora = Date.now();
    for (const n of readdirSync(pasta)) {
      const arq = join(pasta, n);
      try { if (agora - statSync(arq).mtimeMs > (n.startsWith('foto-') ? maxIdadeMs : 7 * 24 * 3600 * 1000)) unlinkSync(arq); } catch { /* outro processo apagou */ }
    }
  } catch { /* pasta ainda não existe */ }
}
