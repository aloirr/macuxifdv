/**
 * T-0071 (fatia 8, desenho docs/desenho/T-0071.md §7) — regressões que já rodam com a API REAL (createApp × Postgres ×
 * fixture dois-tenants × despachante real):
 *   R1 orçamento NUNCA entra em `integracao.pedido_fila_erp` nem na outbox `vendedor.pedido.*` (RN-INT-08, RN-VEN-18/32);
 *      o pedido de controle, no mesmo lote e no mesmo ciclo do despachante, entra (prova que o caminho está vivo);
 *   R2 promotor nunca cria orçamento (RN-PRO-01, regra 7): item recusado com RN-PRO-01, nada gravado, nada na outbox;
 *   R3 isolamento entre tenants em `catalogo.produto_relacao` (RLS direto e pull da API) e na consulta
 *      `catalogo.sugestoes_pedido@1` (o contexto de B não enxerga as relações de A e vice-versa).
 * Fica para depois (rotas novas do Vendedor, fatia 5): PUT /v1/vendedor/orcamentos/:id e POST .../cancelar (promotor 403,
 * outro tenant 404, vencido 422 RN-VEN-18) e o e2e orçamento offline → Transformar → pedido.
 */
import { comTenant } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsulta, DefinicaoConsulta, ResultadoItemPush } from '@macuxi/platform-sdk';
import { CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { SugestoesPedidoEntradaSchema } from '@macuxi/catalogo/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { consultaSugestoesPedido } from '../../../modules/catalogo/api/sugestoes';
import { consultaFiliais } from '../../../modules/core/api/filiais';
import { A, B, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

// o `titulo_vencido_dias = 30` do tenant A vale só para este arquivo: o afterAll apaga (os outros arquivos contam com o padrão 5)
const LIMPAR_VENCIDO_DIAS = "delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = 'titulo_vencido_dias'";

const id = (n: number) => `0f710000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DOC = { orcamento: id(1), controle: id(2), promotor: id(3), orcamentoSoz: id(4) };

type Sugestoes = { complementares: Array<{ produto_id: string }>; superiores: Array<{ produto_id: string }> };

describe.skipIf(semBanco())('T-0071 — orçamento fora do ERP, promotor barrado e isolamento das relações (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const tk = { vendedor: '', promotor: '', adminA: '', vendedorB: '' };
  let prod1 = '';

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const doc = (pid: string, extra: Record<string, unknown> = {}) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, customer_id: A.clientes.c1, discount_pct: 0, payment_terms: '28 dias', created_offline_at: new Date().toISOString(), items: [{ product_id: prod1, quantity: 1 }], ...extra },
  });
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  const eventosDe = (pid: string) => q<{ nome: string }>('select nome from plataforma.evento where agregado_id = $1 or payload->>\'pedido_id\' = $1::text order by created_at', [pid]);
  const naFila = (pid: string) => q<{ estado: string }>('select estado from integracao.pedido_fila_erp where pedido_uuid = $1', [pid]);
  const limpar = async () => {
    const ids = Object.values(DOC);
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('update vendedor.pedido set orcamento_id = null where orcamento_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [ids]).catch(() => undefined); // T-0184 (0088)
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
  };

  beforeAll(async () => {
    api = await subirApi();
    // T-0184 (P1 A): o A.c1 da fixture tem título vencido há 10 dias e iria para aprovação por inadimplência (RN-VEN-13), com
    // qualquer forma de pagamento; este arquivo não trata disso (tests/integracao/api/aprovacao-motivo-t0184.test.ts trata)
    await api.admin.query(LIMPAR_VENCIDO_DIAS, [A.tenantId]); // sobra de uma rodada interrompida
    await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'titulo_vencido_dias', '30')", [A.tenantId]);
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): a regressão da fila do ERP precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    // o Hub precisa da licença no tenant para consumir vendedor.pedido.aprovado@1 (sem ela a fila ficaria vazia para os dois e o teste não provaria nada)
    const r = await licenca(api, tk.adminA, 'tenant', 'integracao', true);
    expect(r.statusCode, r.body).toBe(200);
    prod1 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    await limpar();
    await despachar(); // eventos antigos da fixture fora do caminho
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await api.admin.query(LIMPAR_VENCIDO_DIAS, [A.tenantId]).catch(() => undefined);
    await limpar().catch(() => undefined);
    await worker?.end().catch(() => undefined);
    await api.fechar();
  });

  describe('R1. RN-INT-08 — orçamento nunca vai ao ERP nem à outbox vendedor.pedido.*', () => {
    // o mesmo item (mesmo conteúdo, mesmo created_offline_at) no envio e no reenvio: a idempotência é por conteúdo
    let itemOrcamento: ReturnType<typeof doc>;
    beforeAll(() => {
      itemOrcamento = doc(DOC.orcamento, { tipo: 'orcamento' });
    });
    it('orçamento e pedido de controle no mesmo lote: o orçamento fica gravado (tipo orcamento, received, com validade) sem nenhum evento vendedor.pedido.* e fora da pedido_fila_erp; o pedido de controle publica criado/aprovado e entra na fila', async () => {
      const res = await push(tk.vendedor, [itemOrcamento, doc(DOC.controle)]);
      expect(res.map((x) => [x.id, x.status]), JSON.stringify(res)).toEqual([
        [DOC.orcamento, 'aceito'],
        [DOC.controle, 'aceito'],
      ]);

      const [o] = await q<{ tipo: string; status: string; orcamento_validade: unknown; nivel_aprovacao: string | null; tenant_id: string }>(
        'select tipo, status, orcamento_validade, nivel_aprovacao, tenant_id from vendedor.pedido where id = $1',
        [DOC.orcamento],
      );
      expect(o).toMatchObject({ tipo: 'orcamento', tenant_id: A.tenantId, nivel_aprovacao: null });
      expect(['draft', 'queued', 'received']).toContain(o!.status);
      expect(o!.orcamento_validade, 'orçamento com validade (RN-VEN-18)').not.toBeNull();
      const [c] = await q<{ tipo: string; status: string }>('select tipo, status from vendedor.pedido where id = $1', [DOC.controle]);
      expect(c).toMatchObject({ tipo: 'pedido', status: 'approved' });

      // antes do despachante: a outbox já mostra a diferença
      expect((await eventosDe(DOC.orcamento)).filter((e) => e.nome.startsWith('vendedor.pedido.')), 'outbox do orçamento').toEqual([]);
      expect((await eventosDe(DOC.controle)).map((e) => e.nome)).toEqual(expect.arrayContaining(['vendedor.pedido.criado@1', 'vendedor.pedido.aprovado@1']));

      await despachar();
      expect(await naFila(DOC.orcamento), 'orçamento NÃO entra na fila do ERP').toEqual([]);
      expect(await naFila(DOC.controle), 'o pedido de controle entra na fila do ERP (o caminho do Hub está vivo)').toHaveLength(1);
      // depois dos consumidores, nenhum evento derivado do orçamento (Gestor, Hub, metas) apareceu
      expect((await eventosDe(DOC.orcamento)).map((e) => e.nome), 'nenhum evento do orçamento depois do despachante').toEqual([]);
    });

    it('reenvio do mesmo orçamento (idempotente, RN-VEN-33: o MESMO item do lote) continua fora da fila e da outbox', async () => {
      const [r] = await push(tk.vendedor, [itemOrcamento]);
      expect(r).toMatchObject({ id: DOC.orcamento, status: 'aceito' });
      expect(await q('select 1 from vendedor.pedido where id = $1', [DOC.orcamento])).toHaveLength(1);
      await despachar();
      expect(await naFila(DOC.orcamento)).toEqual([]);
      expect(await eventosDe(DOC.orcamento)).toEqual([]);
    });
  });

  describe('R2. RN-PRO-01 — promotor nunca cria orçamento', () => {
    const semRastro = async (pid: string) => {
      expect(await q('select 1 from vendedor.pedido where id = $1', [pid])).toEqual([]);
      expect(await eventosDe(pid)).toEqual([]);
      await despachar();
      expect(await naFila(pid)).toEqual([]);
    };

    it('sem o Vendedor licenciado ao perfil promotor (fixture): item recusado com MODULO_INATIVO, nada gravado', async () => {
      const [r] = await push(tk.promotor, [doc(DOC.promotor, { tipo: 'orcamento' })]);
      expect(r).toMatchObject({ id: DOC.promotor, status: 'rejeitado', codigo: 'MODULO_INATIVO' });
      await semRastro(DOC.promotor);
    });

    it('COM o Vendedor e o Catálogo licenciados ao perfil promotor: item recusado com RN-PRO-01, nada gravado, nada na outbox nem na fila', async () => {
      expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      try {
        const [r] = await push(tk.promotor, [doc(DOC.promotor, { tipo: 'orcamento' })]);
        expect(r).toMatchObject({ id: DOC.promotor, status: 'rejeitado', codigo: 'RN-PRO-01' });
        await semRastro(DOC.promotor);
      } finally {
        expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
        expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
      }
    });
  });

  describe('R3. Multi-tenant — catalogo.produto_relacao e catalogo.sugestoes_pedido@1', () => {
    // T-0149: sugestoes_pedido@1 lê core.filiais@1 por ctx.consultar (a API real preenche; mesmo db, mesmo tenant, RLS).
    // Aqui o contexto é montado à mão: só core.filiais@1 é servida, na mesma transação; outra consulta = erro do teste.
    const consultar = (tenant: string, entrada: object) =>
      comTenant(api.pool, tenant, (c) => {
        const ctx = {
          db: c as unknown as ClienteBanco,
          usuario: { perfil: 'vendedor' },
          agora: () => new Date(),
          parametros: () => ({}),
        } as unknown as ContextoConsulta;
        const consultarAninhada = (async (def: DefinicaoConsulta, e: unknown) => {
          if (def.nome !== CONSULTA_FILIAIS.nome) throw new Error(`R3: consulta inesperada ${def.nome}`);
          return CONSULTA_FILIAIS.saida.parse(await consultaFiliais.executar(CONSULTA_FILIAIS.entrada.parse(e), ctx));
        }) as NonNullable<ContextoConsulta['consultar']>;
        return consultaSugestoesPedido.executar(SugestoesPedidoEntradaSchema.parse(entrada), { ...ctx, consultar: consultarAninhada });
      }) as Promise<Sugestoes>;

    it('RLS: no contexto de A só as linhas de A (4, com a inativa e a apagada); no de B só a de B; sem contexto, nada', async () => {
      const deA = await comTenant(api.pool, A.tenantId, (c) => c.query<{ tenant_id: string; external_id: string | null }>('select tenant_id, external_id from catalogo.produto_relacao'));
      const deB = await comTenant(api.pool, B.tenantId, (c) => c.query<{ tenant_id: string; external_id: string | null }>('select tenant_id, external_id from catalogo.produto_relacao'));
      expect(deA.rows).toHaveLength(4);
      expect(deA.rows.every((x) => x.tenant_id === A.tenantId)).toBe(true);
      expect(deA.rows.map((x) => x.external_id)).toContain('REL-A-1');
      expect(deB.rows).toEqual([{ tenant_id: B.tenantId, external_id: 'REL-B-1' }]);
      const c = await api.pool.connect();
      try {
        expect((await c.query('select 1 from catalogo.produto_relacao')).rows).toEqual([]);
      } finally {
        c.release();
      }
    });

    it('pull da API (GET /v1/sync/pull?entidade=produto_relacao): o vendedor de A recebe a REL-A-1 e nada de B; o de B recebe a REL-B-1 e nada de A', async () => {
      await esperarHorizonte();
      const ids = async (tenant: string) => new Set((await q<{ id: string }>('select id from catalogo.produto_relacao where tenant_id = $1', [tenant])).map((x) => x.id));
      const [idsA, idsB] = [await ids(A.tenantId), await ids(B.tenantId)];
      const [relA1] = await q<{ id: string }>("select id from catalogo.produto_relacao where external_id = 'REL-A-1'");
      const [relB1] = await q<{ id: string }>("select id from catalogo.produto_relacao where external_id = 'REL-B-1'");
      const puxar = async (token: string) => {
        const r = await api.chamar(token, { method: 'GET', url: '/v1/sync/pull?entidade=produto_relacao' });
        expect(r.statusCode, r.body).toBe(200);
        return (r.json() as { itens: Array<{ id: string }> }).itens.map((x) => x.id);
      };
      const pa = await puxar(tk.vendedor);
      const pb = await puxar(tk.vendedorB);
      expect(pa).toContain(relA1!.id);
      expect(pa.filter((x) => !idsA.has(x)), 'linha fora de A no pull de A').toEqual([]);
      expect(pa.filter((x) => idsB.has(x))).toEqual([]);
      expect(pb).toContain(relB1!.id);
      expect(pb.filter((x) => !idsB.has(x)), 'linha fora de B no pull de B').toEqual([]);
    });

    it('sugestoes_pedido@1: no contexto de B, o cliente e os produtos de A não dão sugestão nenhuma; no de A, os produtos de B também não', async () => {
      const em = new Date().toISOString();
      const [prodB1] = await q<{ produto_id: string; relacionado_id: string }>("select produto_id, relacionado_id from catalogo.produto_relacao where external_id = 'REL-B-1'");
      expect(await consultar(B.tenantId, { cliente_id: A.clientes.c1, produto_ids: [A.produtos.p1, A.produtos.p2], em })).toEqual({ complementares: [], superiores: [] });
      expect(await consultar(B.tenantId, { cliente_id: B.clientes.c1, produto_ids: [A.produtos.p1, A.produtos.p2], em })).toEqual({ complementares: [], superiores: [] });
      expect(await consultar(A.tenantId, { cliente_id: A.clientes.c1, produto_ids: [prodB1!.produto_id], em })).toEqual({ complementares: [], superiores: [] });
      expect(await consultar(A.tenantId, { cliente_id: B.clientes.c1, produto_ids: [A.produtos.p1], em })).toEqual({ complementares: [], superiores: [] });
      // o que A recebe com os próprios produtos só pode apontar para produtos de A
      const proprios = await consultar(A.tenantId, { cliente_id: A.clientes.c1, produto_ids: [A.produtos.p1], em });
      const prodsA = new Set((await q<{ id: string }>('select id from core.produto where tenant_id = $1', [A.tenantId])).map((x) => x.id));
      for (const s of [...proprios.complementares, ...proprios.superiores]) expect(prodsA.has(s.produto_id), s.produto_id).toBe(true);
    });
  });
});
