// Guardião v5 (T-0044) — trava do `gh pr merge` no Bash (PreToolUse do guarda-bash.mjs).
// Funções puras + acesso ao gh e aos recados injetável (testes: .claude/hooks/guarda-merge.test.mjs).
// Sem dependências externas.
//
// Regras (doc 07, recados R-20261101-151135 e R-20261101-165024 do Alexandre):
//  a) só o gerente-projetos, na sessão principal, executa `gh pr merge` (subagente nunca; identidade
//     só por fonte confiável: MACUXI_AGENTE=gerente-projetos ou sessão local com agent_type);
//  b) o comando é exatamente `gh pr merge <N> -R aloirr/macuxifdv --squash --match-head-commit <sha>`
//     (+ opcionais --body/--subject), sem prefixo (env, sudo, VAR=...), sem $VAR/$(...)/glob, um
//     merge por comando; --admin, --auto, --merge, --rebase e qualquer outra opção são bloqueados;
//  c) o hook consulta `gh pr view N -R aloirr/macuxifdv --json files,headRefOid,changedFiles`:
//     PR com arquivo em CAMINHOS_DE_GOVERNANCA (scripts/coord-lib.mjs) exige um recado do Alexandre
//     em .coord/recados/gerente-projetos (nome R-...-alexandre.md e `de: alexandre`) com o texto
//     "autorizo o merge do PR #N no commit <sha>", SHA compatível com o --match-head-commit e com o
//     headRefOid atual;
//  d) PR sem caminho de governança passa com a), b) e o headRefOid igual ao --match-head-commit.
//  gh fora do ar, sem login, resposta inválida ou lista de arquivos incompleta → BLOQUEADO
//  (falha fechada).
// Também bloqueia o merge "escondido": `gh pr merge` dentro de bash -c/eval/xargs/source/here-doc/
// script inline (node -e, python -c...), `gh api` de merge, `gh alias set/import` e subcomando do gh
// desconhecido (alias ou extensão), e nome de comando incerto ($GH pr ...).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tokenizar, comandosSimples } from './guarda-bash-lib.mjs';
import { CAMINHOS_DE_GOVERNANCA, mudancasDeGovernanca, remetenteDoRecado } from '../../scripts/coord-lib.mjs';

export const REPO_OFICIAL = 'aloirr/macuxifdv';
export const AGENTE_DO_MERGE = 'gerente-projetos';
/** Origens da identificação (identificarAgente) que confirmam o gerente na sessão principal. */
export const ORIGENS_CONFIAVEIS = ['variável MACUXI_AGENTE', 'sessão local (agent_type)'];
export const PASTA_AUTORIZACOES = '.coord/recados/gerente-projetos';
export const SHA_VALIDO = /^[0-9a-f]{7,40}$/i;
/** "autorizo o merge do PR #N no commit <sha>" (maiúsculas/minúsculas e espaços livres; sha entre crases aceito). */
export const RE_AUTORIZACAO = /autorizo\s+o\s+merge\s+do\s+PR\s+#(\d+)\s+no\s+commit\s+`?([0-9a-f]{7,40})`?(?![0-9a-z])/gi;

const CABECALHO = '[guardião Macuxi] BLOQUEADO (gh pr merge):';
const MODELO = `gh pr merge <N> -R ${REPO_OFICIAL} --squash --match-head-commit <sha> --body "Agente: <dono da tarefa>"`;

const barras = (p) => String(p).replace(/\\/g, '/');
const nomeBase = (p) => barras(p).replace(/\/+$/, '').split('/').pop().replace(/\.exe$/i, '').toLowerCase();

// ───────────────────────────── detecção no comando ─────────────────────────────

/** Grupos de primeiro nível do gh (2.x). Outro nome = alias ou extensão: bloqueado (pode esconder um merge). */
export const GRUPOS_GH = new Set([
  'auth', 'browse', 'codespace', 'cs', 'gist', 'issue', 'org', 'pr', 'project', 'release', 'repo', 'cache', 'run',
  'workflow', 'agent-task', 'alias', 'api', 'attestation', 'completion', 'config', 'extension', 'ext', 'extensions',
  'gpg-key', 'label', 'preview', 'ruleset', 'rs', 'search', 'secret', 'ssh-key', 'status', 'variable', 'help',
  'copilot', 'accessibility', 'a11y', 'licenses', 'version',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd']);
const SEMPRE_EXECUTAM = new Set(['eval', 'source', '.', 'xargs', 'parallel', 'watch', 'script', 'su', 'ssh', 'busybox']);
const LINGUAGENS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'py', 'perl', 'ruby', 'php', 'lua', 'tsx', 'ts-node', 'npx', 'pnpx', 'bunx']);
const PALAVRAS_CHAVE = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'time', 'esac']);
const PREFIXOS = new Set(['sudo', 'command', 'builtin', 'nohup', 'exec', 'nice', 'stdbuf', 'doas', 'env', 'timeout', 'time']);

/** Texto do comando sem aspas e barras invertidas, com espaços colapsados (para achar menções). */
export function textoNormalizado(comando) {
  return String(comando).replace(/["'\\`]/g, '').replace(/\s+/g, ' ').toLowerCase();
}
/** O texto menciona um merge pelo gh (gh … pr … merge, gh … api … merge)? */
export function mencionaMerge(comando) {
  const t = textoNormalizado(comando);
  // Perto um do outro (até 40 caracteres entre as palavras): pega 'gh','pr','merge' de um script
  // sem acusar um script longo que só cita as palavras em lugares diferentes.
  return /\bgh\b.{0,40}?\bpr\b.{0,40}?merge/.test(t) || /\bgh\b.{0,40}?\bapi\b.{0,200}?merge/.test(t) || /\bmergepullrequest\b/.test(t);
}

/** Conteúdos de $(...), `...`, <(...) e >(...) dentro de uma palavra (para analisar como comandos). */
export function substituicoes(valor) {
  const s = String(valor);
  const res = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '`') {
      const j = s.indexOf('`', i + 1);
      res.push(s.slice(i + 1, j < 0 ? s.length : j));
      i = j < 0 ? s.length : j;
    } else if ((s[i] === '$' || s[i] === '<' || s[i] === '>') && s[i + 1] === '(') {
      let nivel = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '(') nivel++;
        else if (s[j] === ')' && --nivel === 0) break;
      }
      res.push(s.slice(i + 2, j).replace(/^\(/, '').replace(/\)$/, '')); // $((...)) aritmético vira texto inofensivo
      i = j;
    }
  }
  return res;
}

/** Tira prefixos (VAR=..., env, sudo, timeout, palavras-chave). Retorna o nome, os argumentos e o que foi tirado. */
function semPrefixos(palavras) {
  const p = palavras.slice();
  const tirados = [];
  let estranho = false; // prefixo cujo argumento não dá para separar com segurança (env -S, -u, -C...)
  for (;;) {
    if (!p.length) break;
    const v = p[0].valor;
    if (!p[0].incerto && /^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) { tirados.push(p.shift()); continue; }
    if (PALAVRAS_CHAVE.has(v)) { p.shift(); continue; }
    const n = nomeBase(v);
    if (!p[0].incerto && PREFIXOS.has(n)) {
      tirados.push(p.shift());
      while (p.length && (p[0].valor.startsWith('-') || (n === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p[0].valor)))) {
        if (n === 'env' && /^-[a-zA-Z]*[uSC]$|^--(unset|split-string|chdir)$/.test(p[0].valor)) estranho = true;
        tirados.push(p.shift());
      }
      if (n === 'timeout' && p.length) tirados.push(p.shift());
      continue;
    }
    break;
  }
  return { nome: p[0], args: p.slice(1), tirados, estranho };
}

/** Um comando simples executa texto/código que o guardião não vê (shell, eval, xargs, script inline)? */
function executaTexto(nome, args) {
  if (!nome) return false;
  if (nome.incerto) return true;
  const n = nomeBase(nome.valor);
  if (SHELLS.has(n) || SEMPRE_EXECUTAM.has(n)) return true;
  if (LINGUAGENS.has(n)) {
    // node scripts/coord.mjs ... (CLI dos recados) não executa texto; script inline ou outro script, sim.
    const primeiro = args.find((a) => !a.valor.startsWith('-'));
    return !(primeiro && !primeiro.incerto && nomeBase(primeiro.valor) === 'coord.mjs' && !args.some((a) => /^-(e|p|c|-eval|-print)$/.test(a.valor)));
  }
  return false;
}

/**
 * Procura merges de PR pelo gh no comando (inclusive após ; && || |, em subshell e em $(...)).
 * @returns {{merges: {palavras: any[], tirados: any[], estranho: boolean, gh: any}[], bloqueios: string[]}}
 *   merges: comandos simples `gh … pr … merge` (para validar); bloqueios: formas escondidas.
 */
export function acharMerges(comando) {
  const merges = [];
  const bloqueios = [];
  let interpretador = false;
  visitarComandos(comando, ({ nome, args, tirados, estranho, palavras }) => {
    if (executaTexto(nome, args) || estranho) interpretador = true;
    if (nome?.incerto) {
      if (args.some((a) => /^(pr|api|merge)$/i.test(a.valor))) bloqueios.push(`nome de comando incerto ("${nome.valor}") com "pr"/"api"/"merge": escreva gh por extenso`);
      return;
    }
    // gh como comando (depois dos prefixos) ou depois de um prefixo que não sabemos separar (env -u X gh ...).
    // "gh" como argumento de outro comando (echo gh pr merge) é só texto.
    const iGh = nomeBase(nome?.valor || '') === 'gh' ? palavras.indexOf(nome)
      : estranho ? palavras.findIndex((w) => !w.incerto && nomeBase(w.valor) === 'gh') : -1;
    if (iGh < 0) return;
    const depois = palavras.slice(iGh + 1);
    const posicionais = [];
    for (let i = 0; i < depois.length; i++) {
      const w = depois[i];
      if (!w.incerto && w.valor.startsWith('-')) {
        if (/^(-R|--repo)$/.test(w.valor)) i++; // -R/--repo é persistente no "gh pr" (gh pr -R x merge)
        continue;
      }
      posicionais.push(w);
      if (posicionais.length === 2) break;
    }
    const [grupo, sub] = posicionais;
    if (!grupo) return;
    if (grupo.incerto) { bloqueios.push(`subcomando do gh incerto ("${grupo.valor}"): escreva o comando por extenso`); return; }
    const g = grupo.valor.toLowerCase();
    if (!GRUPOS_GH.has(g)) { bloqueios.push(`"gh ${grupo.valor}" não é um comando do gh (alias ou extensão podem esconder um merge): use o comando completo`); return; }
    if (g === 'api' && depois.some((w) => w.incerto || /merge/i.test(w.valor))) {
      bloqueios.push('merge pela API do GitHub (gh api …/merge ou mergePullRequest) não é aceito: use gh pr merge, com as regras abaixo');
      return;
    }
    if (g === 'alias' && sub && /^(set|import)$/i.test(sub.valor)) {
      bloqueios.push('gh alias set/import não é aceito (um alias pode esconder o gh pr merge)');
      return;
    }
    if (g !== 'pr' || !sub) return;
    if (sub.incerto) { bloqueios.push(`subcomando do gh pr incerto ("${sub.valor}"): escreva o comando por extenso`); return; }
    if (sub.valor.toLowerCase() !== 'merge') return;
    merges.push({ palavras, tirados, estranho, gh: iGh });
  });
  if (interpretador && mencionaMerge(comando))
    bloqueios.push('gh pr merge dentro de bash -c, eval, xargs, source, here-doc ou script (node -e, python -c...) não é aceito: rode o gh pr merge direto, sozinho no comando');
  return { merges, bloqueios };
}

// ───────────────────────────── validação do comando (regra b) ─────────────────────────────

const PROIBIDAS = {
  '--admin': '--admin (passa por cima das proteções do branch) é proibido',
  '--auto': '--auto (merge automático depois) é proibido: o merge é na hora, com o SHA conferido',
  '--disable-auto': '--disable-auto não é aceito no merge',
  '--merge': '--merge é proibido: use --squash',
  '-m': '-m (--merge) é proibido: use --squash',
  '--rebase': '--rebase é proibido: use --squash',
  '-r': '-r (--rebase) é proibido: use --squash',
};

/**
 * Valida um `gh pr merge` (regra b). Função pura.
 * @returns {{erros: string[], pr: number|null, sha: string|null, repo: string|null}}
 */
export function validarComandoMerge({ palavras, tirados = [], estranho = false, gh = 0 }) {
  const erros = [];
  if (gh !== 0 || tirados.length || estranho)
    erros.push('rode o gh pr merge sem nada antes (sem env, sudo, timeout, xargs nem VAR=...): GH_REPO/GH_HOST mudariam o repositório');
  if (palavras.some((w) => w.incerto))
    erros.push('sem $VAR, $(...), crase, glob ou ~ no gh pr merge: escreva o número do PR, o repositório e o SHA por extenso');
  const args = palavras.slice(gh + 1).map((w) => w.valor);
  let repo = null;
  const repos = [];
  let squash = false;
  const shas = [];
  const posicionais = [];
  let fim = false;
  const valorDe = (i, nome) => {
    if (i + 1 >= args.length) { erros.push(`${nome} sem valor`); return [null, i]; }
    return [args[i + 1], i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (fim || !a.startsWith('-') || a === '-') { posicionais.push(a); continue; }
    if (a === '--') { fim = true; continue; }
    if (a.startsWith('--')) {
      const k = a.indexOf('=');
      const nome = k < 0 ? a : a.slice(0, k);
      let valor = k < 0 ? undefined : a.slice(k + 1);
      if (PROIBIDAS[nome]) { erros.push(PROIBIDAS[nome]); continue; }
      if (nome === '--squash') { if (valor !== undefined) erros.push('--squash não leva valor'); squash = true; continue; }
      if (nome === '--repo' || nome === '--match-head-commit' || nome === '--body' || nome === '--subject') {
        if (valor === undefined) [valor, i] = valorDe(i, nome);
        if (valor === null) continue;
        if (nome === '--repo') repos.push(valor);
        if (nome === '--match-head-commit') shas.push(valor);
        continue;
      }
      erros.push(`opção ${nome} não é aceita no gh pr merge (aceitas: -R/--repo, --squash, --match-head-commit, --body, --subject)`);
      continue;
    }
    // opções curtas, juntas ou não: -s, -R x, -Rx, -b x, -t x
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      const curta = `-${c}`;
      if (PROIBIDAS[curta]) { erros.push(PROIBIDAS[curta]); continue; }
      if (c === 's') { squash = true; continue; }
      if (c === 'R' || c === 'b' || c === 't') {
        let valor = a.slice(j + 1);
        if (!valor) [valor, i] = valorDe(i, curta);
        if (valor !== null && c === 'R') repos.push(valor);
        break;
      }
      erros.push(`opção ${curta} não é aceita no gh pr merge (aceitas: -R/--repo, --squash, --match-head-commit, --body, --subject)`);
    }
  }
  // "pr" e "merge" são o subcomando (acharMerges já garantiu): sobram os argumentos do merge.
  if (posicionais[0]?.toLowerCase() === 'pr' && posicionais[1]?.toLowerCase() === 'merge') posicionais.splice(0, 2);
  if (!repos.length) erros.push(`falta -R ${REPO_OFICIAL}`);
  else if (repos.length > 1) erros.push('-R/--repo repetido: informe o repositório uma vez só');
  else if (repos[0].toLowerCase() !== REPO_OFICIAL) erros.push(`merge só no repositório ${REPO_OFICIAL} (veio -R ${repos[0]})`);
  else repo = REPO_OFICIAL;
  if (!squash) erros.push('falta --squash (o main recebe um commit por PR)');
  let sha = null;
  if (!shas.length) erros.push('falta --match-head-commit <sha> (impede que entre commit adicionado depois da conferência)');
  else if (shas.length > 1) erros.push('--match-head-commit repetido: informe um SHA só');
  else if (!SHA_VALIDO.test(shas[0])) erros.push(`--match-head-commit "${shas[0]}" não é um SHA (7 a 40 caracteres hexadecimais; prefira os 40)`);
  else sha = shas[0].toLowerCase();
  let pr = null;
  if (posicionais.length !== 1) erros.push(posicionais.length ? `informe um PR só (veio: ${posicionais.join(' ')})` : 'falta o número do PR (gh pr merge <N> ...)');
  else if (!/^\d+$/.test(posicionais[0])) erros.push(`o PR tem de ser o número (veio "${posicionais[0]}"; URL e branch não são aceitos)`);
  else pr = Number(posicionais[0]);
  return { erros, pr, sha, repo };
}

// ───────────────────────────── identidade (regra a) ─────────────────────────────

/** Só o gerente-projetos, na sessão principal, com identidade de fonte confiável. Retorna o motivo do bloqueio ou null. */
export function motivoIdentidade({ agente, origem = '', subagente = false }) {
  if (subagente) return `subagente (${agente || 'sem agente'}) nunca executa gh pr merge: devolva ao gerente-projetos, que faz o merge na sessão principal`;
  if (!agente) return 'sessão sem agente: pelo Claude, só o gerente-projetos executa gh pr merge (o Alexandre faz o merge pelo terminal ou pelo GitHub)';
  if (agente !== AGENTE_DO_MERGE) return `só o gerente-projetos executa gh pr merge; esta sessão é de ${agente}. Avise o gerente por recado (node scripts/coord.mjs enviar --de ${agente} --para gerente-projetos --tipo entrega ...)`;
  if (!ORIGENS_CONFIAVEIS.includes(origem))
    return `a identidade gerente-projetos veio de "${origem}", que não é confiável para merge; vale só MACUXI_AGENTE=gerente-projetos ou a sessão local do gerente`;
  return null;
}

// ───────────────────────────── PR e autorização (regras c e d) ─────────────────────────────

/** SHA curto (7+) é prefixo do SHA completo? */
export const shaCompativel = (curto, completo) => Boolean(curto && completo && SHA_VALIDO.test(curto) && String(completo).toLowerCase().startsWith(String(curto).toLowerCase()));

/** Lê o cabeçalho (front matter) de um recado: {meta, corpo} ou null. */
export function lerCabecalho(texto) {
  const m = String(texto).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const k = linha.match(/^([A-Za-z_]+):\s*(.*?)\s*$/);
    if (k) meta[k[1].toLowerCase()] = k[2];
  }
  return { meta, corpo: m[2] };
}

/**
 * Autorizações válidas do Alexandre nos recados (função pura).
 * Vale só recado com nome R-...-alexandre.md, `de: alexandre` e `id` igual ao nome do arquivo.
 * @param {{nome: string, texto: string}[]} recados
 * @returns {{pr: number, sha: string, id: string}[]}
 */
export function autorizacoesDoAlexandre(recados) {
  const res = [];
  for (const { nome, texto } of recados) {
    if (!/\.md$/i.test(nome) || remetenteDoRecado(nome) !== 'alexandre') continue;
    const r = lerCabecalho(texto);
    if (!r || String(r.meta.de || '').toLowerCase() !== 'alexandre') continue;
    const id = nome.replace(/\.md$/i, '');
    if (r.meta.id !== id) continue;
    for (const m of `${r.corpo}`.matchAll(RE_AUTORIZACAO)) res.push({ pr: Number(m[1]), sha: m[2].toLowerCase(), id });
  }
  return res;
}

/**
 * Decide o merge (função pura, regras c e d) a partir da resposta do gh e das autorizações.
 * @param {{pr: number, sha: string, consulta: {ok: boolean, erro?: string, headRefOid?: string, arquivos?: string[], total?: number}, autorizacoes: {pr: number, sha: string, id: string}[]}} p
 * @returns {{ok: boolean, erros: string[], governanca: string[], autorizacao?: string}}
 */
export function decidirMerge({ pr, sha, consulta, autorizacoes }) {
  if (!consulta?.ok)
    return { ok: false, governanca: [], erros: [`não deu para conferir o PR #${pr} no GitHub (${consulta?.erro || 'sem resposta'}); sem a conferência não há merge (falha fechada). Rode gh auth status e tente de novo`] };
  const head = String(consulta.headRefOid || '').toLowerCase();
  const arquivos = consulta.arquivos || [];
  const erros = [];
  if (!/^[0-9a-f]{40}$/.test(head)) return { ok: false, governanca: [], erros: [`o gh não devolveu o headRefOid do PR #${pr} (falha fechada)`] };
  if (typeof consulta.total === 'number' && consulta.total > arquivos.length)
    return { ok: false, governanca: [], erros: [`o gh devolveu ${arquivos.length} de ${consulta.total} arquivos do PR #${pr}: sem a lista completa não dá para descartar caminho de governança (falha fechada). Peça o merge ao Alexandre`] };
  if (!shaCompativel(sha, head))
    erros.push(`o head do PR #${pr} é ${head} e o --match-head-commit é ${sha}: o PR mudou depois da conferência. Confira de novo (CI do PR e do main) antes do merge`);
  const governanca = mudancasDeGovernanca(arquivos.map((caminho) => ({ status: 'M', caminho }))).map((m) => m.caminho);
  let autorizacao;
  if (governanca.length) {
    const doPr = autorizacoes.filter((a) => a.pr === pr);
    const valida = doPr.find((a) => shaCompativel(a.sha, head) && shaCompativel(sha, head));
    if (valida) autorizacao = valida.id;
    else {
      const lista = governanca.slice(0, 10).map((c) => `   · ${c}`).join('\n') + (governanca.length > 10 ? `\n   · ... e mais ${governanca.length - 10}` : '');
      const motivo = doPr.length
        ? `há autorização do Alexandre para o PR #${pr}, mas no commit ${doPr.map((a) => a.sha).join(', ')}, que não é o head atual (${head}): o PR mudou depois da aprovação. NÃO faça o merge; avise o Alexandre`
        : `não há recado do Alexandre (de: alexandre, em ${PASTA_AUTORIZACOES}) com "autorizo o merge do PR #${pr} no commit ${head}"`;
      erros.push(
        `o PR #${pr} altera caminho(s) de governança (${CAMINHOS_DE_GOVERNANCA.join(', ')}):\n${lista}\n` +
        `   e ${motivo}. Mande ao Alexandre o resumo (CI do PR e do main, head SHA, o que cada arquivo muda) e espere a autorização dele por recado; aprovação genérica não vale`,
      );
    }
  }
  return { ok: !erros.length, erros, governanca, ...(autorizacao ? { autorizacao } : {}) };
}

// ───────────────────────────── acesso real (gh e recados) ─────────────────────────────

/**
 * `gh pr view N -R aloirr/macuxifdv --json files,headRefOid,changedFiles` (timeout de 20 s).
 * MACUXI_GH_SIMULADO=<arquivo.mjs>: roda esse script no lugar do gh (só nos testes; a variável é do
 * processo do Claude Code, que o agente não altera).
 */
export function consultarPrGh(pr, { env = process.env, timeout = 20000 } = {}) {
  const simulado = String(env.MACUXI_GH_SIMULADO || '').trim();
  const args = ['pr', 'view', String(pr), '-R', REPO_OFICIAL, '--json', 'files,headRefOid,changedFiles'];
  let saida;
  try {
    saida = simulado
      ? execFileSync(process.execPath, [simulado, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
      : execFileSync('gh', args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    const msg = String(e?.stderr || e?.message || e).trim().split(/\r?\n/)[0].slice(0, 200);
    return { ok: false, erro: e?.code === 'ENOENT' ? 'gh não encontrado' : e?.code === 'ETIMEDOUT' || e?.signal === 'SIGTERM' ? `gh não respondeu em ${Math.round(timeout / 1000)} s` : `gh falhou: ${msg}` };
  }
  try {
    const j = JSON.parse(saida);
    if (!j || !Array.isArray(j.files)) return { ok: false, erro: 'resposta do gh sem a lista de arquivos' };
    return {
      ok: true, headRefOid: String(j.headRefOid || ''),
      arquivos: j.files.map((f) => barras(f?.path || '')).filter(Boolean),
      total: typeof j.changedFiles === 'number' ? j.changedFiles : undefined,
    };
  } catch { return { ok: false, erro: 'resposta do gh não é JSON' }; }
}

/** Recados da caixa do gerente (nome + texto); pasta ilegível = nenhum. */
export function lerRecadosDoGerente(raiz) {
  const pasta = join(raiz, ...PASTA_AUTORIZACOES.split('/'));
  let nomes = [];
  try { nomes = readdirSync(pasta).filter((n) => /\.md$/i.test(n)); } catch { return []; }
  const res = [];
  for (const nome of nomes) {
    try { res.push({ nome, texto: readFileSync(join(pasta, nome), 'utf8') }); } catch { /* ilegível: não autoriza */ }
  }
  return res;
}

// ───────────────────────────── tudo junto (PreToolUse) ─────────────────────────────

/**
 * Confere o comando Bash. Sem menção a merge → {ok: true, merge: false} sem consultar nada.
 * @param {{comando: string, agente: string, origem?: string, subagente?: boolean,
 *   consultarPr?: (pr: number) => any, lerRecados?: () => {nome: string, texto: string}[]}} p
 * @returns {{ok: boolean, merge: boolean, mensagem?: string, pr?: number, governanca?: string[], autorizacao?: string}}
 */
export function conferirMerge({ comando, agente, origem = '', subagente = false, consultarPr, lerRecados = () => [] }) {
  const { merges, bloqueios } = acharMerges(comando);
  if (!merges.length && !bloqueios.length) return { ok: true, merge: false };
  const erros = [...bloqueios];
  const ident = motivoIdentidade({ agente, origem, subagente });
  if (ident) erros.unshift(ident);
  if (merges.length > 1) erros.push(`um gh pr merge por comando (vieram ${merges.length})`);
  let pr;
  let governanca = [];
  let autorizacao;
  if (merges.length === 1) {
    const v = validarComandoMerge(merges[0]);
    erros.push(...v.erros);
    pr = v.pr ?? undefined;
    // Só consulta o GitHub com o comando e a identidade em ordem (sem gastar a chamada à toa).
    if (!erros.length) {
      let consulta;
      try { consulta = consultarPr ? consultarPr(v.pr) : { ok: false, erro: 'sem consulta ao gh' }; } catch (e) { consulta = { ok: false, erro: String(e?.message || e) }; }
      let recados = [];
      try { recados = lerRecados() || []; } catch { recados = []; }
      const d = decidirMerge({ pr: v.pr, sha: v.sha, consulta, autorizacoes: autorizacoesDoAlexandre(recados) });
      erros.push(...d.erros);
      governanca = d.governanca;
      autorizacao = d.autorizacao;
    }
  }
  if (!erros.length) return { ok: true, merge: true, pr, governanca, ...(autorizacao ? { autorizacao } : {}) };
  return { ok: false, merge: true, pr, governanca, mensagem: mensagemMerge(erros) };
}

export function mensagemMerge(erros) {
  return (
    `${CABECALHO}\n${erros.map((e) => ` - ${e}`).join('\n')}\n` +
    `Comando aceito (só o gerente-projetos, na sessão principal): ${MODELO}\n` +
    `PR de governança: além disso, recado do Alexandre em ${PASTA_AUTORIZACOES} com "autorizo o merge do PR #N no commit <sha>" (doc 07, R-20261101-151135).\n` +
    'Não contorne o bloqueio (gh api, alias, script, outro comando): se a regra impede o merge, avise o Alexandre por recado.'
  );
}

// ───────────────────────────── recado falso do Alexandre (item 3 do v5) ─────────────────────────────

/** Visita cada comando simples (inclusive em subshell e em $(...)): fn({nome, args, tirados, estranho, palavras}). */
export function visitarComandos(comando, fn, nivel = 0) {
  for (const cmd of comandosSimples(tokenizar(comando))) {
    if (cmd.grupo) continue;
    const todas = [...cmd.palavras, ...cmd.redirs.map((r) => r.alvo)];
    if (nivel < 4) for (const w of todas) if (w.incerto) for (const sub of substituicoes(w.valor)) visitarComandos(sub, fn, nivel + 1);
    if (!cmd.palavras.length) continue;
    fn({ ...semPrefixos(cmd.palavras), palavras: cmd.palavras });
  }
}

/**
 * Bloqueia o agente que tenta criar recado em nome de outro — sobretudo `de: alexandre`, que vale
 * como autorização de merge. Só a sessão do Alexandre (MACUXI_AGENTE=alexandre; terminal dele, sem
 * o Claude) envia como alexandre (regra do guardião v4). Função pura.
 *  - node scripts/coord.mjs enviar --de X: X tem de ser o próprio agente (por extenso);
 *  - comando que escreve com "de: alexandre" no texto (here-doc, printf, node -e...);
 *  - script inline (node -e, python -c, bash -c, eval...) que fala de recados e de alexandre.
 * @returns {string[]} motivos do bloqueio (vazio = passa)
 */
export function motivosRecadoFalso({ comando, agente, soLeitura = false }) {
  if (!agente || agente === 'alexandre') return [];
  const motivos = [];
  let interpretador = false;
  visitarComandos(comando, ({ nome, args, estranho }) => {
    if (executaTexto(nome, args) || estranho) interpretador = true;
    if (!nome || nome.incerto || !['node', 'nodejs'].includes(nomeBase(nome.valor))) return;
    const i = args.findIndex((a) => !a.valor.startsWith('-'));
    if (i < 0 || args[i].incerto || nomeBase(args[i].valor) !== 'coord.mjs' || args[i + 1]?.valor !== 'enviar') return;
    for (let k = i + 2; k < args.length; k++) {
      if (args[k].valor !== '--de' && !args[k].valor.startsWith('--de=')) continue;
      const de = args[k].valor.startsWith('--de=') ? { valor: args[k].valor.slice(5), incerto: args[k].incerto } : (args[k + 1] || { valor: '', incerto: true });
      const v = String(de.valor).trim().toLowerCase();
      if (de.incerto) motivos.push(`o remetente do recado tem de estar por extenso: --de ${agente} (veio --de ${de.valor})`);
      else if (v === 'alexandre') motivos.push(`recado como alexandre (--de alexandre) só sai da sessão do Alexandre (MACUXI_AGENTE=alexandre ou o terminal dele); ${agente} envia com --de ${agente}`);
      else if (v !== agente) motivos.push(`o recado sai com o seu nome: --de ${agente} (veio --de ${de.valor})`);
    }
  });
  // \n, \t e \r escritos (printf, echo -e, node -e) contam como quebra de linha.
  const t = textoNormalizado(String(comando).replace(/\\[ntr]/g, ' '));
  if (!soLeitura && /(^|[^a-z0-9_])de:\s*alexandre\b/.test(t))
    motivos.push(`"de: alexandre" no comando: ${agente} não cria recado em nome do Alexandre (só ele, na sessão dele)`);
  else if (interpretador && /recados/.test(t) && /alexandre/.test(t))
    motivos.push(`script (bash -c, node -e, eval...) que mexe em recados e cita alexandre: ${agente} não cria recado em nome do Alexandre; use node scripts/coord.mjs enviar --de ${agente}`);
  return motivos;
}

export function mensagemRecadoFalso(agente, motivos) {
  return (
    `[guardião Macuxi] BLOQUEADO (recado): ${agente} não envia recado em nome de outro:\n` +
    `${motivos.map((m) => ` - ${m}`).join('\n')}\n` +
    'Recado do Alexandre (sobretudo "autorizo o merge do PR #N no commit <sha>") só ele escreve. Não contorne o bloqueio.'
  );
}
