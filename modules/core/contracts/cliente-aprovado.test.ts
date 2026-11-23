import { describe, expect, it } from 'vitest';
import { DecidirCadastroClienteSchema, PreCadastroClienteSchema, ClienteAprovadoSchema, ClienteVincularErpEntradaSchema, CONSULTA_CLIENTES_APROVADOS_SEM_ERP, EVENTO_CLIENTE_APROVADO } from './cliente-aprovado';

describe('core.cliente.aprovado@1', () => {
  it('RN-CORE-78: nome do evento e payload só com ids e carimbo', () => {
    expect(EVENTO_CLIENTE_APROVADO.nome).toBe('core.cliente.aprovado@1');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(ClienteAprovadoSchema.safeParse({ cliente_id: id, aprovado_em: '2026-11-22T12:00:00.000Z', aprovado_por: id }).success).toBe(true);
    expect(ClienteAprovadoSchema.safeParse({ cliente_id: id, aprovado_em: 'x', aprovado_por: id }).success).toBe(false);
  });
  it('RN-INT-22: consulta limita o lote a 500 e o vínculo exige código não vazio', () => {
    expect(CONSULTA_CLIENTES_APROVADOS_SEM_ERP.nome).toBe('core.clientes_aprovados_sem_erp@1');
    expect(CONSULTA_CLIENTES_APROVADOS_SEM_ERP.entrada.safeParse({ limite: 501 }).success).toBe(false);
    expect(ClienteVincularErpEntradaSchema.safeParse({ cliente_id: '11111111-1111-4111-8111-111111111111', external_id: '  ' }).success).toBe(false);
  });
});

describe('pré-cadastro e decisão', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('RN-CORE-78: pré-cadastro normaliza documento e UF e recusa documento inválido', () => {
    const ok = PreCadastroClienteSchema.parse({ id, origem: 'campo', razao_social: ' Mercado X ', documento: '12.345.678/0001-95', uf: 'am' });
    expect(ok).toMatchObject({ razao_social: 'Mercado X', documento: '12345678000195', uf: 'AM' });
    expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', razao_social: 'X', documento: '123' }).success).toBe(false);
    expect(PreCadastroClienteSchema.safeParse({ id, origem: 'erp', razao_social: 'X' }).success).toBe(false);
  });
  it('RN-CORE-78: a decisão é aprovar ou recusar', () => {
    expect(DecidirCadastroClienteSchema.safeParse({ decisao: 'aprovar' }).success).toBe(true);
    expect(DecidirCadastroClienteSchema.safeParse({ decisao: 'talvez' }).success).toBe(false);
  });
});
