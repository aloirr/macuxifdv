import { describe, expect, it } from 'vitest';
import { formatBRL } from '@macuxi/comum';
import type { FilaAprovacao, ItemFilaAprovacao } from '../../contracts';
import { linhaDeMotivos, linhaDoCartao } from './apresentacao';
import { cartoesDaFila, erroDoMotivo, filaAposDecisao, requisicaoDaDecisao, resumoDosCartoes } from './decisao';
import { pct } from './formato';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, o: Partial<ItemFilaAprovacao> & Pick<ItemFilaAprovacao, 'aprovacoes'>): ItemFilaAprovacao => ({
  pedido_id: id(n),
  vendedor_id: id(2),
  cliente_id: id(3),
  solicitada_em: '2026-10-30T19:00:00Z',
  nivel: 'gerente',
  motivos: o.aprovacoes.map((a) => a.motivo),
  pedido_numero: String(n).padStart(6, '0'),
  total_cents: 248_000,
  desconto_efetivo_pct: 12,
  credito: { limite_cents: 1_000_000, saldo_aberto_cents: 812_000, disponivel_cents: 188_000 },
  inadimplencia: { maior_atraso_dias: 12, vencidos_cents: 40_000 },
  historico: null,
  prazo_em: '2026-10-31T19:00:00Z',
  horas_restantes: 8,
  situacao: 'no_prazo',
  pode_decidir: true,
  acima_do_nivel: false,
  ...o,
});
const a = (motivo: ItemFilaAprovacao['aprovacoes'][number]['motivo'], pode_decidir = true) => ({ motivo, nivel: 'gerente' as const, estado: 'pendente' as const, pode_decidir });
const FILA: FilaAprovacao = {
  itens: [item(21, { aprovacoes: [a('credito'), a('inadimplencia')] }), item(20, { aprovacoes: [a('desconto')], inadimplencia: null, credito: null })],
  resumo: { total: 2, vencidos: 0, vencendo: 0, para_mim: 2 },
  calculado_em: '2026-10-30T20:00:00Z',
};

describe('T-0184 P3 B: o texto de cada cartão', () => {
  it('RN-VEN-12, RN-VEN-13 e RN-VEN-10: Nº, motivo e o dado que decide, como na prancha 03', () => {
    const [credito, inad, desc] = cartoesDaFila(FILA.itens);
    expect(linhaDoCartao(credito!.item, 'credito', pct, formatBRL)).toBe(`Nº 000021 · Crédito disponível ${formatBRL(188_000)}`);
    expect(linhaDoCartao(inad!.item, 'inadimplencia', pct, formatBRL)).toBe('Nº 000021 · Inadimplente há 12 dias');
    expect(linhaDoCartao(desc!.item, 'desconto', pct, formatBRL)).toBe(`Nº 000020 · Desconto ${pct(12)}`);
  });

  it('linhaDeMotivos: Inadimplente com o atraso, no singular com 1 dia, e sem o atraso só o rótulo', () => {
    expect(linhaDeMotivos(['inadimplencia'], 0, pct, undefined, 12)).toBe('Inadimplente há 12 dias');
    expect(linhaDeMotivos(['inadimplencia'], 0, pct, undefined, 1)).toBe('Inadimplente há 1 dia');
    expect(linhaDeMotivos(['inadimplencia'], 0, pct)).toBe('Inadimplente');
    expect(linhaDeMotivos(['credito', 'inadimplencia'], 3, pct, undefined, 5)).toBe(`Crédito do cliente · Inadimplente há 5 dias · desconto ${pct(3)}`);
  });

  it('sem o número do pedido, o cartão mostra só o motivo; sem o limite, o rótulo do crédito', () => {
    expect(linhaDoCartao({ ...FILA.itens[0]!, pedido_numero: null, credito: null }, 'credito', pct, formatBRL)).toBe('Crédito do cliente');
  });
});

describe('T-0184 P3 B: um cartão por motivo', () => {
  it('cada motivo é um cartão com a própria chave, na ordem da fila', () => {
    expect(cartoesDaFila(FILA.itens).map((c) => c.chave)).toEqual([`${id(21)}|credito`, `${id(21)}|inadimplencia`, `${id(20)}|desconto`]);
  });

  it('cache gravado antes da v1.0.15 (sem `aprovacoes`) vira um cartão por motivo, sem quebrar a tela', () => {
    const { aprovacoes: _fora, ...antigo } = FILA.itens[0]!;
    expect(cartoesDaFila([antigo as ItemFilaAprovacao]).map((c) => c.aprovacao.motivo)).toEqual(['credito', 'inadimplencia']);
  });

  it('o resumo da tela conta os cartões, não os pedidos', () => {
    expect(resumoDosCartoes(cartoesDaFila(FILA.itens))).toEqual({ total: 3, para_mim: 3, vencidos: 0, vencendo: 0 });
    const so = [item(21, { aprovacoes: [a('credito', false)], pode_decidir: false, situacao: 'vencido' })];
    expect(resumoDosCartoes(cartoesDaFila(so))).toEqual({ total: 1, para_mim: 0, vencidos: 1, vencendo: 0 });
  });
});

describe('T-0184 §3: as ações chamam as rotas do Vendedor', () => {
  it('Aprovar chama `aprovar` com o motivo; Devolver chama `rejeitar` e Rejeitar chama `recusar`, com o texto', () => {
    expect(requisicaoDaDecisao(id(21), 'aprovar', 'credito', '')).toEqual({ caminho: `/vendedor/pedidos/${id(21)}/aprovar`, corpo: { motivo: 'credito' } });
    expect(requisicaoDaDecisao(id(21), 'devolver', 'inadimplencia', '  Pagar o vencido ')).toEqual({ caminho: `/vendedor/pedidos/${id(21)}/rejeitar`, corpo: { motivo: 'inadimplencia', texto: 'Pagar o vencido' } });
    expect(requisicaoDaDecisao(id(21), 'rejeitar', 'inadimplencia', 'Cliente em cobrança')).toEqual({ caminho: `/vendedor/pedidos/${id(21)}/recusar`, corpo: { motivo: 'inadimplencia', texto: 'Cliente em cobrança' } });
  });

  it('RN-GES-08: devolver e rejeitar pedem o motivo com 3 letras ou mais, em português; aprovar não pede', () => {
    expect(erroDoMotivo('aprovar', '')).toBeNull();
    expect(erroDoMotivo('devolver', ' ab ')).toBe('Escreva o motivo com pelo menos 3 letras para devolver.');
    expect(erroDoMotivo('rejeitar', '')).toBe('Escreva o motivo com pelo menos 3 letras para rejeitar.');
    expect(erroDoMotivo('rejeitar', 'Sem crédito')).toBeNull();
  });
});

describe('T-0184 P7 A e P8 A: a fila do aparelho depois da decisão', () => {
  it('aprovar tira só o motivo; o último motivo tira o pedido', () => {
    const f1 = filaAposDecisao(FILA, id(21), 'aprovar', 'credito');
    expect(cartoesDaFila(f1.itens).map((c) => c.chave)).toEqual([`${id(21)}|inadimplencia`, `${id(20)}|desconto`]);
    const f2 = filaAposDecisao(f1, id(21), 'aprovar', 'inadimplencia');
    expect(f2.itens.map((i) => i.pedido_id)).toEqual([id(20)]);
    expect(f2.resumo).toMatchObject({ total: 1, para_mim: 1 });
  });

  it('devolver e rejeitar tiram o pedido inteiro (encerram os outros motivos)', () => {
    expect(filaAposDecisao(FILA, id(21), 'devolver', 'credito').itens.map((i) => i.pedido_id)).toEqual([id(20)]);
    expect(filaAposDecisao(FILA, id(21), 'rejeitar', 'inadimplencia').itens.map((i) => i.pedido_id)).toEqual([id(20)]);
  });
});
