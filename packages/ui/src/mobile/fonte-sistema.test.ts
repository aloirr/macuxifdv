import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ESCALA_FONTE, TAMANHOS_FONTE } from './tokens';

/** Fonte do sistema e escala (R-20261115-110600, v1.0.13): saem Archivo e IBM Plex; nada abaixo de 12. */
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

  it('nenhum arquivo de packages/ui cita Archivo nem IBM Plex como família', () => {
    for (const { arq, src } of [...app, ...web]) {
      expect(src, arq).not.toMatch(/'(Archivo|IBMPlex)[A-Za-z]*_\d{3}/);
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
});
