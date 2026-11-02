#!/usr/bin/env node
/**
 * Varredura de timers automáticos no app e no BKO (RN-CORE-23; ADR 0018; T-0065).
 *
 * Regra: nenhum timer automático abaixo de 15 min no app (Campo/Gestão) e no BKO. A atualização automática usa o
 * motor (`sincronizarNovidades`) a cada `sync_auto_min` (30, mínimo 15); o resto é o botão Sincronizar/Atualizar.
 * Exceções legítimas (envio da fila, relógio de tela, frases da tela de carga, prazos de requisição) levam o
 * comentário `timer-permitido: <motivo>` na mesma linha ou até 3 linhas acima.
 *
 * O que é checado (arquivos .ts/.tsx de apps/mobile/src, apps/web, packages/ui/src, modules/<m>/app e modules/<m>/web,
 * sem testes):
 * - `setInterval(fn, atraso)`;
 * - `refetchInterval: valor` (React Query).
 * O atraso é avaliado quando é número, conta simples (`15 * 60_000`), constante (`const X = ...` no mesmo arquivo ou
 * exportada uma única vez no repositório) ou `intervaloSyncAutoMs(...)` (sempre >= 15 min). Abaixo de 15 min ou
 * impossível de avaliar = violação, salvo `timer-permitido:`. `setTimeout` não é checado (debounce e animações; o
 * agendador do motor usa `setTimeout` calculado e é revisado na mão).
 *
 * Uso: `node scripts/ci/timers-sync.mjs` (sai 1 com violação). `--json` imprime a lista.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MINIMO_MS = 15 * 60_000;
const RAIZ_PADRAO = fileURLToPath(new URL('../..', import.meta.url));
const MARCA = 'timer-permitido:';
const IGNORAR_DIR = new Set(['node_modules', '.next', '.expo', 'dist', 'build', 'android', 'ios', '.turbo', 'coverage']);

/** Pastas varridas, relativas à raiz. */
export function pastasAlvo(raiz) {
  const fixas = ['apps/mobile/src', 'apps/web', 'packages/ui/src'];
  const mods = join(raiz, 'modules');
  const dosModulos = safeLs(mods).flatMap((m) => ['app', 'web'].map((s) => `modules/${m}/${s}`));
  return [...fixas, ...dosModulos].filter((p) => existe(join(raiz, p)));
}

function safeLs(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}
function existe(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function listar(dir, saida = []) {
  for (const nome of safeLs(dir)) {
    if (IGNORAR_DIR.has(nome)) continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) listar(p, saida);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.(test|spec)\.tsx?$/.test(nome) && !nome.endsWith('.d.ts')) saida.push(p);
  }
  return saida;
}

const RE_CONST = /(?:^|\n)\s*(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*([^;\n]+)/g;

/** Constantes `const NOME = expr` de um texto: nome → expressão. */
export function constantesDe(texto) {
  const m = new Map();
  for (const x of texto.matchAll(RE_CONST)) m.set(x[2], { expr: x[3].trim(), exportada: Boolean(x[1]) });
  return m;
}

/**
 * Valor em ms de uma expressão, ou `null` se não dá para saber. `intervaloSyncAutoMs(...)` vale o mínimo (15 min).
 * `resolver(nome)` devolve a expressão de uma constante (ou `null`).
 */
export function avaliar(expr, resolver, profundidade = 0) {
  const e = expr.trim().replace(/\s+as\s+const$/, '').replace(/(\d)_(?=\d)/g, '$1');
  if (profundidade > 5) return null;
  if (/^intervaloSyncAutoMs\(.*\)$/.test(e)) return MINIMO_MS;
  const subst = e.replace(/(?<![\d.])[A-Za-z_$][\w$]*/g, (nome) => {
    const def = resolver(nome);
    if (def === null) return '\u0000';
    const v = avaliar(def, resolver, profundidade + 1);
    return v === null ? '\u0000' : String(v);
  });
  if (subst.includes('\u0000')) return null;
  const limpo = subst;
  if (!/^[\d\s*+\-/().]+$/.test(limpo)) return null;
  try {
    const v = Function(`"use strict"; return (${limpo});`)();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Argumentos de nível 0 a partir do `(` em `inicio` (aspas e template ignorados de forma simples). */
function argumentos(texto, inicio) {
  let prof = 0;
  let atual = '';
  const args = [];
  let aspas = null;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      atual += c;
      if (c === aspas && texto[i - 1] !== '\\') aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      aspas = c;
      atual += c;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      prof++;
      if (prof === 1 && c === '(') continue;
    } else if (c === ')' || c === '}' || c === ']') {
      prof--;
      if (prof === 0) {
        args.push(atual);
        return args;
      }
    } else if (c === ',' && prof === 1) {
      args.push(atual);
      atual = '';
      continue;
    }
    atual += c;
  }
  return args;
}

function valorDaPropriedade(texto, inicio) {
  let prof = 0;
  let v = '';
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (c === '(' || c === '{' || c === '[') prof++;
    else if (c === ')' || c === '}' || c === ']') {
      if (prof === 0) break;
      prof--;
    } else if ((c === ',' || c === '\n') && prof === 0) break;
    v += c;
  }
  return v.replace(/\/\/.*$/, '').trim();
}

const linhaDe = (texto, pos) => texto.slice(0, pos).split('\n').length;

function permitido(linhas, n) {
  for (let i = Math.max(0, n - 4); i < n; i++) if (linhas[i]?.includes(MARCA)) return true;
  return false;
}

/** Violações de um arquivo. `globais(nome)` resolve constante exportada uma única vez no repositório. */
export function varrerTexto(texto, arquivo, globais = () => null) {
  const locais = constantesDe(texto);
  const resolver = (nome) => locais.get(nome)?.expr ?? globais(nome);
  const linhas = texto.split('\n');
  const saida = [];
  const checar = (pos, tipo, expr) => {
    const n = linhaDe(texto, pos);
    if (permitido(linhas, n)) return;
    const v = expr === undefined ? null : avaliar(expr, resolver);
    if (v !== null && v >= MINIMO_MS) return;
    saida.push({
      arquivo,
      linha: n,
      tipo,
      atraso: expr?.trim() ?? '(sem atraso)',
      ms: v,
      motivo: v === null ? 'atraso que a varredura não consegue avaliar' : `${Math.round(v / 1000)} s < 15 min`,
    });
  };
  for (const m of texto.matchAll(/\bsetInterval\s*\(/g)) {
    // comentário/documentação (linha começando com * ou //) não conta
    const ini = texto.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\*|\/\/)/.test(texto.slice(ini, m.index))) continue;
    const args = argumentos(texto, m.index + m[0].length - 1);
    checar(m.index, 'setInterval', args[1]);
  }
  for (const m of texto.matchAll(/\brefetchInterval\s*:\s*/g)) {
    const ini = texto.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\*|\/\/)/.test(texto.slice(ini, m.index))) continue;
    const valor = valorDaPropriedade(texto, m.index + m[0].length);
    if (valor === 'false' || valor === '0') continue;
    checar(m.index, 'refetchInterval', valor);
  }
  return saida;
}

export function varrer(raiz = RAIZ_PADRAO) {
  const arquivos = pastasAlvo(raiz).flatMap((p) => listar(join(raiz, p)));
  const textos = new Map(arquivos.map((a) => [a, readFileSync(a, 'utf8')]));
  // constantes exportadas: só valem se o nome tem UMA definição no conjunto (senão, ambígua)
  const exportadas = new Map();
  for (const t of textos.values())
    for (const [nome, d] of constantesDe(t)) if (d.exportada) exportadas.set(nome, exportadas.has(nome) ? null : d.expr);
  const globais = (nome) => exportadas.get(nome) ?? null;
  return [...textos].flatMap(([a, t]) => varrerTexto(t, relative(raiz, a).split(sep).join('/'), globais));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = varrer();
  if (process.argv.includes('--json')) console.log(JSON.stringify(v, null, 2));
  else if (v.length === 0) console.log('timers-sync: nenhum timer automático abaixo de 15 min no app e no BKO (RN-CORE-23).');
  else {
    console.error(`timers-sync: ${v.length} timer(s) automático(s) abaixo de 15 min ou sem avaliação (RN-CORE-23, ADR 0018):`);
    for (const x of v) console.error(`  ${x.arquivo}:${x.linha}  ${x.tipo} ${x.atraso} — ${x.motivo}`);
    console.error(`Use o motor (sincronizarNovidades a cada sync_auto_min) ou, se for exceção legítima, comente "${MARCA} <motivo>".`);
  }
  process.exit(v.length === 0 ? 0 : 1);
}
