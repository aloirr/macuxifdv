/**
 * v1.0.6, achados do design-de-marca (docs/marca/pareceres/2026-11-13-v1.0.6.md):
 * - MC-0002: o chip de escolha ativo é Azul suave com texto Azul noite (como nas pranchas T-0171 e T-0173), não grafite;
 * - MC-0005: o roxo saiu da paleta (manual §3); o tom `roxo` do selo é o nome antigo do destaque.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { contraste, MINIMO_CONTRASTE } from '../comum/contraste';
import { colors, CORES_CHIP, TONS_ESTADO } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('MC-0002: chip de escolha nas cores da marca v1', () => {
  it('ativo: Azul suave com texto Azul noite (9,83:1)', () => {
    expect(CORES_CHIP.ativo).toEqual({ fundo: colors.accentSoft, borda: colors.accentSoft, texto: colors.accentInk });
    expect(contraste(CORES_CHIP.ativo.texto, CORES_CHIP.ativo.fundo)).toBeGreaterThanOrEqual(9.8);
  });

  it('inativo: texto com pelo menos 4,5:1 no fundo', () => {
    expect(contraste(CORES_CHIP.inativo.texto, CORES_CHIP.inativo.fundo)).toBeGreaterThanOrEqual(MINIMO_CONTRASTE.texto);
  });

  it('o Chip não traz cor solta: tudo vem de CORES_CHIP', () => {
    const ui = ler('./ui.tsx');
    const inicio = ui.indexOf('export function Chip(');
    const fim = ui.indexOf('export function Banner', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    expect(ui.slice(inicio, fim)).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(ui.slice(inicio, fim)).toContain('CORES_CHIP.ativo.texto');
  });

  it('chipOn não usa o grafite', () => {
    const ui = ler('./ui.tsx');
    const linha = ui.split('\n').find((l) => l.trim().startsWith('chipOn:'));
    expect(linha).toBeDefined();
    expect(linha).not.toContain('colors.ink');
    expect(linha).toContain('CORES_CHIP.ativo.fundo');
  });
});

describe('MC-0005: sem roxo no kit', () => {
  it('tokens.ts não tem violet', () => {
    expect(ler('./tokens.ts')).not.toMatch(/violet/i);
  });

  it('o tom roxo é o destaque', () => {
    expect(TONS_ESTADO.roxo).toEqual(TONS_ESTADO.destaque);
  });

  it('valores.tsx usa TONS_ESTADO, sem tabela de tons própria', () => {
    const src = ler('./valores.tsx');
    expect(src).not.toContain('TOM_SELO');
    expect(src).toContain('TONS_ESTADO[tom]');
  });
});
