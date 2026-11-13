import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { contraste } from '../comum/contraste';
import { colors } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('Catálogo em grade (T-0173, docs/design/catalogo-grade.md)', () => {
  it('SeloAtualizacao sobreFaixa: sem fundo, borda faixaTrilho e texto faixaSub legível na faixa', () => {
    const src = ler('./sincronizacao.tsx');
    expect(src).toContain('sobreFaixa = false');
    expect(src).toContain("seloFaixa: { borderColor: colors.faixaTrilho, backgroundColor: 'transparent' }");
    expect(src).toContain('sobreFaixa ? colors.faixaSub : colors.ink2');
    expect(contraste(colors.faixaSub, colors.faixa)).toBeGreaterThanOrEqual(4.5);
  });

  it('MostrarMais contagem={false}: só o botão, a contagem fica no cabeçalho', () => {
    const src = ler('./busca-rn.tsx');
    expect(src).toContain('contagem: comContagem = true');
    expect(src).toMatch(/\{comContagem \? \(/);
  });
});
