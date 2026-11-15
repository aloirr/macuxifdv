/**
 * Smoke da DEMO de 03/11 (roteiro do dono do produto) — `createApp` REAL (8 módulos, JWT, Postgres como `macuxi_app`,
 * RLS) sobre a base `demo` recarregada (com a 0013), o motor de sync real do app e o DESPACHANTE real da outbox
 * (papel `macuxi_worker`) para o push. Nada simulado além do `fetch` do provedor de push (Expo ou FCM HTTP v1 + OAuth do
 * Google, conforme o `modules/core/api/push.ts` em vigor; ADR 0053) e do relógio do sistema.
 *
 * Itens (um `it` por passo do roteiro; o nome diz o que a demo vai mostrar):
 *  S1 carteira com a etiqueta "Cadastro incompleto" no Atacado Boto Rosa (sem CEP; RN-CORE-16/17);
 *  S2 busca "óleo para moto 150 cilindradas" acha o OLE-4T-1L (API online e busca local offline; RF-CAT-01/02);
 *  S3 novo pedido → envio (Sincronizar) → aprovação pela supervisora (RN-VEN-10);
 *  S4 o push de "pedido aprovado" é gerado (core.notificacao + mensagem ao provedor com data.link/data.entidades; RN-CORE-23);
 *  S5 GET /v1/sync/novidades depois da aprovação devolve só as entidades do pedido e a notificação (ADR 0018);
 *  S6 detalhe do pedido 000010 no BKO com itens, histórico e CNPJ;
 *  S7 promotor nunca cria pedido (regra 7; RN-PRO-01; MODULO_INATIVO na licença da demo);
 *  S8 Gestão da Renata (supervisora) com o Gestor licenciado pelo seed (db/seeds/demo/gestor.ts): Equipe com o Lucas e a
 *     Camila e Aprovações com o pedido novo, pela projeção GRAVADA no banco (repositório SQL do Gestor, schema `gestor`);
 *  S9 Promotor (Joana) com o Promotor licenciado pelo seed (db/seeds/demo/promotor.ts): a aba Loja tem cadastros de trade
 *     no aparelho, check-in → visita de loja → fotos → gôndola e share pela fila, gravados no schema `promotor`;
 *     relatório de share no BKO; e nunca cria pedido (RN-PRO-01);
 *  S10 PDF interno no Campo (aparelho, pelas linhas do pull): desconto 8,0% e quem aprovou; o do cliente sem `%`.
 *  Telas novas do BKO de 03/11 (tests/integracao/demo/telas-novas.casos.ts; docs/testes/T-0070.md), no fim do roteiro
 *  (o U3 cria um usuário na equipe da Renata, depois do S8): U1–U3 usuários e hierarquia (T-0067, #82) e C1–C2 cadastros
 *  de trade no BKO (T-0069, #81). Metas (T-0068, #83) entram quando o PR estiver no main.
 * S8 e S9 dependem de entregas de 02/11 (seed + repositório SQL de cada módulo). Enquanto o FONTE não as tiver, o caso
 * PULA com o motivo no nome ("[pendente: ...]") em vez de falhar à toa; quando a entrega chega, passa a rodar sozinho.
 * Mais o sync completo do aparelho com TODAS as entidades que o APK registra (inclui as de conteúdo do Catálogo).
 * Matriz: tests/plano/demo-matriz.md (M-D00..M-D16 e S1..S7).
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSULTA_PRECOS_CLIENTE, ENTIDADES_CONTEUDO, RespostaBusca } from '@macuxi/catalogo/contracts';
import { formatBRL } from '@macuxi/comum';
import type { ClienteFinanceiroSync, ClienteSync, HistoricoCompraSync, TituloSync, VisitaSync } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { FilaAprovacao, VisaoEquipe } from '@macuxi/gestor/contracts';
import type { LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { ENTIDADES_PROMOTOR, type CategoriaGondolaSync, type ChecklistLojaSync, type MetaShareSync, type MixObrigatorioSync } from '@macuxi/promotor/contracts';
import { OrderDetail, type PedidoPush } from '@macuxi/vendedor/contracts';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import * as pushCore from '../../../modules/core/api/push';
import { buscarLocal } from '../../../modules/catalogo/app/lib/local';
import { listarClientesLocais } from '../../../modules/core/app/lib/cliente360-local';
import { abrirVisitaLoja, checkinAberto, montarFoto, montarGondola, montarShare } from '../../../modules/promotor/app/lib/loja';
import { checklistDaLoja, metaDaCategoria } from '../../../modules/promotor/domain';
import { buildOrderPdfHtml, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido } from '../../../modules/vendedor/app/lib/order-pdf';
import { montarPedido, prepararPedido, rascunhoVazio, type Rascunho } from '../../../modules/vendedor/app/lib/pedidos';
import { condicoesDoCliente, detalheDoPedido, lerLinhas, listaDeClientes, meDoAparelho, politicaApi, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { blindarPool, DEMO, disponivelNaFilial, encerrarPool, FOLGA_ESTOQUE, listaDe, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';
import { casosCadastrosTrade, casosUsuarios, type CtxTelasNovas } from './telas-novas.casos';

const BUSCA = 'óleo para moto 150 cilindradas';
/**
 * Tolerante aos dois envios do core (transição Expo → FCM HTTP v1, ADR 0053): o FCM exporta `montarMensagemFcm`.
 * Sem referência estática a export que só existe num dos lados, para o typecheck passar nos dois.
 */
const temFcm = 'montarMensagemFcm' in pushCore;
/** Token FCM é opaco (o formato Expo é ignorado pelo envio FCM); o envio Expo só aceita `ExponentPushToken[...]`. */
const TOKEN_LUCAS = temFcm ? `fcm-smoke-demo-${randomUUID()}` : `ExponentPushToken[smoke-demo-${randomUUID()}]`;
const URL_EXPO = 'https://exp.host/--/api/v2/push/send';
const PROJETO_FCM = 'macuxi-smoke-demo';
const URL_FCM = `https://fcm.googleapis.com/v1/projects/${PROJETO_FCM}/messages:send`;
const URL_OAUTH = 'https://oauth2.googleapis.com/token';
/** Conta de serviço de teste com chave RSA real (o JWT é assinado de verdade; o fetch falso não o confere). Só no FCM. */
const contaServico = (): string =>
  Buffer.from(
    JSON.stringify({
      client_email: 'push@macuxi-smoke-demo.iam.gserviceaccount.com',
      private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  ).toString('base64');
/** Mensagem enviada, no formato comum aos dois provedores. */
interface MensagemEnviada {
  token: string;
  titulo: string;
  link: string | null;
  entidades: string[] | undefined;
  bruta: unknown;
}
const lerEnviadas = (calls: ReadonlyArray<[string | URL | Request, RequestInit?]>): MensagemEnviada[] =>
  temFcm
    ? calls
        .filter(([url]) => String(url) === URL_FCM)
        .map(([, init]) => {
          const m = (JSON.parse(String(init?.body ?? '{}')) as { message: { token: string; notification?: { title: string }; data: { link?: string; entidades?: string } } }).message;
          return { token: m.token, titulo: m.notification?.title ?? '', link: m.data.link ?? null, entidades: m.data.entidades === undefined ? undefined : (JSON.parse(m.data.entidades) as string[]), bruta: m };
        })
    : calls
        .filter(([url]) => String(url) === URL_EXPO)
        .flatMap(([, init]) => JSON.parse(String(init?.body ?? '[]')) as Array<{ to: string; title?: string; data: { link: string | null; entidades?: string[] } }>)
        .map((m) => ({ token: m.to, titulo: m.title ?? '', link: m.data.link, entidades: m.data.entidades, bruta: m }));
/** Entidades que mudam com a aprovação (pedido + linha do tempo) e a notificação do push. */
const ENTIDADES_DA_APROVACAO = ['notificacao', 'pedido', 'pedido_evento', 'pedido_item'];

/**
 * Entregas de 02/11 lidas do FONTE (pedido do dono do produto ao gerente, T-0065): seed de cada módulo ligado no
 * `carregarDemo` e o repositório SQL na API de produção. Sem elas o caso pula com o motivo; com elas, roda sozinho.
 */
const RAIZ = join(__dirname, '..', '..', '..');
const fonte = (p: string) => {
  try {
    return readFileSync(join(RAIZ, p), 'utf8');
  } catch {
    return '';
  }
};
const SEED_DEMO = fonte('db/seeds/demo/demo.ts');
const PENDENTE_GESTOR = [
  /await\s+carregarDemoGestor\(/.test(SEED_DEMO) ? null : 'seed do Gestor no carregarDemo (banco-dados)',
  /repositorioGestor\b[^=]*=\s*criarRepositorioPostgres\(/.test(fonte('modules/gestor/api/index.ts')) ? null : 'repositório SQL do Gestor (modulo-gestor)',
].filter((x): x is string => x !== null);
const PENDENTE_PROMOTOR = [
  /await\s+gravarDemoPromotor\(/.test(SEED_DEMO) ? null : 'seed do Promotor no carregarDemo (banco-dados)',
  /criarModuloApiPromotor\(\{\s*repositorio:\s*criarRepositorioSql\(\)/.test(fonte('modules/promotor/api/index.ts')) ? null : 'repositório SQL do Promotor (modulo-promotor)',
].filter((x): x is string => x !== null);
/**
 * Pull dos cadastros de trade (categoria_gondola, checklist_loja, mix_obrigatorio, meta_share): o #51 liga o SQL e o
 * push das coletas, mas os provedores de pull ficam para a T-0056 parte 2 (pull 501, ADR 0009 §7 — a Loja abre sem
 * checklist/categorias no aparelho). Enquanto isso o S9 pega os ids dos cadastros no banco e o S9a fica pendente.
 * O #51 (2cf52f1) pôs os provedores de pull em sync-cadastros.ts: a detecção olha os dois arquivos.
 */
const FONTES_SYNC_PROMOTOR = fonte('modules/promotor/api/sync.ts') + fonte('modules/promotor/api/sync-cadastros.ts');
const PENDENTE_PULL_PROMOTOR = /\bpuxar\s*[:(]/.test(FONTES_SYNC_PROMOTOR) ? [] : ['pull dos cadastros de trade do Promotor (modulo-promotor, T-0056 parte 2)'];
const marca = (pendente: readonly string[]) => (pendente.length ? ` [pendente: ${pendente.join('; ')}]` : '');

describe.skipIf(semBanco())('SMOKE DEMO 03/11 — roteiro do dono do produto (base demo × createApp real × Postgres × despachante)', () => {
  let api: ApiDemo;
  let worker: pg.Pool;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  let lucas: AparelhoCampo;
  let pedidoId = '';
  let numero = '';
  /** Fetch falso: no FCM o OAuth devolve o token de acesso e o messages:send aceita; no Expo o lote é aceito. */
  const fetchFalso = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (!temFcm) return new Response('{"data":[]}', { status: 200 });
    return String(url) === URL_OAUTH
      ? new Response(JSON.stringify({ access_token: 'acesso-smoke', expires_in: 3600 }), { status: 200 })
      : new Response(`{"name":"projects/${PROJETO_FCM}/messages/1"}`, { status: 200 });
  });

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
    // RN-VEN-20 (v1.0.4): só produtos com saldo na filial do cliente (o seed tem ruptura de propósito); folga para a embalagem e as reservas
    const disp = await disponivelNaFilial(api.admin, cliente!.id, catalogo.map((p) => p.id));
    const rascunho: Rascunho = {
      ...rascunhoVazio(cliente!.id),
      lines: Object.fromEntries(catalogo.filter((p) => p.price_cents != null && (disp.get(p.id) ?? 0) >= FOLGA_ESTOQUE).slice(0, 2).map((p, i) => [p.id, i + 2])),
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
    worker = blindarPool(new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 }));
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
  }, 300_000); // máquina carregada (100% CPU com vários agentes): mesmo teto do hookTimeout global
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await encerrarPool(worker);
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

  it('S4. Push de "pedido aprovado": notificação do Lucas com o link do pedido e mensagem ao provedor (Expo ou FCM) com data.link/data.entidades (despachante real)', async () => {
    expect(pedidoId, 'depende do S3').not.toBe('');
    await api.admin.query(
      `insert into core.dispositivo (id, tenant_id, usuario_id, nome, plataforma, push_token, push_plataforma) values ($1, $2, $3, 'aparelho smoke demo', 'android', $4, 'android')`,
      [randomUUID(), TENANT_DEMO, usuarioId.vendedor, TOKEN_LUCAS],
    );
    vi.stubEnv('MACUXI_PUSH_ATIVO', '1');
    if (temFcm) {
      vi.stubEnv('FCM_PROJECT_ID', PROJETO_FCM);
      vi.stubEnv('FCM_SERVICE_ACCOUNT_JSON', contaServico());
    }
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
    const mensagens = lerEnviadas(fetchFalso.mock.calls);
    // exatamente um envio ao token do Lucas (nem duplicado, nem outro push com o mesmo token)
    expect(mensagens.filter((m) => m.token === TOKEN_LUCAS), JSON.stringify(mensagens.filter((m) => m.token === TOKEN_LUCAS).map((m) => m.bruta))).toHaveLength(1);
    const aoLucas = mensagens.filter((m) => m.token === TOKEN_LUCAS && m.link === link && /aprovado/i.test(m.titulo));
    expect(aoLucas).toHaveLength(1);
    expect(aoLucas[0]!.entidades).toEqual(['pedido', 'pedido_evento', 'notificacao']);
    // nenhum dado pessoal no push (título/corpo só com o número)
    expect(JSON.stringify(aoLucas[0]!.bruta)).not.toContain('Comércio de Alimentos');
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

  it.skipIf(PENDENTE_GESTOR.length > 0)(
    `S8. Gestão (supervisor@ — Renata) com o Gestor da demo: Equipe com o Lucas e a Camila; Aprovações com o pedido novo de 8%, pela projeção gravada no schema gestor${marca(PENDENTE_GESTOR)}`,
    async () => {
      // licença do seed (tenant ∩ perfil, RN-CORE-01): Renata e Marcelo têm o Gestor; vendedor e promotor não
      expect((await api.meusModulos(token.supervisor)).modulos.map((m) => m.id), 'Gestor nos módulos da Renata (seed gestor.ts)').toContain('gestor');
      expect((await api.meusModulos(token.gerente)).modulos.map((m) => m.id)).toContain('gestor');
      for (const k of ['vendedor', 'promotor'] as const) expect((await api.meusModulos(token[k])).modulos.map((m) => m.id), k).not.toContain('gestor');
      // a projeção do seed já está no banco ANTES de qualquer evento novo: é o que a Renata vê ao abrir o app amanhã
      const [proj] = await linhas<{ n: number }>('select count(*)::int as n from gestor.projecao_fato where tenant_id = $1 and deleted_at is null', [TENANT_DEMO]);
      expect(proj!.n, 'projeção do Gestor gravada pelo seed').toBeGreaterThan(0);
      // Equipe (aba Equipe, RF-GES-01)
      const e = await api.get(token.supervisor, '/v1/gestor/equipe');
      expect(e.status, JSON.stringify(e.corpo)).toBe(200);
      const v = VisaoEquipe.parse(e.corpo);
      const membros = new Map(v.membros.map((m) => [m.membro.id, m.membro]));
      for (const k of ['vendedor', 'vendedor2'] as const) {
        expect(membros.has(usuarioId[k]), `${k} na equipe da Renata: ${JSON.stringify([...membros.values()].map((m) => m.nome))}`).toBe(true);
        expect(membros.get(usuarioId[k])!.nome.trim().length).toBeGreaterThan(0);
      }
      expect(v.membros.every((m) => m.membro.id !== usuarioId.supervisor && m.membro.id !== usuarioId.analista)).toBe(true);
      expect((await api.get(token.supervisor, `/v1/gestor/equipe/${usuarioId.vendedor}`)).status).toBe(200);
      // Aprovações (aba Aprovações, RF-GES-04): pedido novo do Lucas → despachante → fila da Renata, nível supervisor
      const t = await tirarPedido(8);
      expect(t).toMatchObject({ status: 'pending_approval', nivel: 'supervisor' });
      await despachar();
      const f = await api.get(token.supervisor, '/v1/gestor/aprovacoes');
      expect(f.status, JSON.stringify(f.corpo)).toBe(200);
      const fila = FilaAprovacao.parse(f.corpo);
      const item = fila.itens.find((i) => i.pedido_id === t.id);
      expect(item, `pedido ${t.numero} na fila da Renata: ${JSON.stringify(fila.itens.map((i) => i.pedido_id))}`).toBeDefined();
      expect(item).toMatchObject({ vendedor_id: usuarioId.vendedor, nivel: 'supervisor', pode_decidir: true });
      expect(item!.total_cents).toBeGreaterThan(0);
      // repositório SQL: o fato do pedido novo está GRAVADO no schema gestor (API e worker são processos separados na demo)
      const [fato] = await linhas<{ n: number }>('select count(*)::int as n from gestor.projecao_fato where tenant_id = $1 and (chave like $2 or dados::text like $2)', [TENANT_DEMO, `%${t.id}%`]);
      expect(fato!.n, 'fato do pedido novo na tabela gestor.projecao_fato (repositório SQL, não memória)').toBeGreaterThan(0);
      // a Renata aprova (Vendedor, ADR 0011) → despachante → sai da fila (deixa a base como estava para o roteiro)
      const a = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${t.id}/aprovar`, payload: {} });
      expect(a.statusCode, a.body).toBe(200);
      await despachar();
      expect(FilaAprovacao.parse((await api.get(token.supervisor, '/v1/gestor/aprovacoes')).corpo).itens.map((i) => i.pedido_id)).not.toContain(t.id);
      // perfil errado: vendedor e promotor fora do Gestor (403)
      for (const k of ['vendedor', 'promotor'] as const) expect((await api.get(token[k], '/v1/gestor/aprovacoes')).status, k).toBe(403);
    },
    240_000,
  );

  it.skipIf(PENDENTE_PROMOTOR.length > 0)(
    `S9. Promotor (promotor@ — Joana) com o Promotor da demo: aba Loja com cadastros de trade no aparelho; check-in → visita de loja → fotos → gôndola e share gravados; relatório de share no BKO; nunca cria pedido${marca(PENDENTE_PROMOTOR)}`,
    async () => {
      const mods = (await api.meusModulos(token.promotor)).modulos.map((m) => m.id);
      expect(mods, 'Promotor nos módulos da Joana (seed promotor.ts)').toContain('promotor');
      expect(mods, 'RN-PRO-01: sem o Vendedor').not.toContain('vendedor');
      const joana = await aparelhoCampo(api, DEMO.promotor, { entidadesExtras: [...ENTIDADES_PROMOTOR] });
      expect(await joana.sincronizar(), joana.motor.estado().erro ?? '').toBe(true);
      expect(joana.chamadasEtapas.filter((c) => c.status >= 400)).toEqual([]);
      const m = joana.motor;
      const vivas = <T extends LinhaSync>(l: T[]) => l.filter((x) => !x.deleted_at);
      const categorias = vivas(await m.linhas<CategoriaGondolaSync & LinhaSync>('categoria_gondola'));
      const checklists = vivas(await m.linhas<ChecklistLojaSync & LinhaSync>('checklist_loja'));
      const metas = vivas(await m.linhas<MetaShareSync & LinhaSync>('meta_share'));
      const mix = vivas(await m.linhas<MixObrigatorioSync & LinhaSync>('mix_obrigatorio'));
      // com o pull no servidor, o aparelho tem os cadastros do seed (S9a confere as contagens); sem ele, ids do banco
      if (PENDENTE_PULL_PROMOTOR.length === 0) expect({ categorias: categorias.length, checklists: checklists.length, mix: mix.length, metas: metas.length >= 3 }).toEqual({ categorias: 3, checklists: 1, mix: 5, metas: true });
      // histórico do seed no servidor: 2 visitas de loja da Joana, com fotos
      const [hist] = await linhas<{ visitas: number; fotos: number }>(
        `select (select count(*)::int from promotor.visita_loja where tenant_id = $1 and deleted_at is null) as visitas,
                (select count(*)::int from promotor.foto_coleta where tenant_id = $1 and deleted_at is null) as fotos`,
        [TENANT_DEMO],
      );
      expect(hist!.visitas).toBeGreaterThanOrEqual(2);
      expect(hist!.fotos).toBeGreaterThan(0);
      // 1ª parada da rota de hoje da Joana (com a coordenada do cliente: check-in dentro do raio)
      const [parada] = await linhas<{ id: string; cliente_id: string; lat: string | null; lng: string | null; segmento: string | null }>(
        `select rp.id, rp.cliente_id, c.latitude as lat, c.longitude as lng, c.segmento
           from core.rota_parada rp join core.cliente c on c.id = rp.cliente_id
          where rp.tenant_id = $1 and rp.usuario_id = $2 and rp.data = $3 and rp.deleted_at is null
          order by rp.sequencia limit 1`,
        [TENANT_DEMO, usuarioId.promotor, api.hoje],
      ).catch(async () =>
        linhas<{ id: string; cliente_id: string; lat: string | null; lng: string | null; segmento: string | null }>(
          `select rp.id, rp.cliente_id, c.latitude as lat, c.longitude as lng, null::text as segmento
             from core.rota_parada rp join core.cliente c on c.id = rp.cliente_id
            where rp.tenant_id = $1 and rp.usuario_id = $2 and rp.data = $3 and rp.deleted_at is null
            order by rp.sequencia limit 1`,
          [TENANT_DEMO, usuarioId.promotor, api.hoje],
        ),
      );
      expect(parada, 'parada de hoje na rota da Joana').toBeDefined();
      const lat = parada!.lat === null ? null : Number(parada!.lat);
      const lng = parada!.lng === null ? null : Number(parada!.lng);
      const agora = new Date();
      const visitaId = randomUUID();
      await m.enfileirar({
        id: visitaId,
        entidade: 'visita',
        payload: { id: visitaId, cliente_id: parada!.cliente_id, rota_parada_id: parada!.id, checkin_em: agora.toISOString(), ...(lat !== null && lng !== null ? { lat, lng, precisao_m: 10 } : {}), extra: false },
      });
      // aba Loja: o check-in aberto vira a visita de loja com o checklist vigente (RN-PRO-02/10)
      const aberto = checkinAberto(await m.linhas<VisitaSync & LinhaSync>('visita'), m.estado().fila, usuarioId.promotor);
      expect(aberto?.visita_id).toBe(visitaId);
      const loja = { id: parada!.cliente_id, segmento: parada!.segmento ?? null };
      const semPull = PENDENTE_PULL_PROMOTOR.length > 0;
      const checklist = semPull
        ? (
            await linhas<{ id: string }>(
              `select id from promotor.checklist_loja where tenant_id = $1 and deleted_at is null and vigencia_inicio <= $2::date
                  and (vigencia_fim is null or vigencia_fim >= $2::date) and (cliente_id is null or cliente_id = $3) order by cliente_id nulls last limit 1`,
              [TENANT_DEMO, api.hoje, parada!.cliente_id],
            )
          )[0] ?? null
        : checklistDaLoja(checklists, loja, api.hoje);
      expect(checklist, 'checklist vigente para a loja').not.toBeNull();
      const vl = abrirVisitaLoja(randomUUID(), aberto!, checklist!.id);
      await m.enfileirar({ id: vl.id, entidade: 'visita_loja', payload: vl });
      // fotos da gôndola (câmera do shell: coordenada do momento) → gôndola conforme → share de uma categoria com meta
      const cat = semPull
        ? (await linhas<{ id: string }>('select id from promotor.categoria_gondola where tenant_id = $1 and deleted_at is null order by ordem, id limit 1', [TENANT_DEMO]))[0]!
        : [...categorias].sort((a, b) => a.ordem - b.ordem)[0]!;
      expect(cat, 'categoria de gôndola do seed').toBeDefined();
      const fotos = (['gondola_antes', 'gondola_depois'] as const).map((tipo) => montarFoto({ id: randomUUID(), visita_loja_id: vl.id, tipo, agora: new Date(), latitude: lat, longitude: lng }));
      for (const fo of fotos) await m.enfileirar({ id: fo.id, entidade: 'foto_coleta', payload: fo });
      const g = montarGondola({ id: randomUUID(), visita_loja_id: vl.id, categoria_gondola_id: cat.id, foto_antes_id: fotos[0]!.id, foto_depois_id: fotos[1]!.id, foto_referencia_id: null, conformidade: 'conforme', motivo: '', agora: new Date() });
      expect(g.ok).toBe(true);
      if (!g.ok) return;
      await m.enfileirar({ id: g.coleta.id, entidade: 'gondola_registro', payload: g.coleta });
      const meta = semPull
        ? ((await linhas<{ id: string; meta_pct: number }>('select id, meta_pct::float8 as meta_pct from promotor.meta_share where tenant_id = $1 and categoria_gondola_id = $2 and deleted_at is null limit 1', [TENANT_DEMO, cat.id]))[0] ?? null)
        : metaDaCategoria(metas, cat.id, loja, api.hoje);
      const sh = montarShare({ id: randomUUID(), visita_loja_id: vl.id, categoria_gondola_id: cat.id, frentes_nossas: '6', frentes_total: '15', meta: meta ? { id: meta.id, meta_pct: meta.meta_pct } : null, agora: new Date() });
      expect(sh.ok).toBe(true);
      if (!sh.ok) return;
      await m.enfileirar({ id: sh.coleta.id, entidade: 'medicao_share', payload: sh.coleta });
      expect(await joana.sincronizar(), m.estado().erro ?? '').toBe(true);
      expect(m.estado().fila, 'fila da Joana zerada (nenhuma coleta recusada)').toEqual([]);
      const gravado = async (tabela: string, id: string) => (await linhas<{ n: number }>(`select count(*)::int as n from promotor.${tabela} where id = $1`, [id]))[0]!.n;
      expect({
        visita: (await linhas('select id from core.visita where id = $1', [visitaId])).length,
        visita_loja: await gravado('visita_loja', vl.id),
        fotos: (await gravado('foto_coleta', fotos[0]!.id)) + (await gravado('foto_coleta', fotos[1]!.id)),
        gondola: await gravado('gondola_registro', g.coleta.id),
        share: await gravado('medicao_share', sh.coleta.id),
      }).toEqual({ visita: 1, visita_loja: 1, fotos: 2, gondola: 1, share: 1 });
      // BKO › Trade marketing (supervisora): relatório de share com linhas da base (visitas do seed)
      const de = new Date(Date.parse(`${api.hoje}T12:00:00Z`) - 20 * 86_400_000).toISOString().slice(0, 10);
      const rel = await api.get(token.supervisor, `/v1/promotor/relatorios/share?de=${de}&ate=${api.hoje}`);
      expect(rel.status, JSON.stringify(rel.corpo)).toBe(200);
      expect((rel.corpo.linhas as unknown[] | undefined)?.length ?? 0, `relatório de share: ${JSON.stringify(rel.corpo).slice(0, 300)}`).toBeGreaterThan(0);
      // RN-PRO-01 com o Promotor ligado: pedido recusado, nada no banco; nenhuma entidade de pedido no aparelho
      const pid = randomUUID();
      const [r] = await push(token.promotor, [{ id: pid, entidade: 'pedido', operacao: 'upsert', payload: { id: pid, customer_id: parada!.cliente_id, items: [], discount_pct: 0 } }]);
      expect(r!.status).toBe('rejeitado');
      expect(await linhas('select id from vendedor.pedido where id = $1', [pid])).toEqual([]);
      expect((await api.chamar(token.promotor, { method: 'POST', url: '/v1/vendedor/pedidos', payload: { id: pid, customer_id: parada!.cliente_id, items: [] } })).statusCode).toBeGreaterThanOrEqual(400);
      expect(joana.lotesEnviados.flat().filter((i) => i.entidade.startsWith('pedido'))).toEqual([]);
    },
    240_000,
  );

  it.skipIf(PENDENTE_PROMOTOR.length + PENDENTE_PULL_PROMOTOR.length > 0)(
    `S9a. Loja da Joana (M-D21): o Sincronizar traz os cadastros de trade do seed — 3 categorias, 1 checklist, mix de 5 e as metas de share${marca([...PENDENTE_PROMOTOR, ...PENDENTE_PULL_PROMOTOR])}`,
    async () => {
      const joana = await aparelhoCampo(api, DEMO.promotor, { entidadesExtras: [...ENTIDADES_PROMOTOR] });
      expect(await joana.sincronizar(), joana.motor.estado().erro ?? '').toBe(true);
      const vivas = <T extends LinhaSync>(l: T[]) => l.filter((x) => !x.deleted_at);
      const n = async (e: string) => vivas(await joana.motor.linhas<LinhaSync>(e)).length;
      expect({ categorias: await n('categoria_gondola'), checklists: await n('checklist_loja'), mix: await n('mix_obrigatorio'), metas: (await n('meta_share')) >= 3 }).toEqual({ categorias: 3, checklists: 1, mix: 5, metas: true });
    },
    240_000,
  );

  it('S10. PDF interno no Campo (vendedor@): pelas linhas do aparelho, o pedido aprovado do S3 sai com o número, o desconto 8,0% e a Renata; o do cliente sem nenhum %', async () => {
    expect(pedidoId, 'depende do S3').not.toBe('');
    expect(await lucas.sincronizar(), lucas.motor.estado().erro ?? '').toBe(true);
    const local = detalheDoPedido(await lerLinhas(lucas.motor), pedidoId, 'vendedor', lucas.motor.parametros('vendedor'));
    expect(local, 'pedido do S3 nas linhas do aparelho').not.toBeNull();
    expect(local!.status).toBe('approved');
    const doc = pdfDoPedido(local!);
    const ctx = { tenant_name: nomeDaDistribuidora(lucas.sessao.tenant.nome, lucas.motor.parametros('core')), product_name: 'Macuxi FDV', tz: lucas.sessao.tenant.fuso, generated_at: new Date().toISOString() };
    const interno = buildOrderPdfHtml(doc, 'bko', ctx);
    expect(interno).toContain(numero);
    expect(interno).toContain('8,0%');
    expect(interno, 'quem aprovou no PDF interno').toContain('Renata');
    expect(interno).toContain(formatBRL(doc.total_cents));
    for (const i of doc.items) expect(interno).toContain(i.description);
    if (doc.price_table && doc.price_table_name) expect(interno, 'o PDF interno nunca mostra o id da tabela').not.toContain(doc.price_table);
    // RN-VEN-41 (T-0141): PED-XXXX-DDMMAAAA.pdf, a data de emissão no fuso do tenant; o mesmo nome nas duas versões do PDF
    expect(orderPdfFileName(numero, doc.created_at, ctx.tz)).toMatch(/^PED-\d{4,}-\d{8}\.pdf$/);
    const cliente = buildOrderPdfHtml(doc, 'customer', ctx);
    expect(cliente).toContain(numero);
    expect(cliente).not.toContain('%');
  });

  // Telas novas do BKO (03/11), no fim: o U3 grava um usuário na equipe da Renata e não pode mexer na conta do S8.
  const ctxTelas: CtxTelasNovas = { api: () => api, token: (k) => token[k], usuarioId: (k) => usuarioId[k] };
  casosUsuarios(ctxTelas);
  casosCadastrosTrade(ctxTelas);
});
