import { describe, expect, it } from 'vitest';
import { montarInsertPedido, montarUpdatePedido, type ColunaPedido } from './colunas-pedido';

const colunas: ColunaPedido[] = [
  ['status', 'approved'],
  ['cliente_resumo', '{}', 'jsonb'],
  ['motivos_aprovacao', ['a'], 'text[]'],
  ['prazo_parcelas_dias', [28], 'int[]'],
];

describe('T-0184: colunas do pedido no insert e no reenvio', () => {
  it('insert e update usam as mesmas colunas, com casts e placeholders na ordem', () => {
    const up = montarUpdatePedido('p1', colunas, 3);
    const ins = montarInsertPedido({ id: 'p1', cliente_id: 'c', vendedor_id: 'v', autor_id: 'a', numero: 'N1' }, colunas);
    expect(up.sql).toBe(
      'update vendedor.pedido set status = $2, cliente_resumo = $3::jsonb, motivos_aprovacao = $4::text[], prazo_parcelas_dias = $5::int[], aprovacao_ciclo = $6, decidido_por_id = null, decidido_em = null, motivo_rejeicao = null where id = $1',
    );
    expect(up.valores).toEqual(['p1', 'approved', '{}', ['a'], [28], 3]);
    expect(ins.sql).toBe(
      'insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, numero, status, cliente_resumo, motivos_aprovacao, prazo_parcelas_dias) values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7::jsonb, $8::text[], $9::int[]) on conflict (id) do nothing returning id',
    );
    expect(ins.valores).toEqual(['p1', 'c', 'v', 'a', 'N1', 'approved', '{}', ['a'], [28]]);
  });
});
