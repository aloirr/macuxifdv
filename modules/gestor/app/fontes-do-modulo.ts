/** Apoio dos testes de varredura: raiz do módulo Gestor e lista de arquivos de produção por filtro de nome. */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const RAIZ = join(__dirname, '..');

/** Percorre `dir` (sem entrar em `node_modules`) e devolve os caminhos cujo nome passa em `filtro`. */
export function fontes(dir: string, filtro: (nome: string) => boolean): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : fontes(p, filtro);
    return filtro(n) ? [p] : [];
  });
}
