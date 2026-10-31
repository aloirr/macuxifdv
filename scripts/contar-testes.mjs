#!/usr/bin/env node
/**
 * Conta casos de teste Vitest/Jest por LEITURA ESTÁTICA dos arquivos *.test.ts(x) — não executa nada
 * e não escreve nada na pasta lida. Feito para contar os testes da Fase M (somente leitura; rodar
 * `vitest` lá gravaria cache em node_modules/.vite) e comparar com os novos locais (T-0001).
 *
 * Conta `it(...)`/`test(...)` como 1 e `it.each([...])`/`test.each([...])` pelo número de linhas da
 * tabela. `describe.each` e tabelas em template literal são sinalizados (não contados).
 *
 * Uso: node scripts/contar-testes.mjs <pasta> [<pasta> ...] [--json]
 * Ex.: node scripts/contar-testes.mjs C:/Users/domon/dev/forca-vendas/apps C:/Users/domon/dev/forca-vendas/packages
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const IGNORAR = new Set(['node_modules', '.git', '.next', '.expo', '.turbo', 'dist', 'coverage', '__fixtures__']);

function listar(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) saida.push(...listar(p));
    else if (/\.test\.tsx?$/.test(nome)) saida.push(p);
  }
  return saida;
}

/** Conta elementos de nível 1 do array que começa em src[inicio] === '['. */
function contarElementos(src, inicio) {
  let prof = 0;
  let elementos = 0;
  let temConteudo = false;
  for (let i = inicio; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      if (prof === 1) temConteudo = true;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') {
      if (prof === 1) temConteudo = true;
      prof++;
      continue;
    }
    if (c === ']' || c === ')' || c === '}') {
      prof--;
      if (prof === 0) return elementos + (temConteudo ? 1 : 0);
      continue;
    }
    if (prof === 1) {
      if (c === ',') {
        if (temConteudo) elementos++;
        temConteudo = false;
      } else if (!/\s/.test(c)) temConteudo = true;
    }
  }
  return elementos;
}

function contar(arquivo) {
  const src = readFileSync(arquivo, 'utf8');
  let casos = 0;
  const avisos = [];
  const re = /(^|[^\w.$])(it|test)(\.each)?\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    if (!m[3]) {
      casos++;
      continue;
    }
    const abre = re.lastIndex;
    const prox = src.slice(abre).match(/^\s*(\[|`)/);
    if (prox?.[1] === '[') casos += contarElementos(src, abre + prox[0].length - 1);
    else avisos.push(`each com tabela não suportada perto do caractere ${abre}`);
  }
  if (/describe\.each\s*\(/.test(src)) avisos.push('describe.each multiplica casos: conferir à mão');
  if (/(it|test|describe)\.(skip|todo)\s*\(/.test(src)) avisos.push('há casos skip/todo');
  return { casos, avisos };
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const pastas = args.filter((a) => a !== '--json');
if (pastas.length === 0) {
  console.error('Uso: node scripts/contar-testes.mjs <pasta> [<pasta> ...] [--json]');
  process.exit(2);
}

const linhas = [];
for (const pasta of pastas) {
  for (const arq of listar(pasta).sort()) linhas.push({ arquivo: relative(process.cwd(), arq).replaceAll('\\', '/'), ...contar(arq) });
}
const total = linhas.reduce((s, l) => s + l.casos, 0);

if (json) {
  console.log(JSON.stringify({ total, arquivos: linhas }, null, 2));
} else {
  for (const l of linhas) console.log(`${String(l.casos).padStart(4)}  ${l.arquivo}${l.avisos.length ? `  ⚠ ${l.avisos.join('; ')}` : ''}`);
  console.log(`${String(total).padStart(4)}  TOTAL (${linhas.length} arquivos)`);
}
