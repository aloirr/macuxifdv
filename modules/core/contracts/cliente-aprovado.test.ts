import { describe, expect, it } from 'vitest';
import { ClienteAprovadoSchema, ClienteVincularErpEntradaSchema, CONSULTA_CLIENTES_APROVADOS_SEM_ERP, EVENTO_CLIENTE_APROVADO } from './cliente-aprovado';

describe('core.cliente.aprovado@1', () => {
  it('RN-CORE-74: nome do evento e payload só com ids e carimbo', () => {
    expect(EVENTO_CLIENTE_APROVADO.nome).toBe('core.cliente.aprovado@1');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(ClienteAprovadoSchema.safeParse({ cliente_id: id, aprovado_em: '2026-11-22T12:00:00.000Z', aprovado_por: id }).success).toBe(true);
    expect(ClienteAprovadoSchema.safeParse({ cliente_id: id, aprovado_em: 'x', aprovado_por: id }).success).toBe(false);
  });
  it('RN-INT-24: consulta limita o lote a 500 e o vínculo exige código não vazio', () => {
    expect(CONSULTA_CLIENTES_APROVADOS_SEM_ERP.nome).toBe('core.clientes_aprovados_sem_erp@1');
    expect(CONSULTA_CLIENTES_APROVADOS_SEM_ERP.entrada.safeParse({ limite: 501 }).success).toBe(false);
    expect(ClienteVincularErpEntradaSchema.safeParse({ cliente_id: '11111111-1111-4111-8111-111111111111', external_id: '  ' }).success).toBe(false);
  });
});
