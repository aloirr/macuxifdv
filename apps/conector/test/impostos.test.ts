import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { impostosDasLinhas, reaisParaCentavos } from '../src/impostos';
import { cicloPedidos } from '../src/pedidos';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

describe('ADR 0077: de-para v_icms_st/v_ipi (reais) → *_cents, exato e sem arredondar', () => {
  it('ADR 0077: converte reais com até 2 casas em centavos exatos (sem erro de double)', () => {
    const casos: [unknown, number][] = [[0, 0], ['0', 0], ['0.00', 0], [0.1, 10], [0.29, 29], [1.15, 115], [4.35, 435], ['12,34', 1234], ['19.9', 1990], ['1234567.89', 123456789], [10n, 1000], ['  7.50 ', 750], ['3.4500', 345]];
    for (const [bruto, cents] of casos) expect(reaisParaCentavos(bruto), String(bruto)).toEqual({ tipo: 'valor', cents });
  });

  it('ADR 0077: vazio, nulo e ausente continuam ausentes (nunca viram 0)', () => {
    for (const bruto of [null, undefined, '', '   ']) expect(reaisParaCentavos(bruto)).toEqual({ tipo: 'ausente' });
  });

  it('ADR 0077: fração de centavo, negativo e texto são erro (não arredonda)', () => {
    for (const bruto of [1.005, '0.001', '2.999', -1, '-0.50', 'abc', '1e3', Number.NaN, true]) expect(reaisParaCentavos(bruto).tipo, String(bruto)).toBe('erro');
  });

  it('ADR 0077: linhas da consulta viram o bloco: total na linha sem sequência; campo vazio fica fora; total ausente não soma os itens', () => {
    expect(impostosDasLinhas([{ sequencia: null, v_icms_st: '0.00', v_ipi: null }, { sequencia: 1, v_icms_st: 0, v_ipi: '1.50' }, { SEQUENCIA: 2, V_ICMS_ST: '', V_IPI: 2 }])).toEqual({
      ok: true,
      impostos: { v_icms_st_cents: 0, itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 150 }, { sequencia: 2, v_ipi_cents: 200 }] },
    });
    const semTotal = impostosDasLinhas([{ sequencia: 1, v_icms_st: '3.00', v_ipi: '1.00' }, { sequencia: 2, v_icms_st: '4.00', v_ipi: '2.00' }]);
    expect(semTotal).toEqual({ ok: true, impostos: { itens: [{ sequencia: 1, v_icms_st_cents: 300, v_ipi_cents: 100 }, { sequencia: 2, v_icms_st_cents: 400, v_ipi_cents: 200 }] } });
    expect(impostosDasLinhas([])).toEqual({ ok: true, impostos: undefined });
  });

  it('ADR 0077: valor inválido, sequência inválida ou dois totais invalidam o bloco com a linha e o motivo', () => {
    expect(impostosDasLinhas([{ sequencia: 1, v_icms_st: '1.234' }])).toMatchObject({ ok: false, linha: 1, motivo: expect.stringContaining('v_icms_st') });
    expect(impostosDasLinhas([{ sequencia: 0, v_ipi: 1 }])).toMatchObject({ ok: false, motivo: expect.stringContaining('sequencia') });
    expect(impostosDasLinhas([{ v_ipi: 1 }, { sequencia: '', v_ipi: 2 }])).toMatchObject({ ok: false, linha: 2, motivo: expect.stringContaining('total') });
  });
});

describe('ADR 0077: o retorno ao Hub leva o bloco impostos', () => {
  let amb: Ambiente;
  afterEach(async () => amb?.encerrar());
  const UUID = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01';
  const pedido = PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'c1', vendedor_external_id: 'v1', criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 3000,
    itens: [
      { sequencia: 1, produto_external_id: 'p1', quantidade: 2, preco_unitario_cents: 1000, total_cents: 2000 },
      { sequencia: 2, produto_external_id: 'p2', quantidade: 1, preco_unitario_cents: 1000, total_cents: 1000 },
    ],
  });
  const config = (comImpostos: boolean) => ({
    gravacao: { cabecalho: '/*cab*/ INSERT INTO pedido VALUES (:pedido_uuid)', numeroErp: '/*num*/ SELECT numero_erp FROM pedido WHERE uuid = :pedido_uuid' },
    status: { consulta: '/*st*/ SELECT * FROM v', ...(comImpostos ? { consultaImpostos: '/*imp*/ SELECT sequencia, v_icms_st, v_ipi FROM vi WHERE pedido_uuid = :pedido_uuid' } : {}), mapaStatus: { I: 'integrado', F: 'faturado_total' } },
  });
  async function ciclo(comImpostos: boolean, impostos: () => Record<string, unknown>[]) {
    amb = await criarAmbiente({ pedidos: config(comImpostos) });
    amb.hub.pedidosParaEntregar = [pedido];
    amb.erp.onConsulta = (sql) => (sql.includes('/*num*/') ? [{ numero_erp: 'PV-1' }] : sql.includes('/*imp*/') ? impostos() : sql.includes('/*st*/') ? [] : undefined);
    await cicloPedidos(amb.ctx);
    return amb.hub.retornos as Record<string, unknown>[];
  }

  it('ADR 0077: integrado leva ST e IPI do ERP em centavos (0, ausente e total ausente como vieram)', async () => {
    const [r] = await ciclo(true, () => [{ sequencia: 1, v_icms_st: '0.00', v_ipi: '12.30' }, { sequencia: 2, v_icms_st: '5.10', v_ipi: null }]);
    expect(r).toMatchObject({ status: 'integrado', impostos: { itens: [{ sequencia: 1, v_icms_st_cents: 0, v_ipi_cents: 1230 }, { sequencia: 2, v_icms_st_cents: 510 }] } });
    const imp = r!.impostos as Record<string, unknown> & { itens: Record<string, unknown>[] };
    expect('v_icms_st_cents' in imp || 'v_ipi_cents' in imp).toBe(false);
    expect('v_ipi_cents' in imp.itens[1]!).toBe(false);
  });

  it('ADR 0077: sem consultaImpostos, sem linhas, valor inválido ou ERP com erro: o retorno vai sem o bloco (nada é apagado) e vale', async () => {
    expect('impostos' in (await ciclo(false, () => []))[0]!).toBe(false);
    expect('impostos' in (await ciclo(true, () => []))[0]!).toBe(false);
    const invalido = await ciclo(true, () => [{ sequencia: 1, v_ipi: '0.005' }]);
    expect(invalido[0]).toMatchObject({ status: 'integrado', numero_erp: 'PV-1' });
    expect('impostos' in invalido[0]!).toBe(false);
    expect(amb.logs.join('\n')).toContain('impostos_omitidos');
    const erro = await ciclo(true, () => {
      throw new Error('Invalid object name vi');
    });
    expect(erro[0]).toMatchObject({ status: 'integrado' });
    expect('impostos' in erro[0]!).toBe(false);
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'gravado' });
  });
});
