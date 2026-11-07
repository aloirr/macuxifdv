/**
 * T-0089 (critérios 4, 5 e 6; R-20261106-201525) — forma de pagamento e prazo com a API REAL (createApp × Postgres × fixture
 * dois-tenants, PAGAMENTO_FIXTURE): RN-VEN-24, RN-VEN-25, RN-VEN-13 (título vencido), retrato das 8 colunas, aprovado@1 com
 * o objeto `pagamento`, permissões das rotas de formas e prazos (Vendedor) e do pagamento do cliente (Core), licença e
 * isolamento entre tenants.
 *
 * Fixture (db/seeds/fixtures/dois-tenants.ts): A.c1 tem prazo médio máximo 45 e só PIX e BOLETO; título NF-1001 1/2 vencido
 * há 10 dias (padrão `titulo_vencido_dias` = 5). Formas de A: AVISTA (semeada, ordem 0), PIX (PIX-AV, [0]) e BOLETO
 * (external_id FP-BOL; BOL-28-56 = 42 com external_id PZ-2856, BOL-30-60-90 = 60, BOL-28 inativo). B: AVISTA e DINHEIRO
 * (DIN-AV); B.c1 com prazo médio máximo 30, todas as formas; o admin de B tem o Vendedor removido no nível do usuário.
 *
 * Rotas: push do sync (recusa por item com o código), PUT /v1/vendedor/orcamentos/:id (422), GET/PUT
 * /v1/vendedor/formas-pagamento e /prazos-pagamento (forma_pagamento.ver/gerenciar: admin, analista, gerente),
 * GET /v1/core/formas-pagamento e PUT /v1/core/clientes/:id/pagamento (cliente.pagamento_editar: analista, admin).
 */
import { comTenant, PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

const id = (n: number) => `0f890000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PED = {
  pix: id(1),
  boleto42: id(2),
  boleto60: id(3),
  prazoDeOutraForma: id(4),
  soForma: id(5),
  prazoInativo: id(6),
  formaForaDoCliente: id(7),
  formaDeB: id(8),
  b: id(9),
  bComFormaDeA: id(10),
  orcamento: id(11),
  transformado: id(12),
  limiteIgual: id(13),
  semTeto: id(14),
  legado: id(15),
  promotor: id(16),
} as const;
const NOVAS = { forma: id(101), prazo: id(102), formaB: id(103), prazoB: id(104) } as const;
const PA = PAGAMENTO_FIXTURE.A;
const PB = PAGAMENTO_FIXTURE.B;

type Linha = Record<string, unknown>;
type Erro = { statusCode: number; body: string; json(): unknown };

describe.skipIf(semBanco())('T-0089 — forma e prazo do pedido, pagamento do cliente, permissões e tenant (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', promotor: '', supervisor: '', gerente: '', analista: '', adminA: '', vendedorB: '', adminB: '' };
  let prodA = '';
  let prodB = '';

  const q = async <T extends pg.QueryResultRow = Linha>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const corpo = (cliente: string, produto: string, pagamento: { forma?: string | null; prazo?: string | null }, extra: Linha = {}): Linha => ({
    customer_id: cliente,
    discount_pct: 0,
    items: [{ product_id: produto, quantity: 1 }],
    ...(pagamento.forma !== undefined ? { forma_pagamento_id: pagamento.forma } : {}),
    ...(pagamento.prazo !== undefined ? { prazo_pagamento_id: pagamento.prazo } : {}),
    ...extra,
  });
  const item = (pid: string, payload: Linha) => ({ entidade: 'pedido', id: pid, operacao: 'upsert', payload: { id: pid, created_offline_at: new Date().toISOString(), ...payload } });
  const pedidoA = (pid: string, forma: string | null | undefined, prazo: string | null | undefined, extra: Linha = {}) => item(pid, corpo(A.clientes.c1, prodA, { forma, prazo }, extra));
  const linha = async (pid: string) => (await q('select * from vendedor.pedido where id = $1', [pid]))[0];
  const eventos = (pid: string) => q<{ nome: string; payload: Linha }>('select nome, payload from plataforma.evento where agregado_id = $1 order by ocorrido_em, created_at', [pid]);
  const aprovado = async (pid: string) => (await eventos(pid)).find((e) => e.nome === 'vendedor.pedido.aprovado@1')?.payload;
  const nadaGravado = async (pid: string) => {
    expect(await q('select 1 from vendedor.pedido where id = $1', [pid]), `pedido ${pid} não pode existir`).toEqual([]);
    expect(await eventos(pid), `nenhum evento de ${pid}`).toEqual([]);
  };
  const recusado = (r: ResultadoItemPush | undefined, codigo: string, pid: string) => expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'rejeitado', codigo });
  const cod422 = (r: Erro, codigo: string) => {
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDe(r).codigo).toBe(codigo);
  };
  const cod403 = (r: Erro) => expect(r.statusCode, r.body).toBe(403);
  const pagamentoCliente = (token: string, cliente: string, prazo: number | null, formas: string[] | null) =>
    api.chamar(token, { method: 'PUT', url: `/v1/core/clientes/${cliente}/pagamento`, payload: { prazo_medio_max_dias: prazo, formas_pagamento: formas } });
  const restaurarC1 = async () => {
    await q('update core.cliente set prazo_medio_max_dias = 45, formas_pagamento = $2::text[] where id = $1', [A.clientes.c1, ['PIX', 'BOLETO']]);
  };
  const limpar = async () => {
    const ids = Object.values(PED);
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('update vendedor.pedido set orcamento_id = null where orcamento_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from plataforma.evento where agregado_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.prazo_pagamento where id = any($1::uuid[])', [Object.values(NOVAS)]);
    await api.admin.query('delete from vendedor.forma_pagamento where id = any($1::uuid[])', [Object.values(NOVAS)]);
    await api.admin.query("delete from plataforma.parametro where modulo = 'vendedor' and chave = 'titulo_vencido_dias'");
    await restaurarC1();
  };

  beforeAll(async () => {
    api = await subirApi();
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    prodB = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'BETA-001'", [B.tenantId]))[0]!.id;
    await limpar();
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await limpar().catch(() => undefined);
    await api.fechar();
  });

  // ------------------------------------------------------------------------------------------------ critério 5 / RN-VEN-24
  describe('P. Pedido com forma e prazo: retrato das 8 colunas e aprovado@1 com o pagamento', () => {
    it('P1. PIX à vista para o A.c1 (título vencido, mas prazo médio 0): aceito e aprovado sem alçada; grava as 8 colunas; aprovado@1 leva pagamento PIX/PIX-AV [0] 0 e condicao_pagamento_codigo = código do prazo', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.pix, PA.formas.pix, PA.prazos.pixAvista)]);
      expect(r, JSON.stringify(r)).toMatchObject({ id: PED.pix, status: 'aceito' });
      const p = (await linha(PED.pix))!;
      expect(p.status, 'RN-VEN-13: à vista segue sem aprovação mesmo com título vencido').toBe('approved');
      expect(p).toMatchObject({
        forma_pagamento_id: PA.formas.pix,
        prazo_pagamento_id: PA.prazos.pixAvista,
        forma_pagamento_codigo: 'PIX',
        forma_pagamento_nome: 'Pix',
        prazo_codigo: 'PIX-AV',
        prazo_descricao: 'À vista',
        prazo_medio_dias: 0,
      });
      expect((p.prazo_parcelas_dias as number[]).map(Number)).toEqual([0]);
      expect(p.condicao_pagamento_id, 'pedido novo não grava a condição legada').toBeNull();
      expect(p.condicao_pagamento_descricao, 'o texto mostrado é "forma · prazo"').toBe('Pix · À vista');
      const ev = await aprovado(PED.pix);
      expect(ev, 'vendedor.pedido.aprovado@1 publicado').toBeDefined();
      expect(ev).toMatchObject({ condicao_pagamento_codigo: 'PIX-AV', pagamento: { forma_codigo: 'PIX', prazo_codigo: 'PIX-AV', parcelas_dias: [0], prazo_medio_dias: 0 } });
      expect((ev!.pagamento as Linha).forma_external_id ?? null).toBeNull();
    });

    it('P2. detalhe REST do pedido (BKO e app) traz forma, prazo, parcelas e prazo médio', async () => {
      const r = await api.chamar(tk.vendedor, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.pix}` });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ forma_pagamento_id: PA.formas.pix, forma_pagamento_nome: 'Pix', prazo_pagamento_id: PA.prazos.pixAvista, prazo_descricao: 'À vista', prazo_parcelas_dias: [0], prazo_medio_dias: 0 });
    });

    it('P3. reenvio do mesmo item (idempotência): aceito de novo, uma linha só e um único aprovado@1', async () => {
      const [primeiro] = await push(tk.vendedor, [pedidoA(PED.legado, undefined, undefined)]);
      expect(primeiro, 'pedido do APK anterior, sem forma e prazo: segue pela condição legada').toMatchObject({ status: 'aceito' });
      const legado = (await linha(PED.legado))!;
      expect(legado.forma_pagamento_id).toBeNull();
      expect(legado.prazo_medio_dias).toBeNull();
      const it0 = pedidoA(PED.boleto42, PA.formas.boleto, PA.prazos.bol2856);
      const [a] = await push(tk.vendedor, [it0]);
      const [b] = await push(tk.vendedor, [it0]);
      expect([a?.status, b?.status], JSON.stringify([a, b])).toEqual(['aceito', 'aceito']);
      expect(await q('select 1 from vendedor.pedido where id = $1', [PED.boleto42])).toHaveLength(1);
      expect((await eventos(PED.boleto42)).filter((e) => e.nome === 'vendedor.pedido.criado@1')).toHaveLength(1);
    });

    it('P4. RN-VEN-13: BOLETO 28/56 (42 ≤ 45) para o A.c1 com título vencido há 10 dias > 5: vai para aprovação do supervisor com o motivo credito; nada de aprovado@1 ainda', async () => {
      const p = (await linha(PED.boleto42))!;
      expect(p).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'supervisor', forma_pagamento_codigo: 'BOLETO', prazo_codigo: 'BOL-28-56', prazo_descricao: '28/56 dias', prazo_medio_dias: 42 });
      expect((p.prazo_parcelas_dias as number[]).map(Number)).toEqual([28, 56]);
      expect(p.motivos_aprovacao).toEqual(['credito']);
      expect(await aprovado(PED.boleto42)).toBeUndefined();
    });

    it('P5. a supervisora aprova: aprovado@1 sai ao ERP com forma, prazo, external_ids FP-BOL/PZ-2856, parcelas e prazo médio 42 (critério 5)', async () => {
      const r = await api.chamar(tk.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${PED.boleto42}/aprovar`, payload: { comentario: 'T-0089 testes' } });
      expect(r.statusCode, r.body).toBe(200);
      const ev = await aprovado(PED.boleto42);
      expect(ev).toMatchObject({
        condicao_pagamento_codigo: 'BOL-28-56',
        pagamento: { forma_codigo: 'BOLETO', forma_external_id: 'FP-BOL', prazo_codigo: 'BOL-28-56', prazo_external_id: 'PZ-2856', parcelas_dias: [28, 56], prazo_medio_dias: 42 },
      });
    });

    it('P6. limite exato do RN-VEN-13: com titulo_vencido_dias = 10 (atraso do A.c1 = 10), o boleto a prazo NÃO vai para aprovação', async () => {
      await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'titulo_vencido_dias', '10')", [A.tenantId]);
      try {
        const [r] = await push(tk.vendedor, [pedidoA(PED.limiteIgual, PA.formas.boleto, PA.prazos.bol2856)]);
        expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
        expect((await linha(PED.limiteIgual))!.status).toBe('approved');
      } finally {
        await q("delete from plataforma.parametro where modulo = 'vendedor' and chave = 'titulo_vencido_dias'");
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ RN-VEN-24 / RN-VEN-25
  describe('R. Recusas RN-VEN-24 e RN-VEN-25 (push: item rejeitado, nada gravado, nada na outbox)', () => {
    it('R1. RN-VEN-25: BOLETO 30/60/90 (prazo médio 60) passa do máximo 45 do A.c1', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.boleto60, PA.formas.boleto, PA.prazos.bol306090)]);
      recusado(r, 'RN-VEN-25', PED.boleto60);
      await nadaGravado(PED.boleto60);
    });

    it('R2. RN-VEN-24: prazo de outra forma (PIX com o prazo BOL-28-56)', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.prazoDeOutraForma, PA.formas.pix, PA.prazos.bol2856)]);
      recusado(r, 'RN-VEN-24', PED.prazoDeOutraForma);
      await nadaGravado(PED.prazoDeOutraForma);
    });

    it('R3. RN-VEN-24: só a forma, sem o prazo; e só o prazo, sem a forma', async () => {
      const [a] = await push(tk.vendedor, [pedidoA(PED.soForma, PA.formas.boleto, null)]);
      recusado(a, 'RN-VEN-24', PED.soForma);
      const [b] = await push(tk.vendedor, [pedidoA(PED.soForma, null, PA.prazos.bol2856)]);
      recusado(b, 'RN-VEN-24', PED.soForma);
      await nadaGravado(PED.soForma);
    });

    it('R4. RN-VEN-24: prazo inativo da forma certa (BOL-28)', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.prazoInativo, PA.formas.boleto, PA.prazos.bol28Inativo)]);
      recusado(r, 'RN-VEN-24', PED.prazoInativo);
      await nadaGravado(PED.prazoInativo);
    });

    it('R5. RN-VEN-25: forma ativa do tenant que o A.c1 não aceita (AVISTA semeada; o cliente só aceita PIX e BOLETO)', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.formaForaDoCliente, PA.semeada.forma, PA.semeada.prazo)]);
      recusado(r, 'RN-VEN-25', PED.formaForaDoCliente);
      await nadaGravado(PED.formaForaDoCliente);
    });

    it('R6. tenant: a forma e o prazo de B (DINHEIRO/DIN-AV) num pedido de A não existem para A (RLS) → RN-VEN-24', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.formaDeB, PB.formas.dinheiro, PB.prazos.dinAvista)]);
      recusado(r, 'RN-VEN-24', PED.formaDeB);
      await nadaGravado(PED.formaDeB);
    });

    it('R7. tenant B: DIN-AV para o B.c1 é aceito; a forma e o prazo de A num pedido de B → RN-VEN-24', async () => {
      const [ok] = await push(tk.vendedorB, [item(PED.b, corpo(B.clientes.c1, prodB, { forma: PB.formas.dinheiro, prazo: PB.prazos.dinAvista }))]);
      expect(ok, JSON.stringify(ok)).toMatchObject({ status: 'aceito' });
      const pb = (await linha(PED.b))!;
      expect(pb).toMatchObject({ tenant_id: B.tenantId, forma_pagamento_codigo: 'DINHEIRO', prazo_codigo: 'DIN-AV', prazo_medio_dias: 0 });
      const [r] = await push(tk.vendedorB, [item(PED.bComFormaDeA, corpo(B.clientes.c1, prodB, { forma: PA.formas.boleto, prazo: PA.prazos.bol2856 }))]);
      recusado(r, 'RN-VEN-24', PED.bComFormaDeA);
      await nadaGravado(PED.bComFormaDeA);
    });

    it('R8. regra 7: o promotor com o Vendedor licenciado ao perfil nunca cria pedido, nem com forma e prazo válidos (RN-PRO-01)', async () => {
      expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      try {
        const [r] = await push(tk.promotor, [pedidoA(PED.promotor, PA.formas.pix, PA.prazos.pixAvista)]);
        recusado(r, 'RN-PRO-01', PED.promotor);
        await nadaGravado(PED.promotor);
      } finally {
        expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
        expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ orçamento e Transformar
  describe('O. Orçamento: 422 na edição e revalidação no Transformar (o cadastro do Core muda o resultado)', () => {
    let atualizado = '';
    it('O1. orçamento com BOLETO 28/56 para o A.c1 é aceito (orçamento não passa pelo título vencido)', async () => {
      const [r] = await push(tk.vendedor, [pedidoA(PED.orcamento, PA.formas.boleto, PA.prazos.bol2856, { tipo: 'orcamento' })]);
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
      const o = (await linha(PED.orcamento))!;
      expect(o).toMatchObject({ tipo: 'orcamento', prazo_codigo: 'BOL-28-56', prazo_medio_dias: 42 });
      atualizado = (await q<{ a: string }>(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as a from vendedor.pedido where id = $1`, [PED.orcamento]))[0]!.a;
    });

    it('O2. PUT /v1/vendedor/orcamentos/:id com o prazo 30/60/90 → 422 RN-VEN-25; com o prazo de outra forma → 422 RN-VEN-24; o orçamento não muda', async () => {
      const base = (forma: string, prazo: string) => ({ ...corpo(A.clientes.c1, prodA, { forma, prazo }), atualizado_em: atualizado });
      cod422(await api.chamar(tk.vendedor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${PED.orcamento}`, payload: base(PA.formas.boleto, PA.prazos.bol306090) }), 'RN-VEN-25');
      cod422(await api.chamar(tk.vendedor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${PED.orcamento}`, payload: base(PA.formas.pix, PA.prazos.bol2856) }), 'RN-VEN-24');
      expect((await linha(PED.orcamento))!).toMatchObject({ prazo_codigo: 'BOL-28-56', prazo_medio_dias: 42 });
    });

    it('O3. o analista baixa o prazo médio do A.c1 para 30 no Core; o Transformar do orçamento (28/56 = 42) é recusado com RN-VEN-25', async () => {
      const r = await pagamentoCliente(tk.analista, A.clientes.c1, 30, ['PIX', 'BOLETO']);
      expect(r.statusCode, r.body).toBe(200);
      try {
        const [t] = await push(tk.vendedor, [pedidoA(PED.transformado, PA.formas.boleto, PA.prazos.bol2856, { tipo: 'pedido', orcamento_origem_id: PED.orcamento })]);
        recusado(t, 'RN-VEN-25', PED.transformado);
        await nadaGravado(PED.transformado);
      } finally {
        await restaurarC1();
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ Core: pagamento do cliente
  describe('C. Core — PUT /v1/core/clientes/:id/pagamento e GET /v1/core/formas-pagamento (Cliente 360 do BKO)', () => {
    it('C1. perfil: vendedor, supervisor, gerente e promotor → 403 nas duas rotas; nada muda no cliente', async () => {
      for (const [quem, token] of Object.entries({ vendedor: tk.vendedor, supervisor: tk.supervisor, gerente: tk.gerente, promotor: tk.promotor })) {
        const put = await pagamentoCliente(token, A.clientes.c1, 365, null);
        expect(put.statusCode, `${quem} PUT: ${put.body}`).toBe(403);
        const get = await api.chamar(token, { method: 'GET', url: '/v1/core/formas-pagamento' });
        expect(get.statusCode, `${quem} GET: ${get.body}`).toBe(403);
      }
      expect((await q('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1', [A.clientes.c1]))[0]).toEqual({ prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] });
    });

    it('C2. GET /v1/core/formas-pagamento (analista e admin de A): só as formas ATIVAS de A, com código e nome, nada de B', async () => {
      for (const token of [tk.analista, tk.adminA]) {
        const r = await api.chamar(token, { method: 'GET', url: '/v1/core/formas-pagamento' });
        expect(r.statusCode, r.body).toBe(200);
        const { formas } = r.json() as { formas: Array<{ codigo: string; nome: string }> | null };
        expect(formas).not.toBeNull();
        expect(formas!.map((f) => f.codigo).sort()).toEqual(['AVISTA', 'BOLETO', 'PIX']);
        expect(Object.keys(formas![0]!).sort()).toEqual(['codigo', 'nome']);
      }
    });

    it('C3. forma inativada no Vendedor some da lista do Core; reativada, volta', async () => {
      const salvarPix = (ativo: boolean) =>
        api.chamar(tk.adminA, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${PA.formas.pix}`, payload: { id: PA.formas.pix, codigo: 'PIX', nome: 'Pix', ativo, ordem: 1 } });
      const codigos = async () => ((await api.chamar(tk.analista, { method: 'GET', url: '/v1/core/formas-pagamento' })).json() as { formas: Array<{ codigo: string }> }).formas.map((f) => f.codigo);
      expect((await salvarPix(false)).statusCode).toBe(200);
      try {
        expect(await codigos()).not.toContain('PIX');
      } finally {
        expect((await salvarPix(true)).statusCode).toBe(200);
      }
      expect(await codigos()).toContain('PIX');
    });

    it('C4. tenant B: o admin de B (Vendedor removido só no usuário; a consulta é por licença do tenant) recebe AVISTA e DINHEIRO, nada de A', async () => {
      const r = await api.chamar(tk.adminB, { method: 'GET', url: '/v1/core/formas-pagamento' });
      expect(r.statusCode, r.body).toBe(200);
      const { formas } = r.json() as { formas: Array<{ codigo: string }> | null };
      expect(formas, 'consulta do Vendedor com licença do tenant: não pode vir null por causa da remoção no usuário').not.toBeNull();
      expect(formas!.map((f) => f.codigo).sort()).toEqual(['AVISTA', 'DINHEIRO']);
    });

    it('C5. Vendedor desligado no tenant A: GET /v1/core/formas-pagamento → 200 com formas: null (a ficha mostra só leitura); religado, volta a lista', async () => {
      expect((await licenca(api, tk.adminA, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        const r = await api.chamar(tk.analista, { method: 'GET', url: '/v1/core/formas-pagamento' });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toEqual({ formas: null });
        // a edição do prazo médio continua no Core (a ficha deixa o prazo editável)
        const put = await pagamentoCliente(tk.analista, A.clientes.c2, 30, null);
        expect(put.statusCode, put.body).toBe(200);
      } finally {
        expect((await licenca(api, tk.adminA, 'tenant', 'vendedor', true)).statusCode).toBe(200);
        await q('update core.cliente set prazo_medio_max_dias = null, formas_pagamento = null where id = $1', [A.clientes.c2]);
      }
      const r = await api.chamar(tk.analista, { method: 'GET', url: '/v1/core/formas-pagamento' });
      expect((r.json() as { formas: unknown[] | null }).formas).not.toBeNull();
    });

    it('C6. analista grava prazo 60 e formas ["boleto","BOLETO","pix"] no A.c1: 200 com os códigos em maiúsculas e sem repetição; banco, Cliente 360, auditoria e core.cliente.atualizado@1', async () => {
      const r = await pagamentoCliente(tk.analista, A.clientes.c1, 60, ['boleto', 'BOLETO', 'pix']);
      try {
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toEqual({ prazo_medio_max_dias: 60, formas_pagamento: ['BOLETO', 'PIX'] });
        expect((await q('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1', [A.clientes.c1]))[0]).toEqual({ prazo_medio_max_dias: 60, formas_pagamento: ['BOLETO', 'PIX'] });
        const c360 = await api.chamar(tk.analista, { method: 'GET', url: `/v1/core/clientes/${A.clientes.c1}` });
        expect(c360.statusCode, c360.body).toBe(200);
        expect((c360.json() as { cliente: Linha }).cliente).toMatchObject({ prazo_medio_max_dias: 60, formas_pagamento: ['BOLETO', 'PIX'] });
        const aud = await q<{ acao: string; tenant_id: string }>("select acao, tenant_id from plataforma.auditoria where entidade_id = $1 and acao = 'cliente.pagamento_editar'", [A.clientes.c1]);
        expect(aud.length).toBeGreaterThanOrEqual(1);
        expect(aud.every((x) => x.tenant_id === A.tenantId)).toBe(true);
        const ev = await q<{ payload: Linha }>("select payload from plataforma.evento where nome = 'core.cliente.atualizado@1' and agregado_id = $1 order by created_at desc limit 1", [A.clientes.c1]);
        expect(ev[0]?.payload).toMatchObject({ cliente_id: A.clientes.c1, campos: ['prazo_medio_max_dias', 'formas_pagamento'], origem: 'bko' });
        // e o Vendedor revalida com o cadastro novo: 30/60/90 (60) passa a ser aceito (vai para aprovação pelo título vencido)
        const [p] = await push(tk.vendedor, [pedidoA(PED.semTeto, PA.formas.boleto, PA.prazos.bol306090)]);
        expect(p, JSON.stringify(p)).toMatchObject({ status: 'aceito' });
        expect((await linha(PED.semTeto))!).toMatchObject({ prazo_medio_dias: 60, status: 'pending_approval' });
      } finally {
        await restaurarC1();
      }
    });

    it('C7. lista vazia vira null (todas as formas) e prazo null = sem teto; corpo inválido → 400/422 sem gravar', async () => {
      try {
        const r = await pagamentoCliente(tk.adminA, A.clientes.c1, null, []);
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toEqual({ prazo_medio_max_dias: null, formas_pagamento: null });
        for (const ruim of [{ prazo_medio_max_dias: 366, formas_pagamento: null }, { prazo_medio_max_dias: -1, formas_pagamento: null }, { prazo_medio_max_dias: 30, formas_pagamento: null, extra: 1 }]) {
          const x = await api.chamar(tk.adminA, { method: 'PUT', url: `/v1/core/clientes/${A.clientes.c1}/pagamento`, payload: ruim });
          expect([400, 422], `${JSON.stringify(ruim)}: ${x.body}`).toContain(x.statusCode);
        }
        expect((await q('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1', [A.clientes.c1]))[0]).toEqual({ prazo_medio_max_dias: null, formas_pagamento: null });
      } finally {
        await restaurarC1();
      }
    });

    it('C8. tenant: o admin de B edita o cliente de A → 404 e nada muda; o cliente de A não aparece para B', async () => {
      const r = await pagamentoCliente(tk.adminB, A.clientes.c1, 0, ['DINHEIRO']);
      expect(r.statusCode, r.body).toBe(404);
      expect((await q('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1', [A.clientes.c1]))[0]).toEqual({ prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] });
    });

    it('C9. pull do cliente leva prazo_medio_max_dias e formas_pagamento ao aparelho (offline); o vendedor de B não recebe o A.c1', async () => {
      await esperarHorizonte();
      const puxar = async (token: string) => {
        const r = await api.chamar(token, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' });
        expect(r.statusCode, r.body).toBe(200);
        return (r.json() as { itens: Linha[] }).itens;
      };
      const c1 = (await puxar(tk.vendedor)).find((c) => c.id === A.clientes.c1);
      expect(c1).toMatchObject({ prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] });
      const deB = await puxar(tk.vendedorB);
      expect(deB.find((c) => c.id === A.clientes.c1)).toBeUndefined();
      expect(deB.find((c) => c.id === B.clientes.c1)).toMatchObject({ prazo_medio_max_dias: 30 });
    });
  });

  // ------------------------------------------------------------------------------------------------ Vendedor: formas e prazos (BKO)
  describe('F. Vendedor — /v1/vendedor/formas-pagamento e /prazos-pagamento (Parâmetros do BKO)', () => {
    it('F1. perfil: vendedor, supervisor e promotor → 403 no GET e nos PUTs; nada gravado', async () => {
      const forma = { id: NOVAS.forma, codigo: 'CHEQUE', nome: 'Cheque', ativo: true, ordem: 5 };
      const prazo = { id: NOVAS.prazo, forma_pagamento_id: PA.formas.boleto, codigo: 'BOL-30-45', parcelas_dias: [30, 45] };
      for (const [quem, token] of Object.entries({ vendedor: tk.vendedor, supervisor: tk.supervisor, promotor: tk.promotor })) {
        const g = await api.chamar(token, { method: 'GET', url: '/v1/vendedor/formas-pagamento' });
        expect(g.statusCode, `${quem} GET: ${g.body}`).toBe(403);
        cod403(await api.chamar(token, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${NOVAS.forma}`, payload: forma }));
        cod403(await api.chamar(token, { method: 'PUT', url: `/v1/vendedor/prazos-pagamento/${NOVAS.prazo}`, payload: prazo }));
      }
      expect(await q('select 1 from vendedor.forma_pagamento where id = $1', [NOVAS.forma])).toEqual([]);
      expect(await q('select 1 from vendedor.prazo_pagamento where id = $1', [NOVAS.prazo])).toEqual([]);
    });

    it('F2. promotor com o Vendedor licenciado ao perfil continua 403 (ação forma_pagamento.*, regra 7), e não por MODULO_INATIVO', async () => {
      expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      try {
        const g = await api.chamar(tk.promotor, { method: 'GET', url: '/v1/vendedor/formas-pagamento' });
        cod403(g);
        expect(erroDe(g).codigo).not.toBe('MODULO_INATIVO');
        const p = await api.chamar(tk.promotor, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${NOVAS.forma}`, payload: { id: NOVAS.forma, codigo: 'CHEQUE', nome: 'Cheque' } });
        cod403(p);
        expect(erroDe(p).codigo).not.toBe('MODULO_INATIVO');
      } finally {
        expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
      }
    });

    it('F3. GET (admin, analista, gerente de A): formas e prazos de A (inclui inativos), nada de B', async () => {
      for (const token of [tk.adminA, tk.analista, tk.gerente]) {
        const r = await api.chamar(token, { method: 'GET', url: '/v1/vendedor/formas-pagamento' });
        expect(r.statusCode, r.body).toBe(200);
        const b = r.json() as { formas: Array<{ id: string }>; prazos: Array<{ id: string }> };
        expect(b.formas.map((f) => f.id)).toEqual(expect.arrayContaining([PA.semeada.forma, PA.formas.pix, PA.formas.boleto]));
        expect(b.prazos.map((p) => p.id)).toEqual(expect.arrayContaining([PA.semeada.prazo, PA.prazos.pixAvista, PA.prazos.bol2856, PA.prazos.bol306090, PA.prazos.bol28Inativo]));
        expect(b.formas.map((f) => f.id)).not.toContain(PB.formas.dinheiro);
        expect(b.prazos.map((p) => p.id)).not.toContain(PB.prazos.dinAvista);
      }
    });

    it('F4. admin de B (Vendedor removido no usuário) → 403 MODULO_INATIVO nas rotas do Vendedor', async () => {
      const r = await api.chamar(tk.adminB, { method: 'GET', url: '/v1/vendedor/formas-pagamento' });
      cod403(r);
      expect(erroDe(r).codigo).toBe('MODULO_INATIVO');
    });

    it('F5. gerente cria a forma CHEQUE (código em maiúsculas) e o prazo 30/45 (prazo médio 38, arredondado para cima; descrição "30/45 dias"); repetir o PUT é idempotente; auditado', async () => {
      const f = await api.chamar(tk.gerente, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${NOVAS.forma}`, payload: { id: NOVAS.forma, codigo: 'cheque', nome: ' Cheque ', ordem: 5 } });
      expect(f.statusCode, f.body).toBe(200);
      expect(f.json()).toMatchObject({ id: NOVAS.forma, codigo: 'CHEQUE', nome: 'Cheque', ativo: true, ordem: 5, external_id: null });
      const corpoPrazo = { id: NOVAS.prazo, forma_pagamento_id: NOVAS.forma, codigo: 'chq-30-45', parcelas_dias: [30, 45] };
      const p1 = await api.chamar(tk.gerente, { method: 'PUT', url: `/v1/vendedor/prazos-pagamento/${NOVAS.prazo}`, payload: corpoPrazo });
      expect(p1.statusCode, p1.body).toBe(200);
      expect(p1.json()).toMatchObject({ codigo: 'CHQ-30-45', descricao: '30/45 dias', parcelas_dias: [30, 45], prazo_medio_dias: 38, ativo: true });
      const p2 = await api.chamar(tk.gerente, { method: 'PUT', url: `/v1/vendedor/prazos-pagamento/${NOVAS.prazo}`, payload: corpoPrazo });
      expect(p2.statusCode, p2.body).toBe(200);
      expect(await q('select 1 from vendedor.prazo_pagamento where id = $1', [NOVAS.prazo])).toHaveLength(1);
      const aud = await q<{ acao: string }>('select acao from plataforma.auditoria where entidade_id = any($1::uuid[]) order by created_at', [[NOVAS.forma, NOVAS.prazo]]);
      expect(aud.map((a) => a.acao)).toEqual(expect.arrayContaining(['forma_pagamento.criar', 'prazo_pagamento.criar']));
      // a forma nova aparece na ficha do cliente (Core) e não aparece para B
      const core = (await api.chamar(tk.analista, { method: 'GET', url: '/v1/core/formas-pagamento' })).json() as { formas: Array<{ codigo: string }> };
      expect(core.formas.map((x) => x.codigo)).toContain('CHEQUE');
      const coreB = (await api.chamar(tk.adminB, { method: 'GET', url: '/v1/core/formas-pagamento' })).json() as { formas: Array<{ codigo: string }> };
      expect(coreB.formas.map((x) => x.codigo)).not.toContain('CHEQUE');
    });

    it('F6. validações: código de forma repetido → 422 FORMA_DUPLICADA; parcelas decrescentes → 400/422; id do corpo diferente do endereço → 422', async () => {
      cod422(await api.chamar(tk.adminA, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${NOVAS.formaB}`, payload: { id: NOVAS.formaB, codigo: 'BOLETO', nome: 'Outro boleto' } }), 'FORMA_DUPLICADA');
      const dec = await api.chamar(tk.adminA, { method: 'PUT', url: `/v1/vendedor/prazos-pagamento/${NOVAS.prazoB}`, payload: { id: NOVAS.prazoB, forma_pagamento_id: PA.formas.boleto, codigo: 'BOL-60-30', parcelas_dias: [60, 30] } });
      expect([400, 422], dec.body).toContain(dec.statusCode);
      cod422(await api.chamar(tk.adminA, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${NOVAS.formaB}`, payload: { id: NOVAS.forma, codigo: 'XX', nome: 'X' } }), 'PAYLOAD_INVALIDO');
      expect(await q('select 1 from vendedor.forma_pagamento where id = $1', [NOVAS.formaB])).toEqual([]);
      expect(await q('select 1 from vendedor.prazo_pagamento where id = $1', [NOVAS.prazoB])).toEqual([]);
    });

    it('F7. prazo vindo do ERP (PZ-2856): mudar as parcelas → 422 PRAZO_DO_ERP; parcelas no banco intactas', async () => {
      const r = await api.chamar(tk.adminA, { method: 'PUT', url: `/v1/vendedor/prazos-pagamento/${PA.prazos.bol2856}`, payload: { id: PA.prazos.bol2856, forma_pagamento_id: PA.formas.boleto, codigo: 'BOL-28-56', parcelas_dias: [28, 56, 84] } });
      cod422(r, 'PRAZO_DO_ERP');
      const [z] = await q<{ parcelas_dias: number[]; prazo_medio_dias: number }>('select parcelas_dias, prazo_medio_dias from vendedor.prazo_pagamento where id = $1', [PA.prazos.bol2856]);
      expect(z!.parcelas_dias.map(Number)).toEqual([28, 56]);
      expect(z!.prazo_medio_dias).toBe(42);
    });

    it('F8. tenant: o id da forma de A num PUT de prazo de B → 404 FORMA_NAO_ENCONTRADA; o id de um registro de A num PUT de forma de B não toca A', async () => {
      // B precisa do Vendedor no admin para chegar à rota: o gerente não existe em B, então liga-se a licença do admin de B no nível do usuário
      expect((await licenca(api, tk.adminB, 'usuario', 'vendedor', true, B.usuarios.admin)).statusCode).toBe(200);
      try {
        const r = await api.chamar(tk.adminB, { method: 'PUT', url: `/v1/vendedor/prazos-pagamento/${NOVAS.prazoB}`, payload: { id: NOVAS.prazoB, forma_pagamento_id: PA.formas.boleto, codigo: 'B-30', parcelas_dias: [30] } });
        expect(r.statusCode, r.body).toBe(404);
        expect(erroDe(r).codigo).toBe('FORMA_NAO_ENCONTRADA');
        const x = await api.chamar(tk.adminB, { method: 'PUT', url: `/v1/vendedor/formas-pagamento/${PA.formas.pix}`, payload: { id: PA.formas.pix, codigo: 'PIXB', nome: 'Pix de B' } });
        // o id é chave primária global: B não cria outra linha com o id de A nem enxerga a de A (RLS)
        cod422(x, 'ID_EM_USO');
        const [pix] = await q<{ tenant_id: string; codigo: string; nome: string }>('select tenant_id, codigo, nome from vendedor.forma_pagamento where id = $1', [PA.formas.pix]);
        expect(pix, 'a forma de A não pode ser alterada por B').toEqual({ tenant_id: A.tenantId, codigo: 'PIX', nome: 'Pix' });
        // RLS direto: no contexto de B, só formas de B
        const deB = await comTenant(api.pool, B.tenantId, (c) => c.query<{ tenant_id: string }>('select tenant_id from vendedor.forma_pagamento'));
        expect(deB.rows.length).toBeGreaterThan(0);
        expect(deB.rows.every((l) => l.tenant_id === B.tenantId)).toBe(true);
      } finally {
        expect((await licenca(api, tk.adminB, 'usuario', 'vendedor', false, B.usuarios.admin)).statusCode).toBe(200);
      }
    });

    it('F9. pull de forma_pagamento e prazo_pagamento: o vendedor de A recebe as de A (com o prazo médio), o de B só as de B', async () => {
      await esperarHorizonte();
      const puxar = async (token: string, entidade: string) => {
        const r = await api.chamar(token, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}` });
        expect(r.statusCode, r.body).toBe(200);
        return (r.json() as { itens: Linha[] }).itens;
      };
      const formasA = await puxar(tk.vendedor, 'forma_pagamento');
      const prazosA = await puxar(tk.vendedor, 'prazo_pagamento');
      const formasB = await puxar(tk.vendedorB, 'forma_pagamento');
      const prazosB = await puxar(tk.vendedorB, 'prazo_pagamento');
      expect(formasA.map((f) => f.id)).toEqual(expect.arrayContaining([PA.formas.pix, PA.formas.boleto]));
      expect(prazosA.find((p) => p.id === PA.prazos.bol2856)).toMatchObject({ prazo_medio_dias: 42, forma_pagamento_id: PA.formas.boleto });
      expect(formasA.map((f) => f.id)).not.toContain(PB.formas.dinheiro);
      expect(prazosA.map((p) => p.id)).not.toContain(PB.prazos.dinAvista);
      expect(formasB.map((f) => f.id)).toContain(PB.formas.dinheiro);
      const deA = new Set<string>([PA.formas.pix, PA.formas.boleto, PA.semeada.forma, ...Object.values(PA.prazos), PA.semeada.prazo]);
      expect(formasB.map((f) => String(f.id)).filter((x) => deA.has(x))).toEqual([]);
      expect(prazosB.map((p) => String(p.id)).filter((x) => deA.has(x))).toEqual([]);
    });

    it('F10. Vendedor desligado no tenant A: as rotas de formas e prazos → 403 MODULO_INATIVO; religado, 200', async () => {
      expect((await licenca(api, tk.adminA, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        const r = await api.chamar(tk.adminA, { method: 'GET', url: '/v1/vendedor/formas-pagamento' });
        cod403(r);
        expect(erroDe(r).codigo).toBe('MODULO_INATIVO');
      } finally {
        expect((await licenca(api, tk.adminA, 'tenant', 'vendedor', true)).statusCode).toBe(200);
      }
      expect((await api.chamar(tk.adminA, { method: 'GET', url: '/v1/vendedor/formas-pagamento' })).statusCode).toBe(200);
    });
  });
});
