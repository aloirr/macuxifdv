import { describe, expect, it } from 'vitest';
import type { FilaAprovacao, ItemFilaAprovacao } from '../../contracts';
import { resumoDoCardAprovacao } from './card-inicio';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, o: Partial<ItemFilaAprovacao> = {}): ItemFilaAprovacao => ({
  pedido_id: id(n),
  vendedor_id: id(900 + n),
  cliente_id: id(800 + n),
  solicitada_em: '2026-11-04T12:00:00.000Z',
  nivel: 'supervisor',
  motivos: ['desconto'],
  total_cents: 231_040,
  desconto_efetivo_pct: 8,
  credito: null,
  historico: null,
  prazo_em: '2026-11-05T12:00:00.000Z',
  horas_restantes: 9,
  situacao: 'no_prazo',
  pode_decidir: true,
  acima_do_nivel: false,
  ...o,
});
const fila = (itens: ItemFilaAprovacao[], o: Partial<FilaAprovacao['resumo']> = {}): FilaAprovacao => ({
  itens,
  resumo: { total: itens.length, vencidos: 0, vencendo: 0, para_mim: itens.filter((i) => i.pode_decidir).length, ...o },
  calculado_em: '2026-11-04T12:00:00.000Z',
});
const nomes = new Map([[id(901), 'Lucas Andrade'], [id(902), 'Marina Lima']]);

describe('T-0073 / RN-GES-04: card "Pedidos para aprovar" do Início da Gestão', () => {
  it('RN-GES-04: o número é o da alçada de quem olha (para_mim), não o total da equipe', () => {
    const r = resumoDoCardAprovacao(fila([item(1), item(2, { pode_decidir: false }), item(3, { pode_decidir: false })]), nomes);
    expect(r).toMatchObject({ vazio: false, total: 1, titulo: 'Pedido para aprovar' });
  });

  it('RN-GES-08: mostra o primeiro pedido que a pessoa pode decidir (vendedor, desconto efetivo, valor em reais)', () => {
    const r = resumoDoCardAprovacao(fila([item(2, { pode_decidir: false }), item(1)]), nomes)!;
    expect(r.linha).toBe('Lucas · 8% de desconto · R$ 2.310');
    expect(r.rotuloAcessivel).toBe('1 pedido para aprovar. O primeiro: Lucas, 8% de desconto, R$ 2.310.');
  });

  it('RN-GES-08: plural no título e no leitor de tela', () => {
    const r = resumoDoCardAprovacao(fila([item(1), item(2)]), nomes)!;
    expect(r.titulo).toBe('Pedidos para aprovar');
    expect(r.total).toBe(2);
    expect(r.rotuloAcessivel.startsWith('2 pedidos para aprovar.')).toBe(true);
  });

  it('RN-GES-04: fila sem nada na alçada → cartão vazio, não tocável', () => {
    const r = resumoDoCardAprovacao(fila([item(1, { pode_decidir: false })]), nomes)!;
    expect(r).toMatchObject({ vazio: true, total: 0, linha: null });
    expect(r.rotuloAcessivel).toBe('Nenhum pedido esperando aprovação.');
  });

  it('RN-CORE-02: sem cópia da fila no aparelho, o card não aparece', () => {
    expect(resumoDoCardAprovacao(null, nomes)).toBeNull();
  });

  it('RN-GES-08: vendedor fora do cache da visão aparece como "Vendedor"; desconto fracionado em pt-BR', () => {
    const r = resumoDoCardAprovacao(fila([item(7, { desconto_efetivo_pct: 7.5 })]), nomes)!;
    expect(r.linha).toBe('Vendedor · 7,5% de desconto · R$ 2.310');
  });

  it('RN-GES-08: pedido sem desconto mostra só vendedor e valor', () => {
    const r = resumoDoCardAprovacao(fila([item(1, { desconto_efetivo_pct: 0, motivos: ['credito'] })]), nomes)!;
    expect(r.linha).toBe('Lucas · Crédito do cliente · R$ 2.310');
  });
});
