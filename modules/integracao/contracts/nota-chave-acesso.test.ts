import { describe, expect, it } from 'vitest';
import { PedidoRetornoErpEvento } from './eventos';
import { RetornoErp } from './pedido';

const CHAVE = '13261104252011000110550010000088551234567890';
const nota = (extra: Record<string, unknown> = {}) => ({ numero: '8855', serie: '1', emitida_em: '2026-11-06T10:15:00Z', total_cents: 19000, ...extra });
const retorno = (n: Record<string, unknown>) => ({
  versao_contrato: 'v1',
  pedido_uuid: '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c',
  status: 'faturado_total',
  numero_erp: 'PV-1',
  nota: n,
  ocorrido_em: '2026-11-06T10:16:00Z',
});

describe('RN-INT-08/09: chave_acesso da NF-e no retorno (aditivo na v1)', () => {
  it('RN-INT-08: aceita a chave com exatamente 44 dígitos', () => {
    const r = RetornoErp.safeParse(retorno(nota({ chave_acesso: CHAVE })));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nota?.chave_acesso).toBe(CHAVE);
  });
  it('RN-INT-09: chave ausente ou nula continua válida (Conector antigo)', () => {
    expect(RetornoErp.safeParse(retorno(nota())).success).toBe(true);
    expect(RetornoErp.safeParse(retorno(nota({ chave_acesso: null }))).success).toBe(true);
  });
  it('RN-INT-08: recusa 43 dígitos, 45 dígitos e letras, com a mensagem no campo nota.chave_acesso', () => {
    for (const chave of [CHAVE.slice(1), `${CHAVE}1`, `${CHAVE.slice(1)}A`, '']) {
      const r = RetornoErp.safeParse(retorno(nota({ chave_acesso: chave })));
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.path).toEqual(['nota', 'chave_acesso']);
        expect(r.error.issues[0]?.message).toMatch(/44 dígitos/);
      }
    }
  });
  it('RN-INT-08: a chave chega ao consumidor dentro de nota no evento integracao.pedido.retorno_erp@1', () => {
    const e = PedidoRetornoErpEvento.parse({ pedido_uuid: '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c', status: 'faturado_total', numero_erp: 'PV-1', motivo: null, nota: nota({ chave_acesso: CHAVE }), ocorrido_em: '2026-11-06T10:16:00Z' });
    expect(e.nota?.chave_acesso).toBe(CHAVE);
  });
});
