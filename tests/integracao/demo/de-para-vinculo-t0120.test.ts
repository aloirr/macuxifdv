/**
 * T-0120 (agente testes) — de-para da condição de pagamento no BKO e vínculo cliente → tabela de preço vindo do ERP, ponta a
 * ponta entre módulos: Conector simulado (ADR 0013) → Hub → `integracao.cliente.atualizado@1` → Core (cliente) e Catálogo
 * (`catalogo.cliente_tabela_preco`, RN-CAT-06) → app Campo (motor de sync real) com o preço → pedido `vendedor.pedido.aprovado@1`
 * → fila do ERP RETIDA sem de-para (RN-INT-08) → `PUT /v1/integracao/mapeamentos` libera o retido → `GET /pedidos/pendentes`.
 * `createApp` REAL (8 módulos), JWT de verdade, Postgres como `macuxi_app` (RLS), DESPACHANTE real (`macuxi_worker`), fixture
 * dois-tenants num banco efêmero próprio do arquivo. Banco só no CI (sem Docker no PC, R-20261105-053835).
 *
 * Fecha a LACUNA do `ciclo-erp.test.ts` (T-0032): lá o vínculo do cliente com a tabela é gravado à mão; aqui ele chega pelo
 * contrato (`ClientePayload.tabela_preco_external_id`, aditivo na v1).
 *
 * Casos (matriz docs/testes/T-0120.md):
 *  V-1  carga vendedor → produto → preço (adota a tabela PADRAO) → cliente com `tabela_preco_external_id: 'PADRAO'`: o Catálogo grava
 *       o vínculo (uma linha viva, external_id do cliente) sem evento parado; B não recebe nada.
 *  V-2  o app Campo, sem nenhum vínculo manual, vê o cliente do ERP com o preço da tabela vinculada (CONSULTA_PRECOS_CLIENTE).
 *  V-3  reenvio do mesmo cliente (alterado_em novo, mesma tabela) não duplica o vínculo (idempotente).
 *  R-1  sem o de-para AVISTA (apagado pelo admin no BKO), o pedido aprovado fica RETIDO: payload nulo, `mapeamento_ausente`, fora
 *       de `/pedidos/pendentes`; o BKO mostra `condicoes_sem_correspondente` = AVISTA (1 pedido).
 *  R-2  perfil e tenant: vendedor não grava de-para (403); B reprocessa os retidos dele e não libera o pedido de A.
 *  L-1  o analista grava AVISTA → 001: `pedidos_liberados: 1` na mesma transação; o Conector de A recebe o pedido com
 *       `condicao_pagamento_erp: '001'`; o B não vê; gravar de novo não libera nem reenvia (0).
 *
 * Premissas da preparação (admin do banco efêmero): licença `integracao` no tenant e nos perfis admin/analista de A e B; lotes
 * `recebido` da fixture marcados `concluido` (mesma técnica do ciclo-erp). Nenhuma data fixa contra o now() do banco.
 */
import { createHash, randomUUID } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { GravarMapeamentoResposta, LoteAceito, LoteResultado, MapeamentosResposta, PedidosPendentes, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { montarPedido, prepararPedido, rascunhoVazio, type Rascunho } from '../../../modules/vendedor/app/lib/pedidos';
import { condicoesDoCliente, lerLinhas, listaDeClientes, meDoAparelho, politicaApi, produtosComPrecos } from '../../../modules/vendedor/app/lib/pull';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';

const P = `T120${randomUUID().slice(0, 4).toUpperCase()}`;
const EXT = { vendedor: `${P}-V1`, cliente: `${P}-C1`, produto1: `${P}-P1`, produto2: `${P}-P2`, tabela: 'PADRAO' } as const;
const VERSAO_CONECTOR = '1.2.0';
const IP_A = '198.51.100.10';
/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP_B = '203.0.113.5';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Entidade = 'vendedor' | 'cliente' | 'produto' | 'preco';

/** Conector on-premise simulado (cabeçalhos da ADR 0013; `Idempotency-Key` = SHA-256 do conteúdo canônico), como no ciclo-erp. */
function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string) {
  const cab = {
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
  };
  const chamar = (method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: { ...cab, ...extra }, remoteAddress: ip, ...(payload ? { payload } : {}) });
  const envelope = (entidade: Entidade, registros: object[]) => ({
    versao_contrato: VERSAO_CONTRATO,
    entidade,
    modo: 'delta' as const,
    conector_id: t.integracao.identificador,
    versao_conector: VERSAO_CONECTOR,
    enviado_em: new Date().toISOString(),
    registros,
  });
  return {
    chamar,
    envelope,
    enviarLote: (corpo: ReturnType<typeof envelope>) => chamar('POST', '/lotes', corpo, { 'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })) }),
    pendentes: () => chamar('GET', '/pedidos/pendentes?limite=100'),
  };
}
type Conector = ReturnType<typeof conectorSimulado>;

describe.skipIf(semBanco())('T-0120 — vínculo cliente → tabela pelo contrato e de-para da condição liberando o pedido retido (createApp × Postgres × despachante)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let erpA: Conector;
  let erpB: Conector;
  let vendedorA: AparelhoCampo;
  const tk = { adminA: '', analistaA: '', vendedorA: '', adminB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  let clienteId = '';
  let pedidoId = '';
  let relogioErp = Date.now() - 10 * 60_000;
  const alterado = () => new Date((relogioErp += 1_000)).toISOString();

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  /** Despachante real com espera zero: o Catálogo que chega antes do Core (cliente ainda ausente) tenta de novo no ciclo seguinte. */
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
    for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 60 ciclos');
  };
  const eventosComFalha = (tenantId: string) =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0', [tenantId]);
  const vinculos = (cliente: string) =>
    linhas<{ tenant_id: string; tabela_preco_id: string; external_id: string | null }>(
      'select tenant_id, tabela_preco_id, external_id from catalogo.cliente_tabela_preco where cliente_id = $1 and deleted_at is null',
      [cliente],
    );
  const filaErp = async (id: string) =>
    (
      await linhas<{ tenant_id: string; estado: string; tem_payload: boolean; retencao_codigo: string | null; retencao_mensagem: string | null; tentativas: number }>(
        'select tenant_id, estado, payload is not null as tem_payload, retencao_codigo, retencao_mensagem, tentativas from integracao.pedido_fila_erp where pedido_uuid = $1',
        [id],
      )
    )[0];
  const mapeamentos = async (token: string) => {
    const r = await api.chamar(token, { method: 'GET', url: '/v1/integracao/mapeamentos' });
    expect(r.statusCode, r.body).toBe(200);
    return MapeamentosResposta.parse(r.json());
  };
  const gravarDePara = (token: string, corpo: object) => api.chamar(token, { method: 'PUT', url: '/v1/integracao/mapeamentos', payload: corpo });
  const carregar = async (entidade: Entidade, registros: object[]) => {
    const r = await erpA.enviarLote(erpA.envelope(entidade, registros));
    expect(r.statusCode, `${entidade}: ${r.body}`).toBe(202);
    const aceito = LoteAceito.parse(r.json());
    await despachar();
    const c = await erpA.chamar('GET', `/lotes/${aceito.lote_id}`);
    expect(c.statusCode, c.body).toBe(200);
    const res = LoteResultado.parse(c.json());
    expect(res.erros, `${entidade}: ${JSON.stringify(res.erros)}`).toEqual([]);
    expect(res.status, entidade).toBe('concluido');
    expect(await eventosComFalha(A.tenantId), `${entidade}: nenhum consumidor parado`).toEqual([]);
  };
  const clienteDoErp = (tabela: string | null | undefined) => ({
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
    ...(tabela === undefined ? {} : { tabela_preco_external_id: tabela }),
  });

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o Hub precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.analistaA = (await api.sessao('analista@exemplo.com.br', A)).access_token;
    tk.vendedorA = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    for (const [t, token] of [[A, tk.adminA], [B, tk.adminB]] as const) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, `licença integracao em ${t.codigo}: ${r.body}`).toBe(200);
      for (const perfil of ['admin', 'analista']) expect((await licenca(api, token, 'perfil', 'integracao', true, perfil)).statusCode).toBe(200);
    }
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    erpA = conectorSimulado(api, A, IP_A);
    erpB = conectorSimulado(api, B, IP_B);
  }, 300_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ V vínculo pelo contrato
  describe('V. Vínculo cliente → tabela de preço vindo do ERP (ClientePayload.tabela_preco_external_id, RN-CAT-06)', () => {
    it('V-1. carga vendedor → produto → preço → cliente com tabela PADRAO: o Catálogo grava o vínculo (uma linha viva), sem evento parado; B não recebe', async () => {
      await carregar('vendedor', [{ external_id: EXT.vendedor, alterado_em: alterado(), nome: 'Vendedor Um (ERP)', email: 'vendedor@exemplo.com.br', telefone: null }]);
      await carregar('produto', [
        { external_id: EXT.produto1, alterado_em: alterado(), sku: `${P}-SKU1`, ean: null, nome: `Amortecedor ${P}`, marca: 'Norfreio', categoria: 'Suspensão', unidade: 'PC' },
        { external_id: EXT.produto2, alterado_em: alterado(), sku: `${P}-SKU2`, ean: null, nome: `Bieleta ${P}`, marca: 'Norfreio', categoria: 'Suspensão', unidade: 'PC' },
      ]);
      await carregar('preco', [
        { external_id: `${EXT.tabela}:${EXT.produto1}`, alterado_em: alterado(), tabela_external_id: EXT.tabela, tabela_nome: 'Padrão Alfa', vigencia_inicio: '2020-01-01', vigencia_fim: null, produto_external_id: EXT.produto1, preco_cents: 25_000 },
        { external_id: `${EXT.tabela}:${EXT.produto2}`, alterado_em: alterado(), tabela_external_id: EXT.tabela, tabela_nome: 'Padrão Alfa', vigencia_inicio: '2020-01-01', vigencia_fim: null, produto_external_id: EXT.produto2, preco_cents: 4_000 },
      ]);
      const [tabela] = await linhas<{ id: string }>('select id from catalogo.tabela_preco where tenant_id = $1 and external_id = $2 and deleted_at is null', [A.tenantId, EXT.tabela]);
      expect(tabela, 'o preço do ERP adotou/criou a tabela PADRAO com external_id').toBeDefined();

      await carregar('cliente', [clienteDoErp(EXT.tabela)]);
      const [cli] = await linhas<{ id: string; tenant_id: string }>('select id, tenant_id from core.cliente where external_id = $1', [EXT.cliente]);
      expect(cli).toMatchObject({ tenant_id: A.tenantId });
      clienteId = cli!.id;
      expect(await vinculos(clienteId)).toEqual([{ tenant_id: A.tenantId, tabela_preco_id: tabela!.id, external_id: EXT.cliente }]);
      expect(await linhas('select 1 from core.cliente where tenant_id = $1 and external_id = $2', [B.tenantId, EXT.cliente])).toEqual([]);
      expect(await eventosComFalha(B.tenantId)).toEqual([]);
    });

    it('V-2. o app Campo, sem vínculo manual, vê o cliente do ERP com o preço da tabela vinculada', async () => {
      expect(clienteId, 'V-1 trouxe o cliente').not.toBe('');
      await esperarHorizonte();
      vendedorA = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { tenant: A });
      expect(await vendedorA.sincronizar(), vendedorA.motor.estado().erro ?? '').toBe(true);
      const l = await lerLinhas(vendedorA.motor);
      const u = vendedorA.sessao.usuario;
      const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => c.id === clienteId);
      expect(cliente, 'cliente do ERP na carteira do aparelho').toBeDefined();
      const doErp = l.produtos.filter((p) => [`${P}-SKU1`, `${P}-SKU2`].includes((p as { sku?: string }).sku ?? ''));
      expect(doErp).toHaveLength(2);
      const precos = await vendedorA.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: clienteId, produto_ids: doErp.map((p) => p.id), em: new Date().toISOString() });
      expect(precos.itens.map((i) => i.preco_cents ?? -1).sort((a, b) => a - b)).toEqual([4_000, 25_000]);
    });

    it('V-3. o ERP reenvia o cliente com a mesma tabela: o vínculo não duplica (idempotente)', async () => {
      await carregar('cliente', [clienteDoErp(EXT.tabela)]);
      expect(await vinculos(clienteId)).toHaveLength(1);
      // sem o campo (Conector antigo / view sem a coluna): nada muda
      await carregar('cliente', [clienteDoErp(undefined)]);
      expect(await vinculos(clienteId)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------ R retido sem de-para
  describe('R. Pedido retido por falta do de-para da condição (RN-INT-08)', () => {
    it('R-1. o admin apaga o de-para AVISTA no BKO; o pedido aprovado fica retido (payload nulo), fora de /pedidos/pendentes e listado no BKO', async () => {
      expect(vendedorA, 'V-2 abriu o aparelho').toBeDefined();
      const antes = await mapeamentos(tk.adminA);
      const avista = antes.itens.find((m) => m.tipo === 'condicao_pagamento' && m.codigo_macuxi === 'AVISTA' && m.ativo);
      expect(avista, 'fixture: AVISTA → 001 em A').toMatchObject({ codigo_erp: '001' });
      const del = await api.chamar(tk.adminA, { method: 'DELETE', url: `/v1/integracao/mapeamentos/${avista!.id}` });
      expect(del.statusCode, del.body).toBe(200);
      expect((await mapeamentos(tk.adminA)).itens.some((m) => m.codigo_macuxi === 'AVISTA')).toBe(false);

      // pedido no Campo para o cliente do ERP, dentro da alçada (aprovado na hora → vendedor.pedido.aprovado@1)
      const l = await lerLinhas(vendedorA.motor);
      const u = vendedorA.sessao.usuario;
      const params = vendedorA.motor.parametros('vendedor');
      const cliente = listaDeClientes(l, { id: u.id, name: u.nome }).find((c) => c.id === clienteId)!;
      const doErp = l.produtos.filter((p) => [`${P}-SKU1`, `${P}-SKU2`].includes((p as { sku?: string }).sku ?? ''));
      const precos = await vendedorA.motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: clienteId, produto_ids: doErp.map((p) => p.id), em: new Date().toISOString() });
      const catalogo = produtosComPrecos(l, new Map(precos.itens.map((i) => [i.produto_id, i.preco_cents]))).filter((p) => doErp.some((d) => d.id === p.id));
      const conds = condicoesDoCliente(l, clienteId);
      const rascunho: Rascunho = {
        ...rascunhoVazio(clienteId),
        lines: Object.fromEntries(catalogo.map((p, i) => [p.id, i + 1])),
        discount_pct: 0,
        condicao_pagamento_id: conds[0]?.id ?? null,
        payment_terms: conds[0]?.descricao ?? 'À vista',
      };
      const eu = meDoAparelho({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: vendedorA.sessao.tenant.fuso }, params, new Date()).seller;
      const { v, display } = prepararPedido({ rascunho, cliente, catalogo, politica: politicaApi(params), eu, filaDoClienteCents: 0 });
      expect(display.expected).toBe('ok');
      pedidoId = randomUUID();
      await vendedorA.motor.enfileirar({ id: pedidoId, entidade: 'pedido', payload: montarPedido({ id: pedidoId, cliente, rascunho, v, semSinal: false, agora: new Date().toISOString() }) });
      expect(await vendedorA.sincronizar(), vendedorA.motor.estado().erro ?? '').toBe(true);
      const ev = await linhas<{ payload: Record<string, unknown> }>("select payload from plataforma.evento where agregado_id = $1 and nome = 'vendedor.pedido.aprovado@1'", [pedidoId]);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ condicao_pagamento_codigo: 'AVISTA' });

      await despachar();
      expect(await eventosComFalha(A.tenantId), 'reter não é falha: o consumidor não lança').toEqual([]);
      const fila = await filaErp(pedidoId);
      expect(fila).toMatchObject({ tenant_id: A.tenantId, estado: 'pendente', tem_payload: false, retencao_codigo: 'mapeamento_ausente', tentativas: 0 });
      expect(fila!.retencao_mensagem).toContain('"AVISTA"');

      const r = await erpA.pendentes();
      expect(r.statusCode, r.body).toBe(200);
      expect(PedidosPendentes.parse(r.json()).pedidos.map((x) => x.pedido_uuid)).not.toContain(pedidoId);
      expect((await filaErp(pedidoId))?.tentativas).toBe(0);
      expect((await mapeamentos(tk.analistaA)).condicoes_sem_correspondente).toEqual([{ codigo_macuxi: 'AVISTA', pedidos: 1 }]);
    });

    it('R-2. o vendedor não grava de-para (403) e o reprocessamento de B não libera o pedido de A', async () => {
      expect(pedidoId, 'R-1 criou o pedido').not.toBe('');
      const v = await gravarDePara(tk.vendedorA, { tipo: 'condicao_pagamento', codigo_erp: '001', codigo_macuxi: 'AVISTA', ativo: true });
      expect(v.statusCode, v.body).toBe(403);
      expect(['MODULO_INATIVO', 'PERFIL_SEM_ACESSO']).toContain(erroDe(v).codigo);
      const vr = await api.chamar(tk.vendedorA, { method: 'POST', url: '/v1/integracao/pedidos/reprocessar-retidos' });
      expect(vr.statusCode, vr.body).toBe(403);

      const rb = await api.chamar(tk.adminB, { method: 'POST', url: '/v1/integracao/pedidos/reprocessar-retidos' });
      expect(rb.statusCode, rb.body).toBe(200);
      expect(rb.json()).toEqual({ pedidos_liberados: 0 });
      expect((await mapeamentos(tk.adminB)).condicoes_sem_correspondente).toEqual([]);
      expect(await filaErp(pedidoId)).toMatchObject({ tem_payload: false, retencao_codigo: 'mapeamento_ausente' });
    });
  });

  // ------------------------------------------------------------------------------------------------ L de-para libera
  describe('L. O de-para gravado no BKO libera o retido sozinho', () => {
    it('L-1. o analista grava AVISTA → 001: 1 pedido liberado na mesma transação; o Conector de A recebe com 001, o de B não; repetir não libera de novo', async () => {
      expect(pedidoId, 'R-1 criou o pedido').not.toBe('');
      const r = await gravarDePara(tk.analistaA, { tipo: 'condicao_pagamento', codigo_erp: '001', codigo_macuxi: 'AVISTA', descricao: 'À vista', ativo: true });
      expect(r.statusCode, r.body).toBe(200);
      const g = GravarMapeamentoResposta.parse(r.json());
      expect(g).toMatchObject({ pedidos_liberados: 1, item: { tipo: 'condicao_pagamento', codigo_erp: '001', codigo_macuxi: 'AVISTA', ativo: true } });
      expect(await filaErp(pedidoId)).toMatchObject({ estado: 'pendente', tem_payload: true, retencao_codigo: null, retencao_mensagem: null, tentativas: 0 });
      expect((await mapeamentos(tk.adminA)).condicoes_sem_correspondente).toEqual([]);

      const rb = await erpB.pendentes();
      expect(rb.statusCode, rb.body).toBe(200);
      expect(PedidosPendentes.parse(rb.json()).pedidos.map((x) => x.pedido_uuid)).not.toContain(pedidoId);

      const ra = await erpA.pendentes();
      expect(ra.statusCode, ra.body).toBe(200);
      const paraErp = PedidosPendentes.parse(ra.json()).pedidos.find((x) => x.pedido_uuid === pedidoId);
      expect(paraErp, 'pedido liberado na fila do Conector de A').toMatchObject({ cliente_external_id: EXT.cliente, vendedor_external_id: EXT.vendedor, condicao_pagamento_erp: '001', tentativa: 1 });
      expect(paraErp!.itens.map((i) => i.produto_external_id).sort()).toEqual([EXT.produto1, EXT.produto2]);
      expect(paraErp!.total_cents).toBe(paraErp!.itens.reduce((s, i) => s + i.total_cents, 0));

      // gravar o mesmo de-para de novo (atualiza) não libera nada e o Conector não recebe o pedido outra vez
      const de_novo = await gravarDePara(tk.analistaA, { tipo: 'condicao_pagamento', codigo_erp: '001', codigo_macuxi: 'AVISTA', descricao: 'À vista', ativo: true });
      expect(de_novo.statusCode, de_novo.body).toBe(200);
      expect(GravarMapeamentoResposta.parse(de_novo.json()).pedidos_liberados).toBe(0);
      expect(PedidosPendentes.parse((await erpA.pendentes()).json()).pedidos.map((x) => x.pedido_uuid)).not.toContain(pedidoId);
      const audit = await linhas<{ acao: string }>("select acao from plataforma.auditoria where tenant_id = $1 and modulo = 'integracao' and acao like 'mapeamento.%' order by created_at", [A.tenantId]);
      expect(audit.map((a) => a.acao)).toEqual(expect.arrayContaining(['mapeamento.apagar', 'mapeamento.criar', 'mapeamento.atualizar']));
    });
  });
});
