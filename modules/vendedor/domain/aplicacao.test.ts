import { describe, expect, it } from 'vitest';

import {
  APLICACAO_MAX_ORCAMENTO_PADRAO,
  aplicacaoMaxOrcamento,
  aplicacaoNoOrcamentoPadrao,
  retratoAplicacao,
} from './aplicacao';

const palavras = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(' ');

describe('RN-VEN-19: retrato da aplicação no item', () => {
  it('RN-VEN-19: texto até 300 fica igual', () => {
    expect(retratoAplicacao('Fiat Uno 1.0/1.4 2010–2014', true, 300)).toBe('Fiat Uno 1.0/1.4 2010–2014');
    const exato = 'a'.repeat(300);
    expect(retratoAplicacao(exato, true, 300)).toBe(exato);
  });

  it('RN-VEN-19: texto de 301 a 2.000 sai com no máximo 300, terminando em palavra inteira + "…"', () => {
    for (const n of [40, 100, 250]) {
      const bruto = palavras(n);
      const r = retratoAplicacao(bruto, true, 300)!;
      expect(r.length).toBeLessThanOrEqual(300);
      expect(r.endsWith('…')).toBe(true);
      const ultima = r.slice(0, -1).split(' ').pop()!;
      expect(bruto.split(' ')).toContain(ultima);
    }
  });

  it('RN-VEN-19: o corte em 300 conta o "…" e usa a última palavra inteira', () => {
    const r = retratoAplicacao(`${'abcd '.repeat(80)}`, true, 300)!;
    expect(r.length).toBe(300);
    expect(r).toBe(`${'abcd '.repeat(59)}abcd…`);
  });

  it('RN-VEN-19: palavra única maior que o máximo é cortada em max − 1 + "…"', () => {
    const r = retratoAplicacao('x'.repeat(500), true, 300)!;
    expect(r).toBe(`${'x'.repeat(299)}…`);
  });

  it('RN-VEN-19: item desmarcado grava nulo', () => {
    expect(retratoAplicacao('Fiat Uno', false, 300)).toBeNull();
  });

  it('RN-VEN-19: produto sem aplicação (nula, vazia ou só espaços) grava nulo', () => {
    expect(retratoAplicacao(null, true, 300)).toBeNull();
    expect(retratoAplicacao(undefined, true, 300)).toBeNull();
    expect(retratoAplicacao('  \n ', true, 300)).toBeNull();
  });

  it('RN-VEN-19: espaços e quebras nas pontas saem', () => {
    expect(retratoAplicacao('\n  Gol G5  \n', true, 300)).toBe('Gol G5');
  });

  it('RN-VEN-19: é idempotente', () => {
    for (const t of [palavras(100), 'x'.repeat(500), 'Uno 2010']) {
      const um = retratoAplicacao(t, true, 300);
      expect(retratoAplicacao(um, true, 300)).toBe(um);
    }
  });

  it('RN-VEN-19: o parâmetro aceita até 1.000 e o texto de 1.000 não é cortado', () => {
    const t = `${'ab '.repeat(333)}a`;
    expect(t.length).toBe(1000);
    expect(retratoAplicacao(t, true, 1000)).toBe(t);
    expect(retratoAplicacao(`${t} b`, true, 1000)!.length).toBeLessThanOrEqual(1000);
  });
});

describe('RN-VEN-19: parâmetros do tenant', () => {
  it('RN-VEN-19: aplicacao_max_orcamento padrão 300, faixa 50 a 1.000', () => {
    expect(APLICACAO_MAX_ORCAMENTO_PADRAO).toBe(300);
    expect(aplicacaoMaxOrcamento({})).toBe(300);
    expect(aplicacaoMaxOrcamento({ aplicacao_max_orcamento: 500 })).toBe(500);
    expect(aplicacaoMaxOrcamento({ aplicacao_max_orcamento: '1000' })).toBe(1000);
    expect(aplicacaoMaxOrcamento({ aplicacao_max_orcamento: 1001 })).toBe(300);
    expect(aplicacaoMaxOrcamento({ aplicacao_max_orcamento: 49 })).toBe(300);
    expect(aplicacaoMaxOrcamento({ aplicacao_max_orcamento: 'abc' })).toBe(300);
  });

  it('RN-VEN-19: aplicacao_no_orcamento_padrao vem marcada (sim) salvo configuração em contrário', () => {
    expect(aplicacaoNoOrcamentoPadrao({})).toBe(true);
    expect(aplicacaoNoOrcamentoPadrao({ aplicacao_no_orcamento_padrao: false })).toBe(false);
    expect(aplicacaoNoOrcamentoPadrao({ aplicacao_no_orcamento_padrao: 'nao' })).toBe(false);
    expect(aplicacaoNoOrcamentoPadrao({ aplicacao_no_orcamento_padrao: 'true' })).toBe(true);
  });
});
