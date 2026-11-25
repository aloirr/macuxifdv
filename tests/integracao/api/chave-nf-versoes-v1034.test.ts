/**
 * v1.0.34 (R-20261124-184958-alexandre; RN-INT-08, RN-INT-09, ADR 0072) — chave de acesso da NF e versões de entrada fixas,
 * ponta a ponta. API REAL: `createApp` (8 módulos), Conector simulado (cabeçalhos da ADR 0013) em `/integracao/v1`, despachante
 * real da outbox (`macuxi_worker`), consumidor do Vendedor (`retorno-erp.ts`) e o detalhe do pedido no BKO, em Postgres com RLS
 * (fixture dois-tenants, banco efêmero do arquivo). Agente `testes`.
 *
 *  B1 RN-INT-09: a entrada aceita sempre VERSOES_CONTRATO_ENTRADA (v1 e v2), sem parâmetro do tenant. A chave camelCase
 *     `versoesSuportadas` nunca pôde ser gravada em `plataforma.parametro` (constraint `parametro_chave_formato`, 0001): o teste
 *     prova a recusa do banco SEM soltar a constraint e grava a forma que o banco aceita (`versoes_suportadas` = ['v1']); o lote
 *     v2 continua aceito e a v3 continua recusada (422 versao_nao_suportada), ou seja: a lista é a do contrato, não do parâmetro.
 *  C1 chave com 43 dígitos → 400 apontando `nota.chave_acesso`; nada muda (fila, faturamento, nenhum evento retorno_erp@1).
 *  C2 sem chave → 200; o Vendedor grava a nota com `nota_chave_acesso` nulo e o detalhe traz `chave_acesso: null`.
 *  C3 com 44 dígitos → o evento `integracao.pedido.retorno_erp@1` leva `nota.chave_acesso`; o Vendedor grava em
 *     `vendedor.pedido_faturamento.nota_chave_acesso`; `GET /v1/vendedor/pedidos/:id` traz `faturamento.notas[].chave_acesso`.
 *  C4 o mesmo retorno (número + série) com OUTRA chave → `repetido: true`, sem evento novo e sem regravar a chave.
 *  MT o tenant B não vê a chave de A (detalhe 404, RLS no faturamento e no evento) e o Conector de B não grava no pedido de A.
 *
 * Premissa: os pedidos p1 e p2 de A são postos em `integrated` com a linha `integrado` na fila (mesma montagem do T-0114); o
 * faturamento sem `itens_faturados` fatura o pedido cheio (RN-INT-08). Nenhuma data fixa contra o now() do banco.
 */
import { createHash, randomUUID } from 'node:crypto';
import { comTenant, PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteResultado, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
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
const SUF = randomUUID().slice(0, 4).toUpperCase();
const NUMERO_ERP = { p1: `PV-NF1-${SUF}`, p2: `PV-NF2-${SUF}` } as const;
const CHAVE = '13261104252011000110550010000088551234567890';
const OUTRA_CHAVE = '13261104252011000110550010000088559999999999';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string) {
  const cab = {
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
  };
  const chamar = (method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: { ...cab, ...extra }, remoteAddress: ip, ...(payload ? { payload } : {}) });
  return {
    chamar,
    retorno: (pedido: string, corpo: object) =>
      chamar('POST', `/pedidos/${pedido}/retorno`, { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedido, ocorrido_em: new Date().toISOString(), ...corpo }),
    lote: (versao: string, registros: object[]) => {
      const corpo = { versao_contrato: versao, entidade: 'forma_pagamento', modo: 'delta', conector_id: t.integracao.identificador, versao_conector: VERSAO_CONECTOR, enviado_em: new Date().toISOString(), registros };
      return chamar('POST', '/lotes', corpo, { 'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })) });
    },
  };
}
type Conector = ReturnType<typeof conectorSimulado>;

describe.skipIf(semBanco())('v1.0.34 — chave da NF no retorno do ERP e versões de entrada fixas (createApp × despachante × Postgres, dois tenants)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let erpA: Conector;
  let erpB: Conector;
  const tk = { analistaA: '', vendedorB: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  const P1 = A.pedidos.p1;
  const P2 = A.pedidos.p2;

  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
    for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 60 ciclos');
  };
  const falhasDos = (ids: string[]) =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where agregado_id = any($1) and publicado_em is null and tentativas > 0', [ids]);
  const eventosRetorno = (id: string) =>
    linhas<{ payload: { nota?: { numero?: string; chave_acesso?: string | null } | null } }>(
      "select payload from plataforma.evento where agregado_id = $1 and nome = 'integracao.pedido.retorno_erp@1' order by created_at",
      [id],
    );
  const faturamentos = (id: string) =>
    linhas<{ tenant_id: string; nota_numero: string; nota_chave_acesso: string | null }>(
      'select tenant_id, nota_numero, nota_chave_acesso from vendedor.pedido_faturamento where pedido_id = $1 and deleted_at is null order by created_at',
      [id],
    );
  const fila = async (id: string) =>
    (await linhas<{ estado: string; nota_numero: string | null }>('select estado, nota_numero from integracao.pedido_fila_erp where pedido_uuid = $1', [id]))[0];
  const detalhe = (token: string, id: string) => api.chamar(token, { method: 'GET', url: `/v1/vendedor/pedidos/${id}` });
  const notasDoDetalhe = (r: LightMyRequestResponse) =>
    ((r.json() as { faturamento?: { notas?: { numero: string; chave_acesso?: string | null }[] } | null }).faturamento?.notas ?? []).map((n) => ({
      numero: n.numero,
      chave_acesso: n.chave_acesso,
    }));
  const faturado = (numero: string, numeroErp: string, chave?: string | null) => ({
    status: 'faturado_total',
    numero_erp: numeroErp,
    nota: { numero, serie: '1', emitida_em: new Date(Date.now() - 60_000).toISOString(), total_cents: 10_000, ...(chave === undefined ? {} : { chave_acesso: chave }) },
  });

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o retorno precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    const adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.analistaA = (await api.sessao('analista@exemplo.com.br', A)).access_token;
    const adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    for (const [t, token] of [[A, adminA], [B, adminB]] as const) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, `licença integracao em ${t.codigo}: ${r.body}`).toBe(200);
    }
    await api.admin.query("update integracao.conector set entidades = array_append(entidades, 'forma_pagamento') where tenant_id = $1 and not ('forma_pagamento' = any(entidades))", [A.tenantId]);
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    for (const [id, numero] of [[P1, NUMERO_ERP.p1], [P2, NUMERO_ERP.p2]] as const) {
      await api.admin.query("update vendedor.pedido set status = 'integrated', numero_erp = $2 where id = $1", [id, numero]);
      await api.admin.query(
        `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload, payload_origem, conector_id, enviado_em, tentativas, numero_erp, ultimo_retorno_em, aprovado_em)
         values ($1, $2, 'integrado', $3::jsonb, $4::jsonb, $5, now() - interval '50 minutes', 1, $6, now() - interval '40 minutes', now() - interval '1 hour')`,
        [A.tenantId, id, JSON.stringify({ versao_contrato: 'v1', pedido_uuid: id }), JSON.stringify({ pedido_uuid: id }), A.integracao.conector, numero],
      );
    }
    erpA = conectorSimulado(api, A, IP_A);
    erpB = conectorSimulado(api, B, IP_B);
  }, 300_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  describe('B1. RN-INT-09 / ADR 0072: versões de entrada fixas no contrato', () => {
    it('a chave camelCase versoesSuportadas não cabe em plataforma.parametro (parametro_chave_formato): nenhum tenant a tem gravada', async () => {
      const erro = await api.admin
        .query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'integracao', 'versoesSuportadas', '[\"v1\"]'::jsonb)", [A.tenantId])
        .then(() => null, (e: { code?: string; constraint?: string }) => e);
      expect(erro, 'o banco recusa a chave camelCase').toMatchObject({ code: '23514', constraint: 'parametro_chave_formato' });
      expect(await linhas("select 1 from plataforma.parametro where modulo = 'integracao' and lower(chave) in ('versoessuportadas', 'versoes_suportadas')")).toEqual([]);
    });

    it("com versoes_suportadas = ['v1'] gravado em A, o lote v2 é aceito (202, sem erro) e a v3 segue recusada (422 versao_nao_suportada): a lista é a do contrato", async () => {
      await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'integracao', 'versoes_suportadas', '[\"v1\"]'::jsonb)", [A.tenantId]);
      const r = await erpA.lote('v2', [{ external_id: `FP-V2-${SUF}`, alterado_em: new Date(Date.now() - 120_000).toISOString(), codigo: `V2${SUF}`, nome: 'Forma v2', ordem: 9 }]);
      expect(r.statusCode, r.body).toBe(202);
      await despachar();
      const loteId = (r.json() as { lote_id: string }).lote_id;
      const c = await erpA.chamar('GET', `/lotes/${loteId}`);
      expect(c.statusCode, c.body).toBe(200);
      const res = LoteResultado.parse(c.json());
      expect(res.erros, JSON.stringify(res.erros)).toEqual([]);
      expect(res.contagens).toMatchObject({ recebidas: 1, com_erro: 0 });

      const v3 = await erpA.lote('v3', [{ external_id: `FP-V3-${SUF}`, alterado_em: new Date().toISOString(), codigo: `V3${SUF}`, nome: 'Forma v3', ordem: 9 }]);
      expect(v3.statusCode, v3.body).toBe(422);
      expect(v3.json()).toMatchObject({ codigo: 'versao_nao_suportada' });
    });
  });

  describe('C. RN-INT-08: chave de acesso da NF-e no retorno do pedido', () => {
    it('C1. chave com 43 dígitos → 400 no campo nota.chave_acesso; fila, faturamento e eventos não mudam', async () => {
      const r = await erpA.retorno(P1, faturado(`NF1-${SUF}`, NUMERO_ERP.p1, CHAVE.slice(0, 43)));
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json()).toMatchObject({
        codigo: 'requisicao_invalida',
        detalhes: { problemas: [{ caminho: 'corpo.nota.chave_acesso', mensagem: expect.stringContaining('44 dígitos') }] },
      });
      expect(await fila(P1)).toEqual({ estado: 'integrado', nota_numero: null });
      expect(await eventosRetorno(P1)).toEqual([]);
      await despachar();
      expect(await faturamentos(P1)).toEqual([]);
    });

    it('C2. sem chave → 200; o Vendedor grava a nota com a chave nula e o detalhe traz chave_acesso null', async () => {
      const r = await erpA.retorno(P2, faturado(`NF2-${SUF}`, NUMERO_ERP.p2));
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ status: 'faturado_total', repetido: false });
      await despachar();
      expect(await falhasDos([P2])).toEqual([]);
      expect(await faturamentos(P2)).toEqual([{ tenant_id: A.tenantId, nota_numero: `NF2-${SUF}`, nota_chave_acesso: null }]);
      const d = await detalhe(tk.analistaA, P2);
      expect(d.statusCode, d.body).toBe(200);
      expect(notasDoDetalhe(d)).toEqual([{ numero: `NF2-${SUF}`, chave_acesso: null }]);
    });

    it('C3. 44 dígitos → evento retorno_erp@1 com nota.chave_acesso; vendedor.pedido_faturamento.nota_chave_acesso; GET do pedido com faturamento.notas[].chave_acesso', async () => {
      const r = await erpA.retorno(P1, faturado(`NF1-${SUF}`, NUMERO_ERP.p1, CHAVE));
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ status: 'faturado_total', repetido: false });
      const ev = await eventosRetorno(P1);
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload.nota).toMatchObject({ numero: `NF1-${SUF}`, chave_acesso: CHAVE });
      await despachar();
      expect(await falhasDos([P1])).toEqual([]);
      expect(await faturamentos(P1)).toEqual([{ tenant_id: A.tenantId, nota_numero: `NF1-${SUF}`, nota_chave_acesso: CHAVE }]);
      const d = await detalhe(tk.analistaA, P1);
      expect(d.statusCode, d.body).toBe(200);
      expect(notasDoDetalhe(d)).toEqual([{ numero: `NF1-${SUF}`, chave_acesso: CHAVE }]);
    });

    it('C4. o mesmo retorno (número + série) com outra chave → repetido, sem evento novo e sem regravar a chave', async () => {
      const r = await erpA.retorno(P1, faturado(`NF1-${SUF}`, NUMERO_ERP.p1, OUTRA_CHAVE));
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ repetido: true });
      expect(await eventosRetorno(P1)).toHaveLength(1);
      await despachar();
      expect(await faturamentos(P1)).toEqual([{ tenant_id: A.tenantId, nota_numero: `NF1-${SUF}`, nota_chave_acesso: CHAVE }]);
    });
  });

  describe('MT. Multi-tenant: B não vê nem grava a chave de A', () => {
    it('detalhe do pedido de A por B = 404; RLS esconde faturamento e evento de A no contexto de B', async () => {
      const d = await detalhe(tk.vendedorB, P1);
      expect(d.statusCode, d.body).toBe(404);
      expect(d.body).not.toContain(CHAVE);
      const deB = await comTenant(api.pool, B.tenantId, async (c) => ({
        fat: (await c.query("select 1 from vendedor.pedido_faturamento where nota_chave_acesso = $1", [CHAVE])).rows,
        ev: (await c.query("select 1 from plataforma.evento where payload->'nota'->>'chave_acesso' = $1", [CHAVE])).rows,
      }));
      expect(deB).toEqual({ fat: [], ev: [] });
    });

    it('o Conector de B não grava chave no pedido de A: 422 pedido_desconhecido e nada muda em A', async () => {
      const r = await erpB.retorno(P1, faturado(`NF-B-${SUF}`, NUMERO_ERP.p1, OUTRA_CHAVE));
      expect(r.statusCode, r.body).toBe(422);
      expect(r.json()).toMatchObject({ codigo: 'pedido_desconhecido' });
      expect(await eventosRetorno(P1)).toHaveLength(1);
      await despachar();
      expect(await faturamentos(P1)).toEqual([{ tenant_id: A.tenantId, nota_numero: `NF1-${SUF}`, nota_chave_acesso: CHAVE }]);
    });
  });
});
