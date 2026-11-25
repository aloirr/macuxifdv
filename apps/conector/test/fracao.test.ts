import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { cicloPedidos } from '../src/pedidos';
import { compararVersoes, VERSAO_CONECTOR } from '../src/versao';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente;
afterEach(async () => amb?.encerrar());

const UUID = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01';
const PEDIDOS = {
  gravacao: {
    cabecalho: '/*cab*/ INSERT INTO pedido VALUES (:pedido_uuid)',
    itens: '/*item*/ INSERT INTO item VALUES (:pedido_uuid, :sequencia, :quantidade, :fator)',
    numeroErp: '/*num*/ SELECT numero_erp FROM pedido WHERE uuid = :pedido_uuid',
  },
  status: {
    consulta: '/*st*/ SELECT * FROM v WHERE pedido_uuid = :pedido_uuid',
    consultaItensNota: '/*itn*/ SELECT sequencia, quantidade FROM n WHERE nota_numero = :nota_numero',
    mapaStatus: { I: 'integrado', P: 'faturado_parcial', F: 'faturado_total', C: 'cancelado' },
  },
};
const pedido = () =>
  PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'c1', vendedor_external_id: 'v1', condicao_pagamento_erp: '30D',
    criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 1875,
    itens: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1.25, preco_unitario_cents: 1500, total_cents: 1875 }],
  });

async function ate(itensNota: Record<string, unknown>[]) {
  amb = await criarAmbiente({ pedidos: PEDIDOS });
  amb.hub.pedidosParaEntregar = [pedido()];
  const itens: Record<string, unknown>[] = [];
  let gravou = false;
  amb.erp.onExecucao = (sql, p) => {
    if (sql.includes('/*cab*/')) gravou = true;
    if (sql.includes('/*item*/')) itens.push(p);
  };
  amb.erp.onConsulta = (sql) => (sql.includes('/*num*/') ? (gravou ? [{ numero_erp: 'PV-1' }] : []) : undefined);
  await cicloPedidos(amb.ctx);
  amb.erp.onConsulta = (sql) => {
    if (sql.includes('/*st*/')) return [{ status: 'P', numero_erp: 'PV-1', nota_numero: '701', nota_total_cents: 1875, nota_emitida_em: new Date('2026-03-11T10:00:00Z') }];
    if (sql.includes('/*itn*/')) return itensNota;
    return undefined;
  };
  amb.relogio.avancar(120_000);
  await cicloPedidos(amb.ctx);
  const parcial = amb.hub.retornos.find((r) => (r as { status: string }).status === 'faturado_parcial') as Record<string, unknown> | undefined;
  return { itens, parcial };
}

describe('ADR 0076: quantidade fracionária no Conector 1.6.0', () => {
  it('ADR 0076 D6: o Conector anuncia 1.6.0 (a versão que exigeConector pede para pedido com fração)', () => {
    expect(compararVersoes(VERSAO_CONECTOR, '1.6.0')).toBeGreaterThanOrEqual(0);
  });

  it('ADR 0076: grava no ERP a quantidade com casas decimais, intacta, e o fator ausente como nulo', async () => {
    const { itens } = await ate([]);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ quantidade: 1.25, fator: null });
  });

  it('ADR 0076: itens faturados aceitam até 4 casas e somam em escala de 1/10.000 (0,1 + 0,2 = 0,3, sem float)', async () => {
    const { parcial } = await ate([
      { sequencia: 1, quantidade: '0,1', valor_cents: 100, produto_external_id: 'p1' },
      { sequencia: 1, quantidade: 0.2, valor_cents: 200, produto_external_id: 'p1' },
      { sequencia: 1, quantidade: '0.0001', valor_cents: 0, produto_external_id: 'p1' },
    ]);
    expect(parcial?.itens_faturados).toEqual([{ sequencia: 1, produto_external_id: 'p1', quantidade: 0.3001, valor_cents: 300 }]);
  });

  it.each([0.00005, '1.23456', 0, -1])('ADR 0076: quantidade faturada %s (mais de 4 casas, zero ou negativa) omite os itens com motivo claro', async (q) => {
    {
      const { parcial } = await ate([{ sequencia: 1, quantidade: q, valor_cents: 100, produto_external_id: 'p1' }]);
      expect(parcial?.itens_faturados).toBeUndefined();
      expect(amb.logs.join('\n')).toContain('até 4 casas decimais');
    }
  });
});
