import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pasta = new URL('../pages/', import.meta.url);
const paginas = readdirSync(pasta).filter((n) => n.endsWith('.tsx')).map((n) => ({ n, texto: readFileSync(new URL(n, pasta), 'utf8') }));

describe('BKO Catálogo: botão Atualizar (R-20261120-090347)', () => {
  it('R-20261120-090347: "Atualizando" e "Sem resposta" não aparecem nas páginas', () => {
    expect(paginas.length).toBeGreaterThan(0);
    for (const { n, texto } of paginas) {
      expect(texto, n).not.toMatch(/Atualizando|Sem resposta/);
    }
  });
  it('R-20261120-090347: o botão atualizar tem rótulo fixo "Atualizar"', () => {
    const ocorrencias = paginas.flatMap(({ texto }) => texto.match(/id: 'atualizar',[^\n]*/g) ?? []);
    expect(ocorrencias.length).toBeGreaterThanOrEqual(4);
    for (const o of ocorrencias) expect(o).toMatch(/id: 'atualizar', rotulo: 'Atualizar', desligada:/);
  });
});
