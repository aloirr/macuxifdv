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

  it('tem o pacote do estoque, com o mesmo desenho do IconPacote da web (R-20261115-084600)', () => {
    expect(nomesDoTipo()).toContain('pacote');
    const bloco = /case 'pacote':([\s\S]*?)\);\n/.exec(fonte)?.[1] ?? '';
    expect(bloco).toContain('{...c}');
    expect(bloco).not.toMatch(/stroke=|strokeWidth=|fill=|#[0-9A-Fa-f]{3,6}/);
    const web = readFileSync(new URL('../web/icons.tsx', import.meta.url), 'utf8');
    const blocoWeb = /export const IconPacote[\s\S]*?<\/Svg>/.exec(web)?.[0] ?? '';
    const tracos = (t: string, re: RegExp) => [...t.matchAll(re)].map((m) => m[1]);
    const mobile = tracos(bloco, /d="([^"]+)"/g);
    expect(mobile).toHaveLength(4);
    expect(tracos(blocoWeb, /d="([^"]+)"/g)).toEqual(mobile);
  });
});
