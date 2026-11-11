/**
 * T-0155 — demo com 3 pedidos faturados (p01 Faturado, p08 Faturado parcial, p02 Faturado com devolução parcial), vistos
 * pelo que o usuário enxerga: API do BKO (detalhe do analista), aparelho do Lucas e da Camila (pull real) e painel de
 * Metas do aparelho. Base demo (`carregarDemo`) × `createApp` real × Postgres; roda no CI (sem Docker no PC).
 *
 * O conteúdo do seed (notas, itens, marcos, fila do ERP, eventos do Gestor) é do teste do banco-dados
 * (db/testes/seed-demo.test.ts); aqui só o ponta a ponta e a meta (critérios 2 e 3), sem repetir aquele teste.
 *  F1 BKO: status, faturado, devolvido e a linha do tempo "Enviado → Integrado → Faturado" com autor ERP;
 *  F2 aparelho: o pull leva o status e os valores faturado/devolvido às linhas de pedido do Lucas e da Camila;
 *  F3 contagens: approved cai para 3 e os 11 pedidos continuam (nenhum some);
 *  F4 RN-CORE-21 (meta de pedido, base aprovado): o realizado do mês no painel do aparelho = Σ dos pedidos aprovados,
 *     integrados ou faturados do Lucas com emissão no mês (fuso do tenant), com o p01/p02 faturados pelo TOTAL do pedido.
 * Matriz: docs/testes/T-0155.md.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { OrderDetail } from '@macuxi/vendedor/contracts';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FATURAMENTOS_DEMO, idPedidoDemo } from '../../../db/seeds/demo/demo';
import { dataLocal } from '../../../modules/core/domain';
import { etapasCore } from '../../../modules/core/app/lib/cargas';
import { entidadesMeta } from '../../../modules/core/app/lib/entidades-meta';
import { painelLocal } from '../../../modules/core/app/lib/metas-local';
import { etapasVendedor } from '../../../modules/vendedor/app/etapas';
import { aparelhoCampo, esperarHorizonte, gpsDeTeste } from '../apoio/campo';
import { DEMO, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

const gps = gpsDeTeste();
const ETAPAS_CAMPO = [...etapasCore, ...etapasVendedor];
const FUSO = 'America/Manaus';
const STATUS_APROVADO = ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced']; // RN-CORE-21: aprovado, integrado, faturado

/**
 * D-T0155a fechado: o modulo-vendedor ligou a devolução (DEVOLUCAO_LIGADA, devolvido_cents no detalhe, na lista e no pull). As asserções
 * de devolução do p02 valem como `it` (eram it.fails enquanto a chave estava desligada; R-20261110-152849 item 5).
 */

type LinhaPedido = LinhaSync & { status: string; vendedor_id: string; total_cents: number; faturado_cents?: number | null; devolvido_cents?: number | null; criado_no_aparelho_em: string | null; recebido_em: string | null; created_at: string; tipo?: string | null };

describe.skipIf(semBanco())('T-0155 — demo com 3 pedidos faturados (BKO, aparelho e meta)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  const P = { p01: idPedidoDemo('p01'), p08: idPedidoDemo('p08'), p02: idPedidoDemo('p02') };

  const detalhe = async (id: string) => {
    const r = await api.get(token.analista, `/v1/vendedor/pedidos/${id}`);
    expect(r.status, JSON.stringify(r.corpo)).toBe(200);
    return OrderDetail.parse(r.corpo);
  };
  /** A sequência `esperada` aparece na linha do tempo, na ordem (outros eventos podem vir no meio). */
  const contemEmOrdem = (feito: string[], esperada: string[]) => {
    let i = 0;
    for (const s of feito) if (s === esperada[i]) i += 1;
    return i === esperada.length;
  };
  const pull = async (chave: ChaveDemo) => {
    const ap = await aparelhoCampo(api, DEMO[chave], { etapas: ETAPAS_CAMPO, entidadesExtras: entidadesMeta, posicaoAgora: gps.posicaoAgora });
    expect(await ap.sincronizar()).toBe(true);
    return ap;
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    await esperarHorizonte();
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('o seed escolheu os 3 da tarefa (p01 total, p08 parcial, p02 com devolução)', () => {
    expect(Object.keys(FATURAMENTOS_DEMO).sort()).toEqual(['p01', 'p02', 'p08']);
    expect(FATURAMENTOS_DEMO.p08!.parcial).toBeTruthy();
    expect(FATURAMENTOS_DEMO.p02!.devolucao).toBeTruthy();
  });

  it('F1. BKO (analista): p01 Faturado pelo total, p08 Faturado parcial (0 < faturado < total), p02 Faturado pelo total; linha do tempo Enviado → Integrado → Faturado pelo ERP', async () => {
    const p01 = await detalhe(P.p01);
    expect(p01.status).toBe('invoiced');
    expect(p01.faturado_cents).toBe(p01.total_cents);
    expect(p01.devolvido_cents ?? 0).toBe(0);
    expect(contemEmOrdem(p01.history.map((e) => e.status), ['approved', 'sent_to_erp', 'integrated', 'invoiced'])).toBe(true);
    expect(p01.history.filter((e) => ['sent_to_erp', 'integrated', 'invoiced'].includes(e.status)).every((e) => e.by === 'ERP')).toBe(true);
    expect(p01.faturamento?.notas).toHaveLength(1);

    const p08 = await detalhe(P.p08);
    expect(p08.status).toBe('invoiced_partial');
    expect(p08.faturado_cents).toBeGreaterThan(0);
    expect(p08.faturado_cents!).toBeLessThan(p08.total_cents);
    expect(p08.faturamento?.notas.map((n) => n.parcial)).toEqual([true]);
    expect(contemEmOrdem(p08.history.map((e) => e.status), ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial'])).toBe(true);

    const p02 = await detalhe(P.p02);
    expect(p02.status).toBe('invoiced'); // RN-VEN-37: a devolução não muda o status
    expect(p02.faturado_cents).toBe(p02.total_cents);
  });

  it('F1-dev (D-T0155a). BKO (analista): p02 com devolução parcial — 0 < devolvido < total, devolução "parcial" e 1 nota de devolução com o mesmo valor', async () => {
    const p02 = await detalhe(P.p02);
    expect(p02.devolvido_cents).toBeGreaterThan(0);
    expect(p02.devolvido_cents!).toBeLessThan(p02.total_cents);
    expect(p02.devolucao).toBe('parcial');
    expect(p02.faturamento?.devolucoes).toHaveLength(1);
    expect(p02.faturamento?.devolucoes[0]!.total_cents).toBe(p02.devolvido_cents);
  });

  it('F2. Aparelho: o pull leva status e faturado às linhas do Lucas (p01, p02) e da Camila (p08)', async () => {
    const lucas = await (await pull('vendedor')).motor.linhas<LinhaPedido>('pedido');
    const p01 = lucas.find((p) => p.id === P.p01)!;
    const p02 = lucas.find((p) => p.id === P.p02)!;
    expect([p01.status, p02.status]).toEqual(['invoiced', 'invoiced']);
    expect(p01.faturado_cents).toBe(p01.total_cents);
    expect(lucas.some((p) => p.id === P.p08), 'o p08 é da Camila, não chega ao Lucas').toBe(false);
    const camila = await (await pull('vendedor2')).motor.linhas<LinhaPedido>('pedido');
    const p08 = camila.find((p) => p.id === P.p08)!;
    expect(p08.status).toBe('invoiced_partial');
    expect(p08.faturado_cents!).toBeLessThan(p08.total_cents);
  });

  it('F2-dev (D-T0155a). Aparelho: o pull leva o devolvido do p02 à linha do Lucas (0 < devolvido < total)', async () => {
    const lucas = await (await pull('vendedor')).motor.linhas<LinhaPedido>('pedido');
    const p02 = lucas.find((p) => p.id === P.p02)!;
    expect(p02.devolvido_cents).toBeGreaterThan(0);
    expect(p02.devolvido_cents!).toBeLessThan(p02.total_cents);
  });

  it('F3. Contagens da base: 3 approved (p03, p04, p11), 2 invoiced e 1 invoiced_partial; os 11 pedidos continuam', async () => {
    const r = await api.admin.query<{ status: string; n: number }>(
      "select status, count(*)::int n from vendedor.pedido where tenant_id = $1 and deleted_at is null and coalesce(tipo, 'pedido') = 'pedido' group by status",
      [TENANT_DEMO],
    );
    const por = Object.fromEntries(r.rows.map((x) => [x.status, x.n]));
    expect(por).toMatchObject({ approved: 3, invoiced: 2, invoiced_partial: 1 });
    expect(Object.values(por).reduce((s, n) => s + n, 0)).toBe(11);
    const aprovados = await api.admin.query<{ id: string }>("select id from vendedor.pedido where tenant_id = $1 and status = 'approved' and deleted_at is null", [TENANT_DEMO]);
    expect(aprovados.rows.map((x) => x.id).sort()).toEqual(['p03', 'p04', 'p11'].map(idPedidoDemo).sort());
  });

  it('F4. RN-CORE-21: o realizado do mês do Lucas no painel do aparelho = Σ dos pedidos aprovados/integrados/faturados emitidos no mês (o faturado conta o total)', async () => {
    const ap = await pull('vendedor');
    const m = ap.motor;
    const [paradas, visitas, diarios, metas, pedidos] = await Promise.all([m.linhas('rota_parada'), m.linhas('visita'), m.linhas('indicador_diario'), m.linhas('meta'), m.linhas<LinhaPedido>('pedido')]);
    const agora = new Date();
    const painel = painelLocal({ paradas, visitas, diarios, metas } as never, m.sobreposicao(), { usuarioId: usuarioId.vendedor, fuso: FUSO, agora });
    const mes = dataLocal(agora, FUSO).slice(0, 7);
    const emissao = (p: LinhaPedido) => dataLocal(new Date(p.criado_no_aparelho_em ?? p.recebido_em ?? p.created_at), FUSO);
    const esperado = pedidos
      .filter((p) => p.vendedor_id === usuarioId.vendedor && (p.tipo ?? 'pedido') === 'pedido' && STATUS_APROVADO.includes(p.status) && emissao(p).startsWith(mes))
      .reduce((s, p) => s + p.total_cents, 0);
    expect(painel.indicadores.realizado_cents).toBe(esperado);
  });
});
