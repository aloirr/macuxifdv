/**
 * T-0071 — regressão da revisão de UX do Vendedor (commit 24d0d4d, R-20261104-054300-modulo-vendedor) no que é API e sync,
 * na BASE DEMO com o `createApp` REAL e o MOTOR DE SYNC real do app (Lucas). Matriz: docs/testes/T-0071.md (casos U1..U6).
 * As 3 correções vermelhas eram de tela; aqui se prova que o SERVIDOR sustenta o que a tela promete:
 *
 *  U1 orçamento salvo (8%, acima da alçada do vendedor) NÃO vira pedido: fica `orcamento`/`received`, sem nível de aprovação,
 *     sem evento `vendedor.pedido.*`, fora da fila do ERP, fora de "Para aprovar" e da meta; reenvio e novas sincronizações
 *     (o "rascunho fantasma" do Resumo) não criam pedido (RN-VEN-18/32/33, RN-CORE-21).
 *  U2 nenhuma outra rota transforma: push do MESMO id como `tipo: pedido` = conflito; PUT do orçamento com tipo = 400 VALIDACAO (corpo estrito)
 *     (corpo estrito); não existe POST/PUT de pedido fora do push (o pedido só nasce pela rota de envio).
 *  U3 Transformar pela rota de envio (push do pedido NOVO com `orcamento_origem_id`, montado por `pedidoDoOrcamento` sobre as
 *     linhas do aparelho) recalcula a alçada no servidor: 8% → `pending_approval`, nível supervisor, criado@1 +
 *     aprovacao_solicitada@1, sem aprovado@1; aparece em "Para aprovar" da supervisora (RN-VEN-10).
 *  U4 a alçada é a do MOMENTO do envio: orçamento salvo a 4,65% com o vendedor em 5%; a política baixa para 4% → Transformar
 *     cai em aprovação (o servidor não herda a decisão da hora em que o orçamento foi salvo).
 *  U5 pedido enviado não aceita alteração de desconto pelo push: reenvio do mesmo id com outro desconto (no pedido ou no item)
 *     = `conflito`; nada muda no banco (desconto, total, status, nível, histórico, eventos) — nem para fugir da aprovação
 *     (8% → 3%) nem para aumentar o desconto de um aprovado (RN-VEN-33, RN-VEN-30).
 *  U6 pelo aparelho: o motor enfileira o pedido com o desconto alterado → o servidor responde conflito; o item fica na fila
 *     como falhou/CONFLITO (não reenvia sozinho, ADR 0009) e a linha do pull segue com a versão do servidor (servidor vence);
 *     descartado, some da fila; nenhuma outra rota (PUT de orçamento) edita o pedido (404).
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pedidoDoOrcamento, type OrcamentoParaPedido } from '../../../modules/vendedor/domain';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, garantirSaldoNaFilial, listaDe, SALDO_REFERENCIA, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

type Linha = LinhaSync & Record<string, unknown>;
interface Banco {
  id: string;
  tipo: string;
  status: string;
  orcamento_id: string | null;
  nivel_aprovacao: string | null;
  total_cents: number;
  desconto_pct: number;
  updated_at: string;
  hash_envio: string | null;
}

const EV = {
  criado: 'vendedor.pedido.criado@1',
  solicitada: 'vendedor.pedido.aprovacao_solicitada@1',
  aprovado: 'vendedor.pedido.aprovado@1',
};

describe.skipIf(semBanco())('T-0071 — regressão da revisão de UX do Vendedor (orçamento salvo, Transformar com alçada, pedido enviado imutável no push)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  let lucas: AparelhoCampo;
  const prod: Record<'AGU' | 'CAF' | 'BIS', string> = { AGU: '', CAF: '', BIS: '' };
  let miniBox = '';
  let cond28 = '';

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await api.admin.query(sql, p)).rows as T[];
  const noBanco = async (pid: string): Promise<Banco | undefined> =>
    (
      await q<Banco & Record<string, unknown>>(
        `select id, tipo, status, orcamento_id, nivel_aprovacao, total_cents::float8 as total_cents, desconto_pct::float8 as desconto_pct,
                updated_at::text as updated_at, hash_envio
           from vendedor.pedido where id = $1`,
        [pid],
      )
    )[0];
  const itensNoBanco = (pid: string) =>
    q<{ produto_sku: string; quantidade: number; preco_unitario_cents: number; total_cents: number }>(
      `select produto_sku, quantidade::int as quantidade, preco_unitario_cents::float8 as preco_unitario_cents, total_cents::float8 as total_cents
         from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia`,
      [pid],
    );
  const historico = (pid: string) => q<{ de: string | null; para: string }>('select de, para from vendedor.pedido_evento where pedido_id = $1 order by ocorrido_em, created_at', [pid]);
  const eventos = async (pid: string) =>
    (await q<{ nome: string }>("select nome from plataforma.evento where agregado_id = $1 or payload->>'pedido_id' = $1::text order by created_at", [pid])).map((e) => e.nome);
  const push = async (tk: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;
  const realizadoDoLucas = async (): Promise<number> => {
    const r = await api.chamar(token.vendedor, { method: 'GET', url: `/v1/core/indicadores?usuario_id=${usuarioId.vendedor}` });
    expect(r.statusCode, r.body).toBe(200);
    const it = (r.json() as { itens: Array<{ usuario_id: string; indicadores: { realizado_cents?: number | null } }> }).itens.find((i) => i.usuario_id === usuarioId.vendedor);
    return Number(it?.indicadores.realizado_cents ?? 0);
  };
  const paraAprovarDaSupervisora = async (): Promise<string[]> => {
    const r = await api.get(token.supervisor, '/v1/vendedor/pedidos?status=pending_approval&limite=200');
    expect(r.status, JSON.stringify(r.corpo)).toBe(200);
    return listaDe(r.corpo).map((x) => (x as { id: string }).id);
  };
  const sincronizar = async () => {
    await esperarHorizonte();
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  };
  const linhaNoAparelho = async (pid: string) => (await lucas.motor.linhas<Linha>('pedido')).find((l) => l.id === pid);

  /** Payload do aparelho: AGU-500 3 FD + CAF-500 12 UN + BIS-400 1 CX, desconto só no pedido (efetivo = `pct`). */
  const documento = (pid: string, tipo: 'orcamento' | 'pedido', pct: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: pid,
    tipo,
    customer_id: miniBox,
    discount_pct: pct,
    ajuste_em: 'pct',
    payment_terms: '28 dias',
    condicao_pagamento_id: cond28,
    created_offline_at: new Date().toISOString(),
    items: [
      { product_id: prod.AGU, quantity: 3, unidade: 'FD' },
      { product_id: prod.CAF, quantity: 12, unidade: 'UN' },
      { product_id: prod.BIS, quantity: 1, unidade: 'CX' },
    ],
    ...extra,
  });
  /** Orçamento da referência (4,65% efetivo, dentro dos 5% do vendedor). */
  const referencia = (pid: string): Record<string, unknown> => ({
    id: pid,
    tipo: 'orcamento',
    customer_id: miniBox,
    discount_pct: 1,
    ajuste_em: 'pct',
    payment_terms: '28 dias',
    condicao_pagamento_id: cond28,
    created_offline_at: new Date().toISOString(),
    items: [
      { product_id: prod.AGU, quantity: 3, unidade: 'FD', desconto_pct: 5, ajuste_em: 'pct' },
      { product_id: prod.CAF, quantity: 12, unidade: 'UN', desconto_unitario_cents: 100, ajuste_em: 'valor' },
      { product_id: prod.BIS, quantity: 1, unidade: 'CX' },
    ],
  });
  const item = (payload: Record<string, unknown>): ItemPush => ({ entidade: 'pedido', id: String(payload.id), operacao: 'upsert', payload });

  /** O que a tela lê das linhas locais para Transformar (mesmo mapeamento do orcamento-ponta-a-ponta.test.ts). */
  const doAparelho = async (pid: string): Promise<OrcamentoParaPedido> => {
    const p = (await lucas.motor.linhas<Linha>('pedido')).find((l) => l.id === pid && !l.deleted_at);
    expect(p, 'orçamento no aparelho').toBeDefined();
    const itens = (await lucas.motor.linhas<Linha>('pedido_item')).filter((i) => i.pedido_id === pid && !i.deleted_at).sort((a, b) => Number(a.sequencia) - Number(b.sequencia));
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
  /** Retrato completo do documento para provar "nada mudou". */
  const retrato = async (pid: string) => ({ p: await noBanco(pid), itens: await itensNoBanco(pid), historico: await historico(pid), eventos: await eventos(pid) });

  beforeAll(async () => {
    api = await subirApiDemo();
    for (const k of ['vendedor', 'supervisor', 'admin'] as const) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    const produtos = await q<{ sku: string; id: string }>("select sku, id from core.produto where tenant_id = $1 and sku in ('AGU-500', 'CAF-500', 'BIS-400') and deleted_at is null", [TENANT_DEMO]);
    for (const p of produtos) prod[p.sku.slice(0, 3) as 'AGU' | 'CAF' | 'BIS'] = p.id;
    expect([prod.AGU, prod.CAF, prod.BIS].every(Boolean), 'AGU-500, CAF-500 e BIS-400 na base demo').toBe(true);
    miniBox = (await q<{ id: string }>("select id from core.cliente where tenant_id = $1 and external_id = 'C5110'", [TENANT_DEMO]))[0]?.id ?? '';
    expect(miniBox, 'Mini Box Japiim (C5110) na base demo').not.toBe('');
    // RN-VEN-20 (v1.0.4): os totais da referência dependem de AGU-500, CAF-500 e BIS-400 nessas quantidades; o CAF-500 tem pouco
    // disponível na filial do Mini Box (saldo − reservas do seed): o preparo completa o saldo antes do 1º sync (a recusa fica ligada)
    for (const p of [prod.AGU, prod.CAF, prod.BIS]) await garantirSaldoNaFilial(api.admin, miniBox, p, SALDO_REFERENCIA);
    cond28 = (await q<{ id: string }>("select id from vendedor.condicao_pagamento where tenant_id = $1 and codigo = '28D'", [TENANT_DEMO]))[0]!.id;
    const alcada = await q<{ valor: unknown }>("select valor from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = 'alcada.vendedor_pct'", [TENANT_DEMO]);
    expect(alcada.map((a) => Number(a.valor)), 'alçada do vendedor na demo = 5% (linha em plataforma.parametro)').toEqual([5]);
    await esperarHorizonte();
    lucas = await aparelhoCampo(api, DEMO.vendedor);
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // --------------------------------------------------------------------------- U1–U3: orçamento salvo × Transformar
  describe('Orçamento salvo não vira pedido; Transformar só pela rota de envio, com a alçada do servidor', () => {
    const ORC = randomUUID();
    const PED = randomUUID();
    let realizadoAntes = 0;
    /** Os envios exatos do aparelho (o reenvio idêntico tem de bater o hash; só o desconto muda nos casos de alteração). */
    let envioOrc: Record<string, unknown> = {};
    let envioPed: Record<string, unknown> = {};

    it('U1. orçamento de 8% (acima dos 5% do vendedor) salvo pelo aparelho: orcamento/received sem nível, sem evento, fora do ERP, de "Para aprovar" e da meta; reenvio e novas sincronizações não criam pedido', async () => {
      realizadoAntes = await realizadoDoLucas();
      envioOrc = documento(ORC, 'orcamento', 8);
      await lucas.motor.enfileirar({ id: ORC, entidade: 'pedido', payload: envioOrc });
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(lucas.motor.estado().fila).toEqual([]);

      const p = await noBanco(ORC);
      expect(p, 'orçamento gravado').toMatchObject({ tipo: 'orcamento', status: 'received', nivel_aprovacao: null, orcamento_id: null, desconto_pct: 8 });
      expect(await historico(ORC), 'nunca passou por pending_approval').not.toContainEqual(expect.objectContaining({ para: 'pending_approval' }));
      expect(await eventos(ORC), 'RN-VEN-32: orçamento não publica vendedor.pedido.*').toEqual([]);
      expect(await q('select 1 from integracao.pedido_fila_erp where pedido_uuid = $1', [ORC]), 'fora da fila do ERP').toEqual([]);
      expect(await paraAprovarDaSupervisora(), 'orçamento não aparece em "Para aprovar"').not.toContain(ORC);
      expect(await realizadoDoLucas(), 'RN-CORE-21: orçamento não conta na meta').toBe(realizadoAntes);

      // o mesmo envio de novo (resposta perdida) e mais duas sincronizações: nada nasce do orçamento
      const antes = await retrato(ORC);
      const [r] = await push(token.vendedor, [item(envioOrc)]);
      expect(r).toMatchObject({ id: ORC, status: 'aceito' });
      await sincronizar();
      await sincronizar();
      expect(await retrato(ORC)).toEqual(antes);
      expect(await q('select id from vendedor.pedido where orcamento_id = $1', [ORC]), 'nenhum pedido nasceu do orçamento').toEqual([]);
      expect(await linhaNoAparelho(ORC)).toMatchObject({ tipo: 'orcamento', convertido_pedido_id: null });
    });

    it('U2. nenhuma outra rota transforma: push do MESMO id como pedido = conflito; PUT com tipo = 400; POST/PUT de pedido fora do push não existem; o orçamento segue intacto', async () => {
      const antes = await retrato(ORC);
      const [r] = await push(token.vendedor, [item({ ...envioOrc, tipo: 'pedido' })]);
      expect(r, JSON.stringify(r)).toMatchObject({ id: ORC, status: 'conflito' });

      const l = await linhaNoAparelho(ORC);
      const { id: _id, tipo: _tipo, created_offline_at: _c, ...corpo } = envioOrc;
      void _id;
      void _tipo;
      void _c;
      const e = await api.chamar(token.vendedor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${ORC}`, payload: { ...corpo, tipo: 'pedido', atualizado_em: String(l!.updated_at) } });
      // EditarOrcamentoRequest é .strict() sem `tipo`: a plataforma barra o corpo antes da rota (400 VALIDACAO)
      expect([e.statusCode, codigo(e)], e.body).toEqual([400, 'VALIDACAO']);

      const post = await api.chamar(token.vendedor, { method: 'POST', url: '/v1/vendedor/pedidos', payload: { ...documento(randomUUID(), 'pedido', 8), orcamento_origem_id: ORC } });
      expect([404, 405], `POST /v1/vendedor/pedidos: ${post.body}`).toContain(post.statusCode);
      const putPedido = await api.chamar(token.vendedor, { method: 'PUT', url: `/v1/vendedor/pedidos/${ORC}`, payload: { ...corpo, tipo: 'pedido' } });
      expect([404, 405], `PUT /v1/vendedor/pedidos/:id: ${putPedido.body}`).toContain(putPedido.statusCode);

      expect(await retrato(ORC)).toEqual(antes);
      expect(await q('select id from vendedor.pedido where orcamento_id = $1', [ORC])).toEqual([]);
    });

    it('U3. Transformar pela rota de envio (pedido NOVO de pedidoDoOrcamento no push): a alçada é recalculada → pending_approval nível supervisor, criado@1 + aprovacao_solicitada@1 sem aprovado@1, em "Para aprovar"; o orçamento segue orçamento', async () => {
      const payload = pedidoDoOrcamento(await doAparelho(ORC), PED, new Date().toISOString());
      envioPed = payload as unknown as Record<string, unknown>;
      expect(payload).toMatchObject({ id: PED, tipo: 'pedido', orcamento_origem_id: ORC, discount_pct: 8 });
      await lucas.motor.enfileirar({ id: PED, entidade: 'pedido', payload });
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(lucas.motor.estado().fila).toEqual([]);

      const ped = await noBanco(PED);
      const orc = await noBanco(ORC);
      expect(ped).toMatchObject({ tipo: 'pedido', orcamento_id: ORC, status: 'pending_approval', nivel_aprovacao: 'supervisor', desconto_pct: 8, total_cents: orc!.total_cents });
      expect((await historico(PED)).map((h) => h.para)).toEqual(['received', 'pending_approval']);
      const ev = await eventos(PED);
      expect(ev).toEqual(expect.arrayContaining([EV.criado, EV.solicitada]));
      expect(ev).not.toContain(EV.aprovado);
      expect(await paraAprovarDaSupervisora()).toContain(PED);
      expect(await realizadoDoLucas(), 'pendente de aprovação ainda não conta na meta (base aprovado)').toBe(realizadoAntes);
      expect(orc).toMatchObject({ tipo: 'orcamento', status: 'received', nivel_aprovacao: null });
      expect(await eventos(ORC)).toEqual([]);
      await sincronizar();
      expect(await linhaNoAparelho(ORC)).toMatchObject({ convertido_pedido_id: PED });
      expect(await linhaNoAparelho(PED)).toMatchObject({ status: 'pending_approval' });
    });

    // ------------------------------------------------------------------------- U5: pedido enviado × desconto no push
    it('U5a. pedido enviado (pendente, 8%) não aceita outro desconto pelo push: 3% (fugiria da aprovação) ou desconto no item = conflito; nada muda', async () => {
      const antes = await retrato(PED);
      const [igual] = await push(token.vendedor, [item(envioPed)]);
      expect(igual, 'o reenvio idêntico é aceito (RN-VEN-33): a diferença abaixo é só o desconto').toMatchObject({ id: PED, status: 'aceito' });
      const res = await push(token.vendedor, [
        item({ ...envioPed, discount_pct: 3 }),
        item({ ...envioPed, items: (envioPed.items as Array<Record<string, unknown>>).map((i, n) => (n === 0 ? { ...i, desconto_pct: 10, ajuste_em: 'pct' } : i)) }),
      ]);
      expect(res.map((r) => r.status), JSON.stringify(res)).toEqual(['conflito', 'conflito']);
      const depois = await retrato(PED);
      expect(depois).toEqual(antes);
      expect(depois.p).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'supervisor', desconto_pct: 8 });
      expect(depois.eventos).not.toContain(EV.aprovado);
    });
  });

  // --------------------------------------------------------------------------- U4: alçada do momento do envio
  describe('Alçada recalculada no Transformar (política vigente no envio)', () => {
    const ORC = randomUUID();
    const PED = randomUUID();

    it('U4. orçamento salvo a 4,65% com o vendedor em 5% (sem nível); a política baixa para 4% → Transformar cai em aprovação, nível supervisor', async () => {
      const [r] = await push(token.vendedor, [item(referencia(ORC))]);
      expect(r).toMatchObject({ id: ORC, status: 'aceito' });
      expect(await noBanco(ORC)).toMatchObject({ tipo: 'orcamento', nivel_aprovacao: null, total_cents: 37979 });
      await sincronizar();
      const o = await doAparelho(ORC);
      await api.admin.query("update plataforma.parametro set valor = '4'::jsonb, updated_at = now() where tenant_id = $1 and modulo = 'vendedor' and chave = 'alcada.vendedor_pct'", [TENANT_DEMO]);
      try {
        const [t] = await push(token.vendedor, [item(pedidoDoOrcamento(o, PED, new Date().toISOString()))]);
        expect(t, JSON.stringify(t)).toMatchObject({ id: PED, status: 'aceito' });
        expect(await noBanco(PED)).toMatchObject({ tipo: 'pedido', orcamento_id: ORC, status: 'pending_approval', nivel_aprovacao: 'supervisor', total_cents: 37979 });
        expect(await eventos(PED)).not.toContain(EV.aprovado);
      } finally {
        await api.admin.query("update plataforma.parametro set valor = '5'::jsonb, updated_at = now() where tenant_id = $1 and modulo = 'vendedor' and chave = 'alcada.vendedor_pct'", [TENANT_DEMO]);
      }
    });
  });

  // --------------------------------------------------------------------------- U5b/U6: aprovado × desconto
  describe('Pedido aprovado não aceita alteração de desconto (push e aparelho)', () => {
    const PED = randomUUID();
    let original: Record<string, unknown>;

    it('U5b. pedido aprovado na hora (3%): reenvio com 20% = conflito; desconto, total, status, histórico e eventos intactos; o reenvio idêntico segue aceito (RN-VEN-33)', async () => {
      original = documento(PED, 'pedido', 3);
      const [r] = await push(token.vendedor, [item(original)]);
      expect(r).toMatchObject({ id: PED, status: 'aceito' });
      expect(await noBanco(PED)).toMatchObject({ tipo: 'pedido', status: 'approved', nivel_aprovacao: null, desconto_pct: 3 });
      const antes = await retrato(PED);
      expect(antes.p!.hash_envio, 'o pedido do push guarda o hash do envio').not.toBeNull();
      const [c] = await push(token.vendedor, [item({ ...original, discount_pct: 20 })]);
      expect(c, JSON.stringify(c)).toMatchObject({ id: PED, status: 'conflito' });
      const [igual] = await push(token.vendedor, [item(original)]);
      expect(igual).toMatchObject({ id: PED, status: 'aceito' });
      expect(await retrato(PED)).toEqual(antes);
    });

    it('U6. pelo aparelho: o motor envia o pedido com o desconto alterado → conflito (fila: falhou/CONFLITO); a linha do pull segue com 3% (servidor vence); o PUT de orçamento não edita pedido (404)', async () => {
      await sincronizar();
      expect(await linhaNoAparelho(PED)).toMatchObject({ status: 'approved' });
      const antes = await retrato(PED);
      const lotes = lucas.lotesEnviados.length;
      await lucas.motor.enfileirar({ id: PED, entidade: 'pedido', payload: { ...original, discount_pct: 15 } });
      await lucas.sincronizar();
      expect(lucas.lotesEnviados.length, 'o envio saiu do aparelho').toBeGreaterThan(lotes);
      // motor (ADR 0009): conflito não reenvia sozinho; fica na fila como falhou/CONFLITO até o vendedor descartar ou duplicar
      const naFila = lucas.motor.estado().fila.find((i) => i.id === PED);
      expect(naFila, JSON.stringify(lucas.motor.estado().fila)).toMatchObject({ situacao: 'falhou', codigo: 'CONFLITO' });
      expect(await retrato(PED), 'o servidor não aplicou os 15%').toEqual(antes);
      const l = await linhaNoAparelho(PED);
      expect(Number(l!.desconto_pct), 'servidor vence: a linha do pull continua com 3%').toBe(3);
      expect(l).toMatchObject({ status: 'approved' });
      await lucas.motor.descartar(PED);
      await sincronizar();
      expect(lucas.motor.estado().fila.map((i) => i.id), 'descartado: nada mais a enviar').not.toContain(PED);
      expect(await retrato(PED)).toEqual(antes);
      expect(Number((await linhaNoAparelho(PED))!.desconto_pct)).toBe(3);

      const { id: _id, tipo: _tipo, created_offline_at: _c, ...corpo } = original;
      void _id;
      void _tipo;
      void _c;
      const e = await api.chamar(token.vendedor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${PED}`, payload: { ...corpo, discount_pct: 15, atualizado_em: String(l!.updated_at) } });
      expect([e.statusCode, codigo(e)], e.body).toEqual([404, 'ORCAMENTO_NAO_ENCONTRADO']);
      expect(await retrato(PED)).toEqual(antes);
    });
  });
});
