import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../../../contracts';

const imprimirHtml = vi.fn(async (_html: string, _titulo: string) => undefined);
vi.mock('@macuxi/platform-sdk/web', () => ({ imprimirHtml: (h: string, t: string) => imprimirHtml(h, t) }));

const { exportarPdfDoPedido } = await import('./exportar-pdf');
const { LOGO_PADRAO_DATA_URI } = await import('../../../domain/logo-padrao');

const dados = {
  number: 'PED-000123', status: 'approved', received_at: '2026-11-01T14:00:00.000Z', seller_name: 'Lucas Fictício', customer_name: 'Mercado Exemplo',
  payment_terms: '28 dias', discount_pct: 0, subtotal_cents: 10_000, total_cents: 10_000, price_table_id: null,
  items: [{ erp_code: 'P1', description: 'Produto Um', quantity: 1, unit_price_cents: 10_000, total_cents: 10_000 }],
  history: [], cliente: { razao_social: 'Mercado Exemplo Ltda', nome_fantasia: 'Mercado Exemplo', documento: '12345678000190', codigo_erp: 'C9' },
} as unknown as OrderDetail;

describe('exportarPdfDoPedido (T-0182, logo do cliente)', () => {
  beforeEach(() => imprimirHtml.mockClear());
  it('T-0182: usa a logo da empresa do ambiente', async () => {
    await exportarPdfDoPedido(dados, 'customer', { ambiente: { parametros: () => ({ empresa_nome: 'Dist' }), logoDaEmpresa: async () => 'data:image/png;base64,AAAA' }, tz: 'America/Manaus' });
    expect(imprimirHtml.mock.calls[0]![0]).toContain('<img class="logo" src="data:image/png;base64,AAAA"');
  });
  it('T-0182: sem logo, sai com a logo padrão', async () => {
    await exportarPdfDoPedido(dados, 'customer', { ambiente: { parametros: () => ({}) }, tz: 'America/Manaus' });
    expect(imprimirHtml.mock.calls[0]![0]).toContain(`<img class="logo" src="${LOGO_PADRAO_DATA_URI}"`);
  });
});
