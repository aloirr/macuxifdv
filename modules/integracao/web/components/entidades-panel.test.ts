import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Revisão v1.0.31 (designer-ux R2-1, R2-3, R2-7; marca MC-2000, MC-2001): leitura da fonte, como o `monitor-page.test.ts`. */
describe('entidades-panel e monitor-painel: colunas, menu "⋯" e título', () => {
  const painel = readFileSync(new URL('./entidades-panel.tsx', import.meta.url), 'utf8');
  const monitor = readFileSync(new URL('./monitor-painel.tsx', import.meta.url), 'utf8');
  const coluna = (id: string) => painel.split('\n').find((l) => l.includes(`id: '${id}'`)) ?? '';

  it('R2-1: sem botões extras de quem monta o painel ("Zerar dados" mora na "Dados no Hub" do portal)', () => {
    expect(painel).not.toMatch(/acoesDaEntidade/);
    expect(monitor).not.toMatch(/acoesDaEntidade/);
    expect(painel).not.toMatch(/380px/);
  });

  it('R2-3: Reprocessar e Histórico vão para o menu "⋯" (sem coluna de botões)', () => {
    expect(coluna('acoes')).toBe('');
    expect(painel).not.toMatch(/<Button/);
    expect(painel).toMatch(/acoes=\{\(l\) =>\s*menuDaEntidade\(/);
  });

  it('R2-3: no quadro estreito ficam Entidade e Situação ("Última carga" prioridade 3, "Linhas integradas" prioridade 2)', () => {
    expect(coluna('entidade')).not.toMatch(/prioridade/);
    expect(coluna('situacao')).not.toMatch(/prioridade/);
    expect(coluna('ultima')).toMatch(/prioridade: 3/);
    expect(coluna('linhas')).toMatch(/prioridade: 2/);
  });

  it('R2-7 / MC-2001: o quadro aceita `titulo` (o portal passa "Cargas recentes"; o BKO não passa)', () => {
    expect(monitor).toMatch(/titulo\?: string/);
    expect(monitor).toMatch(/titulo=\{titulo\}/);
    expect(painel).toMatch(/<Panel label=\{titulo \?\? 'Entidades'\} title=\{titulo\}>/);
  });

  it('R3-1 (engenheiro-apps v1.0.31): a Situação cabe o selo mais largo ("Com falha", 74 px) + 20 px de respiro, e não mais', () => {
    const largura = Number(/largura: '(\d+)px'/.exec(coluna('situacao'))?.[1]);
    expect(largura).toBeGreaterThanOrEqual(74 + 20);
    expect(largura).toBe(94);
  });
});
