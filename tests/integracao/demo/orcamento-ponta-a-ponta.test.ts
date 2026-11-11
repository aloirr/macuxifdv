/**
 * T-0071 (fatia 8, desenho docs/desenho/T-0071.md §1.5, §2.1, §3 e §7) — orçamento de ponta a ponta na BASE DEMO com o
 * `createApp` REAL (8 módulos, JWT, Postgres como `macuxi_app`, RLS) e o MOTOR DE SYNC real do app (aparelho em memória).
 * Matriz: docs/testes/T-0071.md (casos P1, P2, P3, P5, O1..O9).
 *
 *  O1 referência (R-20261103-130003): Lucas, Mini Box Japiim (C5110), AGU-500 3 FD com 5%, CAF-500 12 UN com R$ 1,00 por
 *     unidade, BIS-400 1 CX e 1% no pedido, criado OFFLINE (modo avião) → reconecta → o servidor recalcula tudo:
 *     tabela 39830, descontos nos itens 1467, desconto do pedido 384, total 37979, efetivo 4,65 (exibido 4,6%), dentro da
 *     alçada (RN-VEN-02/03/10/15/30). Orçamento não publica vendedor.pedido.* (RN-INT-08, RN-VEN-32) e NÃO conta na meta
 *     (RN-CORE-21).
 *  O2 o pull leva o orçamento ao aparelho (tipo, validade, medida e modo do ajuste) e o reenvio é idempotente (RN-VEN-33).
 *  O3 Transformar (RN-VEN-18): o aparelho monta o pedido NOVO pelo domain (`pedidoDoOrcamento`, UUID do aparelho,
 *     `orcamento_origem_id`) → mesmo total, aprovado sem alçada, publica criado/aprovado e PASSA a contar na meta pela data
 *     de emissão do pedido novo; o orçamento fica `convertido` e não vira outro pedido.
 *  O4–O7 `PUT /v1/vendedor/orcamentos/:id` e `POST .../cancelar`: edição com a referência (37979), concorrência otimista
 *     (RN-VEN-33: corpo diferente com atualizado_em antigo = 409 ORCAMENTO_ALTERADO; corpo idêntico ao último = repetição, 200 sem
 *     mudar nada), troca de cliente (422), cancelar idempotente, convertido/cancelado = 422 RN-VEN-18; O7 (RN-VEN-18/32 de
 *     09/11, T-0141 G): o orçamento não vence; passados os 7 dias do preço, Transformar e PUT reprecificam pela tabela do dia.
 *  O8 regra 7 / RN-PRO-01: o promotor não cria nem edita pedido ou orçamento (push, PUT e cancelar), com e sem o Vendedor
 *     licenciado ao perfil; nada é gravado.
 *  O9 multi-tenant (base demo + fixture dois-tenants no mesmo banco): o tenant A não lê, não edita, não cancela nem
 *     converte o orçamento da demo; outro vendedor do mesmo tenant também não (404, sem revelar).
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pedidoDoOrcamento, type OrcamentoParaPedido } from '../../../modules/vendedor/domain';
import { A, licenca } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, garantirSaldoNaFilial, listaDe, SALDO_REFERENCIA, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

type Linha = LinhaSync & Record<string, unknown>;
interface Banco {
  id: string;
  tipo: string;
  status: string;
  numero: string | null;
  tenant_id: string;
  orcamento_id: string | null;
  orcamento_validade: string | null;
  nivel_aprovacao: string | null;
  total_tabela_cents: number;
  total_cents: number;
  desconto_pct: number;
  desconto_efetivo_pct: number;
  ajuste_em: string | null;
}
interface ItemBanco {
  produto_sku: string;
  unidade: string;
  quantidade: number;
  preco_tabela_cents: number;
  preco_unitario_cents: number;
  desconto_unitario_cents: number | null;
  total_cents: number;
  deleted_at: string | null;
}

describe.skipIf(semBanco())('T-0071 — orçamento de ponta a ponta: offline → servidor → Transformar → pedido; PUT e cancelar; promotor e tenants (base demo × createApp real × motor de sync)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  let tokenA = '';
  let lucas: AparelhoCampo;
  const prod: Record<'AGU' | 'CAF' | 'BIS' | 'ALFA', string> = { AGU: '', CAF: '', BIS: '', ALFA: '' };
  let miniBox = '';
  let outroCliente = '';
  let cond28 = '';
  /** Orçamento da referência (O1–O3) e o pedido que nasce dele. */
  const ORC = randomUUID();
  const PED = randomUUID();
  let itemOrcamento: ItemPush;

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await api.admin.query(sql, p)).rows as T[];
  const noBanco = async (pid: string) =>
    (
      await q<Banco & Record<string, unknown>>(
        `select id, tipo, status, numero, tenant_id, orcamento_id, orcamento_validade::text, nivel_aprovacao, total_tabela_cents::float8 as total_tabela_cents,
                total_cents::float8 as total_cents, desconto_pct::float8 as desconto_pct, desconto_efetivo_pct::float8 as desconto_efetivo_pct, ajuste_em
           from vendedor.pedido where id = $1`,
        [pid],
      )
    )[0];
  const itensNoBanco = (pid: string, vivos = true) =>
    q<ItemBanco & Record<string, unknown>>(
      `select produto_sku, unidade, quantidade::int as quantidade, preco_tabela_cents::float8 as preco_tabela_cents, preco_unitario_cents::float8 as preco_unitario_cents,
              desconto_unitario_cents::float8 as desconto_unitario_cents, total_cents::float8 as total_cents, deleted_at::text
         from vendedor.pedido_item where pedido_id = $1 ${vivos ? 'and deleted_at is null' : ''} order by sequencia`,
      [pid],
    );
  const eventos = (pid: string) => q<{ nome: string }>("select nome from plataforma.evento where agregado_id = $1 or payload->>'pedido_id' = $1::text order by created_at", [pid]);
  const push = async (tk: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;
  /** Realizado de venda do Lucas no mês (GET /v1/core/indicadores, base "aprovado", RN-CORE-21). */
  const realizadoDoLucas = async (): Promise<number> => {
    const r = await api.chamar(token.vendedor, { method: 'GET', url: `/v1/core/indicadores?usuario_id=${usuarioId.vendedor}` });
    expect(r.statusCode, r.body).toBe(200);
    const it = (r.json() as { itens: Array<{ usuario_id: string; indicadores: { realizado_cents?: number | null } }> }).itens.find((i) => i.usuario_id === usuarioId.vendedor);
    expect(it, 'Lucas no painel de metas').toBeDefined();
    return Number(it!.indicadores.realizado_cents ?? 0);
  };
  /** Itens da referência (mesma composição da tela; o ajuste do café em R$ por UNIDADE vendida). */
  const itensReferencia = () => [
    { product_id: prod.AGU, quantity: 3, unidade: 'FD', desconto_pct: 5, ajuste_em: 'pct' },
    { product_id: prod.CAF, quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' },
    { product_id: prod.BIS, quantity: 1, unidade: 'CX' },
  ];
  const cabecalhoReferencia = () => ({ customer_id: miniBox, discount_pct: 1, ajuste_em: 'pct', payment_terms: '28 dias', condicao_pagamento_id: cond28 });
  /** `payload` do ItemPush é `unknown` no SDK: aqui é sempre um objeto (o spread nos casos O6 e O8 precisa disso). */
  const orcamento = (pid: string, extra: Record<string, unknown> = {}): ItemPush & { payload: Record<string, unknown> } => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, tipo: 'orcamento', ...cabecalhoReferencia(), created_offline_at: new Date().toISOString(), items: itensReferencia(), ...extra },
  });
  /** Os números da referência, conferidos no banco (desenho §3.2). */
  const conferirReferencia = async (pid: string, tipo: 'orcamento' | 'pedido') => {
    const p = await noBanco(pid);
    expect(p, `${tipo} ${pid} gravado`).toBeDefined();
    expect(p).toMatchObject({ tipo, tenant_id: TENANT_DEMO, total_tabela_cents: 39830, total_cents: 37979, desconto_pct: 1, nivel_aprovacao: null });
    expect(p!.desconto_efetivo_pct, 'efetivo gravado 4,65 (exibido 4,6%)').toBeCloseTo(4.65, 2);
    expect(Math.floor(p!.desconto_efetivo_pct * 10) / 10).toBe(4.6);
    const it = await itensNoBanco(pid);
    expect(it.map((i) => [i.produto_sku, i.unidade, i.quantidade, i.preco_tabela_cents, i.preco_unitario_cents])).toEqual([
      ['AGU-500', 'FD', 3, 1790, 1701], // 17,90 → 17,01 (5%, meia para cima no unitário)
      ['CAF-500', 'UN', 12, 1890, 1790], // 18,90 → 17,90 (R$ 1,00 por unidade)
      ['BIS-400', 'CX', 1, 11780, 11780], // CX c/ 20 = 5,89 × 20
    ]);
    expect(Number(it[1]!.desconto_unitario_cents), 'R$ 1,00 por unidade gravado').toBe(100);
    const tabela = it.reduce((s, i) => s + i.preco_tabela_cents * i.quantidade, 0);
    const itens = it.reduce((s, i) => s + i.preco_unitario_cents * i.quantidade, 0);
    expect(tabela).toBe(39830);
    expect(tabela - itens, 'descontos nos itens R$ 14,67').toBe(1467);
    expect(itens - 37979, 'desconto do pedido 1% = R$ 3,84').toBe(384);
    expect(it.map((i) => i.total_cents), 'rateio do desconto do pedido pelo maior resto').toEqual([5052, 21265, 11662]);
    return { p: p!, it };
  };
  /** Orçamento do aparelho → `OrcamentoParaPedido` (o que a tela lê das linhas locais para Transformar/Duplicar). */
  const doAparelho = async (ap: AparelhoCampo, pid: string): Promise<OrcamentoParaPedido> => {
    const p = (await ap.motor.linhas<Linha>('pedido')).find((l) => l.id === pid && !l.deleted_at);
    expect(p, 'orçamento no aparelho').toBeDefined();
    const itens = (await ap.motor.linhas<Linha>('pedido_item')).filter((i) => i.pedido_id === pid && !i.deleted_at).sort((a, b) => Number(a.sequencia) - Number(b.sequencia));
    const n = (v: unknown) => (v == null ? undefined : Number(v));
    const s = <T extends string>(v: unknown) => (v == null ? undefined : (String(v) as T));
    return {
      id: pid,
      cliente_id: String(p!.cliente_id),
      desconto_pct: Number(p!.desconto_pct ?? 0),
      acrescimo_pct: n(p!.acrescimo_pct),
      desconto_valor_cents: n(p!.desconto_valor_cents),
      acrescimo_valor_cents: n(p!.acrescimo_valor_cents),
      ajuste_em: s<'pct' | 'valor'>(p!.ajuste_em),
      condicao_pagamento_id: (p!.condicao_pagamento_id as string | null) ?? null,
      observacao: (p!.observacao as string | null) ?? null,
      visita_id: (p!.visita_id as string | null) ?? null,
      frete: p!.frete_modalidade === 'CIF' ? { modalidade: 'CIF' } : undefined,
      endereco_entrega_id: (p!.endereco_entrega_id as string | null) ?? undefined,
      itens: itens.map((i) => ({
        product_id: String(i.produto_id),
        quantity: Number(i.quantidade),
        unidade: s(i.unidade),
        desconto_pct: n(i.desconto_pct),
        acrescimo_pct: n(i.acrescimo_pct),
        desconto_unitario_cents: n(i.desconto_unitario_cents),
        acrescimo_unitario_cents: n(i.acrescimo_unitario_cents),
        ajuste_em: s<'pct' | 'valor'>(i.ajuste_em),
      })),
    };
  };
  const linhaNoAparelho = async (ap: AparelhoCampo, pid: string) => (await ap.motor.linhas<Linha>('pedido')).find((l) => l.id === pid);
  const sincronizarComHorizonte = async (ap: AparelhoCampo) => {
    await esperarHorizonte();
    expect(await ap.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
  };
  const put = (tk: string, pid: string, corpo: object) => api.chamar(tk, { method: 'PUT', url: `/v1/vendedor/orcamentos/${pid}`, payload: corpo });
  const cancelar = (tk: string, pid: string, motivo = 'teste T-0071') => api.chamar(tk, { method: 'POST', url: `/v1/vendedor/orcamentos/${pid}/cancelar`, payload: { motivo } });
  const corpoPut = (atualizado_em: string, extra: Record<string, unknown> = {}) => ({ ...cabecalhoReferencia(), items: itensReferencia(), atualizado_em, ...extra });

  beforeAll(async () => {
    api = await subirApiDemo({ comDoisTenants: true });
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    tokenA = (await api.sessaoNoTenant(A, 'vendedor@exemplo.com.br')).access_token;
    const produtos = await q<{ sku: string; id: string }>("select sku, id from core.produto where tenant_id = $1 and sku in ('AGU-500', 'CAF-500', 'BIS-400') and deleted_at is null", [TENANT_DEMO]);
    for (const p of produtos) prod[p.sku.slice(0, 3) as 'AGU' | 'CAF' | 'BIS'] = p.id;
    prod.ALFA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    expect([prod.AGU, prod.CAF, prod.BIS].every(Boolean), 'AGU-500, CAF-500 e BIS-400 na base demo').toBe(true);
    miniBox = (await q<{ id: string }>("select id from core.cliente where tenant_id = $1 and external_id = 'C5110'", [TENANT_DEMO]))[0]?.id ?? '';
    expect(miniBox, 'Mini Box Japiim (C5110) na base demo').not.toBe('');
    // RN-VEN-20 (v1.0.4): os totais da referência dependem de AGU-500, CAF-500 e BIS-400 nessas quantidades; o CAF-500 tem pouco
    // disponível na filial do Mini Box (saldo − reservas do seed): o preparo completa o saldo antes do 1º sync (a recusa fica ligada)
    for (const p of [prod.AGU, prod.CAF, prod.BIS]) await garantirSaldoNaFilial(api.admin, miniBox, p, SALDO_REFERENCIA);
    const carteira = await q<{ cliente_id: string }>('select cliente_id from core.carteira where tenant_id = $1 and usuario_id = $2 and deleted_at is null', [TENANT_DEMO, usuarioId.vendedor]);
    expect(carteira.map((c) => c.cliente_id), 'Mini Box na carteira do Lucas').toContain(miniBox);
    outroCliente = carteira.map((c) => c.cliente_id).find((c) => c !== miniBox)!;
    cond28 = (await q<{ id: string }>("select id from vendedor.condicao_pagamento where tenant_id = $1 and codigo = '28D'", [TENANT_DEMO]))[0]!.id;
    await esperarHorizonte();
    lucas = await aparelhoCampo(api, DEMO.vendedor);
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------- O1–O3: offline → servidor → Transformar
  describe('Referência 398,30 → 379,79 (offline → reconexão → Transformar)', () => {
    let realizadoAntes = 0;

    it('O1. modo avião: o orçamento da referência fica na fila (nada sai); ao reconectar o servidor recalcula 39830/1467/384/37979 (4,6%, dentro da alçada), sem evento vendedor.pedido.* e fora da meta', async () => {
      realizadoAntes = await realizadoDoLucas();
      lucas.online.valor = false;
      const lotes = lucas.lotesEnviados.length;
      itemOrcamento = orcamento(ORC);
      await lucas.motor.enfileirar({ id: ORC, entidade: 'pedido', payload: itemOrcamento.payload });
      await lucas.sincronizar();
      expect(lucas.lotesEnviados.length, 'offline: nenhum lote saiu').toBe(lotes);
      expect(lucas.motor.estado().fila.map((i) => i.id)).toEqual([ORC]);
      expect(await noBanco(ORC), 'nada no servidor antes da reconexão').toBeUndefined();

      lucas.online.valor = true;
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(lucas.motor.estado().fila, 'a fila esvaziou').toEqual([]);

      const { p } = await conferirReferencia(ORC, 'orcamento');
      expect(['draft', 'queued', 'received']).toContain(p.status);
      expect(p.orcamento_validade, 'validade gravada (RN-VEN-18)').toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.numero, 'número no orçamento').toMatch(/^\d{6}$/);
      expect(await eventos(ORC), 'RN-INT-08/RN-VEN-32: nenhum evento do orçamento na outbox').toEqual([]);
      expect(await q('select 1 from integracao.pedido_fila_erp where pedido_uuid = $1', [ORC]), 'fora da fila do ERP').toEqual([]);
      expect(await realizadoDoLucas(), 'RN-CORE-21: orçamento não conta na meta').toBe(realizadoAntes);
    });

    it('O1b. BKO e lista: o detalhe abre como orçamento; a lista padrão (pedidos) não traz o orçamento e tipo=orcamento traz, "aberto"', async () => {
      const d = await api.get(token.analista, `/v1/vendedor/pedidos/${ORC}`);
      expect(d.status, JSON.stringify(d.corpo)).toBe(200);
      expect(d.corpo).toMatchObject({ tipo: 'orcamento', total_cents: 37979 });
      const padrao = await api.get(token.vendedor, '/v1/vendedor/pedidos?limite=200');
      expect(padrao.status).toBe(200);
      expect(listaDe(padrao.corpo).map((o) => (o as { id: string }).id), 'lista padrão = só pedidos').not.toContain(ORC);
      const orcs = await api.get(token.vendedor, '/v1/vendedor/pedidos?tipo=orcamento&limite=200');
      expect(orcs.status, JSON.stringify(orcs.corpo)).toBe(200);
      const o = listaDe(orcs.corpo).find((x) => (x as { id: string }).id === ORC) as Record<string, unknown> | undefined;
      expect(o, 'tipo=orcamento traz o orçamento').toBeDefined();
      expect(o!.situacao_orcamento).toBe('aberto');
    });

    it('O2. pull: o orçamento chega ao aparelho com tipo, validade e o modo de cada ajuste; o reenvio do MESMO item é idempotente (RN-VEN-33) e continua sem evento', async () => {
      await sincronizarComHorizonte(lucas);
      const l = await linhaNoAparelho(lucas, ORC);
      expect(l).toMatchObject({ tipo: 'orcamento', total_cents: 37979, ajuste_em: 'pct', convertido_pedido_id: null });
      expect(String(l!.validade_data)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(l!.validade_ate)).toMatch(/Z$/);
      const itens = (await lucas.motor.linhas<Linha>('pedido_item')).filter((i) => i.pedido_id === ORC && !i.deleted_at);
      // o servidor grava sempre o R$ equivalente por unidade (desenho §3.1: 1790 − 1701 = 89 na água) e o modo digitado em ajuste_em
      expect(itens.map((i) => [i.produto_sku, i.unidade, i.ajuste_em ?? null, Number(i.desconto_unitario_cents ?? 0)]).sort()).toEqual([
        ['AGU-500', 'FD', 'pct', 89],
        ['BIS-400', 'CX', 'pct', 0], // sem ajuste: o servidor grava o modo padrão (%)
        ['CAF-500', 'UN', 'valor', 100],
      ]);
      const [r] = await push(token.vendedor, [itemOrcamento]);
      expect(r).toMatchObject({ id: ORC, status: 'aceito' });
      expect(await q('select 1 from vendedor.pedido where id = $1', [ORC])).toHaveLength(1);
      expect(await itensNoBanco(ORC)).toHaveLength(3);
      expect(await eventos(ORC)).toEqual([]);
    });

    it('O3. Transformar (RN-VEN-18): o aparelho cria um pedido NOVO pelo domain (UUID do aparelho, origem = orçamento) → mesmo 37979, aprovado sem alçada, criado/aprovado publicados e agora conta na meta pela data do pedido novo', async () => {
      const o = await doAparelho(lucas, ORC);
      const payload = pedidoDoOrcamento(o, PED, new Date().toISOString());
      expect(payload).toMatchObject({ id: PED, tipo: 'pedido', orcamento_origem_id: ORC, customer_id: miniBox, discount_pct: 1 });
      expect(PED).not.toBe(ORC);
      await lucas.motor.enfileirar({ id: PED, entidade: 'pedido', payload });
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(lucas.motor.estado().fila).toEqual([]);

      const { p } = await conferirReferencia(PED, 'pedido');
      expect(p).toMatchObject({ orcamento_id: ORC, status: 'approved' });
      expect((await eventos(PED)).map((e) => e.nome)).toEqual(expect.arrayContaining(['vendedor.pedido.criado@1', 'vendedor.pedido.aprovado@1']));
      const orc = await noBanco(ORC);
      expect(orc, 'o orçamento continua sendo orçamento (o pedido é outro registro)').toMatchObject({ tipo: 'orcamento', total_cents: 37979 });
      expect(await eventos(ORC), 'o orçamento continua sem evento').toEqual([]);
      expect(await realizadoDoLucas(), 'RN-CORE-21: o pedido transformado conta 37979 na meta').toBe(realizadoAntes + 37979);

      await sincronizarComHorizonte(lucas);
      expect(await linhaNoAparelho(lucas, ORC)).toMatchObject({ convertido_pedido_id: PED });
      const conv = await api.get(token.vendedor, '/v1/vendedor/pedidos?tipo=orcamento&situacao=convertido&limite=200');
      expect(listaDe(conv.corpo).map((x) => (x as { id: string }).id), 'filtro Orçamentos › convertido').toContain(ORC);
    });

    it('O3b. o convertido não vira outro pedido (ORCAMENTO_JA_CONVERTIDO); reenvio do MESMO pedido é idempotente; PUT e cancelar do convertido = 422 RN-VEN-18', async () => {
      const o = await doAparelho(lucas, ORC);
      const outro = randomUUID();
      const [r] = await push(token.vendedor, [{ entidade: 'pedido', id: outro, operacao: 'upsert', payload: pedidoDoOrcamento(o, outro, new Date().toISOString()) }]);
      expect(r).toMatchObject({ id: outro, status: 'rejeitado', codigo: 'ORCAMENTO_JA_CONVERTIDO' });
      expect(await noBanco(outro)).toBeUndefined();
      expect(await q('select id from vendedor.pedido where orcamento_id = $1', [ORC])).toEqual([{ id: PED }]);

      const l = await linhaNoAparelho(lucas, ORC);
      const e = await put(token.vendedor, ORC, corpoPut(String(l!.updated_at)));
      expect([e.statusCode, codigo(e)], e.body).toEqual([422, 'RN-VEN-18']);
      const c = await cancelar(token.vendedor, ORC);
      expect([c.statusCode, codigo(c)], c.body).toEqual([422, 'RN-VEN-18']);
      expect((await noBanco(ORC))!.status).not.toBe('cancelled');
    });
  });

  // ------------------------------------------------------------------------------------------ O4–O7: PUT e cancelar
  describe('PUT /v1/vendedor/orcamentos/:id e POST .../cancelar', () => {
    const ED = randomUUID();
    const VENC = randomUUID();
    let atualizado = '';
    /** O atualizado_em que o aparelho tinha ANTES da edição do O4 (outro aparelho com a versão velha). */
    let atualizadoVelho = '';
    let numero = '';
    let validade = '';

    it('O4. orçamento simples recebido (AGU-500 2 FD) → PUT com a composição da referência e o atualizado_em do pull: 200, 37979, mesma validade e número, itens antigos removidos, sem evento', async () => {
      const [r] = await push(token.vendedor, [orcamento(ED, { discount_pct: 0, ajuste_em: undefined, items: [{ product_id: prod.AGU, quantity: 2, unidade: 'FD' }] })]);
      expect(r).toMatchObject({ id: ED, status: 'aceito' });
      const antes = (await noBanco(ED))!;
      expect(antes).toMatchObject({ tipo: 'orcamento', total_cents: 3580 });
      numero = antes.numero!;
      validade = antes.orcamento_validade!;
      await sincronizarComHorizonte(lucas);
      atualizado = String((await linhaNoAparelho(lucas, ED))!.updated_at);

      const e = await put(token.vendedor, ED, corpoPut(atualizado));
      expect(e.statusCode, e.body).toBe(200);
      const corpo = e.json() as { id: string; tipo: string; total_cents: number; validade_data: string; atualizado_em: string };
      expect(corpo).toMatchObject({ id: ED, tipo: 'orcamento', total_cents: 37979, validade_data: validade });
      expect(corpo.atualizado_em).not.toBe(atualizado);
      await conferirReferencia(ED, 'orcamento');
      expect((await noBanco(ED))!).toMatchObject({ numero, orcamento_validade: validade });
      const todos = await itensNoBanco(ED, false);
      expect(todos.filter((i) => i.deleted_at).map((i) => [i.produto_sku, i.quantidade]), 'o item antigo sai por exclusão lógica (o pull leva a remoção)').toEqual([['AGU-500', 2]]);
      expect(await eventos(ED)).toEqual([]);
      atualizadoVelho = atualizado;
      atualizado = corpo.atualizado_em;
    });

    /** Tudo o que um PUT recusado ou repetido NÃO pode mexer: cabeçalho, versão, hash, itens (vivos e removidos), auditoria e eventos. */
    const retrato = async (pid: string) => ({
      pedido: (
        await q(
          `select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as atualizado_em, hash_envio, status, numero, orcamento_validade::text,
                  cliente_id, observacao, desconto_pct::float8 as desconto_pct, total_tabela_cents::float8 as total_tabela_cents, total_cents::float8 as total_cents
             from vendedor.pedido where id = $1`,
          [pid],
        )
      )[0],
      itens: await itensNoBanco(pid, false),
      auditoria: await q("select acao, created_at::text from plataforma.auditoria where entidade_id = $1 order by created_at, acao", [pid]),
      eventos: await eventos(pid),
    });

    it('O5a. RN-VEN-33 concorrência otimista: PUT com corpo DIFERENTE e o atualizado_em antigo → 409 ORCAMENTO_ALTERADO; nada muda (versão, itens, total, auditoria)', async () => {
      const antes = await retrato(ED);
      expect(antes.pedido).toMatchObject({ atualizado_em: atualizado, total_cents: 37979 });
      const obs = await put(token.vendedor, ED, corpoPut(atualizadoVelho, { observacao: 'outra edição em outro aparelho' }));
      expect([obs.statusCode, codigo(obs)], obs.body).toEqual([409, 'ORCAMENTO_ALTERADO']);
      const itens = itensReferencia();
      itens[0] = { ...itens[0]!, quantity: 5 };
      const qtd = await put(token.vendedor, ED, corpoPut(atualizadoVelho, { items: itens }));
      expect([qtd.statusCode, codigo(qtd)], qtd.body).toEqual([409, 'ORCAMENTO_ALTERADO']);
      expect(await retrato(ED), 'nada muda no banco').toEqual(antes);
      await conferirReferencia(ED, 'orcamento');
    });

    it('O5b. RN-VEN-33 idempotência: PUT IDÊNTICO ao último aceito, com o atualizado_em antigo (resposta perdida) → 200 com o orçamento atual; nada muda (mesmo atualizado_em, itens e total; nenhuma auditoria nova)', async () => {
      const antes = await retrato(ED);
      const repete = await put(token.vendedor, ED, corpoPut(atualizadoVelho));
      expect(repete.statusCode, repete.body).toBe(200);
      const corpo = repete.json() as { id: string; tipo: string; total_cents: number; validade_data: string; atualizado_em: string };
      expect(corpo).toMatchObject({ id: ED, tipo: 'orcamento', total_cents: 37979, validade_data: validade, atualizado_em: atualizado });
      expect(await retrato(ED), 'nada muda no banco (nem versão, nem itens, nem auditoria)').toEqual(antes);
      expect(antes.auditoria.filter((a) => a.acao === 'orcamento.editar'), 'só a edição do O4 na auditoria').toHaveLength(1);
      await conferirReferencia(ED, 'orcamento');
    });

    it('O5c. RN-VEN-33 trocar o cliente → 422 PAYLOAD_INVALIDO; nada muda', async () => {
      const antes = await retrato(ED);
      const troca = await put(token.vendedor, ED, corpoPut(atualizado, { customer_id: outroCliente }));
      expect([troca.statusCode, codigo(troca)], troca.body).toEqual([422, 'PAYLOAD_INVALIDO']);
      expect(await retrato(ED), 'nada muda no banco').toEqual(antes);
      expect((await noBanco(ED))!.total_cents).toBe(37979);
    });

    it('O6. cancelar: 200 cancelled com histórico e sem evento de pedido; repetir é idempotente; depois PUT = 422 RN-VEN-18 e Transformar = rejeitado RN-VEN-18', async () => {
      const c = await cancelar(token.vendedor, ED, 'cliente desistiu');
      expect(c.statusCode, c.body).toBe(200);
      expect(c.json()).toMatchObject({ id: ED, status: 'cancelled' });
      expect((await noBanco(ED))!.status).toBe('cancelled');
      expect(await q("select para from vendedor.pedido_evento where pedido_id = $1 and para = 'cancelled'", [ED])).toHaveLength(1);
      expect(await eventos(ED), 'RN-VEN-32: cancelar orçamento não publica evento de pedido').toEqual([]);
      const de_novo = await cancelar(token.vendedor, ED);
      expect([de_novo.statusCode, (de_novo.json() as { status: string }).status]).toEqual([200, 'cancelled']);
      expect(await q("select 1 from vendedor.pedido_evento where pedido_id = $1 and para = 'cancelled'", [ED]), 'sem histórico duplicado').toHaveLength(1);

      const e = await put(token.vendedor, ED, corpoPut(atualizado));
      expect([e.statusCode, codigo(e)], e.body).toEqual([422, 'RN-VEN-18']);
      const novo = randomUUID();
      const [r] = await push(token.vendedor, [{ entidade: 'pedido', id: novo, operacao: 'upsert', payload: { ...orcamento(novo).payload, tipo: 'pedido', orcamento_origem_id: ED } }]);
      expect(r).toMatchObject({ id: novo, status: 'rejeitado', codigo: 'RN-VEN-18' });
      expect(await noBanco(novo)).toBeUndefined();
    });

    // RN-VEN-18/32 (09/11, T-0141 G): o orçamento NÃO vence; o [orcamento.validade_dias] = 7 limita só o PREÇO congelado. Passado
    // esse prazo, Transformar e a edição reprecificam pela tabela do dia; cancelar segue valendo. "Expirado"/"Vencido" saíram.
    it('O7. preço de mais de 7 dias (validade do preço de anteontem) + Café de R$ 18,90 para R$ 19,50: continua "aberto" (não há "expirado"); Transformar → pedido pela tabela do DIA (valor × regra, meta pelo pedido novo); PUT reprecifica e renova a data do preço; cancelar 200', async () => {
      const VENC2 = randomUUID();
      const r = await push(token.vendedor, [orcamento(VENC), orcamento(VENC2)]);
      expect(r.map((x) => x.status), JSON.stringify(r)).toEqual(['aceito', 'aceito']);
      await api.admin.query("update vendedor.pedido set orcamento_validade = (now() at time zone 'America/Manaus')::date - 2 where id = any($1::uuid[])", [[VENC, VENC2]]);
      const precoCafe = await q<{ id: string; preco_cents: number }>(
        `select i.id, i.preco_cents::int as preco_cents
           from catalogo.cliente_tabela_preco c
           join catalogo.tabela_preco_item i on i.tabela_preco_id = c.tabela_preco_id and i.tenant_id = c.tenant_id
          where c.cliente_id = $1 and c.deleted_at is null and i.produto_id = $2 and i.unidade is null and i.deleted_at is null
            and (i.vigencia_inicio is null or i.vigencia_inicio <= now()) and (i.vigencia_fim is null or i.vigencia_fim > now())
            -- RN-CAT-06 / RN-CORE-39 (T-0149): só a linha da filial do cliente; a tabela sem item nessa filial cai na filial padrão
            and i.filial_id = coalesce(
              (select cl.filial_id from core.cliente cl
                where cl.id = c.cliente_id and cl.tenant_id = c.tenant_id
                  and exists (select 1 from catalogo.tabela_preco_item x
                               where x.tenant_id = c.tenant_id and x.tabela_preco_id = c.tabela_preco_id and x.filial_id = cl.filial_id and x.deleted_at is null)),
              (select f.id from core.filial f where f.tenant_id = c.tenant_id and f.padrao and f.deleted_at is null))`,
        [miniBox, prod.CAF],
      );
      expect(precoCafe, 'uma linha vigente do CAF-500 a R$ 18,90 na tabela do Mini Box').toEqual([{ id: expect.any(String), preco_cents: 1890 }]);
      await api.admin.query('update catalogo.tabela_preco_item set preco_cents = 1950 where id = $1', [precoCafe[0]!.id]);
      try {
        await sincronizarComHorizonte(lucas);
        expect(await linhaNoAparelho(lucas, VENC), 'o de preço antigo desce ao aparelho').toBeDefined();

        // situação: aberto, a qualquer tempo (RN-VEN-18); o filtro "expirado" não existe mais (400 do contrato)
        const abertos = await api.get(token.vendedor, '/v1/vendedor/pedidos?tipo=orcamento&situacao=aberto&limite=200');
        expect(abertos.status, JSON.stringify(abertos.corpo)).toBe(200);
        const naLista = listaDe(abertos.corpo).find((x) => (x as { id: string }).id === VENC) as Record<string, unknown> | undefined;
        expect(naLista, 'o de preço antigo está em Orçamentos › aberto').toBeDefined();
        expect(naLista!.situacao_orcamento).toBe('aberto');
        const expirado = await api.get(token.vendedor, '/v1/vendedor/pedidos?tipo=orcamento&situacao=expirado&limite=200');
        expect(expirado.status, 'não existe mais a situação "expirado" (RN-VEN-18 de 09/11)').toBe(400);

        // valor × regra: o pedido nasce pela tabela de HOJE. Esperado calculado pela regra (RN-VEN-02/03, R$ por unidade no item,
        // % do pedido sobre o total dos itens, meia para cima), não copiado do servidor:
        //   tabela = 3 × 17,90 + 12 × 19,50 + 1 × 117,80 = 405,50
        //   itens  = 3 × round(17,90 × 0,95) + 12 × (19,50 − 1,00) + 117,80 = 3 × 17,01 + 12 × 18,50 + 117,80 = 390,83
        //   pedido = 1% de 390,83 = round(3,9083) = 3,91 → total = 386,92 (o preço congelado daria 379,79)
        const tabelaHoje = { AGU: 1790, CAF: 1950, BIS: 11780 };
        const unitAgu = Math.round(tabelaHoje.AGU * 0.95);
        const tabelaEsperada = 3 * tabelaHoje.AGU + 12 * tabelaHoje.CAF + tabelaHoje.BIS;
        const itensEsperado = 3 * unitAgu + 12 * (tabelaHoje.CAF - 100) + tabelaHoje.BIS;
        const totalEsperado = itensEsperado - Math.round(itensEsperado * 0.01);
        expect([tabelaEsperada, itensEsperado, totalEsperado]).toEqual([40550, 39083, 38692]);
        const efetivoEsperado = Math.round(((tabelaEsperada - totalEsperado) / tabelaEsperada) * 10000) / 100;

        const realizadoAntes = await realizadoDoLucas();
        const novo = randomUUID();
        const [t] = await push(token.vendedor, [{ entidade: 'pedido', id: novo, operacao: 'upsert', payload: pedidoDoOrcamento(await doAparelho(lucas, VENC), novo, new Date().toISOString()) }]);
        expect(t, 'Transformar depois dos 7 dias é aceito (o orçamento não vence)').toMatchObject({ id: novo, status: 'aceito' });
        const p = (await noBanco(novo))!;
        expect(p).toMatchObject({ tipo: 'pedido', orcamento_id: VENC, status: 'approved', nivel_aprovacao: null, total_tabela_cents: tabelaEsperada, total_cents: totalEsperado, desconto_pct: 1 });
        expect(p.desconto_efetivo_pct).toBeCloseTo(efetivoEsperado, 2);
        const it = await itensNoBanco(novo);
        expect(it.map((i) => [i.produto_sku, i.unidade, i.quantidade, i.preco_tabela_cents, i.preco_unitario_cents])).toEqual([
          ['AGU-500', 'FD', 3, 1790, unitAgu],
          ['CAF-500', 'UN', 12, 1950, 1850], // preço de HOJE (19,50), R$ 1,00 por unidade mantido
          ['BIS-400', 'CX', 1, 11780, 11780],
        ]);
        expect(it.reduce((s, i) => s + i.total_cents, 0), 'o rateio dos itens fecha no total do pedido').toBe(totalEsperado);
        expect((await eventos(novo)).map((e) => e.nome)).toEqual(expect.arrayContaining(['vendedor.pedido.criado@1', 'vendedor.pedido.aprovado@1']));
        expect(await realizadoDoLucas(), 'RN-CORE-21: conta na meta o total do pedido novo (tabela do dia)').toBe(realizadoAntes + totalEsperado);
        expect((await noBanco(VENC))!.total_cents, 'o orçamento guarda o próprio total (379,79)').toBe(37979);

        // PUT depois dos 7 dias: reprecifica pela tabela do dia e renova a data do preço (D+7 a partir de hoje)
        const l2 = await linhaNoAparelho(lucas, VENC2);
        expect(l2, 'o segundo de preço antigo no aparelho').toBeDefined();
        const validadeVelha = (await noBanco(VENC2))!.orcamento_validade!;
        const e = await put(token.vendedor, VENC2, corpoPut(String(l2!.updated_at)));
        expect(e.statusCode, e.body).toBe(200);
        const d2 = (await noBanco(VENC2))!;
        expect(d2).toMatchObject({ tipo: 'orcamento', total_tabela_cents: tabelaEsperada, total_cents: totalEsperado });
        expect((await itensNoBanco(VENC2)).find((i) => i.produto_sku === 'CAF-500')!.preco_tabela_cents, 'CAF pelo preço de hoje').toBe(1950);
        expect(d2.orcamento_validade! > validadeVelha, 'data do preço renovada').toBe(true);
        expect(d2.orcamento_validade! >= api.hoje, 'o preço novo vale a partir de hoje').toBe(true);
        expect(await eventos(VENC2), 'editar orçamento não publica evento').toEqual([]);

        // cancelar o de preço antigo: 200 (está aberto) e sem evento de pedido
        const c = await cancelar(token.vendedor, VENC2);
        expect([c.statusCode, (c.json() as { status?: string }).status], c.body).toEqual([200, 'cancelled']);
        expect(await eventos(VENC2)).toEqual([]);
      } finally {
        await api.admin.query('update catalogo.tabela_preco_item set preco_cents = 1890 where id = $1', [precoCafe[0]!.id]);
      }
    });
  });

  // ------------------------------------------------------------------------------- O8: regra 7 (promotor) e O9: tenants
  describe('Regra 7 (RN-PRO-01) e isolamento', () => {
    const ABERTO = randomUUID();
    let atualizado = '';

    beforeAll(async () => {
      const [r] = await push(token.vendedor, [orcamento(ABERTO)]);
      expect(r).toMatchObject({ id: ABERTO, status: 'aceito' });
      await sincronizarComHorizonte(lucas);
      atualizado = String((await linhaNoAparelho(lucas, ABERTO))!.updated_at);
    });

    const intacto = async () => {
      const p = (await noBanco(ABERTO))!;
      expect(p).toMatchObject({ tipo: 'orcamento', total_cents: 37979 });
      expect(p.status).not.toBe('cancelled');
      expect(await itensNoBanco(ABERTO)).toHaveLength(3);
      expect(await eventos(ABERTO)).toEqual([]);
    };
    const promotorTentaTudo = async (codigoPush: string) => {
      const pedidoId = randomUUID();
      const orcId = randomUUID();
      const res = await push(token.promotor, [orcamento(orcId), { ...orcamento(pedidoId), payload: { ...orcamento(pedidoId).payload, tipo: 'pedido' } }]);
      expect(res.map((x) => [x.status, x.status === 'rejeitado' ? x.codigo : undefined]), JSON.stringify(res)).toEqual([
        ['rejeitado', codigoPush],
        ['rejeitado', codigoPush],
      ]);
      expect(await q('select 1 from vendedor.pedido where id = any($1::uuid[])', [[pedidoId, orcId]]), 'nada gravado').toEqual([]);
      const e = await put(token.promotor, ABERTO, corpoPut(atualizado, { discount_pct: 0 }));
      expect(e.statusCode, `PUT do promotor: ${e.body}`).toBe(403);
      const c = await cancelar(token.promotor, ABERTO);
      expect(c.statusCode, `cancelar do promotor: ${c.body}`).toBe(403);
      const cp = await api.chamar(token.promotor, { method: 'POST', url: `/v1/vendedor/pedidos/${PED}/cancelar`, payload: { motivo: 'promotor' } });
      expect(cp.statusCode, `cancelar PEDIDO pelo promotor: ${cp.body}`).toBe(403);
      await intacto();
      expect((await noBanco(PED))!.status, 'o pedido transformado não foi cancelado').toBe('approved');
      return { put: codigo(e), cancelar: codigo(c) };
    };

    it('O8a. promotor da demo (sem o Vendedor no perfil): push de orçamento e de pedido = MODULO_INATIVO; PUT, cancelar orçamento e cancelar pedido = 403; nada muda', async () => {
      await promotorTentaTudo('MODULO_INATIVO');
    });

    it('O8b. COM o Vendedor e o Catálogo licenciados ao perfil promotor: push = RN-PRO-01; PUT e cancelar = 403 pela ação do manifesto; nada muda', async () => {
      expect((await licenca(api, token.admin, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, token.admin, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      try {
        const cods = await promotorTentaTudo('RN-PRO-01');
        expect([cods.put, cods.cancelar].every((x) => x === 'RN-PRO-01' || x === 'PERFIL_SEM_ACESSO'), JSON.stringify(cods)).toBe(true);
      } finally {
        expect((await licenca(api, token.admin, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
        expect((await licenca(api, token.admin, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
      }
    });

    it('O9a. outro vendedor do MESMO tenant (Camila): PUT e cancelar do orçamento do Lucas = 404 ORCAMENTO_NAO_ENCONTRADO (sem revelar); nada muda', async () => {
      const e = await put(token.vendedor2, ABERTO, corpoPut(atualizado));
      expect([e.statusCode, codigo(e)], e.body).toEqual([404, 'ORCAMENTO_NAO_ENCONTRADO']);
      const c = await cancelar(token.vendedor2, ABERTO);
      expect([c.statusCode, codigo(c)], c.body).toEqual([404, 'ORCAMENTO_NAO_ENCONTRADO']);
      await intacto();
    });

    it('O9b. tenant A: não abre (404), não edita nem cancela (404), não converte (ORCAMENTO_NAO_ENCONTRADO) e o pull de A não traz o orçamento da demo; e a demo não vê os pedidos de A', async () => {
      const d = await api.get(tokenA, `/v1/vendedor/pedidos/${ABERTO}`);
      expect(d.status, JSON.stringify(d.corpo)).toBe(404);
      const e = await put(tokenA, ABERTO, { customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: prod.ALFA, quantity: 1 }], atualizado_em: atualizado });
      expect(e.statusCode, e.body).toBe(404);
      const c = await cancelar(tokenA, ABERTO);
      expect(c.statusCode, c.body).toBe(404);
      const novo = randomUUID();
      const [r] = await push(tokenA, [{ entidade: 'pedido', id: novo, operacao: 'upsert', payload: { id: novo, tipo: 'pedido', orcamento_origem_id: ABERTO, customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: prod.ALFA, quantity: 1 }] } }]);
      expect(r).toMatchObject({ id: novo, status: 'rejeitado', codigo: 'ORCAMENTO_NAO_ENCONTRADO' });
      expect(await noBanco(novo)).toBeUndefined();
      const pull = await api.chamar(tokenA, { method: 'GET', url: '/v1/sync/pull?entidade=pedido' });
      expect(pull.statusCode, pull.body).toBe(200);
      const idsA = (pull.json() as { itens: Array<{ id: string }> }).itens.map((i) => i.id);
      expect(idsA).not.toContain(ABERTO);
      expect(idsA).not.toContain(ORC);
      const orcsA = await api.get(tokenA, '/v1/vendedor/pedidos?tipo=todos&limite=200');
      expect(listaDe(orcsA.corpo).some((x) => ([ABERTO, ORC, PED] as string[]).includes((x as { id: string }).id))).toBe(false);
      const deA = (await q<{ id: string }>('select id from vendedor.pedido where tenant_id = $1', [A.tenantId])).map((x) => x.id);
      const vistosDemo = listaDe((await api.get(token.analista, '/v1/vendedor/pedidos?tipo=todos&limite=200')).corpo).map((x) => (x as { id: string }).id);
      expect(vistosDemo.filter((x) => deA.includes(x)), 'a demo não vê pedido de A').toEqual([]);
      await intacto();
    });
  });
});
