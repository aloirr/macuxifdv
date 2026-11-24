import { describe, expect, it } from 'vitest';
import type { Order } from '../../contracts';
import { BOM_CSV } from '@macuxi/comum/csv';
import { csvNumber, ORDERS_CSV_HEADER, ordersToCsv, toCsv } from './csv';

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: '10494',
  idempotency_key: 'o1',
  seller_id: 's1',
  seller_name: 'Rafael S.',
  customer_id: 'c1',
  customer_name: 'Freios & Cia Cidade Nova',
  branch_id: 'b1',
  branch_name: 'CD Manaus',
  price_table_id: null,
  discount_pct: 7,
  subtotal_cents: 528760,
  discount_cents: 37014,
  total_cents: 491746,
  payment_terms: '28/56 dias',
  status: 'pending_approval',
  pending_reason: 'Desconto 7,0% · alçada do vendedor 5,0%',
  rejection_reason: '',
  erp_order_code: '',
  created_offline_at: null,
  received_at: '2026-10-12T12:05:00.000Z',
  updated_at: '2026-10-12T12:05:00.000Z',
  items_count: 21,
  units: 89,
  ...over,
});

describe('csv', () => {
  it('usa BOM, ; e CRLF, com quebra de linha dentro da célula (byte a byte)', () => {
    const csv = toCsv([['a', 'b'], ['linha\r\nnova', '']]);
    expect(Array.from(Buffer.from(csv, 'utf8').subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toBe(`${BOM_CSV}"a";"b"\r\n"linha\r\nnova";""\r\n`);
  });

  it('CWE-1236: cliente e motivo que começam como fórmula saem como texto no CSV de pedidos', () => {
    const csv = ordersToCsv([order({ customer_name: '=HYPERLINK("x")', pending_reason: '-5% extra' })]);
    const linha = csv.slice(1).trimEnd().split('\r\n')[1]!;
    expect(linha).toContain(';"\'=HYPERLINK(""x"")";');
    expect(linha).toContain(';"\'-5% extra";');
  });

  it('número com vírgula decimal e sem milhar', () => {
    expect(csvNumber(4917.46)).toBe('4917,46');
    expect(csvNumber(7, 1)).toBe('7,0');
  });

  it('gera a tabela de pedidos com o motivo certo por status', () => {
    const csv = ordersToCsv([order(), order({ id: 'o2', number: '10493', status: 'rejected', pending_reason: '', rejection_reason: 'Preço divergente; revisar', discount_pct: 0, total_cents: 338550 })]);
    expect(csv.startsWith(BOM_CSV)).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(ORDERS_CSV_HEADER.map((h) => `"${h}"`).join(';'));
    expect(lines[1]).toBe('"10494";"Freios & Cia Cidade Nova";"Rafael S.";"CD Manaus";"4917,46";"7,0";"Aguardando aprovação";"Desconto 7,0% · alçada do vendedor 5,0%";"12/10/2026 08:05";"";"";"";""');
    expect(lines[2]).toBe('"10493";"Freios & Cia Cidade Nova";"Rafael S.";"CD Manaus";"3385,50";"0,0";"Rejeitado";"Preço divergente; revisar";"12/10/2026 08:05";"";"";"";""');
  });

  it('T-0054: pedido faturado leva Nº ERP, faturado, devolvido e a última NF no fim da linha', () => {
    const csv = ordersToCsv([order({ status: 'invoiced', erp_order_code: 'ERP-9', faturado_cents: 491746, devolvido_cents: 10000, ultima_nota: '9002', pending_reason: '' })]);
    const linha = csv.slice(1).trimEnd().split('\r\n')[1]!;
    expect(linha.endsWith(';"ERP-9";"4917,46";"100,00";"9002"')).toBe(true);
    expect(linha).toContain(';"Faturado";');
  });
});
