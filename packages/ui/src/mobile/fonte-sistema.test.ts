import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ESCALA_FONTE, TAMANHOS_FONTE } from './tokens';

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

  it('app: `fonte` só dá o peso (400 · 500 · 600 · 700); o mono é `monospace`, sem pilha nem família por nome', () => {
    const tema = readFileSync(pasta('./theme.ts'), 'utf8');
    expect(tema).toMatch(/mono: \{ fontFamily: 'monospace', fontWeight: '400', fontVariant: \['tabular-nums'\] \}/);
    expect(tema).not.toMatch(/export const fonts\b|familiasFonte|displaySemi|sans-serif|title16|smallStrong|display(Bold)?:/);
    for (const { arq, src } of [...app, ...web]) expect(src, arq).not.toMatch(/PILHA_SISTEMA|PILHA_MONO|FAMILIAS_ANDROID/);
  });

  it('rótulo de campo único: `CampoSenha` usa o `RotuloCampo` e a entrada do `CampoTexto` (RD-0951)', () => {
    const senha = readFileSync(pasta('./campo-senha-rn.tsx'), 'utf8');
    expect(senha).toContain('<RotuloCampo>{rotulo}</RotuloCampo>');
    expect(senha).toContain('ESTILO_CAMPO.entrada');
    expect(senha).not.toMatch(/rotulo: \{/);
  });

  it('nada em 800/900 no kit (nem `sans-serif-black`); web sem `font-display`, só a `--font-sans`', () => {
    for (const { arq, src } of app) expect(src, arq).not.toMatch(/sans-serif-black|fontWeight: '(800|900)'/);
    for (const { arq, src } of web) expect(src, arq).not.toMatch(/font-display|fontWeight: ?'?(800|900)/);
  });
});
