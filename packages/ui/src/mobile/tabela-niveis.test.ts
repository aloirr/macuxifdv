import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ehSemDado, leituraDaLinhaDeValor, leituraDoNivel, textoDaContagem, VALOR_SEM_DADO } from './componentes';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('TabelaValores (T-0141, crédito do cliente em tabela): parte pura', () => {
  it('sem dado é travessão (nunca "R$ 0,00" falso) e vazio também conta', () => {
    expect(VALOR_SEM_DADO).toBe('—');
    expect(ehSemDado('—')).toBe(true);
    expect(ehSemDado('  ')).toBe(true);
    expect(ehSemDado(null)).toBe(true);
    expect(ehSemDado('R$ 0,00')).toBe(false);
  });

  it('o leitor de tela lê "rótulo: valor" e "sem dado" no travessão', () => {
    expect(leituraDaLinhaDeValor('Limite', 'R$ 20.000,00')).toBe('Limite: R$ 20.000,00');
    expect(leituraDaLinhaDeValor('Disponível', '—')).toBe('Disponível: sem dado');
  });

  it('desenho da spec: linha de 48 dp, valor em negrito 18 tabular, travessão em ink3', () => {
    const src = ler('./valores.tsx');
    expect(src).toMatch(/tabelaLinha: \{[^}]*minHeight: 48/);
    expect(src).toMatch(/tabelaValor: \{[^}]*\.\.\.fonte\.displayBold, fontSize: 18, fontVariant: \['tabular-nums'\]/);
    expect(src).toMatch(/semDado \? colors\.ink3/);
  });
});

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

  it('desenho da spec: linha de 56 dp, contagem em negrito tabular; nível pulado da trilha sem toque', () => {
    const src = ler('./navegacao.tsx');
    expect(src).toMatch(/nivel: \{[^}]*minHeight: 56/);
    expect(src).toMatch(/nivelContagem: \{[^}]*\.\.\.fonte\.displayBold/);
    expect(src).toMatch(/const desligado = atual \|\| pulado;/);
  });
});
