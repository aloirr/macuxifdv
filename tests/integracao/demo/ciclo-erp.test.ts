/**
 * T-0032 (agente testes) — CICLO COMPLETO COM O ERP SIMULADO, ponta a ponta, com o `createApp` REAL (8 módulos de `MODULOS_API`,
 * JWT de verdade, Postgres como `macuxi_app`, RLS), o DESPACHANTE REAL da outbox (`macuxi_worker`) e a fixture dois-tenants
 * num banco efêmero próprio do arquivo. O único "simulado" é o Conector on-premise: um cliente HTTP (inject do Fastify) que
 * fala com as rotas `/integracao/v1` da ADR 0013 (docs/modulos/integracao/hub-api.md §6) exatamente como o `apps/conector`
 * fala: `Authorization: Bearer <chave>`, `X-Macuxi-Conector-Id`, `X-Macuxi-Conector-Versao` e `Idempotency-Key` (SHA-256 hex
 * do conteúdo) em `POST /lotes`.
 *
 * Passos (critérios do pedido do gerente para a T-0032, frente nuvem):
 *  C1 carga do ERP (vendedor → cliente → produto → preço) pelo Hub; o consumidor `integracao.lote.recebido@1` aplica e o lote
 *     conclui; os consumidores do Core e do Catálogo levam o cadastro ao Macuxi (usuário adotado, cliente + carteira, produto,
 *     item da tabela de preço). Idempotência (RN-INT-12): mesma chave + mesmo conteúdo repete a resposta (mesmo `lote_id`,
 *     `Idempotent-Replay`), sem lote nem evento novo; mesma chave + outro conteúdo = 409.
 *  C2 o vendedor (app Campo: motor de sync real) tira o pedido para o cliente do ERP; dentro da alçada (RN-VEN-10) sai aprovado
 *     na hora e publica `vendedor.pedido.aprovado@1` com as chaves do ERP.
 *  C3 o despachante põe o pedido na fila do ERP (A8, de-para da condição AVISTA → 001); o Conector vê em `GET /pedidos/pendentes`
 *     (pendente → enviado) e não o recebe de novo na consulta seguinte.
 *  C4 retorno `integrado` (numero_erp) e depois `faturado_total` (nota + itens_faturados) pelas rotas de retorno; repetição
 *     idempotente (`repetido: true`, sem evento novo).
 *  C5 o Campo (pull do aparelho) e o BKO (`/v1/vendedor/pedidos` e `/v1/integracao/monitor`) mostram integrado e faturado.
 *  C6 multi-tenant: o Conector de B (chave própria) não vê a fila nem o pedido de A; a chave de B com o identificador de A é 401
 *     genérico (mesma resposta da chave inexistente, RN-INT-10); o monitor e o BKO de B não mostram nada de A.
 *
 * Premissas de preparação (escritas pelo admin do banco efêmero, nunca no banco compartilhado):
 *  - Licença `integracao` ligada nos dois tenants pela rota real do Core (a fixture não a traz).
 *  - A fixture deixa lotes `recebido` sem staging (A: produto; B: o que houver) que seguram a fila da mesma entidade (predecessor,
 *    RN-INT-04): são marcados `concluido` antes da carga (mesma técnica de modules/integracao/api/consumidores.db.test.ts).
 *  - LACUNA (sem rota nem campo para isso hoje): nenhum caminho do ERP nem do BKO vincula o cliente à tabela de preço
 *    (`catalogo.cliente_tabela_preco`); sem o vínculo, o cliente que veio do ERP não tem preço (RN-CAT-06) e não há pedido. O teste
 *    grava o vínculo do cliente do ERP com a tabela `PADRAO` (adotada pelo preço do ERP) — ver o relatório da T-0032.
 *  - O pepper do Hub é o da fixture (`PEPPER_HUB_FIXTURE`), posto em `MACUXI_HUB_CHAVE_PEPPER` só neste processo de teste.
 *
 * Nenhuma data fixa contra o now() do banco. Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { createHash, randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteAceito, LoteResultado, MonitorResumo, PedidosPendentes, VERSAO_CONTRATO, type PedidoParaErp } from '@macuxi/integracao/contracts';
import { OrderDetail } from '@macuxi/vendedor/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { montarPedido, prepararPedido, rascunhoVazio, type Rascunho } from '../../../modules/vendedor/app/lib/pedidos';
import { condicoesDoCliente, lerLinhas, listaDeClientes, listaDePedidos, meDoAparelho, politicaApi, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { A, B, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';

/** Prefixo dos external_id deste arquivo (o banco é próprio, mas facilita ler o monitor e o log). */
const P = `CICLO${randomUUID().slice(0, 4).toUpperCase()}`;
const EXT = {
  vendedor: `${P}-V1`,
  cliente: `${P}-C1`,
  produto1: `${P}-P1`,
  produto2: `${P}-P2`,
  tabela: 'PADRAO',
} as const;
const VERSAO_CONECTOR = '1.2.0';
/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP_B = '203.0.113.5';
const IP_A = '198.51.100.10';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Entidade = 'vendedor' | 'cliente' | 'produto' | 'preco';

/**
 * Conector on-premise simulado: cabeçalhos da ADR 0013 em toda chamada, `Idempotency-Key` = SHA-256 do conteúdo no lote
 * (o `apps/conector` faz o mesmo), IP de origem próprio (o de B está na lista de IPs do Conector dele).
 */
function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string) {
  const cab = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
    ...extra,
  });
  const chamar = (method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: cab(extra), remoteAddress: ip, ...(payload ? { payload } : {}) });
  const envelope = (entidade: Entidade, registros: object[]) => ({
    versao_contrato: VERSAO_CONTRATO,
    entidade,
    modo: 'delta' as const,
    conector_id: t.integracao.identificador,
    versao_conector: VERSAO_CONECTOR,
    enviado_em: new Date().toISOString(),
    registros,
  });
  /** Chave = SHA-256 do conteúdo canônico (sem `enviado_em`, como o Conector). */
  const chaveDe = (corpo: ReturnType<typeof envelope>) => sha256(JSON.stringify({ ...corpo, enviado_em: undefined }));
  return {
    cab,
    chamar,
    envelope,
    chaveDe,
    enviarLote: (corpo: ReturnType<typeof envelope>, chave = chaveDe(corpo)) => chamar('POST', '/lotes', corpo, { 'idempotency-key': chave }),
    consultarLote: (id: string) => chamar('GET', `/lotes/${id}`),
    cursor: (entidade: Entidade) => chamar('GET', `/cursores/${entidade}`),
    pendentes: () => chamar('GET', '/pedidos/pendentes?limite=100'),
    retorno: (pedido: string, corpo: object) => chamar('POST', `/pedidos/${pedido}/retorno`, { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedido, ocorrido_em: new Date().toISOString(), ...corpo }),
    sinal: () =>
      chamar('POST', '/sinal', { conector_id: t.integracao.identificador, versao_conector: VERSAO_CONECTOR, versao_contrato: VERSAO_CONTRATO, em: new Date().toISOString(), fila: [], entidades: [] }),
  };
}
type Conector = ReturnType<typeof conectorSimulado>;

describe.skipIf(semBanco())('T-0032 — ciclo com o ERP simulado: carga → pedido no Campo → fila do ERP → integrado → faturado (createApp real × Postgres × despachante, dois tenants)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let erpA: Conector;
  let erpB: Conector;
  let vendedorA: AparelhoCampo;
  const tk = { adminA: '', analistaA: '', adminB: '', vendedorB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  /** Lotes da carga de A, por entidade. */
  const lotes: Partial<Record<Entidade, string>> = {};
  let pedidoId = '';
  let paraErp: PedidoParaErp | undefined;
  const NUMERO_ERP = `PV-${P}`;

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  /** Ciclos do despachante real até a outbox esvaziar (eventos de consumidores encadeados entram nos ciclos seguintes). */
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  /** Eventos parados (com falha) no tenant: o ciclo não pode terminar com consumidor quebrando em silêncio. */
  const eventosComFalha = (tenantId: string) =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0', [tenantId]);
  const pedidoNoBanco = async (id: string) => (await linhas<{ status: string; tenant_id: string; numero_erp: string | null }>('select status, tenant_id, numero_erp from vendedor.pedido where id = $1', [id]))[0];
  const filaErp = async (id: string) =>
    (await linhas<{ tenant_id: string; estado: string; numero_erp: string | null; tentativas: number; retencao_codigo: string | null }>('select tenant_id, estado, numero_erp, tentativas, retencao_codigo from integracao.pedido_fila_erp where pedido_uuid = $1', [id]))[0];

  /** Os 3 números de `resumo_pedidos` que saem direto da contagem por estado da fila do tenant (RN da T-0173, `resumoPedidosErp`). */
  const resumoDaFila = async (tenantId: string) => {
    const n = new Map((await linhas<{ estado: string; n: number }>('select estado, count(*)::int as n from integracao.pedido_fila_erp where tenant_id = $1 and deleted_at is null group by estado', [tenantId])).map((x) => [x.estado, x.n]));
    return { na_fila: n.get('pendente') ?? 0, entregue_ao_conector: n.get('enviado') ?? 0, rejeitado_pelo_erp: n.get('rejeitado_erp') ?? 0 };
  };

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o ciclo do ERP precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.analistaA = (await api.sessao('analista@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    // licença do módulo no tenant (o Hub e o despachante) e nos perfis do BKO do monitor (admin e analista; RN-CORE-02)
    for (const [t, token] of [[A, tk.adminA], [B, tk.adminB]] as const) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, `licença integracao em ${t.codigo}: ${r.body}`).toBe(200);
      for (const perfil of ['admin', 'analista']) {
        const rp = await licenca(api, token, 'perfil', 'integracao', true, perfil);
        expect(rp.statusCode, `licença integracao do perfil ${perfil} em ${t.codigo}: ${rp.body}`).toBe(200);
      }
    }
    // eventos antigos da fixture e lotes `recebido` sem staging não podem segurar a fila da carga (premissa no cabeçalho)
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    erpA = conectorSimulado(api, A, IP_A);
    erpB = conectorSimulado(api, B, IP_B);
  }, 240_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ C1 carga pelo Hub
  describe('C1. Carga do ERP pelo Hub (/integracao/v1/lotes) e aplicação pelo consumidor', () => {
    const alterado = () => new Date(Date.now() - 60_000).toISOString();
    const registros = (): Record<Entidade, object[]> => ({
      // mesmo e-mail do "Vendedor Um" de A (sem external_id): o Core ADOTA o usuário (mantém senha, perfil e equipe)
      vendedor: [{ external_id: EXT.vendedor, alterado_em: alterado(), nome: 'Vendedor Um (ERP)', email: 'vendedor@exemplo.com.br', telefone: null }],
      cliente: [
        {
          external_id: EXT.cliente,
          alterado_em: alterado(),
          razao_social: `Auto Center ${P} Ltda`,
          nome_fantasia: `Auto Center ${P}`,
          documento: '77777777000191',
          inscricao_estadual: 'ISENTO',
          vendedor_external_id: EXT.vendedor,
          endereco: { logradouro: 'Av. Djalma Batista', numero: '1000', bairro: 'Chapada', cidade: 'Manaus', uf: 'AM', cep: '69050-010' },
          latitude: -3.1,
          longitude: -60.02,
          telefone: '92999990000',
          email: 'compras@autocenter.exemplo.com.br',
          limite_credito_cents: 50_000_000,
          contatos: [],
        },
      ],
      produto: [
        { external_id: EXT.produto1, alterado_em: alterado(), sku: `${P}-SKU1`, ean: null, nome: `Amortecedor ${P}`, marca: 'Norfreio', categoria: 'Suspensão', unidade: 'PC' },
        { external_id: EXT.produto2, alterado_em: alterado(), sku: `${P}-SKU2`, ean: null, nome: `Bieleta ${P}`, marca: 'Norfreio', categoria: 'Suspensão', unidade: 'PC' },
      ],
      preco: [
        { external_id: `${EXT.tabela}:${EXT.produto1}`, alterado_em: alterado(), tabela_external_id: EXT.tabela, tabela_nome: 'Padrão Alfa', vigencia_inicio: '2020-01-01', vigencia_fim: null, produto_external_id: EXT.produto1, preco_cents: 25_000 },
        { external_id: `${EXT.tabela}:${EXT.produto2}`, alterado_em: alterado(), tabela_external_id: EXT.tabela, tabela_nome: 'Padrão Alfa', vigencia_inicio: '2020-01-01', vigencia_fim: null, produto_external_id: EXT.produto2, preco_cents: 4_000 },
      ],
    });

    it('sinal de vida do Conector de A passa (200 com a política de versão) — o Conector entra no ar antes da carga', async () => {
      const r = await erpA.sinal();
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ politica_versao: expect.objectContaining({ versao_minima: '1.1.0' }) });
    });

    it.each(['vendedor', 'cliente', 'produto', 'preco'] as const)('lote delta de %s: 202 recebido → despachante → GET /lotes/{id} concluído, sem erro, cursor avançado', async (entidade) => {
      const corpo = erpA.envelope(entidade, registros()[entidade]);
      const r = await erpA.enviarLote(corpo);
      expect(r.statusCode, r.body).toBe(202);
      const aceito = LoteAceito.parse(r.json());
      expect(aceito).toMatchObject({ status: 'recebido', entidade, modo: 'delta', recebidos: corpo.registros.length });
      expect(aceito.repetido ?? false).toBe(false);
      lotes[entidade] = aceito.lote_id;

      await despachar();
      const c = await erpA.consultarLote(aceito.lote_id);
      expect(c.statusCode, c.body).toBe(200);
      const res = LoteResultado.parse(c.json());
      expect(res.erros, JSON.stringify(res.erros)).toEqual([]);
      expect(res).toMatchObject({ lote_id: aceito.lote_id, entidade, status: 'concluido' });
      expect(res.contagens).toMatchObject({ recebidas: corpo.registros.length, com_erro: 0, novas: corpo.registros.length });
      expect(res.cursor).not.toBeNull();
      const cur = await erpA.cursor(entidade);
      expect(cur.statusCode, cur.body).toBe(200);
      expect(cur.json()).toMatchObject({ entidade, cursor: expect.objectContaining({ external_id: expect.any(String) }) });
      expect(await eventosComFalha(A.tenantId), 'nenhum consumidor falhou').toEqual([]);
    });

    it('o cadastro chegou ao Macuxi: vendedor adotado (external_id), cliente na carteira dele, 2 produtos e 2 preços na tabela PADRAO — tudo no tenant A', async () => {
      expect(Object.keys(lotes).sort()).toEqual(['cliente', 'preco', 'produto', 'vendedor']);
      expect(await linhas('select id, tenant_id from core.usuario where external_id = $1', [EXT.vendedor])).toEqual([{ id: A.usuarios.vendedor1, tenant_id: A.tenantId }]);
      const cli = await linhas<{ id: string; tenant_id: string }>('select id, tenant_id from core.cliente where external_id = $1', [EXT.cliente]);
      expect(cli).toEqual([{ id: expect.any(String), tenant_id: A.tenantId }]);
      expect(await linhas("select usuario_id from core.carteira where cliente_id = $1 and papel = 'vendedor' and deleted_at is null", [cli[0]!.id])).toEqual([{ usuario_id: A.usuarios.vendedor1 }]);
      const prods = await linhas<{ external_id: string; tenant_id: string }>('select external_id, tenant_id from core.produto where external_id = any($1) order by external_id', [[EXT.produto1, EXT.produto2]]);
      expect(prods).toEqual([
        { external_id: EXT.produto1, tenant_id: A.tenantId },
        { external_id: EXT.produto2, tenant_id: A.tenantId },
      ]);
      const precos = await linhas<{ preco: number; tabela: string }>(
        `select i.preco_cents::int as preco, t.codigo as tabela from catalogo.tabela_preco_item i join catalogo.tabela_preco t on t.id = i.tabela_preco_id
          where i.external_id = any($1) and i.deleted_at is null order by i.preco_cents desc`,
        [[`${EXT.tabela}:${EXT.produto1}`, `${EXT.tabela}:${EXT.produto2}`]],
      );
      expect(precos).toEqual([
        { preco: 25_000, tabela: 'PADRAO' },
        { preco: 4_000, tabela: 'PADRAO' },
      ]);
      // B não recebeu nada da carga de A
      expect(await linhas('select 1 from core.cliente where tenant_id = $1 and external_id = $2', [B.tenantId, EXT.cliente])).toEqual([]);
    });

    it('RN-INT-12 (negativo): o mesmo lote com a MESMA Idempotency-Key repete a resposta (mesmo lote_id, repetido, Idempotent-Replay) sem lote nem evento novo; outro conteúdo com a mesma chave = 409', async () => {
      const corpo = erpA.envelope('vendedor', [{ external_id: `${P}-V9`, alterado_em: alterado(), nome: 'Vendedor Repetido', email: null, telefone: null }]);
      const chave = erpA.chaveDe(corpo);
      const r1 = await erpA.enviarLote(corpo, chave);
      expect(r1.statusCode, r1.body).toBe(202);
      const id = LoteAceito.parse(r1.json()).lote_id;
      // o Conector perdeu a resposta e reenvia (enviado_em novo não muda o conteúdo canônico)
      const r2 = await erpA.enviarLote({ ...corpo, enviado_em: new Date(Date.now() + 1_000).toISOString() }, chave);
      expect(r2.statusCode, r2.body).toBe(202);
      expect(r2.json()).toMatchObject({ lote_id: id, repetido: true });
      expect(r2.headers['idempotent-replay']).toBe('true');
      const r3 = await erpA.enviarLote(erpA.envelope('vendedor', [{ external_id: `${P}-V9`, alterado_em: alterado(), nome: 'Outro nome', email: null, telefone: null }]), chave);
      expect(r3.statusCode, r3.body).toBe(409);
      expect(r3.json()).toMatchObject({ codigo: 'chave_idempotencia_reutilizada' });
      expect(await linhas('select id from integracao.lote where chave_idempotencia = $1', [chave])).toEqual([{ id }]);
      expect(await linhas("select 1 from plataforma.evento where nome = 'integracao.lote.recebido@1' and payload->>'lote_id' = $1", [id])).toHaveLength(1);
      await despachar();
    });

    it('sem Idempotency-Key o lote é recusado (400 chave_idempotencia_invalida), sem lote criado', async () => {
      const antes = (await linhas('select id from integracao.lote where tenant_id = $1', [A.tenantId])).length;
      const r = await erpA.chamar('POST', '/lotes', erpA.envelope('produto', registros().produto));
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json()).toMatchObject({ codigo: 'chave_idempotencia_invalida' });
      expect((await linhas('select id from integracao.lote where tenant_id = $1', [A.tenantId])).length).toBe(antes);
    });
  });

  // ------------------------------------------------------------------------------------------------ C2 pedido no Campo
  describe('C2. Pedido no Campo para o cliente que veio do ERP (aprovado na alçada)', () => {
    it('o vendedor sincroniza, vê o cliente e os produtos do ERP com preço, tira o pedido (0% de desconto) e o servidor aprova na hora com as chaves do ERP no aprovado@1', async () => {
      const [cli] = await linhas<{ id: string }>('select id from core.cliente where external_id = $1', [EXT.cliente]);
      expect(cli, 'C1 trouxe o cliente').toBeDefined();
      // LACUNA (cabeçalho): sem rota/campo que ligue o cliente do ERP à tabela de preço, o vínculo é gravado aqui
      await api.admin.query('insert into catalogo.cliente_tabela_preco (tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3)', [A.tenantId, cli!.id, A.tabelasPreco.padrao]);
      await esperarHorizonte();
      vendedorA = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { tenant: A });
      expect(await vendedorA.sincronizar(), vendedorA.motor.estado().erro ?? '').toBe(true);

      const l = await lerLinhas(vendedorA.motor);
      const u = vendedorA.sessao.usuario;
      const params = vendedorA.motor.parametros('vendedor');
      const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => c.id === cli!.id);
      expect(cliente, 'cliente do ERP na carteira do aparelho').toBeDefined();
      const doErp = l.produtos.filter((p) => [`${P}-SKU1`, `${P}-SKU2`].includes((p as { sku?: string }).sku ?? ''));
      expect(doErp, 'produtos do ERP no aparelho').toHaveLength(2);
      const precos = await vendedorA.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente!.id, produto_ids: doErp.map((p) => p.id), em: new Date().toISOString() });
      const catalogo = produtosComPrecos(l, new Map(precos.itens.map((i) => [i.produto_id, i.preco_cents]))).filter((p) => doErp.some((d) => d.id === p.id));
      expect(catalogo.map((p) => p.price_cents).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([4_000, 25_000]);
      const conds = condicoesDoCliente(l, cliente!.id);
      const rascunho: Rascunho = {
        ...rascunhoVazio(cliente!.id),
        lines: Object.fromEntries(catalogo.map((p, i) => [p.id, i + 2])),
        discount_pct: 0,
        condicao_pagamento_id: conds[0]?.id ?? null,
        payment_terms: conds[0]?.descricao ?? 'À vista',
      };
      const eu = meDoAparelho({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: vendedorA.sessao.tenant.fuso }, params, new Date()).seller;
      const { v, display } = prepararPedido({ rascunho, cliente: cliente!, catalogo, politica: politicaApi(params), eu, filaDoClienteCents: 0 });
      expect(display.expected, 'dentro da alçada o app já mostra que não vai para aprovação').toBe('ok');
      pedidoId = randomUUID();
      await vendedorA.motor.enfileirar({ id: pedidoId, entidade: 'pedido', payload: montarPedido({ id: pedidoId, cliente: cliente!, rascunho, v, semSinal: false, agora: new Date().toISOString() }) });
      expect(await vendedorA.sincronizar(), vendedorA.motor.estado().erro ?? '').toBe(true);
      expect(vendedorA.motor.estado().fila).toEqual([]);

      expect(await pedidoNoBanco(pedidoId)).toMatchObject({ status: 'approved', tenant_id: A.tenantId });
      const ev = await linhas<{ payload: Record<string, unknown> }>("select payload from plataforma.evento where agregado_id = $1 and nome = 'vendedor.pedido.aprovado@1'", [pedidoId]);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ pedido_uuid: pedidoId, cliente_external_id: EXT.cliente, vendedor_external_id: EXT.vendedor, condicao_pagamento_codigo: 'AVISTA' });
      expect((ev[0]!.payload.itens as Array<{ produto_external_id: string }>).map((i) => i.produto_external_id).sort()).toEqual([EXT.produto1, EXT.produto2]);
    });
  });

  // ------------------------------------------------------------------------------------------------ C3 fila do ERP
  describe('C3. Fila do ERP: o Conector vê o pedido em /pedidos/pendentes', () => {
    it('despachante → fila pendente (de-para AVISTA → 001); o Conector de B não vê o pedido de A; o de A recebe o pedido completo e ele passa a enviado', async () => {
      expect(pedidoId, 'C2 criou o pedido').not.toBe('');
      await despachar();
      expect(await eventosComFalha(A.tenantId)).toEqual([]);
      expect(await filaErp(pedidoId)).toMatchObject({ tenant_id: A.tenantId, estado: 'pendente', tentativas: 0, retencao_codigo: null });

      // B primeiro: a consulta dele (que também marca enviado) não pode tocar no pedido de A
      const rb = await erpB.pendentes();
      expect(rb.statusCode, rb.body).toBe(200);
      expect(PedidosPendentes.parse(rb.json()).pedidos.map((x) => x.pedido_uuid)).not.toContain(pedidoId);
      expect((await filaErp(pedidoId))?.estado).toBe('pendente');

      const r = await erpA.pendentes();
      expect(r.statusCode, r.body).toBe(200);
      paraErp = PedidosPendentes.parse(r.json()).pedidos.find((x) => x.pedido_uuid === pedidoId);
      expect(paraErp, 'pedido do Campo na fila do Conector de A').toBeDefined();
      expect(paraErp).toMatchObject({ cliente_external_id: EXT.cliente, vendedor_external_id: EXT.vendedor, condicao_pagamento_erp: '001', tentativa: 1 });
      expect(paraErp!.itens.map((i) => i.sequencia).sort()).toEqual([1, 2]);
      expect(paraErp!.itens.map((i) => i.produto_external_id).sort()).toEqual([EXT.produto1, EXT.produto2]);
      expect(paraErp!.total_cents).toBe(paraErp!.itens.reduce((s, i) => s + i.total_cents, 0));
      expect(await filaErp(pedidoId)).toMatchObject({ estado: 'enviado', tentativas: 1 });

      // a próxima consulta (antes do timeout de 10 min) não entrega o mesmo pedido de novo
      const r2 = await erpA.pendentes();
      expect(PedidosPendentes.parse(r2.json()).pedidos.map((x) => x.pedido_uuid)).not.toContain(pedidoId);
    });
  });

  // ------------------------------------------------------------------------------------------------ C4 retorno do ERP
  describe('C4. Retorno do ERP: integrado (numero_erp) e faturado (nota + itens_faturados)', () => {
    it('C6 antes do retorno: a chave de B com o identificador de A = 401 genérico, igual à chave inexistente; o Conector de B não confirma o pedido de A', async () => {
      const cruzado = await api.app.inject({
        method: 'POST',
        url: `/integracao/v1/pedidos/${pedidoId}/retorno`,
        headers: { ...erpA.cab(), authorization: `Bearer ${B.integracao.chave.chave}` },
        remoteAddress: IP_A,
        payload: { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedidoId, status: 'integrado', numero_erp: 'INVASOR', ocorrido_em: new Date().toISOString() },
      });
      const inexistente = await api.app.inject({
        method: 'GET',
        url: '/integracao/v1/pedidos/pendentes',
        headers: { ...erpA.cab(), authorization: `Bearer mxk_naoexiste_${'x'.repeat(43)}` },
        remoteAddress: IP_A,
      });
      for (const r of [cruzado, inexistente]) {
        expect(r.statusCode, r.body).toBe(401);
        expect(r.json()).toMatchObject({ codigo: 'credencial_invalida' });
      }
      expect((cruzado.json() as { mensagem: string }).mensagem).toBe((inexistente.json() as { mensagem: string }).mensagem);
      // a chave de A com o identificador de B também não vale
      const trocado = await erpA.chamar('GET', '/pedidos/pendentes', undefined, { 'x-macuxi-conector-id': B.integracao.identificador });
      expect(trocado.statusCode, trocado.body).toBe(401);

      const pelaB = await erpB.retorno(pedidoId, { status: 'integrado', numero_erp: 'INVASOR' });
      expect([404, 422], pelaB.body).toContain(pelaB.statusCode);
      expect(await filaErp(pedidoId)).toMatchObject({ estado: 'enviado', numero_erp: null });
    });

    it('integrado: 200 repetido=false; o mesmo retorno de novo = repetido=true sem evento novo; despachante → o pedido do Vendedor fica integrated com o número do ERP', async () => {
      const r = await erpA.retorno(pedidoId, { status: 'integrado', numero_erp: NUMERO_ERP });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ pedido_uuid: pedidoId, status: 'integrado', repetido: false });
      const r2 = await erpA.retorno(pedidoId, { status: 'integrado', numero_erp: NUMERO_ERP });
      expect(r2.statusCode, r2.body).toBe(200);
      expect(r2.json()).toMatchObject({ repetido: true });
      expect(await linhas("select 1 from plataforma.evento where nome = 'integracao.pedido.retorno_erp@1' and agregado_id = $1", [pedidoId])).toHaveLength(1);
      // outro número para o mesmo pedido é recusado (RN-INT-08)
      const div = await erpA.retorno(pedidoId, { status: 'integrado', numero_erp: `${NUMERO_ERP}-X` });
      expect(div.statusCode, div.body).toBe(422);
      expect(div.json()).toMatchObject({ codigo: 'numero_erp_divergente' });

      await despachar();
      expect(await eventosComFalha(A.tenantId)).toEqual([]);
      expect(await filaErp(pedidoId)).toMatchObject({ estado: 'integrado', numero_erp: NUMERO_ERP });
      expect((await pedidoNoBanco(pedidoId))?.status).toBe('integrated');
    });

    it('C5 (integrado): o Campo vê integrated no próximo sync e o BKO do Vendedor mostra integrated', async () => {
      await esperarHorizonte();
      expect(await vendedorA.sincronizar(), vendedorA.motor.estado().erro ?? '').toBe(true);
      const l = await lerLinhas(vendedorA.motor);
      expect(listaDePedidos(l, vendedorA.motor.parametros('vendedor')).find((o) => o.id === pedidoId)?.status).toBe('integrated');
      const d = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/vendedor/pedidos/${pedidoId}` });
      expect(d.statusCode, d.body).toBe(200);
      expect(OrderDetail.parse(d.json()).status).toBe('integrated');
    });

    it('faturado_total com nota e itens_faturados (todas as sequências, quantidade cheia): 200 sem itens descartados; despachante → invoiced com a nota no faturamento', async () => {
      expect(paraErp, 'C3 trouxe o pedido').toBeDefined();
      const total = paraErp!.itens.reduce((s, i) => s + i.total_cents, 0);
      const r = await erpA.retorno(pedidoId, {
        status: 'faturado_total',
        numero_erp: NUMERO_ERP,
        nota: { numero: `NF-${P}`, serie: '1', emitida_em: new Date().toISOString(), total_cents: total },
        itens_faturados: paraErp!.itens.map((i) => ({ sequencia: i.sequencia, produto_external_id: i.produto_external_id, quantidade: i.quantidade, valor_cents: i.total_cents })),
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ pedido_uuid: pedidoId, status: 'faturado_total', repetido: false });
      expect((r.json() as { itens_descartados?: unknown[] }).itens_descartados ?? []).toEqual([]);

      await despachar();
      expect(await eventosComFalha(A.tenantId)).toEqual([]);
      expect(await filaErp(pedidoId)).toMatchObject({ estado: 'faturado_total', numero_erp: NUMERO_ERP });
      expect((await pedidoNoBanco(pedidoId))?.status).toBe('invoiced');
      const fat = await linhas<{ nota_numero: string; tenant_id: string }>('select nota_numero, tenant_id from vendedor.pedido_faturamento where pedido_id = $1 and deleted_at is null', [pedidoId]);
      expect(fat).toEqual([{ nota_numero: `NF-${P}`, tenant_id: A.tenantId }]);
      expect(await linhas("select 1 from plataforma.evento where nome = 'vendedor.pedido.faturado@1' and agregado_id = $1", [pedidoId])).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------ C5 Campo e BKO
  describe('C5. Campo e BKO mostram o pedido faturado', () => {
    it('Campo: o aparelho do vendedor recebe invoiced no sync (lista de pedidos)', async () => {
      await esperarHorizonte();
      expect(await vendedorA.sincronizar(), vendedorA.motor.estado().erro ?? '').toBe(true);
      const l = await lerLinhas(vendedorA.motor);
      expect(listaDePedidos(l, vendedorA.motor.parametros('vendedor')).find((o) => o.id === pedidoId)?.status).toBe('invoiced');
    });

    it('BKO do Vendedor: detalhe e lista filtrada (?status=invoiced) com o pedido faturado', async () => {
      const d = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/vendedor/pedidos/${pedidoId}` });
      expect(d.statusCode, d.body).toBe(200);
      expect(OrderDetail.parse(d.json()).status).toBe('invoiced');
      const lista = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/vendedor/pedidos?status=invoiced&limite=200' });
      expect(lista.statusCode, lista.body).toBe(200);
      const itens = ((lista.json() as { itens?: Array<{ id: string }> }).itens ?? []).map((o) => o.id);
      expect(itens).toContain(pedidoId);
    });

    it('BKO monitor do Hub (analista de A): os 4 lotes da carga concluídos, os números de pedidos iguais aos da fila; Conector de A no ar', async () => {
      const r = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/integracao/monitor' });
      expect(r.statusCode, r.body).toBe(200);
      const m = MonitorResumo.parse(r.json());
      for (const e of ['vendedor', 'cliente', 'produto', 'preco'] as const) {
        expect(m.lotes_recentes.find((l) => l.lote_id === lotes[e]), e).toMatchObject({ status: 'concluido', conector_id: A.integracao.identificador });
      }
      expect(m.resumo_pedidos).toMatchObject(await resumoDaFila(A.tenantId));
      expect(m.conectores.map((c) => c.conector_id)).toEqual([A.integracao.identificador]);
    });
  });

  // ------------------------------------------------------------------------------------------------ C6 multi-tenant
  describe('C6. Multi-tenant: B não vê o pedido, a fila nem a carga de A', () => {
    it('monitor do admin de B: só o Conector de B, nenhum lote de A, a fila de B (fixture) e nada do pedido de A', async () => {
      const r = await api.chamar(tk.adminB, { method: 'GET', url: '/v1/integracao/monitor' });
      expect(r.statusCode, r.body).toBe(200);
      const m = MonitorResumo.parse(r.json());
      expect(m.conectores.map((c) => c.conector_id)).toEqual([B.integracao.identificador]);
      const idsLotesA = Object.values(lotes);
      expect(m.lotes_recentes.filter((l) => idsLotesA.includes(l.lote_id))).toEqual([]);
      expect(JSON.stringify(m)).not.toContain(pedidoId);
      // os números do monitor de B são os da fila de B (estado sem pedido conta 0)
      expect(m.resumo_pedidos).toMatchObject(await resumoDaFila(B.tenantId));
    });

    it('o Conector de B: lote de A não existe para ele (404) e a fila dele continua sem o pedido de A', async () => {
      const r = await erpB.consultarLote(lotes.cliente!);
      expect(r.statusCode, r.body).toBe(404);
      expect(r.json()).toMatchObject({ codigo: 'lote_nao_encontrado' });
      const p = await erpB.pendentes();
      expect(p.statusCode, p.body).toBe(200);
      expect(PedidosPendentes.parse(p.json()).pedidos.map((x) => x.pedido_uuid)).not.toContain(pedidoId);
    });

    it('BKO do Vendedor em B: o vendedor de B (mesmo e-mail do vendedor de A) não abre o pedido de A (404) nem o vê na lista', async () => {
      const d = await api.chamar(tk.vendedorB, { method: 'GET', url: `/v1/vendedor/pedidos/${pedidoId}` });
      expect(d.statusCode, d.body).toBe(404);
      const lista = await api.chamar(tk.adminB, { method: 'GET', url: '/v1/vendedor/pedidos?limite=200' });
      expect([200, 403], lista.body).toContain(lista.statusCode);
      if (lista.statusCode === 200) expect(((lista.json() as { itens?: Array<{ id: string }> }).itens ?? []).map((o) => o.id)).not.toContain(pedidoId);
    });

    it('pelo papel da API com o contexto de B, a fila do ERP e o retorno do pedido de A são invisíveis (RLS)', async () => {
      const c = await api.pool.connect();
      try {
        await c.query('begin');
        await c.query("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
        expect((await c.query('select 1 from integracao.pedido_fila_erp where pedido_uuid = $1', [pedidoId])).rows).toEqual([]);
        expect((await c.query('select 1 from integracao.pedido_retorno where pedido_uuid = $1', [pedidoId])).rows).toEqual([]);
        expect((await c.query('select 1 from integracao.lote where id = any($1)', [Object.values(lotes)])).rows).toEqual([]);
      } finally {
        await c.query('rollback');
        c.release();
      }
    });
  });
});
