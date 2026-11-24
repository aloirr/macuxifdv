import { describe, expect, it } from 'vitest';
import { CriarUsuarioRequestSchema, EditarUsuarioRequestSchema, UsuarioItemSchema } from './usuarios';
import { UsuarioSyncSchema } from './sync';
import { CustomerSummary } from './index';

describe('RN-CORE-59: contrato do Código FDV (aditivo, só de leitura)', () => {
  it('RN-CORE-59: UsuarioItem e UsuarioSync trazem codigo_fdv (nulo até a migração)', () => {
    expect(UsuarioItemSchema.shape.codigo_fdv.parse(null)).toBeNull();
    expect(UsuarioItemSchema.shape.codigo_fdv.parse('00001')).toBe('00001');
    expect(UsuarioSyncSchema.shape.codigo_fdv.parse(undefined)).toBeNull();
  });
  it('RN-CORE-59: criar e editar deixam passar codigo_fdv no schema para a API recusar com 422 (strict daria 400)', () => {
    expect(EditarUsuarioRequestSchema.safeParse({ codigo_fdv: '00009' }).success).toBe(true);
    expect(EditarUsuarioRequestSchema.safeParse({ campo_novo: 1 }).success).toBe(false);
    expect(CriarUsuarioRequestSchema.safeParse({ nome: 'A', email: 'a@b.com', senha: 'x', codigo_fdv: '00009' }).success).toBe(true);
  });
});

describe('RN-CORE-59: CustomerSummary do editor de rota traz o Código FDV (aditivo)', () => {
  const resumo = {
    id: '00000000-0000-4000-8000-000000000021', erp_code: '', trade_name: 'X', legal_name: 'X Ltda', cnpj: '', segment: '', abc_curve: 'C', address: '', city: '', district: '',
    lat: null, lng: null, phone: '', email: '', seller_id: '00000000-0000-4000-8000-000000000001', seller_name: '', customer_since: '', credit_limit_cents: 0,
    open_receivables_cents: 0, available_credit_cents: 0, overdue_count: 0, overdue_cents: 0, last_purchase_at: null, days_since_purchase: null, avg_monthly_cents: 0,
    positivated_this_month: false, price_table_id: null,
  };
  it('RN-CORE-59: sem codigo_fdv continua válido; com codigo_fdv ou nulo também', () => {
    expect(CustomerSummary.safeParse(resumo).success).toBe(true);
    expect(CustomerSummary.parse({ ...resumo, codigo_fdv: '00042' }).codigo_fdv).toBe('00042');
    expect(CustomerSummary.safeParse({ ...resumo, codigo_fdv: null }).success).toBe(true);
  });
});
