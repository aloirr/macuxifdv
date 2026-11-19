import { ConsultaIndisponivel, type ClienteBanco, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { financeiroDoCliente } from './financeiro-aprovacao';

const fin = { limite_cents: 100_000, saldo_aberto_cents: 30_000, credito_disponivel_erp_cents: null as number | null, bloqueado: false, motivo_bloqueio: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0, atualizado_erp_em: null };
const ctx = (parametros: Record<string, unknown> = {}) => ({ parametros: () => parametros }) as unknown as ContextoBase;
const tx = (financeiro: typeof fin | null | 'indisponivel') =>
  ({
    async consultar() {
      if (financeiro === 'indisponivel') throw new ConsultaIndisponivel('core.financeiro_cliente@1', 'core');
      return { financeiro };
    },
  }) as unknown as TransacaoTenant;
const db = (pedidos: { status: string; total_cents: number }[]) => ({ async query() { return { rows: pedidos }; } }) as unknown as ClienteBanco;

describe('RN-VEN-12 e RN-VEN-13 (T-0184): o financeiro do cliente que o servidor usa para decidir a aprovação', () => {
  it('RN-VEN-12: disponível = limite − saldo − pedidos aprovados ainda não faturados', async () => {
    const r = await financeiroDoCliente(ctx(), db([{ status: 'approved', total_cents: 10_000 }]), tx(fin), 'c1');
    expect(r.para_aprovacao).toEqual({ limite_informado: true, disponivel_cents: 60_000, maior_atraso_dias: 0, limite_dias: 5 });
    expect(r.credito).toEqual({ limite_cents: 100_000, saldo_aberto_cents: 30_000, disponivel_cents: 60_000 });
  });
  it('RN-VEN-12: com o disponível do ERP só desconta o que o ERP ainda não viu (integrado não desconta de novo)', async () => {
    const r = await financeiroDoCliente(ctx(), db([{ status: 'approved', total_cents: 10_000 }, { status: 'integrated', total_cents: 5_000 }]), tx({ ...fin, credito_disponivel_erp_cents: 50_000 }), 'c1');
    expect(r.para_aprovacao?.disponivel_cents).toBe(40_000);
  });
  it('RN-VEN-12 (P4 A): cliente sem linha financeira ou sem limite informado = limite não informado', async () => {
    expect((await financeiroDoCliente(ctx(), db([]), tx(null), 'c1')).para_aprovacao).toMatchObject({ limite_informado: false, disponivel_cents: 0, maior_atraso_dias: 0 });
    expect((await financeiroDoCliente(ctx(), db([]), tx({ ...fin, limite_cents: 0 }), 'c1')).para_aprovacao).toMatchObject({ limite_informado: false });
  });
  it('RN-VEN-13: o limite de atraso vem do parâmetro titulo_vencido_dias e o atraso e o valor vencido vão para o evento', async () => {
    const r = await financeiroDoCliente(ctx({ titulo_vencido_dias: 30 }), db([]), tx({ ...fin, maior_atraso_dias: 12, vencidos_cents: 8_000 }), 'c1');
    expect(r.para_aprovacao).toMatchObject({ maior_atraso_dias: 12, limite_dias: 30 });
    expect(r.vencidos_cents).toBe(8_000);
  });
  it('RN-VEN-13: consulta indisponível não bloqueia o pedido (sem restrição financeira)', async () => {
    expect(await financeiroDoCliente(ctx(), db([]), tx('indisponivel'), 'c1')).toEqual({ para_aprovacao: undefined, credito: null, vencidos_cents: 0 });
  });
});
