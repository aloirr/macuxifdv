import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { colors, NIVEIS_BOTAO, NIVEIS_BOTAO_ESCURO, TONS_ESTADO } from '../mobile/tokens';
import { CLASSE_TEXTO_PROIBIDA, CLASSES_DESTAQUE } from '../web/cores';
import { TONE_BG, TONE_TEXT } from '../web/tones';
import { Button } from '../web/ui';
import {
  atingeContraste,
  contraste,
  DESTAQUE,
  FAIXA,
  FUNDOS,
  GRAFICO,
  MARCA,
  MINIMO_CONTRASTE,
  PAR_PROIBIDO_AZUL_NO_GRAFITE,
  PARES_DA_MARCA,
  PARES_DO_DESTAQUE,
  PARES_PROIBIDOS_PARA_TEXTO,
  razaoTexto,
} from './contraste';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('marca v1 (T-0172): paleta e contraste do manual §3', () => {
  it('paleta da marca com os valores do manual', () => {
    expect(MARCA).toEqual({
      azulNoite: '#1E3350',
      perola: '#F8F6F1',
      branco: '#FFFFFF',
      sol: '#C2540A',
      solClaro: '#F59A52',
      grafite: '#16202A',
      textoSecundario: '#4A5562',
      textoApoio: '#5B6673',
      azulSuave: '#DFE2E6',
      claroNaFaixa: '#C9CED5',
      azulClaro: '#9AA3B0',
    });
  });

  it('papéis: ação Azul noite, chip no Azul suave, laranja só em gráfico, fundo Pérola, faixa Azul noite', () => {
    expect(DESTAQUE).toEqual({
      accent: '#1E3350',
      accentInk: '#1E3350',
      onAccent: '#FFFFFF',
      accentLight: '#F59A52',
      accentSoft: '#DFE2E6',
      accentTint: '#DFE2E6',
    });
    expect(GRAFICO).toEqual({ cor: '#C2540A', sobreEscuro: '#F59A52' });
    expect(FUNDOS).toEqual({ ground: '#F8F6F1', surface: '#FFFFFF', ink: '#16202A', faixa: '#1E3350' });
    expect(FAIXA).toEqual({ fundo: '#1E3350', titulo: '#FFFFFF', subtitulo: '#C9CED5', trilho: '#3A4D68', feito: '#7FD1A8', erro: '#F7A59C' });
  });

  it('mínimos do WCAG AA: 4,5 texto, 3 texto grande e gráfico', () => {
    expect(MINIMO_CONTRASTE).toEqual({ texto: 4.5, textoGrande: 3, grafico: 3 });
  });

  it('os 10 pares do manual §3 dão a razão publicada e atingem o mínimo do tipo', () => {
    expect(PARES_DA_MARCA).toHaveLength(10);
    for (const par of PARES_DA_MARCA) {
      expect(razaoTexto(par.fg, par.bg), par.uso).toBe(par.razao);
      expect(atingeContraste(par), par.uso).toBe(true);
    }
  });

  it('pares da tela de entrada (proposta entrada-sync §2)', () => {
    const casos: Array<[string, string, string]> = [
      [FAIXA.titulo, FAIXA.fundo, '12,77:1'],
      [FAIXA.subtitulo, FAIXA.fundo, '8,07:1'],
      [GRAFICO.sobreEscuro, FAIXA.fundo, '5,85:1'],
      [FAIXA.feito, FAIXA.fundo, '7,05:1'],
      [FAIXA.erro, FAIXA.fundo, '6,58:1'],
    ];
    for (const [fg, bg, esperado] of casos) expect(razaoTexto(fg, bg), fg + ' × ' + bg).toBe(esperado);
  });

  it('todo uso do destaque, do gráfico e da faixa no kit atinge o mínimo do seu tipo', () => {
    for (const par of PARES_DO_DESTAQUE) {
      expect(contraste(par.fg, par.bg), par.uso).toBeGreaterThanOrEqual(MINIMO_CONTRASTE[par.tipo]);
      expect(atingeContraste(par), par.uso).toBe(true);
    }
  });

  it('proibidos do manual §3: laranja como texto sobre claro e sobre o grafite; Azul noite no grafite', () => {
    for (const par of PARES_PROIBIDOS_PARA_TEXTO) {
      expect(contraste(par.fg, par.bg), par.uso).toBeLessThan(MINIMO_CONTRASTE.texto);
      expect(atingeContraste(par), par.uso).toBe(false);
    }
    expect(razaoTexto(PAR_PROIBIDO_AZUL_NO_GRAFITE.fg, PAR_PROIBIDO_AZUL_NO_GRAFITE.bg)).toBe('1,29:1');
    expect(atingeContraste(PAR_PROIBIDO_AZUL_NO_GRAFITE)).toBe(false);
  });
});

describe('kit mobile usa os tokens da marca (T-0094, T-0172)', () => {
  it('colors do app são os da paleta comum', () => {
    expect(colors.accent).toBe(DESTAQUE.accent);
    expect(colors.accentInk).toBe(DESTAQUE.accentInk);
    expect(colors.onAccent).toBe(DESTAQUE.onAccent);
    expect(colors.accentLight).toBe(DESTAQUE.accentLight);
    expect(colors.accentSoft).toBe(DESTAQUE.accentSoft);
    expect(colors.accentTint).toBe(DESTAQUE.accentTint);
    expect(colors.ground).toBe(FUNDOS.ground);
    expect(colors.surface).toBe(FUNDOS.surface);
    expect(colors.ink).toBe(FUNDOS.ink);
    expect(colors.grafico).toBe(GRAFICO.cor);
    expect(colors.graficoEscuro).toBe(GRAFICO.sobreEscuro);
    expect([colors.faixa, colors.faixaTitulo, colors.faixaSub, colors.faixaTrilho, colors.faixaFeito, colors.faixaErro]).toEqual([
      FAIXA.fundo,
      FAIXA.titulo,
      FAIXA.subtitulo,
      FAIXA.trilho,
      FAIXA.feito,
      FAIXA.erro,
    ]);
  });

  it('botão principal: Azul noite com texto branco; sobre o escuro, branco com texto Azul noite', () => {
    expect(NIVEIS_BOTAO.principal.fundo).toBe(colors.accent);
    expect(NIVEIS_BOTAO.principal.texto).toBe(colors.onAccent);
    expect([NIVEIS_BOTAO_ESCURO.principal.fundo, NIVEIS_BOTAO_ESCURO.principal.texto]).toEqual([colors.surface, colors.accent]);
    expect(contraste(NIVEIS_BOTAO.principal.texto, NIVEIS_BOTAO.principal.fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('gráficos do kit no laranja: barra (ProgressBar), contador da BarraAbas e selo do filtro', () => {
    expect(ler('../mobile/ui.tsx')).toContain('export function ProgressBar({ pct, color = colors.grafico,');
    expect(ler('../mobile/base.tsx')).toContain('{ bg: colors.grafico, fg: colors.onAccent }');
    expect(ler('../mobile/filtro.tsx')).toMatch(/selo: {[^}]*backgroundColor: colors.grafico/);
  });

  it('chip e tom em destaque: texto accentInk sobre accentSoft', () => {
    expect(TONS_ESTADO.destaque).toEqual({ fg: colors.accentInk, bg: colors.accentSoft });
    expect(ler('../mobile/theme.ts')).toContain('accent: { fg: colors.accentInk, bg: colors.accentSoft }');
  });

  it('nenhum estilo de TEXTO do kit usa o laranja de gráfico, nem laranja escrito à mão', () => {
    const arquivos = ['../mobile/ui.tsx', '../mobile/base.tsx', '../mobile/formulario.tsx', '../mobile/folha.tsx', '../mobile/valores.tsx', '../mobile/filtro.tsx', '../mobile/suspensa.tsx', '../mobile/cartoes-pedido.tsx', '../mobile/navegacao.tsx', '../mobile/senha.tsx', '../mobile/cliente.tsx', '../mobile/sincronizacao.tsx', '../mobile/voltar.tsx'];
    for (const arq of arquivos) {
      const src = ler(arq);
      // estilo com fonte (é texto) e cor de gráfico na mesma entrada
      expect(src, arq).not.toMatch(/fontFamily[^}\n]*color: colors\.grafico/);
      expect(src, arq).not.toMatch(/color: colors\.grafico[^}\n]*fontFamily/);
      expect(src, arq).not.toMatch(/<Text[^>]*color: colors\.grafico/);
      // branco escrito à mão sobre a cor cheia
      expect(src, arq).not.toMatch(/bg: colors\.(accent|grafico), fg: '#FFFFFF'/);
      // laranja escrito à mão
      expect(src, arq).not.toMatch(/#C2540A/i);
    }
  });

  it('links do kit (rótulo de ação, link da seção, LinkTexto) em accentInk', () => {
    expect(ler('../mobile/formulario.tsx')).toMatch(/rotuloAcaoTexto: \{[^}]*color: colors\.accentInk/);
    const ui = ler('../mobile/ui.tsx');
    expect(ui).toMatch(/sectionLink: \{[^}]*color: colors\.accentInk/);
    expect(ui).toMatch(/export function LinkTexto\(/);
    expect(ui).toContain('sobreEscuro ? colors.accentLight : colors.accentInk');
    expect(ui).toMatch(/linkTexto: \{ minHeight: TOUCH/);
    expect(ler('../mobile/base.tsx')).toMatch(/abaTextoAtiva: \{[^}]*color: colors\.accentInk/);
  });
});

describe('kit web usa as classes da marca (T-0094, T-0172)', () => {
  it('globals.css do shell tem os mesmos valores da paleta comum', () => {
    const css = ler('../../../../apps/web/app/globals.css').toLowerCase();
    const valor = (nome: string) => new RegExp(`--color-${nome}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];
    expect(valor('accent')).toBe(DESTAQUE.accent.toLowerCase());
    expect(valor('accent-ink')).toBe(DESTAQUE.accentInk.toLowerCase());
    expect(valor('accent-light')).toBe(DESTAQUE.accentLight.toLowerCase());
    expect(valor('accent-soft')).toBe(DESTAQUE.accentSoft.toLowerCase());
    expect(valor('ground')).toBe(FUNDOS.ground.toLowerCase());
    expect(valor('surface')).toBe(FUNDOS.surface.toLowerCase());
    expect(valor('ink')).toBe(FUNDOS.ink.toLowerCase());
    expect(valor('grafico')).toBe(GRAFICO.cor.toLowerCase());
    expect(valor('grafico-escuro')).toBe(GRAFICO.sobreEscuro.toLowerCase());
    expect(valor('faixa')).toBe(FAIXA.fundo.toLowerCase());
    expect(valor('faixa-texto')).toBe(FAIXA.subtitulo.toLowerCase());
  });

  it('botão principal do BKO em Azul noite (bg-accent text-white); barras em bg-grafico; faixa em bg-faixa', () => {
    const el = Button({ variant: 'primary' }) as { props: { className: string } };
    expect(el.props.className).toContain('bg-accent text-white');
    expect(CLASSES_DESTAQUE.barra).toBe('bg-grafico');
    expect(CLASSES_DESTAQUE.faixa).toBe('bg-faixa text-white');
  });

  it('Button variant="link" renderiza em accent-ink, sublinhado no hover', () => {
    const el = Button({ variant: 'link', children: 'Esqueci a senha' }) as { props: { className: string } };
    expect(el.props.className).toContain('text-accent-ink');
    expect(el.props.className).toContain('hover:underline');
    expect(el.props.className).not.toMatch(CLASSE_TEXTO_PROIBIDA);
  });

  it('foco de todo botão em accent (Azul noite, ≥ 3:1 no Pérola e no branco; no menu grafite o shell usa outro foco)', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'link'] as const) {
      const el = Button({ variant }) as { props: { className: string } };
      expect(el.props.className, variant).toContain('focus-visible:outline-accent');
    }
    expect(CLASSES_DESTAQUE.foco).toContain('outline-accent');
  });

  it('farol do meio (TONE_TEXT.accent) em âmbar de aviso e barra laranja; nenhum arquivo do kit web escreve text-accent puro', () => {
    expect(TONE_TEXT.accent).toBe('text-warning');
    expect(TONE_BG.accent).toBe('bg-grafico');
    for (const arq of ['../web/ui.tsx', '../web/tones.ts', '../web/permissoes.tsx', '../web/senha.tsx', '../web/overlay.tsx', '../web/cliente.tsx', '../web/icons.tsx']) {
      expect(ler(arq), arq).not.toMatch(CLASSE_TEXTO_PROIBIDA);
    }
  });

  it('a regex da classe proibida pega text-accent e deixa passar os tokens corretos', () => {
    expect('x text-accent y').toMatch(CLASSE_TEXTO_PROIBIDA);
    expect("'text-accent'").toMatch(CLASSE_TEXTO_PROIBIDA);
    expect('hover:text-accent').toMatch(CLASSE_TEXTO_PROIBIDA);
    expect('text-accent-ink').not.toMatch(CLASSE_TEXTO_PROIBIDA);
    expect('text-accent-light').not.toMatch(CLASSE_TEXTO_PROIBIDA);
    expect('bg-accent text-white').not.toMatch(CLASSE_TEXTO_PROIBIDA);
    expect('text-grafico').toMatch(CLASSE_TEXTO_PROIBIDA);
    expect('bg-grafico').not.toMatch(CLASSE_TEXTO_PROIBIDA);
  });
});
