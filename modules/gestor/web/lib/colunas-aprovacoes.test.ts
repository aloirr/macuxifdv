import { describe, expect, it } from 'vitest';
import { COLUNAS_APROVACOES_1366, LARGURA_TABELA_1366_PX, somaDasColunasVisiveis } from './colunas-aprovacoes';

describe('Aprovações no BKO em 1.366 px', () => {
  it('RF-GES-04: a soma das colunas visíveis cabe nos 1.028 px da tabela, sem corte', () => {
    expect(somaDasColunasVisiveis()).toBeLessThanOrEqual(LARGURA_TABELA_1366_PX);
  });
  it('RF-GES-04: cada coluna tem largura para o conteúdo real (Total, Prazo, Vendedor, Cliente)', () => {
    for (const c of COLUNAS_APROVACOES_1366) expect(c.largura).toBeGreaterThanOrEqual(c.minimo);
    const min = Object.fromEntries(COLUNAS_APROVACOES_1366.map((c) => [c.id, c.minimo]));
    expect(min.total).toBeGreaterThanOrEqual(112);
    expect(min.prazo).toBeGreaterThanOrEqual(150);
    expect(min.vendedor).toBeGreaterThanOrEqual(140);
    expect(min.cliente).toBeGreaterThanOrEqual(220);
    expect(min.motivo).toBeGreaterThanOrEqual(200);
  });
});
