#!/usr/bin/env node
// Mapa do código (Graphify, R-20261122-040155-alexandre). Um script, dois eventos (pelo hook_event_name), nenhum bloqueia:
//  - SessionStart: põe no contexto o comando de consulta e os símbolos mais ligados do mapa;
//  - PreToolUse em Grep, Glob e Bash: antes de buscar arquivo, lembra do mapa até o agente usar o graphify na sessão.
// O mapa é ../grafo-macuxifdv/graphify-out/graph.json, ao lado do repositório (o setup do ambiente o monta);
// MACUXI_GRAFO troca o caminho. Mapa ausente ou ilegível: o início avisa e o lembrete fica calado.
// Não instala nada nem roda o graphify; qualquer erro sai com exit 0, sem saída.
// Testes: .claude/hooks/graphify-mapa.test.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GRAFO_RELATIVO = '../grafo-macuxifdv/graphify-out/graph.json';
const CONSULTA = `graphify query "<pergunta>" --graph ${GRAFO_RELATIVO} --budget 1500`;

const caminhoDoGrafo = () => process.env.MACUXI_GRAFO || resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), GRAFO_RELATIVO);

// Símbolo do código: nó do tipo `code` que não é o próprio arquivo (o rótulo do nó de arquivo é o fim do caminho).
const ehSimbolo = (no) => no.file_type === 'code' && !!no.source_file && !no.source_file.endsWith(no.label);

/** Os `n` símbolos do código com mais ligações (entrada + saída), do maior para o menor; empate pelo rótulo. */
export function nosMaisLigados(grafo, n = 10) {
  const grau = new Map();
  for (const l of grafo.links ?? []) for (const id of new Set([l.source, l.target])) grau.set(id, (grau.get(id) ?? 0) + 1);
  return (grafo.nodes ?? [])
    .filter(ehSimbolo)
    .map((no) => ({ rotulo: no.label, arquivo: no.source_file, ligacoes: grau.get(no.id) ?? 0 }))
    .sort((a, b) => b.ligacoes - a.ligacoes || a.rotulo.localeCompare(b.rotulo))
    .slice(0, n);
}

/** `grafo`: o mapa lido; `null` = não existe; `undefined` = existe e não deu para ler. */
export function textoDeInicio(grafo) {
  const montar = '`graphify extract . --code-only --out ../grafo-macuxifdv` (~1 min)';
  if (grafo === null) return `Mapa do código (Graphify) não encontrado em ${GRAFO_RELATIVO}: monte com ${montar}.`;
  if (!grafo) return `Mapa do código (Graphify) ilegível em ${GRAFO_RELATIVO}: monte de novo com ${montar}.`;
  const nos = nosMaisLigados(grafo).map((x) => `${x.rotulo} (${x.arquivo})`).join('; ');
  return `Mapa do código (Graphify), ${(grafo.nodes ?? []).length} nós: ${CONSULTA}\nSímbolos mais ligados: ${nos}.`;
}

// Começo de comando: início, nova linha, ; & || ( $( ` ou do/then/else; depois, sudo, time, env ou VAR=valor.
const COMECO = String.raw`(?:^|[\n;&(\x60]|\|\||\$\(|\b(?:do|then|else)\s)[ \t]*(?:(?:sudo|time|env)\s+|\w+=\S*\s+)*`;
const BUSCA = new RegExp(`${COMECO}(?:git(?:\\s+-C\\s+\\S+)?\\s+grep|grep|rg|find)\\s`);

/** Bash que busca arquivo: um comando que começa com grep, rg, find ou git grep (o `| grep` que filtra saída não conta). */
export const bashBuscaArquivo = (comando) => typeof comando === 'string' && BUSCA.test(comando);

export const TEXTO_LEMBRETE = `Antes de buscar: ${CONSULTA}`;

// Consulta ao mapa: o graphify com um subcomando (vale também "$(…)/bin/graphify" query); citar o nome não conta.
const USA_GRAPHIFY = /\bgraphify["']?\s+(?:query|explain|path|affected|extract)\b/;

/** `marcador`: arquivo no tmp, por sessão e por agente, criado quando um Bash consulta o mapa. */
export function lembrete(entrada, marcador) {
  const comando = entrada?.tool_input?.command;
  if (entrada?.tool_name === 'Bash' && typeof comando === 'string' && USA_GRAPHIFY.test(comando)) {
    writeFileSync(marcador, '');
    return null;
  }
  if (existsSync(marcador)) return null;
  const busca = entrada?.tool_name === 'Grep' || entrada?.tool_name === 'Glob' || (entrada?.tool_name === 'Bash' && bashBuscaArquivo(comando));
  return busca ? TEXTO_LEMBRETE : null;
}

function lerGrafo(caminho) {
  if (!existsSync(caminho)) return null;
  try { return JSON.parse(readFileSync(caminho, 'utf8')); } catch { return undefined; }
}

const responder = (evento, texto) =>
  texto && process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: texto } }));

async function principal() {
  let txt = '';
  for await (const parte of process.stdin) txt += parte;
  const entrada = JSON.parse(txt);
  const caminho = caminhoDoGrafo();
  if (entrada?.hook_event_name === 'SessionStart') return responder('SessionStart', textoDeInicio(lerGrafo(caminho)));
  if (entrada?.hook_event_name !== 'PreToolUse' || !existsSync(caminho)) return;
  const nome = [entrada.session_id, entrada.agent_id].map((x) => String(x ?? '').replace(/[^\w-]/g, '') || 'sem-id').join('-');
  responder('PreToolUse', lembrete(entrada, join(tmpdir(), `macuxi-graphify-usado-${nome}`)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch(() => {}).finally(() => process.exit(0));
}
