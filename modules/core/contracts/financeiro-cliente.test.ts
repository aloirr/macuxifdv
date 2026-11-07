import { describe, expect, it } from 'vitest';
import { CadastroResumoSaidaSchema, ClientePagamentoPutSchema, ClienteSyncSchema, FinanceiroClienteEntradaSchema, FinanceiroClienteSaidaSchema } from './index';

const base = { id: '11111111-1111-4111-8111-111111111111', updated_at: '2026-11-01T00:00:00.000Z', deleted_at: null, external_id: null };
const cliente = { ...base, documento: null, razao_social: 'A', nome_fantasia: null, segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true };

describe('T-0089 contratos aditivos do Core (RN-VEN-25, RN-VEN-12/13)', () => {
  it('RN-VEN-25: cliente do sync sem os 2 campos novos continua válido (consumidor antigo)', () => {
    expect(ClienteSyncSchema.safeParse(cliente).success).toBe(true);
  });
  it('RN-VEN-25: cliente com prazo médio máximo e formas é válido; prazo negativo ou forma longa demais não', () => {
    expect(ClienteSyncSchema.safeParse({ ...cliente, prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] }).success).toBe(true);
    expect(ClienteSyncSchema.safeParse({ ...cliente, prazo_medio_max_dias: null, formas_pagamento: null }).success).toBe(true);
    expect(ClienteSyncSchema.safeParse({ ...cliente, prazo_medio_max_dias: -1 }).success).toBe(false);
    expect(ClienteSyncSchema.safeParse({ ...cliente, formas_pagamento: ['X'.repeat(21)] }).success).toBe(false);
  });
  it('RN-VEN-25: cadastro_resumo aceita cliente sem e com os campos novos', () => {
    const c = { id: base.id, razao_social: 'A', nome_fantasia: null, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null };
    const ok = (extra: object) => CadastroResumoSaidaSchema.safeParse({ clientes: [{ ...c, ...extra }], produtos: [], usuarios: [] }).success;
    expect(ok({})).toBe(true);
    expect(ok({ prazo_medio_max_dias: 30, formas_pagamento: ['PIX'] })).toBe(true);
  });
  it('RN-VEN-12/13: core.financeiro_cliente@1 aceita sem linha financeira e com vencidos', () => {
    expect(FinanceiroClienteEntradaSchema.safeParse({ cliente_id: base.id }).success).toBe(true);
    expect(FinanceiroClienteSaidaSchema.safeParse({ financeiro: null }).success).toBe(true);
    expect(
      FinanceiroClienteSaidaSchema.safeParse({
        financeiro: { limite_cents: 100, saldo_aberto_cents: 10, credito_disponivel_erp_cents: null, bloqueado: false, motivo_bloqueio: null, vencidos_qtd: 1, vencidos_cents: 5, maior_atraso_dias: 12, atualizado_erp_em: '2026-11-05T12:00:00.123456Z' },
      }).success,
    ).toBe(true);
  });
  it('RN-VEN-25: o PUT do BKO normaliza os códigos e recusa campo desconhecido', () => {
    expect(ClientePagamentoPutSchema.parse({ prazo_medio_max_dias: 30, formas_pagamento: ['pix'] }).formas_pagamento).toEqual(['PIX']);
    expect(ClientePagamentoPutSchema.safeParse({ prazo_medio_max_dias: 30, formas_pagamento: null, x: 1 }).success).toBe(false);
  });
});
