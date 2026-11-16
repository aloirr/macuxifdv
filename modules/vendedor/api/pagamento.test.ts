import { ConsultaIndisponivel, type ClienteBanco, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { resolverPagamento, valorPercentualPrazo, valoresPagamento } from './pagamento';

const FORMAS = [
  { id: 'f-pix', codigo: 'PIX', nome: 'Pix', ativo: true, ordem: 1 },
  { id: 'f-bol', codigo: 'BOLETO', nome: 'Boleto', ativo: true, ordem: 2 },
];
const PRAZOS = [
  { id: 'p-av', forma_pagamento_id: 'f-pix', codigo: 'PIX-AV', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, ordem: 0 },
  { id: 'p-28', forma_pagamento_id: 'f-bol', codigo: 'BOL-28', descricao: '28 dias', parcelas_dias: [28], prazo_medio_dias: 28, ativo: true, ordem: 1 },
  { id: 'p-60', forma_pagamento_id: 'f-bol', codigo: 'BOL-30-60-90', descricao: '30/60/90 dias', parcelas_dias: [30, 60, 90], prazo_medio_dias: 60, ativo: true, ordem: 2 },
  { id: 'p-av-d', forma_pagamento_id: 'f-pix', codigo: 'PIX-DESC', descricao: 'À vista c/ desconto', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, ordem: 3, percentual_ajuste: -1.71, atualizado_em: '2026-11-15T10:00:00.000Z' },
];

const db = {
  async query(sql: string, params: unknown[]) {
    if (sql.includes('vendedor.forma_pagamento')) return { rows: FORMAS.filter((f) => f.id === params[0]) };
    return { rows: PRAZOS.filter((p) => p.id === params[0]) };
  },
} as unknown as ClienteBanco;

const ctx = (parametros: Record<string, unknown> = {}) => ({ parametros: () => parametros, agora: () => new Date('2026-11-15T16:00:00.000Z') }) as unknown as ContextoBase;
const tx = (financeiro: { maior_atraso_dias: number } | null | 'indisponivel') =>
  ({
    async consultar() {
      if (financeiro === 'indisponivel') throw new ConsultaIndisponivel('core.financeiro_cliente@1', 'core');
      return { financeiro };
    },
  }) as unknown as TransacaoTenant;
const cli = { prazo_medio_max_dias: 45 as number | null, formas_pagamento: null as string[] | null };
const base = { customer_id: 'c1' };

describe('API: forma e prazo do pedido (RN-VEN-24/25, RN-VEN-13)', () => {
  it('RN-VEN-24: sem forma e prazo no payload segue pela condição legada (APK anterior)', async () => {
    const r = await resolverPagamento(ctx(), db, tx(null), base, cli, 'pedido');
    expect(r).toEqual({ ok: true, pagamento: null, titulo_vencido: false, percentual_ajuste_bp: 0, percentual_ajuste: 0, percentual_mudou: false });
    expect(valoresPagamento(null)).toEqual([null, null, null, null, null, null, null, null]);
    // RN-VEN-45: sem prazo o retrato do percentual é NULL (CHECK pedido_prazo_percentual_com_prazo da 0082), nunca 0
    expect(valorPercentualPrazo(null, 0)).toBeNull();
    expect(valorPercentualPrazo({ forma: {} as never, prazo: {} as never, texto: 'x' }, -1.71)).toBe(-1.71);
  });
  it('RN-VEN-24: só a forma ou só o prazo é 422 RN-VEN-24', async () => {
    expect(await resolverPagamento(ctx(), db, tx(null), { ...base, forma_pagamento_id: 'f-bol' }, cli, 'pedido')).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
    expect(await resolverPagamento(ctx(), db, tx(null), { ...base, prazo_pagamento_id: 'p-28' }, cli, 'pedido')).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
  });
  it('RN-VEN-24: prazo de outra forma é 422 RN-VEN-24', async () => {
    expect(await resolverPagamento(ctx(), db, tx(null), { ...base, forma_pagamento_id: 'f-pix', prazo_pagamento_id: 'p-28' }, cli, 'pedido')).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
  });
  it('RN-VEN-25: prazo médio acima do máximo do cliente é 422 RN-VEN-25', async () => {
    expect(await resolverPagamento(ctx(), db, tx(null), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-60' }, cli, 'pedido')).toMatchObject({ ok: false, codigo: 'RN-VEN-25' });
  });
  it('RN-VEN-25: forma fora da lista do cliente é 422 RN-VEN-25', async () => {
    expect(await resolverPagamento(ctx(), db, tx(null), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-28' }, { ...cli, formas_pagamento: ['PIX'] }, 'pedido')).toMatchObject({ ok: false, codigo: 'RN-VEN-25' });
  });
  it('RN-VEN-24: pagamento válido devolve o retrato (8 colunas juntas) e o texto "Boleto · 28 dias"', async () => {
    const r = await resolverPagamento(ctx(), db, tx(null), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-28' }, cli, 'pedido');
    expect(r.ok && r.pagamento?.texto).toBe('Boleto · 28 dias');
    expect(r.ok && valoresPagamento(r.pagamento)).toEqual(['f-bol', 'p-28', 'BOLETO', 'Boleto', 'BOL-28', '28 dias', [28], 28]);
  });
  it('RN-VEN-13: título vencido há mais de 5 dias com prazo a prazo vai para aprovação; à vista não', async () => {
    const aPrazo = await resolverPagamento(ctx(), db, tx({ maior_atraso_dias: 12 }), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-28' }, cli, 'pedido');
    expect(aPrazo).toMatchObject({ ok: true, titulo_vencido: true });
    const aVista = await resolverPagamento(ctx(), db, tx({ maior_atraso_dias: 12 }), { ...base, forma_pagamento_id: 'f-pix', prazo_pagamento_id: 'p-av' }, cli, 'pedido');
    expect(aVista).toMatchObject({ ok: true, titulo_vencido: false });
  });
  it('RN-VEN-13: o limite vem do parâmetro titulo_vencido_dias do tenant', async () => {
    const r = await resolverPagamento(ctx({ titulo_vencido_dias: 30 }), db, tx({ maior_atraso_dias: 12 }), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-28' }, cli, 'pedido');
    expect(r).toMatchObject({ titulo_vencido: false });
  });
  it('RN-VEN-13: consulta financeira indisponível não bloqueia o pedido', async () => {
    const r = await resolverPagamento(ctx(), db, tx('indisponivel'), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-28' }, cli, 'pedido');
    expect(r).toMatchObject({ ok: true, titulo_vencido: false });
  });
  it('RN-VEN-13: orçamento não vai para aprovação por título vencido', async () => {
    const r = await resolverPagamento(ctx(), db, tx({ maior_atraso_dias: 99 }), { ...base, forma_pagamento_id: 'f-bol', prazo_pagamento_id: 'p-28' }, cli, 'orcamento');
    expect(r).toMatchObject({ ok: true, titulo_vencido: false });
  });
  it('RN-VEN-45: percentual do push igual ao vigente: aceita e devolve o bp para recalcular os preços', async () => {
    const p = { ...base, forma_pagamento_id: 'f-pix', prazo_pagamento_id: 'p-av-d', prazo_percentual_ajuste: -1.71, created_offline_at: '2026-11-15T15:00:00.000Z' };
    expect(await resolverPagamento(ctx(), db, tx(null), p, cli, 'pedido')).toMatchObject({ ok: true, percentual_ajuste_bp: -171, percentual_ajuste: -1.71 });
  });
  it('RN-VEN-45: percentual diferente do vigente sem mudança posterior recusa com 422 em português (RN-VEN-40)', async () => {
    const p = { ...base, forma_pagamento_id: 'f-pix', prazo_pagamento_id: 'p-av-d', prazo_percentual_ajuste: 0, created_offline_at: '2026-11-15T15:00:00.000Z' };
    expect(await resolverPagamento(ctx(), db, tx(null), p, cli, 'pedido')).toMatchObject({ ok: false, codigo: 'RN-VEN-45' });
  });
  it('RN-VEN-45: cadastro mudou depois do pedido: aceita o percentual do pedido (aviso na linha do tempo, fora da alçada)', async () => {
    const p = { ...base, forma_pagamento_id: 'f-pix', prazo_pagamento_id: 'p-av-d', prazo_percentual_ajuste: 0, created_offline_at: '2026-11-15T09:00:00.000Z' };
    const r = await resolverPagamento(ctx(), db, tx(null), p, cli, 'pedido');
    expect(r).toMatchObject({ ok: true, percentual_ajuste_bp: 0 });
    expect(r.ok && r.percentual_mudou).toBe(true);
  });
});
