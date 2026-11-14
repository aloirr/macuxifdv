/** RD-0039: BotaoFolha e LinhaOpcaoFolha (folhas de ação do pedido). Parte pura e o desenho. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { alturaDoBotaoFolha, BOTAO_FOLHA, fonteDoBotaoFolha, LINHA_OPCAO_FOLHA } from './botao-folha';
import { colors, contraste, radius } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('RD-0039: BotaoFolha', () => {
  it('tokens vêm do tema (sem hex solto)', () => {
    expect(BOTAO_FOLHA.raio).toBe(radius.lg);
    expect(BOTAO_FOLHA.opacidadeAoTocar).toBe(0.8);
    expect(BOTAO_FOLHA.tons.perigo).toEqual({ fundo: colors.danger, texto: colors.onAccent, borda: null, larguraBorda: 0 });
    expect(BOTAO_FOLHA.tons.contorno).toEqual({ fundo: colors.surface, texto: colors.ink, borda: colors.lineStrong, larguraBorda: 1 });
  });

  it('altura padrão 50 no perigo e 46 no contorno; explícita vence', () => {
    expect(alturaDoBotaoFolha('perigo')).toBe(50);
    expect(alturaDoBotaoFolha('contorno')).toBe(46);
    expect(alturaDoBotaoFolha('contorno', 52)).toBe(52);
  });

  it('fonte 15 a partir de 50 dp, 14 abaixo', () => {
    expect(fonteDoBotaoFolha(50)).toBe(15);
    expect(fonteDoBotaoFolha(52)).toBe(15);
    expect(fonteDoBotaoFolha(46)).toBe(14);
  });

  it('contraste ≥ 4,5:1 nos dois tons', () => {
    expect(contraste(BOTAO_FOLHA.tons.perigo.texto, BOTAO_FOLHA.tons.perigo.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(BOTAO_FOLHA.tons.contorno.texto, BOTAO_FOLHA.tons.contorno.fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('toque por opacidade (Pressable, sem escala do Pressionavel)', () => {
    const fonte = ler('./botao-folha-rn.tsx');
    expect(fonte).toContain('<Pressable');
    expect(fonte).not.toContain('Pressionavel');
    expect(fonte).not.toMatch(/scale/);
    expect(fonte).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
});

describe('RD-0039: LinhaOpcaoFolha', () => {
  it('medidas e cores do PdfOption', () => {
    expect(LINHA_OPCAO_FOLHA.alturaMinima).toBe(64);
    expect(LINHA_OPCAO_FOLHA.raio).toBe(radius.lg);
    expect(LINHA_OPCAO_FOLHA.borda).toBe(colors.lineStrong);
    expect(LINHA_OPCAO_FOLHA.fundo).toBe(colors.surface);
    expect(LINHA_OPCAO_FOLHA.fundoAoTocar).toBe(colors.ground);
    expect(LINHA_OPCAO_FOLHA.opacidadeDesligada).toBe(0.6);
    expect(LINHA_OPCAO_FOLHA.icone).toEqual({ lado: 38, tamanho: 18, fundo: colors.accentSoft, cor: colors.accentInk });
    expect(LINHA_OPCAO_FOLHA.seta).toEqual({ tamanho: 16, cor: colors.ink3 });
    expect(LINHA_OPCAO_FOLHA.tamanhoTitulo).toBe(15);
  });

  it('ícone accentInk legível sobre accentSoft; seta chevron', () => {
    expect(contraste(LINHA_OPCAO_FOLHA.icone.cor, LINHA_OPCAO_FOLHA.icone.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(ler('./botao-folha-rn.tsx')).toContain('name="chevron"');
  });
});
