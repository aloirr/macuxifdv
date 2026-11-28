/**
 * Rota `POST /pedidos/{uuid}/retorno` (A5) com banco simulado: o estado aditivo `cancelamento_recusado` da T-0114 (exceção da
 * RN-INT-08) e o retorno de sempre, sem o campo novo, continuam válidos na mesma rota. Os testes com Postgres ficam em
 * `consumidores.db.test.ts` (CI).
 */
import { describe, expect, it, vi } from 'vitest';
import { EVENTO_PEDIDO_CANCELAMENTO_RECUSADO, EVENTO_PEDIDO_RETORNO_ERP, RetornoErp, VERSAO_CONTRATO } from '../contracts';
import { retornoPedido } from './rotas-pedidos';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';
const AGORA = '2026-11-08T12:00:00.000Z';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const linha = (extra: Record<string, unknown> = {}) => ({
  pedido_uuid: UUID, estado: 'integrado', tentativas: 1, numero_erp: 'PV-9', deleted_at: null, payload: { pedido_uuid: UUID, itens: [] }, enviado_em: null, motivo: null,
  notas_aplicadas: [], itens_faturados_acumulados: {}, retencao_codigo: null, cancelamento_estado: 'enviado', cancelamento_motivo: 'Cliente desistiu',
  cancelamento_solicitado_em: AGORA, cancelamento_enviado_em: AGORA, cancelamento_tentativas: 1, cancelamento_recusa_motivo: null, ...extra,
});

/** Banco por tenant: só o tenant dono do pedido enxerga a linha (RLS simulada pelo `tenant_id` do primeiro parâmetro). */
function ambiente(donoDoPedido = TENANT_A, extra: Record<string, unknown> = {}, tenant = TENANT_A) {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const publicar = vi.fn(async () => undefined);
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      if (/^\s*select/i.test(sql)) return { rows: params[0] === donoDoPedido ? [linha(extra)] : [] };
      if (/returning id/i.test(sql)) return { rows: [{ id: 'ret-1' }] };
      return { rows: [] };
    }),
  };
  const ctx = (corpo: unknown) => ({
    tenantId: tenant,
    conector: { id: 'c1', identificador: 'matriz-01', recebe_pedidos: true },
    corpo: RetornoErp.parse(corpo),
    params: { pedido_uuid: UUID },
    agora: () => new Date(AGORA),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    comTenant: (fn: (d: typeof db, t: { publicar: typeof publicar }) => Promise<unknown>) => fn(db, { publicar }),
  });
  return { sqls, publicar, ctx };
}

const recusa = (extra: Record<string, unknown> = {}) => ({ versao_contrato: VERSAO_CONTRATO, pedido_uuid: UUID, status: 'cancelamento_recusado', motivo: 'Pedido já faturado no ERP', ocorrido_em: AGORA, ...extra });
const executar = (c: unknown) => retornoPedido(c as never);

describe('T-0114: retorno cancelamento_recusado (aditivo na v1; exceção da RN-INT-08)', () => {
  it('RN-INT-08 (T-0114): a recusa grava o motivo, NÃO muda o estado do pedido e publica integracao.pedido.cancelamento_recusado@1 uma vez', async () => {
    const a = ambiente();
    const r = await executar(a.ctx(recusa()));
    expect(r).toEqual({ pedido_uuid: UUID, status: 'integrado', repetido: false });
    const up = a.sqls.find((s) => /update integracao\.pedido_fila_erp/i.test(s.sql));
    expect(up?.sql).toMatch(/cancelamento_estado = 'recusado'/);
    expect(up?.sql).not.toMatch(/\bestado = \$3/);
    expect(a.publicar).toHaveBeenCalledTimes(1);
    expect(a.publicar).toHaveBeenCalledWith(EVENTO_PEDIDO_CANCELAMENTO_RECUSADO, { pedido_uuid: UUID, numero_erp: 'PV-9', motivo: 'Pedido já faturado no ERP', recusado_em: AGORA }, UUID);
    expect(a.publicar).not.toHaveBeenCalledWith(EVENTO_PEDIDO_RETORNO_ERP, expect.anything(), expect.anything());
    expect(a.sqls.some((s) => /insert into integracao\.pedido_retorno\b/.test(s.sql))).toBe(false);
  });

  it('RN-INT-08 (T-0114): a mesma recusa repetida responde repetido e não grava nem publica de novo', async () => {
    const a = ambiente(TENANT_A, { cancelamento_estado: 'recusado', cancelamento_recusa_motivo: 'Pedido já faturado no ERP' });
    const r = await executar(a.ctx(recusa()));
    expect(r).toMatchObject({ repetido: true });
    expect(a.publicar).not.toHaveBeenCalled();
    expect(a.sqls.some((s) => /^\s*update/i.test(s.sql))).toBe(false);
  });

  it('RN-INT-08 (T-0114): sem cancelamento pedido ao ERP, ainda não entregue ou já confirmado, a recusa é 422 em português', async () => {
    for (const [estado, codigo] of [[null, 'cancelamento_nao_solicitado'], ['pendente', 'cancelamento_nao_entregue'], ['confirmado', 'cancelamento_ja_confirmado']] as const) {
      const a = ambiente(TENANT_A, { cancelamento_estado: estado });
      await expect(executar(a.ctx(recusa()))).rejects.toMatchObject({ status: 422 });
      await expect(executar(a.ctx(recusa()))).rejects.toMatchObject({ corpo: { codigo } });
      expect(a.publicar).not.toHaveBeenCalled();
    }
  });

  it('multi-tenant: o Conector de outro tenant não recusa o cancelamento do pedido de A (pedido_desconhecido)', async () => {
    const a = ambiente(TENANT_A, {}, TENANT_B);
    await expect(executar(a.ctx(recusa()))).rejects.toMatchObject({ corpo: { codigo: 'pedido_desconhecido' } });
    expect(a.publicar).not.toHaveBeenCalled();
  });

  it('RN-INT-08 (T-0114): o retorno de sempre, sem o campo novo (cancelado), segue o caminho antigo: confirma o cancelamento e publica retorno_erp@1', async () => {
    const a = ambiente();
    const r = await executar(a.ctx({ versao_contrato: VERSAO_CONTRATO, pedido_uuid: UUID, status: 'cancelado', ocorrido_em: AGORA }));
    expect(r).toMatchObject({ pedido_uuid: UUID, status: 'cancelado', repetido: false });
    expect(a.sqls.find((s) => /update integracao\.pedido_fila_erp/i.test(s.sql))?.sql).toMatch(/then 'confirmado'/);
    expect(a.publicar).toHaveBeenCalledWith(EVENTO_PEDIDO_RETORNO_ERP, expect.objectContaining({ status: 'cancelado' }), UUID);
  });
});

describe('ADR 0076 D6 / RN-VEN-02 v3: trava da quantidade fracionária no retorno', () => {
  const nota = { numero: '123', serie: '1', emitida_em: AGORA, total_cents: 100 };
  const faturado = (quantidade: number) => ({
    versao_contrato: VERSAO_CONTRATO, pedido_uuid: UUID, status: 'faturado_parcial', numero_erp: 'PV-9', ocorrido_em: AGORA, nota,
    itens_faturados: [{ sequencia: 1, produto_external_id: 'P1', quantidade, valor_cents: 100 }],
  });
  const comVersao = (a: ReturnType<typeof ambiente>, corpo: unknown, campo: string, gestao: string) => ({
    ...a.ctx(corpo),
    agora: () => new Date('2026-11-27T12:00:00.000Z'),
    versaoApp: { doCliente: null, publicada: async (v: 'campo' | 'gestao') => ({ versao: v === 'campo' ? campo : gestao, publicada_em: '2026-11-26T10:00:00.000Z' }) },
  });

  it('RN-VEN-02 v3: trava fechada (sem versaoApp) recusa a quantidade faturada fracionária com 422 quantidade_fracionaria_bloqueada', async () => {
    const a = ambiente();
    await expect(executar(a.ctx(faturado(1.25)))).rejects.toMatchObject({ status: 422, corpo: { codigo: 'quantidade_fracionaria_bloqueada' } });
    expect(a.publicar).not.toHaveBeenCalled();
  });

  it('RN-VEN-02 v3: mais de 4 casas é 422 quantidade_fracionaria_invalida, mesmo sem a trava', async () => {
    const a = ambiente();
    await expect(executar(a.ctx(faturado(1.23456)))).rejects.toMatchObject({ status: 422, corpo: { codigo: 'quantidade_fracionaria_invalida' } });
  });

  it('ADR 0076 D6: trava aberta (Campo e Gestão 1.0.36 há mais de 24 h) aceita a quantidade fracionária', async () => {
    const a = ambiente();
    await expect(executar(comVersao(a, faturado(1.25), '1.0.36', '1.0.37'))).resolves.toMatchObject({ pedido_uuid: UUID });
  });

  it('ADR 0076 D6: só uma variante na 1.0.36 mantém a trava fechada', async () => {
    const a = ambiente();
    await expect(executar(comVersao(a, faturado(1.25), '1.0.36', '1.0.35'))).rejects.toMatchObject({ corpo: { codigo: 'quantidade_fracionaria_bloqueada' } });
  });

  it('quantidade inteira não consulta a trava e segue como hoje', async () => {
    const a = ambiente();
    await expect(executar(a.ctx(faturado(2)))).resolves.toMatchObject({ pedido_uuid: UUID });
  });
});

describe('RN-INT-08/RN-INT-09 (ADR 0077): ST e IPI do ERP no retorno, repassados sem cálculo', () => {
  const doisItens = { payload: { pedido_uuid: UUID, itens: [{ sequencia: 1, produto_external_id: 'P1', quantidade: 1 }, { sequencia: 2, produto_external_id: 'P2', quantidade: 1 }] }, estado: 'enviado' };
  const integrado = (impostos?: unknown) => ({ versao_contrato: VERSAO_CONTRATO, pedido_uuid: UUID, status: 'integrado', numero_erp: 'PV-9', ocorrido_em: AGORA, ...(impostos === undefined ? {} : { impostos }) });
  const evento = (a: ReturnType<typeof ambiente>) => {
    const chamada = a.publicar.mock.calls[0] as unknown as [{ nome: string; schema: { parse: (x: unknown) => Record<string, unknown> } }, unknown];
    expect(chamada[0].nome).toBe(EVENTO_PEDIDO_RETORNO_ERP.nome);
    return chamada[0].schema.parse(chamada[1]);
  };

  it('RN-INT-08 (ADR 0077): 0 chega 0 no evento, no item e no total', async () => {
    const a = ambiente(TENANT_A, doisItens);
    await executar(a.ctx(integrado({ v_icms_st_cents: 0, v_ipi_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 0 }] })));
    expect(evento(a).impostos).toEqual({ v_icms_st_cents: 0, v_ipi_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 0 }] });
  });

  it('RN-INT-08 (ADR 0077): campo ausente continua ausente no evento (nunca 0)', async () => {
    const a = ambiente(TENANT_A, doisItens);
    await executar(a.ctx(integrado({ v_icms_st_cents: 410, itens: [{ sequencia: 1, v_icms_st_cents: 410 }] })));
    const imp = evento(a).impostos as Record<string, unknown> & { itens: Record<string, unknown>[] };
    expect('v_ipi_cents' in imp).toBe(false);
    expect('v_ipi_cents' in imp.itens[0]!).toBe(false);
  });

  it('RN-INT-08 (ADR 0077): total ausente com os itens presentes não vira a soma dos itens', async () => {
    const a = ambiente(TENANT_A, doisItens);
    await executar(a.ctx(integrado({ itens: [{ sequencia: 1, v_icms_st_cents: 100, v_ipi_cents: 10 }, { sequencia: 2, v_icms_st_cents: 200, v_ipi_cents: 20 }] })));
    const imp = evento(a).impostos as Record<string, unknown>;
    expect(imp.v_icms_st_cents).toBeUndefined();
    expect(imp.v_ipi_cents).toBeUndefined();
  });

  it('RN-INT-09 (ADR 0077): retorno sem o bloco publica o evento sem impostos; linha com sequência inexistente volta em impostos_descartados', async () => {
    const a = ambiente(TENANT_A, doisItens);
    const r = await executar(a.ctx(integrado()));
    expect('impostos' in evento(a)).toBe(false);
    expect('impostos_descartados' in r).toBe(false);
    const b = ambiente(TENANT_A, doisItens);
    const r2 = await executar(b.ctx(integrado({ itens: [{ sequencia: 5, v_ipi_cents: 1 }] })));
    expect(r2.impostos_descartados).toEqual([expect.objectContaining({ indice: 0, sequencia: 5, codigo: 'sequencia_inexistente' })]);
    expect(evento(b).impostos).toEqual({ itens: [] });
  });

  it('RN-INT-08 (ADR 0077): fora de integrado/faturado_* o bloco é ignorado e o retorno vale', async () => {
    const a = ambiente(TENANT_A, doisItens);
    await expect(executar(a.ctx({ ...integrado({ v_ipi_cents: 5, itens: [] }), status: 'rejeitado_erp', numero_erp: undefined, motivo: 'sem estoque' }))).resolves.toMatchObject({ status: 'rejeitado_erp' });
    expect('impostos' in evento(a)).toBe(false);
  });
});
