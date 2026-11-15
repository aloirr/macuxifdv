/**
 * Prazos em tabela / ajuste % do prazo (R-20261115-111000 e 121000; RN-VEN-02 v2, RN-VEN-24/25; proposta
 * docs/modulos/vendedor/prazo-desconto-acrescimo.md e simulação docs/design/prazo-ajuste/README.md). Valor × regra: os números
 * da simulação (Resumo, PDF e BKO) saem da conta do domain de hoje sobre a tabela ajustada; quando a função do item entrar,
 * ela tem de dar os mesmos centavos.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prazosDaForma, type PrazoDePagamento } from '../../../modules/vendedor/domain/pagamento';
import { precoDoItem, totaisDoPedido } from '../../../modules/vendedor/domain/preco-pedido';
import { RAIZ, importar, ler } from '../apoio/v1013';

/** Arquivo do domain do Vendedor que exporta `tabelaAjustadaCents` (proposta §2), se já existe. */
const AJUSTE = readdirSync(join(RAIZ, 'modules/vendedor/domain'))
  .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
  .map((n) => `modules/vendedor/domain/${n}`)
  .find((r) => /export (function|const) tabelaAjustadaCents\b/.test(ler(r)));

/** Referência da proposta §2: meia para cima de tabela × (10 000 + bp) ÷ 10 000, em inteiros. */
const ajustada = (tabela: number, bp: number): number => {
  const n = tabela * (10_000 + bp);
  return Math.floor(n / 10_000) + (n % 10_000 >= 5_000 ? 1 : 0);
};

const ITENS = [
  { tabela: 10_000, qtd: 1, desconto: 0 },
  { tabela: 1_775, qtd: 20, desconto: 5 },
  { tabela: 1_340, qtd: 30, desconto: 0 },
  { tabela: 430, qtd: 10, desconto: 0 },
];

function pedidoNoPrazo(bp: number, ajustar: (t: number, bp: number) => number = ajustada) {
  const linhas = ITENS.map((i) => {
    const p = precoDoItem({ preco_tabela_unidade_cents: ajustar(i.tabela, bp), quantidade: i.qtd, fator: 1, desconto_pct: i.desconto, acrescimo_pct: 0 });
    return { preco_tabela_cents: p.preco_tabela_cents, quantidade: i.qtd, total_cents: p.total_cents, desconto_pct: i.desconto, acrescimo_pct: 0 };
  });
  const t = totaisDoPedido(linhas, { desconto_pct: 0, acrescimo_pct: 0 });
  return { leite: linhas[1]!.total_cents, tabela: t.total_tabela_cents, desconto: t.descontos_cents, final: t.total_cents };
}

describe('Prazo em tabela — a simulação bate com a conta do domain (RN-VEN-02 v2: unitário arredondado × quantidade; os dois estados)', () => {
  it('À vista (−1,71%): tabela R$ 884,69, desconto R$ 17,40, final R$ 867,29; leite 16,58 × 20 = 331,60', () => {
    expect(pedidoNoPrazo(-171)).toEqual({ leite: 33_160, tabela: 88_469, desconto: 1_740, final: 86_729 });
  });

  it('60 dias (+2,50%): tabela R$ 922,60, desconto R$ 18,20, final R$ 904,40; leite 17,28 × 20 = 345,60 (e não 345,61)', () => {
    expect(pedidoNoPrazo(250)).toEqual({ leite: 34_560, tabela: 92_260, desconto: 1_820, final: 90_440 });
  });

  it('RN-VEN-25: o prazo de 60 dias fica habilitado com prazo médio do cliente 60 e desabilitado com 59', () => {
    const p60: PrazoDePagamento = { id: 'p60', forma_pagamento_id: 'boleto', codigo: '60', descricao: '60 dias', parcelas_dias: [60], prazo_medio_dias: 60, ordem: 1, ativo: true };
    expect(prazosDaForma([p60], 'boleto', 60)[0]).toMatchObject({ habilitado: true });
    expect(prazosDaForma([p60], 'boleto', 59)[0]).toMatchObject({ habilitado: false, motivo: 'acima_prazo_medio_cliente' });
  });
});

describe('Prazo em tabela — tabelaAjustadaCents do domain (proposta §2; RN-VEN-43 proposta)', () => {
  if (!AJUSTE) {
    it('antes do PR do modulo-vendedor: o domain ainda não ajusta a tabela pelo prazo', () => {
      expect(ler('modules/vendedor/domain/pagamento.ts')).not.toContain('percentual_ajuste');
    });
    return;
  }
  const fn = async () => (await importar<{ tabelaAjustadaCents(t: number, bp: number): number }>(AJUSTE)).tabelaAjustadaCents;

  it('os exemplos da proposta, com meia para cima: 98,29 · 12,14 · 12,66 · 0,21 · 0,29 (pequeno preço não muda)', async () => {
    const f = await fn();
    expect([f(10_000, -171), f(1_235, -171), f(1_235, 250), f(20, 250), f(29, -171)]).toEqual([9_829, 1_214, 1_266, 21, 29]);
    expect(f(1_235, 0)).toBe(1_235);
  });

  it('o pedido montado com a função do domain dá os mesmos totais da simulação, à vista e em 60 dias', async () => {
    const f = await fn();
    expect(pedidoNoPrazo(-171, f)).toEqual(pedidoNoPrazo(-171));
    expect(pedidoNoPrazo(250, f)).toEqual(pedidoNoPrazo(250));
  });
});
