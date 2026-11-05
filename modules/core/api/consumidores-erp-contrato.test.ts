/**
 * Payload fora do contrato do ERP nunca chega ao consumidor (T-0024): `tx.publicar` valida pelo schema oficial do Integracao e a
 * linha fica com erro no Hub (RN-INT-04). Estes casos substituem os antigos "ignorado com aviso" dos db.test (sem banco).
 */
import { describe, expect, it } from 'vitest';
import { EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO, EVENTO_ERP_PRODUTO_ATUALIZADO, EVENTO_ERP_PRODUTO_UNIDADE_ATUALIZADO } from '../../integracao/contracts';
import { EventoIntegracaoVendedorAtualizado } from './consumidores-erp-vendedor';

const ev = (entidade: string, external_id: string, registro: Record<string, unknown>) => ({
  lote_id: '0e500000-0000-4000-8000-000000000001',
  entidade,
  external_id,
  acao: 'criado',
  hash: 'h',
  ocorrido_em: '2026-11-04T10:00:00Z',
  registro: { external_id, alterado_em: '2026-11-04T10:00:00Z', ativo: true, ...registro },
});

describe('payload do ERP fora do contrato é recusado na origem (o consumidor nunca o vê)', () => {
  it('RN-CORE-19: embalagem_quantidade acima de 9999 é recusada pelo contrato oficial do produto', () => {
    const base = { sku: 'SKU-T63', nome: 'Refrigerante 2L', unidade: 'un', embalagem_medida: 'cx' };
    expect(EVENTO_ERP_PRODUTO_ATUALIZADO.schema.safeParse(ev('produto', 'P-T63', { ...base, embalagem_quantidade: 3_000_000_000 })).success).toBe(false);
    expect(EVENTO_ERP_PRODUTO_ATUALIZADO.schema.safeParse(ev('produto', 'P-T63', { ...base, embalagem_quantidade: 12 })).success).toBe(true);
  });

  it('RN-VEN-15: fator zero é recusado pelo contrato oficial da unidade; fator positivo passa', () => {
    const un = (fator: number) => ev('produto_unidade', 'PU-1', { produto_external_id: 'P-T61', unidade: 'CX', fator });
    expect(EVENTO_ERP_PRODUTO_UNIDADE_ATUALIZADO.schema.safeParse(un(0)).success).toBe(false);
    expect(EVENTO_ERP_PRODUTO_UNIDADE_ATUALIZADO.schema.safeParse(un(12)).success).toBe(true);
  });

  it('RN-VEN-17: endereço sem cidade é recusado pelo contrato oficial do endereço', () => {
    const end = (cidade: string) =>
      ev('cliente_endereco', 'E-1', { cliente_external_id: 'C-T61', tipo: 'entrega', descricao: 'Depósito', logradouro: 'Av. do Depósito', numero: '100', bairro: 'Industrial', cidade, uf: 'RR', cep: '69301-000', principal: false });
    expect(EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO.schema.safeParse(end('  ')).success).toBe(false);
    expect(EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO.schema.safeParse(end('Boa Vista')).success).toBe(true);
  });

  it('leitura tolerante só ignora chave a mais: envelope inválido e vendedor sem nome continuam recusados', () => {
    expect(EventoIntegracaoVendedorAtualizado.schema.safeParse({ foo: 1 }).success).toBe(false);
    const v = (registro: Record<string, unknown>) => ev('vendedor', 'V-1', registro);
    expect(EventoIntegracaoVendedorAtualizado.schema.safeParse(v({ nome: 'Ana', chave_nova: 1 })).success).toBe(true);
    expect(EventoIntegracaoVendedorAtualizado.schema.safeParse(v({})).success).toBe(false);
  });
});
