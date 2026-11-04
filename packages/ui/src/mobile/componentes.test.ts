import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ALVO_TOQUE, folgaDeToque, lerQuantidade, limitarPasso, proximoPasso, rotuloComContador } from './componentes';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('componentes genéricos (T-0071, fatia 4): parte pura', () => {
  it('rotuloComContador monta "Itens (3)" e some sem contador', () => {
    expect(rotuloComContador('Itens', 3)).toBe('Itens (3)');
    expect(rotuloComContador('Itens', 0)).toBe('Itens (0)');
    expect(rotuloComContador('Detalhes')).toBe('Detalhes');
    expect(rotuloComContador('Detalhes', null)).toBe('Detalhes');
    expect(rotuloComContador('Itens', Number.NaN)).toBe('Itens');
  });

  it('limitarPasso trunca e respeita mínimo e máximo', () => {
    expect(limitarPasso(3.7)).toBe(3);
    expect(limitarPasso(-2)).toBe(0);
    expect(limitarPasso(12, 1, 10)).toBe(10);
    expect(limitarPasso(Number.NaN, 1)).toBe(1);
    expect(limitarPasso(5000)).toBe(5000);
  });

  it('proximoPasso anda de passo em passo sem passar dos limites', () => {
    expect(proximoPasso(3, 1)).toBe(4);
    expect(proximoPasso(0, -1)).toBe(0);
    expect(proximoPasso(10, 1, 5, 0, 12)).toBe(12);
    expect(proximoPasso(6, -1, 5, 1)).toBe(1);
  });

  it('lerQuantidade aceita só dígitos e devolve null sem número', () => {
    expect(lerQuantidade('12')).toBe(12);
    expect(lerQuantidade(' 3 ')).toBe(3);
    expect(lerQuantidade('1.000')).toBe(1000);
    expect(lerQuantidade('')).toBeNull();
    expect(lerQuantidade('abc')).toBeNull();
  });

  it('folgaDeToque leva qualquer visual menor ao alvo de 48 dp', () => {
    expect(ALVO_TOQUE).toBe(48);
    expect(folgaDeToque(36)).toBe(6);
    expect(folgaDeToque(40)).toBe(4);
    expect(folgaDeToque(27)).toBe(11);
    expect(folgaDeToque(56)).toBe(0);
    for (const v of [24, 28, 33, 36, 40, 48]) expect(v + 2 * folgaDeToque(v)).toBeGreaterThanOrEqual(ALVO_TOQUE);
  });
});

describe('componentes genéricos (T-0071, fatia 4): conferência estática', () => {
  const ARQUIVOS = ['./formulario.tsx', './folha.tsx', './valores.tsx', './base.tsx'];

  it('exporta todos os componentes no índice do kit mobile', () => {
    const indice = ler('./index.ts');
    for (const arq of ['./componentes', './formulario', './folha', './valores', './navegacao', './base', './movimento-rn']) expect(indice).toContain(`export * from '${arq}'`);
    const fonte = ARQUIVOS.map(ler).join('\n') + ler('./navegacao.tsx');
    for (const nome of ['Abas', 'Segmentado', 'Passo', 'CampoBusca', 'RotuloSecao', 'ChipMedida', 'BotaoIcone', 'Folha', 'OpcaoFolha', 'Dialogo', 'RodapeTotal', 'LinhaValor', 'BlocoTotais', 'Faixa', 'Selo', 'Trilha', 'Botao', 'Cartao', 'ChipEstado', 'AvisoRodape', 'useAvisoRodape', 'BarraAbas', 'EstadoVazio']) {
      expect(fonte, nome).toMatch(new RegExp(`export function ${nome}\\b`));
    }
  });

  it('nenhum texto fixo: sem frase entre tags, nem rótulo, placeholder ou título literal', () => {
    for (const arq of ARQUIVOS) {
      const src = ler(arq);
      // texto literal como filho de <Text>…</Text> (ex.: >Voltar<)
      expect(src, arq).not.toMatch(/>\s*[A-Za-zÀ-ú][^<>{}\n]*\s*<\//);
      // props de texto com literal (accessibilityLabel="Fechar", placeholder="Buscar")
      expect(src, arq).not.toMatch(/(accessibilityLabel|accessibilityHint|placeholder|title)=["'][^"']+["']/);
    }
  });

  it('alvos de toque: nenhum height/minHeight/width fixo abaixo de 48 sem hitSlop no mesmo componente', () => {
    // As medidas visuais menores (36, 40, 28) só existem com hitSlop calculado por folgaDeToque.
    const form = ler('./formulario.tsx');
    expect(form).toContain('folgaDeToque(ALTURA_SEG_COMPACTO)');
    expect(form).toContain('hitSlop={folga(LADO_PASSO)}');
    expect(form).toContain('hitSlop={folga(ALTURA_MEDIDA)}');
    expect(form).toContain('hitSlop={folga(tamanho)}');
  });

  it('Chip do kit com alvo de 48 dp (36 de altura + 6 em cima e embaixo)', () => {
    const ui = ler('./ui.tsx');
    expect(ui).toContain('hitSlop={{ top: 6, bottom: 6 }}');
    expect(ui).toMatch(/chip: \{ height: 36,/);
  });
});
