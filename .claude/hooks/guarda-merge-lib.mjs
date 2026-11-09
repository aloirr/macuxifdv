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
// v7 (T-0122): `gh api` só de leitura (analisarGhApi/conferirGhApi): GET/HEAD e GraphQL "query" passam, mesmo com $VAR
// ou "merge" no --jq; o resto é bloqueado para toda sessão.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, win32, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  tokenizar, comandosSimples, alvosDoComando, SO_LEITURA, COORD_SO_LEITURA, PACOTES_SO_LEITURA, DESCARTE,
} from './guarda-bash-lib.mjs';
import {
  AGENTES, PESSOAS, CAMINHOS_DE_GOVERNANCA, mudancasDeGovernanca, remetenteDoRecado, modoDosRecados, conexaoDeRecados,
  recadosDaPastaNoGitHub,
} from '../../scripts/coord-lib.mjs';

export const REPO_OFICIAL = 'aloirr/macuxifdv';
export const AGENTE_DO_MERGE = 'gerente-projetos';
/** Origens da identificação (identificarAgente) que confirmam o gerente na sessão principal. */
export const ORIGENS_CONFIAVEIS = ['variável MACUXI_AGENTE', 'sessão local (agent_type)'];
export const PASTA_AUTORIZACOES = '.coord/recados/gerente-projetos';
export const SHA_VALIDO = /^[0-9a-f]{7,40}$/i;
/** "autorizo o merge do PR #N no commit <sha>" (maiúsculas/minúsculas e espaços livres; sha entre crases aceito). */
export const RE_AUTORIZACAO = /(?<!n[aã]o\s{1,3})(?<![a-z])autorizo\s+o\s+merge\s+do\s+PR\s+#(\d+)\s+no\s+commit\s+`?([0-9a-f]{7,40})`?(?![0-9a-z])/gi;

const CABECALHO = '[guardião Macuxi] BLOQUEADO (gh pr merge):';
const MODELO = `gh pr merge <N> -R ${REPO_OFICIAL} --squash --match-head-commit <sha> [--subject "<título do squash>"] --body "Agente: <dono da tarefa>"`;

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
    // v7 (T-0122): gh api de LEITURA (GET/HEAD; GraphQL só "query") passa mesmo com $VAR ou "merge" (--jq, /merge de consulta).
    if (g === 'api' && !analisarGhApi(depois.slice(depois.indexOf(grupo) + 1)).leitura && depois.some((w) => w.incerto || /merge/i.test(w.valor))) {
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

// ───────────────────────────── guardião v7 (T-0122): gh api só de leitura ─────────────────────────────
//
// O `gh api` passa SÓ quando o pedido é de leitura:
//  - método GET ou HEAD: explícito (-X/--method, também -XGET e --method=GET) ou implícito (sem -f/-F/--input o gh usa GET);
//    com -f/-F/--input e sem -X o gh usa POST;
//  - GraphQL (endpoint graphql) só com uma consulta literal ("query ..." ou "{ ... }") sem "mutation"/"subscription";
//  - a leitura passa mesmo com $VAR no endpoint e "merge" no --jq ou no caminho (GET .../pulls/N/merge só consulta).
// O resto (POST/PUT/PATCH/DELETE, método incerto como -X $M, opção desconhecida, consulta GraphQL vinda de arquivo ou
// de $VAR) é escrita e é BLOQUEADO para toda sessão, como o merge: gravar no GitHub é pelo comando próprio do gh
// (gh pr create/comment/edit...), que não esconde merge nem push de conteúdo. Uso manual do Alexandre: MACUXI_GUARDA=off.

/** Opções do gh api que levam valor (gh 2.x). */
const API_COM_VALOR = new Map([
  ['-X', 'metodo'], ['--method', 'metodo'], ['-f', 'campo'], ['--raw-field', 'campo'], ['-F', 'campo'], ['--field', 'campo'],
  ['--input', 'entrada'], ['-H', 'outro'], ['--header', 'outro'], ['-q', 'outro'], ['--jq', 'outro'], ['-t', 'outro'],
  ['--template', 'outro'], ['--cache', 'outro'], ['-p', 'outro'], ['--preview', 'outro'], ['--hostname', 'outro'],
]);
/** Opções do gh api sem valor. */
const API_SEM_VALOR = new Set(['--paginate', '--slurp', '-i', '--include', '--silent', '--verbose', '-h', '--help']);
export const METODOS_DE_LEITURA = new Set(['GET', 'HEAD']);
const RE_GRAPHQL_ESCRITA = /\b(mutation|subscription)\b/i;

/**
 * Classifica os argumentos de um `gh api` (palavras do tokenizador DEPOIS de "api"). Função pura.
 * @param {{valor: string, incerto?: boolean}[]} args
 * @returns {{leitura: boolean, metodo: string|null, endpoint: string|null, motivo?: string}}
 */
export function analisarGhApi(args) {
  const metodos = [];
  const campos = [];
  let entrada = false;
  let endpoint = null;
  let endpointIncerto = false;
  let metodoIncerto = false;
  const estranhas = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    const v = w.valor;
    if (w.incerto && /^-/.test(v)) { estranhas.push(v); continue; }
    if (!v.startsWith('-') || v === '-') {
      if (endpoint === null) { endpoint = v; endpointIncerto = Boolean(w.incerto); }
      else estranhas.push(v); // 2º posicional: o gh recusa; aqui não dá para saber o que é
      continue;
    }
    let nome = v;
    let valor;
    let incerto = false;
    const eq = v.startsWith('--') ? v.indexOf('=') : -1;
    if (eq > 0) { nome = v.slice(0, eq); valor = v.slice(eq + 1); }
    else if (!v.startsWith('--') && v.length > 2 && API_COM_VALOR.has(v.slice(0, 2))) { nome = v.slice(0, 2); valor = v.slice(2); }
    if (API_SEM_VALOR.has(nome) && valor === undefined) continue;
    const tipo = API_COM_VALOR.get(nome);
    if (!tipo) { estranhas.push(v); continue; }
    if (valor === undefined) {
      if (i + 1 >= args.length) { estranhas.push(`${nome} sem valor`); continue; }
      valor = args[i + 1].valor;
      incerto = Boolean(args[i + 1].incerto);
      i++;
    }
    if (tipo === 'metodo') { metodos.push(String(valor).toUpperCase()); if (incerto) metodoIncerto = true; }
    else if (tipo === 'campo') campos.push({ opcao: nome, valor: String(valor), incerto });
    else if (tipo === 'entrada') entrada = true;
  }
  const metodo = metodos.length ? metodos[metodos.length - 1] : (campos.length || entrada ? 'POST' : 'GET');
  const res = (leitura, motivo) => ({ leitura, metodo: metodoIncerto ? null : metodo, endpoint, ...(motivo ? { motivo } : {}) });
  if (estranhas.length) return res(false, `opção ou argumento que o guardião não reconhece no gh api (${estranhas.slice(0, 3).join(', ')})`);
  if (metodoIncerto) return res(false, 'método do gh api incerto ($VAR no -X/--method): escreva -X GET por extenso');
  if (!endpoint) return res(false, 'gh api sem endpoint');
  // GraphQL (ou endpoint incerto, que pode ser graphql): mutation em qualquer campo = escrita, com qualquer método.
  const talvezGraphql = endpointIncerto || /^\/?graphql$/i.test(endpoint);
  if (talvezGraphql && campos.some((c) => RE_GRAPHQL_ESCRITA.test(c.valor))) return res(false, 'GraphQL com mutation/subscription é escrita');
  if (METODOS_DE_LEITURA.has(metodo)) return res(true);
  if (talvezGraphql && !endpointIncerto && metodo === 'POST' && !entrada) {
    const consultas = campos.filter((c) => /^query=/i.test(c.valor));
    const q = consultas[0];
    if (consultas.length !== 1) return res(false, 'GraphQL precisa de exatamente um -f query=...');
    if (q.incerto || (q.opcao === '-F' || q.opcao === '--field') && /^query=@/i.test(q.valor)) return res(false, 'consulta GraphQL vinda de $VAR ou de arquivo: escreva a consulta por extenso');
    const texto = q.valor.slice('query='.length).replace(/#[^\n]*/g, '').trim();
    if (/^(query\b|\{)/i.test(texto)) return res(true);
    return res(false, 'consulta GraphQL que não começa com "query" ou "{"');
  }
  return res(false, `método ${metodo} grava no GitHub`);
}

/** Texto do comando menciona um gh api (para o caso escondido em bash -c, node -e...)? Conta as menções. */
function mencoesGhApi(comando) {
  return (textoNormalizado(comando).match(/\bgh\b.{0,40}?\bapi\b/g) || []).length;
}

/**
 * Confere os `gh api` do comando Bash (PreToolUse, toda sessão). Função pura.
 * @returns {{ok: boolean, leituras: number, mensagem?: string}}
 */
export function conferirGhApi(comando) {
  const erros = [];
  let vistos = 0;
  let leituras = 0;
  let interpretador = false;
  visitarComandos(comando, ({ nome, args, estranho, palavras }) => {
    if (executaTexto(nome, args) || estranho) interpretador = true;
    if (!nome || nome.incerto || nomeBase(nome.valor) !== 'gh') return;
    const depois = palavras.slice(palavras.indexOf(nome) + 1);
    let k = 0;
    while (k < depois.length && !depois[k].incerto && depois[k].valor.startsWith('-')) k += /^(-R|--repo)$/.test(depois[k].valor) ? 2 : 1;
    if (!depois[k] || depois[k].incerto || depois[k].valor.toLowerCase() !== 'api') return;
    vistos++;
    const a = analisarGhApi(depois.slice(k + 1));
    if (a.leitura) leituras++;
    else erros.push(`gh api ${a.metodo || '?'} ${a.endpoint || ''}`.trim() + `: ${a.motivo}`);
  });
  if (interpretador && mencoesGhApi(comando) > vistos)
    erros.push('gh api dentro de bash -c, eval, xargs, source, here-doc ou script (node -e, python -c...) não é aceito: rode o gh api direto no comando');
  if (!erros.length) return { ok: true, leituras };
  return { ok: false, leituras, mensagem: mensagemGhApi(erros) };
}

export function mensagemGhApi(erros) {
  return (
    `[guardião Macuxi] BLOQUEADO (gh api): o gh api só é aceito para LEITURA:\n${erros.map((e) => ` - ${e}`).join('\n')}\n` +
    'Aceito: gh api <endpoint> (sem -f/-F/--input), gh api -X GET <endpoint> -f q=... e gh api graphql -f query=\'query { ... }\'. ' +
    'Para gravar no GitHub use o comando próprio do gh (gh pr create/comment/edit, gh issue ...); merge só pelo gh pr merge, com as regras do v5.\n' +
    'Não contorne o bloqueio (script, alias, outra ferramenta): se precisar gravar pela API, peça ao gerente-projetos ou ao Alexandre por recado.'
  );
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

/** Arquivo comum existe? (injetável nos testes) */
const ehArquivo = (caminho) => { try { return statSync(caminho).isFile(); } catch { return false; } };

/**
 * Onde está o gh (guardião v6, T-0050): primeiro o PATH do processo do hook; no Windows, também
 * %ProgramFiles%\GitHub CLI\gh.exe e %LOCALAPPDATA%\Programs\GitHub CLI\gh.exe (instalador do gh, que
 * nem sempre entra no PATH do processo do Claude Code). Não achou = null (quem chama falha fechado).
 * Pasta relativa no PATH (".") não vale: seria um "gh" escrito na pasta do agente.
 * @param {{env?: Record<string, string|undefined>, plataforma?: string, existe?: (caminho: string) => boolean}} [o]
 * @returns {string|null} caminho completo do executável
 */
export function localizarGh({ env = process.env, plataforma = process.platform, existe = ehArquivo } = {}) {
  const windows = plataforma === 'win32';
  const p = windows ? win32 : posix;
  const valor = (nome) => {
    const k = Object.keys(env).find((x) => (windows ? x.toLowerCase() === nome.toLowerCase() : x === nome));
    return k ? String(env[k] || '').trim() : '';
  };
  const nomes = windows ? ['gh.exe', 'gh.com'] : ['gh'];
  const candidatos = [];
  for (const pasta of valor('PATH').split(windows ? ';' : ':')) {
    const limpa = pasta.trim().replace(/^"(.*)"$/, '$1');
    if (!limpa || !p.isAbsolute(limpa)) continue;
    for (const n of nomes) candidatos.push(p.join(limpa, n));
  }
  if (windows) {
    const programas = valor('ProgramFiles');
    const local = valor('LOCALAPPDATA');
    if (programas && p.isAbsolute(programas)) candidatos.push(p.join(programas, 'GitHub CLI', 'gh.exe'));
    if (local && p.isAbsolute(local)) candidatos.push(p.join(local, 'Programs', 'GitHub CLI', 'gh.exe'));
  }
  return candidatos.find((c) => { try { return existe(c); } catch { return false; } }) || null;
}
export const ONDE_PROCURA_GH = 'PATH; no Windows também %ProgramFiles%\\GitHub CLI\\gh.exe e %LOCALAPPDATA%\\Programs\\GitHub CLI\\gh.exe';

/**
 * `gh pr view N -R aloirr/macuxifdv --json files,headRefOid,changedFiles` (timeout de 20 s).
 * MACUXI_GH_SIMULADO=<arquivo.mjs>: roda esse script no lugar do gh (só nos testes; a variável é do
 * processo do Claude Code, que o agente não altera).
 */
export function consultarPrGh(pr, { env = process.env, timeout = 20000, plataforma = process.platform, existe } = {}) {
  const simulado = String(env.MACUXI_GH_SIMULADO || '').trim();
  const gh = simulado ? null : localizarGh({ env, plataforma, ...(existe ? { existe } : {}) });
  if (!simulado && !gh) return { ok: false, erro: `gh não encontrado (${ONDE_PROCURA_GH})` };
  const args = ['pr', 'view', String(pr), '-R', REPO_OFICIAL, '--json', 'files,headRefOid,changedFiles'];
  let saida;
  try {
    saida = simulado
      ? execFileSync(process.execPath, [simulado, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
      : execFileSync(gh, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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

/**
 * Recados da caixa do gerente (nome + texto); pasta ilegível = nenhum. Com os recados no GitHub (T-0143, ADR 0039),
 * a lista vem direto do main do GitHub, nunca do cache local (que um agente poderia adulterar), e só os recados do
 * Alexandre (R-...-alexandre.md) são baixados. Sem GitHub: nenhum (sem autorização, o merge não passa).
 */
export function lerRecadosDoGerente(raiz, { env = process.env, conexao = () => conexaoDeRecados({ env }) } = {}) {
  if (modoDosRecados({ raiz, env }) === 'github') {
    try {
      return recadosDaPastaNoGitHub({ ...conexao(), pasta: AGENTE_DO_MERGE, filtro: (nome) => remetenteDoRecado(nome) === 'alexandre' });
    } catch { return []; }
  }
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

// ───────────────────────────── guardião v6 (T-0050): leitura × escrita ─────────────────────────────
//
// O v5 bloqueava todo comando com "interpretador" (bash -c, node -e, eval, ou qualquer nome de comando
// incerto, como a atribuição `f=$(...)` dentro de um for) que citasse recados e alexandre, mesmo só
// lendo. O v6 classifica CADA comando simples (inclusive dentro de $(...), bash -c e eval literais):
//  - leitura: não grava arquivo (ls, cat, grep, find sem -exec que grava, git de leitura, for/while,
//    atribuição VAR=..., node -e/python -c sem API de escrita, coord.mjs, gh de consulta...);
//  - escrita: grava em alvos evidentes (> >> tee cp mv rm sed -i touch ln git checkout -- x...);
//  - opaco: pode gravar em qualquer lugar e o guardião não vê onde (script, node -e com writeFile,
//    bash sem -c, eval com $VAR, xargs com comando que grava, tar -x, git apply, nome incerto...).
// O bloqueio "recado em nome do Alexandre" só vale quando há escrita/opaco (ver motivosRecadoFalso).

/** Builtins e palavras do shell que não gravam arquivo (o resto da linha é dado, não comando). */
const BUILTINS_LEITURA = new Set([
  'for', 'select', 'case', 'in', '[[', ']]', 'read', 'break', 'continue', 'return', 'exit', 'local', 'declare',
  'typeset', 'readonly', 'shift', 'wait', ':', 'let', 'getopts', 'hash', 'alias', 'unalias', 'jobs', 'popd', 'dirs',
]);
/** git que grava objetos/índice/arquivos sem alvo evidente (plumbing e patch): opaco. */
const GIT_OPACO = new Set([
  'apply', 'am', 'hash-object', 'update-index', 'read-tree', 'write-tree', 'commit-tree', 'update-ref', 'mktree',
  'mktag', 'fast-import', 'filter-branch', 'filter-repo', 'replace', 'notes', 'worktree', 'submodule', 'archive',
  'bundle', 'unpack-objects', 'symbolic-ref', 'checkout-index', 'merge-file', 'difftool', 'mergetool', 'instaweb', 'p4', 'svn',
]);
/** gh que grava arquivo local (o resto só consulta ou mexe no GitHub; o merge tem trava própria). */
const GH_GRAVA = /^(pr checkout|pr co|run download|release download|repo clone|repo fork|gist clone|codespace cp|extension|ext|extensions|alias|attestation download)$/;
/** API de escrita/execução em código inline (node -e, python -c, perl -e...): presença = opaco. */
export const CODIGO_QUE_GRAVA = /write|append|stream|copy|\bcp|rename|move|\bmv|unlink|\brm|delete|remove|mkdir|link|trunc|open|exec|spawn|fork|system|popen|process|child|shutil|subprocess|eval|function|import|require\s*\(\s*[^'"\s]|\[|fromcharcode|atob|buffer|base64|\\x|\\u|save|dump|\bput|output|reflect|getattr|globals|vars\(|__|deno\.|bun\.|`/i;
/** Opção que traz o código inline, por linguagem (o argumento seguinte é o código). */
const FLAG_DE_CODIGO = {
  node: /^(-e|-p|-pe|--eval|--print)$/, nodejs: /^(-e|-p|-pe|--eval|--print)$/, bun: /^(-e|--eval|-p|--print)$/,
  python: /^-[a-zA-Z]*c$/, python3: /^-[a-zA-Z]*c$/, py: /^-[a-zA-Z]*c$/,
  perl: /^-[a-zA-Z]*[eE]$/, ruby: /^-[a-zA-Z]*e$/, php: /^-r$/, lua: /^-e$/,
};
const OPCOES_SEGURAS = /^(-[nlawWsSqBuE0]{1,3}|--no-warnings|--input-type=(module|commonjs))$/;
const LINGUAGENS_INLINE = { '-e': true, '-p': true, '-pe': true, '--eval': true, '--print': true };
const AWK = new Set(['awk', 'gawk', 'mawk', 'nawk']);
const ESCREVE_COM_ALVO = new Set(['tee', 'touch', 'truncate', 'rm', 'unlink', 'shred', 'cp', 'mv', 'install', 'ln', 'chmod', 'chown', 'chgrp', 'dd', 'curl', 'sed', 'perl', 'rsync']);
/** Gravam nomes que vêm de fora do comando (arquivo compactado, URL, patch): sem alvo evidente = opaco. */
const ESCREVE_NOMES_DE_FORA = new Set(['tar', 'bsdtar', 'unzip', 'patch', 'wget', 'cpio', '7z', '7za', 'gunzip', 'gzip', 'bunzip2', 'unxz']);

const ctxNeutro = { existe: () => false, ehDiretorio: () => false, ler: () => null };
const textoDe = (palavras) => palavras.map((w) => w.valor).join(' ');

/** Remove VAR=... (também `f=$(...)`: a atribuição em si não grava), palavras-chave e prefixos. */
function semAtribuicoes(palavras) {
  const p = palavras.slice();
  for (;;) {
    if (!p.length) return { nome: undefined, args: [], palavras: p };
    const v = p[0].valor;
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(v)) { p.shift(); continue; }
    if (PALAVRAS_CHAVE.has(v)) { p.shift(); continue; }
    const n = nomeBase(v);
    if (!p[0].incerto && PREFIXOS.has(n)) {
      p.shift();
      while (p.length && (p[0].valor.startsWith('-') || (n === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p[0].valor)))) {
        if (n === 'env' && /^-[a-zA-Z]*[uSC]$|^--(unset|split-string|chdir)$/.test(p[0].valor)) return { nome: { valor: '$env', incerto: true }, args: [], palavras: p };
        p.shift();
      }
      if (n === 'timeout' && p.length) p.shift();
      continue;
    }
    return { nome: p[0], args: p.slice(1), palavras: p };
  }
}

/**
 * Classifica um comando simples (palavras já sem os redirecionamentos). Função pura.
 * @returns {{tipo: 'leitura'|'escrita'|'opaco', alvos?: {valor: string, incerto: boolean}[], interno?: string, motivo?: string}}
 *   interno: texto de bash -c/eval literal (o chamador analisa como comando).
 */
export function classificarComando(palavras) {
  const { nome, args } = semAtribuicoes(palavras);
  if (!nome) return { tipo: 'leitura' };
  if (nome.incerto) return { tipo: 'opaco', motivo: `nome de comando incerto (${nome.valor})` };
  const n = nomeBase(nome.valor);
  const v = args.map((a) => a.valor);
  const literal = args.every((a) => !a.incerto);
  if (BUILTINS_LEITURA.has(n) || SO_LEITURA.has(n) || n === 'cd' || n === 'pushd') return { tipo: 'leitura' };
  if (SHELLS.has(n)) {
    const i = args.findIndex((a) => /^-[a-z]*c$/.test(a.valor));
    if (i >= 0 && args[i + 1] && !args[i + 1].incerto) return { tipo: 'leitura', interno: args[i + 1].valor };
    return { tipo: 'opaco', motivo: `${n} sem -c literal (script, stdin ou here-doc)` };
  }
  if (n === 'eval') return literal ? { tipo: 'leitura', interno: v.join(' ') } : { tipo: 'opaco', motivo: 'eval com $VAR/$(...)' };
  if (n === 'xargs' || n === 'parallel') {
    let i = 0;
    while (i < args.length && args[i].valor.startsWith('-')) i += /^-[IinPLdEsa]$|^--(replace|max-args|max-procs|delimiter|eof|arg-file)$/.test(args[i].valor) ? 2 : 1;
    const resto = args.slice(i);
    if (!resto.length) return { tipo: 'leitura' }; // xargs sozinho = echo
    const sub = classificarComando(resto);
    return sub.tipo === 'leitura' && !sub.interno ? sub : { tipo: 'opaco', motivo: `${n} ${resto[0].valor}` };
  }
  if (SEMPRE_EXECUTAM.has(n)) return { tipo: 'opaco', motivo: n };
  if (n === 'node' || n === 'nodejs') {
    if (v.length === 1 && ['-v', '--version'].includes(v[0])) return { tipo: 'leitura' };
    const i = args.findIndex((a) => !a.valor.startsWith('-'));
    if (i >= 0 && !args[i].incerto && nomeBase(args[i].valor) === 'coord.mjs' && !args.slice(0, i).some((a) => LINGUAGENS_INLINE[a.valor]))
      return { tipo: COORD_SO_LEITURA.has(v[i + 1] ?? 'ajuda') ? 'leitura' : 'coord' };
  }
  if (LINGUAGENS.has(n)) {
    if (n === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a.valor))) {
      const r = alvosDoComando({ palavras: [nome, ...args], redirs: [] }, ctxNeutro);
      return r.alvos.length ? { tipo: 'escrita', alvos: r.alvos.map((t) => t.alvo) } : { tipo: 'opaco', motivo: 'perl -i' };
    }
    const flag = FLAG_DE_CODIGO[n];
    const i = flag ? args.findIndex((a) => flag.test(a.valor)) : -1;
    const codigo = i >= 0 ? args[i + 1] : null;
    if (!codigo) return { tipo: 'opaco', motivo: `${n} com script ou stdin` };
    // antes do código, só opções simples (sem -r/--require/--import/-m/-M, que carregam outro código)
    if (!args.slice(0, i).every((a) => !a.incerto && OPCOES_SEGURAS.test(a.valor))) return { tipo: 'opaco', motivo: `${n} com opções que carregam código` };
    if (codigo.incerto || CODIGO_QUE_GRAVA.test(codigo.valor)) return { tipo: 'opaco', motivo: `${n} ${args[i].valor} com código que grava ou executa` };
    return { tipo: 'leitura' };
  }
  if (AWK.has(n)) {
    const prog = args.find((a) => !a.valor.startsWith('-'));
    if (args.some((a) => /^-[a-zA-Z]*f$|^--file/.test(a.valor)) || !prog || prog.incerto || /[>|]|system|getline|fflush|close/.test(prog.valor)) return { tipo: 'opaco', motivo: `${n} que grava ou executa` };
    return { tipo: 'leitura' };
  }
  if (n === 'sort') return v.some((x) => x === '-o' || x.startsWith('--output') || /^-[a-zA-Z]*o/.test(x)) ? { tipo: 'opaco', motivo: 'sort -o' } : { tipo: 'leitura' };
  if (n === 'find') {
    const alvos = [];
    let k = 0;
    while (k < args.length && /^-[HLP]$|^-O\d$|^-D$/.test(args[k].valor)) k += args[k].valor === '-D' ? 2 : 1;
    const raizes = [];
    while (k < args.length && !/^[-(!]/.test(args[k].valor)) raizes.push(args[k++]);
    for (let i = k; i < args.length; i++) {
      const a = args[i];
      if (a.valor === '-delete') { alvos.push(...(raizes.length ? raizes : [{ valor: '.', incerto: false }])); continue; }
      if (/^-fprint0?$|^-fprintf$|^-fls$/.test(a.valor)) { if (args[i + 1]) alvos.push(args[i + 1]); i++; continue; }
      if (/^-(exec|execdir|ok|okdir)$/.test(a.valor)) {
        let j = i + 1;
        while (j < args.length && args[j].valor !== ';' && args[j].valor !== '+') j++;
        // {} = cada arquivo achado: no lugar dele entram as raízes da busca (alvo evidente da escrita)
        const lugar = raizes.length ? raizes : [{ valor: '.', incerto: false }];
        const sub = classificarComando(args.slice(i + 1, j).flatMap((w) => (w.valor.includes('{}') ? lugar : [w])));
        if (sub.tipo === 'escrita') alvos.push(...sub.alvos);
        else if (sub.tipo !== 'leitura' || sub.interno) return { tipo: 'opaco', motivo: `find ${a.valor} que grava` };
        i = j;
      }
    }
    return alvos.length ? { tipo: 'escrita', alvos } : { tipo: 'leitura' };
  }
  if (n === 'git') {
    let i = 0;
    while (i < args.length && args[i].valor.startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i].valor) ? 2 : 1;
    const sub = args[i];
    if (!sub || sub.incerto) return { tipo: 'opaco', motivo: 'git com subcomando incerto' };
    if (args.slice(0, i).some((a) => a.valor === '-c')) return { tipo: 'opaco', motivo: 'git -c (alias/configuração na hora)' };
    if (GIT_OPACO.has(sub.valor)) return { tipo: 'opaco', motivo: `git ${sub.valor}` };
  }
  if (n === 'gh') {
    const pos = v.filter((x) => !x.startsWith('-'));
    if (!literal || GH_GRAVA.test(pos.slice(0, 2).join(' ')) || GH_GRAVA.test(pos[0] || '')) return { tipo: 'opaco', motivo: `gh ${pos.slice(0, 2).join(' ')}` };
    return { tipo: 'leitura' };
  }
  if (n === 'curl' || n === 'dd' || n === 'tee') {
    const r = alvosDoComando({ palavras: [nome, ...args], redirs: [] }, ctxNeutro);
    return r.alvos.length ? { tipo: 'escrita', alvos: r.alvos.map((t) => t.alvo) } : { tipo: 'leitura' };
  }
  if (n === 'sed' && !args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a.valor))) {
    const scripts = [];
    for (let i = 0; i < args.length; i++) {
      if (/^-[a-zA-Z]*[ef]$|^--(expression|file)$/.test(args[i].valor)) { scripts.push(args[i + 1]); i++; } else if (/^--(expression|file)=/.test(args[i].valor)) scripts.push({ ...args[i], valor: args[i].valor.replace(/^[^=]*=/, '') });
    }
    if (!scripts.length) { const s = args.find((a) => !a.valor.startsWith('-')); if (s) scripts.push(s); }
    if (args.some((a) => /^-[a-zA-Z]*f$|^--file/.test(a.valor)) || scripts.some((s) => !s || s.incerto || /(^|[;}\s/])[wWe](\s|$)|\/[a-zA-Z0-9]*w\s/.test(s.valor)))
      return { tipo: 'opaco', motivo: 'sed com w/e (grava ou executa)' };
    return { tipo: 'leitura' };
  }
  if (n === 'git' || ESCREVE_COM_ALVO.has(n) || ESCREVE_NOMES_DE_FORA.has(n)) {
    const r = alvosDoComando({ palavras: [nome, ...args], redirs: [] }, ctxNeutro);
    if (r.soLeitura) return { tipo: 'leitura' };
    if (r.alvos.length) return { tipo: 'escrita', alvos: r.alvos.map((t) => (t.alvo.raiz ? { valor: '.', incerto: false } : t.alvo)) };
    // perl sem -i é linguagem (tratada acima); git sem alvo (add, commit, push, pull, merge...) não cria arquivo novo
    // no disco a partir do comando (o conteúdo vem de commits, que exigem escrita antes, já conferida).
    if (n === 'git') return { tipo: 'leitura' };
    if (ESCREVE_NOMES_DE_FORA.has(n)) return { tipo: 'opaco', motivo: `${n} sem alvo evidente` };
    // cp/mv/ln/rm... com destino incerto ($id-alexandre.md): o alvo existe, só não dá para saber qual
    const incerto = args.find((a) => a.incerto);
    if (incerto) return { tipo: 'escrita', alvos: [incerto] };
    // sem argumento algum (rm sozinho, vindo do find -exec): grava na pasta atual
    if (!args.some((a) => !a.valor.startsWith('-'))) return { tipo: 'escrita', alvos: [{ valor: '.', incerto: false }] };
    return { tipo: 'leitura' };
  }
  if (n === 'pnpm' || n === 'npm' || n === 'yarn') {
    const sub = v.find((x) => !x.startsWith('-')) ?? v[0];
    return sub != null && PACOTES_SO_LEITURA.has(sub) ? { tipo: 'leitura' } : { tipo: 'opaco', motivo: `${n} ${sub || ''}`.trim() };
  }
  return { tipo: 'opaco', motivo: n };
}

const RE_RECADOS = /recados/i;
const RE_ALEXANDRE = /alexandre/i;

/**
 * Escritas do comando inteiro (comandos simples, $(...), bash -c e eval literais, cd acompanhado).
 * @returns {{escritas: {alvo: {valor: string, incerto: boolean}, cwd: string|null}[], opacos: {motivo: string, texto: string}[], coord: boolean}}
 *   cwd: pasta (como escrita no comando) onde a escrita acontece; null = incerta (cd $X).
 */
export function escritasDoComando(comando, cwdInicial = '', nivel = 0) {
  const escritas = [];
  const opacos = [];
  const heredoc = /<<-?\s*['"]?[A-Za-z_]/.test(String(comando));
  let coord = false;
  let cwd = cwdInicial;
  const pilha = [];
  for (const cmd of comandosSimples(tokenizar(comando))) {
    if (cmd.grupo === '(') { pilha.push(cwd); continue; }
    if (cmd.grupo === ')') { if (pilha.length) cwd = pilha.pop(); continue; }
    const todas = [...cmd.palavras, ...cmd.redirs.map((r) => r.alvo)];
    if (nivel < 4) {
      for (const w of todas) {
        if (!w.incerto) continue;
        for (const sub of substituicoes(w.valor)) {
          const r = escritasDoComando(sub, cwd, nivel + 1);
          escritas.push(...r.escritas);
          opacos.push(...r.opacos);
          coord ||= r.coord;
        }
      }
    }
    for (const r of cmd.redirs) {
      if (r.op === '<' || r.op === '<<<' || r.op === '<&') continue;
      if (r.op === '>&' && /^(\d+|-)$/.test(r.alvo.valor)) continue;
      if (!r.alvo.incerto && DESCARTE.test(r.alvo.valor)) continue;
      escritas.push({ alvo: r.alvo, cwd });
    }
    const { nome, args } = semAtribuicoes(cmd.palavras);
    const n = nome && !nome.incerto ? nomeBase(nome.valor) : '';
    if (n === 'cd' || n === 'pushd') {
      const a = args.find((x) => !x.valor.startsWith('-'));
      cwd = !a ? '~' : a.incerto || cwd === null ? null : `${cwd}/${a.valor}`;
      continue;
    }
    const c = classificarComando(cmd.palavras);
    if (c.tipo === 'coord') coord = true;
    else if (c.tipo === 'escrita') for (const alvo of c.alvos) escritas.push({ alvo, cwd, de: n });
    else if (c.tipo === 'opaco') {
      const proprio = textoDe([...cmd.palavras, ...cmd.redirs.filter((r) => r.op === '<<<').map((r) => r.alvo)]);
      opacos.push({ motivo: c.motivo, texto: heredoc ? String(comando) : proprio, cwd });
    }
    if (c.interno && nivel < 4) {
      const r = escritasDoComando(c.interno, cwd, nivel + 1);
      escritas.push(...r.escritas);
      opacos.push(...r.opacos);
      coord ||= r.coord;
    }
  }
  return { escritas, opacos, coord };
}

/**
 * Bloqueia o agente que tenta criar recado em nome de outro — sobretudo `de: alexandre`, que vale
 * como autorização de merge. Só a sessão do Alexandre (MACUXI_AGENTE=alexandre; terminal dele, sem
 * o Claude) envia como alexandre (regra do guardião v4). Função pura.
 *  - node scripts/coord.mjs enviar --de X: X tem de ser o próprio agente (por extenso);
 *  - comando que GRAVA (escrita ou opaco) com "de: alexandre" no texto (here-doc, printf, node -e...);
 *  - comando que cita alexandre e grava (v6, T-0050) em: alvo com "recados" ou "alexandre" no caminho,
 *    alvo incerto ($VAR), pasta incerta ou de recados (cd), ou comando opaco (script, node -e que grava,
 *    bash sem -c...) que cita alexandre ele mesmo ou num comando que também cita recados.
 * Comando só de leitura (ls, cat, grep, find, head, git show/ls-tree/fetch, for que só lê) passa,
 * mesmo citando alexandre e .coord/recados (v6: o v5 bloqueava, falso positivo do gerente).
 * @param {{comando: string, agente: string, cwd?: string, soLeitura?: boolean}} p  soLeitura: ignorado
 *   desde o v6 (a classificação é feita aqui); cwd: pasta atual da sessão (entrada.cwd do hook).
 * @returns {string[]} motivos do bloqueio (vazio = passa)
 */
export function motivosRecadoFalso({ comando, agente, cwd = '' }) {
  if (!agente || agente === 'alexandre') return [];
  const motivos = [];
  visitarComandos(comando, ({ nome, args }) => {
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
  const { escritas, opacos, coord } = escritasDoComando(comando, String(cwd || '').replace(/\\/g, '/'));
  const grava = escritas.length > 0 || opacos.length > 0 || coord;
  if (!grava) return motivos; // só leitura: passa (v6)
  const citaAlexandre = RE_ALEXANDRE.test(t);
  const citaRecados = RE_RECADOS.test(t);
  const pastaSuspeita = (c) => c === null || RE_RECADOS.test(c);
  if (/(^|[^a-z0-9_])de:\s*alexandre\b/.test(t)) {
    motivos.push(`"de: alexandre" no comando: ${agente} não cria recado em nome do Alexandre (só ele, na sessão dele)`);
    return motivos;
  }
  if (!citaAlexandre) return motivos;
  const opaco = opacos.find((o) => RE_ALEXANDRE.test(textoNormalizado(o.texto)) || citaRecados || pastaSuspeita(o.cwd));
  if (opaco)
    motivos.push(`script (bash -c, node -e, eval...) ou comando opaco (${opaco.motivo}) que pode gravar arquivo e cita alexandre${citaRecados ? ' e recados' : ''}: ${agente} não cria recado em nome do Alexandre; use node scripts/coord.mjs enviar --de ${agente} (para só ler, use ls/cat/grep/git show sem gravar)`);
  // alvo: incerto, na pasta de recados, com nome de recado do Alexandre (*alexandre*.md: link simbólico
  // para a pasta de recados) ou gravado numa pasta incerta/de recados (cd)
  const nomeDeRecado = (v) => /alexandre[^/\\]*\.md$/i.test(barras(v).split('/').pop());
  const escrita = escritas.find(({ alvo, cwd: c }) => alvo.incerto || RE_RECADOS.test(alvo.valor) || nomeDeRecado(alvo.valor) || pastaSuspeita(c));
  if (escrita)
    motivos.push(`comando que grava em "${escrita.alvo.valor}"${escrita.cwd === null ? ' (pasta incerta)' : RE_RECADOS.test(escrita.cwd || '') ? ` (na pasta ${escrita.cwd})` : ''} e cita alexandre: ${agente} não cria, altera, move nem apaga recado em nome do Alexandre; use node scripts/coord.mjs enviar --de ${agente}`);
  return motivos;
}

// ───────────────────────────── v6 (T-0050): git add/commit/stash de recados do Alexandre ─────────────────────────────
//
// Pôr no índice, commitar ou guardar no stash um recado do Alexandre que JÁ EXISTE (escrito por ele localmente),
// sem mudar o conteúdo, não é escrever recado em nome dele. Fica liberado se, para cada recado do Alexandre que o
// comando pode levar: (1) o arquivo não foi criado nem alterado durante comandos desta sessão (o PostToolUse
// registra; ver vigiarRecados) e (2) o conteúdo no índice é idêntico ao do disco (git status "A " ou "??"); recado
// já commitado que mudou no índice ou no disco (M, D, R) é recado alterado: imutável.

const SUBCOMANDOS_DE_INDICE = new Set(['add', 'stage', 'commit', 'stash']);
const OPCOES_GIT_COM_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

/** git add/stage/commit/stash (push/save) no comando, inclusive em $(...): [{sub, args, outraPasta}]. */
export function comandosDeIndice(comando) {
  const res = [];
  visitarComandos(comando, ({ nome, args }) => {
    if (!nome || nome.incerto || nomeBase(nome.valor) !== 'git') return;
    let i = 0;
    let outraPasta = false;
    while (i < args.length && args[i].valor.startsWith('-')) {
      if (OPCOES_GIT_COM_VALOR.has(args[i].valor)) { if (args[i].valor !== '-c') outraPasta = true; i += 2; } else i++;
    }
    const sub = args[i];
    if (!sub || sub.incerto || !SUBCOMANDOS_DE_INDICE.has(sub.valor)) return;
    const resto = args.slice(i + 1);
    if (sub.valor === 'stash') {
      const primeiro = resto.find((a) => !a.valor.startsWith('-'));
      if (primeiro && !['push', 'save'].includes(primeiro.valor) && resto.indexOf(primeiro) === 0) return; // list, show, pop, apply...
    }
    res.push({ sub: sub.valor === 'stage' ? 'add' : sub.valor, args: resto, outraPasta });
  });
  return res;
}

/**
 * Motivos para bloquear git add/commit/stash de recados do Alexandre (função pura; [] = passa).
 * @param {{comando: string, cwd?: string, raiz?: string, status: {xy: string, rel: string}[],
 *   tocados?: Set<string>|string[], ehDoAlexandre: (rel: string) => boolean}} p
 */
export function motivosIndiceDeRecados({ comando, cwd = '', raiz = '', status = [], tocados = [], ehDoAlexandre }) {
  const cmds = comandosDeIndice(comando);
  if (!cmds.length) return [];
  const tocadosSet = new Set(tocados);
  const candidatos = (status || []).filter((s) => /^\.coord\/recados\//i.test(s.rel) && ehDoAlexandre(s.rel));
  if (!candidatos.length) return [];
  const naRaiz = !cwd || !raiz || barras(cwd).replace(/\/+$/, '').toLowerCase() === barras(raiz).replace(/\/+$/, '').toLowerCase();
  const afetados = new Map();
  for (const c of cmds) {
    let lista;
    if (c.sub === 'add') {
      const pos = c.args.filter((a) => a.incerto || !a.valor.startsWith('-') || a.valor === '-');
      const todos = c.outraPasta || !naRaiz || c.args.some((a) => !a.incerto && /^(-A|--all|-u|--update|--no-ignore-removal|--pathspec-from-file.*|-[a-zA-Z]*[Au][a-zA-Z]*)$/.test(a.valor))
        || pos.some((a) => a.incerto || a.valor === '.' || a.valor === './' || a.valor.startsWith(':') || /[*?[]/.test(a.valor));
      lista = todos ? candidatos : candidatos.filter((s) => pos.some((a) => {
        const p = barras(a.valor).replace(/^\.\//, '').replace(/\/+$/, '');
        return s.rel === p || s.rel.startsWith(`${p}/`);
      }));
    } else if (c.sub === 'commit') lista = candidatos.filter((s) => s.xy !== '??');
    else lista = candidatos; // stash: o que estiver sujo (com -u, também o não rastreado)
    for (const s of lista) afetados.set(s.rel, s);
  }
  const motivos = [];
  for (const s of afetados.values()) {
    if (tocadosSet.has(s.rel)) {
      motivos.push(`${s.rel}: recado do Alexandre criado ou alterado durante um comando desta sessão; não vai para o índice, o commit nem o stash por esta sessão (se foi o Alexandre escrevendo em paralelo, ele mesmo faz o commit)`);
      continue;
    }
    const [x, y] = [s.xy[0], s.xy[1]];
    if (s.xy === '??' || (x === 'A' && y === ' ')) continue; // novo, índice = disco (ou ainda fora do índice)
    if (x === 'A') motivos.push(`${s.rel}: o conteúdo no índice difere do disco (git status "${s.xy}"); recado do Alexandre só entra no commit idêntico ao que ele escreveu`);
    else motivos.push(`${s.rel}: recado do Alexandre já commitado foi alterado ou apagado (git status "${s.xy}"); recados são imutáveis`);
  }
  return motivos;
}

export function mensagemIndiceDeRecados(agente, motivos) {
  return (
    `[guardião Macuxi] BLOQUEADO (recado no índice): ${agente} não leva ao índice, ao commit nem ao stash recado do Alexandre que não esteja como ele escreveu:\n` +
    `${motivos.map((m) => ` - ${m}`).join('\n')}\n` +
    'Recado do Alexandre já existente e intacto (não tocado nesta sessão, índice = disco) pode ir para o add, o commit e o stash. Não contorne o bloqueio.'
  );
}

/**
 * O PostToolUse deste comando deve registrar os recados do Alexandre que mudarem durante ele? (v6)
 * Sim quando o comando pode gravar sem o guardião ver onde (opaco) ou grava em alvo incerto, de recado ou
 * em pasta incerta/de recados. Não quando só leva ao índice (add/commit/stash: o git move o conteúdo sem
 * mudá-lo) nem quando só grava em alvos evidentes de fora dos recados (o que mudar em recado nesse tempo
 * é outra pessoa em paralelo).
 */
export function vigiarRecados(comando, cwd = '') {
  const { escritas, opacos } = escritasDoComando(comando, String(cwd || '').replace(/\\/g, '/'));
  if (opacos.length) return true;
  // escrita do próprio git (stash, restore, checkout --) só move conteúdo que já está em commit/stash
  return escritas.some(({ alvo, cwd: c, de }) => de !== 'git' && (alvo.incerto || RE_RECADOS.test(alvo.valor) || /alexandre/i.test(alvo.valor) || c === null || RE_RECADOS.test(c || '')));
}

export function mensagemRecadoFalso(agente, motivos) {
  return (
    `[guardião Macuxi] BLOQUEADO (recado): ${agente} não envia recado em nome de outro:\n` +
    `${motivos.map((m) => ` - ${m}`).join('\n')}\n` +
    'Recado do Alexandre (sobretudo "autorizo o merge do PR #N no commit <sha>") só ele escreve. Não contorne o bloqueio.'
  );
}

// ───────────────────────────── guardião v6 (T-0050): merge pela ferramenta MCP do GitHub ─────────────────────────────
//
// Hook PreToolUse .claude/hooks/guarda-merge-mcp.mjs (matcher das ferramentas MCP com "merge" no nome).
// Mesmas regras do merge pelo gh do v5, para quem faz o merge pelo MCP (mcp__github__merge_pull_request e variações):
//  a) só sessão principal (subagente nunca) de um agente do time com identidade conferida (MACUXI_AGENTE,
//     sessão local, branch <agente>/T-nnnn ou trailer "Agente:" do branch nuvem/*); alexandre e sessão sem
//     agente não (o Alexandre faz o merge pelo GitHub);
//  b) aloirr/macuxifdv, merge_method "squash", SHA esperado de 40 caracteres (campo sha, se a ferramenta
//     tiver, ou a linha "Head-SHA: <sha>" na commit_message) e commit_message terminando com "Agente: <nome>";
//     qualquer outro parâmetro = bloqueado; auto-merge e merge de branch sem PR = bloqueados;
//  c) o hook consulta o GitHub pela API REST (gh api; o GraphQL não responde nas sessões da nuvem):
//     PR aberto, head = SHA esperado, CI do head do PR verde e CI do main verde (todos os check-runs
//     concluídos com success/neutral/skipped; "main vermelho = nuvem não faz merge");
//  d) PR com caminho de governança (CAMINHOS_DE_GOVERNANCA): nunca na nuvem (CLAUDE_CODE_REMOTE=true); localmente
//     só o gerente-projetos com identidade confiável (como no v5), com o recado do Alexandre "autorizo o merge do
//     PR #N no commit <sha>" (mesmo N e SHA) e "Agente: alexandre" na commit_message (CI da T-0049).
//  gh ausente, sem rede, sem login, resposta inválida, lista de arquivos ou de checks incompleta, prazo estourado
//  → BLOQUEADO (falha fechada).

const CABECALHO_MCP = '[guardião Macuxi] BLOQUEADO (merge pelo MCP do GitHub):';
export const SHA_COMPLETO = /^[0-9a-f]{40}$/i;
/** Parâmetros aceitos na ferramenta de merge (nomes de variações do MCP do GitHub). */
export const CHAVES_MERGE_MCP = {
  owner: ['owner'],
  repo: ['repo', 'repository'],
  pr: ['pullNumber', 'pull_number', 'pullRequestNumber', 'pull_request_number', 'prNumber', 'pr_number', 'number'],
  metodo: ['merge_method', 'mergeMethod', 'method'],
  titulo: ['commit_title', 'commitTitle'],
  mensagem: ['commit_message', 'commitMessage'],
  sha: ['sha', 'expected_head_sha', 'expectedHeadSha', 'head_sha', 'headSha', 'match_head_commit', 'matchHeadCommit'],
};
const RE_HEAD_SHA = /^\s*Head-SHA:[ \t]*([0-9a-zA-Z]+)[ \t]*$/gim;
const RE_AGENTE = /^\s*Agente:[ \t]*(\S+)[ \t]*$/i;
/** Conclusões de check-run que contam como verde. */
export const CONCLUSOES_VERDES = ['success', 'neutral', 'skipped'];

/** mcp__<servidor>__<nome> → {servidor, nome}; null se não for ferramenta MCP. */
export function partesFerramentaMcp(ferramenta) {
  const m = String(ferramenta || '').match(/^mcp__(.+?)__(.+)$/);
  return m ? { servidor: m[1], nome: m[2] } : null;
}

/**
 * Que tipo de merge a ferramenta faz: 'merge-pr' | 'auto-merge' | 'outro-merge' | null (não é merge).
 * Ferramenta de outro servidor sem "pull"/"pr" no nome (ex.: mesclar desenhos) não é merge de PR.
 * Consulta (get/list/search/read/view/show...) também não.
 */
export function tipoFerramentaMerge(ferramenta) {
  const p = partesFerramentaMcp(ferramenta);
  if (!p) return null;
  const n = p.nome.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!n.includes('merge')) return null;
  if (/^(get|list|search|read|view|show)/.test(n) && !/(and|then)merge/.test(n)) return null;
  const github = /git[-_]?hub|^gh$|[-_]gh$|^gh[-_]/i.test(p.servidor);
  const pr = /pull|pr/.test(n);
  if (!github && !pr) return null;
  if (/auto/.test(n)) return 'auto-merge';
  return pr ? 'merge-pr' : 'outro-merge';
}

/** Linhas do último bloco da mensagem (bloco de trailers); [] se a mensagem tem um bloco só. Igual ao CI da T-0049. */
export function ultimoBlocoDaMensagem(mensagem) {
  const blocos = [];
  let atual = [];
  for (const linha of String(mensagem || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (linha.trim() === '') { if (atual.length) blocos.push(atual); atual = []; } else atual.push(linha);
  }
  if (atual.length) blocos.push(atual);
  return blocos.length >= 2 ? blocos[blocos.length - 1] : [];
}

/**
 * Valida os parâmetros da ferramenta de merge (regra b). Função pura.
 * @returns {{erros: string[], pr: number|null, sha: string|null, agenteDoCommit: string|null}}
 */
export function validarEntradaMergeMcp(entrada) {
  const erros = [];
  const obj = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
  const conhecidas = new Set(Object.values(CHAVES_MERGE_MCP).flat());
  const desconhecidas = Object.keys(obj).filter((k) => !conhecidas.has(k));
  if (desconhecidas.length) erros.push(`parâmetro(s) não aceito(s) no merge: ${desconhecidas.join(', ')} (aceitos: owner, repo, pullNumber, merge_method, commit_title, commit_message, sha)`);
  const pegar = (campo) => {
    const presentes = CHAVES_MERGE_MCP[campo].filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '');
    if (presentes.length > 1 && new Set(presentes.map((k) => String(obj[k]).trim().toLowerCase())).size > 1) erros.push(`${presentes.join(' e ')} com valores diferentes`);
    return presentes.length ? obj[presentes[0]] : undefined;
  };
  // repositório: owner + repo, ou repo = "owner/nome"
  const dono = pegar('owner');
  const nomeRepo = pegar('repo');
  const repo = (dono !== undefined ? `${dono}/${nomeRepo ?? ''}` : String(nomeRepo ?? '')).trim().toLowerCase();
  if (dono === undefined && nomeRepo === undefined) erros.push('falta o repositório (owner: "aloirr", repo: "macuxifdv")');
  else if (repo !== REPO_OFICIAL) erros.push(`merge só no repositório ${REPO_OFICIAL} (veio ${repo || 'vazio'})`);
  // PR
  const bruto = pegar('pr');
  let pr = null;
  if (bruto === undefined) erros.push('falta o número do PR (pullNumber)');
  else if (!/^\d+$/.test(String(bruto).trim()) || Number(bruto) < 1) erros.push(`o PR tem de ser o número (veio "${bruto}")`);
  else pr = Number(bruto);
  // método
  const metodo = pegar('metodo');
  if (metodo === undefined) erros.push('falta merge_method: "squash" (sem ele o GitHub faz merge commit)');
  else if (String(metodo).trim().toLowerCase() !== 'squash') erros.push(`merge_method "${metodo}" é proibido: use "squash" (o main recebe um commit por PR)`);
  // SHA esperado: campo próprio e/ou "Head-SHA:" na mensagem; têm de bater
  const mensagem = pegar('mensagem');
  const titulo = pegar('titulo');
  if (titulo !== undefined && /[\r\n]/.test(String(titulo))) erros.push('commit_title com quebra de linha não é aceito');
  const shas = new Set();
  const campo = pegar('sha');
  if (campo !== undefined) shas.add(String(campo).trim().toLowerCase());
  for (const m of String(mensagem ?? '').matchAll(RE_HEAD_SHA)) shas.add(m[1].toLowerCase());
  let sha = null;
  if (!shas.size) erros.push('falta o SHA esperado do head: parâmetro sha (se a ferramenta tiver) ou a linha "Head-SHA: <sha de 40 caracteres>" na commit_message');
  else if (shas.size > 1) erros.push(`SHA esperado repetido com valores diferentes (${[...shas].join(', ')}): informe um só`);
  else if (!SHA_COMPLETO.test([...shas][0])) erros.push(`SHA esperado "${[...shas][0]}" não tem 40 caracteres hexadecimais`);
  else sha = [...shas][0];
  // trailer "Agente:" no último bloco da mensagem (o CI confere o do squash no main)
  let agenteDoCommit = null;
  if (mensagem === undefined) erros.push('falta commit_message com o trailer "Agente: <dono da tarefa>" no último bloco (o corpo padrão do GitHub deixa o main vermelho)');
  else {
    const nomes = ultimoBlocoDaMensagem(mensagem).map((l) => l.match(RE_AGENTE)).filter(Boolean).map((m) => m[1].toLowerCase());
    if (nomes.length !== 1) erros.push(`a commit_message precisa de exatamente um "Agente: <nome>" no último bloco (veio ${nomes.length})`);
    else if (!PESSOAS.includes(nomes[0])) erros.push(`"Agente: ${nomes[0]}" não é do time`);
    else agenteDoCommit = nomes[0];
  }
  return { erros, pr, sha, agenteDoCommit };
}

/** Origens da identificação aceitas para o merge MCP de PR comum (fonte declarada ou confiável, nunca a "restrita"). */
export const ORIGENS_MERGE_MCP = /^(variável MACUXI_AGENTE|argumento do hook|sessão local \(agent_type\)|branch |trailer "Agente:" do branch )/;

/** Quem pode fazer o merge pelo MCP (regra a). Retorna o motivo do bloqueio ou null. */
export function motivoIdentidadeMcp({ agente, origem = '', subagente = false }) {
  if (subagente) return `subagente (${agente || 'sem agente'}) nunca faz merge: devolva à sessão principal`;
  if (!agente) return 'sessão sem agente: pelo Claude, só um agente do time faz o merge (o Alexandre faz pelo GitHub)';
  if (agente === 'alexandre') return 'a sessão do Alexandre pelo Claude não faz merge: o Alexandre faz o merge pelo GitHub, e o PR de governança fica para o gerente com a autorização dele';
  if (!AGENTES.includes(agente)) return `a sessão "${agente}" não tem agente do time identificado: na nuvem, comece com o commit vazio com o trailer "Agente: <dono>" no branch nuvem/T-nnnn-...`;
  if (!ORIGENS_MERGE_MCP.test(origem)) return `a identidade ${agente} veio de "${origem}", que não vale para merge: na nuvem, use o branch nuvem/T-nnnn-... com o trailer "Agente: ${agente}" em todos os commits`;
  return null;
}

/** Situação do CI pelos check-runs de um commit (resposta de GET .../commits/<ref>/check-runs). Função pura. */
export function avaliarChecks(resposta) {
  if (!resposta || !Array.isArray(resposta.check_runs)) return { verde: false, detalhe: 'resposta sem check_runs' };
  const runs = resposta.check_runs;
  if (typeof resposta.total_count !== 'number') return { verde: false, detalhe: 'resposta sem total_count' };
  if (resposta.total_count > runs.length) return { verde: false, detalhe: `a API devolveu ${runs.length} de ${resposta.total_count} checks (lista incompleta)` };
  if (!runs.length) return { verde: false, detalhe: 'nenhum check no commit (o CI não rodou)' };
  const pendentes = runs.filter((r) => r?.status !== 'completed').map((r) => r?.name || '?');
  const falhos = runs.filter((r) => r?.status === 'completed' && !CONCLUSOES_VERDES.includes(String(r.conclusion))).map((r) => `${r?.name || '?'}: ${r?.conclusion}`);
  if (falhos.length) return { verde: false, detalhe: `vermelho (${falhos.slice(0, 5).join('; ')}${falhos.length > 5 ? '; ...' : ''})` };
  if (pendentes.length) return { verde: false, detalhe: `ainda rodando (${pendentes.slice(0, 5).join('; ')}${pendentes.length > 5 ? '; ...' : ''})` };
  return { verde: true, detalhe: `${runs.length} check(s) verdes` };
}

/**
 * Consulta o PR pela API REST (`gh api`), com prazo total. Falha = {ok: false, erro}.
 * MACUXI_GH_SIMULADO=<arquivo.mjs>: roda esse script no lugar do gh (só nos testes; a variável é do processo
 * do Claude Code, que o agente não altera).
 * @returns {{ok: boolean, erro?: string, headRefOid?: string, arquivos?: string[], total?: number, estado?: string,
 *   mesclado?: boolean, ciPr?: {verde: boolean, detalhe: string}, ciMain?: {verde: boolean, detalhe: string}}}
 */
export function consultarPrRest(pr, { env = process.env, timeout = 15000, prazo = 80000, agora = () => Date.now(), plataforma = process.platform, existe } = {}) {
  const simulado = String(env.MACUXI_GH_SIMULADO || '').trim();
  const gh = simulado ? null : localizarGh({ env, plataforma, ...(existe ? { existe } : {}) });
  if (!simulado && !gh) return { ok: false, erro: `gh não encontrado (${ONDE_PROCURA_GH})` };
  const fim = agora() + prazo;
  const api = (caminho) => {
    const resta = Math.min(timeout, fim - agora());
    if (resta <= 0) throw new Error(`prazo de ${Math.round(prazo / 1000)} s para consultar o GitHub estourado`);
    const args = ['api', caminho];
    let saida;
    try {
      saida = simulado
        ? execFileSync(process.execPath, [simulado, ...args], { encoding: 'utf8', timeout: resta, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
        : execFileSync(gh, args, { encoding: 'utf8', timeout: resta, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
      const msg = String(e?.stderr || e?.message || e).trim().split(/\r?\n/)[0].slice(0, 200);
      throw new Error(e?.code === 'ENOENT' ? 'gh não encontrado' : e?.code === 'ETIMEDOUT' || e?.signal === 'SIGTERM' ? `gh não respondeu em ${Math.round(resta / 1000)} s` : `gh api ${caminho} falhou: ${msg}`);
    }
    try { return JSON.parse(saida); } catch { throw new Error(`resposta de gh api ${caminho} não é JSON`); }
  };
  try {
    const base = `repos/${REPO_OFICIAL}`;
    const p = api(`${base}/pulls/${pr}`);
    const head = String(p?.head?.sha || '');
    if (!SHA_COMPLETO.test(head)) return { ok: false, erro: 'resposta do PR sem head.sha' };
    const arquivos = [];
    for (let pagina = 1; pagina <= 35; pagina++) {
      const lista = api(`${base}/pulls/${pr}/files?per_page=100&page=${pagina}`);
      if (!Array.isArray(lista)) return { ok: false, erro: 'resposta da lista de arquivos não é uma lista' };
      for (const f of lista) {
        if (f?.filename) arquivos.push(barras(f.filename));
        if (f?.previous_filename) arquivos.push(barras(f.previous_filename)); // renomeado: o caminho antigo também conta
      }
      if (lista.length < 100) break;
    }
    return {
      ok: true, headRefOid: head, arquivos: [...new Set(arquivos)],
      total: typeof p.changed_files === 'number' ? p.changed_files : undefined,
      estado: String(p.state || ''), mesclado: Boolean(p.merged),
      ciPr: avaliarChecks(api(`${base}/commits/${head}/check-runs?per_page=100`)),
      ciMain: avaliarChecks(api(`${base}/commits/main/check-runs?per_page=100`)),
    };
  } catch (e) {
    return { ok: false, erro: String(e?.message || e) };
  }
}

/**
 * Confere uma chamada de ferramenta MCP (PreToolUse). Ferramenta que não é merge → {ok: true, merge: false}
 * sem consultar nada.
 * @param {{ferramenta: string, entrada: object, agente: string, origem?: string, subagente?: boolean, nuvem?: boolean,
 *   consultarPr?: (pr: number) => any, lerRecados?: () => {nome: string, texto: string}[]}} p
 * @returns {{ok: boolean, merge: boolean, mensagem?: string, pr?: number, governanca?: string[], autorizacao?: string}}
 */
export function conferirMergeMcp({ ferramenta, entrada, agente, origem = '', subagente = false, nuvem = false, consultarPr, lerRecados = () => [] }) {
  const tipo = tipoFerramentaMerge(ferramenta);
  if (!tipo) return { ok: true, merge: false };
  const erros = [];
  const ident = motivoIdentidadeMcp({ agente, origem, subagente });
  if (ident) erros.push(ident);
  if (tipo === 'auto-merge') erros.push('merge automático (auto-merge) é proibido: o merge é na hora, com o head e os dois CIs conferidos');
  if (tipo === 'outro-merge') erros.push(`${ferramenta} não é merge de PR: merge de branch sem PR (sem CI do PR) é proibido`);
  let pr;
  let governanca = [];
  let autorizacao;
  if (tipo === 'merge-pr') {
    const v = validarEntradaMergeMcp(entrada);
    erros.push(...v.erros);
    pr = v.pr ?? undefined;
    // Só consulta o GitHub com os parâmetros e a identidade em ordem.
    if (!erros.length) {
      let consulta;
      try { consulta = consultarPr ? consultarPr(v.pr) : { ok: false, erro: 'sem consulta ao GitHub' }; } catch (e) { consulta = { ok: false, erro: String(e?.message || e) }; }
      let recados = [];
      try { recados = lerRecados() || []; } catch { recados = []; }
      const d = decidirMerge({ pr: v.pr, sha: v.sha, consulta, autorizacoes: autorizacoesDoAlexandre(recados) });
      governanca = d.governanca;
      autorizacao = d.autorizacao;
      if (consulta?.ok) {
        if (consulta.mesclado || consulta.estado !== 'open') erros.push(`o PR #${v.pr} não está aberto (estado: ${consulta.mesclado ? 'já mesclado' : consulta.estado || 'desconhecido'})`);
        if (!consulta.ciPr?.verde) erros.push(`o CI do PR #${v.pr} (head ${String(consulta.headRefOid).slice(0, 12)}) não está verde: ${consulta.ciPr?.detalhe || 'sem resposta'}. Espere o CI ficar verde`);
        if (!consulta.ciMain?.verde) erros.push(`o CI do main não está verde: ${consulta.ciMain?.detalhe || 'sem resposta'}. Main vermelho = nenhum merge (doc 07); o PR espera com "[PRONTO PARA MERGE]"`);
      }
      if (governanca.length) {
        const lista = `${governanca.slice(0, 5).join(', ')}${governanca.length > 5 ? ', ...' : ''}`;
        if (nuvem) erros.push(`o PR #${v.pr} altera caminho de governança (${lista}): sessão da nuvem não faz esse merge. Termine com "[PRONTO PARA MERGE]" e o recado ao gerente (PR, head SHA, arquivos); o merge é local, com a autorização do Alexandre`);
        else if (agente !== AGENTE_DO_MERGE || !ORIGENS_CONFIAVEIS.includes(origem)) erros.push(`PR de governança (${lista}): só o gerente-projetos na sessão local (MACUXI_AGENTE ou agent_type) faz o merge, com a autorização do Alexandre; esta sessão é de ${agente} (${origem})`);
        if (v.agenteDoCommit !== 'alexandre') erros.push('PR de governança: a commit_message do squash termina com "Agente: alexandre" (trailer de governança, CI da T-0049)');
      }
      erros.push(...d.erros.map((e) => e.replace(/--match-head-commit/g, 'SHA esperado')));
    }
  }
  if (!erros.length) return { ok: true, merge: true, pr, governanca, ...(autorizacao ? { autorizacao } : {}) };
  return { ok: false, merge: true, pr, governanca, mensagem: mensagemMergeMcp(erros) };
}

export function mensagemMergeMcp(erros) {
  return (
    `${CABECALHO_MCP}\n${erros.map((e) => ` - ${e}`).join('\n')}\n` +
    'Chamada aceita: merge_pull_request com owner "aloirr", repo "macuxifdv", pullNumber N, merge_method "squash" e commit_message ' +
    'com "Head-SHA: <sha de 40 caracteres>" e "Agente: <dono da tarefa>" no último bloco; CI do PR e do main verdes.\n' +
    `PR de governança: só local, pelo gerente-projetos, com o recado do Alexandre em ${PASTA_AUTORIZACOES} "autorizo o merge do PR #N no commit <sha>".\n` +
    'Não contorne o bloqueio (gh api, outra ferramenta, script): se a regra impede o merge, avise o gerente ou o Alexandre por recado.'
  );
}
