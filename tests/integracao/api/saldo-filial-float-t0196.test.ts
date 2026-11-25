/**
 * T-0196 (v1.0.36) — 🔴 do modulo-vendedor 7a798e72f: o Catálogo soma o saldo dos depósitos da filial em float
 * (1,1 + 2,2 = 3.3000000000000003) e o Vendedor subtraía com conta exata, derrubando o push com RangeError.
 * createApp × Postgres (fixture de dois tenants): dois depósitos da filial padrão de A com 1,1 e 2,2 do mesmo produto.
 *
 *   SF-1 pedido inteiro de 3 (≤ 3,3) é aceito e grava 3 (RN-VEN-20: disponível = soma dos depósitos da filial − reservas);
 *   SF-2 limite: 4 (> 3,3) é recusado com RN-VEN-20, nada gravado.
 * ORÁCULO: a regra (soma exata dos saldos do banco = 3,3), nunca a função testada.
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, subirApi, type ApiDeTeste } from '../apoio/api';

const SUF = randomUUID().slice(0, 4).toUpperCase();
const APP_NOVO = { 'x-macuxi-app': 'campo/1.0.36' };

describe.skipIf(semBanco())('T-0196 — saldo da filial somado em float (1,1 + 2,2) no push do pedido', () => {
  let api: ApiDeTeste;
  let token = '';
  const prod = A.produtos.p1;

  const push = async (id: string, quantity: number): Promise<ResultadoItemPush> => {
    const r = await api.chamar(token, {
      method: 'POST',
      url: '/v1/sync/push',
      headers: APP_NOVO,
      payload: {
        itens: [
          {
            entidade: 'pedido',
            id,
            operacao: 'upsert',
            payload: {
              id,
              created_offline_at: new Date().toISOString(),
              customer_id: A.clientes.c1,
              discount_pct: 0,
              items: [{ product_id: prod, quantity }],
            },
          },
        ],
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados[0]!;
  };
  const itens = async (id: string) =>
    (
      await api.admin.query<{ quantidade: string }>(
        'select quantidade::text from vendedor.pedido_item where pedido_id = $1 and deleted_at is null',
        [id],
      )
    ).rows;

  beforeAll(async () => {
    api = await subirApi();
    token = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    const [{ filial } = { filial: '' }] = (
      await api.admin.query<{ filial: string }>(
        "select id::text as filial from core.filial where tenant_id = $1 and codigo = '0001' and deleted_at is null",
        [A.tenantId],
      )
    ).rows;
    expect(filial).not.toBe('');
    // só os dois depósitos novos têm saldo do produto; nenhuma reserva do produto na filial (oráculo: disponível = 1,1 + 2,2 = 3,3)
    await api.admin.query(
      'update catalogo.estoque_saldo set deleted_at = now() where tenant_id = $1 and produto_id = $2 and deleted_at is null',
      [A.tenantId, prod],
    );
    await api.admin.query(
      'update vendedor.pedido_item set deleted_at = now() where tenant_id = $1 and produto_id = $2 and deleted_at is null',
      [A.tenantId, prod],
    );
    for (const [i, q] of [
      [1, '1.1'],
      [2, '2.2'],
    ] as const) {
      const [{ id }] = (
        await api.admin.query<{ id: string }>(
          'insert into catalogo.deposito (tenant_id, codigo, nome, filial_id) values ($1, $2, $3, $4) returning id::text',
          [A.tenantId, `SF${SUF}${i}`, `Depósito SF ${i}`, filial],
        )
      ).rows as [{ id: string }];
      await api.admin.query(
        'insert into catalogo.estoque_saldo (tenant_id, deposito_id, produto_id, quantidade) values ($1, $2, $3, $4)',
        [A.tenantId, id, prod, q],
      );
    }
    const [{ soma }] = (
      await api.admin.query<{ soma: string }>(
        'select sum(s.quantidade)::text as soma from catalogo.estoque_saldo s join catalogo.deposito d on d.id = s.deposito_id where s.tenant_id = $1 and s.produto_id = $2 and d.filial_id = $3 and s.deleted_at is null and d.deleted_at is null',
        [A.tenantId, prod, filial],
      )
    ).rows as [{ soma: string }];
    expect(soma).toBe('3.300');
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
  });

  it('SF-1 RN-VEN-20: pedido inteiro de 3 com saldo 1,1 + 2,2 em dois depósitos da filial = aceito, sem RangeError', async () => {
    const id = randomUUID();
    expect(await push(id, 3)).toMatchObject({ status: 'aceito' });
    expect(await itens(id)).toEqual([{ quantidade: '3.0000' }]);
  });

  it('SF-2 RN-VEN-20: 4 passa do disponível (3,3 − 3 reservado do SF-1) = rejeitado RN-VEN-20, nada gravado', async () => {
    const id = randomUUID();
    expect(await push(id, 4)).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-20' });
    expect(await itens(id)).toEqual([]);
  });
});
