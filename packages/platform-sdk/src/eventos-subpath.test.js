/**
 * T-0024 (decisão a, docs/desenho/T-0024.md §4): `@macuxi/platform-sdk/eventos` é o subpath leve que os `contracts`
 * empacotados fora da API (Conector) usam. Ele só pode depender, em tempo de execução, de `./nomes`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { definirEvento as daRaiz } from './index';
import { definirEvento } from './eventos';
describe('subpath @macuxi/platform-sdk/eventos', () => {
    it('eventos.ts só importa ./nomes em tempo de execução (o resto é import type)', () => {
        const fonte = readFileSync(new URL('./eventos.ts', import.meta.url), 'utf8');
        const deExecucao = [...fonte.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
        expect(deExecucao).toEqual(['./nomes']);
    });
    it('a raiz reexporta a mesma função (definição criada por um ou por outro é igual)', () => {
        expect(daRaiz).toBe(definirEvento);
    });
    it('o package.json expõe o subpath', () => {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        expect(pkg.exports['./eventos']).toBe('./src/eventos.ts');
    });
});
