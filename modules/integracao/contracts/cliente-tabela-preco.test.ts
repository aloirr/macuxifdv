import { describe, expect, it } from 'vitest';
import { ClientePayload } from './entidades';

const base = { external_id: 'C1', alterado_em: '2026-11-08T10:00:00.000Z', ativo: true, razao_social: 'Mercado Sol' };

describe('T-0120: vínculo cliente -> tabela de preço vindo do ERP (aditivo no v1)', () => {
  it('RN-INT-04: o cliente aceita a chave da tabela de preço (a mesma tabela_external_id da entidade preco)', () => {
    expect(ClientePayload.parse({ ...base, tabela_preco_external_id: 'TAB-ATACADO' })).toMatchObject({ tabela_preco_external_id: 'TAB-ATACADO' });
  });

  it('RN-INT-04: ausente não altera (undefined) e null desvincula; cliente antigo segue válido sem o campo', () => {
    expect(ClientePayload.parse(base).tabela_preco_external_id).toBeUndefined();
    expect(ClientePayload.parse({ ...base, tabela_preco_external_id: null }).tabela_preco_external_id).toBeNull();
  });

  it('RN-INT-03: chave vazia ou maior que 200 caracteres é recusada na linha', () => {
    expect(ClientePayload.safeParse({ ...base, tabela_preco_external_id: '' }).success).toBe(false);
    expect(ClientePayload.safeParse({ ...base, tabela_preco_external_id: 'x'.repeat(201) }).success).toBe(false);
  });
});
