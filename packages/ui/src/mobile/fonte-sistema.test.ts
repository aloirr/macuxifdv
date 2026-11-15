import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ESCALA_FONTE, familiasFonte, PILHA_MONO, PILHA_SISTEMA, TAMANHOS_FONTE } from './tokens';

/** Fonte do sistema e escala (R-20261115-110600, v1.0.13): nenhuma fonte carregada; nada abaixo de 12. */
const pasta = (rel: string) => new URL(rel, import.meta.url);
const fontes = (rel: string) =>
  readdirSync(pasta(rel))
    .filter((a) => /\.tsx?$/.test(a) && !a.endsWith('.test.ts') && !a.endsWith('.test.tsx'))
    .map((a) => ({ arq: `${rel}${a}`, src: readFileSync(new URL(a, pasta(rel)), 'utf8') }));

const app = fontes('./');
const web = fontes('../web/');

describe('fonte do sistema (R-20261115-110600)', () => {
  it('escala do app: 12 · 14 · 16 (base) · 18 · 22 · 28', () => {
    expect(TAMANHOS_FONTE).toEqual([12, 14, 16, 18, 22, 28]);
    expect(ESCALA_FONTE.base).toBe(16);
  });

  it('nenhum arquivo de packages/ui usa família de fonte carregada (nome com peso, ex.: `X_700Bold`)', () => {
    for (const { arq, src } of [...app, ...web]) {
      expect(src, arq).not.toMatch(/'[A-Za-z]+_\d{3}[A-Za-z]*'/);
    }
  });

  it('app: componentes do kit usam o peso (`...fonte.x`), não `fontFamily: fonts.x`', () => {
    for (const { arq, src } of app) {
      if (arq.endsWith('theme.ts')) continue;
      expect(src, arq).not.toMatch(/fontFamily: fonts\./);
    }
  });

  it('app: todo fontSize literal está na escala (nada abaixo de 12)', () => {
    for (const { arq, src } of app) {
      for (const m of src.matchAll(/fontSize: (?:\w+ \? )?(\d+(?:\.\d+)?)(?: : (\d+(?:\.\d+)?))?/g)) {
        for (const v of [m[1], m[2]].filter(Boolean)) expect(TAMANHOS_FONTE, `${arq}: ${m[0]}`).toContain(Number(v));
      }
    }
  });

  it('web: nenhum texto abaixo de 12 px e só a escala 12 · 13 · 15 · 17 · 20 · 24', () => {
    for (const { arq, src } of web) {
      for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) expect([12, 13, 15, 17, 20, 24], `${arq}: ${m[0]}`).toContain(Number(m[1]));
      expect(src, arq).not.toMatch(/font-extrabold|font-black/);
    }
  });

  it('fonts (transição): Android com os nomes do sistema; web e demais na pilha sem serifa', () => {
    const android = familiasFonte('android');
    expect(android.body).toBe('sans-serif');
    expect(android.semibold).toBe('sans-serif-medium');
    expect(android.display).toBe('sans-serif-medium');
    for (const [nome, familia] of Object.entries(android)) expect(familia, `android.${nome}`).not.toMatch(/black/);
    expect(android.mono).toBe('monospace');
    expect(PILHA_SISTEMA).toBe('system-ui, "Segoe UI", Roboto, -apple-system, sans-serif');
    expect(PILHA_MONO).toBe('ui-monospace, "Cascadia Mono", "Roboto Mono", monospace');
    for (const os of ['web', 'ios', 'default']) {
      const f = familiasFonte(os);
      for (const [nome, familia] of Object.entries(f)) {
        expect(familia, `${os}.${nome}`).toBe(nome === 'mono' ? PILHA_MONO : PILHA_SISTEMA);
        expect(familia, `${os}.${nome}`).not.toMatch(/sans-serif-(medium|black)/);
      }
    }
  });

  it('theme.ts escolhe `fonts` e o mono de `fonte` por Platform (não fixa nomes do Android)', () => {
    const tema = readFileSync(pasta('./theme.ts'), 'utf8');
    expect(tema).toMatch(/export const fonts = Platform\.select\(\{ android: familiasFonte\('android'\), web: familiasFonte\('web'\)/);
    expect(tema).toMatch(/fontFamily: familiasFonte\(Platform\.OS\)\.mono/);
    expect(tema).not.toMatch(/'sans-serif-(medium|black)'/);
    expect(tema).toMatch(/@deprecated Use `\.\.\.fonte\.x`/);
  });

  it('a Roboto Black não aparece no kit (nem `sans-serif-black`, nem peso 800/900)', () => {
    for (const { arq, src } of app) expect(src, arq).not.toMatch(/sans-serif-black|fontWeight: '(800|900)'/);
  });
});
