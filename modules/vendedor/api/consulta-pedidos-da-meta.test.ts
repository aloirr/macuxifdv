import { describe, expect, it } from 'vitest';
import { EMITIDO_EM_SQL } from './consulta-pedidos-da-meta';

describe('T-0138: emissão limitada na consulta pedidos_da_meta@1 (a mesma do evento criado@1)', () => {
  it('RN-CORE-21: o SQL limita o aparelho a [recebimento − 7 dias, recebimento] e filtra a janela pelo mesmo valor', () => {
    expect(EMITIDO_EM_SQL).toContain("interval '7 days'");
    expect(EMITIDO_EM_SQL).toContain('least(greatest(p.criado_no_aparelho_em');
    expect(EMITIDO_EM_SQL).toMatch(/criado_no_aparelho_em is null then p\.created_at/);
  });
});
