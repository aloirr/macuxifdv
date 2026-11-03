/**
 * T-0055 (PR #40, Gestor) — ponta a ponta na base demo: `createApp` REAL (8 módulos), Postgres como `macuxi_app` (RLS),
 * despachante REAL da outbox alimentando a projeção do Gestor com os eventos do Vendedor, e a fixture dois-tenants no
 * mesmo banco para provar o isolamento. A projeção ainda é EM MEMÓRIA (`repositorioGestor`, até a migração do schema
 * `gestor`): aqui API e despachante rodam no MESMO processo e enxergam o mesmo repositório (na demo real, API e worker
 * são processos diferentes — ver o aviso no relatório da rodada de 02/11).
 *
 * Casos:
 *  G1 sem a licença do Gestor (base demo): /v1/gestor/* = 403 MODULO_INATIVO e o módulo não está em /v1/me/modulos;
 *  G2 admin liga o Gestor (tenant + perfis supervisor/gerente/analista): entra nos módulos efetivos;
 *  G3 pedido de 8% do Lucas → despachante → a supervisora vê o pedido na fila de Aprovações (RF-GES-04, nível supervisor);
 *  G4 painel da equipe e ranking (200, com o Lucas; a vendedor2 também é da equipe da Renata);
 *  G5 perfil errado: vendedor e promotor 403; analista lê o tenant (RN-GES-07) e não dispensa alerta (403);
 *  G6 aprovar pelo Vendedor (ADR 0011) → despachante → o pedido sai da fila;
 *  G7 tenant errado: a supervisora do tenant A não vê nada da demo na fila nem no painel.
 * Matriz: tests/plano/demo-matriz.md (D-G05 e D-G06).
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import { FilaAprovacao, VisaoEquipe } from '@macuxi/gestor/contracts';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, licenca } from '../apoio/api';
import { blindarPool, DEMO, encerrarPool, subirApiDemo, TENANT_DEMO, type ApiDemo, type ChaveDemo } from '../apoio/demo';

describe.skipIf(semBanco())('T-0055 — Gestor ponta a ponta na base demo (createApp real × Postgres × despachante)', () => {
  let api: ApiDemo;
  let worker: pg.Pool;
  const token = {} as Record<ChaveDemo, string>;
  const usuarioId = {} as Record<ChaveDemo, string>;
  let pedidoId = '';

  const linhas = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 30; i += 1) if ((await d.ciclo()).lidos === 0) return;
  };
  const codigo = (corpo: Record<string, unknown>) => corpo.codigo as string | undefined;

  beforeAll(async () => {
    api = await subirApiDemo({ comDoisTenants: true });
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o e2e do Gestor precisa do despachante');
    worker = blindarPool(new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 }));
    for (const k of Object.keys(DEMO) as ChaveDemo[]) {
      const s = await api.sessao(DEMO[k]);
      token[k] = s.access_token;
      usuarioId[k] = s.usuario.id;
    }
    await despachar();
  }, 180_000);
  afterAll(async () => {
    await encerrarPool(worker);
    await api?.fechar();
  });

  it('G1. Licença do Gestor na base demo: com o seed do Gestor (02/11) a supervisora já o tem e o vendedor não; sem o seed, /v1/gestor/* = 403 MODULO_INATIVO', async () => {
    if ((await api.meusModulos(token.supervisor)).modulos.some((m) => m.id === 'gestor')) {
      // db/seeds/demo/gestor.ts ligado no carregarDemo: a licença vem da base (tenant + perfis), sem o admin ligar
      expect((await api.meusModulos(token.vendedor)).modulos.map((m) => m.id)).not.toContain('gestor');
      expect((await api.get(token.supervisor, '/v1/gestor/equipe')).status).toBe(200);
      const r = await api.get(token.vendedor, '/v1/gestor/equipe');
      expect([r.status, codigo(r.corpo)]).toEqual([403, 'MODULO_INATIVO']);
      return;
    }
    for (const url of ['/v1/gestor/equipe', '/v1/gestor/aprovacoes']) {
      const r = await api.get(token.supervisor, url);
      expect([r.status, codigo(r.corpo)], url).toEqual([403, 'MODULO_INATIVO']);
    }
  });

  it('G2. O admin liga o Gestor no tenant e nos perfis supervisor, gerente e analista: entra nos módulos efetivos deles (e não no do vendedor)', async () => {
    expect((await licenca(api, token.admin, 'tenant', 'gestor', true)).statusCode).toBe(200);
    for (const perfil of ['supervisor', 'gerente', 'analista']) expect((await licenca(api, token.admin, 'perfil', 'gestor', true, perfil)).statusCode, perfil).toBe(200);
    for (const k of ['supervisor', 'gerente', 'analista'] as const) expect((await api.meusModulos(token[k])).modulos.map((m) => m.id), k).toContain('gestor');
    expect((await api.meusModulos(token.vendedor)).modulos.map((m) => m.id)).not.toContain('gestor');
  });

  it('G3. Pedido de 8% do Lucas → despachante → a supervisora vê o pedido na fila de Aprovações (nível supervisor, com prazo)', async () => {
    const [cli] = await linhas<{ cliente_id: string; tabela_preco_id: string; condicao: string; descricao: string }>(
      `select c.cliente_id, t.tabela_preco_id, cc.condicao_pagamento_id as condicao, cp.descricao
         from core.carteira c
         join catalogo.cliente_tabela_preco t on t.cliente_id = c.cliente_id and t.deleted_at is null
         join vendedor.cliente_condicao cc on cc.cliente_id = c.cliente_id and cc.deleted_at is null
         join vendedor.condicao_pagamento cp on cp.id = cc.condicao_pagamento_id and cp.ativo
        where c.tenant_id = $1 and c.usuario_id = $2 and c.deleted_at is null
        order by c.cliente_id limit 1`,
      [TENANT_DEMO, usuarioId.vendedor],
    );
    expect(cli, 'cliente do Lucas com tabela e condição').toBeDefined();
    const prods = await linhas<{ produto_id: string }>(
      'select produto_id from catalogo.tabela_preco_item where tabela_preco_id = $1 and deleted_at is null order by produto_id limit 2',
      [cli!.tabela_preco_id],
    );
    pedidoId = randomUUID();
    const payload = { id: pedidoId, customer_id: cli!.cliente_id, discount_pct: 8, payment_terms: cli!.descricao, condicao_pagamento_id: cli!.condicao, items: prods.map((p) => ({ product_id: p.produto_id, quantity: 3 })) };
    const r = await api.chamar(token.vendedor, { method: 'POST', url: '/v1/sync/push', payload: { itens: [{ id: pedidoId, entidade: 'pedido', operacao: 'upsert', payload }] } });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as { resultados: ResultadoItemPush[] }).resultados[0]).toMatchObject({ id: pedidoId, status: 'aceito' });
    const [b] = await linhas<{ status: string; nivel_aprovacao: string }>('select status, nivel_aprovacao from vendedor.pedido where id = $1', [pedidoId]);
    expect(b).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'supervisor' });
    await despachar();
    const f = await api.get(token.supervisor, '/v1/gestor/aprovacoes');
    expect(f.status, JSON.stringify(f.corpo)).toBe(200);
    const fila = FilaAprovacao.parse(f.corpo);
    const item = fila.itens.find((i) => i.pedido_id === pedidoId);
    expect(item, `pedido na fila da supervisora: ${JSON.stringify(fila.itens.map((i) => i.pedido_id))}`).toBeDefined();
    expect(item).toMatchObject({ vendedor_id: usuarioId.vendedor, cliente_id: cli!.cliente_id, nivel: 'supervisor' });
    expect(item!.total_cents).toBeGreaterThan(0);
  }, 180_000);

  it('G4. Painel da equipe (GET /v1/gestor/equipe) e ranking (GET /v1/gestor/ranking): 200; o Lucas e a Camila estão na equipe da Renata', async () => {
    const e = await api.get(token.supervisor, '/v1/gestor/equipe');
    expect(e.status, JSON.stringify(e.corpo)).toBe(200);
    const v = VisaoEquipe.parse(e.corpo);
    const ids = v.membros.map((m) => m.membro.id);
    expect(ids).toEqual(expect.arrayContaining([usuarioId.vendedor, usuarioId.vendedor2]));
    const ficha = await api.get(token.supervisor, `/v1/gestor/equipe/${usuarioId.vendedor}`);
    expect(ficha.status, JSON.stringify(ficha.corpo)).toBe(200);
    const rk = await api.get(token.supervisor, '/v1/gestor/ranking');
    expect(rk.status, JSON.stringify(rk.corpo)).toBe(200);
  });

  it('G5. Perfil errado: vendedor e promotor 403 em /v1/gestor/*; analista lê o tenant (200) mas não dispensa alerta (403, RN-GES-07)', async () => {
    for (const k of ['vendedor', 'promotor'] as const) {
      const r = await api.get(token[k], '/v1/gestor/equipe');
      expect(r.status, `${k}: ${JSON.stringify(r.corpo)}`).toBe(403);
      expect(['MODULO_INATIVO', 'PERFIL_SEM_ACESSO']).toContain(codigo(r.corpo));
    }
    const a = await api.get(token.analista, '/v1/gestor/aprovacoes');
    expect(a.status, JSON.stringify(a.corpo)).toBe(200);
    expect(FilaAprovacao.parse(a.corpo).itens.map((i) => i.pedido_id)).toContain(pedidoId);
    const d = await api.chamar(token.analista, { method: 'POST', url: `/v1/gestor/alertas/${randomUUID()}/dispensar`, payload: {} });
    expect([d.statusCode, (d.json() as { codigo?: string }).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
  });

  it('G6. A supervisora aprova pelo Vendedor (ADR 0011) → despachante → o pedido sai da fila de Aprovações', async () => {
    const r = await api.chamar(token.supervisor, { method: 'POST', url: `/v1/vendedor/pedidos/${pedidoId}/aprovar`, payload: {} });
    expect(r.statusCode, r.body).toBe(200);
    await despachar();
    const f = FilaAprovacao.parse((await api.get(token.supervisor, '/v1/gestor/aprovacoes')).corpo);
    expect(f.itens.map((i) => i.pedido_id)).not.toContain(pedidoId);
  }, 120_000);

  it('G7. Tenant errado: a supervisora do tenant A (com o Gestor ligado no A) não vê pedido nem pessoa da demo', async () => {
    const adminA = await api.sessaoNoTenant(A, 'admin@exemplo.com.br').catch(() => null);
    const supA = await api.sessaoNoTenant(A, 'supervisor@exemplo.com.br');
    if (adminA) {
      await licenca(api, adminA.access_token, 'tenant', 'gestor', true);
      await licenca(api, adminA.access_token, 'perfil', 'gestor', true, 'supervisor');
    }
    for (const url of ['/v1/gestor/aprovacoes', '/v1/gestor/equipe']) {
      const r = await api.get(supA.access_token, url);
      if (r.status === 200) {
        const texto = JSON.stringify(r.corpo);
        for (const id of [pedidoId, usuarioId.vendedor, usuarioId.vendedor2, TENANT_DEMO]) expect(texto, `${url} vazou ${id}`).not.toContain(id);
      } else expect(r.status, url).toBe(403);
    }
    expect((await api.get(supA.access_token, `/v1/gestor/equipe/${usuarioId.vendedor}`)).status).not.toBe(200);
  });
});
