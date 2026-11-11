/**
 * T-0149 — critério da demo (R-20261110-182314): "um cliente de cada filial vê o preço e o estoque da sua filial, e o pedido leva a
 * filial até a fila do ERP". Base demo com SEED_BOA_VISTA_DEMO = true (db/seeds/demo/filial.ts: 4 clientes na Filial Boa Vista,
 * preço da Manaus + 5%, depósito CD-BVB com o saldo do CD Manaus × 0,6 e o café 500 g zerado) × `createApp` real × Postgres ×
 * DESPACHANTE real; aparelho do Lucas com o motor de sync real. Banco só no CI (sem Docker no PC, R-20261105-053835).
 *
 *  F1 aparelho, offline sobre o pull: o cliente da Boa Vista vê o preço da tabela na Boa Vista (= Manaus + 5%, regra da seed) e o
 *     de Manaus o da Manaus (CONSULTA_PRECOS_CLIENTE e vitrine do Catálogo); estoque só da filial do cliente, com o nome dela no
 *     rótulo; café 500 g = 0 na Boa Vista e com saldo em Manaus (sem registro/zerado nunca mostra o de Manaus).
 *  F2 o pedido do cliente da Boa Vista: o recebimento grava o retrato da filial EFETIVA (RN-CORE-39, id em minúsculas, os dois
 *     campos juntos); detalhe do BKO, pull do aparelho e PDFs mostram "0002 · Filial Boa Vista/RR" (uma vez no PDF).
 *  F3 fila do ERP: aprovado@1 → despachante → integracao.pedido_fila_erp com payload.filial {0002, FIL-BVB} e exige_conector 1.4.0
 *     (o ERP Matriz da demo, 1.2.1, não leva); o de Manaus leva {0001, FIL-MAO} sem exigir o 1.4.0 pela filial.
 * Premissa: a demo não tem linha de de-para da condição (integracao.mapeamento; DE_PARA_CONDICAO_DEMO só monta o retrato dos faturados);
 * o analista grava os 4 de-para pela rota do BKO antes do pedido, para o pedido não ficar retido por `mapeamento_ausente`.
 * ORÁCULOS da RN-CORE-39 e da regra escrita no cabeçalho da seed, nunca da função testada. Matriz: docs/testes/T-0149-T-0147.md.
 */
import { randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE, entidadeDeposito, entidadeEstoqueSaldo } from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { OrderDetail } from '@macuxi/vendedor/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { DE_PARA_CONDICAO_DEMO } from '../../../db/seeds/demo/integracao';
import { DEPOSITO_BOA_VISTA_DEMO, idFilialBoaVistaDemo, precoBoaVistaDemo, PRODUTO_SEM_SALDO_BOA_VISTA_DEMO, SEED_BOA_VISTA_DEMO } from '../../../db/seeds/demo/filial';
import { esquecerMemoriaLocal, vitrineLocal } from '../../../modules/catalogo/app/lib/local';
import { buildOrderPdfHtml, pdfDoPedido } from '../../../modules/vendedor/app/lib/order-pdf';
import { montarPedido, prepararPedido, rascunhoVazio, type Rascunho } from '../../../modules/vendedor/app/lib/pedidos';
import { condicoesDoCliente, lerLinhas, listaDeClientes, listaDePedidos, meDoAparelho, politicaApi, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { blindarPool, DEMO, encerrarPool, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

/** Rótulos escritos da seed (nome · UF), no formato do detalhe e do PDF: "código · nome/UF". */
const ROTULO_BV = '0002 · Filial Boa Vista/RR';
const ROTULO_MAO = '0001 · Filial Manaus/AM';

describe.skipIf(semBanco())('T-0149 — demo: um cliente de cada filial vê o preço e o estoque da sua, e o pedido leva a filial até a fila do ERP', () => {
  let api: ApiDemo;
  let worker: pg.Pool;
  let lucas: AparelhoCampo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  const BV = idFilialBoaVistaDemo().toLowerCase();
  let MAO = '';
  /** Cliente do Lucas na Boa Vista e outro em Manaus, na MESMA tabela de preço (oráculo relativo do +5%). */
  let cli = { bv: '', mao: '', tabela: '' };
  const pedidos = { bv: '', mao: '' };

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
    for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 60 ciclos');
  };

  /** Preços do cliente pela consulta do Catálogo NO APARELHO (offline, sobre as linhas do pull), por produto. */
  const precosNoAparelho = async (clienteId: string) => {
    const l = await lerLinhas(lucas.motor);
    const r = await lucas.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: clienteId, produto_ids: l.produtos.map((p) => p.id), em: new Date().toISOString() });
    return new Map(r.itens.filter((i) => i.preco_cents != null).map((i) => [i.produto_id, i.preco_cents as number]));
  };
  /** Estoque por filial pelo banco (oráculo): soma dos depósitos vivos da filial, por produto. */
  const saldoDaFilial = async (filialId: string) =>
    new Map(
      (
        await linhas<{ produto_id: string; q: string }>(
          `select s.produto_id, sum(trunc(s.quantidade))::text as q from catalogo.estoque_saldo s join catalogo.deposito d on d.id = s.deposito_id
            where s.tenant_id = $1 and d.filial_id = $2 and s.deleted_at is null and d.deleted_at is null group by s.produto_id`,
          [TENANT_DEMO, filialId],
        )
      ).map((x) => [x.produto_id, Number(x.q)]),
    );

  /** Novo pedido pela tela do Campo (mesmas funções do app): itens com saldo na filial do cliente, sem desconto. */
  const tirarPedido = async (clienteId: string, produtoIds: string[]) => {
    const l = await lerLinhas(lucas.motor);
    const u = lucas.sessao.usuario;
    const params = lucas.motor.parametros('vendedor');
    const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => c.id === clienteId);
    expect(cliente, 'cliente na carteira do aparelho').toBeDefined();
    const catalogo = produtosComPrecos(l, await precosNoAparelho(clienteId));
    const conds = condicoesDoCliente(l, clienteId);
    const rascunho: Rascunho = {
      ...rascunhoVazio(clienteId),
      lines: Object.fromEntries(produtoIds.map((p) => [p, 2])),
      discount_pct: 0,
      condicao_pagamento_id: conds[0]?.id ?? null,
      payment_terms: conds[0]?.descricao ?? 'À vista',
    };
    const eu = meDoAparelho({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: lucas.sessao.tenant.fuso }, params, new Date()).seller;
    const { v } = prepararPedido({ rascunho, cliente: cliente!, catalogo, politica: politicaApi(params), eu, filaDoClienteCents: 0 });
    const id = randomUUID();
    await lucas.motor.enfileirar({ id, entidade: 'pedido', payload: montarPedido({ id, cliente: cliente!, rascunho, v, semSinal: false, agora: new Date().toISOString() }) });
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
    return id;
  };
  const pedidoNoBanco = async (id: string) =>
    (await linhas<{ status: string; filial_id: string | null; filial: Record<string, unknown> | null }>('select status, filial_id::text as filial_id, filial from vendedor.pedido where id = $1', [id]))[0];
  /** aprovado@1 sai na aprovação: dentro da alçada é na hora; se o pedido for para aprovação (crédito etc.), o gerente aprova. */
  const garantirAprovado = async (id: string) => {
    const p = await pedidoNoBanco(id);
    expect(p, 'pedido gravado').toBeDefined();
    if (p!.status === 'pending_approval') {
      const r = await api.chamar(token.gerente, { method: 'POST', url: `/v1/vendedor/pedidos/${id}/aprovar`, payload: {} });
      expect(r.statusCode, r.body).toBe(200);
    }
    expect((await pedidoNoBanco(id))!.status).toBe('approved');
  };
  const filaErp = async (id: string) =>
    (
      await linhas<{ estado: string; payload: Record<string, unknown> | null; payload_origem: Record<string, unknown>; retencao_codigo: string | null; retencao_mensagem: string | null; exige_conector: string | null }>(
        'select estado, payload, payload_origem, retencao_codigo, retencao_mensagem, exige_conector from integracao.pedido_fila_erp where pedido_uuid = $1 and deleted_at is null',
        [id],
      )
    )[0];

  beforeAll(async () => {
    api = await subirApiDemo();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): a fila do ERP precisa do despachante');
    worker = blindarPool(new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 }));
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    await despachar();
    MAO = (await linhas<{ id: string }>('select id::text as id from core.filial where tenant_id = $1 and padrao and deleted_at is null', [TENANT_DEMO]))[0]!.id;
    // clientes vendáveis do Lucas (ativo, sem bloqueio, cadastro completo) por filial e tabela
    const cart = await linhas<{ cliente_id: string; filial_id: string; tabela_id: string }>(
      `select c.cliente_id::text as cliente_id, cl.filial_id::text as filial_id, t.tabela_preco_id::text as tabela_id
         from core.carteira c
         join core.cliente cl on cl.id = c.cliente_id and cl.deleted_at is null and cl.ativo and not cl.bloqueado and not cl.cadastro_incompleto
         join catalogo.cliente_tabela_preco t on t.cliente_id = c.cliente_id and t.deleted_at is null
        where c.tenant_id = $1 and c.usuario_id = $2 and c.deleted_at is null order by cl.nome_fantasia, c.cliente_id`,
      [TENANT_DEMO, usuarioId.vendedor],
    );
    const bv = cart.find((c) => c.filial_id === BV && cart.some((m) => m.filial_id === MAO && m.tabela_id === c.tabela_id));
    expect(bv, 'a demo tem cliente do Lucas na Boa Vista com um par em Manaus na mesma tabela (SEED_BOA_VISTA_DEMO)').toBeDefined();
    cli = { bv: bv!.cliente_id, mao: cart.find((m) => m.filial_id === MAO && m.tabela_id === bv!.tabela_id)!.cliente_id, tabela: bv!.tabela_id };
    // de-para da condição pela rota do BKO (premissa no cabeçalho)
    for (const m of DE_PARA_CONDICAO_DEMO) {
      const r = await api.chamar(token.analista, { method: 'PUT', url: '/v1/integracao/mapeamentos', payload: { tipo: m.tipo, codigo_macuxi: m.codigo_macuxi, codigo_erp: m.codigo_erp, descricao: m.codigo_macuxi, ativo: true } });
      expect(r.statusCode, `de-para ${m.codigo_macuxi}: ${r.body}`).toBe(200);
    }
    await esperarHorizonte();
    lucas = await aparelhoCampo(api, DEMO.vendedor, { entidadesExtras: [entidadeDeposito, entidadeEstoqueSaldo] });
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  }, 300_000);

  afterAll(async () => {
    await encerrarPool(worker);
    await api?.fechar();
  });

  it('F0. a chave da seed está ligada e a demo tem as 2 filiais vivas (0001 Manaus padrão e 0002 Boa Vista) no aparelho do Lucas', async () => {
    expect(SEED_BOA_VISTA_DEMO).toBe(true);
    const filiais = (await lucas.motor.linhas<{ id: string; codigo: string; padrao: boolean; deleted_at: string | null } & LinhaSync>('filial')).filter((f) => !f.deleted_at);
    expect(filiais.map((f) => [f.codigo, f.id.toLowerCase(), f.padrao]).sort()).toEqual([['0001', MAO, true], ['0002', BV, false]]);
  });

  it('F1a. preço: o cliente da Boa Vista vê a tabela na Boa Vista (= Manaus + 5%, regra da seed) e o de Manaus a da Manaus, no aparelho (offline)', async () => {
    const [pb, pm] = [await precosNoAparelho(cli.bv), await precosNoAparelho(cli.mao)];
    expect(pm.size, 'o cliente de Manaus tem preço').toBeGreaterThan(0);
    // oráculo da Manaus: o item da tabela na filial padrão, gravado no banco
    const itensMao = new Map(
      (await linhas<{ produto_id: string; preco_cents: string }>("select produto_id::text, preco_cents::text from catalogo.tabela_preco_item where tabela_preco_id = $1 and filial_id = $2 and deleted_at is null and unidade is null", [cli.tabela, MAO])).map((x) => [x.produto_id, Number(x.preco_cents)]),
    );
    let comparados = 0;
    for (const [produto, manaus] of pm) {
      if (itensMao.has(produto)) expect(manaus, `Manaus ${produto}`).toBe(itensMao.get(produto));
      expect(pb.get(produto), `Boa Vista ${produto}: Manaus ${manaus} + 5%`).toBe(precoBoaVistaDemo(manaus));
      comparados += 1;
    }
    expect(comparados).toBe(pb.size);
  });

  it('F1b. estoque: cada cliente vê só o saldo da sua filial, com o nome dela no rótulo; o café 500 g é 0 na Boa Vista e tem saldo em Manaus', async () => {
    const [sb, sm] = [await saldoDaFilial(BV), await saldoDaFilial(MAO)];
    // a seed: CD-BVB existe na Boa Vista
    expect(await linhas('select 1 from catalogo.deposito where tenant_id = $1 and codigo = $2 and filial_id = $3 and deleted_at is null', [TENANT_DEMO, DEPOSITO_BOA_VISTA_DEMO.codigo, BV])).toHaveLength(1);
    const cafe = (await linhas<{ id: string }>('select id::text as id from core.produto where tenant_id = $1 and sku = $2', [TENANT_DEMO, PRODUTO_SEM_SALDO_BOA_VISTA_DEMO]))[0]!.id;
    expect(sm.get(cafe) ?? 0, 'café com saldo em Manaus').toBeGreaterThan(0);
    for (const [clienteId, saldos, nome] of [[cli.bv, sb, 'Filial Boa Vista'], [cli.mao, sm, 'Filial Manaus']] as const) {
      esquecerMemoriaLocal();
      const r = await vitrineLocal(lucas.motor, { perfil: 'vendedor', parametros: lucas.motor.parametros('catalogo'), agora: new Date().toISOString(), clienteId, fuso: 'America/Manaus', limit: 500, offset: 0 });
      expect(r.items.length, nome).toBeGreaterThan(0);
      for (const item of r.items) {
        const esperado = saldos.get(item.id) ?? 0; // RN-CORE-39: sem registro na filial = 0
        expect(item.availability?.quantity ?? 0, `${nome} ${item.id}`).toBe(esperado);
        if (esperado > 0) expect(item.availability?.by_branch.map((b) => b.branch_name), `${nome} ${item.id}`).toEqual([nome]);
      }
      const doCafe = r.items.find((i) => i.id === cafe);
      if (clienteId === cli.bv) expect(doCafe?.availability?.quantity ?? 0, 'café na Boa Vista').toBe(0);
      else expect(doCafe?.availability?.quantity, 'café em Manaus').toBe(sm.get(cafe));
    }
  });

  it('F2. o pedido do cliente da Boa Vista grava o retrato da filial EFETIVA; detalhe do BKO, pull do aparelho e os 2 PDFs mostram "0002 · Filial Boa Vista/RR"', async () => {
    const sb = await saldoDaFilial(BV);
    const precos = await precosNoAparelho(cli.bv);
    const itens = [...precos.keys()].filter((p) => (sb.get(p) ?? 0) >= 10).slice(0, 2);
    expect(itens, 'há 2 produtos com preço e saldo na Boa Vista').toHaveLength(2);
    pedidos.bv = await tirarPedido(cli.bv, itens);
    const banco = await pedidoNoBanco(pedidos.bv);
    // oráculo (RN-CORE-39 + seed): id em minúsculas e o retrato completo da 0002, os dois campos juntos
    expect(banco).toMatchObject({ filial_id: BV, filial: { id: BV, codigo: '0002', nome: 'Filial Boa Vista', cidade: 'Boa Vista', uf: 'RR', external_id: 'FIL-BVB', padrao: false } });
    await garantirAprovado(pedidos.bv);
    // BKO
    const d = await api.get(token.analista, `/v1/vendedor/pedidos/${pedidos.bv}`);
    expect(d.status, JSON.stringify(d.corpo)).toBe(200);
    const det = OrderDetail.parse(d.corpo);
    expect([det.branch_id, det.branch_name]).toEqual([BV, ROTULO_BV]);
    const ctx = { tenant_name: 'Distribuidora Exemplo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: new Date().toISOString() };
    // T-0159 (spec final): a filial de faturamento sai no cabeçalho das 4 versões (linhas .emit) e a célula "Filial" saiu da ficha.
    const pdfs = (['customer', 'bko'] as const).map((v) => buildOrderPdfHtml(pdfDoPedido(det), v, ctx));
    const fmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const cnpjBv = det.filial?.cnpj?.replace(/\D/g, '');
    const daManaus = (await linhas<{ cnpj: string | null }>(`select to_jsonb(f)->>'cnpj' as cnpj from core.filial f where f.id = $1`, [MAO]))[0]?.cnpj?.replace(/\D/g, '');
    for (const html of pdfs) {
      expect(html, 'sem a célula Filial na ficha').not.toMatch(/>\s*Filial\s*</);
      if (cnpjBv) expect(html, 'CNPJ da filial Boa Vista no cabeçalho').toContain(`CNPJ ${fmt(cnpjBv)}`);
      if (daManaus && daManaus !== cnpjBv) expect(html, 'nada do CNPJ da Manaus no pedido da Boa Vista').not.toContain(fmt(daManaus));
    }
    // aparelho (pull)
    await esperarHorizonte();
    expect(await lucas.sincronizar()).toBe(true);
    const naLista = listaDePedidos(await lerLinhas(lucas.motor), lucas.motor.parametros('vendedor')).find((o) => o.id === pedidos.bv);
    expect(naLista).toMatchObject({ branch_id: BV, branch_name: ROTULO_BV });
  });

  it('F3. fila do ERP: o pedido da Boa Vista chega com filial {0002, FIL-BVB} e exige o Conector 1.4.0; o de Manaus leva {0001, FIL-MAO} sem exigir o 1.4.0 pela filial', async () => {
    expect(pedidos.bv, 'F2 gravou o pedido da Boa Vista').not.toBe('');
    const sm = await saldoDaFilial(MAO);
    const itensMao = [...(await precosNoAparelho(cli.mao)).keys()].filter((p) => (sm.get(p) ?? 0) >= 10).slice(0, 2);
    pedidos.mao = await tirarPedido(cli.mao, itensMao);
    expect(await pedidoNoBanco(pedidos.mao)).toMatchObject({ filial_id: MAO, filial: { codigo: '0001', external_id: 'FIL-MAO', padrao: true } });
    await garantirAprovado(pedidos.mao);
    await despachar();

    const bv = await filaErp(pedidos.bv);
    expect(bv, 'aprovado@1 do pedido da Boa Vista entrou na fila do ERP').toBeDefined();
    expect(bv!.retencao_codigo, bv!.retencao_mensagem ?? '').toBeNull();
    expect(bv!.payload_origem.filial).toMatchObject({ codigo: '0002', external_id: 'FIL-BVB' });
    expect(bv!.payload!.filial).toMatchObject({ codigo: '0002', external_id: 'FIL-BVB', padrao: false });
    expect([bv!.estado, bv!.exige_conector]).toEqual(['pendente', '1.4.0']);

    const mao = await filaErp(pedidos.mao);
    expect(mao, 'aprovado@1 do pedido de Manaus entrou na fila do ERP').toBeDefined();
    expect(mao!.retencao_codigo, mao!.retencao_mensagem ?? '').toBeNull();
    expect(mao!.payload!.filial).toMatchObject({ codigo: '0001', external_id: 'FIL-MAO', padrao: true });
    expect(mao!.exige_conector).not.toBe('1.4.0');
    const dm = OrderDetail.parse((await api.get(token.analista, `/v1/vendedor/pedidos/${pedidos.mao}`)).corpo);
    expect(dm.branch_name).toBe(ROTULO_MAO);
  });
});
