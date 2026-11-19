import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { leituraDoNivel, textoDaContagem } from './componentes';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('ListaNiveis e Trilha (T-0142, catálogo pela hierarquia): parte pura', () => {
  it('contagem com ponto no milhar; inválida vira 0', () => {
    expect(textoDaContagem(16)).toBe('16');
    expect(textoDaContagem(1240)).toBe('1.240');
    expect(textoDaContagem(1234567)).toBe('1.234.567');
    expect(textoDaContagem(-3)).toBe('0');
    expect(textoDaContagem(Number.NaN)).toBe('0');
  });

  it('leitura da linha no TalkBack: singular e plural', () => {
    expect(leituraDoNivel('Alimentos', 16)).toBe('Alimentos, 16 produtos');
    expect(leituraDoNivel('Freios', 1)).toBe('Freios, 1 produto');
    expect(leituraDoNivel(' Bebidas ', 1240)).toBe('Bebidas, 1.240 produtos');
  });

  it('desenho da spec: linha de 56 dp, contagem em 600 tabular; nível pulado da trilha sem toque', () => {
    const src = ler('./navegacao.tsx');
    expect(src).toMatch(/nivel: \{[^}]*minHeight: 56/);
    expect(src).toMatch(/nivelContagem: \{[^}]*\.\.\.fonte\.semibold/);
    expect(src).toMatch(/const desligado = atual \|\| pulado;/);
  });
});
