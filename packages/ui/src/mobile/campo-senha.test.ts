import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MOSTRAR_SENHA, OCULTAR_SENHA, rotuloDoOlhoDaSenha } from '../comum/senha';
import { CAMPO_SENHA, iconeDoOlhoDaSenha, propsDeTecladoDaSenha } from './campo-senha';
import { ALVO_TOQUE } from './componentes';

// campo-senha-rn.tsx importa react-native (não roda no node): a conferência do componente é sobre o texto do arquivo.
const fonteRn = readFileSync(new URL('./campo-senha-rn.tsx', import.meta.url), 'utf8');
const fonteIcone = readFileSync(new URL('./icon.tsx', import.meta.url), 'utf8');

describe('CampoSenha (mobile; R-20261115-071000, docs/design/campo-senha/spec.md)', () => {
  it('alternar troca o ícone e o rótulo do TalkBack: olho + "Mostrar senha" oculta; riscado + "Ocultar senha" visível', () => {
    expect(iconeDoOlhoDaSenha(false)).toBe('olho');
    expect(iconeDoOlhoDaSenha(true)).toBe('olhoRiscado');
    expect(rotuloDoOlhoDaSenha(false)).toBe(MOSTRAR_SENHA);
    expect(rotuloDoOlhoDaSenha(true)).toBe(OCULTAR_SENHA);
    expect([MOSTRAR_SENHA, OCULTAR_SENHA]).toEqual(['Mostrar senha', 'Ocultar senha']);
  });

  it('teclado de senha no login: oculta, sem autocorreção, sem maiúscula, sem corretor, password', () => {
    expect(propsDeTecladoDaSenha(false)).toEqual({
      secureTextEntry: true,
      autoCorrect: false,
      autoCapitalize: 'none',
      spellCheck: false,
      autoComplete: 'password',
      textContentType: 'password',
      keyboardType: 'default',
    });
  });

  it('criação usa new-password / newPassword', () => {
    const p = propsDeTecladoDaSenha(false, 'criacao');
    expect(p.autoComplete).toBe('new-password');
    expect(p.textContentType).toBe('newPassword');
  });

  it('R-20261120-052719: visível ou oculta, login ou criação, nunca visible-password (teclado de texto, sem espaço após o "!")', () => {
    for (const visivel of [false, true]) {
      for (const finalidade of ['login', 'criacao'] as const) {
        const p = propsDeTecladoDaSenha(visivel, finalidade);
        expect(p.keyboardType).toBe('default');
        expect(p.autoCorrect).toBe(false);
        expect(p.spellCheck).toBe(false);
        expect(p.autoCapitalize).toBe('none');
        expect(p.secureTextEntry).toBe(!visivel);
      }
    }
  });

  it('alvo do olho de 48 dp dentro do campo de 52 e o texto não passa por baixo dele', () => {
    expect(CAMPO_SENHA.olho).toBe(ALVO_TOQUE);
    expect(CAMPO_SENHA.olho).toBeGreaterThanOrEqual(44);
    expect(CAMPO_SENHA.olho).toBeLessThanOrEqual(CAMPO_SENHA.altura);
    expect(CAMPO_SENHA.recuoDoTexto).toBeGreaterThan(CAMPO_SENHA.olho);
  });

  it('o componente usa as props de teclado do kit depois das da tela (a tela não as sobrescreve) e o rótulo do olho', () => {
    expect(fonteRn).toContain('propsDeTecladoDaSenha(visivel, finalidade)')
    expect(fonteRn).not.toContain('visible-password');
    expect(fonteRn).not.toContain('Platform');
    expect(fonteRn.indexOf('{...resto}')).toBeLessThan(fonteRn.indexOf('{...teclado}'));
    expect(fonteRn).toContain('accessibilityLabel={rotuloDoOlhoDaSenha(visivel)}');
    expect(fonteRn).toContain('accessibilityRole="button"');
    expect(fonteRn).toContain('name={iconeDoOlhoDaSenha(visivel)}');
  });

  it('sem texto "Mostrar"/"Esconder" na tela: o olho é só ícone', () => {
    const jsx = fonteRn.slice(fonteRn.indexOf('return ('));
    expect(jsx).not.toMatch(/>\s*(Mostrar|Esconder|Ocultar)/);
    expect(jsx).not.toMatch(/'(Mostrar|Esconder|Ocultar)'/);
  });

  it('os ícones olho e olhoRiscado existem no kit, no traço comum', () => {
    for (const nome of ['olho', 'olhoRiscado']) {
      const bloco = new RegExp(`case '${nome}':([\\s\\S]*?)\\);\\n`).exec(fonteIcone)?.[1] ?? '';
      expect(bloco, nome).toContain('{...c}');
      expect(bloco, nome).not.toMatch(/stroke=|strokeWidth=|fill=|#[0-9A-Fa-f]{3,6}/);
    }
  });
});
