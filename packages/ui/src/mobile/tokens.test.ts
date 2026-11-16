import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  definirVibracao,
  deslocamentoDaFolha,
  duracaoMovimento,
  escalaDoToque,
  MOVIMENTO,
  opacidadeDoToque,
  tempoDoAviso,
  transicaoDeAvancar,
  transicaoDeFolha,
  vibrarLeve,
} from './movimento';
import {
  ALTURA,
  BOTAO_DESABILITADO,
  BOTAO_DESABILITADO_ESCURO,
  colors,
  contraste,
  estiloDoNivel,
  FUNDO_ESCURO,
  NIVEIS_BOTAO,
  NIVEIS_BOTAO_ESCURO,
  radius,
  TONS_ESTADO,
} from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('tokens (T-0072): identidade e contraste', () => {
  it('marca v1 (T-0172): ação Azul noite, grafite no texto, fundo Pérola, laranja só em gráfico, faixa Azul noite', () => {
    expect(colors.accent).toBe('#1E3350');
    expect(colors.accentInk).toBe('#1E3350');
    expect(colors.accentSoft).toBe('#DFE2E6');
    expect(colors.ink).toBe('#16202A');
    expect(colors.ground).toBe('#F8F6F1');
    expect(colors.grafico).toBe('#C2540A');
    expect(colors.graficoEscuro).toBe('#F59A52');
    expect([colors.faixa, colors.faixaTitulo, colors.faixaSub]).toEqual(['#1E3350', '#FFFFFF', '#C9CED5']);
  });

  it('contraste: calcula pela WCAG (preto × branco = 21)', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contraste('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => contraste('vermelho', '#FFFFFF')).toThrow();
  });

  it('todo par texto × fundo do guia passa de 4,5:1', () => {
    const pares: Array<[string, string, string]> = [
      ['texto no fundo', colors.ink, colors.ground],
      ['texto secundário no fundo', colors.ink2, colors.ground],
      ['texto secundário no cartão', colors.ink2, colors.surface],
      ['texto terciário no cartão', colors.ink3, colors.surface],
      ['aba ativa', colors.accentInk, colors.surface],
      ['aba inativa', colors.ink2, colors.surface],
      ['link laranja no cartão', colors.accentInk, colors.surface],
      ['trilha (link e atual) no fundo', colors.accentInk, colors.ground],
      ['equivalente do desconto no cartão', colors.success, colors.surface],
      ['aviso: texto no grafite', colors.surface, colors.ink],
      ['aviso: Desfazer no grafite', colors.accentLight, colors.ink],
      ['aviso: ícone de ok no grafite', colors.successOnDark, colors.ink],
      ['recado: assinatura no grafite', colors.darkMuted, colors.ink],
      ['alerta vermelho no grafite (dangerOnDark)', colors.dangerOnDark, colors.ink],
      ['alerta vermelho no trilho escuro (dangerOnDark)', colors.dangerOnDark, colors.darkTrack],
      ['contador branco no laranja (gráfico)', colors.surface, colors.grafico],
      ['botão principal: branco no Azul noite', colors.onAccent, colors.accent],
      ['título na faixa', colors.faixaTitulo, colors.faixa],
      ['subtítulo e voltar na faixa', colors.faixaSub, colors.faixa],
      ['recado: assinatura no trilho escuro', colors.darkMuted, colors.darkTrack],
      ['meta batida', colors.success, colors.successBg],
      ['cartão em destaque', colors.accentInk, colors.accentSoft],
    ];
    for (const [nome, fg, bg] of pares) expect(contraste(fg, bg), nome).toBeGreaterThanOrEqual(4.5);
  });

  it('botões: texto de todo nível (e do desabilitado) com 4,5:1', () => {
    for (const [nivel, v] of Object.entries(NIVEIS_BOTAO)) expect(contraste(v.texto, v.fundo), nivel).toBeGreaterThanOrEqual(4.5);
    expect(contraste(BOTAO_DESABILITADO.texto, BOTAO_DESABILITADO.fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('chips de estado: todo tom com 4,5:1', () => {
    for (const [tom, c] of Object.entries(TONS_ESTADO)) expect(contraste(c.fg, c.bg), tom).toBeGreaterThanOrEqual(4.5);
  });
});

describe('botões em níveis (T-0072)', () => {
  it('principal 52, secundário/neutro/perigo 44, todos ≥ alvo com folga', () => {
    expect(NIVEIS_BOTAO.principal.altura).toBe(52);
    expect(NIVEIS_BOTAO.principal.raio).toBe(radius.botao);
    expect(NIVEIS_BOTAO.principal.tamanhoFonte).toBe(16);
    for (const n of ['secundario', 'neutro', 'perigo'] as const) {
      expect(NIVEIS_BOTAO[n].altura, n).toBe(44);
      expect(NIVEIS_BOTAO[n].raio, n).toBe(radius.botaoMedio);
    }
    expect(ALTURA.toque).toBe(48);
  });

  it('principal é o único com o Azul noite cheio', () => {
    const cheios = Object.entries(NIVEIS_BOTAO).filter(([, v]) => v.fundo === colors.accent);
    expect(cheios.map(([n]) => n)).toEqual(['principal']);
  });

  it('sobre escuro: todo nível (e o desabilitado) com texto ≥ 4,5:1 sobre o próprio fundo ou sobre o grafite', () => {
    const fundoReal = (f: string) => (f === 'transparent' ? FUNDO_ESCURO : f);
    expect(FUNDO_ESCURO).toBe(colors.ink);
    for (const [nivel, v] of Object.entries(NIVEIS_BOTAO_ESCURO)) expect(contraste(v.texto, fundoReal(v.fundo)), nivel).toBeGreaterThanOrEqual(4.5);
    expect(contraste(BOTAO_DESABILITADO_ESCURO.texto, BOTAO_DESABILITADO_ESCURO.fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('sobre escuro: os níveis se separam do grafite e entre si (faixa "Em atendimento" do #94)', () => {
    const { principal, secundario, neutro, perigo } = NIVEIS_BOTAO_ESCURO;
    // o que tem fundo cheio se separa do grafite (≥ 3:1, componente de interface); o neutro, pelo contorno claro
    for (const v of [principal, perigo]) expect(contraste(v.fundo, FUNDO_ESCURO)).toBeGreaterThanOrEqual(3);
    expect(secundario.borda).not.toBeNull();
    expect(contraste(secundario.borda ?? '#000000', FUNDO_ESCURO)).toBeGreaterThanOrEqual(3);
    expect(contraste(secundario.borda ?? '#000000', colors.faixa)).toBeGreaterThanOrEqual(3);
    // T-0172: principal branco com texto Azul noite ("Tentar de novo"); secundário só contorno; neutro cinza-grafite cheio
    expect([principal.fundo, principal.texto]).toEqual([colors.surface, colors.accent]);
    expect(secundario.fundo).toBe('transparent');
    expect(secundario.texto).toBe(colors.surface);
    expect([neutro.fundo, neutro.borda]).toEqual(['transparent', null]);
    expect(neutro.texto).toBe(colors.surface);
    // o Azul noite nunca é fundo sobre o grafite (1,29:1, manual §3)
    expect(Object.values(NIVEIS_BOTAO_ESCURO).filter((v) => v.fundo === colors.accent)).toHaveLength(0);
  });

  it('sobre escuro: mesmas alturas, raios e fontes; sem a opção, nada muda', () => {
    for (const n of ['principal', 'secundario', 'neutro', 'perigo'] as const) {
      const claro = estiloDoNivel(n, { alto: true });
      const escuro = estiloDoNivel(n, { alto: true, sobreEscuro: true });
      expect([escuro.altura, escuro.raio, escuro.tamanhoFonte], n).toEqual([claro.altura, claro.raio, claro.tamanhoFonte]);
      expect(estiloDoNivel(n), n).toEqual(estiloDoNivel(n, { sobreEscuro: false }));
      expect(estiloDoNivel(n), n).toEqual({ ...NIVEIS_BOTAO[n], ...(n === 'principal' ? {} : { altura: 44 }) });
    }
    const off = estiloDoNivel('secundario', { sobreEscuro: true, desabilitado: true });
    expect([off.fundo, off.texto, off.larguraBorda]).toEqual([BOTAO_DESABILITADO_ESCURO.fundo, BOTAO_DESABILITADO_ESCURO.texto, 0]);
    expect(ler('./base.tsx')).toContain('estiloDoNivel(nivel, { alto, desabilitado: Boolean(desligado), sobreEscuro })');
  });

  it('secundário alto = 52 (ao lado do principal); desabilitado cinza sem borda', () => {
    expect(estiloDoNivel('secundario', { alto: true }).altura).toBe(52);
    expect(estiloDoNivel('secundario').altura).toBe(44);
    const off = estiloDoNivel('principal', { desabilitado: true });
    expect(off.altura).toBe(52);
    expect(off.fundo).toBe(BOTAO_DESABILITADO.fundo);
    expect(off.texto).toBe(BOTAO_DESABILITADO.texto);
    expect(off.larguraBorda).toBe(0);
  });
});

describe('movimento (T-0072): durações do guia e "reduzir movimento"', () => {
  it('avançar 240 ms, folha 280 ms, toque 120 ms com escala 0,97, aviso 2,5 s', () => {
    expect(MOVIMENTO.avancar.duracaoMs).toBe(240);
    expect(MOVIMENTO.folha.duracaoMs).toBe(280);
    expect(MOVIMENTO.barra.duracaoMs).toBe(240);
    expect(MOVIMENTO.toque.duracaoMs).toBe(120);
    expect(MOVIMENTO.toque.escala).toBe(0.97);
    expect(MOVIMENTO.aviso.visivelMs).toBe(2500);
  });

  it('com "reduzir movimento" toda duração vira 0', () => {
    for (const tipo of Object.keys(MOVIMENTO) as Array<keyof typeof MOVIMENTO>) {
      expect(duracaoMovimento(tipo, true), tipo).toBe(0);
      expect(duracaoMovimento(tipo, false), tipo).toBe(MOVIMENTO[tipo].duracaoMs);
    }
  });

  it('toque: escala só sem "reduzir movimento"; com ele, só a opacidade', () => {
    expect(escalaDoToque(true, false)).toBe(0.97);
    expect(escalaDoToque(false, false)).toBe(1);
    expect(escalaDoToque(true, true)).toBe(1);
    expect(opacidadeDoToque(true, false)).toBe(1);
    expect(opacidadeDoToque(true, true)).toBeLessThan(1);
    expect(opacidadeDoToque(false, true)).toBe(1);
  });

  it('folha sobe da própria altura; com "reduzir movimento", não se desloca', () => {
    expect(deslocamentoDaFolha(420, false)).toBe(420);
    expect(deslocamentoDaFolha(420, true)).toBe(0);
    expect(deslocamentoDaFolha(-5, false)).toBe(0);
  });

  it('transições da pilha para o shell: lateral 240 / de baixo 280; nenhuma com "reduzir movimento"', () => {
    expect(transicaoDeAvancar(false)).toEqual({ animation: 'slide_from_right', animationDuration: 240 });
    expect(transicaoDeFolha(false)).toEqual({ animation: 'slide_from_bottom', animationDuration: 280 });
    expect(transicaoDeAvancar(true)).toEqual({ animation: 'none', animationDuration: 0 });
    expect(transicaoDeFolha(true)).toEqual({ animation: 'none', animationDuration: 0 });
  });

  it('aviso fica 2,5 s; com leitor de tela, 8 s (tempo de achar o Desfazer)', () => {
    expect(tempoDoAviso(false)).toBe(2500);
    expect(tempoDoAviso(true)).toBe(8000);
    expect(tempoDoAviso(false, 4000)).toBe(4000);
    expect(tempoDoAviso(true, 10000)).toBe(10000);
  });
});

describe('vibração leve (registrada pelo shell)', () => {
  afterEach(() => definirVibracao(null));

  it('sem registro não faz nada; com registro chama uma vez', () => {
    expect(() => vibrarLeve()).not.toThrow();
    const fn = vi.fn();
    definirVibracao(fn);
    vibrarLeve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falha do aparelho não derruba a tela (erro síncrono ou promessa rejeitada)', async () => {
    definirVibracao(() => {
      throw new Error('sem motor');
    });
    expect(() => vibrarLeve()).not.toThrow();
    definirVibracao(() => Promise.reject(new Error('sem permissão')));
    expect(() => vibrarLeve()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('movimento (T-0072): conferência estática das primitivas', () => {
  it('lê "reduzir movimento" do aparelho e acompanha a mudança ao vivo', () => {
    const src = ler('./movimento-rn.tsx');
    expect(src).toContain('AccessibilityInfo.isReduceMotionEnabled()');
    expect(src).toContain("'reduceMotionChanged'");
    expect(src).toContain('sub.remove()');
  });

  it('folha, diálogo, aviso e toque usam a duração do token e o "reduzir movimento"', () => {
    for (const arq of ['./folha.tsx', './base.tsx', './movimento-rn.tsx']) {
      const src = ler(arq);
      expect(src, arq).toContain('useReduzirMovimento');
      expect(src, arq).toContain('duracaoMovimento(');
      // nenhuma duração escrita à mão: só pelo token
      expect(src, arq).not.toMatch(/duration:\s*\d/);
      // nada de animação nativa do Modal (não respeita o token nem o "reduzir movimento")
      expect(src, arq).not.toMatch(/animationType="(fade|slide)"/);
    }
  });

  it('o chip de estado nunca aparece sem texto', () => {
    const src = ler('./base.tsx');
    expect(src).toMatch(/export function ChipEstado[\s\S]*if \(texto\.trim\(\) === ''\) return null;/);
  });
});
