import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { colors, NIVEIS_BOTAO, NIVEIS_BOTAO_ESCURO, TONS_ESTADO } from '../mobile/tokens';
import { CLASSE_TEXTO_PROIBIDA, CLASSES_DESTAQUE } from '../web/cores';
import { TONE_TEXT } from '../web/tones';
import { Button } from '../web/ui';
import {
  atingeContraste,
  contraste,
  DESTAQUE,
  FUNDOS,
  MINIMO_CONTRASTE,
  PARES_DO_DESTAQUE,
  PARES_PROIBIDOS_PARA_TEXTO,
  razaoTexto,
} from './contraste';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('contraste do destaque (T-0094): valores calculados', () => {
  it('identidade mantida: nenhum valor da paleta mudou', () => {
    expect(DESTAQUE).toEqual({
      accent: '#C2540A',
      accentInk: '#8F3D06',
      onAccent: '#FFFFFF',
      accentLight: '#F59A52',
      accentSoft: '#FBE9DC',
      accentTint: '#FDF4EC',
    });
    expect(FUNDOS).toEqual({ ground: '#F3F4F1', surface: '#FFFFFF', ink: '#16202A' });
  });

  it('mínimos do WCAG AA: 4,5 texto, 3 texto grande e gráfico', () => {
    expect(MINIMO_CONTRASTE).toEqual({ texto: 4.5, textoGrande: 3, grafico: 3 });
  });

  it('razões medidas (as da tabela do guia, §1.1)', () => {
    const casos: Array<[string, string, string]> = [
      [DESTAQUE.onAccent, DESTAQUE.accent, '4,60:1'],
      [DESTAQUE.accentInk, FUNDOS.ground, '6,70:1'],
      [DESTAQUE.accentInk, FUNDOS.surface, '7,40:1'],
      [DESTAQUE.accentInk, DESTAQUE.accentSoft, '6,27:1'],
      [DESTAQUE.accentInk, DESTAQUE.accentTint, '6,81:1'],
      [DESTAQUE.accent, FUNDOS.ground, '4,17:1'],
      [DESTAQUE.accent, FUNDOS.surface, '4,60:1'],
      [DESTAQUE.accent, DESTAQUE.accentSoft, '3,90:1'],
      [DESTAQUE.accent, DESTAQUE.accentTint, '4,23:1'],
      [DESTAQUE.accent, FUNDOS.ink, '3,58:1'],
      [DESTAQUE.accentLight, FUNDOS.ink, '7,56:1'],
    ];
    for (const [fg, bg, esperado] of casos) expect(razaoTexto(fg, bg), `${fg} × ${bg}`).toBe(esperado);
  });

  it('todo uso do destaque no kit atinge o mínimo do seu tipo', () => {
    for (const par of PARES_DO_DESTAQUE) {
      expect(contraste(par.fg, par.bg), par.uso).toBeGreaterThanOrEqual(MINIMO_CONTRASTE[par.tipo]);
      expect(atingeContraste(par), par.uso).toBe(true);
    }
  });

  it('o laranja puro como TEXTO sobre claro e sobre o grafite não passa: é por isso que existe o accentInk', () => {
    for (const par of PARES_PROIBIDOS_PARA_TEXTO) {
      expect(contraste(par.fg, par.bg), par.uso).toBeLessThan(MINIMO_CONTRASTE.texto);
      expect(atingeContraste(par), par.uso).toBe(false);
    }
  });
});

describe('kit mobile usa os tokens do destaque (T-0094)', () => {
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
  });

  it('botão principal: laranja cheio com texto onAccent (claro e sobre o grafite)', () => {
    expect(NIVEIS_BOTAO.principal.fundo).toBe(colors.accent);
    expect(NIVEIS_BOTAO.principal.texto).toBe(colors.onAccent);
    expect(NIVEIS_BOTAO_ESCURO.principal.texto).toBe(colors.onAccent);
    expect(contraste(NIVEIS_BOTAO.principal.texto, NIVEIS_BOTAO.principal.fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('chip e tom em destaque: texto accentInk sobre accentSoft', () => {
    expect(TONS_ESTADO.destaque).toEqual({ fg: colors.accentInk, bg: colors.accentSoft });
    expect(ler('../mobile/theme.ts')).toContain('accent: { fg: colors.accentInk, bg: colors.accentSoft }');
  });

  it('nenhum estilo de TEXTO do kit usa o accent puro (só ícone, borda, fundo e barra)', () => {
    const arquivos = ['../mobile/ui.tsx', '../mobile/base.tsx', '../mobile/formulario.tsx', '../mobile/folha.tsx', '../mobile/valores.tsx', '../mobile/filtro.tsx', '../mobile/suspensa.tsx', '../mobile/cartoes-pedido.tsx', '../mobile/navegacao.tsx', '../mobile/senha.tsx', '../mobile/cliente.tsx', '../mobile/sincronizacao.tsx', '../mobile/voltar.tsx'];
    for (const arq of arquivos) {
      const src = ler(arq);
      // estilo com fonte (é texto) e cor accent pura na mesma entrada
      expect(src, arq).not.toMatch(/fontFamily[^}\n]*color: colors\.accent(?![A-Za-z])/);
      expect(src, arq).not.toMatch(/color: colors\.accent(?![A-Za-z])[^}\n]*fontFamily/);
      // <Text> com cor accent pura no style
      expect(src, arq).not.toMatch(/<Text[^>]*color: colors\.accent(?![A-Za-z])/);
      // branco escrito à mão sobre o laranja
      expect(src, arq).not.toMatch(/bg: colors\.accent, fg: '#FFFFFF'/);
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

describe('kit web usa as classes do destaque (T-0094)', () => {
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
  });

  it('Button variant="link" renderiza em accent-ink, sublinhado no hover', () => {
    const el = Button({ variant: 'link', children: 'Esqueci a senha' }) as { props: { className: string } };
    expect(el.props.className).toContain('text-accent-ink');
    expect(el.props.className).toContain('hover:underline');
    expect(el.props.className).not.toMatch(CLASSE_TEXTO_PROIBIDA);
  });

  it('foco de todo botão continua accent (gráfico, ≥ 3:1 no fundo, no branco e no grafite)', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'link'] as const) {
      const el = Button({ variant }) as { props: { className: string } };
      expect(el.props.className, variant).toContain('focus-visible:outline-accent');
    }
    expect(CLASSES_DESTAQUE.foco).toContain('outline-accent');
  });

  it('número em destaque (TONE_TEXT.accent) é accent-ink; nenhum arquivo do kit web escreve text-accent puro', () => {
    expect(TONE_TEXT.accent).toBe('text-accent-ink');
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
  });
});
