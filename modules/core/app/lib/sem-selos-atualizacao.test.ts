import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = join(__dirname, '..', '..');

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return fontes(caminho);
    return caminho.endsWith('.tsx') && !caminho.endsWith('.test.tsx') ? [caminho] : [];
  });
}

describe('R-20261120-062537: "Atualizando…" e "Sem resposta" não aparecem em nenhuma tela', () => {
  it('nenhuma tela do app nem do BKO do core traz os textos nem as props do selo', () => {
    const arquivos = [...fontes(join(raiz, 'app')), ...fontes(join(raiz, 'web'))];
    expect(arquivos.length).toBeGreaterThan(0);
    for (const arq of arquivos) {
      const texto = readFileSync(arq, 'utf8');
      expect(texto, arq).not.toMatch(/Atualizando…|atualizando…|Sem resposta/);
      expect(texto, arq).not.toMatch(/\batualizando=|\bsemResposta=/);
    }
  });
});
