import { describe, expect, it } from 'vitest';
import { PedidoRetornoErpEvento } from './eventos';
import { ImpostosRetorno, RetornoAceito, RetornoErp } from './pedido';

const UUID = '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c';
const retorno = (impostos?: unknown) => ({ versao_contrato: 'v1', pedido_uuid: UUID, status: 'integrado', numero_erp: 'PV-1', ocorrido_em: '2026-11-28T14:00:00Z', ...(impostos === undefined ? {} : { impostos }) });
const evento = (impostos?: unknown) => ({ pedido_uuid: UUID, status: 'integrado', numero_erp: 'PV-1', motivo: null, nota: null, ocorrido_em: '2026-11-28T14:00:00Z', ...(impostos === undefined ? {} : { impostos }) });

describe('RN-INT-09 (ADR 0077): bloco impostos no RetornoErp e no integracao.pedido.retorno_erp@1 (aditivo, continua v1/@1)', () => {
  it('RN-INT-08 (ADR 0077): 0 é aceito e continua 0 (calculado e zero)', () => {
    const imp = { v_icms_st_cents: 0, v_ipi_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 0 }] };
    expect(RetornoErp.parse(retorno(imp)).impostos).toEqual(imp);
    expect(PedidoRetornoErpEvento.parse(evento(imp)).impostos).toEqual(imp);
  });

  it('RN-INT-08 (ADR 0077): campo ausente continua ausente e null continua null (nunca vira 0)', () => {
    const r = RetornoErp.parse(retorno({ itens: [{ sequencia: 1, v_ipi_cents: null }] }));
    expect(r.impostos).toEqual({ itens: [{ sequencia: 1, v_ipi_cents: null }] });
    expect('v_icms_st_cents' in r.impostos!).toBe(false);
    expect('v_icms_st_cents' in r.impostos!.itens[0]!).toBe(false);
    const e = PedidoRetornoErpEvento.parse(evento({ itens: [{ sequencia: 1 }] }));
    expect(e.impostos).toEqual({ itens: [{ sequencia: 1 }] });
  });

  it('RN-INT-08 (ADR 0077): total ausente com itens presentes é válido e o total segue ausente', () => {
    const r = RetornoErp.parse(retorno({ itens: [{ sequencia: 1, v_icms_st_cents: 150, v_ipi_cents: 30 }, { sequencia: 2, v_icms_st_cents: 50, v_ipi_cents: 10 }] }));
    expect(r.impostos?.v_icms_st_cents).toBeUndefined();
    expect(r.impostos?.v_ipi_cents).toBeUndefined();
  });

  it('RN-INT-09 (ADR 0077): retorno e evento sem o bloco continuam válidos (Conector antigo); itens vazios também', () => {
    expect(RetornoErp.parse(retorno()).impostos).toBeUndefined();
    expect(RetornoErp.parse(retorno(null)).impostos).toBeNull();
    expect(PedidoRetornoErpEvento.parse(evento()).impostos).toBeUndefined();
    expect(ImpostosRetorno.parse({ itens: [] })).toEqual({ itens: [] });
  });

  it('RN-INT-08 (ADR 0077): só inteiro >= 0 em centavos; itens é obrigatório no bloco', () => {
    for (const v of [-1, 1.5, '100']) expect(ImpostosRetorno.safeParse({ v_ipi_cents: v, itens: [] }).success).toBe(false);
    expect(ImpostosRetorno.safeParse({ itens: [{ sequencia: 1, v_icms_st_cents: 0.01 }] }).success).toBe(false);
    expect(ImpostosRetorno.safeParse({ itens: [{ sequencia: 0 }] }).success).toBe(false);
    expect(ImpostosRetorno.safeParse({ v_ipi_cents: 1 }).success).toBe(false);
  });

  it('RN-INT-09 (ADR 0077): RetornoAceito aceita impostos_descartados opcional', () => {
    expect(RetornoAceito.parse({ pedido_uuid: UUID, status: 'integrado', repetido: false, impostos_descartados: [{ indice: 0, sequencia: 3, codigo: 'sequencia_inexistente', campo: 'impostos.itens[0].sequencia', motivo: 'x' }] }).impostos_descartados).toHaveLength(1);
    expect(RetornoAceito.parse({ pedido_uuid: UUID, status: 'integrado', repetido: false }).impostos_descartados).toBeUndefined();
  });
});
