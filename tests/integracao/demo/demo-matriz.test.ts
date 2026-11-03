/**
 * T-0028 — matriz da demo (R-20261101-020623, item 1): cada fluxo do app Campo, do app Gestão e do BKO com a BASE DE
 * DEMO (`carregarDemo`, a mesma do `scripts/demo/subir-demo.ps1`) e o `createApp` REAL (8 módulos, JWT de verdade,
 * Postgres como `macuxi_app`, RLS). O app é o que o shell mobile monta sem React Native: o motor de sync REAL do
 * platform-sdk, as etapas reais (`etapasCore`, `etapasVendedor`) e as funções puras das telas (login, rota, ficha,
 * check-in/checkout, metas, caixa de notificações, repositório do Vendedor, PDF). Só o GPS é do teste.
 *
 * Convenção: `it` = o fluxo FUNCIONA hoje; `it.fails` = o fluxo está QUEBRADO ou NÃO EXISTE (o caso diz o que a demo
 * precisa; quando a correção chega, o `it.fails` fica vermelho e vira `it`). IDs D-Cnn (Campo), D-Gnn (Gestão) e
 * D-Bnn (BKO, lado da API; a tela está em tests/e2e/bko/demo-bko.spec.ts). Matriz: tests/plano/demo-matriz.md.
 * T-0029 (onda 3): os casos de pedido (D-C08..D-C11, D-G03/D-G04, D-B14, D-B26..D-B28) viraram `it` com as telas sobre o
 * pull (`modules/vendedor/app/lib/pull.ts`) e as rotas novas; o ponta a ponta do pedido está em `pedido-fatia.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { semBanco } from '@macuxi/db/teste/estado';
import { dadosDemo } from '@macuxi/db/teste';
import type { CustomerSummary } from '@macuxi/core/contracts';
import { mensagemPerfilForaDoApp, type ItemPush, type LinhaSync, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fazerCheckin, fazerCheckout, type ContextoAcao } from '../../../modules/core/app/lib/acoes-visita';
import { etapasCore } from '../../../modules/core/app/lib/cargas';
import { listarClientesLocais, montarCliente360Local, agruparPorCliente } from '../../../modules/core/app/lib/cliente360-local';
import { entidadesMeta } from '../../../modules/core/app/lib/entidades-meta';
import { armazemDe } from '../../../modules/core/app/lib/estado';
import { entrarComSenha } from '../../../modules/core/app/lib/login';
import { painelLocal } from '../../../modules/core/app/lib/metas-local';
import { contarNaoLidas, montarCaixa } from '../../../modules/core/app/lib/notificacoes';
import { etapasVendedor } from '../../../modules/vendedor/app/etapas';
import { buildOrderPdfHtml, pdfDoPedido, type OrderPdfOrder } from '../../../modules/vendedor/app/lib/order-pdf';
import { detalheDoPedido, lerLinhas, listaDeClientes, listaDePedidos, paraAprovar, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, listaDe, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

/** GPS do "aparelho" (o resto do `dispositivo.ts` é o UUID do Node). */
const gps = vi.hoisted(() => ({ posicao: null as null | { lat: number; lng: number; precisao_m: number | null } }));
vi.mock('../../../modules/core/app/lib/dispositivo', () => ({
  uuid: () => globalThis.crypto.randomUUID(),
  gpsAgora: async () => gps.posicao,
}));

const ETAPAS_CAMPO = [...etapasCore, ...etapasVendedor];

/** Tamanho do catálogo da base demo (33 desde a 0013: +9 da linha automotiva e o detergente 5 L) e os 3 SKUs sem preço no Atacado (RN-CAT-06). */
const PRODUTOS_DEMO = dadosDemo('x')['core.produto'].length;
const SEM_PRECO_NO_ATACADO = ['ACA-1K', 'CRD-90', 'SUC-1L'];

interface Campo {
  ap: AparelhoCampo;
  acao: ContextoAcao;
  armazem: ReturnType<typeof armazemDe>;
}

describe.skipIf(semBanco())('T-0028 — matriz da demo (base demo × createApp real × Postgres)', () => {
  let api: ApiDemo;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;

  const noCampo = async (chave: ChaveDemo): Promise<Campo> => {
    const ap = await aparelhoCampo(api, DEMO[chave], { etapas: ETAPAS_CAMPO, entidadesExtras: entidadesMeta });
    const armazem = armazemDe(ap.motor);
    return { ap, armazem, acao: { motor: ap.motor, armazem, tz: ap.sessao.tenant.fuso, vendedorId: ap.sessao.usuario.id } };
  };
  const push = async (tk: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const visitaNoBanco = async (id: string) => (await api.admin.query('select * from core.visita where id = $1', [id])).rows[0] as Record<string, unknown> | undefined;
  const pedidosDoBanco = async (status?: string) =>
    (
      await api.admin.query<{ id: string; cliente_id: string; vendedor_id: string; status: string; nivel_aprovacao: string | null }>(
        'select id, cliente_id, vendedor_id, status, nivel_aprovacao from vendedor.pedido where tenant_id = $1 and ($2::text is null or status = $2) and deleted_at is null order by numero',
        [TENANT_DEMO, status ?? null],
      )
    ).rows;
  /** Pedido válido do vendedor (cliente da carteira, produto com preço na tabela do cliente) como o `NewOrderScreen` enfileira. */
  const pedidoDoAparelho = async (chave: ChaveDemo): Promise<ItemPush> => {
    const { cliente_id, produto_id } = (
      await api.admin.query<{ cliente_id: string; produto_id: string }>(
        `select c.cliente_id, i.produto_id from core.carteira c
           join catalogo.cliente_tabela_preco t on t.tenant_id = c.tenant_id and t.cliente_id = c.cliente_id and t.deleted_at is null
           join catalogo.tabela_preco_item i on i.tenant_id = t.tenant_id and i.tabela_preco_id = t.tabela_preco_id and i.deleted_at is null
          where c.tenant_id = $1 and c.usuario_id = $2 and c.deleted_at is null order by c.cliente_id, i.produto_id limit 1`,
        [TENANT_DEMO, usuarioId[chave]],
      )
    ).rows[0]!;
    const id = randomUUID();
    return { id, entidade: 'pedido', operacao: 'upsert', payload: { id, customer_id: cliente_id, discount_pct: 0, payment_terms: '28 dias', created_offline_at: new Date().toISOString(), items: [{ product_id: produto_id, quantity: 2 }] } };
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    await esperarHorizonte(); // a base acabou de entrar: o pull só devolve linhas com updated_at < now() − 2 s
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ login (todos)
  describe('Login dos 6 perfis (Campo, Gestão e BKO)', () => {
    it('D-C01/D-G01/D-B01: os 7 entram com código demo e senha da demo pela função de login do app; cada um no app certo', async () => {
      const post = async (caminho: string, corpo: unknown) => {
        const r = await api.app.inject({ method: 'POST', url: `/v1${caminho}`, payload: corpo as object, remoteAddress: `10.28.0.${Math.floor(Math.random() * 250) + 1}` });
        if (r.statusCode >= 400) throw Object.assign(new Error(r.body), { status: r.statusCode });
        return r.json();
      };
      const esperado: Record<ChaveDemo, { perfil: string; campo: boolean; gestao: boolean; web: boolean }> = {
        vendedor: { perfil: 'vendedor', campo: true, gestao: false, web: false },
        vendedor2: { perfil: 'vendedor', campo: true, gestao: false, web: false },
        promotor: { perfil: 'promotor', campo: true, gestao: false, web: false },
        supervisor: { perfil: 'supervisor', campo: false, gestao: true, web: true },
        gerente: { perfil: 'gerente', campo: false, gestao: true, web: true },
        analista: { perfil: 'analista', campo: false, gestao: false, web: true },
        admin: { perfil: 'admin', campo: false, gestao: false, web: true },
      };
      for (const [k, e] of Object.entries(esperado) as [ChaveDemo, (typeof esperado)[ChaveDemo]][]) {
        const s = await entrarComSenha(post, { codigo_empresa: 'demo', email: DEMO[k], senha: 'demo-macuxi' });
        expect(s.usuario.perfil, k).toBe(e.perfil);
        expect(s.tenant.fuso, k).toBe('America/Manaus');
        expect(mensagemPerfilForaDoApp(s.usuario.perfil, 'campo') === null, `${k} no Campo`).toBe(e.campo);
        expect(mensagemPerfilForaDoApp(s.usuario.perfil, 'gestao') === null, `${k} no Gestão`).toBe(e.gestao);
        expect(mensagemPerfilForaDoApp(s.usuario.perfil, 'web') === null, `${k} no BKO`).toBe(e.web);
      }
    });

    it('D-C01b: módulos efetivos (GET /v1/me/modulos) = tenant ∩ perfil do seed (RN-CORE-01): vendedor sem Promotor e sem Gestor, promotor sem Vendedor (RN-PRO-01), gestão com os 4 de base', async () => {
      const ids = async (k: ChaveDemo) => (await api.meusModulos(token[k])).modulos.map((m) => m.id).sort();
      // 02/11: os seeds de módulo (gestor.ts, promotor.ts, pesquisa.ts) somam licenças à base; a conta vem do banco
      const doSeed = async (k: ChaveDemo) =>
        (
          await api.admin.query<{ modulo: string }>(
            `select pm.modulo from plataforma.perfil_modulo pm
               join plataforma.tenant_modulo tm on tm.tenant_id = pm.tenant_id and tm.modulo = pm.modulo and tm.ativo and tm.deleted_at is null
              where pm.tenant_id = $1 and pm.perfil = (select perfil from core.usuario where id = $2) and pm.deleted_at is null`,
            [TENANT_DEMO, usuarioId[k]],
          )
        ).rows
          .map((r) => r.modulo)
          .filter((m) => m === 'core' || api.modulos.some((x) => x.manifesto.id === m))
          .concat('core')
          .filter((m, i, a) => a.indexOf(m) === i)
          .sort();
      for (const k of Object.keys(DEMO) as ChaveDemo[]) expect(await ids(k), `${k}: efetivos = tenant ∩ perfil`).toEqual(await doSeed(k));
      for (const k of ['vendedor', 'vendedor2'] as const) {
        const v = await ids(k);
        expect(v, k).toEqual(expect.arrayContaining(['catalogo', 'core', 'vendedor']));
        expect(v, `${k} sem Promotor e sem Gestor`).not.toEqual(expect.arrayContaining(['promotor']));
        expect(v, `${k} sem Gestor`).not.toContain('gestor');
      }
      const p = await ids('promotor');
      expect(p).toEqual(expect.arrayContaining(['catalogo', 'core', 'promotor']));
      expect(p, 'RN-PRO-01: promotor sem Vendedor').not.toContain('vendedor');
      expect(p).not.toContain('gestor');
      for (const k of ['supervisor', 'gerente', 'analista', 'admin'] as const) expect(await ids(k), k).toEqual(expect.arrayContaining(['catalogo', 'core', 'promotor', 'vendedor']));
    });
  });

  // ------------------------------------------------------------------------------------------------ app Campo
  describe('App Campo', () => {
    it('D-C02: o Sincronizar termina e a rota de hoje chega com 6 paradas (Lucas), 4 (Camila) e 4 (Joana)', async () => {
      for (const [k, n] of [['vendedor', 6], ['vendedor2', 4], ['promotor', 4]] as const) {
        const c = await noCampo(k);
        expect(await c.ap.sincronizar(), `${k}: ${c.ap.motor.estado().erro}`).toBe(true);
        await c.armazem.carregar();
        const rota = c.armazem.obter().rota;
        expect(rota, `${k} sem rota de hoje`).not.toBeNull();
        expect(rota!.stops, k).toHaveLength(n);
        expect(rota!.stops.every((s) => s.customer.lat !== null && s.customer.lng !== null), `${k}: parada sem coordenada`).toBe(true);
      }
    });

    it('D-C03: carteira (Clientes) e Cliente 360 offline: 18 / 12 / 7 clientes; a ficha tem contato com ligar/WhatsApp, títulos e histórico', async () => {
      for (const [k, n] of [['vendedor', 18], ['vendedor2', 12], ['promotor', 7]] as const) {
        const c = await noCampo(k);
        expect(await c.ap.sincronizar()).toBe(true);
        c.ap.online.valor = false; // a ficha abre sem sinal (T-0017)
        const m = c.ap.motor;
        const [clientes, financeiros, titulos, historico, contatos] = await Promise.all([m.linhas('cliente'), m.linhas('cliente_financeiro'), m.linhas('titulo'), m.linhas('historico_compra'), m.linhas('cliente_contato')]);
        const base = { clientes, financeiros, titulos, historico } as unknown as Parameters<typeof listarClientesLocais>[0];
        const lista = listarClientesLocais(base, api.hoje);
        expect(lista, k).toHaveLength(n);
        const id = lista[0]!.id;
        const ficha = montarCliente360Local(
          {
            cliente: clientes.find((x) => x.id === id) as never,
            contatos: (agruparPorCliente(contatos as never[]).get(id) ?? []) as never,
            financeiro: (financeiros.find((f) => (f as unknown as { cliente_id: string }).cliente_id === id) ?? null) as never,
            titulos: (agruparPorCliente(titulos as never[]).get(id) ?? []) as never,
            historico: (agruparPorCliente(historico as never[]).get(id) ?? []) as never,
          },
          api.hoje,
        );
        expect(ficha.ligar, `${k}: ligar`).toBeTruthy();
        expect(ficha.whatsapp, `${k}: whatsapp`).toBeTruthy();
        expect(ficha.titulos.length, `${k}: títulos`).toBeGreaterThan(0);
        expect(ficha.historico.length, `${k}: histórico`).toBeGreaterThan(0);
      }
    });

    it('D-C04: check-in e checkout ONLINE na 1ª parada do Lucas (GPS no cliente): visita gravada com o UUID do aparelho e fechada sem pedido', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      await c.armazem.carregar();
      const parada = c.armazem.obter().rota!.stops[0]!;
      const motivo = c.armazem.obter().motivos.find((m) => m.tipo === 'nao_venda' && !m.exige_foto)!;
      gps.posicao = { lat: parada.customer.lat!, lng: parada.customer.lng!, precisao_m: 10 };
      const ci = await fazerCheckin(c.acao, parada.customer as CustomerSummary, parada.id);
      expect(ci.kind).toBe('created');
      if (ci.kind !== 'created') return;
      expect(ci.foraDoRaio).toBe(false);
      expect(await c.ap.sincronizar()).toBe(true);
      expect(await visitaNoBanco(ci.visit.id)).toMatchObject({ usuario_id: usuarioId.vendedor, cliente_id: parada.customer.id, rota_parada_id: parada.id, checkout_em: null });
      await fazerCheckout(c.acao, ci.visit.id, { resultado: 'sem_pedido', motivo_id: motivo.id });
      expect(await c.ap.sincronizar()).toBe(true);
      expect(c.ap.motor.estado().fila).toEqual([]);
      expect(await visitaNoBanco(ci.visit.id)).toMatchObject({ resultado: 'sem_pedido', motivo_id: motivo.id, fechada_por: 'usuario' });
    });

    it('D-C05: check-in e checkout OFFLINE (modo avião) na 2ª parada; na volta do sinal sobe UMA visita; reenviar o lote não duplica', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      await c.armazem.carregar();
      const parada = c.armazem.obter().rota!.stops[1]!;
      const motivo = c.armazem.obter().motivos.find((m) => m.tipo === 'nao_venda' && !m.exige_foto)!;
      c.ap.online.valor = false;
      gps.posicao = { lat: parada.customer.lat!, lng: parada.customer.lng!, precisao_m: 12 };
      const ci = await fazerCheckin(c.acao, parada.customer as CustomerSummary, parada.id);
      expect(ci.kind).toBe('created');
      if (ci.kind !== 'created') return;
      await fazerCheckout(c.acao, ci.visit.id, { resultado: 'sem_pedido', motivo_id: motivo.id });
      expect(c.armazem.obter().rota!.stops.find((s) => s.id === parada.id)!.status).toBe('done');
      expect(c.ap.motor.estado().fila.map((i) => i.entidade)).toEqual(['visita', 'visita_checkout']);
      expect(await c.ap.sincronizar()).toBe(false);
      expect(await visitaNoBanco(ci.visit.id)).toBeUndefined();
      c.ap.online.valor = true;
      expect(await c.ap.sincronizar()).toBe(true);
      expect(c.ap.motor.estado().fila).toEqual([]);
      expect(await visitaNoBanco(ci.visit.id)).toMatchObject({ resultado: 'sem_pedido', rota_parada_id: parada.id });
      const lote = c.ap.lotesEnviados.flat().filter((i) => i.entidade === 'visita' || i.entidade === 'visita_checkout').filter((i) => i.id === ci.visit.id || (i.payload as { visita_id?: string }).visita_id === ci.visit.id);
      expect((await push(c.ap.token.valor, lote)).map((r) => r.status)).toEqual(['aceito', 'aceito']);
      expect(Number((await api.admin.query('select count(*)::int n from core.visita where id = $1', [ci.visit.id])).rows[0].n)).toBe(1);
    });

    it('D-C06: Metas do mês no aparelho (painel offline): Lucas tem as 4 metas do mês (venda, positivação, cobertura, visitas)', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      const m = c.ap.motor;
      const [paradas, visitas, diarios, metas] = await Promise.all([m.linhas('rota_parada'), m.linhas('visita'), m.linhas('indicador_diario'), m.linhas('meta')]);
      const painel = painelLocal({ paradas, visitas, diarios, metas } as never, m.sobreposicao(), { usuarioId: usuarioId.vendedor, fuso: 'America/Manaus', agora: new Date() });
      expect(painel.metas.map((l) => l.indicador).sort()).toEqual(['cobertura_pct', 'positivacao', 'venda_cents', 'visitas']);
      expect(painel.metas.every((l) => l.meta > 0)).toBe(true);
      // no dia 1º do mês o realizado é 0: os pedidos da base são dos dias úteis ANTERIORES (observação O-2 da matriz)
      expect(painel.indicadores.realizado_cents).toBeGreaterThanOrEqual(0);
    });

    it('D-C07: Notificações: Lucas tem o recado do supervisor não lido; marcar como lida sobe pela fila', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      const caixa = montarCaixa(await c.ap.motor.linhas('notificacao'), c.ap.motor.estado().fila, new Date());
      expect(caixa).toHaveLength(1);
      expect(caixa[0]!.tipo).toBe('recado');
      expect(contarNaoLidas(caixa)).toBe(1);
      const cmd = randomUUID();
      await c.ap.motor.enfileirar({ id: cmd, entidade: 'notificacao_leitura', payload: { id: cmd, notificacao_id: caixa[0]!.id, lida_em: new Date().toISOString() } });
      expect(await c.ap.sincronizar()).toBe(true);
      expect(c.ap.motor.estado().fila).toEqual([]);
      const r = await api.get(token.vendedor, '/v1/core/notificacoes');
      expect((listaDe(r.corpo) as Array<{ lida_em: string | null }>)[0]!.lida_em).toBeTruthy();
    });

    it('D-C08a: os pedidos do Lucas CHEGAM ao aparelho pelo pull (7 pedidos, com itens; 1 aguardando aprovação)', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      const pedidos = await c.ap.motor.linhas<LinhaSync & { status: string }>('pedido');
      expect(pedidos).toHaveLength(7);
      expect(pedidos.filter((p) => p.status === 'pending_approval')).toHaveLength(1);
      expect((await c.ap.motor.linhas('pedido_item')).length).toBeGreaterThan(7);
    });

    it('D-C08: a aba Pedidos mostra os 7 pedidos do Lucas pelas linhas do aparelho (pull), offline (T-0029 §8)', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      c.ap.online.valor = false;
      const lista = listaDePedidos(await lerLinhas(c.ap.motor), c.ap.motor.parametros('vendedor'));
      const doBanco = (await pedidosDoBanco()).filter((p) => p.vendedor_id === usuarioId.vendedor);
      expect(lista.map((o) => o.id).sort()).toEqual(doBanco.map((p) => p.id).sort());
      expect(lista.length).toBeGreaterThanOrEqual(7);
      expect(lista.every((o) => o.number !== '' && o.customer_name !== '' && o.total_cents > 0)).toBe(true);
    });

    it('D-C09: detalhe do pedido com itens, total e histórico — no aparelho (pull) e na API (GET /v1/vendedor/pedidos/:id)', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      const [p] = (await pedidosDoBanco('pending_approval')).filter((x) => x.vendedor_id === usuarioId.vendedor);
      const local = detalheDoPedido(await lerLinhas(c.ap.motor), p!.id, 'vendedor', c.ap.motor.parametros('vendedor'));
      expect(local, 'o pedido está no aparelho').not.toBeNull();
      expect(local!.items.length).toBeGreaterThan(0);
      expect(local!.history.length).toBeGreaterThan(0);
      const r = await api.get(token.vendedor, `/v1/vendedor/pedidos/${p!.id}`);
      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ id: p!.id, status: 'pending_approval', total_cents: local!.total_cents, number: local!.number });
      expect((r.corpo.items as unknown[]).length).toBe(local!.items.length);
    });

    it('D-C10: novo pedido — o aparelho tem a carteira (18), as condições do cliente, os 33 produtos da demo (pull `produto` do Core, R-20261101-081147; 24 → 33 com a 0013, R-20261102-102834) e o preço da tabela do cliente pela consulta do Catálogo, offline (Atacado sem açaí, suco e creme dental: RN-CAT-06)', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      c.ap.online.valor = false;
      const l = await lerLinhas(c.ap.motor);
      const clientes = listaDeClientes(l, { id: usuarioId.vendedor, name: 'Lucas Andrade' });
      expect(clientes).toHaveLength(18);
      expect(l.condicoes.length, 'condições de pagamento no aparelho').toBeGreaterThan(0);
      expect(l.produtos.length, 'produtos (pull `produto` do Core) no aparelho').toBe(PRODUTOS_DEMO);
      for (const cliente of clientes) {
        const r = await c.ap.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente.id, produto_ids: l.produtos.map((p) => p.id), em: new Date().toISOString() });
        const produtos = produtosComPrecos(l, new Map(r.itens.map((i) => [i.produto_id, i.preco_cents])));
        const comPreco = produtos.filter((p) => (p.price_cents ?? 0) > 0);
        expect(comPreco.length, cliente.trade_name).toBeGreaterThanOrEqual(PRODUTOS_DEMO - SEM_PRECO_NO_ATACADO.length);
        if (comPreco.length < PRODUTOS_DEMO) expect(produtos.filter((p) => p.price_cents == null).map((p) => p.erp_code).sort()).toEqual(SEM_PRECO_NO_ATACADO);
      }
    });

    it('D-C11: envio do pedido — o push de `pedido` é aceito, grava vendedor.pedido com o UUID do aparelho e, dentro da alçada, já fica aprovado (P-1)', async () => {
      const item = await pedidoDoAparelho('vendedor');
      const [r] = await push(token.vendedor, [item]);
      expect(r).toMatchObject({ id: item.id, status: 'aceito' });
      expect((await pedidosDoBanco()).find((p) => p.id === item.id)?.status).toBe('approved');
    });

    it('D-C11a: offline → reconexão: o pedido tirado sem sinal fica na fila do aparelho e, com o sinal de volta, sobe UMA vez', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      c.ap.online.valor = false;
      const item = await pedidoDoAparelho('vendedor');
      await c.ap.motor.enfileirar({ id: item.id, entidade: 'pedido', payload: item.payload });
      expect(await c.ap.sincronizar()).toBe(false);
      expect(c.ap.motor.estado().fila.map((i) => i.id)).toContain(item.id);
      expect((await pedidosDoBanco()).some((p) => p.id === item.id)).toBe(false);
      c.ap.online.valor = true;
      expect(await c.ap.sincronizar(), c.ap.motor.estado().erro ?? '').toBe(true);
      expect(c.ap.motor.estado().fila).toEqual([]);
      expect((await pedidosDoBanco()).filter((p) => p.id === item.id)).toHaveLength(1);
      // o reenvio do mesmo lote (timeout, retentativa) não duplica
      const [r] = await push(token.vendedor, [item]);
      expect(r).toMatchObject({ id: item.id, status: 'aceito' });
      expect((await pedidosDoBanco()).filter((p) => p.id === item.id)).toHaveLength(1);
    });

    it('D-C12a: o gerador do PDF do app (order-pdf.ts) monta o documento com os dados reais de um pedido da base', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      const p = (await c.ap.motor.linhas<LinhaSync & { status: string; total_cents: number; total_tabela_cents: number; desconto_pct: number; condicao_pagamento: string | null; created_at: string }>('pedido'))[0]!;
      const itens = (await c.ap.motor.linhas<LinhaSync & { pedido_id: string; quantidade: number; preco_tabela_cents: number; total_cents: number; produto_id: string }>('pedido_item')).filter((i) => i.pedido_id === p.id);
      const ordem: OrderPdfOrder = {
        number: null,
        status: p.status,
        created_at: p.created_at,
        customer: { legal_name: 'Cliente', trade_name: 'Cliente', cnpj: '', address: '', district: '', city: 'Manaus', erp_code: '' },
        seller_name: 'Lucas Andrade',
        payment_terms: p.condicao_pagamento ?? '',
        discount_pct: p.desconto_pct,
        items: itens.map((i) => ({ erp_code: i.produto_id.slice(0, 6), description: 'Produto', quantity: i.quantidade, unit_price_cents: i.preco_tabela_cents, total_cents: i.total_cents })),
        subtotal_cents: p.total_tabela_cents,
        discount_cents: p.total_tabela_cents - p.total_cents,
        total_cents: p.total_cents,
        pending_reason: '',
        rejection_reason: '',
        price_table: 'default',
        branch_name: '',
        erp_order_code: '',
        seller_limit_pct: null,
        history: [],
      };
      const html = buildOrderPdfHtml(ordem, 'customer', { tenant_name: 'Distribuidora Exemplo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: new Date().toISOString() });
      expect(html).toContain('<html');
      expect(html).toContain('Distribuidora Exemplo');
      expect(itens.length).toBeGreaterThan(0);
    });

    it('D-C12: Exportar PDF do detalhe no aparelho (pdfDoPedido): versão do cliente com número e itens, sem nenhum %; a interna com o desconto', async () => {
      const c = await noCampo('vendedor');
      expect(await c.ap.sincronizar()).toBe(true);
      c.ap.online.valor = false;
      const l = await lerLinhas(c.ap.motor);
      const [p] = (await pedidosDoBanco('pending_approval')).filter((x) => x.vendedor_id === usuarioId.vendedor);
      const d = detalheDoPedido(l, p!.id, 'vendedor', c.ap.motor.parametros('vendedor'))!;
      const ctx = { tenant_name: 'Distribuidora Exemplo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: new Date().toISOString() };
      const cliente = buildOrderPdfHtml(pdfDoPedido(d), 'customer', ctx);
      expect(cliente).toContain(d.number);
      for (const i of d.items) expect(cliente).toContain(i.description);
      expect(cliente).not.toContain('%');
      expect(buildOrderPdfHtml(pdfDoPedido(d), 'bko', ctx)).toMatch(/\d+,\d%/);
    });

    it('D-C13: promotor (Joana) não tira pedido: push de pedido rejeitado MODULO_INATIVO e GET /v1/vendedor/pedidos 403 (RN-PRO-01)', async () => {
      const item = await pedidoDoAparelho('vendedor');
      const [r] = await push(token.promotor, [item]);
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'MODULO_INATIVO' });
      const l = await api.get(token.promotor, '/v1/vendedor/pedidos');
      expect([l.status, l.corpo.codigo]).toEqual([403, 'MODULO_INATIVO']);
    });
  });

  // ------------------------------------------------------------------------------------------------ app Gestão
  describe('App Gestão (supervisor Renata)', () => {
    it('D-G02: o Sincronizar do supervisor termina e traz a equipe: 30 clientes, rotas dos 3, recado "pedidos para aprovar" e todos os pedidos da equipe (os pendentes da base inclusive)', async () => {
      await esperarHorizonte(); // pedidos enviados pelos casos do Campo acima entram no pull depois do horizonte
      const c = await noCampo('supervisor');
      expect(await c.ap.sincronizar(), c.ap.motor.estado().erro ?? '').toBe(true);
      expect(await c.ap.motor.linhas('cliente')).toHaveLength(30);
      expect(await c.ap.motor.linhas('notificacao')).toHaveLength(1);
      const pedidos = await c.ap.motor.linhas<LinhaSync & { status: string }>('pedido');
      // a equipe da Renata = Lucas e Camila = todos os pedidos do tenant demo (10 da base + os enviados nesta rodada)
      expect(pedidos.map((p) => p.id).sort()).toEqual((await pedidosDoBanco()).map((p) => p.id).sort());
      expect(pedidos.length).toBeGreaterThanOrEqual(10);
      // a base de demo decide quantos aguardam (T-0029: p05 e p10 com a supervisora, p09 com o gerente): o aparelho traz todos
      const pendentes = await pedidosDoBanco('pending_approval');
      expect(pendentes.length).toBeGreaterThanOrEqual(3);
      expect(pedidos.filter((p) => p.status === 'pending_approval').map((p) => p.id).sort()).toEqual(pendentes.map((p) => p.id).sort());
      // aba "Para aprovar": só o que o nível supervisor decide (P-3)
      const meus = paraAprovar(await lerLinhas(c.ap.motor), 'supervisor').map((p) => p.id).sort();
      expect(meus).toEqual(pendentes.filter((p) => p.nivel_aprovacao === 'supervisor').map((p) => p.id).sort());
      expect(meus.length).toBeGreaterThanOrEqual(2);
      const h = await api.get(token.supervisor, '/v1/core/equipe/hierarquia');
      expect(h.status).toBe(200);
      expect(listaDe(h.corpo).length).toBeGreaterThanOrEqual(3);
    });

    it('D-G03: aprovar o pedido fora da alçada (POST /v1/vendedor/pedidos/:id/aprovar, 1 toque) → approved; o aparelho vê o status novo no próximo sync', async () => {
      const [p] = (await pedidosDoBanco('pending_approval')).filter((x) => x.nivel_aprovacao === 'supervisor');
      const r = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${p!.id}/aprovar`, payload: {} });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ id: p!.id, status: 'approved' });
      expect((await pedidosDoBanco()).find((x) => x.id === p!.id)!.status).toBe('approved');
      await esperarHorizonte();
      const c = await noCampo('supervisor');
      expect(await c.ap.sincronizar()).toBe(true);
      const d = detalheDoPedido(await lerLinhas(c.ap.motor), p!.id, 'supervisor', c.ap.motor.parametros('vendedor'));
      expect(d?.status).toBe('approved');
      expect(d?.history.at(-1)).toMatchObject({ status: 'approved', by: 'Renata Barros' });
    });

    it('D-G04: rejeitar exige motivo (RN-GES-08: sem motivo 422; com motivo → rejected e o motivo vai ao vendedor)', async () => {
      const [p] = (await pedidosDoBanco('pending_approval')).filter((x) => x.nivel_aprovacao === 'supervisor');
      const sem = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${p!.id}/rejeitar`, payload: { motivo: ' ' } });
      expect([sem.statusCode, sem.json().codigo]).toEqual([422, 'RN-GES-08']);
      const r = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${p!.id}/rejeitar`, payload: { motivo: 'Desconto acima da política' } });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ status: 'rejected', rejection_reason: 'Desconto acima da política' });
    });
  });

  // ------------------------------------------------------------------------------------------------ BKO (API das páginas)
  describe('BKO — rotas que cada página chama (analista e admin)', () => {
    const periodo = () => api.hoje.slice(0, 7);
    const OK: Array<[string, string, ChaveDemo]> = [
      ['D-B02 Visitas', '/v1/core/visitas', 'analista'],
      ['D-B03 Indicadores', `/v1/core/indicadores?periodo=PERIODO`, 'analista'],
      ['D-B04 Recados (enviados)', '/v1/core/notificacoes/enviadas?limite=100', 'analista'],
      ['D-B05 Carteira (equipe)', '/v1/core/equipe/hierarquia', 'analista'],
      ['D-B06 Motivos', '/v1/core/motivos', 'analista'],
      ['D-B07 Coordenadas sugeridas', '/v1/core/coordenadas-sugeridas', 'analista'],
      ['D-B08 Aparelhos', '/v1/core/dispositivos', 'admin'],
      ['D-B09 Usuários e módulos', '/v1/core/licencas', 'admin'],
      ['D-B10 Rotas (lista da semana)', `/v1/core/rotas?de=HOJE&ate=HOJE`, 'analista'],
      ['D-B11 Lista de pedidos da API nova (página Pedidos)', '/v1/vendedor/pedidos', 'analista'],
      ['D-B11 Lista de pedidos da API nova (admin, T-0029 §7)', '/v1/vendedor/pedidos', 'admin'],
      ['D-B29 Auditoria (T-0030, rota nova de plataforma)', '/v1/auditoria?limite=300', 'analista'],
      ['D-B29 Auditoria (T-0030, admin)', '/v1/auditoria?limite=300', 'admin'],
    ];
    for (const [nome, url, quem] of OK) {
      it(`${nome}: ${url} responde 200 para ${quem}`, async () => {
        const r = await api.get(token[quem], url.replace('PERIODO', periodo()).replace(/HOJE/g, api.hoje));
        expect(r.status, JSON.stringify(r.corpo)).toBe(200);
      });
    }

    it('D-B12 Cliente 360 do BKO: GET /v1/core/clientes/:id de um cliente do Lucas responde 200 com títulos e contatos', async () => {
      const lista = listaDe((await api.get(token.analista, `/v1/core/usuarios/${usuarioId.vendedor}/clientes`)).corpo) as Array<{ cliente_id?: string; id?: string }>;
      expect(lista).toHaveLength(18);
      const id = lista[0]!.cliente_id ?? lista[0]!.id!;
      const r = await api.get(token.analista, `/v1/core/clientes/${id}`);
      expect(r.status).toBe(200);
    });

    it('D-B13 Recados: o analista envia um recado ao Lucas e ele chega na caixa do app', async () => {
      const r = await api.chamar(token.analista, { method: 'POST', url: '/v1/core/notificacoes', payload: { id: randomUUID(), titulo: 'Ensaio da demo', corpo: 'Teste da matriz T-0028', prioridade: 'normal', usuario_ids: [usuarioId.vendedor] } });
      expect([200, 201], r.body).toContain(r.statusCode);
      const caixa = listaDe((await api.get(token.vendedor, '/v1/core/notificacoes')).corpo) as Array<{ titulo: string }>;
      expect(caixa.some((n) => n.titulo === 'Ensaio da demo')).toBe(true);
    });

    it('D-B14 (T-0029 §7, O-1 resolvida): o admin VÊ os pedidos do tenant (lista 200, como o pull) e não decide (aprovar 403 PERFIL_SEM_ACESSO)', async () => {
      const r = await api.get(token.admin, '/v1/vendedor/pedidos?limite=200');
      expect(r.status, JSON.stringify(r.corpo)).toBe(200);
      expect((listaDe(r.corpo) as Array<{ id: string }>).map((p) => p.id).sort()).toEqual((await pedidosDoBanco()).map((p) => p.id).sort());
      expect((await api.get(token.admin, '/v1/sync/pull?entidade=pedido')).status).toBe(200);
      const [p] = await pedidosDoBanco('pending_approval');
      const a = await api.chamar(token.admin, { method: 'POST', url: `/v1/vendedor/pedidos/${p!.id}/aprovar`, payload: {} });
      expect([a.statusCode, a.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    });

    // T-0030: Rotas usa a sessão (sem /v1/me) e Clientes (farol), Metas e RV e Plano de RV viraram "em construção"
    // (EmBrevePage; as telas reais ficam para a Sprint 2). As rotas da Fase M seguem 404 na API nova, mas o BKO do
    // Core não as chama mais: o fonte de modules/core/web não cita nenhuma delas.
    const FASE_M_CORE: Array<[string, string, RegExp]> = [
      ['D-B10/D-B20 Rotas (useMe pela sessão)', '/v1/me', /api(<[^>]*>)?\(\s*['"`]\/me['"`]/],
      ['D-B21 Clientes (farol)', '/v1/dashboards/customers', /['"`]\/dashboards\//],
      ['D-B22 Clientes/Metas (equipes)', '/v1/teams', /['"`]\/teams['"`/?]/],
      ['D-B23 Metas e RV', '/v1/goals?period=PERIODO', /['"`]\/goals['"`/?]/],
      ['D-B24 Metas e RV (períodos)', '/v1/goal-periods', /['"`]\/goal-periods/],
      ['D-B25 Plano de RV', '/v1/incentive-plans', /['"`]\/incentive-plans/],
    ];
    const fonteCoreWeb = (() => {
      const raiz = join(__dirname, '../../../modules/core/web');
      const arquivos: string[] = [];
      const andar = (d: string) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) andar(p);
          else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) arquivos.push(p);
        }
      };
      andar(raiz);
      return arquivos.map((p) => ({ p, texto: readFileSync(p, 'utf8') }));
    })();
    for (const [nome, url, uso] of FASE_M_CORE) {
      it(`${nome} (T-0030): o BKO do Core não chama ${url} (segue 404 na API nova)`, async () => {
        const r = await api.get(token.analista, url.replace('PERIODO', periodo()));
        expect(r.status, JSON.stringify(r.corpo)).toBe(404);
        expect(fonteCoreWeb.filter((a) => uso.test(a.texto)).map((a) => a.p), `chamadas a ${url} em modules/core/web`).toEqual([]);
      });
    }

    // T-0029: Pedidos e Alçadas do BKO usam só a API nova (/v1/vendedor/...). As rotas da Fase M seguem 404, mas o fonte
    // de modules/vendedor/web não as chama mais; a rota nova que substitui cada uma responde 200 ao analista.
    const fonteVendedorWeb = (() => {
      const raiz = join(__dirname, '../../../modules/vendedor/web');
      const arquivos: string[] = [];
      const andar = (d: string) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) andar(p);
          else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) arquivos.push(p);
        }
      };
      andar(raiz);
      return arquivos.map((p) => ({ p, texto: readFileSync(p, 'utf8') }));
    })();
    const FASE_M: Array<[string, string, RegExp, string]> = [
      ['D-B20 Pedidos e Alçadas (usuário pela sessão)', '/v1/me', /api(<[^>]*>)?\(\s*['"`]\/me['"`]/, '/v1/vendedor/alcadas'],
      ['D-B26 Pedidos (lista e painel "Aguardando aprovação")', '/v1/dashboards/orders?period=today', /['"`]\/(dashboards|branches|teams)\b/, '/v1/vendedor/pedidos?status=pending_approval&limite=100'],
      ['D-B27 Pedidos (detalhe com itens)', '/v1/orders/ID', /['"`]\/orders\b/, '/v1/vendedor/pedidos/ID'],
      ['D-B28 Alçadas', '/v1/discount-policy', /['"`]\/(discount-policy|sellers)\b/, '/v1/vendedor/alcadas'],
    ];
    for (const [nome, url, uso, nova] of FASE_M) {
      it(`${nome} (T-0029): o BKO do Vendedor não chama ${url} (segue 404) e usa ${nova.split('?')[0]} (200)`, async () => {
        const [p] = await pedidosDoBanco();
        expect((await api.get(token.analista, url.replace('ID', p!.id))).status).toBe(404);
        expect(fonteVendedorWeb.filter((a) => uso.test(a.texto)).map((a) => a.p), `chamadas a ${url} em modules/vendedor/web`).toEqual([]);
        const r = await api.get(token.analista, nova.replace('ID', p!.id));
        expect(r.status, JSON.stringify(r.corpo)).toBe(200);
      });
    }
  });
});
