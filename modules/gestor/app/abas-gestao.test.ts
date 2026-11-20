/**
 * T-0187 P6 A: barra do Gestão = Início · Equipe · Rota · Aprovações · Clientes · Alertas. Lê o fonte de `app/index.ts`
 * (as telas usam React Native, então não são importadas).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Ordem da aba Clientes, que vem do módulo Core. */
const ORDEM_CLIENTES_CORE = 30;
/** Ordem da aba Pedidos, que vem do módulo Vendedor. */
const ORDEM_PEDIDOS_VENDEDOR = 40;

const fonte = readFileSync(join(__dirname, 'index.ts'), 'utf8');

function ordemDa(id: string): number | undefined {
  const linha = fonte.split('\n').find((l) => l.includes(`id: '${id}'`));
  const m = linha?.match(/ordem:\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

describe('T-0187 P6 A: ordem das abas do Gestão', () => {
  it('Equipe (10) vem antes de Aprovações (20), que vem antes de Alertas (35)', () => {
    const equipe = ordemDa('equipe');
    const aprovacoes = ordemDa('aprovacoes');
    const alertas = ordemDa('alertas');
    expect(equipe).toBe(10);
    expect(aprovacoes).toBe(20);
    expect(alertas).toBe(35);
    expect(equipe!).toBeLessThan(aprovacoes!);
    expect(aprovacoes!).toBeLessThan(alertas!);
  });

  it('Alertas fica depois de Clientes (Core, 30) e antes de Pedidos (Vendedor, 40)', () => {
    const alertas = ordemDa('alertas');
    expect(alertas).toBeGreaterThan(ORDEM_CLIENTES_CORE);
    expect(alertas).toBeLessThan(ORDEM_PEDIDOS_VENDEDOR);
  });
});
