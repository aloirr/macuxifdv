// Biblioteca comum do protocolo de coordenação do time Macuxi.
// Usada pelo guardião (.claude/hooks/guarda-donos.mjs) e pela CLI (scripts/coord.mjs).
// Sem dependências externas.
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AGENTES = [
  'gerente-projetos',
  'engenheiro-software',
  'engenheiro-apps',
  'designer-ux',
  'banco-dados',
  'testes',
  'modulo-core',
  'modulo-catalogo',
  'modulo-vendedor',
  'modulo-promotor',
  'modulo-gestor',
  'modulo-pesquisa',
  'modulo-treinamento',
  'modulo-integracao',
];
/** Pode responder pelo próprio diário/lidos e aparecer como dono em `verificar`. */
export const PESSOAS = [...AGENTES, 'alexandre'];
export const DESTINOS = [...AGENTES, 'alexandre', 'todos'];
export const TIPOS = ['pedido', 'pergunta', 'resposta', 'aviso', 'bloqueio', 'entrega', 'revisao'];
export const TIPOS_QUE_EXIGEM_ENCERRAMENTO = ['pedido', 'pergunta', 'bloqueio', 'revisao'];

/** Converte glob simples (*, **, ?) em RegExp. */
export function globParaRegex(padrao) {
  let re = '';
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === '*') {
      if (padrao[i + 1] === '*') {
        i++;
        if (padrao[i + 1] === '/') {
          re += '(?:.*/)?'; // "**/" casa zero ou mais diretórios
          i++;
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

export function carregarDonos(raiz = RAIZ) {
  const arq = join(raiz, '.coord', 'donos.json');
  const dados = JSON.parse(readFileSync(arq, 'utf8'));
  return dados.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));
}

/** Caminho relativo à raiz do repo com barras "/". Retorna null se estiver fora do repo. */
export function caminhoRelativo(caminho, raiz = RAIZ) {
  if (!caminho) return null;
  const abs = isAbsolute(caminho) ? caminho : resolve(raiz, caminho);
  let rel = relative(raiz, abs).replace(/\\/g, '/');
  // Windows: diferença só de maiúsculas/minúsculas na letra do drive
  if (rel.startsWith('..') && process.platform === 'win32') {
    const a = abs.toLowerCase().replace(/\\/g, '/');
    const r = raiz.toLowerCase().replace(/\\/g, '/');
    if (a.startsWith(r + '/')) rel = abs.replace(/\\/g, '/').slice(r.length + 1);
  }
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

/** Primeira regra que casa vence. */
export function donoDe(rel, regras) {
  for (const r of regras) if (r.re.test(rel)) return r.dono;
  return 'sem-dono';
}

/**
 * Decide se o agente pode alterar o arquivo.
 * @returns {{ok: boolean, motivo?: string, dono?: string}}
 */
export function podeAlterar({ agente, ferramenta, rel, raiz = RAIZ, regras = carregarDonos(raiz), conteudo }) {
  // Recados: só criar arquivo novo, na pasta de um destino válido, com o próprio nome como remetente
  // (R-...-<agente>.md) e, se o conteúdo vier junto (Write), "de: <agente>" no cabeçalho.
  // Guardião v5 (T-0044): o nome só CONTER "-<agente>" não basta (R-1-modulo-core-alexandre.md é
  // do remetente alexandre), e ninguém além do Alexandre grava "de: alexandre".
  const mRecado = rel.match(/^\.coord\/recados\/([^/]+)\/([^/]+)$/i);
  if (mRecado) {
    const [, destino, arquivo] = mRecado;
    if (!DESTINOS.includes(destino)) return { ok: false, motivo: `destino de recado inválido: ${destino}` };
    if (ferramenta !== 'Write' || existsSync(join(raiz, rel)))
      return { ok: false, motivo: 'recados são imutáveis: responda com um recado novo (node scripts/coord.mjs enviar --responde-a <id>)' };
    if (remetenteDoRecado(arquivo) !== agente)
      return { ok: false, motivo: `o nome do recado precisa terminar com o remetente (R-...-${agente}.md). Use node scripts/coord.mjs enviar` };
    const de = remetenteDoConteudo(conteudo);
    if (de !== null && de !== agente)
      return { ok: false, motivo: `o recado diz "de: ${de}", mas quem escreve é ${agente}: ninguém envia recado em nome de outro (de: alexandre só o Alexandre)` };
    return { ok: true };
  }
  if (rel.startsWith('.coord/recados/')) return { ok: false, motivo: 'use node scripts/coord.mjs enviar para criar recados' };

  // Diário e marcação de lidos: só o próprio agente.
  const mDiario = rel.match(/^\.coord\/(diario|lidos)\/([^/.]+)\.(md|txt)$/i);
  if (mDiario) {
    return mDiario[2] === agente
      ? { ok: true }
      : { ok: false, motivo: `o diário/lidos de ${mDiario[2]} pertence a ${mDiario[2]}` };
  }

  const dono = donoDe(rel, regras);
  if (dono === agente) return { ok: true, dono };
  // Alexandre (dono do produto) altera arquivo de qualquer dono, como no `verificar`;
  // sem-dono, congelado e as regras de recado/diário/lidos acima continuam valendo.
  if (agente === 'alexandre' && dono !== 'congelado' && dono !== 'sem-dono') return { ok: true, dono };
  const dica =
    dono === 'alexandre'
      ? 'só o Alexandre altera este arquivo: mande recado para "alexandre"'
      : dono === 'congelado'
        ? 'área congelada (Fase M): não alterar'
        : dono === 'sem-dono'
          ? 'caminho sem dono em .coord/donos.json: mande recado ao gerente-projetos'
          : `deixe um recado: node scripts/coord.mjs enviar --de ${agente} --para ${dono} --tipo pedido --assunto "..." --corpo "..."`;
  return { ok: false, dono, motivo: `"${rel}" pertence a ${dono}. ${dica}` };
}

/** Normaliza caminho vindo do git ou do Windows: barras "/", sem "./" no início. */
export function normalizarCaminho(caminho) {
  return String(caminho).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/** "de:" do cabeçalho (front matter) de um recado, em minúsculas; null sem conteúdo ou sem "de:". */
export function remetenteDoConteudo(conteudo) {
  if (typeof conteudo !== 'string') return null;
  const m = conteudo.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const de = m?.[1].match(/^de:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/im);
  return de ? de[1].trim().toLowerCase() : null;
}

/** Remetente pelo nome do arquivo do recado (R-AAAAMMDD-HHMMSS[-n]-<remetente>.md); null se não houver. */
export function remetenteDoRecado(arquivo) {
  const nome = String(arquivo).replace(/\.md$/i, '').toLowerCase();
  return [...PESSOAS].sort((a, b) => b.length - a.length).find((p) => nome.endsWith(`-${p}`)) || null;
}

/**
 * De quem é a mudança, pelas regras do protocolo (função pura):
 * recado → remetente do nome do arquivo; diário/lidos → o próprio agente; resto → donos.json.
 * @returns {{tipo: 'recado'|'recado-fora'|'diario'|'lidos'|'comum', dono: string, destino?: string, arquivo?: string}}
 */
export function donoDaMudanca(caminho, regras) {
  const mRecado = caminho.match(/^\.coord\/recados\/([^/]+)\/([^/]+)$/i);
  if (mRecado) return { tipo: 'recado', destino: mRecado[1], arquivo: mRecado[2], dono: remetenteDoRecado(mRecado[2]) || 'sem-remetente' };
  if (/^\.coord\/recados\//i.test(caminho)) return { tipo: 'recado-fora', dono: 'sem-dono' };
  const mDiario = caminho.match(/^\.coord\/(diario|lidos)\/([^/.]+)\.(md|txt)$/i);
  if (mDiario && PESSOAS.includes(mDiario[2])) return { tipo: mDiario[1].toLowerCase(), dono: mDiario[2] };
  return { tipo: 'comum', dono: donoDe(caminho, regras) };
}

const MOTIVO_RECADO_FORA = 'fora do padrão .coord/recados/<destino>/<id>.md (use node scripts/coord.mjs enviar)';

/**
 * Violações que independem do agente: recado alterado/apagado, destino inválido, recado sem
 * remetente no nome, caminho sem-dono ou congelado. Retorna o motivo ou null.
 */
function violacaoUniversal(status, info) {
  if (info.tipo === 'recado') {
    if (status !== 'A') return `recados são imutáveis (${status === 'D' ? 'apagado' : 'alterado'}): responda com um recado novo`;
    if (!DESTINOS.includes(info.destino)) return `destino de recado inválido: ${info.destino}`;
    if (info.dono === 'sem-remetente') return 'o nome do recado precisa conter o remetente (R-...-<remetente>.md). Use node scripts/coord.mjs enviar';
    return null;
  }
  if (info.tipo === 'recado-fora') return MOTIVO_RECADO_FORA;
  if (info.dono === 'sem-dono') return 'caminho sem dono em .coord/donos.json: mande recado ao gerente-projetos';
  if (info.dono === 'congelado') return 'área congelada: ninguém altera';
  return null;
}

/** Lista as mudanças sem `vistos` repetidos, com caminho normalizado e status de uma letra. */
function* mudancasUnicas(mudancas) {
  const vistos = new Set();
  for (const m of mudancas) {
    const caminho = normalizarCaminho(m.caminho);
    if (!caminho || vistos.has(caminho)) continue;
    vistos.add(caminho);
    yield { status: String(m.status || 'M').charAt(0).toUpperCase(), caminho };
  }
}

/**
 * Classifica as mudanças do git para `coord.mjs verificar` (função pura, sem ler disco).
 * - estrito (com --base): arquivo de outro dono é VIOLAÇÃO.
 * - não estrito (sem --base, árvore compartilhada): arquivo de outro dono é informativo ("outros").
 * - "alexandre" (dono do produto) nunca viola por mexer em arquivo de outro dono.
 * - sem-dono, congelado, recado alterado/apagado/fora do padrão/sem remetente: sempre VIOLAÇÃO.
 * Exceções universais (iguais às do guardião): recado NOVO do próprio agente em
 * .coord/recados/<destino>/, .coord/diario/<agente>.md e .coord/lidos/<agente>.txt.
 * Recado novo com o nome de outro remetente e diário/lidos de outro agente são desse outro.
 * Com `lockAcompanha` (só no estrito, uso do `verificar --base/--por-commit`), aplica a regra
 * "o lock acompanha a dependência" (lockAcompanhaDependencia): o lock que seria violação vai
 * para `acompanhando`, para revisão do engenheiro-software.
 * @param {{agente: string, mudancas: {status: string, caminho: string}[], regras: any[], estrito?: boolean,
 *   lockAcompanha?: boolean, workspaceSoBuilds?: boolean | (() => boolean)}} p
 * @returns {{ok: any[], excecoes: any[], outros: any[], violacoes: any[], acompanhando: any[]}}
 */
export function classificarMudancas({ agente, mudancas, regras, estrito = false, lockAcompanha = false, workspaceSoBuilds = false }) {
  const res = { ok: [], excecoes: [], outros: [], violacoes: [], acompanhando: [] };
  for (const item of mudancasUnicas(mudancas)) {
    const info = donoDaMudanca(item.caminho, regras);
    const universal = violacaoUniversal(item.status, info);
    if (universal) {
      res.violacoes.push({ ...item, dono: info.tipo.startsWith('recado') ? 'ninguém' : info.dono, motivo: universal });
      continue;
    }
    const { dono } = info;
    // Recado: é do agente só se o remetente do nome for ele (v5: R-1-modulo-core-alexandre.md é de alexandre).
    const proprio = dono === agente;
    if (proprio) {
      if (info.tipo === 'comum') res.ok.push({ ...item, dono });
      else res.excecoes.push({ ...item, motivo: info.tipo === 'recado' ? `recado novo para ${info.destino}` : info.tipo === 'diario' ? 'diário do próprio agente' : 'lidos do próprio agente' });
    } else if (!estrito || agente === 'alexandre') res.outros.push({ ...item, dono });
    else {
      const motivo = info.tipo === 'recado'
        ? `o nome do recado precisa conter o remetente (-${agente}); este recado é de ${dono}`
        : info.tipo === 'diario' || info.tipo === 'lidos'
          ? `o diário/lidos de ${dono} pertence a ${dono}`
          : `fora dos caminhos de ${agente}; peça ao dono por recado (node scripts/coord.mjs enviar --de ${agente} --para ${dono} --tipo pedido ...)`;
      res.violacoes.push({ ...item, dono, motivo });
    }
  }
  return estrito && lockAcompanha ? lockAcompanhaDependencia({ agente, resultado: res, workspaceSoBuilds }) : res;
}

// ───────────────────── "o lock acompanha a dependência" (guardião v4, T-0005) ─────────────────────

export const LOCK_PNPM = 'pnpm-lock.yaml';
export const WORKSPACE_PNPM = 'pnpm-workspace.yaml';
/** Chaves do pnpm-workspace.yaml que um agente pode mudar junto com a dependência do próprio pacote. */
export const CHAVES_DE_BUILD = ['allowBuilds', 'onlyBuiltDependencies'];

/** Pasta do pacote de um package.json ("modules/core/package.json" → "modules/core"; raiz → "."), ou null. */
export function pacoteDoPackageJson(caminho) {
  const c = normalizarCaminho(caminho);
  if (c === 'package.json') return '.';
  const m = c.match(/^(.+)\/package\.json$/i);
  return m ? m[1] : null;
}

/**
 * Remove de um pnpm-workspace.yaml os blocos de primeiro nível das CHAVES_DE_BUILD (a linha da
 * chave e as seguintes indentadas ou itens "- " de lista), as linhas em branco e as só de comentário.
 * Sobra o resto do arquivo, para comparar antes × depois (função pura, sem parser de YAML).
 */
export function workspaceSemChavesDeBuild(texto) {
  const chave = new RegExp(`^(?:${CHAVES_DE_BUILD.join('|')}|"(?:${CHAVES_DE_BUILD.join('|')})"|'(?:${CHAVES_DE_BUILD.join('|')})')[ \\t]*:`);
  const fora = [];
  let dentro = false;
  for (const linha of String(texto || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!linha.trim() || /^[ \t]*#/.test(linha)) continue; // linha em branco ou só comentário: não muda nada
    if (dentro && (/^[ \t]/.test(linha) || /^-([ \t]|$)/.test(linha))) continue;
    dentro = chave.test(linha);
    if (!dentro) fora.push(linha.replace(/[ \t]+$/, ''));
  }
  return fora.join('\n');
}

/** pnpm-workspace.yaml mudou só em allowBuilds/onlyBuiltDependencies? (função pura) */
export function workspaceMudouSoEmBuilds(antes, depois) {
  return workspaceSemChavesDeBuild(antes) === workspaceSemChavesDeBuild(depois);
}

/**
 * Regra "o lock acompanha a dependência" (função pura, sobre o resultado do classificarMudancas estrito):
 * a mudança em pnpm-lock.yaml (M/A) e a do pnpm-workspace.yaml (M) feita só em allowBuilds/
 * onlyBuiltDependencies (`workspaceSoBuilds`) deixam de ser violação quando, no MESMO PR/commit,
 * o agente alterou o package.json de um pacote que é dele (está em `ok`). Elas vão para
 * `acompanhando` ("lock acompanhando dependência de <pacote>"), para revisão do engenheiro-software.
 * Sem package.json do próprio agente (só o lock, ou package.json de outro dono) continua violação.
 * `alexandre` não precisa da regra (nunca viola por dono).
 * @param {{agente: string, resultado: {ok: any[], violacoes: any[], acompanhando?: any[]},
 *   workspaceSoBuilds?: boolean | (() => boolean)}} p
 */
export function lockAcompanhaDependencia({ agente, resultado, workspaceSoBuilds = false }) {
  const res = { ...resultado, violacoes: [...resultado.violacoes], acompanhando: [...(resultado.acompanhando || [])] };
  if (agente === 'alexandre') return res;
  const pacotes = [...new Set(res.ok.map((i) => pacoteDoPackageJson(i.caminho)).filter(Boolean))].sort();
  if (!pacotes.length) return res;
  let soBuilds;
  const workspaceOk = () => (soBuilds ??= Boolean(typeof workspaceSoBuilds === 'function' ? workspaceSoBuilds() : workspaceSoBuilds));
  const motivo = `lock acompanhando dependência de ${pacotes.join(', ')}`;
  res.violacoes = res.violacoes.filter((v) => {
    const acompanha = (v.caminho === LOCK_PNPM && (v.status === 'M' || v.status === 'A'))
      || (v.caminho === WORKSPACE_PNPM && v.status === 'M' && workspaceOk());
    if (!acompanha) return true;
    res.acompanhando.push({ ...v, pacotes, motivo: v.caminho === LOCK_PNPM ? motivo : `${motivo} (só ${CHAVES_DE_BUILD.join('/')})` });
    return false;
  });
  return res;
}

// ───────────────────── caminhos de governança (guardião v4, T-0005) ─────────────────────

/** Caminhos que exigem revisão humana (Alexandre) no PR: `coord.mjs governanca --base <ref>`. */
export const CAMINHOS_DE_GOVERNANCA = ['.claude/**', '.coord/donos.json', 'scripts/coord*.mjs', '.github/**'];

/** Mudanças em caminhos de governança, sem repetição (função pura). */
export function mudancasDeGovernanca(mudancas, padroes = CAMINHOS_DE_GOVERNANCA) {
  const res = padroes.map(globParaRegex);
  return [...mudancasUnicas(mudancas)].filter((m) => res.some((re) => re.test(m.caminho)));
}

/**
 * Agrupa as mudanças por dono, sem agente (`verificar` sem agente e sem --base, ou --por-dono).
 * Recados vão para o remetente e diário/lidos para o próprio agente.
 * @returns {{grupos: Record<string, any[]>, violacoes: any[]}}
 */
export function agruparPorDono({ mudancas, regras }) {
  const grupos = {};
  const violacoes = [];
  for (const item of mudancasUnicas(mudancas)) {
    const info = donoDaMudanca(item.caminho, regras);
    const universal = violacaoUniversal(item.status, info);
    if (universal) violacoes.push({ ...item, dono: info.tipo.startsWith('recado') ? 'ninguém' : info.dono, motivo: universal });
    else (grupos[info.dono] ||= []).push({ ...item, dono: info.dono });
  }
  return { grupos, violacoes };
}

/**
 * Agente pelo nome do branch (função pura):
 *   <agente>/T-nnnn[-assunto]  ·  agente/T-nnnn-<agente>  ·  alexandre/...  → agente
 *   nuvem/...                  → { nuvem: true } (agente só pelo trailer "Agente:" de todos os commits)
 * @returns {{agente: string|null, erro?: string, nuvem?: boolean}}
 */
export function agenteDoBranch(branch) {
  const b = String(branch || '').replace(/^refs\/heads\//, '');
  if (!b || b === 'HEAD') return { agente: null };
  let m = b.match(/^agente\/T-\d+-(.+)$/i);
  if (m) {
    const nome = m[1].toLowerCase();
    return PESSOAS.includes(nome) ? { agente: nome } : { agente: null, erro: `o branch "${b}" indica o agente "${m[1]}", que não faz parte do time` };
  }
  if (/^alexandre\//i.test(b)) return { agente: 'alexandre' };
  m = b.match(/^([^/]+)\/T-\d+(?:[-/].*)?$/i);
  if (m && PESSOAS.includes(m[1].toLowerCase())) return { agente: m[1].toLowerCase() };
  if (/^nuvem\//i.test(b)) return { agente: null, nuvem: true };
  return { agente: null };
}

/**
 * Agente pelos trailers "Agente: <nome>" dos commits do PR (função pura).
 * Todos os commits precisam do trailer e com o mesmo agente.
 * @param {{sha: string, assunto?: string, corpo: string}[]} commits  (sem os commits de merge)
 * @returns {{agente: string|null, erro?: 'sem-trailer'|'parcial'|'ambiguo'|'invalido', mensagem?: string}}
 */
export function agenteDosTrailers(commits) {
  const nomes = [];
  const semTrailer = [];
  for (const c of commits) {
    const achados = [...String(c.corpo || '').matchAll(/^Agente:[ \t]*(\S+)[ \t]*$/gim)].map((a) => a[1]);
    if (!achados.length) { semTrailer.push(c); continue; }
    for (const n of achados) {
      if (!PESSOAS.includes(n.toLowerCase()))
        return { agente: null, erro: 'invalido', mensagem: `o trailer "Agente: ${n}" do commit ${String(c.sha).slice(0, 7)} não é um agente do time` };
      if (!nomes.includes(n.toLowerCase())) nomes.push(n.toLowerCase());
    }
  }
  if (nomes.length > 1) return { agente: null, erro: 'ambiguo', mensagem: `agente ambíguo: ${[...nomes].sort().join(', ')}` };
  if (!nomes.length) return { agente: null, erro: 'sem-trailer', mensagem: 'nenhum commit com o trailer "Agente: <nome>"' };
  if (semTrailer.length)
    return {
      agente: null, erro: 'parcial',
      mensagem: `commit(s) sem o trailer "Agente: ${nomes[0]}": ${semTrailer.map((c) => `${String(c.sha).slice(0, 7)}${c.assunto ? ` (${c.assunto})` : ''}`).join(', ')}`,
    };
  return { agente: nomes[0] };
}

/** Nomes dos trailers "Agente: <nome>" de uma mensagem de commit (minúsculos, sem repetição). */
export function trailersAgente(corpo) {
  const nomes = [];
  for (const a of String(corpo || '').matchAll(/^Agente:[ \t]*(\S+)[ \t]*$/gim)) {
    const n = a[1].toLowerCase();
    if (!nomes.includes(n)) nomes.push(n);
  }
  return nomes;
}

// ───────────────────── identificação do agente da sessão (guardião v4, T-0005) ─────────────────────

/**
 * Agente da sessão para os guardiões (.claude/hooks/guarda-donos.mjs e guarda-bash.mjs). Função pura.
 * Ordem (a primeira fonte que responde vence):
 *  1. SUBAGENTE (agent_id no JSON do hook): o agente do subagente (argumento do hook do frontmatter
 *     ou agent_type). Vence MACUXI_AGENTE, que todo subagente herda do processo do Claude Code: a
 *     variável vale só para a sessão principal. Subagente sem agente identificável → restrito.
 *  2. variável MACUXI_AGENTE (sessão principal);
 *  3. argumento do hook (frontmatter); agent_type numa sessão LOCAL (CLAUDE_CODE_REMOTE != "true");
 *     na nuvem, agent_type diferente do "agent" do .claude/settings.json (subagente sem agent_id);
 *  4. branch atual: <agente>/T-nnnn[-assunto], agente/T-nnnn-<agente> → agente do time;
 *     nuvem/* → trailer "Agente: <nome>" com UM ÚNICO nome em todos os commits do branch desde o
 *     main que têm o trailer (commits sem trailer não contam; nomes diferentes = ambíguo);
 *  5. fonte ausente, ambígua ou que declara "alexandre" → comportamento restrito: o agent_type da
 *     sessão; sem agent_type, sessão manual LOCAL = liberada (''); na nuvem, o "agent" do
 *     settings.json (ou 'sessao-sem-agente', fora do time).
 * "alexandre" só por fonte confiável: MACUXI_AGENTE=alexandre (ou a sessão manual local, que já é
 * liberada). Branch alexandre/* e trailer "Agente: alexandre" são declarados pelo próprio agente e
 * NÃO concedem a identidade alexandre (revisão do guardião v3, 🟡 2).
 * Na nuvem (claude.ai/code) a sessão principal recebe o agent_type do "agent" do settings.json
 * (gerente-projetos) seja qual for a tarefa; por isso lá o branch vem antes dele.
 * @param {object} p
 * @param {string} [p.argumento]      process.argv[2] do hook
 * @param {{agent_type?: string, agent_id?: string}} [p.entrada]  JSON do hook
 * @param {Record<string, string|undefined>} [p.env]
 * @param {string|null} [p.agentePadrao]  "agent" do .claude/settings.json
 * @param {() => (string|null)} [p.branch]   branch atual (null com HEAD destacado)
 * @param {() => {sha: string, corpo: string}[]} [p.commitsDoBranch]  do mais novo ao mais velho, sem merges
 * @returns {{agente: string, origem: string}}
 */
export function identificarAgente({ argumento = '', entrada = {}, env = {}, agentePadrao = null, branch = () => null, commitsDoBranch = () => [] } = {}) {
  const arg = String(argumento || '').trim();
  const tipo = String(entrada?.agent_type || '').trim();
  const subagente = Boolean(String(entrada?.agent_id || '').trim());
  const doEnv = String(env.MACUXI_AGENTE || '').trim().toLowerCase();
  const nuvem = String(env.CLAUDE_CODE_REMOTE || '').trim().toLowerCase() === 'true';
  if (subagente) {
    if (arg) return { agente: arg, origem: 'subagente (argumento do hook)' };
    if (tipo) return { agente: tipo, origem: 'subagente (agent_type)' };
    return { agente: SUBAGENTE_SEM_AGENTE, origem: 'subagente sem agent_type (restrito)' };
  }
  if (doEnv) return { agente: doEnv, origem: 'variável MACUXI_AGENTE' };
  if (arg) return { agente: arg, origem: 'argumento do hook' };
  if (tipo && !nuvem) return { agente: tipo, origem: 'sessão local (agent_type)' };
  if (tipo && agentePadrao && tipo !== agentePadrao) return { agente: tipo, origem: 'subagente (agent_type)' };
  let b = null;
  try { b = branch(); } catch { b = null; }
  let ignorado = '';
  if (b) {
    const r = agenteDoBranch(b);
    if (r.agente === 'alexandre') ignorado = ` (branch ${b} não concede alexandre)`;
    else if (r.agente) return { agente: r.agente, origem: `branch ${b}` };
    if (r.nuvem) {
      let commits = [];
      try { commits = commitsDoBranch() || []; } catch { commits = []; }
      const nomes = new Set(commits.flatMap((c) => trailersAgente(c.corpo)));
      const [nome] = [...nomes];
      if (nomes.size === 1 && nome === 'alexandre') ignorado = ` (trailer "Agente: alexandre" do branch ${b} não concede alexandre)`;
      else if (nomes.size === 1 && AGENTES.includes(nome)) return { agente: nome, origem: `trailer "Agente:" do branch ${b}` };
    }
  }
  if (tipo) return { agente: tipo, origem: `agent_type (fonte ausente ou ambígua)${ignorado}` };
  if (!nuvem) return { agente: '', origem: `sessão manual local${ignorado}` };
  return { agente: agentePadrao || SESSAO_SEM_AGENTE, origem: `sessão da nuvem sem agente (restrita)${ignorado}` };
}

/** Agentes "fora do time" usados quando não há identidade (os guardiões barram toda escrita no repositório). */
export const SUBAGENTE_SEM_AGENTE = 'subagente-sem-agente';
export const SESSAO_SEM_AGENTE = 'sessao-sem-agente';

function gitSilencioso(raiz, args) {
  try {
    return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  } catch { return null; }
}

const lerTexto = (arq) => { try { return readFileSync(arq, 'utf8'); } catch { return null; } };

/**
 * Lê HEAD, branch e a base (origin/main, senão main) direto dos arquivos do .git, sem rodar o git
 * (rápido, para a chave do cache). Entende worktree (.git arquivo + commondir) e packed-refs.
 * @returns {{branch: string|null, head: string|null, base: string|null} | null}  null se não der para ler
 */
export function refsDoGit(raiz = RAIZ) {
  try {
    let gitdir = join(raiz, '.git');
    if (statSync(gitdir).isFile()) {
      const m = String(lerTexto(gitdir) || '').match(/^gitdir:[ \t]*(.+?)\s*$/m);
      if (!m) return null;
      gitdir = resolve(raiz, m[1]);
    }
    const cd = lerTexto(join(gitdir, 'commondir'))?.trim();
    const comum = cd ? resolve(gitdir, cd) : gitdir;
    const empacotados = lerTexto(join(comum, 'packed-refs')) || '';
    const ref = (nome) => {
      const solto = lerTexto(join(comum, nome))?.trim();
      if (solto && /^[0-9a-f]{40,64}$/i.test(solto)) return solto;
      for (const l of empacotados.split(/\r?\n/)) {
        const [sha, r] = l.trim().split(/\s+/);
        if (r === nome && /^[0-9a-f]{40,64}$/i.test(sha)) return sha;
      }
      return null;
    };
    const cabeca = lerTexto(join(gitdir, 'HEAD'))?.trim();
    if (!cabeca) return null;
    const m = cabeca.match(/^ref:[ \t]*(refs\/heads\/.+)$/);
    const branch = m ? m[1].slice('refs/heads/'.length) : null;
    const head = m ? ref(m[1]) : (/^[0-9a-f]{40,64}$/i.test(cabeca) ? cabeca : null);
    return { branch, head, base: ref('refs/remotes/origin/main') || ref('refs/heads/main') };
  } catch { return null; }
}

/** Branch atual do repositório (null com HEAD destacado ou fora do git). Lê o .git; senão, git rev-parse. */
export function branchAtual(raiz = RAIZ) {
  const refs = refsDoGit(raiz);
  if (refs) return refs.branch;
  const b = gitSilencioso(raiz, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  return b && b !== 'HEAD' ? b : null;
}

/** Commits do branch pelo git (sem cache): desde origin/main (ou main); sem essas refs, só o último. */
function commitsDoBranchGit(raiz) {
  const base = ['origin/main', 'main'].find((r) => gitSilencioso(raiz, ['rev-parse', '--verify', '-q', `${r}^{commit}`]));
  const intervalo = base ? [`${base}..HEAD`] : ['-1', 'HEAD'];
  const out = gitSilencioso(raiz, ['log', '--no-merges', '--format=%H%x1f%B%x1e', ...intervalo]);
  if (out === null) return null;
  return out.split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean).map((s) => {
    const [sha, corpo] = s.split('\x1f');
    return { sha, corpo: corpo || '' };
  });
}

/** Pasta do cache de identificação (a mesma pasta temporária das fotos do guarda-bash). */
export const PASTA_CACHE = join(tmpdir(), 'macuxi-guarda');

/** Arquivo do cache de identificação do repositório `raiz`. */
export function arquivoCacheIdentificacao(raiz = RAIZ, pasta = PASTA_CACHE) {
  return join(pasta, `ident-${createHash('sha1').update(resolve(raiz)).digest('hex').slice(0, 24)}.json`);
}

/**
 * Commits do branch (sem merges, do mais novo ao mais velho): desde origin/main (ou main);
 * sem essas refs, só o último commit. Com cache por HEAD (+ base) num arquivo temporário: o
 * resultado do git rev-parse/log só é refeito quando o HEAD ou a base mudam (revisão v3, 🟢 4).
 * Do corpo de cada commit o cache guarda só as linhas "Agente:" (o que a identificação usa).
 */
export function commitsDoBranch(raiz = RAIZ, { pastaCache = PASTA_CACHE } = {}) {
  const refs = refsDoGit(raiz);
  const chave = refs?.head ? `${refs.head}|${refs.base || ''}` : null;
  const arq = chave ? arquivoCacheIdentificacao(raiz, pastaCache) : null;
  if (arq) {
    try {
      const c = JSON.parse(readFileSync(arq, 'utf8'));
      if (c && c.chave === chave && Array.isArray(c.commits)) return c.commits;
    } catch { /* sem cache ou ilegível: recalcula */ }
  }
  const commits = commitsDoBranchGit(raiz);
  if (commits === null) return [];
  if (arq) {
    const enxuto = commits.map((c) => ({ sha: c.sha, corpo: trailersAgente(c.corpo).map((n) => `Agente: ${n}`).join('\n') }));
    try {
      mkdirSync(pastaCache, { recursive: true });
      const tmp = `${arq}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ chave, commits: enxuto }));
      renameSync(tmp, arq);
    } catch { /* sem cache: segue sem ele */ }
    return enxuto;
  }
  return commits;
}

/** "agent" do .claude/settings.json (agente padrão da sessão principal), ou null. */
export function agentePadraoDaConfig(raiz = RAIZ) {
  try { return JSON.parse(readFileSync(join(raiz, '.claude', 'settings.json'), 'utf8')).agent || null; } catch { return null; }
}

/** identificarAgente com o git e o settings.json reais do repositório `raiz` (uso nos hooks). */
export function agenteDaSessao({ argumento, entrada, env = process.env, raiz = RAIZ } = {}) {
  return identificarAgente({
    argumento, entrada, env, agentePadrao: agentePadraoDaConfig(raiz),
    branch: () => branchAtual(raiz), commitsDoBranch: () => commitsDoBranch(raiz),
  });
}
