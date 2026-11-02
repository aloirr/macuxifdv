// Guardião de donos para o Bash — biblioteca (funções puras + acesso ao git/disco injetável).
// Usada por .claude/hooks/guarda-bash.mjs (PreToolUse/PostToolUse) e pelos testes
// (.claude/hooks/guarda-bash.test.mjs). Sem dependências externas.
//
// Antes do comando (PreToolUse): lê o comando com um analisador de shell simples e bloqueia só a
// escrita EVIDENTE em caminho de outro dono (> e >>, tee, sed -i, perl -i, cp/mv/install/ln com
// destino, rm, touch, truncate, chmod/chown/chgrp, dd of=, curl -o, wget -O, tar -x -C / tar -c -f,
// unzip -d, patch, rsync, git checkout/restore de arquivo, git rm/mv, git apply/am, git reset
// --hard, git stash, git clean -f). Em dúvida ($VAR, $(...), glob, ~, xargs, scripts), não bloqueia.
// Os alvos evidentes vão na foto para o PostToolUse.
// Depois do comando (PostToolUse): compara o git status (+ data e tamanho de cada arquivo) de
// antes × depois. Só bloqueia e manda desfazer ALVO EVIDENTE do comando que estava limpo antes;
// o resto (outro agente em paralelo na mesma árvore) vira aviso não bloqueante. Não desfaz nada.
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PESSOAS, podeAlterar, classificarMudancas } from '../../scripts/coord-lib.mjs';

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
export const SO_LEITURA = new Set([
  'ls', 'dir', 'cat', 'bat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'wc', 'pwd',
  'echo', 'printf', 'which', 'where', 'type', 'stat', 'file', 'tree', 'du', 'df', 'date', 'whoami', 'id', 'hostname',
  'uname', 'printenv', 'true', 'false', 'test', '[', 'diff', 'cmp', 'comm', 'uniq', 'cut', 'tr', 'nl', 'tac', 'rev',
  'column', 'fold', 'paste', 'od', 'xxd', 'hexdump', 'md5sum', 'sha1sum', 'sha256sum', 'basename', 'dirname',
  'realpath', 'readlink', 'jq', 'sleep', 'seq', 'expr', 'export', 'set', 'unset', 'ps',
]);
export const GIT_SO_LEITURA = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'grep', 'shortlog', 'describe', 'merge-base', 'cat-file', 'ls-tree', 'remote', 'fetch', 'config', 'reflog', 'version', 'help', 'branch', 'tag', 'rev-list', 'for-each-ref', 'show-ref', 'var', 'whatchanged', 'count-objects', 'check-ignore', 'name-rev', 'ls-remote', 'diff-tree', 'diff-files', 'diff-index']);
/** Subcomandos de scripts/coord.mjs que só leem (caixa, ler, fio, dono, pendencias, verificar). */
export const COORD_SO_LEITURA = new Set(['caixa', 'ler', 'fio', 'dono', 'pendencias', 'verificar', 'ajuda', 'help', '--help', '-h']);
/** pnpm/npm/yarn que só consultam (view, info, why, list...). */
export const PACOTES_SO_LEITURA = new Set(['view', 'v', 'info', 'show', 'why', 'list', 'ls', 'll', 'la', 'outdated', 'root', 'bin', 'search', 'licenses', 'help', '-v', '--version', '-h', '--help']);
/** pnpm/npm/yarn que podem reescrever o lock (pnpm-lock.yaml). */
const PACOTES_INSTALA = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'dedupe', 'import', 'prune', 'link', 'unlink']);
/** find só lê se não tiver ação que escreve ou executa. */
const FIND_ESCREVE = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);
export const DESCARTE = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$|^nul$/i;

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
      if (k < 0 && longasComArg.includes(nome)) { const t = args[++i]; opts.push({ nome, valor: t?.valor, token: t }); }
      else opts.push({ nome, valor: k < 0 ? undefined : v.slice(k + 1), token: k < 0 ? undefined : { valor: v.slice(k + 1), incerto: a.incerto } });
      continue;
    }
    for (let k = 1; k < v.length; k++) {
      if (comArg.includes(v[k])) {
        const t = k + 1 < v.length ? { valor: v.slice(k + 1), incerto: a.incerto } : args[++i];
        opts.push({ nome: `-${v[k]}`, valor: t?.valor, token: t });
        break;
      }
      opts.push({ nome: `-${v[k]}` });
    }
  }
  return {
    pos,
    tem: (...n) => opts.some((o) => n.includes(o.nome)),
    valor: (...n) => opts.find((o) => n.includes(o.nome))?.valor,
    /** Todos os valores (como tokens, com "incerto") das opções `n` que aparecem mais de uma vez. */
    tokens: (...n) => opts.filter((o) => n.includes(o.nome) && o.token).map((o) => o.token),
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
      if (primeiro === 'list' || primeiro === 'show') { res.soLeitura = !res.temRedir; return; }
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
    case 'apply': {
      // Sem --apply, --check/--stat/--numstat/--summary só leem; --cached só mexe no índice.
      const o = opcoes(resto, 'pC', ['--directory', '--exclude', '--include', '--whitespace', '--build-fake-ancestor']);
      if (o.tem('--cached')) return;
      if (o.tem('--check', '--stat', '--numstat', '--summary') && !o.tem('--apply')) { res.soLeitura = !res.temRedir; return; }
      alvosDePatches(o.pos, res.entrada, ctx, res, { strip: numero(o.valor('-p'), 1), prefixo: o.valor('--directory') });
      return;
    }
    case 'am': {
      const o = opcoes(resto, 'pC', ['--directory', '--exclude', '--include', '--whitespace', '--resolvemsg']);
      if (o.tem('--abort', '--quit', '--skip', '--continue', '--resolved', '-r', '--show-current-patch')) return;
      alvosDePatches(o.pos, res.entrada, ctx, res, { strip: numero(o.valor('-p'), 1), prefixo: o.valor('--directory') });
      return;
    }
    default:
  }
}

const numero = (v, padrao) => (v != null && /^\d+$/.test(v) ? Number(v) : padrao);

/**
 * Arquivos que um patch (diff unificado ou do git, mbox do git am) altera, pelos cabeçalhos
 * "--- a/x", "+++ b/x" e "diff --git a/x b/y". `strip` = -pN. Nomes /dev/null são ignorados.
 */
export function arquivosDoPatch(texto, strip = 1) {
  const res = new Set();
  const tirar = (p) => {
    let c = String(p).split('\t')[0].trim();
    if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1);
    if (!c || c === '/dev/null') return;
    const partes = c.split('/').filter((x, i) => x !== '' || i === 0);
    if (strip >= partes.length) return;
    res.add(partes.slice(strip).join('/'));
  };
  for (const linha of String(texto).split(/\r?\n/)) {
    if (linha.startsWith('+++ ') || linha.startsWith('--- ')) tirar(linha.slice(4));
    else if (linha.startsWith('rename to ') || linha.startsWith('rename from ') || linha.startsWith('copy to ')) res.add(linha.replace(/^(rename (to|from)|copy to) /, '').trim());
    else {
      const m = linha.match(/^diff --git (\S+) (\S+)$/);
      if (m) { tirar(m[1]); tirar(m[2]); }
    }
  }
  return [...res];
}

/** Alvos de patch/git apply/git am: lê os arquivos de patch (ou o "< arquivo") e tira os nomes. */
function alvosDePatches(arquivos, entrada, ctx, res, { strip, prefixo }) {
  const fontes = arquivos.length ? arquivos : entrada ? [entrada] : [];
  for (const f of fontes) {
    if (f.incerto || f.valor === '-') continue;
    const texto = ctx.ler?.(f.valor);
    if (texto == null) continue;
    for (const rel of arquivosDoPatch(texto, strip)) {
      const valor = prefixo ? `${barras(prefixo).replace(/\/+$/, '')}/${rel}` : rel;
      res.alvos.push({ alvo: { valor, incerto: false }, acao: 'escrever', recursivo: false });
    }
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
  const res = { alvos: [], soLeitura: true, temRedir: false, entrada: null };
  for (const r of cmd.redirs) {
    if (r.op === '<' && (r.fd == null || r.fd === '0')) res.entrada = r.alvo;
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
  if (soLeituraPorArgumentos(nome, args)) return res;
  res.soLeitura = false;
  const escrever = (lista, recursivo = false) => { for (const a of lista) res.alvos.push({ alvo: a, acao: 'escrever', recursivo }); };
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
    case 'pnpm': case 'npm': case 'yarn': {
      const sub = args.find((a) => !a.valor.startsWith('-'));
      if (args.some((a) => PACOTES_INSTALA.has(a.valor)) || (nome === 'yarn' && !sub)) res.instala = true;
      break;
    }
    case 'ln': {
      const o = opcoes(args, 'tS', ['--target-directory', '--suffix']);
      const t = o.valor('-t', '--target-directory');
      const pastaDestino = t == null ? (o.pos.length === 1 ? { valor: '.', incerto: false } : null) : { valor: t, incerto: false };
      if (!pastaDestino && o.pos.length < 2) break;
      const fontes = pastaDestino ? o.pos : o.pos.slice(0, -1);
      copiarMover(fontes, pastaDestino ? null : o.pos[o.pos.length - 1], pastaDestino, o.tem('-T', '--no-target-directory'), false, ctx, res);
      break;
    }
    case 'chmod': case 'chown': case 'chgrp': {
      // Metadados. "-x"/"-w" do chmod são modo, não opção: só RcfvHLP contam como opção.
      let referencia = false;
      let recursivo = false;
      const pos = [];
      for (const a of args) {
        if (!a.incerto && /^--/.test(a.valor)) {
          if (a.valor.startsWith('--reference')) referencia = true;
          if (a.valor === '--recursive') recursivo = true;
          continue;
        }
        if (!a.incerto && /^-[RcfvHLP]+$/.test(a.valor)) { if (a.valor.includes('R')) recursivo = true; continue; }
        pos.push(a);
      }
      escrever(referencia ? pos : pos.slice(1), recursivo);
      break;
    }
    case 'dd':
      for (const a of args) if (a.valor.startsWith('of=')) escrever([{ valor: a.valor.slice(3), incerto: a.incerto }]);
      break;
    case 'curl': {
      const o = opcoes(args, 'oDHdXuAeFrwTKEbcxyYzCmQ', ['--output', '--header', '--data', '--request', '--user', '--config', '--cookie-jar', '--dump-header', '--trace', '--trace-ascii', '--stderr']);
      escrever(o.tokens('-o', '--output', '-c', '--cookie-jar', '-D', '--dump-header', '--trace', '--trace-ascii', '--stderr').filter((t) => t.valor !== '-'));
      break;
    }
    case 'wget': {
      const o = opcoes(args, 'Ooa', ['--output-document', '--output-file', '--append-output']);
      escrever(o.tokens('-O', '--output-document', '-o', '--output-file', '-a', '--append-output').filter((t) => t.valor !== '-'));
      break;
    }
    case 'tar': case 'bsdtar': {
      // Forma antiga ("tar xzf a.tgz"): o primeiro argumento sem "-" é o grupo de opções.
      const lista = args.length && !args[0].incerto && /^[A-Za-z]+$/.test(args[0].valor) ? [{ ...args[0], valor: `-${args[0].valor}` }, ...args.slice(1)] : args;
      const o = opcoes(lista, 'fCbHKNTVXg', ['--file', '--directory', '--exclude', '--files-from', '--exclude-from', '--transform', '--owner', '--group', '--mode']);
      if (o.tem('-t', '--list')) { res.soLeitura = !res.temRedir; break; }
      if (o.tem('-x', '--extract', '--get')) {
        for (const c of o.tokens('-C', '--directory')) res.alvos.push({ alvo: c, acao: 'escrever', recursivo: true });
      } else if (o.tem('-c', '--create', '-r', '--append', '-u', '--update', '-A', '--catenate', '--concatenate')) {
        escrever(o.tokens('-f', '--file').filter((t) => t.valor !== '-'));
      }
      break;
    }
    case 'unzip': {
      const o = opcoes(args, 'dxP');
      if (o.tem('-l', '-v', '-t', '-z', '-p')) { res.soLeitura = !res.temRedir; break; }
      for (const d of o.tokens('-d')) res.alvos.push({ alvo: d, acao: 'escrever', recursivo: true });
      break;
    }
    case 'patch': {
      const o = opcoes(args, 'pioDdrBVYzFgM', ['--strip', '--input', '--output', '--directory', '--reject-file', '--prefix', '--suffix']);
      if (o.tem('--dry-run', '--check')) break;
      escrever(o.tokens('-o', '--output').filter((t) => t.valor !== '-'));
      escrever(o.tokens('-r', '--reject-file').filter((t) => t.valor !== '-'));
      if (o.pos.length) { if (!o.tem('-o', '--output')) escrever([o.pos[0]]); break; } // patch ARQUIVO [PATCH]: só o arquivo indicado
      const strip = numero(o.valor('-p', '--strip'), null);
      if (strip == null) break; // sem -p, o patch pode usar só o nome base: em dúvida, o PostToolUse confere
      const pasta = o.valor('-d', '--directory');
      const fonte = o.tokens('-i', '--input');
      alvosDePatches(fonte, res.entrada, ctx, res, { strip, prefixo: pasta });
      break;
    }
    case 'rsync': {
      const o = opcoes(args, 'efBT', ['--rsh', '--filter', '--exclude', '--include', '--exclude-from', '--include-from', '--files-from', '--temp-dir', '--backup-dir', '--suffix', '--chmod', '--chown', '--log-file', '--partial-dir']);
      if (o.tem('-n', '--dry-run', '--list-only')) { res.soLeitura = !res.temRedir; break; }
      if (o.pos.length < 2) break;
      const destino = o.pos[o.pos.length - 1];
      const fontes = o.pos.slice(0, -1);
      if (o.tem('--remove-source-files')) for (const f of fontes) if (!remoto(f.valor)) res.alvos.push({ alvo: f, acao: 'apagar', recursivo: true });
      if (destino.incerto || remoto(destino.valor)) break;
      const destDir = barras(destino.valor).endsWith('/') || fontes.length > 1 || ctx.ehDiretorio(destino.valor);
      for (const f of fontes) {
        if (f.incerto || barras(f.valor).endsWith('/') || !destDir) {
          // conteúdo da pasta (src/) ou nome incerto: a pasta de destino inteira é alvo
          res.alvos.push({ alvo: destino, acao: 'escrever', recursivo: true });
          continue;
        }
        const alvo = { valor: `${barras(destino.valor).replace(/\/+$/, '')}/${nomeBase(f.valor)}`, incerto: false };
        res.alvos.push({ alvo, acao: 'escrever', recursivo: true });
      }
      break;
    }
    default:
  }
  return res;
}

/** rsync: "host:caminho" ou "rsync://..." (Windows "C:/x" não é remoto). */
const remoto = (v) => /^[^/\\]{2,}:/.test(v) || v.startsWith('rsync://');

/** Comando que só lê dependendo dos argumentos (coord.mjs de leitura, pnpm view, find sem -delete...). */
function soLeituraPorArgumentos(nome, args) {
  const v = args.map((a) => (a.incerto ? '\u0000' : a.valor));
  if (nome === 'node') {
    if (v.length === 1 && ['-v', '--version'].includes(v[0])) return true;
    const i = v.findIndex((x) => !x.startsWith('-'));
    return i >= 0 && nomeBase(v[i]) === 'coord.mjs' && COORD_SO_LEITURA.has(v[i + 1] ?? 'ajuda');
  }
  if (nome === 'pnpm' || nome === 'npm' || nome === 'yarn') {
    const sub = v.find((x) => !x.startsWith('-')) ?? v[0];
    return sub != null && PACOTES_SO_LEITURA.has(sub);
  }
  if (nome === 'find') return !v.some((x) => FIND_ESCREVE.has(x));
  if (nome === 'sort') return !v.some((x) => x === '-o' || x.startsWith('--output') || /^-[a-zA-Z]*o/.test(x));
  return false;
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
 * @param {{existe(abs: string): boolean, ehDiretorio(abs: string): boolean, sujos(): {xy: string, rel: string}[], rastreadosSob(rel: string): string[], ler?(abs: string): string|null}} p.amb
 * @returns {{violacoes: {rel: string, motivo: string}[], soLeitura: boolean, alvos: {rel: string, sub: boolean}[], instala: boolean}}
 *   alvos: ALVOS EVIDENTES do comando (arquivo exato ou, com sub, a pasta inteira), dentro do
 *   repositório, de qualquer dono. O PostToolUse só acusa e manda desfazer o que estiver aqui.
 *   instala: pnpm/npm/yarn install/add/remove/update (pode reescrever o pnpm-lock.yaml).
 */
export function analisarComando({ comando, agente, cwd, raiz, regras, somenteLeitura = [], permitidos = new Set(), amb }) {
  const violacoes = [];
  const vistos = new Set();
  const alvos = new Map(); // rel → sub
  const evidente = (rel, sub) => { if (!alvos.get(rel)) alvos.set(rel, sub); };
  let soLeitura = true;
  let instala = false;
  const acusar = (rel, motivo) => {
    if (!vistos.has(rel)) { vistos.add(rel); violacoes.push({ rel, motivo }); }
  };
  const doTime = PESSOAS.includes(agente); // time + alexandre
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
        ler: (v) => { const a = abs(v); return a && amb.ler ? amb.ler(a) : null; },
      };
      const r = alvosDoComando(cmd, ctx);
      if (!r.soLeitura) soLeitura = false;
      if (r.instala) instala = true;
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
        // Alvos evidentes: restaurar/sujos/nao-rastreados mexem só nos arquivos sujos de agora
        // (lista exata); o resto vale para o caminho e, se recursivo, para a pasta inteira.
        if (t.acao === 'restaurar' || t.acao === 'sujos') {
          for (const s of amb.sujos()) if (s.xy !== '??' && sob(s.rel)) { evidente(s.rel, false); conferir(s.rel, 'restaurar'); }
        } else if (t.acao === 'nao-rastreados') {
          for (const s of amb.sujos()) if (s.xy === '??' && sob(s.rel)) { evidente(s.rel, false); conferir(s.rel, 'apagar'); }
        } else if (t.acao === 'restaurar-ref') {
          evidente(rel, true);
          for (const f of amb.rastreadosSob(rel)) conferir(f, 'restaurar');
        } else if (!(t.recursivo && amb.ehDiretorio(a))) {
          evidente(rel, !!t.recursivo);
          if (rel !== '') conferir(rel, t.acao);
        } else {
          evidente(rel, true);
          const arquivos = [...amb.rastreadosSob(rel), ...amb.sujos().filter((s) => s.xy === '??' && sob(s.rel)).map((s) => s.rel)];
          for (const f of arquivos) conferir(f, t.acao);
          if (t.acao === 'escrever' && !arquivos.length && rel !== '') conferir(`${rel}/<novo-arquivo>`, t.acao);
        }
      }
    }
  };
  analisar(comando, cwd, 0);
  return { violacoes, soLeitura, alvos: [...alvos].map(([rel, sub]) => ({ rel, sub })), instala };
}

/** O caminho é alvo evidente do comando (arquivo exato ou dentro de uma pasta alvo)? */
export function ehAlvoEvidente(caminho, alvos) {
  for (const { rel, sub } of alvos || []) {
    if (caminho === rel) return true;
    if (sub && (rel === '' || caminho.startsWith(rel + '/'))) return true;
  }
  return false;
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
    ler: (abs) => {
      try { return statSync(abs).size > 8 * 1024 * 1024 ? null : readFileSync(abs, 'utf8'); } catch { return null; }
    },
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
  const doTime = PESSOAS.includes(agente); // time + alexandre
  const { violacoes } = classificarMudancas({ agente: doTime ? agente : '\u0000nenhum', mudancas, regras, estrito: true });
  const antes = new Map(mudancas.map((m) => [m.caminho, m.antes]));
  return violacoes.map((v) => ({
    ...v,
    antes: antes.get(v.caminho),
    motivo: doTime ? v.motivo : `o agente "${agente}" não faz parte do time`,
  }));
}

/**
 * Como desfazer cada arquivo acusado (o guardião libera exatamente esse comando).
 * Só para o que estava limpo antes; nunca "rm" de recado novo em .coord/recados/** (pode ser de
 * outro agente, e recado é imutável: quem errou responde com recado novo).
 */
export function comoDesfazer(v) {
  if (v.antes !== 'limpo') return null;
  if (v.status === 'A') return /^\.coord\/recados\//i.test(v.caminho) ? null : `rm -- "${v.caminho}"`;
  return `git restore -- "${v.caminho}"`;
}

/**
 * Separa as violações vistas no PostToolUse (função pura):
 * - bloqueantes: ALVO EVIDENTE do comando (analisarComando, guardado na foto) que estava limpo
 *   antes — o agente desfaz com o comando indicado;
 * - avisos: todo o resto (mudou durante o comando sem ser alvo evidente, já estava alterado
 *   antes, recado novo de outro remetente). Não bloqueia e nunca sugere desfazer: com agentes
 *   em paralelo na mesma árvore, é quase sempre trabalho de outro agente.
 * @param {{violacoes: any[], alvos?: {rel: string, sub: boolean}[]}} p
 */
export function separarAcusacoes({ violacoes, alvos = [] }) {
  const bloqueantes = [];
  const avisos = [];
  for (const v of violacoes) (ehAlvoEvidente(v.caminho, alvos) && comoDesfazer(v) ? bloqueantes : avisos).push(v);
  return { bloqueantes, avisos };
}

export const TEXTO_AVISO = 'mudou durante o comando, provavelmente outro agente; não desfaça';
export const LOCK = 'pnpm-lock.yaml';

/**
 * Aviso NÃO bloqueante (PostToolUse sai 0) com as mudanças que não são alvo evidente do comando.
 * @param {string} agente
 * @param {any[]} avisos
 * @param {{instala?: boolean}} [opc] instala: o comando rodou pnpm/npm install/add/remove/update
 */
export function mensagemAviso(agente, avisos, { instala = false } = {}) {
  const linhas = avisos.slice(0, 30).map((v) => {
    const fato = v.status === 'A' ? 'criado' : v.status === 'D' ? 'apagado' : 'alterado';
    const como = instala && v.caminho === LOCK
      ? `reescrito pelo install deste comando: não desfaça; faça commit dele só junto com o package.json de um pacote seu (regra "o lock acompanha a dependência", conferida pelo verificar); senão, avise o ${v.dono} por recado (o lock e as dependências são dele)`
      : TEXTO_AVISO;
    return ` - ${v.caminho} (${fato}; dono: ${v.dono}) → ${como}`;
  });
  const mais = avisos.length > 30 ? `\n   ... e mais ${avisos.length - 30} arquivo(s)` : '';
  return (
    `[guardião Macuxi] AVISO (não bloqueia): durante o último comando Bash mudaram ${avisos.length} arquivo(s) fora dos caminhos de ${agente} que o comando não alterava de forma evidente:\n` +
    `${linhas.join('\n')}${mais}\n` +
    'Não desfaça nada (não restaure, não descarte nem apague esses arquivos): com agentes em paralelo, é trabalho de outro agente. ' +
    `Só se tiver certeza de que foi este comando (script, gerador, formatador), avise o dono por recado: node scripts/coord.mjs enviar --de ${agente} --para <dono> --tipo aviso --assunto "..." --corpo "...".`
  );
}

/** Texto devolvido ao agente no PostToolUse quando bloqueia (alvos evidentes). */
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
