/**
 * v1.0.35 (S11, item 1) — teto de prazo médio do cliente (RN-VEN-25, ADR 0072) também no web (BKO e Gestor web), com a API
 * REAL (createApp × Postgres × fixture dois-tenants, PAGAMENTO_FIXTURE). O web manda `x-macuxi-app: web/<VERSAO_WEB>`
 * (`valorCabecalhoWeb()` do SDK); a API aplica o teto para a versão >= 1.0.34 (`aplicaTetoDoCliente`).
 *
 * Critérios: (1) as formas e os prazos que o A.c1 aceita com o cabeçalho do web são os da regra (formas do cliente e prazo médio
 * <= teto 45), calculados no teste a partir do GET /v1/vendedor/formas-pagamento; (2) prazo acima do teto é recusado como no app
 * campo/1.0.34 (push e edição do orçamento); (3) sem cabeçalho, o comportamento antigo (sem teto).
 */
import { PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { CABECALHO_APP, valorCabecalhoWeb, type ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';

const id = (n: number) => `0f103500-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PED = { webAcima: id(1), appAcima: id(2), orcamento: id(4) } as const;
/** Um pedido por prazo ativo do tenant A no critério (1): ids 101.. na ordem do GET. */
const idDoPrazo = (i: number) => id(101 + i);
const PA = PAGAMENTO_FIXTURE.A;

const WEB = { [CABECALHO_APP]: valorCabecalhoWeb() };
const APP_COM_TETO = { [CABECALHO_APP]: 'campo/1.0.34' };

type Linha = Record<string, unknown>;
type Forma = { id: string; codigo: string; ativo: boolean };
type Prazo = { id: string; forma_pagamento_id: string; codigo: string; prazo_medio_dias: number; ativo: boolean };

describe.skipIf(semBanco())('v1.0.35 — teto de prazo médio do cliente com o cabeçalho do web (RN-VEN-25, createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', analista: '' };
  let prodA = '';
  let idsDosPrazos: string[] = [];

  const q = async <T extends pg.QueryResultRow = Linha>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const push = async (itens: object[], headers: Record<string, string> = {}): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk.vendedor, { method: 'POST', url: '/v1/sync/push', headers, payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const corpo = (forma: string, prazo: string, extra: Linha = {}): Linha => ({
    customer_id: A.clientes.c1,
    discount_pct: 0,
    items: [{ product_id: prodA, quantity: 1 }],
    forma_pagamento_id: forma,
    prazo_pagamento_id: prazo,
    ...extra,
  });
  const pedido = (pid: string, forma: string, prazo: string, extra: Linha = {}) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, created_offline_at: new Date().toISOString(), ...corpo(forma, prazo, extra) },
  });
  const linha = async (pid: string) => (await q('select * from vendedor.pedido where id = $1', [pid]))[0];
  const nadaGravado = async (pid: string) => expect(await q('select 1 from vendedor.pedido where id = $1', [pid]), `pedido ${pid} não pode existir`).toEqual([]);
  const limpar = async () => {
    const ids = [...Object.values(PED), ...idsDosPrazos];
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('update vendedor.pedido set orcamento_id = null where orcamento_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from plataforma.evento where agregado_id = any($1::uuid[])', [ids]).catch(() => undefined);
  };

  beforeAll(async () => {
    api = await subirApi();
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    idsDosPrazos = Array.from({ length: 50 }, (_, i) => idDoPrazo(i));
    await limpar();
    expect((await q('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1', [A.clientes.c1]))[0], 'fixture do A.c1').toEqual({
      prazo_medio_max_dias: 45,
      formas_pagamento: ['PIX', 'BOLETO'],
    });
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await limpar().catch(() => undefined);
    await api.fechar();
  });

  it('W1. (critério 1) com o cabeçalho do web, as formas e os prazos aceitos para o A.c1 são exatamente os da regra: formas do cliente (PIX, BOLETO) e prazo médio <= 45 (PIX-AV e BOL-28-56); AVISTA e BOL-30-60-90 recusados com RN-VEN-25', async () => {
    const r = await api.chamar(tk.analista, { method: 'GET', url: '/v1/vendedor/formas-pagamento', headers: WEB });
    expect(r.statusCode, r.body).toBe(200);
    const { formas, prazos } = r.json() as { formas: Forma[]; prazos: Prazo[] };
    const formaDe = new Map(formas.map((f) => [f.id, f]));
    const ativos = prazos.filter((p) => p.ativo && formaDe.get(p.forma_pagamento_id)?.ativo);
    expect(ativos.length, 'prazos ativos do tenant A').toBeLessThanOrEqual(idsDosPrazos.length);
    // esperado pela regra (RN-VEN-25): forma aceita pelo cliente e prazo médio até o teto (igual vale)
    const cliente = (await q<{ prazo_medio_max_dias: number; formas_pagamento: string[] }>('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1', [A.clientes.c1]))[0]!;
    const esperado = ativos
      .filter((p) => cliente.formas_pagamento.includes(formaDe.get(p.forma_pagamento_id)!.codigo) && Number(p.prazo_medio_dias) <= cliente.prazo_medio_max_dias)
      .map((p) => p.codigo)
      .sort();
    expect(esperado, 'a regra sobre a fixture').toEqual(['BOL-28-56', 'PIX-AV']);

    const resultados = await push(
      ativos.map((p, i) => pedido(idDoPrazo(i), p.forma_pagamento_id, p.id)),
      WEB,
    );
    const aceitos = ativos.filter((_, i) => resultados.find((x) => x.id === idDoPrazo(i))?.status === 'aceito').map((p) => p.codigo).sort();
    expect(aceitos, JSON.stringify(resultados)).toEqual(esperado);
    for (const [i, p] of ativos.entries()) {
      if (esperado.includes(p.codigo)) continue;
      expect(resultados.find((x) => x.id === idDoPrazo(i)), `${p.codigo} recusado`).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-25' });
      await nadaGravado(idDoPrazo(i));
    }
    expect(ativos.map((p) => p.codigo), 'a fixture cobre a forma fora do cliente e o prazo acima do teto').toEqual(expect.arrayContaining(['AVISTA', 'BOL-30-60-90']));
  });

  it('W2. (critério 2) BOLETO 30/60/90 (60 > 45) com o cabeçalho do web: recusado igual ao app campo/1.0.34 (mesmo código e mesma mensagem); nada gravado', async () => {
    const [web] = await push([pedido(PED.webAcima, PA.formas.boleto, PA.prazos.bol306090)], WEB);
    const [app] = await push([pedido(PED.appAcima, PA.formas.boleto, PA.prazos.bol306090)], APP_COM_TETO);
    expect(web, JSON.stringify(web)).toMatchObject({ id: PED.webAcima, status: 'rejeitado', codigo: 'RN-VEN-25', mensagem: 'Este prazo passa do prazo médio do cliente. Escolha um prazo menor.' });
    const recusa = (x: ResultadoItemPush | undefined) => {
      const { status, codigo, mensagem } = (x ?? {}) as Linha;
      return { status, codigo, mensagem };
    };
    expect(recusa(web), 'web igual ao app >= 1.0.34').toEqual(recusa(app));
    await nadaGravado(PED.webAcima);
    await nadaGravado(PED.appAcima);
  });

  it('W3. (critérios 2 e 3) orçamento: criado com BOL-28-56 pelo web; a edição pelo web para 30/60/90 → 422 RN-VEN-25 e nada muda; a mesma edição sem cabeçalho → 200 (sem teto)', async () => {
    const [r] = await push([pedido(PED.orcamento, PA.formas.boleto, PA.prazos.bol2856, { tipo: 'orcamento' })], WEB);
    expect(r, JSON.stringify(r)).toMatchObject({ id: PED.orcamento, status: 'aceito' });
    const atualizado = async () => (await q<{ a: string }>(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as a from vendedor.pedido where id = $1`, [PED.orcamento]))[0]!.a;
    const editar = async (headers: Record<string, string>) =>
      api.chamar(tk.vendedor, { method: 'PUT', url: `/v1/vendedor/orcamentos/${PED.orcamento}`, headers, payload: { ...corpo(PA.formas.boleto, PA.prazos.bol306090), atualizado_em: await atualizado() } });
    const web = await editar(WEB);
    expect(web.statusCode, web.body).toBe(422);
    expect(erroDe(web).codigo).toBe('RN-VEN-25');
    expect((await linha(PED.orcamento))!).toMatchObject({ tipo: 'orcamento', prazo_codigo: 'BOL-28-56', prazo_medio_dias: 42 });
    const sem = await editar({});
    expect(sem.statusCode, sem.body).toBe(200);
    expect((await linha(PED.orcamento))!).toMatchObject({ tipo: 'orcamento', prazo_codigo: 'BOL-30-60-90', prazo_medio_dias: 60 });
  });
});
