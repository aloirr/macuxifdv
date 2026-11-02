/**
 * Smoke da DEMO de 03/11 (roteiro do dono do produto) — `createApp` REAL (8 módulos, JWT, Postgres como `macuxi_app`,
 * RLS) sobre a base `demo` recarregada (com a 0013), o motor de sync real do app e o DESPACHANTE real da outbox
 * (papel `macuxi_worker`) para o push. Nada simulado além do `fetch` do Expo (rede) e do relógio do sistema.
 *
 * Itens (um `it` por passo do roteiro; o nome diz o que a demo vai mostrar):
 *  S1 carteira com a etiqueta "Cadastro incompleto" no Atacado Boto Rosa (sem CEP; RN-CORE-16/17);
 *  S2 busca "óleo para moto 150 cilindradas" acha o OLE-4T-1L (API online e busca local offline; RF-CAT-01/02);
 *  S3 novo pedido → envio (Sincronizar) → aprovação pela supervisora (RN-VEN-10);
 *  S4 o push de "pedido aprovado" é gerado (core.notificacao + mensagem ao Expo com data.link/data.entidades; RN-CORE-23);
 *  S5 GET /v1/sync/novidades depois da aprovação devolve só as entidades do pedido e a notificação (ADR 0018);
 *  S6 detalhe do pedido 000010 no BKO com itens, histórico e CNPJ;
 *  S7 promotor nunca cria pedido (regra 7; RN-PRO-01; MODULO_INATIVO na licença da demo).
 * Mais o sync completo do aparelho com TODAS as entidades que o APK registra (inclui as de conteúdo do Catálogo).
 * Matriz: tests/plano/demo-matriz.md (M-D00..M-D16 e S1..S7).
 */
import { randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE, ENTIDADES_CONTEUDO, RespostaBusca } from '@macuxi/catalogo/contracts';
import type { ClienteFinanceiroSync, ClienteSync, HistoricoCompraSync, TituloSync } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { OrderDetail, type PedidoPush } from '@macuxi/vendedor/contracts';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { buscarLocal } from '../../../modules/catalogo/app/lib/local';
import { listarClientesLocais } from '../../../modules/core/app/lib/cliente360-local';
import { montarPedido, prepararPedido, rascunhoVazio, type Rascunho } from '../../../modules/vendedor/app/lib/pedidos';
import { condicoesDoCliente, lerLinhas, listaDeClientes, meDoAparelho, politicaApi, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { DEMO, listaDe, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

const BUSCA = 'óleo para moto 150 cilindradas';
const TOKEN_LUCAS = `ExponentPushToken[smoke-demo-${randomUUID()}]`;
/** Entidades que mudam com a aprovação (pedido + linha do tempo) e a notificação do push. */
const ENTIDADES_DA_APROVACAO = ['notificacao', 'pedido', 'pedido_evento', 'pedido_item'];

describe.skipIf(semBanco())('SMOKE DEMO 03/11 — roteiro do dono do produto (base demo × createApp real × Postgres × despachante)', () => {
  let api: ApiDemo;
  let worker: pg.Pool;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  let lucas: AparelhoCampo;
  let pedidoId = '';
  let numero = '';
  const fetchFalso = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{"data":[]}', { status: 200 }));

  const linhas = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 30; i += 1) if ((await d.ciclo()).lidos === 0) return;
  };
  const push = async (tk: string, itens: Array<{ id: string; entidade: string; operacao: 'upsert'; payload: unknown }>): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const novidades = async (tk: string, desde?: string) => {
    const r = await api.get(tk, `/v1/sync/novidades${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`);
    expect(r.status, JSON.stringify(r.corpo)).toBe(200);
    return r.corpo as { entidades: string[]; cursor: string; modulos_mudaram: boolean };
  };
  const clientesDoAparelho = async (ap: AparelhoCampo) => {
    const m = ap.motor;
    return listarClientesLocais(
      {
        clientes: await m.linhas<ClienteSync & LinhaSync>('cliente'),
        financeiros: await m.linhas<ClienteFinanceiroSync & LinhaSync>('cliente_financeiro'),
        titulos: await m.linhas<TituloSync & LinhaSync>('titulo'),
        historico: await m.linhas<HistoricoCompraSync & LinhaSync>('historico_compra'),
      },
      api.hoje,
    );
  };

  /** Novo pedido pela tela do Campo (mesmas funções da tela) e Sincronizar; devolve id e número. */
  const tirarPedido = async (desconto: number): Promise<{ id: string; numero: string; status: string; nivel: string | null }> => {
    const l = await lerLinhas(lucas.motor);
    const u = lucas.sessao.usuario;
    const params = lucas.motor.parametros('vendedor');
    const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => condicoesDoCliente(l, c.id).length > 0);
    expect(cliente, 'cliente do Lucas com condição de pagamento').toBeDefined();
    const pr = await lucas.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente!.id, produto_ids: l.produtos.map((p) => p.id), em: new Date().toISOString() });
    const catalogo = produtosComPrecos(l, new Map(pr.itens.map((i) => [i.produto_id, i.preco_cents])));
    const conds = condicoesDoCliente(l, cliente!.id);
    const rascunho: Rascunho = {
      ...rascunhoVazio(cliente!.id),
      lines: Object.fromEntries(catalogo.filter((p) => p.price_cents != null).slice(0, 2).map((p, i) => [p.id, i + 2])),
      discount_pct: desconto,
      condicao_pagamento_id: conds[0]?.id ?? null,
      payment_terms: conds[0]?.descricao ?? 'À vista',
    };
    const eu = meDoAparelho({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: lucas.sessao.tenant.fuso }, params, new Date()).seller;
    const { v, display } = prepararPedido({ rascunho, cliente: cliente!, catalogo, politica: politicaApi(params), eu, filaDoClienteCents: 0 });
    if (desconto >= 6) expect(display.expected).toBe('pending_approval');
    const id = randomUUID();
    const payload: PedidoPush = montarPedido({ id, cliente: cliente!, rascunho, v, semSinal: false, agora: new Date().toISOString() });
    await lucas.motor.enfileirar({ id, entidade: 'pedido', payload });
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
    expect(lucas.motor.estado().fila).toEqual([]);
    const [b] = await linhas<{ status: string; numero: string; nivel_aprovacao: string | null }>('select status, numero, nivel_aprovacao from vendedor.pedido where id = $1', [id]);
    expect(b, 'pedido no banco depois do Sincronizar').toBeDefined();
    return { id, numero: b!.numero, status: b!.status, nivel: b!.nivel_aprovacao };
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o smoke do push precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    // eventos da carga da base (se houver) não entram na conta do push/novidades
    await despachar();
    await esperarHorizonte();
    lucas = await aparelhoCampo(api, DEMO.vendedor);
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
  }, 120_000);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  it('S0. Sincronizar do APK com TODAS as entidades que o app registra (preço + conteúdo do Catálogo): termina sem erro e a fila zera', async () => {
    const ap = await aparelhoCampo(api, DEMO.vendedor, { entidadesExtras: [...ENTIDADES_CONTEUDO] });
    const ok = await ap.sincronizar();
    expect({ ok, erro: ap.motor.estado().erro ?? null, chamadas: ap.chamadasEtapas.filter((c) => c.status >= 400) }).toEqual({ ok: true, erro: null, chamadas: [] });
    expect(ap.motor.estado().fila).toEqual([]);
  });

  it('S1. Carteira (vendedor2@ — Camila): Atacado Boto Rosa com a etiqueta "Cadastro incompleto" (falta CEP); o Lucas (vendedor@) NÃO tem o Boto Rosa', async () => {
    const camila = await aparelhoCampo(api, DEMO.vendedor2);
    expect(await camila.sincronizar(), camila.motor.estado().erro ?? '').toBe(true);
    const lista = await clientesDoAparelho(camila);
    const boto = lista.find((c) => c.nome_fantasia === 'Atacado Boto Rosa');
    expect(boto, 'Boto Rosa na carteira da vendedor2').toBeDefined();
    expect(boto!.cadastro_incompleto).toBe(true);
    const [linha] = await camila.motor.linhasPorIds<ClienteSync & LinhaSync & { cadastro_campos_faltantes?: unknown }>('cliente', [boto!.id]);
    expect(JSON.stringify(linha?.cadastro_campos_faltantes ?? null)).toContain('cep');
    // só o Boto Rosa tem a etiqueta na carteira dela (o resto da base é completo)
    expect(lista.filter((c) => c.cadastro_incompleto).map((c) => c.nome_fantasia)).toEqual(['Atacado Boto Rosa']);
    // roteiro: quem entra como vendedor@ (Lucas) não vê o Boto Rosa — a etiqueta se mostra com vendedor2@
    expect((await clientesDoAparelho(lucas)).map((c) => c.nome_fantasia)).not.toContain('Atacado Boto Rosa');
  });

  it(`S2a. Catálogo ONLINE: GET /v1/catalogo/busca?q="${BUSCA}" acha o OLE-4T-1L (primeiro lugar)`, async () => {
    const [cli] = await linhas<{ cliente_id: string }>('select cliente_id from core.carteira where tenant_id = $1 and usuario_id = $2 and deleted_at is null order by cliente_id limit 1', [TENANT_DEMO, usuarioId.vendedor]);
    for (const q of [`q=${encodeURIComponent(BUSCA)}`, `q=${encodeURIComponent(BUSCA)}&customer_id=${cli!.cliente_id}`]) {
      const r = await api.get(token.vendedor, `/v1/catalogo/busca?${q}&limit=20`);
      expect(r.status, JSON.stringify(r.corpo)).toBe(200);
      const b = RespostaBusca.parse(r.corpo);
      const skus = b.items.map((i) => i.erp_code);
      expect(skus, `${q} → ${JSON.stringify({ skus, filtros: b.filters, por: b.interpreted_by, aviso: b.notice })}`).toContain('OLE-4T-1L');
      expect(skus[0], `OLE-4T-1L deveria vir primeiro: ${JSON.stringify(skus)}`).toBe('OLE-4T-1L');
    }
  });

  it(`S2b. Catálogo OFFLINE (modo avião): a busca local no aparelho acha o OLE-4T-1L com o aviso de busca simples`, async () => {
    const ap = await aparelhoCampo(api, DEMO.vendedor, { entidadesExtras: [...ENTIDADES_CONTEUDO] });
    await ap.sincronizar();
    const r = await buscarLocal(ap.motor, { perfil: 'vendedor', parametros: ap.motor.parametros('catalogo'), agora: new Date().toISOString(), clienteId: null, q: BUSCA, limit: 20, offset: 0, offline: true });
    const skus = r.items.map((i) => i.erp_code);
    expect(skus, JSON.stringify(skus)).toContain('OLE-4T-1L');
    expect(r.aviso).not.toBeNull();
  });

  it('S3. Novo pedido (Lucas, 8%) → Sincronizar envia → aguardando aprovação (supervisora) → a supervisora aprova → approved no próximo sync do aparelho', async () => {
    const t = await tirarPedido(8);
    expect(t).toMatchObject({ status: 'pending_approval', nivel: 'supervisor' });
    expect(t.numero).toMatch(/^\d{6}$/);
    pedidoId = t.id;
    numero = t.numero;
    // os eventos da criação ("para aprovar" da supervisora) saem antes da aprovação, como no servidor da demo
    await despachar();
    // Gestão: a supervisora recebe "Pedido para aprovar" (push de alta prioridade que abre o pedido)
    const paraAprovar = await linhas<{ prioridade: string }>("select prioridade from core.notificacao where usuario_id = $1 and link = $2 and titulo ilike '%para aprovar%'", [usuarioId.supervisor, `/m/pedido?id=${pedidoId}`]);
    expect(paraAprovar, 'notificação "para aprovar" da supervisora').toEqual([{ prioridade: 'alta' }]);
    const a = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${pedidoId}/aprovar`, payload: {} });
    expect(a.statusCode, a.body).toBe(200);
    expect(OrderDetail.parse(a.json()).status).toBe('approved');
  }, 180_000);

  it('S4. Push de "pedido aprovado": notificação do Lucas com o link do pedido e mensagem ao Expo com data.link/data.entidades (despachante real)', async () => {
    expect(pedidoId, 'depende do S3').not.toBe('');
    await api.admin.query(
      `insert into core.dispositivo (id, tenant_id, usuario_id, nome, plataforma, push_token, push_plataforma) values ($1, $2, $3, 'aparelho smoke demo', 'android', $4, 'android')`,
      [randomUUID(), TENANT_DEMO, usuarioId.vendedor, TOKEN_LUCAS],
    );
    vi.stubEnv('MACUXI_PUSH_ATIVO', '1');
    vi.stubGlobal('fetch', fetchFalso);
    await despachar();
    const link = `/m/pedido?id=${pedidoId}`;
    const notif = await linhas<{ titulo: string; link: string; tipo: string; push_enviado_em: Date | null }>(
      "select titulo, link, tipo, push_enviado_em from core.notificacao where usuario_id = $1 and link = $2 and titulo ilike '%aprovado%'",
      [usuarioId.vendedor, link],
    );
    expect(notif, `notificação "pedido aprovado" do Lucas (pedido ${numero})`).toHaveLength(1);
    // o título sai "Pedido aprovado" (sem o número): o vendedor.pedido.status_alterado@1 não leva pedido_numero — melhoria pedida ao modulo-vendedor, não bloqueia a demo
    expect(notif[0]!.titulo).toMatch(/^Pedido (\d{6} )?aprovado$/);
    expect(notif[0]!.push_enviado_em).not.toBeNull();
    const mensagens = fetchFalso.mock.calls.flatMap(([, init]) => JSON.parse(String(init?.body ?? '[]')) as Array<{ to: string; title: string; data: { link: string | null; entidades?: string[] } }>);
    const aoLucas = mensagens.filter((m) => m.to === TOKEN_LUCAS && m.data.link === link && /aprovado/i.test(m.title));
    expect(aoLucas, JSON.stringify(mensagens.filter((m) => m.to === TOKEN_LUCAS))).toHaveLength(1);
    expect(aoLucas[0]!.data.entidades).toEqual(['pedido', 'pedido_evento', 'notificacao']);
    // nenhum dado pessoal no push (título/corpo só com o número)
    expect(JSON.stringify(aoLucas[0])).not.toContain('Comércio de Alimentos');
  });

  it('S5. GET /v1/sync/novidades: em dia = []; depois da aprovação (+ despachante) = só pedido/pedido_evento/notificacao; o Sincronizar traz approved', async () => {
    const t = await tirarPedido(8);
    expect(t.status).toBe('pending_approval');
    await despachar();
    await esperarHorizonte();
    const base = await novidades(token.vendedor);
    expect(base.modulos_mudaram).toBe(true);
    await esperarHorizonte();
    const quieto = await novidades(token.vendedor, base.cursor);
    expect(quieto.entidades, 'aparelho em dia: nenhuma entidade').toEqual([]);
    const a = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${t.id}/aprovar`, payload: {} });
    expect(a.statusCode, a.body).toBe(200);
    await despachar();
    await esperarHorizonte();
    const depois = await novidades(token.vendedor, quieto.cursor);
    expect(depois.modulos_mudaram).toBe(false);
    expect(depois.entidades).toEqual(expect.arrayContaining(['pedido', 'notificacao']));
    expect(depois.entidades.filter((e) => !ENTIDADES_DA_APROVACAO.includes(e)), `entidades além do pedido/notificação: ${JSON.stringify(depois.entidades)}`).toEqual([]);
    expect(await lucas.sincronizar()).toBe(true);
    expect((await lerLinhas(lucas.motor)).pedidos.find((p) => p.id === t.id)?.status).toBe('approved');
  }, 240_000);

  it('S6. BKO › Pedidos: o 000010 abre (GET detalhe) com itens, histórico e o CNPJ do cliente preenchido', async () => {
    const lista = await api.get(token.analista, '/v1/vendedor/pedidos?q=000010&limite=50');
    expect(lista.status, JSON.stringify(lista.corpo)).toBe(200);
    const achado = (listaDe(lista.corpo) as Array<{ id: string; number?: string }>).find((o) => o.number === '000010');
    expect(achado, `000010 na busca: ${JSON.stringify(listaDe(lista.corpo).map((o) => (o as { number?: string }).number))}`).toBeDefined();
    const d = await api.get(token.analista, `/v1/vendedor/pedidos/${achado!.id}`);
    expect(d.status, JSON.stringify(d.corpo)).toBe(200);
    const det = OrderDetail.parse(d.corpo);
    expect(det.number).toBe('000010');
    expect(det.items.length).toBeGreaterThan(0);
    expect(det.items.every((i) => i.description && i.quantity > 0)).toBe(true);
    expect(det.history.length).toBeGreaterThan(0);
    expect(det.history[0]!.status).toBe('received');
    expect(det.cliente?.documento ?? '', 'CNPJ no retrato do cliente').toMatch(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
    expect(det.cliente?.razao_social).toBeTruthy();
    // a supervisora (Gestão) também abre o mesmo detalhe
    expect((await api.get(token.supervisor, `/v1/vendedor/pedidos/${achado!.id}`)).status).toBe(200);
  });

  it('S7. Promotor nunca cria pedido: sem Vendedor nos módulos, push de pedido rejeitado, aprovar 403, novidades sem pedido', async () => {
    expect((await api.meusModulos(token.promotor)).modulos.map((m) => m.id)).not.toContain('vendedor');
    const [cli] = await linhas<{ cliente_id: string }>("select cliente_id from core.carteira where tenant_id = $1 and usuario_id = $2 and papel = 'promotor' and deleted_at is null limit 1", [TENANT_DEMO, usuarioId.promotor]);
    const id = randomUUID();
    const [r] = await push(token.promotor, [{ id, entidade: 'pedido', operacao: 'upsert', payload: { id, customer_id: cli!.cliente_id, items: [], discount_pct: 0 } }]);
    expect(r!.status).toBe('rejeitado');
    expect(['MODULO_INATIVO', 'RN-PRO-01']).toContain((r as { codigo?: string }).codigo);
    expect(await linhas('select id from vendedor.pedido where id = $1', [id])).toEqual([]);
    const a = await api.chamar(token.promotor, { method: 'POST', url: `/v1/vendedor/pedidos/${pedidoId || randomUUID()}/aprovar`, payload: {} });
    expect(a.statusCode).toBe(403);
    const n = await novidades(token.promotor);
    expect(n.entidades.filter((e) => e.startsWith('pedido'))).toEqual([]);
  });
});
