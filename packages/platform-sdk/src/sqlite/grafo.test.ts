/// <reference types="node" />
/**
 * Desenho T-0008 P3: o app Android importa o índice do SDK; nada alcançável a partir dele pode puxar `node:*`
 * (o driver `node:sqlite` só sai pelo subcaminho `@macuxi/platform-sdk/sqlite-node`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;

function alcancaveis(inicio: string): Map<string, string[]> {
  const vistos = new Map<string, string[]>();
  const pilha = [inicio];
  while (pilha.length) {
    const arq = pilha.pop()!;
    if (vistos.has(arq)) continue;
    const fonte = readFileSync(arq, 'utf8');
    const especs = [...fonte.matchAll(IMPORT_RE)].map((m) => m[1]!);
    vistos.set(arq, especs);
    for (const e of especs) {
      if (!e.startsWith('.')) continue;
      const base = join(dirname(arq), e);
      const candidato = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((c) => {
        try {
          readFileSync(c);
          return true;
        } catch {
          return false;
        }
      });
      if (candidato) pilha.push(candidato);
    }
  }
  return vistos;
}

describe('grafo do índice do platform-sdk (app Android)', () => {
  it('nenhum módulo do Node alcançável a partir de src/index.ts; o driver node:sqlite fica de fora', () => {
    const grafo = alcancaveis(join(SRC, 'index.ts'));
    const comNode = [...grafo].filter(([, es]) => es.some((e) => e.startsWith('node:'))).map(([a]) => a);
    expect(comNode).toEqual([]);
    expect([...grafo.keys()].some((a) => a.endsWith('driver-node.ts'))).toBe(false);
    expect([...grafo.keys()].some((a) => a.endsWith(join('sqlite', 'armazenamento.ts')))).toBe(true);
  });
});
