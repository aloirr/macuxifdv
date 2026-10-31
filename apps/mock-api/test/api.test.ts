import { mkdtempSync, rmSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { readFile } from '../src/excel/io';
import { FILES } from '../src/excel/tables';
import type { Store } from '../src/store';

/** Relógio fixo: segunda, 12/10/2026, 10:00 em Manaus. */
const NOW = new Date('2026-10-12T14:00:00Z');
let app: FastifyInstance;
let store: Store;
let dir: string;
const users: Record<string, string> = {};

async function call(method: string, url: string, user?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as 'GET',
    url: `/v1${url}`,
    headers: { ...(user ? { authorization: `Bearer fake.${users[user]}` } : {}), ...headers },
    payload: body as object,
  });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mock-data-'));
  ({ app, store } = await buildApp({ dataDir: dir, logger: false, clock: () => NOW }));
  const list = (await call('GET', '/auth/users')).body.items as Array<{ id: string; name: string }>;
  for (const u of list) users[u.name.split(' ')[0]!] = u.id;
}, 60_000);

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('autenticação e escopo', () => {
  it('sem token: 401 com mensagem legível', async () => {
    const r = await call('GET', '/me');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('unauthorized');
  });

  it('/me do vendedor traz a alçada', async () => {
    const r = await call('GET', '/me', 'Rafael');
    expect(r.body.seller.short_name).toBe('Rafael S.');
    expect(r.body.seller.max_discount_pct).toBe(5);
    expect(r.body.today).toBe('2026-10-12');
  });

  it('vendedor só vê a própria carteira', async () => {
    const r = await call('GET', '/customers', 'Rafael');
    expect(r.body.items).toHaveLength(80);
    const other = (await call('GET', '/customers?q=Auto Center Flores', 'Fernando')).body.items[0];
    expect((await call('GET', `/customers/${other.id}`, 'Rafael')).status).toBe(403);
  });
});

describe('dados coerentes com os mockups', () => {
  it('rota de hoje do Rafael: 3 feitas e a próxima é Auto Peças Rio Negro', async () => {
    const r = await call('GET', '/routes/today', 'Rafael');
    expect(r.body.done_count).toBe(3);
    expect(r.body.stops.find((s: { status: string }) => s.status === 'next').customer.trade_name).toBe('Auto Peças Rio Negro');
  });

  it('metas: 14 dias úteis restantes (12/10 é feriado) e gatilho liberado', async () => {
    const r = await call('GET', '/goals/me', 'Rafael');
    expect(r.body.business_days).toEqual({ total: 21, elapsed: 7, remaining: 14 });
    expect(r.body.trigger_blocked).toBe(false);
    expect(r.body.incentive_cents).toBeGreaterThan(0);
    expect(r.body.kpis.find((k: { kpi_code: string }) => k.kpi_code === 'coverage').actual).toBe(64);
  });

  it('farol de pedidos tem 10482, 10494 e 10501 aguardando aprovação', async () => {
    const r = await call('GET', '/dashboards/orders', 'Fernando');
    expect(r.body.approvals.map((o: { number: string }) => o.number).sort()).toEqual(['10482', '10494', '10501']);
  });
});

describe('pedido', () => {
  let customerId = '';
  let productId = '';
  beforeAll(async () => {
    customerId = (await call('GET', '/customers?q=Rio Negro', 'Rafael')).body.items[0].id;
    productId = (await call('GET', `/products?q=PST-4410&customer_id=${customerId}`, 'Rafael')).body.items[0].id;
  });
  const body = (id: string, discount: number) => ({ id, customer_id: customerId, discount_pct: discount, items: [{ product_id: productId, quantity: 10 }] });

  it('dentro da alçada: vai ao ERP, grava em saida/pedidos.xlsx e na auditoria; reenvio não duplica', async () => {
    const id = randomUUID();
    const r1 = await call('POST', '/orders', 'Rafael', body(id, 4), { 'idempotency-key': id });
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('sent_to_erp');
    expect(r1.body.total_cents).toBe(86304); // 10 × 89,90 − 4%
    const r2 = await call('POST', '/orders', 'Rafael', body(id, 4), { 'idempotency-key': id });
    expect(r2.status).toBe(200);
    expect(r2.body.number).toBe(r1.body.number);
    const file = await readFile(path.join(dir, FILES.pedidos.file), FILES.pedidos);
    expect(file.sales_order!.filter((o) => o.id === id)).toHaveLength(1);
    const auditFile = await readFile(path.join(dir, FILES.auditoria.file), FILES.auditoria);
    expect(auditFile.audit_log!.some((a) => a.entity_id === id && a.action === 'create')).toBe(true);
  });

  it('acima da alçada: aguarda aprovação; gestor aprova; assistente não pode', async () => {
    const id = randomUUID();
    const r = await call('POST', '/orders', 'Rafael', body(id, 7), { 'idempotency-key': id });
    expect(r.body.status).toBe('pending_approval');
    expect(r.body.pending_reason).toContain('alçada');
    expect((await call('POST', `/orders/${id}/approve`, 'Ana', {})).status).toBe(403);
    expect((await call('POST', `/orders/${id}/reject`, 'Fernando', { reason: '' })).status).toBe(400);
    const ok = await call('POST', `/orders/${id}/approve`, 'Fernando', {});
    expect(ok.body.status).toBe('sent_to_erp');
    const seen = await call('GET', `/orders/${id}`, 'Rafael');
    expect(seen.body.history.some((h: { status: string }) => h.status === 'approved')).toBe(true);
  });

  it('desconto acima do máximo: rejeitado com motivo', async () => {
    const id = randomUUID();
    const r = await call('POST', '/orders', 'Rafael', body(id, 20));
    expect(r.body.status).toBe('rejected');
    expect(r.body.rejection_reason).toContain('alçada máxima');
  });

  it('pedido inválido: 400 em português', async () => {
    const r = await call('POST', '/orders', 'Rafael', { id: 'x', customer_id: customerId, discount_pct: 0, items: [] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('validation_error');
  });

  it('pedidos.xlsx aberto no Excel: 503 legível, pedido não se perde e é gravado depois', async () => {
    const lock = path.join(dir, 'saida', '~$pedidos.xlsx');
    writeFileSync(lock, 'excel');
    const id = randomUUID();
    const r = await call('POST', '/orders', 'Rafael', body(id, 2), { 'idempotency-key': id });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('file_locked');
    expect(r.body.message).toContain('Feche pedidos.xlsx no Excel');
    // ainda travado: reenvio continua avisando
    expect((await call('POST', '/orders', 'Rafael', body(id, 2), { 'idempotency-key': id })).status).toBe(503);
    unlinkSync(lock);
    await store.flushDirty();
    const again = await call('POST', '/orders', 'Rafael', body(id, 2), { 'idempotency-key': id });
    expect(again.status).toBe(200);
    const file = await readFile(path.join(dir, FILES.pedidos.file), FILES.pedidos);
    expect(file.sales_order!.some((o) => o.id === id)).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });
});

describe('plano de RV', () => {
  it('pesos precisam somar 100%; mudar o peso muda a parcial do vendedor', async () => {
    const plan = (await call('GET', '/incentive-plans/current', 'Juliana')).body;
    const rv0 = (await call('GET', '/goals/me', 'Rafael')).body.incentive_cents;
    const rules = plan.rules.map((r: { kpi_code: string; weight_pct: number; is_trigger: boolean; bands: unknown[] }) => ({ kpi_code: r.kpi_code, weight_pct: r.weight_pct, is_trigger: r.is_trigger, bands: r.bands }));
    const base = { name: plan.name, max_amount_cents: plan.max_amount_cents, valid_from: plan.valid_from, applies_to: plan.applies_to };
    const bad = await call('PUT', `/incentive-plans/${plan.id}`, 'Juliana', { ...base, rules: rules.map((r: { kpi_code: string }) => (r.kpi_code === 'revenue' ? { ...r, weight_pct: 40 } : r)) });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('weights_must_sum_100');
    expect((await call('PUT', `/incentive-plans/${plan.id}`, 'Rafael', { ...base, rules })).status).toBe(403);
    const shifted = rules.map((r: { kpi_code: string; weight_pct: number }) => (r.kpi_code === 'revenue' ? { ...r, weight_pct: 40 } : r.kpi_code === 'coverage' ? { ...r, weight_pct: 35 } : r));
    const ok = await call('PUT', `/incentive-plans/${plan.id}`, 'Juliana', { ...base, rules: shifted });
    expect(ok.status).toBe(200);
    expect(ok.body.last_change).toContain('peso de faturamento de 50% para 40%');
    const rv1 = (await call('GET', '/goals/me', 'Rafael')).body.incentive_cents;
    expect(rv1).not.toBe(rv0);
    await call('PUT', `/incentive-plans/${plan.id}`, 'Juliana', { ...base, rules });
    expect((await call('GET', '/goals/me', 'Rafael')).body.incentive_cents).toBe(rv0);
  });

  it('fechar o mês congela; exportação para o RH em CSV', async () => {
    const closed = await call('POST', '/goal-periods/2026-10/close', 'Juliana');
    expect(closed.body.period_status).toBe('closed');
    expect((await call('GET', '/goals/me', 'Rafael')).body.frozen).toBe(true);
    expect((await call('POST', '/goal-periods/2026-10/close', 'Juliana')).status).toBe(409);
    const csv = await call('GET', '/goal-periods/2026-10/payout.csv', 'Juliana');
    expect(String(csv.body)).toContain('Rafael Souza');
    expect((await call('POST', '/goal-periods/2026-10/reopen', 'Juliana')).body.period_status).toBe('open');
  });
});

describe('visitas e rota', () => {
  it('check-in sem pedido conclui a parada', async () => {
    const route = (await call('GET', '/routes/today', 'Rafael')).body;
    const next = route.stops.find((s: { status: string }) => s.status === 'next');
    const id = randomUUID();
    const r = await call('POST', '/visits', 'Rafael', { id, customer_id: next.customer.id, route_stop_id: next.id, checkin_at: NOW.toISOString(), outcome: 'no_order', no_order_reason: 'Comprador ausente' });
    expect(r.status).toBe(201);
    const after = (await call('GET', '/routes/today', 'Rafael')).body;
    expect(after.done_count).toBe(route.done_count + 1);
  });

  it('analista inclui cliente na rota da semana', async () => {
    const c = (await call('GET', '/customers?q=Rio Negro', 'Juliana')).body.items[0];
    const r = await call('POST', '/routes/week/stops', 'Juliana', { customer_id: c.id });
    expect(r.status).toBe(200);
    expect(r.body.stops.some((s: { customer: { id: string } }) => s.customer.id === c.id)).toBe(true);
  });
});

describe('check-in único (um atendimento por vez)', () => {
  let custs: Array<{ id: string; trade_name: string }> = [];
  let productId = '';
  beforeAll(async () => {
    custs = (await call('GET', '/customers?abc=C', 'Rafael')).body.items.slice(0, 3);
    productId = (await call('GET', `/products?q=PST-4410`, 'Rafael')).body.items[0].id;
  });

  it('abre, bloqueia outro cliente, libera pedido para outro, vincula pedido e faz checkout', async () => {
    const [a, b] = custs as [{ id: string; trade_name: string }, { id: string; trade_name: string }];
    const v1 = randomUUID();
    const r1 = await call('POST', '/visits', 'Rafael', { id: v1, customer_id: a.id, checkin_at: NOW.toISOString() });
    expect(r1.status).toBe(201);
    expect(r1.body.checkout_at).toBeNull();
    expect((await call('GET', '/visits/open', 'Rafael')).body.visit.id).toBe(v1);

    // reenvio do mesmo check-in pela fila: não duplica
    expect((await call('POST', '/visits', 'Rafael', { id: v1, customer_id: a.id, checkin_at: NOW.toISOString() })).status).toBe(200);

    // check-in em outro cliente: proibido
    const blocked = await call('POST', '/visits', 'Rafael', { id: randomUUID(), customer_id: b.id, checkin_at: NOW.toISOString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('visit_already_open');
    expect(blocked.body.message).toContain(a.trade_name);

    // pedido para OUTRO cliente continua liberado e não vincula
    const ob = randomUUID();
    expect((await call('POST', '/orders', 'Rafael', { id: ob, customer_id: b.id, discount_pct: 0, items: [{ product_id: productId, quantity: 1 }] })).status).toBe(201);

    // checkout "com pedido" sem pedido do cliente: recusado
    expect((await call('POST', `/visits/${v1}/checkout`, 'Rafael', { outcome: 'order' })).status).toBe(400);
    // sem pedido exige motivo
    expect((await call('POST', `/visits/${v1}/checkout`, 'Rafael', { outcome: 'no_order' })).status).toBe(400);

    // pedido para o cliente em atendimento: vincula à visita, que continua aberta
    const oa = randomUUID();
    await call('POST', '/orders', 'Rafael', { id: oa, customer_id: a.id, discount_pct: 0, items: [{ product_id: productId, quantity: 1 }] });
    const open = (await call('GET', '/visits/open', 'Rafael')).body.visit;
    expect(open.order_id).toBe(oa);
    expect(open.checkout_at).toBeNull();

    const out = await call('POST', `/visits/${v1}/checkout`, 'Rafael', { outcome: 'order' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ outcome: 'order', order_id: oa, closed_by: 'seller' });
    expect((await call('GET', '/visits/open', 'Rafael')).body).toBeNull();

    // agora o outro cliente libera
    expect((await call('POST', '/visits', 'Rafael', { id: randomUUID(), customer_id: b.id, checkin_at: NOW.toISOString() })).status).toBe(201);
  });
});

describe('check-in esquecido', () => {
  it('fecha sozinho na virada do dia; checkout feito sem sinal antes da meia-noite ainda vale', async () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'mock-data-'));
    let now = new Date('2026-10-12T22:00:00Z'); // 18:00 em Manaus
    const { app: app2 } = await buildApp({ dataDir: dir2, logger: false, clock: () => now });
    const users2 = (await app2.inject({ url: '/v1/auth/users' })).json().items as Array<{ id: string; name: string }>;
    const auth = { authorization: `Bearer fake.${users2.find((u) => u.name.startsWith('Rafael'))!.id}` };
    const cust = (await app2.inject({ url: '/v1/customers?abc=C', headers: auth })).json().items as Array<{ id: string }>;
    const a = randomUUID();
    const b = randomUUID();
    expect((await app2.inject({ method: 'POST', url: '/v1/visits', headers: auth, payload: { id: a, customer_id: cust[0]!.id, checkin_at: now.toISOString() } })).statusCode).toBe(201);
    expect((await app2.inject({ method: 'POST', url: '/v1/visits', headers: auth, payload: { id: b, customer_id: cust[1]!.id, checkin_at: now.toISOString() } })).statusCode).toBe(409);

    now = new Date('2026-10-13T04:00:01Z'); // virou o dia em Manaus
    expect((await app2.inject({ url: '/v1/visits/open', headers: auth })).json()).toBeNull();
    // checkout atrasado com horário de depois da virada: recusado
    const late = await app2.inject({ method: 'POST', url: `/v1/visits/${a}/checkout`, headers: auth, payload: { outcome: 'no_order', no_order_reason: 'Loja fechada', checkout_at: now.toISOString() } });
    expect(late.json().code).toBe('visit_closed');
    // checkout feito às 18:30 (antes da virada) que chegou depois: aceito
    const ok = await app2.inject({ method: 'POST', url: `/v1/visits/${a}/checkout`, headers: auth, payload: { outcome: 'no_order', no_order_reason: 'Loja fechada', checkout_at: '2026-10-12T22:30:00Z' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ closed_by: 'seller', checkout_at: '2026-10-12T22:30:00Z' });
    await app2.close();
    rmSync(dir2, { recursive: true, force: true });
  }, 60_000);
});

describe('editar, excluir e duplicar pedido', () => {
  it('edita pedido aguardando aprovação (volta ao ERP ao tirar o desconto) e exclui outro; integrado é imutável', async () => {
    const c = (await call('GET', '/customers?q=Rio Negro', 'Rafael')).body.items[0];
    const p1 = (await call('GET', `/products?q=PST-4410&customer_id=${c.id}`, 'Rafael')).body.items[0];
    const p2 = (await call('GET', `/products?q=FLT-0207&customer_id=${c.id}`, 'Rafael')).body.items[0];
    const id = randomUUID();
    const created = await call('POST', '/orders', 'Rafael', { id, customer_id: c.id, discount_pct: 7, items: [{ product_id: p1.id, quantity: 2 }] });
    expect(created.body.status).toBe('pending_approval');

    // trocar cliente na edição: recusado
    const other = (await call('GET', '/customers?q=Tarumã', 'Rafael')).body.items[0];
    expect((await call('PUT', `/orders/${id}`, 'Rafael', { customer_id: other.id, discount_pct: 0, items: [{ product_id: p1.id, quantity: 1 }] })).status).toBe(400);

    const edited = await call('PUT', `/orders/${id}`, 'Rafael', { customer_id: c.id, discount_pct: 3, payment_terms: '28 dias', items: [{ product_id: p1.id, quantity: 4 }, { product_id: p2.id, quantity: 10 }] });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ number: created.body.number, status: 'sent_to_erp', discount_pct: 3, payment_terms: '28 dias' });
    expect(edited.body.items).toHaveLength(2);
    expect(edited.body.history.some((h: { status: string }) => h.status === 'edited')).toBe(true);
    // não some do farol de aprovações por engano: não está mais pendente
    expect((await call('GET', '/dashboards/orders', 'Fernando')).body.approvals.some((o: { id: string }) => o.id === id)).toBe(false);

    // depois de ir ao ERP, não edita mais
    expect((await call('PUT', `/orders/${id}`, 'Rafael', { customer_id: c.id, discount_pct: 0, items: [{ product_id: p1.id, quantity: 1 }] })).status).toBe(409);

    // excluir = cancelar (o registro continua)
    const id2 = randomUUID();
    await call('POST', '/orders', 'Rafael', { id: id2, customer_id: c.id, discount_pct: 9, items: [{ product_id: p1.id, quantity: 1 }] });
    const cancelled = await call('POST', `/orders/${id2}/cancel`, 'Rafael', { reason: 'cliente desistiu' });
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.rejection_reason).toContain('cliente desistiu');
    expect((await call('GET', `/orders/${id2}`, 'Rafael')).status).toBe(200);

    // integrado não edita nem exclui
    const integrated = (await call('GET', '/orders?status=integrated', 'Rafael')).body.items[0];
    const r = await call('POST', `/orders/${integrated.id}/cancel`, 'Rafael', {});
    expect(r.status).toBe(409);
    // decisão do Alexandre (aviso R-20261031-102322): depois do envio, cancela-se no ERP (antes: "duplique")
    expect(r.body.message).toContain('cancele no ERP');
    // outro vendedor não mexe no pedido do Rafael
    expect((await call('POST', `/orders/${id}/cancel`, 'Bruna', {})).status).toBe(403);
  });
});
