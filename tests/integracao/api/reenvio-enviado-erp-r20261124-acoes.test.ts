/**
 * R-20261124-114951 / R-20261124-115055 (agente testes) — RN-VEN-48 na API REAL (createApp × Postgres × fixture dois-tenants):
 * o botão "Ações" da aba Pedidos não oferece Editar nem Excluir ao pedido já enviado ao ERP, e a API revalida.
 *   A1 reenvio IGUAL do pedido enviado ao ERP continua idempotente (aceito, sem efeito);
 *   A2 reenvio ALTERADO do pedido enviado ao ERP (sent_to_erp, integrated, invoiced) → rejeitado RN-VEN-48, nada muda no banco;
 *   A3 controle: reenvio alterado do pedido ainda NÃO enviado segue `conflito` (RN-VEN-33), nunca RN-VEN-48;
 *   A4 converter um PEDIDO (orcamento_origem_id apontando para pedido) continua recusado; excluir o enviado continua 422;
 *   A5 perfil e tenant: o promotor nunca grava (regra 7); o vendedor de B não altera o pedido de A;
 *   A6 licença: Vendedor desligado no tenant → o push volta rejeitado/MODULO_INATIVO por item (RN-CORE-02).
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const id = (n: number) => `0f480000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DOC = { enviado: id(1), aberto: id(2), conversao: id(3) };

describe.skipIf(semBanco())('RN-VEN-48 — pedido enviado ao ERP: reenvio alterado recusado (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', promotor: '', adminA: '', vendedorB: '' };
  let prod1 = '';
  const criadoEm = new Date().toISOString();

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const doc = (pid: string, quantidade = 1, extra: Record<string, unknown> = {}) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, customer_id: A.clientes.c1, discount_pct: 0, payment_terms: '28 dias', created_offline_at: criadoEm, items: [{ product_id: prod1, quantity: quantidade }], ...extra },
  });
  const quantidades = async (pid: string) => (await q<{ quantidade: number }>('select quantidade::int as quantidade from vendedor.pedido_item where pedido_id = $1 order by quantidade', [pid])).map((x) => x.quantidade);
  const status = async (pid: string) => (await q<{ status: string }>('select status from vendedor.pedido where id = $1', [pid]))[0]?.status;
  const limpar = async () => {
    const ids = Object.values(DOC);
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('update vendedor.pedido set orcamento_id = null where orcamento_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
  };

  beforeAll(async () => {
    api = await subirApi();
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    prod1 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    await limpar();
    const r = await push(tk.vendedor, [doc(DOC.enviado), doc(DOC.aberto)]);
    expect(r.map((x) => [x.id, x.status]), JSON.stringify(r)).toEqual([
      [DOC.enviado, 'aceito'],
      [DOC.aberto, 'aceito'],
    ]);
    // o despachante/Hub não é o foco: o pedido é posto direto em `sent_to_erp` (mesma premissa do cancelamento-erp-t0114)
    await api.admin.query("update vendedor.pedido set status = 'sent_to_erp' where id = $1", [DOC.enviado]);
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await limpar().catch(() => undefined);
    await api.fechar();
  });

  it('A1 RN-VEN-33: reenvio IGUAL do pedido enviado ao ERP continua aceito (idempotente), sem mudar nada', async () => {
    const [r] = await push(tk.vendedor, [doc(DOC.enviado)]);
    expect(r).toMatchObject({ id: DOC.enviado, status: 'aceito' });
    expect(await status(DOC.enviado)).toBe('sent_to_erp');
    expect(await quantidades(DOC.enviado)).toEqual([1]);
  });

  it.each(['sent_to_erp', 'integrated', 'invoiced'])('A2 RN-VEN-48: reenvio ALTERADO do pedido em %s → rejeitado RN-VEN-48, banco intacto', async (st) => {
    await api.admin.query('update vendedor.pedido set status = $2 where id = $1', [DOC.enviado, st]);
    const [r] = await push(tk.vendedor, [doc(DOC.enviado, 3)]);
    expect(r).toMatchObject({ id: DOC.enviado, status: 'rejeitado', codigo: 'RN-VEN-48' });
    expect((r as { mensagem?: string }).mensagem).toMatch(/enviado ao ERP/);
    expect(await status(DOC.enviado)).toBe(st);
    expect(await quantidades(DOC.enviado)).toEqual([1]);
    await api.admin.query("update vendedor.pedido set status = 'sent_to_erp' where id = $1", [DOC.enviado]);
  });

  it('A3 RN-VEN-33 (controle): reenvio alterado do pedido ainda NÃO enviado ao ERP segue `conflito`, nunca RN-VEN-48', async () => {
    const antes = await status(DOC.aberto);
    expect(['sent_to_erp', 'integrated', 'invoiced']).not.toContain(antes);
    const [r] = await push(tk.vendedor, [doc(DOC.aberto, 3)]);
    expect(r).toMatchObject({ id: DOC.aberto, status: 'conflito' });
    expect((r as { codigo?: string }).codigo).not.toBe('RN-VEN-48');
    expect(await quantidades(DOC.aberto)).toEqual([1]);
  });

  it('A4 RN-VEN-48: converter um PEDIDO (origem = pedido) continua recusado; excluir o enviado ao ERP continua 422', async () => {
    const [r] = await push(tk.vendedor, [doc(DOC.conversao, 1, { orcamento_origem_id: DOC.enviado })]);
    expect(r!.status, JSON.stringify(r)).toBe('rejeitado');
    expect(await q('select 1 from vendedor.pedido where id = $1', [DOC.conversao])).toHaveLength(0);
    const c = await api.chamar(tk.vendedor, { method: 'POST', url: `/v1/vendedor/pedidos/${DOC.enviado}/cancelar`, payload: { motivo: 'Cliente desistiu da compra' } });
    expect(c.statusCode, c.body).toBe(422);
    expect(await status(DOC.enviado)).toBe('sent_to_erp');
  });

  it('A5 regra 7 e multi-tenant: promotor nunca grava; o vendedor de B não altera o pedido de A', async () => {
    const [p] = await push(tk.promotor, [doc(DOC.enviado, 5)]);
    expect(p!.status).toBe('rejeitado');
    expect(await quantidades(DOC.enviado)).toEqual([1]);
    const [b] = await push(tk.vendedorB, [doc(DOC.enviado, 7)]);
    expect(b!.status).not.toBe('aceito');
    expect(await quantidades(DOC.enviado)).toEqual([1]);
    expect(await status(DOC.enviado)).toBe('sent_to_erp');
  });

  it('A6 RN-CORE-02: Vendedor desligado no tenant → push rejeitado/MODULO_INATIVO por item; religado, volta à recusa RN-VEN-48', async () => {
    expect((await licenca(api, tk.adminA, 'tenant', 'vendedor', false)).statusCode).toBe(200);
    try {
      const r = await api.chamar(tk.vendedor, { method: 'POST', url: '/v1/sync/push', payload: { itens: [doc(DOC.enviado, 3)] } });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().resultados).toEqual([expect.objectContaining({ id: DOC.enviado, status: 'rejeitado', codigo: 'MODULO_INATIVO' })]);
    } finally {
      expect((await licenca(api, tk.adminA, 'tenant', 'vendedor', true)).statusCode).toBe(200);
    }
    const [r] = await push(tk.vendedor, [doc(DOC.enviado, 3)]);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-48' });
  });
});
