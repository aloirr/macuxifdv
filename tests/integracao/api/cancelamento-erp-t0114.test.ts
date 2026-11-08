/**
 * T-0114 (agente testes) — CANCELAMENTO DO PEDIDO DEVOLVIDO AO ERP, ponta a ponta: API do Vendedor → outbox → despachante real
 * (`macuxi_worker`) → consumidor do Hub → `GET /integracao/v1/pedidos/pendentes` (campo `cancelamentos`) → retorno `cancelado`
 * do Conector → pedido `cancelled` no Vendedor. `createApp` REAL (8 módulos), JWT de verdade, Postgres como `macuxi_app` (RLS),
 * fixture dois-tenants num banco efêmero próprio do arquivo. O único simulado é o Conector on-premise (inject com os cabeçalhos
 * da ADR 0013, igual ao `tests/integracao/demo/ciclo-erp.test.ts`).
 *
 * Regras: RN-VEN-31 com a exceção da T-0114 (doc 03), RN-INT-08, RN-PRO-01 (regra 7). Contratos: `vendedor.pedido.cancelado@1`,
 * `integracao.cancelamento_erp@1`, `PedidosPendentes.cancelamentos` (aditivo na v1), `ConectorAtualizar.aceita_cancelamento`.
 * Matriz: docs/testes/T-0114.md (E1 a E6).
 *
 *  E3 sem aceite: pedido integrado → 422 RN-VEN-CANCELAR-APOS-ENVIO; nada vai ao ERP (sem evento, fila sem cancelamento).
 *  E4 perfil e tenant: o promotor nunca cancela (403, RN-PRO-01), nem com o aceite ligado; o vendedor de B não vê o pedido de A (404).
 *  E5 BKO: o admin liga `aceita_cancelamento` no Conector (PATCH /v1/integracao/conectores/:id), com auditoria do antes e do depois.
 *  E1 pedido ainda não entregue ao Conector: cancela (200 cancelled), sai da fila e nunca vira cancelamento ao ERP.
 *  E2 com aceite: pedido integrado → cancelamento solicitado (status mantido, 1 evento `enviado_ao_erp: true`) → o Hub marca
 *     `pendente` → o Conector de A recebe em `cancelamentos` (uma vez; tentativa 1) → retorno `cancelado` confirma → `cancelled`.
 *     Faturado nunca cancela no Macuxi, mesmo com o aceite.
 *  Idempotência: a repetição do POST não publica outro evento nem reinicia o cancelamento já entregue; o retorno repetido = `repetido`.
 *  Multi-tenant: o Conector de B (também com o aceite) não recebe o cancelamento de A; a fila de B não muda.
 *  E6 (offline, app) fica pendente: o botão do app e o pull com `erp_aceita_cancelamento` saem depois do build (entrega do Vendedor).
 *
 * Premissas da preparação (admin do banco efêmero, nunca o compartilhado):
 *  - Licença `integracao` no tenant e nos perfis admin e analista (RN-CORE-02), pela rota real do Core, em A e B.
 *  - O pedido p1 de A (vendedor-1) é posto em `integrated` com o número do ERP e a linha `integrado` na fila; o p2 de A
 *    (vendedor-2) em `approved` com a linha `pendente` (0 tentativas). Montar o ciclo completo de carga e envio já é o
 *    `ciclo-erp.test.ts`; aqui o foco é o cancelamento.
 *  - E2-V (o VENDEDOR cancela) e E2-BKO (o ANALISTA cancela) são casos separados no mesmo pedido: a consulta
 *    `integracao.cancelamento_erp@1` é chamada com a licença do USUÁRIO (`transacaoTenant`, padrão 'usuario'), e o módulo
 *    `integracao` só está nos perfis admin e analista (manifest). Se o vendedor não enxerga a consulta, a API cai no 422 e o
 *    E2-V falha — D-1, em `it.fails` até o lote seguinte (ADR 0025 + SDK); a cadeia do Hub segue provada pelo E2-BKO.
 *
 * Nenhuma data fixa contra o now() do banco. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { PedidosPendentes, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import { OrderDetail } from '@macuxi/vendedor/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const VERSAO_CONECTOR = '1.2.0';
const IP_A = '198.51.100.10';
/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP_B = '203.0.113.5';
const NUMERO_ERP = `PV-T0114-${randomUUID().slice(0, 6).toUpperCase()}`;
const MOTIVO = 'Cliente desistiu da compra';
const CODIGO_422 = 'RN-VEN-CANCELAR-APOS-ENVIO';

/** Conector on-premise simulado (cabeçalhos da ADR 0013), como em ciclo-erp.test.ts. */
function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string) {
  const cab = {
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
  };
  const chamar = (method: 'GET' | 'POST', url: string, payload?: object): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: cab, remoteAddress: ip, ...(payload ? { payload } : {}) });
  return {
    pendentes: async () => {
      const r = await chamar('GET', '/pedidos/pendentes?limite=100');
      expect(r.statusCode, r.body).toBe(200);
      return { bruto: r.json() as Record<string, unknown>, ...PedidosPendentes.parse(r.json()) };
    },
    retorno: (pedido: string, corpo: object) =>
      chamar('POST', `/pedidos/${pedido}/retorno`, { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedido, ocorrido_em: new Date().toISOString(), ...corpo }),
  };
}
type Conector = ReturnType<typeof conectorSimulado>;

describe.skipIf(semBanco())('T-0114 — cancelamento do pedido devolvido ao ERP (createApp real × Postgres × despachante, dois tenants)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let erpA: Conector;
  let erpB: Conector;
  const tk = { adminA: '', analistaA: '', vendedor1A: '', vendedor2A: '', promotorA: '', adminB: '', vendedorB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  const P1 = A.pedidos.p1; // vendedor-1, posto em integrated
  const P2 = A.pedidos.p2; // vendedor-2, posto em approved (fila pendente, nunca entregue)
  const P3 = A.pedidos.p3; // invoiced (fila faturado_parcial) — fixture

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  /** Eventos dos pedidos deste arquivo parados com falha (consumidor quebrando em silêncio). */
  const falhasDos = (ids: string[]) =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where agregado_id = any($1) and publicado_em is null and tentativas > 0', [ids]);
  const cancelados = (id: string) =>
    linhas<{ payload: Record<string, unknown> }>("select payload from plataforma.evento where agregado_id = $1 and nome = 'vendedor.pedido.cancelado@1'", [id]);
  const pedido = async (id: string) =>
    (await linhas<{ status: string; motivo_cancelamento: string | null }>('select status, motivo_cancelamento from vendedor.pedido where id = $1', [id]))[0];
  const fila = async (id: string) =>
    (
      await linhas<{ tenant_id: string; estado: string; deleted_at: Date | null; cancelamento_estado: string | null; cancelamento_motivo: string | null; cancelamento_tentativas: number }>(
        'select tenant_id, estado, deleted_at, cancelamento_estado, cancelamento_motivo, cancelamento_tentativas from integracao.pedido_fila_erp where pedido_uuid = $1',
        [id],
      )
    )[0];
  const cancelar = (token: string, id: string, motivo?: string) =>
    api.chamar(token, { method: 'POST', url: `/v1/vendedor/pedidos/${id}/cancelar`, payload: motivo === undefined ? {} : { motivo } });
  const ligarAceite = (token: string, conector: string, aceita: boolean) =>
    api.chamar(token, { method: 'PATCH', url: `/v1/integracao/conectores/${conector}`, payload: { aceita_cancelamento: aceita } });

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o cancelamento precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.analistaA = (await api.sessao('analista@exemplo.com.br', A)).access_token;
    tk.vendedor1A = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    tk.vendedor2A = (await api.sessao('vendedor2@exemplo.com.br', A)).access_token;
    tk.promotorA = (await api.sessao('promotor@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    for (const [t, token] of [[A, tk.adminA], [B, tk.adminB]] as const) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, `licença integracao em ${t.codigo}: ${r.body}`).toBe(200);
      for (const perfil of ['admin', 'analista']) {
        const rp = await licenca(api, token, 'perfil', 'integracao', true, perfil);
        expect(rp.statusCode, `licença integracao do perfil ${perfil} em ${t.codigo}: ${rp.body}`).toBe(200);
      }
    }
    // eventos antigos da fixture saem antes; lotes `recebido` sem staging não seguram nada (mesma premissa do ciclo-erp)
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    // p1: integrado no ERP; p2: aprovado, na fila e nunca entregue ao Conector
    await api.admin.query("update vendedor.pedido set status = 'integrated', numero_erp = $2, motivo_cancelamento = null where id = $1", [P1, NUMERO_ERP]);
    await api.admin.query(
      `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload, payload_origem, conector_id, enviado_em, tentativas, numero_erp, ultimo_retorno_em, aprovado_em)
       values ($1, $2, 'integrado', $3::jsonb, $4::jsonb, $5, now() - interval '50 minutes', 1, $6, now() - interval '40 minutes', now() - interval '1 hour')`,
      [A.tenantId, P1, JSON.stringify({ versao_contrato: 'v1', pedido_uuid: P1 }), JSON.stringify({ pedido_uuid: P1 }), A.integracao.conector, NUMERO_ERP],
    );
    await api.admin.query("update vendedor.pedido set status = 'approved' where id = $1", [P2]);
    await api.admin.query(
      `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload, payload_origem, tentativas, aprovado_em)
       values ($1, $2, 'pendente', $3::jsonb, $4::jsonb, 0, now())`,
      [A.tenantId, P2, JSON.stringify({ versao_contrato: 'v1', pedido_uuid: P2 }), JSON.stringify({ pedido_uuid: P2 })],
    );
    erpA = conectorSimulado(api, A, IP_A);
    erpB = conectorSimulado(api, B, IP_B);
  }, 240_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  describe('E3. Conector SEM o aceite (padrão): a regra de sempre (RN-VEN-31)', () => {
    it('vendedor e analista recebem 422 RN-VEN-CANCELAR-APOS-ENVIO no pedido integrado; status, motivo, evento e fila não mudam', async () => {
      expect((await linhas<{ aceita_cancelamento: boolean }>('select aceita_cancelamento from integracao.conector where id = $1', [A.integracao.conector]))[0]?.aceita_cancelamento).toBe(false);
      for (const token of [tk.vendedor1A, tk.analistaA]) {
        const r = await cancelar(token, P1, MOTIVO);
        expect(r.statusCode, r.body).toBe(422);
        expect(r.json()).toMatchObject({ codigo: CODIGO_422 });
      }
      expect(await pedido(P1)).toEqual({ status: 'integrated', motivo_cancelamento: null });
      expect(await cancelados(P1)).toEqual([]);
      await despachar();
      expect(await fila(P1)).toMatchObject({ estado: 'integrado', cancelamento_estado: null, deleted_at: null });
    });
  });

  describe('E4. Perfil errado e tenant errado', () => {
    it('RN-PRO-01 (regra 7): o promotor recebe 403 ao cancelar; nada muda', async () => {
      const r = await cancelar(tk.promotorA, P1, MOTIVO);
      expect(r.statusCode, r.body).toBe(403);
      expect(await pedido(P1)).toEqual({ status: 'integrated', motivo_cancelamento: null });
      expect(await cancelados(P1)).toEqual([]);
    });

    it('o vendedor de B não enxerga o pedido de A (404) e não toca nele', async () => {
      const r = await cancelar(tk.vendedorB, P1, MOTIVO);
      expect(r.statusCode, r.body).toBe(404);
      expect(await pedido(P1)).toEqual({ status: 'integrated', motivo_cancelamento: null });
    });

    it('o vendedor-2 (outra carteira) não cancela o pedido do vendedor-1', async () => {
      const r = await cancelar(tk.vendedor2A, P1, MOTIVO);
      expect([403, 404], r.body).toContain(r.statusCode);
      expect(await cancelados(P1)).toEqual([]);
    });
  });

  describe('E5. BKO: o admin liga o aceite do cancelamento no Conector', () => {
    it('PATCH /v1/integracao/conectores/:id { aceita_cancelamento: true } → 200, gravado e auditado (antes false, depois true); o vendedor não gerencia Conector', async () => {
      const negado = await ligarAceite(tk.vendedor1A, A.integracao.conector, true);
      expect([403, 404], negado.body).toContain(negado.statusCode);
      const r = await ligarAceite(tk.adminA, A.integracao.conector, true);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ aceita_cancelamento: true });
      expect((await linhas<{ aceita_cancelamento: boolean }>('select aceita_cancelamento from integracao.conector where id = $1', [A.integracao.conector]))[0]?.aceita_cancelamento).toBe(true);
      const aud = await linhas<{ antes: Record<string, unknown>; depois: Record<string, unknown> }>(
        'select antes, depois from plataforma.auditoria where tenant_id = $1 and entidade_id = $2 order by ocorrido_em desc limit 1',
        [A.tenantId, A.integracao.conector],
      );
      expect(aud[0]).toMatchObject({ antes: { aceita_cancelamento: false }, depois: { aceita_cancelamento: true } });
      // B também aceita: o caso multi-tenant prova que a entrega é por tenant, não por configuração
      const rb = await ligarAceite(tk.adminB, B.integracao.conector, true);
      expect(rb.statusCode, rb.body).toBe(200);
    });

    it('RN-PRO-01: mesmo com o aceite ligado, o promotor continua com 403 e nada é solicitado ao ERP', async () => {
      const r = await cancelar(tk.promotorA, P1, MOTIVO);
      expect(r.statusCode, r.body).toBe(403);
      expect(await pedido(P1)).toEqual({ status: 'integrated', motivo_cancelamento: null });
      expect(await cancelados(P1)).toEqual([]);
    });
  });

  describe('E1. Pedido ainda não entregue ao Conector: sai da fila (com ou sem aceite)', () => {
    it('o vendedor-2 cancela o aprovado → 200 cancelled; evento cancelado@1 com enviado_ao_erp false; a fila apaga a linha e o Conector nunca o recebe', async () => {
      const r = await cancelar(tk.vendedor2A, P2, 'Cliente pediu para não enviar');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ id: P2, status: 'cancelled' });
      const ev = await cancelados(P2);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ tenant_id: A.tenantId, pedido_id: P2, enviado_ao_erp: false });
      await despachar();
      expect(await falhasDos([P2])).toEqual([]);
      const f = await fila(P2);
      expect(f?.deleted_at, 'saiu da fila').not.toBeNull();
      expect(f?.cancelamento_estado, 'nunca vira cancelamento ao ERP').toBeNull();
      const p = await erpA.pendentes();
      expect(p.pedidos.map((x) => x.pedido_uuid)).not.toContain(P2);
      expect((p.cancelamentos ?? []).map((x) => x.pedido_uuid)).not.toContain(P2);
    });
  });

  describe('E2. Conector COM o aceite: pedido integrado → cancelamento solicitado → Conector → retorno cancelado', () => {
    // D-1: consulta pela licença do usuário; corrigido no lote seguinte (ADR 0025 + SDK).
    // `it.fails`: passa enquanto o vendedor receber o 422; quando o D-1 for corrigido, reprova e vira `it`.
    it.fails('[D-1 aberto] E2-V: o VENDEDOR da carteira cancela o integrado → 200 cancelamento_solicitado, status mantido (RN-VEN-31 com a exceção)', async () => {
      const r = await cancelar(tk.vendedor1A, P1, MOTIVO);
      expect(r.statusCode, `${r.body} — a consulta integracao.cancelamento_erp@1 usa a licença do usuário; o vendedor não tem o módulo integracao no perfil`).toBe(200);
      expect(r.json()).toMatchObject({ id: P1, status: 'integrated', cancelamento_solicitado: true });
    });

    it('E2-BKO: o analista cancela o integrado → 200 cancelamento_solicitado; status integrated, motivo gravado, 1 evento cancelado@1 com enviado_ao_erp true', async () => {
      const r = await cancelar(tk.analistaA, P1, MOTIVO);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ id: P1, status: 'integrated', cancelamento_solicitado: true });
      expect(await pedido(P1)).toEqual({ status: 'integrated', motivo_cancelamento: MOTIVO });
      const ev = await cancelados(P1);
      expect(ev, 'um evento só, mesmo se o E2-V também cancelou').toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ tenant_id: A.tenantId, pedido_id: P1, external_id: NUMERO_ERP, enviado_ao_erp: true, motivo: MOTIVO });
      const d = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/vendedor/pedidos/${P1}` });
      expect(d.statusCode, d.body).toBe(200);
      expect(OrderDetail.parse(d.json()).status, 'fica integrado até o ERP devolver cancelado').toBe('integrated');
    });

    it('idempotência no Vendedor: a repetição do POST devolve o mesmo resultado, sem evento novo nem troca do motivo', async () => {
      const r = await cancelar(tk.analistaA, P1, 'Outro motivo na repetição');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ id: P1, status: 'integrated', cancelamento_solicitado: true });
      expect(await cancelados(P1)).toHaveLength(1);
      expect((await pedido(P1))?.motivo_cancelamento).toBe(MOTIVO);
    });

    it('o despachante leva o evento ao Hub: a fila do p1 fica com cancelamento pendente e o motivo; sem falha de consumidor', async () => {
      await despachar();
      expect(await falhasDos([P1])).toEqual([]);
      expect(await fila(P1)).toMatchObject({ tenant_id: A.tenantId, estado: 'integrado', deleted_at: null, cancelamento_estado: 'pendente', cancelamento_motivo: MOTIVO, cancelamento_tentativas: 0 });
    });

    it('multi-tenant: o Conector de B (também com o aceite) não recebe o cancelamento de A; a fila de B segue sem cancelamento', async () => {
      const p = await erpB.pendentes();
      expect((p.cancelamentos ?? []).map((x) => x.pedido_uuid)).not.toContain(P1);
      expect(await fila(P1)).toMatchObject({ cancelamento_estado: 'pendente', cancelamento_tentativas: 0 });
      expect(await linhas('select 1 from integracao.pedido_fila_erp where tenant_id = $1 and cancelamento_estado is not null', [B.tenantId])).toEqual([]);
    });

    it('GET /pedidos/pendentes do Conector de A traz o p1 em cancelamentos (número do ERP, motivo, tentativa 1) e passa a enviado; a próxima consulta não repete', async () => {
      const p = await erpA.pendentes();
      const c = (p.cancelamentos ?? []).find((x) => x.pedido_uuid === P1);
      expect(c, JSON.stringify(p.bruto)).toBeDefined();
      expect(c).toMatchObject({ pedido_uuid: P1, numero_erp: NUMERO_ERP, motivo: MOTIVO, tentativa: 1 });
      expect(p.pedidos.map((x) => x.pedido_uuid), 'o pedido em si não é reenviado').not.toContain(P1);
      expect(await fila(P1)).toMatchObject({ cancelamento_estado: 'enviado', cancelamento_tentativas: 1 });
      const p2 = await erpA.pendentes();
      expect((p2.cancelamentos ?? []).map((x) => x.pedido_uuid), 'antes dos 10 min não reentrega').not.toContain(P1);
    });

    it('idempotência no Hub: o vendedor repete o cancelamento depois da entrega → nada é reiniciado (tentativas e estado iguais, sem evento novo)', async () => {
      const r = await cancelar(tk.analistaA, P1, MOTIVO);
      expect(r.statusCode, r.body).toBe(200);
      await despachar();
      expect(await cancelados(P1)).toHaveLength(1);
      expect(await fila(P1)).toMatchObject({ cancelamento_estado: 'enviado', cancelamento_tentativas: 1 });
    });

    it('o Conector confirma pelo retorno cancelado (repetido = idempotente) → fila cancelado/confirmado → o pedido vira cancelled no Vendedor', async () => {
      const r = await erpA.retorno(P1, { status: 'cancelado', numero_erp: NUMERO_ERP, motivo: 'Cancelado no ERP a pedido do Macuxi' });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ pedido_uuid: P1, status: 'cancelado', repetido: false });
      const r2 = await erpA.retorno(P1, { status: 'cancelado', numero_erp: NUMERO_ERP, motivo: 'Cancelado no ERP a pedido do Macuxi' });
      expect(r2.statusCode, r2.body).toBe(200);
      expect(r2.json()).toMatchObject({ repetido: true });
      await despachar();
      expect(await falhasDos([P1])).toEqual([]);
      expect(await fila(P1)).toMatchObject({ estado: 'cancelado', cancelamento_estado: 'confirmado' });
      expect((await pedido(P1))?.status).toBe('cancelled');
      const d = await api.chamar(tk.vendedor1A, { method: 'GET', url: `/v1/vendedor/pedidos/${P1}` });
      expect(d.statusCode, d.body).toBe(200);
      expect(OrderDetail.parse(d.json()).status).toBe('cancelled');
      const p = await erpA.pendentes();
      expect((p.cancelamentos ?? []).map((x) => x.pedido_uuid), 'confirmado não sai mais').not.toContain(P1);
    });

    it('depois de confirmado, cancelar de novo é idempotente (200 cancelled, sem evento novo)', async () => {
      const r = await cancelar(tk.vendedor1A, P1, MOTIVO);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ id: P1, status: 'cancelled' });
      expect(await cancelados(P1)).toHaveLength(1);
    });

    it('faturado nunca cancela no Macuxi, mesmo com o aceite: 422 e a fila do p3 não muda', async () => {
      const r = await cancelar(tk.analistaA, P3, MOTIVO);
      expect(r.statusCode, r.body).toBe(422);
      expect(r.json()).toMatchObject({ codigo: CODIGO_422 });
      expect(await cancelados(P3)).toEqual([]);
      expect(await fila(P3)).toMatchObject({ estado: 'faturado_parcial', cancelamento_estado: null });
    });
  });
});
