import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest roda com cwd = modules/core; lê só a própria pasta contracts.
const PASTA = join(process.cwd(), 'contracts');
const IMPORTA_INTEGRACAO = /(?:from|import)\s*\(?\s*['"][^'"]*(?:integracao\/contracts|@macuxi\/integracao)[^'"]*['"]/;

// Este teste sai quando a regra `error` do dependency-cruiser entrar (pedido ao engenheiro-software).
describe('fronteira: contracts do Core', () => {
  it('não importa de integracao/contracts (sem ciclo)', () => {
    const arquivos = readdirSync(PASTA).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(arquivos.length).toBeGreaterThan(0);
    const infratores = arquivos.filter((f) => IMPORTA_INTEGRACAO.test(readFileSync(join(PASTA, f), 'utf8')));
    expect(infratores).toEqual([]);
  });
});
