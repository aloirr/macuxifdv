/** R-20261120-062537: "Atualizando…" e "Sem resposta" não aparecem em nenhuma tela do Gestão (app e BKO); o selo mostra só a hora. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ, fontes } from './fontes-do-modulo';

const tsx = (dir: string): string[] => fontes(dir, (n) => /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n));

describe('R-20261120-062537: Gestão sem "Atualizando…" e "Sem resposta"', () => {
  it('nenhum .tsx de produção em app e web contém "Atualizando" nem "Sem resposta"', () => {
    const arquivos = [...tsx(join(RAIZ, 'app')), ...tsx(join(RAIZ, 'web'))];
    expect(arquivos.length).toBeGreaterThan(0);
    for (const f of arquivos) expect(readFileSync(f, 'utf8'), f).not.toMatch(/Atualizando|Sem\s?resposta/i);
  });
  it('o selo-faixa mostra a hora por atualizadoEm', () => {
    const s = readFileSync(join(__dirname, 'components', 'selo-faixa.tsx'), 'utf8');
    expect(s).toContain('atualizadoEm={g.sincronizado_em}');
  });
});
