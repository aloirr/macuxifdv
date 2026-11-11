/**
 * T-0149 (RN-CORE-39): filial do pedido em `ent_pedido.dados`, sem DDL; especificação em docs/banco/aparelho-sqlite.md §4.5.
 */
import { describe, expect, it } from 'vitest';
import { criarArmazenamentoSqlite, listarObjetos, type LinhaSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { PedidoSyncSchema, type PedidoSync } from '../../modules/vendedor/contracts/sync';
import { ordemDoPedido } from '../../modules/vendedor/app/lib/pull';

const QUANDO = '2026-11-10T12:00:00.000000Z';
const FILIAL_ID = '0f490000-0000-4000-8000-000000000002';

function pedido(id: string, extra: Partial<PedidoSync> = {}): PedidoSync {
  return {
    id,
    updated_at: QUANDO,
    deleted_at: null,
    external_id: null,
    cliente_id: '00000003-0000-4000-8000-000000000001',
    vendedor_id: '00000005-0000-4000-8000-000000000001',
    autor_id: '00000005-0000-4000-8000-000000000001',
    status: 'approved',
    condicao_pagamento: null,
    desconto_pct: 0,
    total_tabela_cents: 10_000,
    total_cents: 10_000,
    observacao: null,
    visita_id: null,
    rota_parada_id: null,
    criado_no_aparelho_em: QUANDO,
    recebido_em: QUANDO,
    numero_erp: null,
    motivo_cancelamento: null,
    created_at: QUANDO,
    numero: 'P-1',
    ...extra,
  };
}

function abrir() {
  const driver = criarDriverNode();
  const a = criarArmazenamentoSqlite(driver, {
    migracoesModulos: {},
    entidades: [{ nome: 'pedido', modulo: 'vendedor' }],
    agora: () => new Date('2026-11-10T12:00:00.000Z'),
  });
  return { driver, a };
}

describe('aparelho: filial do pedido (T-0149, RN-CORE-39) em ent_pedido.dados, sem DDL', () => {
  it('RN-CORE-39: o pull grava filial_id e o retrato filial no JSON; a leitura passa no contrato estrito e vira branch_id/branch_name', async () => {
    const { driver, a } = abrir();
    const comFilial = pedido('00000006-0000-4000-8000-000000000001', {
      filial_id: FILIAL_ID,
      filial: { id: FILIAL_ID, codigo: '0002', nome: 'Boa Vista', cidade: 'Boa Vista', uf: 'RR', external_id: 'F2', padrao: false },
    });
    const anterior = pedido('00000006-0000-4000-8000-000000000002', { filial_id: null, filial: null });
    const semCampo = pedido('00000006-0000-4000-8000-000000000003'); // pedido de servidor/linha anterior à 0056
    await a.linhas.aplicar('pedido', [comFilial, anterior, semCampo] as unknown as LinhaSync[], `${QUANDO}|${semCampo.id}`);

    // a tabela é a genérica do SDK: nenhuma coluna nova, nenhum objeto do Vendedor
    const colunas = (await driver.todas<{ name: string }>('PRAGMA table_info(ent_pedido)')).map((c) => c.name);
    expect(colunas).toEqual(['id', 'updated_at', 'deleted_at', 'dados']);
    expect((await listarObjetos(driver)).filter((o) => o.name.startsWith('vendedor__'))).toEqual([]);

    // o campo está no JSON com o nome do contrato (consultável por json_extract, se um dia precisar de índice)
    const bruto = await driver.primeira<{ fid: string; cod: string }>(
      "SELECT json_extract(dados, '$.filial_id') AS fid, json_extract(dados, '$.filial.codigo') AS cod FROM ent_pedido WHERE id = ?",
      [comFilial.id],
    );
    expect(bruto).toEqual({ fid: FILIAL_ID, cod: '0002' });

    const lidas = await a.linhas.porIds<PedidoSync & LinhaSync>('pedido', [comFilial.id, anterior.id, semCampo.id]);
    expect(lidas).toHaveLength(3);
    for (const l of lidas) expect(PedidoSyncSchema.safeParse(l).success).toBe(true);
    expect(lidas[0]).toEqual(comFilial);

    const [o1, o2, o3] = lidas.map((l) => ordemDoPedido(l, [], {}));
    expect(o1).toMatchObject({ branch_id: FILIAL_ID, branch_name: '0002 · Boa Vista/RR' });
    expect(o2).toMatchObject({ branch_id: null, branch_name: null });
    expect(o3).toMatchObject({ branch_id: null, branch_name: null });
    await a.fechar?.();
  });
});
