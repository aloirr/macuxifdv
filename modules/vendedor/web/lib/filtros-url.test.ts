import { describe, expect, it } from 'vitest';
import { FILTROS_VAZIOS, lerFiltros, paraBusca, paraQuery, temFiltro } from './filtros-url';

const VENDEDOR = '0f290000-0000-4000-8000-000000000006';

describe('filtros da lista de pedidos na URL (T-0029 §8)', () => {
  it('ida e volta: o que está na URL volta igual', () => {
    const f = { status: 'pending_approval', seller_id: VENDEDOR, from: '2026-11-01', to: '2026-11-30', q: 'Auto Peças' };
    expect(lerFiltros(paraBusca(f))).toEqual(f);
  });

  it('sem filtro a URL fica limpa', () => {
    expect(paraBusca(FILTROS_VAZIOS)).toBe('');
    expect(lerFiltros('')).toEqual(FILTROS_VAZIOS);
    expect(temFiltro(FILTROS_VAZIOS)).toBe(false);
  });

  it('link velho ou digitado à mão: status, vendedor e datas inválidos são ignorados', () => {
    const f = lerFiltros('?status=xpto&seller_id=1%27%20or%201=1&from=ontem&to=2026-13&q=a');
    expect(f).toEqual({ ...FILTROS_VAZIOS, q: 'a' });
  });

  it('a busca é limitada a 100 caracteres e a query da API leva só o que foi preenchido', () => {
    expect(lerFiltros(`?q=${'x'.repeat(300)}`).q).toHaveLength(100);
    expect(paraQuery({ ...FILTROS_VAZIOS, status: 'approved', q: '000012' })).toEqual({ status: 'approved', q: '000012' });
    expect(temFiltro({ ...FILTROS_VAZIOS, from: '2026-11-01' })).toBe(true);
  });
});
