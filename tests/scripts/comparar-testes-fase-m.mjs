#!/usr/bin/env node
/**
 * S0-001/S0-002 (T-0001 critério 1): compara, POR NOME, os testes da Fase M (referência gerada numa
 * cópia descartável, nunca na pasta original) com os testes do macuxifdv nos novos locais.
 *
 * Entradas: relatórios JSON do Vitest (`vitest run --reporter=json --outputFile=...`).
 *   --ref <a.json,b.json,...>   relatórios da Fase M (cópia)          → grava tests/fundacao/fase-m/referencia.json
 *   --dst <a.json,b.json,...>   relatórios dos pacotes do macuxifdv
 *   --raiz-ref <pasta>          raiz da cópia (para caminhos relativos na referência)
 * Sem --ref, usa a referência já gravada (tests/fundacao/fase-m/referencia.json).
 *
 * Casamento em 3 níveis, nesta ordem, cada caso de destino usado uma vez só:
 *   1) exato: describes + título;  2) só o título (describe renomeado/partido);  3) sem casamento.
 * Saída: resumo + lista de faltantes/renomeados; exit 1 se faltar caso ou se algum casado não passou.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizRepo = resolve(aqui, '..', '..');
const arqRef = join(raizRepo, 'tests', 'fundacao', 'fase-m', 'referencia.json');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const lista = (v) => (v ? String(v).split(',').filter(Boolean) : []);
const norm = (p) => p.replace(/\\/g, '/');

function casos(relatorio, raiz) {
  const r = JSON.parse(readFileSync(relatorio, 'utf8'));
  const out = [];
  for (const f of r.testResults) {
    // na referência: o título aparece literalmente no fonte? (false = gerado por it.each)
    const fonte = raiz ? readFileSync(f.name, 'utf8') : undefined;
    for (const a of f.assertionResults) {
      out.push({
        arquivo: raiz ? norm(relative(raiz, f.name)) : norm(relative(raizRepo, f.name)),
        describes: a.ancestorTitles,
        titulo: a.title,
        status: a.status,
        ...(fonte === undefined ? {} : { literal: fonte.includes(a.title) }),
      });
    }
  }
  return out;
}

let referencia;
if (args.ref) {
  const raiz = args['raiz-ref'] ? resolve(args['raiz-ref']) : undefined;
  referencia = lista(args.ref).flatMap((f) => casos(f, raiz));
  mkdirSync(dirname(arqRef), { recursive: true });
  writeFileSync(
    arqRef,
    JSON.stringify(
      {
        origem: 'C:/Users/domon/dev/forca-vendas (árvore de trabalho, HEAD 41283b7) copiada para pasta temporária',
        geradoEm: new Date().toISOString(),
        total: referencia.length,
        casos: referencia,
      },
      null,
      1,
    ) + '\n',
  );
} else {
  referencia = JSON.parse(readFileSync(arqRef, 'utf8')).casos;
}

if (!args.dst) {
  console.log(`Referência gravada: ${arqRef} (${referencia.length} casos). Passe --dst para comparar.`);
  process.exit(0);
}
const destino = lista(args.dst).flatMap((f) => casos(f));
const chaveExata = (c) => [...c.describes, c.titulo].join(' › ');
const livres = new Map();
for (const d of destino) {
  for (const k of [`E:${chaveExata(d)}`, `T:${d.titulo}`]) {
    if (!livres.has(k)) livres.set(k, []);
    livres.get(k).push(d);
  }
}
const usados = new Set();
function tomar(chave) {
  const l = livres.get(chave) ?? [];
  const d = l.find((x) => !usados.has(x));
  if (d) usados.add(d);
  return d;
}

const exatos = [];
const renomeados = [];
const faltantes = [];
for (const r of referencia) {
  const d = tomar(`E:${chaveExata(r)}`);
  if (d) exatos.push({ r, d });
}
for (const r of referencia) {
  if (exatos.some((x) => x.r === r)) continue;
  const d = tomar(`T:${r.titulo}`);
  if (d) renomeados.push({ r, d });
  else faltantes.push(r);
}

const casados = [...exatos, ...renomeados];
const naoPassaram = casados.filter((x) => x.d.status !== 'passed');
const porDestino = {};
for (const { r, d } of casados) {
  const k = `${r.arquivo} → ${d.arquivo}`;
  porDestino[k] = (porDestino[k] ?? 0) + 1;
}

console.log(`Referência Fase M: ${referencia.length} casos (${referencia.filter((r) => r.status === 'passed').length} passaram na cópia)`);
console.log(`Destino (relatórios lidos): ${destino.length} casos`);
console.log(`Casados exatos (describe + título): ${exatos.length}`);
console.log(`Casados só por título (describe renomeado/partido): ${renomeados.length}`);
console.log(`Faltantes: ${faltantes.length}`);
console.log(`Casados que não passaram no destino: ${naoPassaram.length}`);
console.log('\nOrigem → destino (casos):');
for (const [k, n] of Object.entries(porDestino).sort()) console.log(`  ${String(n).padStart(3)}  ${k}`);
if (renomeados.length) {
  console.log('\nRenomeados (describe):');
  for (const { r, d } of renomeados) console.log(`  - ${r.arquivo}: "${chaveExata(r)}"\n      → ${d.arquivo}: "${chaveExata(d)}"`);
}
if (faltantes.length) {
  console.log('\nFALTANTES:');
  for (const r of faltantes) console.log(`  - ${r.arquivo}: "${chaveExata(r)}"`);
}
if (naoPassaram.length) {
  console.log('\nNÃO PASSARAM:');
  for (const { d } of naoPassaram) console.log(`  - ${d.arquivo}: "${chaveExata(d)}" (${d.status})`);
}
process.exit(faltantes.length || naoPassaram.length ? 1 : 0);
