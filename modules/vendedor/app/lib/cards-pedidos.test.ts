import { describe, expect, it } from 'vitest';
import { periodoDe } from '../../domain/busca-periodo';
import { resumoDePedidos } from '../../domain/resumo-pedidos';
import { textoDoCard } from './cards-pedidos';

describe('RN-VEN-43: cards de Pedidos', () => {
  it('RN-VEN-43: texto do card = quantidade · valor; sem resposta, traço', () => {
    expect(textoDoCard({ quantidade: 2, valor_cents: 123400 })).toMatch(/^2 · R\$\s?1\.234,00$/);
    expect(textoDoCard(null)).toBe('—');
  });
  it('RN-VEN-43: o recusado fica fora e o total soma orçamentos e enviados', () => {
    const emitido_em = '2026-11-10T15:00:00Z';
    const r = resumoDePedidos(
      [
        { status: 'received', total_cents: 1000, emitido_em },
        { status: 'rejected', total_cents: 500, emitido_em },
        { tipo: 'orcamento', status: 'draft', total_cents: 200, emitido_em },
      ],
      { periodo: periodoDe('mes', new Date('2026-11-12T12:00:00Z'), 'America/Manaus'), tz: 'America/Manaus' },
    );
    expect(r.total).toEqual({ quantidade: 2, valor_cents: 1200 });
  });
});
