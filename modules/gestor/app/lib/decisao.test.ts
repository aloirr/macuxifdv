import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBRL } from '@macuxi/comum';
import type { FilaAprovacao, ItemFilaAprovacao } from '../../contracts';
import { linhaDeMotivos, linhaDoCartao } from './apresentacao';
import { resumirFila } from '../../domain/aprovacoes';
import { cartoesDaFila, erroDoMotivo, filaAposDecisao, requisicaoDaDecisao } from './decisao';
import { pct } from './formato';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, o: Partial<ItemFilaAprovacao> & Pick<ItemFilaAprovacao, 'aprovacoes'>): ItemFilaAprovacao => ({
  pedido_id: id(n),
  vendedor_id: id(2),
  cliente_id: id(3),
  cliente_nome: null,
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
});

describe('RD-2267/2270/2271: vocabulário do Vendedor, sem cópia no Gestor', () => {
  it('a decisão, o mínimo do motivo e os níveis vêm de `contracts` do Vendedor', () => {
    const fonte = readFileSync(join(__dirname, 'decisao.ts'), 'utf8');
    expect(fonte).toContain('MOTIVO_REJEICAO_MIN');
    expect(fonte).toContain('DECISOES_APROVADOR');
    expect(fonte).not.toMatch(/MOTIVO_MIN\s*=/);
    expect(readFileSync(join(__dirname, '..', '..', 'domain', 'aprovacoes.ts'), 'utf8')).not.toMatch(/ORDEM_NIVEL/);
  });
});

describe('RD-2269: um cálculo só do resumo, em pedidos pendentes', () => {
  it('o resumo conta pedidos, não motivos: um pedido com 2 motivos conta 1', () => {
    expect(resumirFila(FILA.itens)).toEqual({ total: 2, vencidos: 0, vencendo: 0, para_mim: 2 });
  });

  it('depois da decisão o resumo é o mesmo cálculo da API (pedido que ainda tem motivo segue contando)', () => {
    const f1 = filaAposDecisao(FILA, id(21), 'aprovar', 'credito');
    expect(f1.resumo).toEqual(resumirFila(f1.itens));
    expect(f1.resumo.total).toBe(2);
  });

  it('a aba Aprovações lê o resumo da fila, o mesmo número do Início, sem recontar cartões', () => {
    const tela = readFileSync(join(__dirname, '..', 'screens', 'aprovacoes-screen.tsx'), 'utf8');
    expect(tela).toContain('fila.resumo');
    expect(tela).not.toContain('resumoDosCartoes');
  });
});

describe('T-0184 §3: as ações chamam as rotas do Vendedor', () => {
  it('Aprovar chama `aprovar`; Devolver chama `rejeitar` e Rejeitar chama `recusar`; o corpo é `{ motivo: texto livre, motivo_aprovacao }` (ADR 0062, desenho §7.1)', () => {
    expect(requisicaoDaDecisao(id(21), 'aprovar', 'credito', '')).toEqual({ caminho: `/vendedor/pedidos/${id(21)}/aprovar`, corpo: { motivo_aprovacao: 'credito' } });
    expect(requisicaoDaDecisao(id(21), 'devolver', 'inadimplencia', '  Pagar o vencido ')).toEqual({ caminho: `/vendedor/pedidos/${id(21)}/rejeitar`, corpo: { motivo: 'Pagar o vencido', motivo_aprovacao: 'inadimplencia' } });
    expect(requisicaoDaDecisao(id(21), 'recusar', 'inadimplencia', 'Cliente em cobrança')).toEqual({ caminho: `/vendedor/pedidos/${id(21)}/recusar`, corpo: { motivo: 'Cliente em cobrança', motivo_aprovacao: 'inadimplencia' } });
  });

  it('RN-GES-08: devolver e rejeitar pedem o motivo com 3 letras ou mais, em português; aprovar não pede', () => {
    expect(erroDoMotivo('aprovar', '')).toBeNull();
    expect(erroDoMotivo('devolver', ' ab ')).toBe('Escreva o motivo com pelo menos 3 letras para devolver.');
    expect(erroDoMotivo('recusar', '')).toBe('Escreva o motivo com pelo menos 3 letras para rejeitar.');
    expect(erroDoMotivo('recusar', 'Sem crédito')).toBeNull();
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
    expect(filaAposDecisao(FILA, id(21), 'recusar', 'inadimplencia').itens.map((i) => i.pedido_id)).toEqual([id(20)]);
  });
});

describe('T-0184 prancha 03: o cartão da fila destaca o cliente', () => {
  const tela = readFileSync(join(__dirname, '..', 'screens', 'aprovacoes-screen.tsx'), 'utf8');
  it('MC-1764/1765: título é o cliente, o valor usa tabular-nums e o motivo vai em 14 (t.sub), sem o vendedor', () => {
    expect(tela).toContain('i.cliente_nome');
    expect(tela).not.toContain('nomesDaVisao');
    expect(tela).toMatch(/fontVariant: \['tabular-nums'\]/);
    expect(tela).toMatch(/<Text style=\{t\.sub\} numberOfLines=\{2\}>\s*\{linha\}/);
    expect(tela).not.toMatch(/<Text style=\{t\.small\} numberOfLines=\{2\}>/);
  });
});
