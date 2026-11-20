/**
 * v1.0.17, valor × regra do % do prazo gravado no orçamento (RN-VEN-43, RN-VEN-44; retrato da RN-VEN-45), createApp × Postgres.
 *
 * Contrato esperado (PR do modulo-vendedor):
 * - o pull `pedido` leva `prazo_percentual_ajuste` (o retrato gravado) e `PedidoSyncSchema` o aceita;
 * - `detalheDoPedido` (app) devolve esse `prazo_percentual_ajuste`;
 * - `PUT /v1/vendedor/orcamentos/:id` (a edição do aparelho, sem `created_offline_at`) com o % gravado é aceito.
 * Matriz: `docs/testes/v1017-orcamento-pct-gravado.md`.
 */
import { PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../../../modules/catalogo/contracts';
import { precosCongeladosDoOrcamento } from '../../../modules/vendedor/app/lib/documento';
import { calcularPedido, type ProdutoComMinimo } from '../../../modules/vendedor/app/lib/novo-pedido';
import { detalheDoPedido, politicaApi, type LinhasVendedor } from '../../../modules/vendedor/app/lib/pull';
import { PedidoSyncSchema, type PedidoItemSync, type PedidoSync } from '../../../modules/vendedor/contracts/sync';
import { percentualAjusteParaBp } from '../../../modules/vendedor/domain/preco-pedido';
import { regra } from '../../modulos/apoio/oraculo-prazo';
import { A, puxarTudo, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

const PA = PAGAMENTO_FIXTURE.A;
const ORC = '0f101700-0000-4000-8000-000000000001';
const CONTROLE = '0f101700-0000-4000-8000-000000000002';
const QTD = 3;
const GRAVADO = 2.5;
const NO_ERP = 4;

describe.skipIf(semBanco())('v1.0.17 % do prazo gravado no orçamento: aparelho e API usam o % gravado (RN-VEN-43/44)', () => {
  let api: ApiDeTeste;
  let token = '';
  let prod = '';
  /** Tabela pura do produto (orçamento de controle no PIX, 0%) e o que o orçamento gravou. */
  let pura = 0;
  let gravado = { unit: 0, total: 0 };
  let pull: { pedido?: LinhaSync & PedidoSync; itens: PedidoItemSync[] } = { itens: [] };

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const corpo = (forma: string, prazo: string, pct: number) => ({
    customer_id: A.clientes.c1,
    discount_pct: 0,
    payment_terms: 'Boleto',
    items: [{ product_id: prod, quantity: QTD }],
    forma_pagamento_id: forma,
    prazo_pagamento_id: prazo,
    prazo_percentual_ajuste: pct,
  });
  const orcamento = async (id: string, forma: string, prazo: string, pct: number) => {
    const payload = { id, tipo: 'orcamento', created_offline_at: new Date().toISOString(), ...corpo(forma, prazo, pct) };
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens: [{ entidade: 'pedido', id, operacao: 'upsert', payload }] } });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as { resultados: ResultadoItemPush[] }).resultados[0], r.body).toMatchObject({ status: 'aceito' });
  };
  const doBanco = async (id: string) => {
    const [p] = await q<{ total_cents: number; pct: number | null; atualizado: string }>(
      `select total_cents::float8 as total_cents, prazo_percentual_ajuste::float8 as pct, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as atualizado from vendedor.pedido where id = $1`,
      [id],
    );
    const [i] = await q<{ unit: number }>('select preco_tabela_cents::float8 as unit from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [id]);
    return { ...p!, unit: i!.unit };
  };

  beforeAll(async () => {
    api = await subirApi();
    token = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    prod = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    await q('update vendedor.prazo_pagamento set percentual_ajuste = $2 where id = $1', [PA.prazos.bol2856, GRAVADO]);
    await orcamento(CONTROLE, PA.formas.pix, PA.prazos.pixAvista, 0);
    await orcamento(ORC, PA.formas.boleto, PA.prazos.bol2856, GRAVADO);
    pura = (await doBanco(CONTROLE)).unit;
    const o = await doBanco(ORC);
    gravado = { unit: o.unit, total: o.total_cents };
    // o ERP muda o % do prazo depois do orçamento (Integração, RN-VEN-46)
    await q('update vendedor.prazo_pagamento set percentual_ajuste = $2 where id = $1', [PA.prazos.bol2856, NO_ERP]);
    await esperarHorizonte();
    pull = {
      pedido: (await puxarTudo<PedidoSync>(api, token, 'pedido')).find((p) => p.id === ORC),
      itens: (await puxarTudo<PedidoItemSync>(api, token, 'pedido_item')).filter((i) => i.pedido_id === ORC),
    };
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('RN-VEN-43: o orçamento grava +2,50% e a tabela ajustada por ele: unitário = regra(pura, 250), total = unitário × 3', async () => {
    expect(pura).toBeGreaterThan(0);
    expect((await doBanco(ORC)).pct).toBe(GRAVADO);
    expect(gravado).toEqual({ unit: regra(pura, 250), total: regra(pura, 250) * QTD });
    // contraprova: com o % do ERP o unitário seria outro (o ensaio só tem sentido se os dois diferem)
    expect(regra(pura, 400)).not.toBe(gravado.unit);
  });

  it('contrato (PR do vendedor): o pull do orçamento traz o % gravado (+2,50), não o do ERP (+4,00)', () => {
    expect(pull.pedido, 'orçamento no pull do vendedor').toBeDefined();
    expect(PedidoSyncSchema.parse(pull.pedido)).toMatchObject({ prazo_percentual_ajuste: GRAVADO });
  });

  it('aparelho: o detalhe do orçamento leva o % gravado e o cálculo da edição mantém o preço final (= regra)', () => {
    const linhas = { pedidos: pull.pedido ? [pull.pedido] : [], itens: pull.itens, eventos: [], clientes: [], tabelasPreco: [] } as unknown as LinhasVendedor;
    const det = detalheDoPedido(linhas, ORC, 'vendedor', {});
    expect(det).toMatchObject({ prazo_percentual_ajuste: GRAVADO });
    const bp = percentualAjusteParaBp((det as { prazo_percentual_ajuste?: number } | null)?.prazo_percentual_ajuste);
    const produto = { id: prod, erp_code: 'ALFA-001', description: 'ALFA-001', unit: 'UN', price_cents: pura, stock_total: 1_000, stock: [], active: true, preco_venda_cents: pura, desconto_maximo_pct: 100 } as unknown as Product as ProdutoComMinimo;
    const tela = calcularPedido({ lines: { [prod]: QTD }, ajustes: {}, desconto_pct: 0, acrescimo_pct: 0, catalogo: [produto], unidades: [], politica: politicaApi({}), vendedor_id: A.usuarios.vendedor1, percentual_ajuste_bp: bp, congelados: precosCongeladosDoOrcamento(det, undefined, []), congelados_bp: bp });
    expect([tela.linhas[0]?.preco_unitario_cents, tela.total_cents]).toEqual([gravado.unit, gravado.total]);
  });

  it('API: a edição do aparelho (PUT, sem created_offline_at) com o % gravado é aceita, mantém o % e o preço final', async () => {
    const r = await api.chamar(token, { method: 'PUT', url: `/v1/vendedor/orcamentos/${ORC}`, payload: { ...corpo(PA.formas.boleto, PA.prazos.bol2856, GRAVADO), atualizado_em: (await doBanco(ORC)).atualizado } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ total_cents: gravado.total });
    expect(await doBanco(ORC)).toMatchObject({ pct: GRAVADO, unit: gravado.unit, total_cents: gravado.total });
  });
});
