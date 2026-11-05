/**
 * T-0071 critério 4 (permissões e multi-tenant do orçamento) na fixture dois-tenants, onde há DUAS equipes no tenant A
 * (a base demo só tem a Equipe Manaus): createApp REAL × Postgres (macuxi_app, RLS), lista `GET /v1/vendedor/pedidos?tipo=orcamento`,
 * detalhe e pull `GET /v1/sync/pull`, montados como a tela da Gestão (`listaDePedidos` + `porTipo`).
 * Matriz: docs/testes/T-0071.md, seção "Orçamento por equipe e por tenant" (Q1–Q4).
 *
 * Fixture: equipe 1 = supervisor + vendedor-1 (c1); equipe 2 = vendedor-2 (c2); gerente = regional (equipes 1 e 2); B = vendedor de B.
 *  Q1 supervisor (equipe 1): vê o orçamento do vendedor-1 e NÃO o do vendedor-2 (outra equipe) nem o de B — lista, detalhe e pull.
 *  Q2 gerente (regional): vê os dois do tenant A, nunca o de B.
 *  Q3 o supervisor não edita, não cancela nem transforma o orçamento da equipe (só o dono; RN-VEN-18, regra 7 para gestor).
 *  Q4 multi-tenant: o vendedor de B só vê o próprio; não abre, não edita, não cancela nem converte o de A (404 sem revelar).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import type { PedidoSync } from '@macuxi/vendedor/contracts';
import type { LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { porTipo } from '../../../modules/vendedor/app/lib/lista-pedidos';
import { LINHAS_VAZIAS, listaDePedidos } from '../../../modules/vendedor/app/lib/pull';
import { A, B, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';
import { listaDe } from '../apoio/demo';

const id = (n: number) => `0f710000-0000-4000-8000-e${String(n).padStart(11, '0')}`;
const ORC = { v1: id(1), v2: id(2), b: id(3) };

describe.skipIf(semBanco())('T-0071 — orçamento por equipe e por tenant: supervisor só a equipe, gerente a regional, B isolado (createApp × Postgres × fixture)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor1: '', vendedor2: '', supervisor: '', gerente: '', vendedorB: '' };
  const prod = { a: '', b: '' };

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await api.admin.query(sql, p)).rows as T[];
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const doc = (pid: string, cliente: string, produto: string, extra: Record<string, unknown> = {}) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, tipo: 'orcamento', customer_id: cliente, discount_pct: 0, payment_terms: '28 dias', created_offline_at: new Date().toISOString(), items: [{ product_id: produto, quantity: 1 }], ...extra },
  });
  const pullTudo = async <L extends LinhaSync>(t: string, entidade: string): Promise<L[]> => {
    const out: L[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const qs = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
      const r = await api.chamar(t, { method: 'GET', url: `/v1/sync/pull?${qs}` });
      expect(r.statusCode, `${entidade}: ${r.body}`).toBe(200);
      const p = r.json() as { itens: L[]; proximo_cursor: string | null };
      out.push(...p.itens);
      cursor = p.proximo_cursor;
      if (!cursor) break;
    }
    return out.filter((l) => !l.deleted_at);
  };
  /** O que a aba Orçamentos da Gestão mostra (pull → listaDePedidos → porTipo). */
  const orcamentosNaTela = async (t: string): Promise<string[]> => {
    const pedidos = await pullTudo<PedidoSync>(t, 'pedido');
    const lista = listaDePedidos({ ...LINHAS_VAZIAS, pedidos }, {}).map((o) => ({ ...o, local: false, local_error: '' }));
    return porTipo(lista, 'orcamento', new Date()).map((o) => o.id);
  };
  const orcamentosDaApi = async (t: string): Promise<string[]> => {
    const r = await api.chamar(t, { method: 'GET', url: '/v1/vendedor/pedidos?tipo=orcamento&limite=200' });
    expect(r.statusCode, r.body).toBe(200);
    return listaDe(r.json() as Record<string, unknown>).map((x) => (x as { id: string }).id);
  };
  const detalhe = (t: string, pid: string) => api.chamar(t, { method: 'GET', url: `/v1/vendedor/pedidos/${pid}` });
  const retrato = async (pid: string) => (await q('select status, total_cents::text, updated_at::text from vendedor.pedido where id = $1', [pid]))[0];

  beforeAll(async () => {
    api = await subirApi();
    tk.vendedor1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.vendedor2 = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    prod.a = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    prod.b = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'BETA-001'", [B.tenantId]))[0]!.id;
    const r1 = await push(tk.vendedor1, [doc(ORC.v1, A.clientes.c1, prod.a)]);
    const r2 = await push(tk.vendedor2, [doc(ORC.v2, A.clientes.c2, prod.a)]);
    const rb = await push(tk.vendedorB, [doc(ORC.b, B.clientes.c1, prod.b)]);
    expect([...r1, ...r2, ...rb].map((r) => [r.id, r.status]), JSON.stringify([r1, r2, rb])).toEqual([
      [ORC.v1, 'aceito'],
      [ORC.v2, 'aceito'],
      [ORC.b, 'aceito'],
    ]);
    const tipos = await q<{ id: string; tipo: string; tenant_id: string }>('select id, tipo, tenant_id from vendedor.pedido where id = any($1::uuid[]) order by id', [Object.values(ORC)]);
    expect(tipos.every((x) => x.tipo === 'orcamento')).toBe(true);
    await esperarHorizonte();
  }, 300_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('Q1. supervisor da equipe 1: o orçamento do vendedor-1 na lista, no detalhe e na aba Orçamentos (pull); o do vendedor-2 (equipe 2) e o de B, em nenhum', async () => {
    const daApi = await orcamentosDaApi(tk.supervisor);
    expect(daApi).toContain(ORC.v1);
    expect(daApi, 'outra equipe').not.toContain(ORC.v2);
    expect(daApi, 'outro tenant').not.toContain(ORC.b);
    const naTela = await orcamentosNaTela(tk.supervisor);
    expect(naTela).toContain(ORC.v1);
    expect(naTela).not.toContain(ORC.v2);
    expect(naTela).not.toContain(ORC.b);
    expect((await detalhe(tk.supervisor, ORC.v1)).statusCode).toBe(200);
    expect([403, 404], 'detalhe do orçamento de outra equipe').toContain((await detalhe(tk.supervisor, ORC.v2)).statusCode);
    expect((await detalhe(tk.supervisor, ORC.b)).statusCode, 'detalhe do orçamento de outro tenant').toBe(404);
  });

  it('Q2. gerente regional: os orçamentos das duas equipes de A; nunca o de B', async () => {
    const daApi = await orcamentosDaApi(tk.gerente);
    expect(daApi).toEqual(expect.arrayContaining([ORC.v1, ORC.v2]));
    expect(daApi).not.toContain(ORC.b);
    const naTela = await orcamentosNaTela(tk.gerente);
    expect(naTela).toEqual(expect.arrayContaining([ORC.v1, ORC.v2]));
    expect(naTela).not.toContain(ORC.b);
  });

  it('Q3. o supervisor não edita, não cancela nem transforma o orçamento da equipe (só o vendedor dono); nada muda', async () => {
    const antes = await retrato(ORC.v1);
    const atualizado = String((await pullTudo<PedidoSync>(tk.vendedor1, 'pedido')).find((p) => p.id === ORC.v1)!.updated_at);
    const e = await api.chamar(tk.supervisor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${ORC.v1}`, payload: { customer_id: A.clientes.c1, discount_pct: 0, payment_terms: '28 dias', items: [{ product_id: prod.a, quantity: 2 }], atualizado_em: atualizado } });
    expect([403, 404], `PUT do supervisor: ${e.body}`).toContain(e.statusCode);
    const c = await api.chamar(tk.supervisor, { method: 'POST', url: `/v1/vendedor/orcamentos/${ORC.v1}/cancelar`, payload: { motivo: 'supervisor' } });
    expect([403, 404], `cancelar do supervisor: ${c.body}`).toContain(c.statusCode);
    const novo = id(10);
    const [t] = await push(tk.supervisor, [{ ...doc(novo, A.clientes.c1, prod.a), payload: { ...doc(novo, A.clientes.c1, prod.a).payload, tipo: 'pedido', orcamento_origem_id: ORC.v1 } }]);
    expect(t, 'Transformar pelo supervisor').toMatchObject({ id: novo, status: 'rejeitado' });
    expect(await q('select 1 from vendedor.pedido where id = $1 or orcamento_id = $2', [novo, ORC.v1])).toEqual([]);
    expect(await retrato(ORC.v1)).toEqual(antes);
  });

  it('Q4. multi-tenant: o vendedor de B só vê o próprio orçamento; o de A não abre, não edita, não cancela nem converte (404 / ORCAMENTO_NAO_ENCONTRADO); e A não vê o de B', async () => {
    const deB = await orcamentosDaApi(tk.vendedorB);
    expect(deB).toContain(ORC.b);
    expect(deB.filter((x) => x === ORC.v1 || x === ORC.v2), 'B não lista orçamento de A').toEqual([]);
    const telaB = await orcamentosNaTela(tk.vendedorB);
    expect(telaB).toContain(ORC.b);
    expect(telaB.filter((x) => x === ORC.v1 || x === ORC.v2), 'o pull de B não traz orçamento de A').toEqual([]);
    const antes = await retrato(ORC.v1);
    expect((await detalhe(tk.vendedorB, ORC.v1)).statusCode).toBe(404);
    const e = await api.chamar(tk.vendedorB, { method: 'PUT', url: `/v1/vendedor/orcamentos/${ORC.v1}`, payload: { customer_id: B.clientes.c1, discount_pct: 0, payment_terms: '28 dias', items: [{ product_id: prod.b, quantity: 1 }], atualizado_em: new Date().toISOString() } });
    expect(e.statusCode, e.body).toBe(404);
    const c = await api.chamar(tk.vendedorB, { method: 'POST', url: `/v1/vendedor/orcamentos/${ORC.v1}/cancelar`, payload: { motivo: 'B' } });
    expect(c.statusCode, c.body).toBe(404);
    const novo = id(11);
    const [t] = await push(tk.vendedorB, [{ ...doc(novo, B.clientes.c1, prod.b), payload: { ...doc(novo, B.clientes.c1, prod.b).payload, tipo: 'pedido', orcamento_origem_id: ORC.v1 } }]);
    expect(t).toMatchObject({ id: novo, status: 'rejeitado', codigo: 'ORCAMENTO_NAO_ENCONTRADO' });
    expect(await q('select 1 from vendedor.pedido where id = $1', [novo])).toEqual([]);
    expect(await retrato(ORC.v1)).toEqual(antes);
    // e o vendedor-1 de A (mesmo e-mail) nunca vê o de B
    const doV1 = await orcamentosDaApi(tk.vendedor1);
    expect(doV1).toContain(ORC.v1);
    expect(doV1, 'nem o de B, nem o da colega (vendedor-2)').not.toEqual(expect.arrayContaining([ORC.b]));
    expect(doV1).not.toContain(ORC.v2);
    expect((await detalhe(tk.vendedor1, ORC.b)).statusCode).toBe(404);
  });
});
