/**
 * T-0029 (onda 3) — ponta a ponta do PEDIDO na base de demo, com o `createApp` REAL (8 módulos, JWT, Postgres como
 * `macuxi_app`, RLS) e as consultas entre módulos REAIS (`catalogo.precos_cliente@1` e `core.cadastro_resumo@1`, ADR 0012).
 * Desenho: docs/desenho/T-0029.md §12 (casos 1 a 12). Matriz: tests/plano/demo-matriz.md.
 *
 * O "app" é o que o shell mobile monta sem React Native: o motor de sync real com as entidades que os módulos registram no
 * aparelho e a consulta de preço do Catálogo sobre as linhas locais; o pedido é montado pelas MESMAS funções da tela de
 * novo pedido (`lerLinhas` → `listaDeClientes`/`produtosComPrecos` → `prepararPedido` → `montarPedido` → fila do motor).
 * Gestão = o mesmo motor com a supervisora/gerente + as rotas de decisão; BKO = as rotas que a página Pedidos chama.
 * PDF = o gerador puro do domínio (`pdfDoPedido` + `buildOrderPdfHtml`) sobre o detalhe da API.
 *
 * Banco: base `demo` + fixture dois-tenants (A e B) no MESMO banco efêmero, para provar que nada vaza entre tenants.
 * O `produto` do Core entrou no app durante a onda 3 (R-20261101-080519-testes → R-20261101-081147-modulo-core).
 */
import { randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { formatBRL } from '@macuxi/comum';
import type { CustomerSummary } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { OrderDetail, STATUS_CONTRATO, type PedidoPush } from '@macuxi/vendedor/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrderPdfHtml, pdfDoPedido } from '../../../modules/vendedor/app/lib/order-pdf';
import { prepararPedido, montarPedido, rascunhoVazio, type OrderDisplay, type Rascunho } from '../../../modules/vendedor/app/lib/pedidos';
import { condicoesDoCliente, detalheDoPedido, lerLinhas, listaDeClientes, listaDePedidos, meDoAparelho, paraAprovar, politicaApi, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { A, B, licenca } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, listaDe, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

const EVENTOS = {
  criado: 'vendedor.pedido.criado@1',
  status: 'vendedor.pedido.status_alterado@1',
  solicitada: 'vendedor.pedido.aprovacao_solicitada@1',
  aprovado: 'vendedor.pedido.aprovado@1',
} as const;

interface Tirado {
  id: string;
  payload: PedidoPush;
  display: OrderDisplay;
  cliente: CustomerSummary;
}

describe.skipIf(semBanco())('T-0029 — pedido ponta a ponta: Campo (sync) → Gestão → BKO → PDF (base demo × createApp real × Postgres)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  /** Aparelho do Lucas (vendedor@), sincronizado no caso 1 e reaproveitado. */
  let lucas: AparelhoCampo;
  /** O pedido de 8% do caminho feliz (casos 1 a 7). */
  let feliz: Tirado;

  const linhas = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const pedidoNoBanco = async (id: string) =>
    (
      await linhas<{ id: string; status: string; numero: string | null; nivel_aprovacao: string | null; aprovacao_automatica: boolean; total_cents: string; desconto_pct: string; tenant_id: string }>(
        'select id, status, numero, nivel_aprovacao, aprovacao_automatica, total_cents::text, desconto_pct::text, tenant_id from vendedor.pedido where id = $1',
        [id],
      )
    )[0];
  const historico = async (id: string) =>
    linhas<{ de: string | null; para: string; autor_id: string; acima_do_nivel: boolean }>(
      'select de, para, autor_id, acima_do_nivel from vendedor.pedido_evento where pedido_id = $1 order by ocorrido_em, created_at, (de is not null)',
      [id],
    );
  const eventos = async (id: string) =>
    linhas<{ nome: string; tenant_id: string; payload: Record<string, unknown> }>('select nome, tenant_id, payload from plataforma.evento where agregado_id = $1 order by ocorrido_em, created_at', [id]);
  const push = async (tk: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const post = (tk: string, url: string, payload: object = {}) => api.chamar(tk, { method: 'POST', url, payload });
  const decidir = (quem: ChaveDemo, id: string, acao: 'aprovar' | 'rejeitar', payload: object = {}) => post(token[quem], `/v1/vendedor/pedidos/${id}/${acao}`, payload);
  const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;

  /** Aparelho do Campo/Gestão como o APK monta (entidades e consulta de preço que os módulos registram no app). */
  const aparelho = (chave: ChaveDemo) => aparelhoCampo(api, DEMO[chave]);

  /** Clientes da carteira do Lucas com a tabela de preço (Varejo tem os 24 produtos; Atacado, 21). */
  const clientesDoLucas = () =>
    linhas<{ cliente_id: string; tabela: string; itens: number }>(
      `select c.cliente_id, tp.nome as tabela, (select count(*)::int from catalogo.tabela_preco_item i where i.tabela_preco_id = tp.id and i.deleted_at is null) as itens
         from core.carteira c
         join catalogo.cliente_tabela_preco t on t.cliente_id = c.cliente_id and t.deleted_at is null
         join catalogo.tabela_preco tp on tp.id = t.tabela_preco_id
        where c.tenant_id = $1 and c.usuario_id = $2 and c.deleted_at is null order by c.cliente_id`,
      [TENANT_DEMO, usuarioId.vendedor],
    );

  /**
   * Novo pedido pela tela do Campo: cliente da carteira no aparelho, produtos com o preço da consulta do Catálogo, condição
   * permitida, validação local (`prepararPedido`, mesma regra do servidor) e o `PedidoPush` na fila do motor.
   */
  const tirarPedido = async (ap: AparelhoCampo, o: { clienteId: string; desconto: number; itens?: number; condicaoId?: string | null }): Promise<Tirado> => {
    const l = await lerLinhas(ap.motor);
    const u = ap.sessao.usuario;
    const params = ap.motor.parametros('vendedor');
    const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => c.id === o.clienteId);
    expect(cliente, 'cliente na carteira do aparelho').toBeDefined();
    const r = await ap.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente!.id, produto_ids: l.produtos.map((p) => p.id), em: new Date().toISOString() });
    const catalogo = produtosComPrecos(l, new Map(r.itens.map((i) => [i.produto_id, i.preco_cents])));
    const vendaveis = catalogo.filter((p) => p.price_cents != null);
    const conds = condicoesDoCliente(l, cliente!.id);
    const rascunho: Rascunho = {
      ...rascunhoVazio(cliente!.id),
      lines: Object.fromEntries(vendaveis.slice(0, o.itens ?? 2).map((p, i) => [p.id, i + 2])),
      discount_pct: o.desconto,
      condicao_pagamento_id: o.condicaoId === undefined ? (conds[0]?.id ?? null) : o.condicaoId,
      payment_terms: conds[0]?.descricao ?? 'À vista',
    };
    const eu = meDoAparelho({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: ap.sessao.tenant.fuso }, params, new Date()).seller;
    const { v, display } = prepararPedido({ rascunho, cliente: cliente!, catalogo, politica: politicaApi(params), eu, filaDoClienteCents: 0 });
    const id = randomUUID();
    const payload = montarPedido({ id, cliente: cliente!, rascunho, v, semSinal: !ap.online.valor, agora: new Date().toISOString() });
    await ap.motor.enfileirar({ id, entidade: 'pedido', payload });
    return { id, payload, display, cliente: cliente! };
  };
  let varejo: string;
  let atacado: string;

  beforeAll(async () => {
    api = await subirApiDemo({ comDoisTenants: true });
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    const cl = await clientesDoLucas();
    varejo = cl.find((c) => c.itens === 24)!.cliente_id;
    atacado = cl.find((c) => c.itens < 24)!.cliente_id;
    expect([varejo, atacado].every(Boolean), 'a base demo tem clientes do Lucas no Varejo e no Atacado').toBe(true);
    await esperarHorizonte();
    lucas = await aparelho('vendedor');
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ 1 a 7: caminho feliz
  describe('Caminho feliz: 8% (acima da alçada do vendedor, dentro da supervisora)', () => {
    it('1. Campo: o Lucas tira o pedido de 8% na tela (o app já avisa que vai para aprovação), o Sincronizar envia e o pull traz pending_approval, nível supervisor, número e itens com retrato', async () => {
      feliz = await tirarPedido(lucas, { clienteId: varejo, desconto: 8 });
      expect(feliz.display.expected).toBe('pending_approval');
      expect(lucas.motor.estado().fila.map((i) => i.id)).toEqual([feliz.id]);
      expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
      expect(lucas.motor.estado().fila).toEqual([]);
      const banco = await pedidoNoBanco(feliz.id);
      expect(banco).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'supervisor', aprovacao_automatica: false, tenant_id: TENANT_DEMO });
      expect(banco!.numero).toMatch(/^\d{6}$/);
      expect(Number(banco!.total_cents)).toBe(feliz.display.total_cents);
      await esperarHorizonte();
      expect(await lucas.sincronizar()).toBe(true);
      const l = await lerLinhas(lucas.motor);
      const naLista = listaDePedidos(l, lucas.motor.parametros('vendedor')).find((o) => o.id === feliz.id);
      expect(naLista).toMatchObject({ status: 'pending_approval', number: banco!.numero, nivel_aprovacao: 'supervisor', total_cents: feliz.display.total_cents });
      const itens = l.itens.filter((i) => i.pedido_id === feliz.id);
      expect(itens).toHaveLength(2);
      expect(itens.every((i) => i.produto_nome && i.produto_sku && i.preco_tabela_cents > 0)).toBe(true);
    });

    it('2. Gestão: a supervisora vê o pedido da equipe pelo pull (aba "Para aprovar") e pela lista GET pedidos?status=pending_approval', async () => {
      const renata = await aparelho('supervisor');
      expect(await renata.sincronizar(), renata.motor.estado().erro ?? '').toBe(true);
      const l = await lerLinhas(renata.motor);
      expect(paraAprovar(l, 'supervisor').map((p) => p.id)).toContain(feliz.id);
      expect(detalheDoPedido(l, feliz.id, 'supervisor', renata.motor.parametros('vendedor'))?.aprovacao).toMatchObject({ nivel: 'supervisor', pode_decidir: true });
      const r = await api.get(token.supervisor, '/v1/vendedor/pedidos?status=pending_approval');
      expect(r.status).toBe(200);
      expect((listaDe(r.corpo) as Array<{ id: string; pode_decidir?: boolean }>).find((o) => o.id === feliz.id)).toMatchObject({ pode_decidir: true });
    });

    it('3. Gestão: aprovar (1 toque, sem comentário) → 200 approved; histórico null→received→pending_approval→approved (autora = supervisora); auditoria registrada', async () => {
      const r = await decidir('supervisor', feliz.id, 'aprovar');
      expect(r.statusCode, r.body).toBe(200);
      expect(OrderDetail.parse(r.json())).toMatchObject({ id: feliz.id, status: 'approved' });
      const h = await historico(feliz.id);
      expect(h.map((x) => [x.de, x.para])).toEqual([
        [null, 'received'],
        ['received', 'pending_approval'],
        ['pending_approval', 'approved'],
      ]);
      expect(h.at(-1)).toMatchObject({ autor_id: usuarioId.supervisor, acima_do_nivel: false });
      const aud = await linhas<{ usuario_id: string; tenant_id: string }>("select usuario_id, tenant_id from plataforma.auditoria where entidade_id = $1 and acao = 'pedido.aprovar'", [feliz.id]);
      expect(aud).toEqual([{ usuario_id: usuarioId.supervisor, tenant_id: TENANT_DEMO }]);
    });

    it('4. BKO: o analista abre o detalhe (GET pedidos/:id) com approved e o histórico; a lista filtrada por status também; o aparelho do Lucas recebe approved no próximo sync', async () => {
      const d = await api.get(token.analista, `/v1/vendedor/pedidos/${feliz.id}`);
      expect(d.status).toBe(200);
      const det = OrderDetail.parse(d.corpo);
      expect(det.status).toBe('approved');
      expect(det.history.map((e) => e.status)).toEqual(['received', 'pending_approval', 'approved']);
      expect(det.history.at(-1)!.by).toBe('Renata Barros');
      const lista = await api.get(token.analista, '/v1/vendedor/pedidos?status=approved&limite=200');
      expect((listaDe(lista.corpo) as Array<{ id: string }>).map((o) => o.id)).toContain(feliz.id);
      await esperarHorizonte();
      expect(await lucas.sincronizar()).toBe(true);
      const l = await lerLinhas(lucas.motor);
      expect(l.pedidos.find((p) => p.id === feliz.id)?.status).toBe('approved');
    });

    it('5. PDF: versão do cliente com número, cliente, itens e total e NENHUM %; versão interna com o desconto e quem aprovou', async () => {
      const det = OrderDetail.parse((await api.get(token.analista, `/v1/vendedor/pedidos/${feliz.id}`)).corpo);
      const ctx = { tenant_name: 'Distribuidora Exemplo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: new Date().toISOString() };
      const doc = pdfDoPedido(det);
      const cliente = buildOrderPdfHtml(doc, 'customer', ctx);
      expect(cliente).toContain(det.number);
      expect(cliente).toContain(det.cliente!.razao_social);
      for (const i of det.items) expect(cliente).toContain(i.description);
      expect(cliente).toContain(formatBRL(det.total_cents));
      expect(cliente).not.toContain('%');
      const interno = buildOrderPdfHtml(doc, 'bko', ctx);
      expect(interno).toContain('8,0%');
      expect(interno).toContain('Renata Barros');
      // o mesmo PDF no aparelho (offline, pelas linhas do pull) sai com os mesmos número e total
      const local = detalheDoPedido(await lerLinhas(lucas.motor), feliz.id, 'vendedor', lucas.motor.parametros('vendedor'))!;
      expect(pdfDoPedido(local)).toMatchObject({ number: doc.number, total_cents: doc.total_cents });
    });

    it('6. Outbox: criado@1, status_alterado@1 (3), aprovacao_solicitada@1 e aprovado@1, com status no vocabulário RN-VEN-30 e sem dado pessoal', async () => {
      const ev = await eventos(feliz.id);
      const nomes = ev.map((e) => e.nome);
      expect(nomes.filter((n) => n === EVENTOS.criado)).toHaveLength(1);
      expect(nomes.filter((n) => n === EVENTOS.status)).toHaveLength(3);
      expect(nomes.filter((n) => n === EVENTOS.solicitada)).toHaveLength(1);
      expect(nomes.filter((n) => n === EVENTOS.aprovado)).toHaveLength(1);
      expect(ev.every((e) => e.tenant_id === TENANT_DEMO)).toBe(true);
      const vocab = new Set<string>(STATUS_CONTRATO);
      for (const e of ev.filter((x) => x.nome === EVENTOS.status)) {
        if (e.payload.de !== null) expect(vocab.has(String(e.payload.de)), JSON.stringify(e.payload)).toBe(true);
        expect(vocab.has(String(e.payload.para)), JSON.stringify(e.payload)).toBe(true);
      }
      expect(ev.filter((x) => x.nome === EVENTOS.status).map((e) => e.payload.para)).toEqual(['recebido', 'em_aprovacao', 'aprovado']);
      const tudo = JSON.stringify(ev.map((e) => e.payload));
      for (const pessoal of [feliz.cliente.legal_name, feliz.cliente.cnpj, feliz.cliente.phone, 'Lucas Andrade', 'Renata Barros'].filter((x) => x && x.length > 3)) {
        expect(tudo, `dado pessoal no evento: ${pessoal}`).not.toContain(pessoal);
      }
    });

    it('7. Idempotência: o reenvio do MESMO lote (timeout) → aceito, 1 pedido, mesmos itens, nenhum evento novo; mesmo id com outro conteúdo → conflito', async () => {
      const lote = lucas.lotesEnviados.flat().filter((i) => i.id === feliz.id);
      expect(lote.length).toBeGreaterThan(0);
      const antes = { ev: (await eventos(feliz.id)).length, itens: (await linhas('select id from vendedor.pedido_item where pedido_id = $1', [feliz.id])).length };
      expect((await push(token.vendedor, [lote[0]!]))[0]).toMatchObject({ id: feliz.id, status: 'aceito' });
      expect(await linhas('select id from vendedor.pedido where id = $1', [feliz.id])).toHaveLength(1);
      expect((await linhas('select id from vendedor.pedido_item where pedido_id = $1', [feliz.id])).length).toBe(antes.itens);
      expect((await eventos(feliz.id)).length).toBe(antes.ev);
      const outro = { ...lote[0]!, payload: { ...(lote[0]!.payload as PedidoPush), discount_pct: 2 } };
      expect((await push(token.vendedor, [outro]))[0]).toMatchObject({ id: feliz.id, status: 'conflito' });
      expect((await pedidoNoBanco(feliz.id))!.status).toBe('approved');
    });
  });

  // ------------------------------------------------------------------------------------------------ 8 a 10: alçada e regras
  describe('Alçada e revalidação no servidor (RN-VEN-10, RN-CAT-06, RN-VEN-14, RN-VEN-02)', () => {
    it('8a. Dentro da alçada (3%): approved na hora (aprovacao_automatica, P-1) e aprovado@1 na outbox', async () => {
      const t = await tirarPedido(lucas, { clienteId: varejo, desconto: 3 });
      expect(t.display.expected).toBe('ok');
      expect(await lucas.sincronizar()).toBe(true);
      expect(await pedidoNoBanco(t.id)).toMatchObject({ status: 'approved', aprovacao_automatica: true, nivel_aprovacao: null });
      expect((await eventos(t.id)).map((e) => e.nome)).toContain(EVENTOS.aprovado);
      expect((await eventos(t.id)).map((e) => e.nome)).not.toContain(EVENTOS.solicitada);
    });

    it('8b. 12% → nível gerente: a supervisora recebe 422 RN-VEN-10; o gerente aprova (acima_do_nivel = false)', async () => {
      const t = await tirarPedido(lucas, { clienteId: varejo, desconto: 12 });
      expect(await lucas.sincronizar()).toBe(true);
      expect(await pedidoNoBanco(t.id)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente' });
      const r = await decidir('supervisor', t.id, 'aprovar');
      expect([r.statusCode, codigo(r)]).toEqual([422, 'RN-VEN-10']);
      const g = await decidir('gerente', t.id, 'aprovar');
      expect(g.statusCode, g.body).toBe(200);
      expect((await historico(t.id)).at(-1)).toMatchObject({ para: 'approved', autor_id: usuarioId.gerente, acima_do_nivel: false });
    });

    it('8c. O gerente aprova um pedido do nível supervisor (P-3): acima_do_nivel = true no histórico', async () => {
      const t = await tirarPedido(lucas, { clienteId: varejo, desconto: 7 });
      expect(await lucas.sincronizar()).toBe(true);
      expect(await pedidoNoBanco(t.id)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'supervisor' });
      const g = await decidir('gerente', t.id, 'aprovar');
      expect(g.statusCode, g.body).toBe(200);
      expect((await historico(t.id)).at(-1)).toMatchObject({ para: 'approved', autor_id: usuarioId.gerente, acima_do_nivel: true });
    });

    it('9. Rejeitar sem motivo → 422 RN-GES-08; com motivo → rejected; aprovar depois → 422 RN-VEN-30 (aprovado não volta, P-2)', async () => {
      const t = await tirarPedido(lucas, { clienteId: varejo, desconto: 9 });
      expect(await lucas.sincronizar()).toBe(true);
      for (const motivo of ['', '  ', 'ok']) {
        const r = await decidir('supervisor', t.id, 'rejeitar', { motivo });
        expect([r.statusCode, codigo(r)], JSON.stringify(motivo)).toEqual([422, 'RN-GES-08']);
      }
      const r = await decidir('supervisor', t.id, 'rejeitar', { motivo: 'Desconto acima da política para o cliente' });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ status: 'rejected', rejection_reason: 'Desconto acima da política para o cliente' });
      const de_novo = await decidir('supervisor', t.id, 'aprovar');
      expect([de_novo.statusCode, codigo(de_novo)]).toEqual([422, 'RN-VEN-30']);
      // aprovar de novo o pedido aprovado do caminho feliz = 200 idempotente (mesma decisão)
      const repetida = await decidir('supervisor', feliz.id, 'aprovar');
      expect([repetida.statusCode, (repetida.json() as { status: string }).status]).toEqual([200, 'approved']);
    });

    it('10a. Total adulterado no payload é ignorado: o servidor recalcula pela tabela do cliente (RN-VEN-02)', async () => {
      const t = await tirarPedido(lucas, { clienteId: varejo, desconto: 0 });
      // adultera o total do item da fila antes do envio (o "aparelho" mente o total)
      expect(await lucas.motor.alterar(t.id, { payload: { ...t.payload, total_cents: 1 } })).toBe(true);
      expect(await lucas.sincronizar()).toBe(true);
      const b = await pedidoNoBanco(t.id);
      expect(b!.status).toBe('approved');
      expect(Number(b!.total_cents)).toBe(t.display.total_cents);
      expect(Number(b!.total_cents)).toBeGreaterThan(1);
    });

    it('10b. Produto sem preço para o cliente (Atacado sem açaí) → rejeitado RN-CAT-06; cliente fora da carteira → FORA_DA_CARTEIRA; condição não permitida → RN-VEN-14', async () => {
      const [aca] = await linhas<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ACA-1K'", [TENANT_DEMO]);
      const base = (await tirarPedido(lucas, { clienteId: atacado, desconto: 0 })).payload;
      await lucas.motor.descartar(base.id);
      const semPreco = { ...base, id: randomUUID(), items: [{ product_id: aca!.id, quantity: 1 }] };
      const [doCamila] = await linhas<{ cliente_id: string }>(
        'select cliente_id from core.carteira where tenant_id = $1 and usuario_id = $2 and deleted_at is null and cliente_id not in (select cliente_id from core.carteira where usuario_id = $3 and deleted_at is null) limit 1',
        [TENANT_DEMO, usuarioId.vendedor2, usuarioId.vendedor],
      );
      const foraDaCarteira = { ...base, id: randomUUID(), customer_id: doCamila!.cliente_id };
      // condição ativa que o cliente NÃO tem (clientes com título vencido: só À vista e 28 dias)
      const [restrito] = await linhas<{ cliente_id: string; proibida: string }>(
        `select cc.cliente_id, (select c.id from vendedor.condicao_pagamento c where c.tenant_id = $1 and c.ativo and c.deleted_at is null
                and c.id not in (select condicao_pagamento_id from vendedor.cliente_condicao x where x.cliente_id = cc.cliente_id and x.deleted_at is null) limit 1) as proibida
           from vendedor.cliente_condicao cc join core.carteira k on k.cliente_id = cc.cliente_id and k.usuario_id = $2 and k.deleted_at is null
          where cc.tenant_id = $1 and cc.deleted_at is null group by cc.cliente_id having count(*) < (select count(*) from vendedor.condicao_pagamento where tenant_id = $1 and ativo and deleted_at is null) limit 1`,
        [TENANT_DEMO, usuarioId.vendedor],
      );
      const condicaoProibida = { ...base, id: randomUUID(), customer_id: restrito!.cliente_id, condicao_pagamento_id: restrito!.proibida };
      const casos: Array<[PedidoPush, string]> = [
        [semPreco, 'RN-CAT-06'],
        [foraDaCarteira, 'FORA_DA_CARTEIRA'],
        [condicaoProibida, 'RN-VEN-14'],
      ];
      const res = await push(token.vendedor, casos.map(([p]) => ({ id: p.id, entidade: 'pedido', operacao: 'upsert', payload: p })));
      expect(res.map((r) => [r.status, (r as { codigo?: string }).codigo])).toEqual(casos.map(([, c]) => ['rejeitado', c]));
      expect(await linhas('select id from vendedor.pedido where id = any($1::uuid[])', [casos.map(([p]) => p.id)])).toEqual([]);
    });

    it('10c. 20% → nível analista (acima_gerente = analista); com acima_gerente = bloquear → rejeitado RN-VEN-10', async () => {
      const t = await tirarPedido(lucas, { clienteId: varejo, desconto: 20 });
      expect(await lucas.sincronizar()).toBe(true);
      expect(await pedidoNoBanco(t.id)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'analista' });
      expect((await decidir('gerente', t.id, 'aprovar')).statusCode).toBe(422);
      expect((await decidir('analista', t.id, 'aprovar')).statusCode).toBe(200);
      await api.admin.query(`update plataforma.parametro set valor = '"bloquear"'::jsonb where tenant_id = $1 and modulo = 'vendedor' and chave = 'alcada.acima_gerente'`, [TENANT_DEMO]);
      try {
        const base = (await tirarPedido(lucas, { clienteId: varejo, desconto: 20 })).payload;
        await lucas.motor.descartar(base.id);
        const [r] = await push(token.vendedor, [{ id: base.id, entidade: 'pedido', operacao: 'upsert', payload: base }]);
        expect([r!.status, (r as { codigo?: string }).codigo]).toEqual(['rejeitado', 'RN-VEN-10']);
      } finally {
        await api.admin.query(`update plataforma.parametro set valor = '"analista"'::jsonb where tenant_id = $1 and modulo = 'vendedor' and chave = 'alcada.acima_gerente'`, [TENANT_DEMO]);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ 11 e 12: perfis e licença
  describe('Perfil, escopo e licença (RN-PRO-01, PERFIL_SEM_ACESSO, RN-CORE-04, MODULO_INATIVO)', () => {
    it('11a. Promotor sem o Vendedor (licença da demo): push de pedido rejeitado MODULO_INATIVO; aprovar 403', async () => {
      const id = randomUUID();
      expect((await push(token.promotor, [{ id, entidade: 'pedido', operacao: 'upsert', payload: { ...feliz.payload, id } }]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'MODULO_INATIVO' });
      const r = await decidir('promotor', feliz.id, 'aprovar');
      expect([r.statusCode, codigo(r)]).toEqual([403, 'MODULO_INATIVO']);
    });

    it('11b. Promotor COM o Vendedor no perfil (pior caso): push RN-PRO-01, aprovar 403, GET pedidos só da carteira dele', async () => {
      expect((await licenca(api, token.admin, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      try {
        const id = randomUUID();
        const [p] = await push(token.promotor, [{ id, entidade: 'pedido', operacao: 'upsert', payload: { ...feliz.payload, id } }]);
        expect([p!.status, (p as { codigo?: string }).codigo]).toEqual(['rejeitado', 'RN-PRO-01']);
        const r = await decidir('promotor', feliz.id, 'aprovar');
        expect(r.statusCode).toBe(403);
        expect(['RN-PRO-01', 'PERFIL_SEM_ACESSO']).toContain(codigo(r));
        const l = await api.get(token.promotor, '/v1/vendedor/pedidos?limite=200');
        expect(l.status).toBe(200);
        const carteira = new Set((await linhas<{ cliente_id: string }>('select cliente_id from core.carteira where usuario_id = $1 and deleted_at is null', [usuarioId.promotor])).map((c) => c.cliente_id));
        expect((listaDe(l.corpo) as Array<{ customer_id: string }>).every((o) => carteira.has(o.customer_id))).toBe(true);
        expect(await linhas('select id from vendedor.pedido where id = $1', [id])).toEqual([]);
      } finally {
        expect((await licenca(api, token.admin, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
      }
    });

    it('11c. Vendedor em …/aprovar → 403 PERFIL_SEM_ACESSO; a vendedor2 não vê o pedido do Lucas (404); o admin vê e não decide', async () => {
      const v = await decidir('vendedor', feliz.id, 'aprovar');
      expect([v.statusCode, codigo(v)]).toEqual([403, 'PERFIL_SEM_ACESSO']);
      const c = await api.get(token.vendedor2, `/v1/vendedor/pedidos/${feliz.id}`);
      expect([c.status, c.corpo.codigo]).toEqual([404, 'PEDIDO_NAO_ENCONTRADO']);
      expect((await api.get(token.admin, `/v1/vendedor/pedidos/${feliz.id}`)).status).toBe(200);
      const a = await decidir('admin', feliz.id, 'aprovar');
      expect([a.statusCode, codigo(a)]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    });

    it('12. Licença: Vendedor desligado para o perfil supervisor → some dos módulos efetivos (e da aba no Gestão) e as rotas dão 403 MODULO_INATIVO; religado, volta', async () => {
      expect((await licenca(api, token.admin, 'perfil', 'vendedor', false, 'supervisor')).statusCode).toBe(200);
      try {
        expect((await api.meusModulos(token.supervisor)).modulos.map((m) => m.id)).not.toContain('vendedor');
        const l = await api.get(token.supervisor, '/v1/vendedor/pedidos');
        expect([l.status, l.corpo.codigo]).toEqual([403, 'MODULO_INATIVO']);
        const a = await decidir('supervisor', feliz.id, 'aprovar');
        expect([a.statusCode, codigo(a)]).toEqual([403, 'MODULO_INATIVO']);
        const renata = await aparelho('supervisor');
        expect(await renata.sincronizar()).toBe(true);
        expect(renata.motor.estado().modulosAtivos).not.toContain('vendedor');
      } finally {
        expect((await licenca(api, token.admin, 'perfil', 'vendedor', true, 'supervisor')).statusCode).toBe(200);
      }
      expect((await api.get(token.supervisor, '/v1/vendedor/pedidos')).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ isolamento
  describe('Nenhum vazamento entre tenants (base demo + tenants A e B no mesmo banco)', () => {
    it('o tenant A não lê, não decide e não sobrescreve o pedido da demo; as listas e o pull de cada um só têm o próprio tenant', async () => {
      const vA = await api.sessaoNoTenant(A, 'vendedor@exemplo.com.br');
      const sA = await api.sessaoNoTenant(A, 'supervisor@exemplo.com.br');
      const vB = await api.sessaoNoTenant(B, 'vendedor@exemplo.com.br');
      for (const tk of [vA.access_token, sA.access_token, vB.access_token]) {
        const r = await api.get(tk, `/v1/vendedor/pedidos/${feliz.id}`);
        expect(r.status).not.toBe(200);
        const lista = await api.get(tk, '/v1/vendedor/pedidos?limite=200');
        if (lista.status === 200) expect((listaDe(lista.corpo) as Array<{ id: string }>).map((o) => o.id)).not.toContain(feliz.id);
        const pull = await api.get(tk, '/v1/sync/pull?entidade=pedido');
        if (pull.status === 200) expect(JSON.stringify(pull.corpo)).not.toContain(feliz.id);
      }
      const dA = await post(sA.access_token, `/v1/vendedor/pedidos/${feliz.id}/rejeitar`, { motivo: 'tentativa de outro tenant' });
      expect(dA.statusCode).toBe(404);
      // o mesmo UUID enviado pelo vendedor de A: recusado sem revelar nada, e o pedido da demo fica intacto
      const [x] = await push(vA.access_token, [{ id: feliz.id, entidade: 'pedido', operacao: 'upsert', payload: { ...feliz.payload, customer_id: A.clientes.c1 } }]);
      expect(x!.status).not.toBe('aceito');
      expect(JSON.stringify(x)).not.toContain(TENANT_DEMO);
      expect(await pedidoNoBanco(feliz.id)).toMatchObject({ status: 'approved', tenant_id: TENANT_DEMO });
      // a demo não vê pedido de A/B
      const demo = await api.get(token.analista, '/v1/vendedor/pedidos?limite=200');
      const doTenant = new Set((await linhas<{ id: string }>('select id from vendedor.pedido where tenant_id = $1', [TENANT_DEMO])).map((p) => p.id));
      expect((listaDe(demo.corpo) as Array<{ id: string }>).every((o) => doTenant.has(o.id))).toBe(true);
    });
  });

  it('sanidade: as linhas do pull usadas acima são do tipo do contrato (LinhaSync com id)', async () => {
    const p = await lucas.motor.linhas<LinhaSync>('pedido');
    expect(p.every((x) => typeof x.id === 'string')).toBe(true);
  });
});
