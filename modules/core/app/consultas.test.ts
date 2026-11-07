import { describe, expect, it } from 'vitest';
import type { ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { consultaFinanceiroClienteAparelho } from './consultas';

const CLI = '11111111-1111-4111-8111-111111111111';
const linha = { id: 'a', updated_at: 'x', deleted_at: null, external_id: null };

function ctx(tabelas: Record<string, unknown[]>): ContextoConsultaAparelho {
  return {
    linhasPorCampo: async (entidade: string) => (tabelas[entidade] ?? []) as never,
    agora: () => new Date('2026-11-06T15:00:00.000Z'),
    usuario: () => ({ fuso: 'America/Manaus' }) as never,
  } as unknown as ContextoConsultaAparelho;
}

describe('core.financeiro_cliente@1 no aparelho (RN-VEN-12/13), offline', () => {
  it('RN-VEN-13: lê as linhas locais e devolve vencidos, valor e maior atraso', async () => {
    const saida = await consultaFinanceiroClienteAparelho.executar(
      { cliente_id: CLI },
      ctx({
        cliente_financeiro: [{ ...linha, cliente_id: CLI, limite_cents: 500_000, saldo_aberto_cents: 100_000, credito_disponivel_cents: null, bloqueado: false, motivo_bloqueio: null, atualizado_erp_em: '2026-11-05T10:00:00.000Z' }],
        titulo: [
          { ...linha, id: 't1', cliente_id: CLI, vencimento: '2026-10-23', saldo_cents: 40_000, situacao: 'aberto' },
          { ...linha, id: 't2', cliente_id: CLI, vencimento: '2026-11-20', saldo_cents: 60_000, situacao: 'aberto' },
          { ...linha, id: 't3', cliente_id: CLI, vencimento: '2026-09-01', saldo_cents: 0, situacao: 'liquidado' },
        ],
      }),
    );
    expect(saida.financeiro).toMatchObject({ limite_cents: 500_000, vencidos_qtd: 1, vencidos_cents: 40_000, maior_atraso_dias: 14, atualizado_erp_em: '2026-11-05T10:00:00.000Z' });
  });
  it('RN-VEN-12: cliente sem linha financeira local devolve null', async () => {
    expect(await consultaFinanceiroClienteAparelho.executar({ cliente_id: CLI }, ctx({}))).toEqual({ financeiro: null });
  });
});
