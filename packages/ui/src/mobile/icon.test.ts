import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// icon.tsx importa react-native-svg (não roda no node): a conferência é sobre o texto do arquivo.
const fonte = readFileSync(new URL('./icon.tsx', import.meta.url), 'utf8');

const nomesDoTipo = (): string[] => {
  const tipo = /export type IconName =([\s\S]*?);/.exec(fonte)?.[1] ?? '';
  return [...tipo.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]!);
};

const desenhos = (): string[] => [...fonte.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]!);

describe('ícones do kit mobile', () => {
  it('todo nome do tipo IconName tem desenho no render (e nenhum desenho sobra)', () => {
    const nomes = nomesDoTipo();
    expect(nomes.length).toBeGreaterThan(30);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect([...desenhos()].sort()).toEqual([...nomes].sort());
  });

  it('tem câmera e caixa de entrada (R-20261104-231124, T-0072)', () => {
    expect(nomesDoTipo()).toEqual(expect.arrayContaining(['camera', 'inbox']));
  });

  it('câmera e caixa de entrada seguem o padrão: traço comum, sem cor nem espessura própria', () => {
    for (const nome of ['camera', 'inbox']) {
      const bloco = new RegExp(`case '${nome}':([\\s\\S]*?)\\);\\n`).exec(fonte)?.[1] ?? '';
      expect(bloco, nome).toContain('{...c}');
      expect(bloco, nome).not.toMatch(/stroke=|strokeWidth=|fill=|#[0-9A-Fa-f]{3,6}/);
    }
  });

  it('tem a lâmpada do título "Você sabia?" da tela de carga, no padrão do traço comum (T-0181)', () => {
    expect(nomesDoTipo()).toContain('lampada');
    const bloco = /case 'lampada':([\s\S]*?)\);\n/.exec(fonte)?.[1] ?? '';
    expect(bloco).toContain('{...c}');
    expect(bloco).not.toMatch(/stroke=|strokeWidth=|fill=|#[0-9A-Fa-f]{3,6}/);
    // traços da spec carga-aviso-frases §1
    expect(bloco).toContain('M9 18h6');
    expect(bloco).toContain('M10 21h4');
    expect(bloco).toContain('M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z');
  });
});
