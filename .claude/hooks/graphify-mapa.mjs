#!/usr/bin/env node
// Mapa do código (Graphify, R-20261122-040155-alexandre). Dois hooks, nenhum bloqueia:
//  - `inicio` (SessionStart): põe no contexto os nós mais ligados do mapa e o comando de consulta;
//  - `lembrete` (PreToolUse em Grep, Glob e Bash): antes de buscar arquivo, lembra de consultar o mapa.
// O mapa é ../grafo-macuxifdv/graphify-out/graph.json, ao lado do repositório. O setup do ambiente o monta, e
// MACUXI_GRAFO troca o caminho. Mapa ausente ou ilegível: o `inicio` só avisa e o `lembrete` fica calado.
// O script não instala nada e nunca roda o graphify. Qualquer erro sai com exit 0, sem saída.
// Testes: .claude/hooks/graphify-mapa.test.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GRAFO_RELATIVO = '../grafo-macuxifdv/graphify-out/graph.json';
const CONSULTA = `graphify query "<pergunta>" --graph ${GRAFO_RELATIVO} --budget 1500`;

export const caminhoDoGrafo = (env = process.env, cwd = process.cwd()) =>
  env.MACUXI_GRAFO || resolve(env.CLAUDE_PROJECT_DIR || cwd, GRAFO_RELATIVO);

// Símbolo do código: nó do tipo `code` que não é o próprio arquivo (o rótulo do nó de arquivo é o fim do caminho).
const ehSimbolo = (no) => no.file_type === 'code' && !!no.source_file && !no.source_file.endsWith(no.label);

/** Os `n` símbolos do código com mais ligações (entrada + saída), do maior para o menor; empate pelo rótulo. */
export function nosMaisLigados(grafo, n = 10) {
  const grau = new Map();
  for (const l of grafo.links ?? []) for (const id of [l.source, l.target]) grau.set(id, (grau.get(id) ?? 0) + 1);
  return (grafo.nodes ?? [])
    .filter(ehSimbolo)
    .map((no) => ({ rotulo: no.label, arquivo: no.source_file, ligacoes: grau.get(no.id) ?? 0 }))
    .sort((a, b) => b.ligacoes - a.ligacoes || a.rotulo.localeCompare(b.rotulo))
    .slice(0, n);
}

export function textoDeInicio(grafo) {
  if (!grafo) {
    return `Mapa do código (Graphify) não encontrado em ${GRAFO_RELATIVO}. Monte-o com \`graphify extract . --code-only --out ../grafo-macuxifdv\` (~1 min) antes de procurar arquivos.`;
  }
  const nos = nosMaisLigados(grafo).map((x) => `${x.rotulo} em ${x.arquivo} (${x.ligacoes})`).join('; ');
  return [
    `Mapa do código (Graphify) pronto: ${(grafo.nodes ?? []).length} nós.`,
    `Antes de abrir arquivos para achar onde algo está, consulte: ${CONSULTA} (também explain, path e affected, com o mesmo --graph). Abra só os arquivos que a consulta apontar.`,
    `Símbolos mais ligados: ${nos}.`,
  ].join('\n');
}

/** Bash que busca arquivo: comando que começa com grep, rg, find ou git grep (o `| grep` que filtra saída não conta). */
export const bashBuscaArquivo = (comando = '') => /(^|[;&]\s*|\|\|\s*)(git\s+grep|grep|rg|find)\s/.test(comando.trim()) && !/\bgraphify\b/.test(comando);

export function precisaLembrete(entrada) {
  const nome = entrada?.tool_name;
  if (nome === 'Grep' || nome === 'Glob') return true;
  return nome === 'Bash' && bashBuscaArquivo(entrada?.tool_input?.command);
}

export const TEXTO_LEMBRETE = `Lembrete (Graphify): consultou o mapa antes? ${CONSULTA}`;

function lerGrafo(caminho) {
  if (!existsSync(caminho)) return null;
  try { return JSON.parse(readFileSync(caminho, 'utf8')); } catch { return null; }
}

const responder = (evento, texto) =>
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: texto } }));

async function principal(modo) {
  let txt = '';
  for await (const parte of process.stdin) txt += parte;
  const entrada = txt ? JSON.parse(txt) : {};
  const caminho = caminhoDoGrafo();
  if (modo === 'inicio') return responder('SessionStart', textoDeInicio(lerGrafo(caminho)));
  if (modo === 'lembrete' && existsSync(caminho) && precisaLembrete(entrada)) return responder('PreToolUse', TEXTO_LEMBRETE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal(process.argv[2]).catch(() => {}).finally(() => process.exit(0));
}
