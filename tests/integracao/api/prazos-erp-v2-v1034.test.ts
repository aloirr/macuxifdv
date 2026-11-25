/**
 * v1.0.34 — ADR 0072 (R-20261124-111421-alexandre; RN-VEN-24, RN-VEN-25, RN-INT-09): prazo de pagamento do ERP com prazo médio
 * digitado, fim a fim. API REAL: `createApp`, Conector simulado em `POST /integracao/v1/lotes`, despachante real da outbox
 * (`macuxi_worker`), consumidor do Vendedor (`formas-erp.ts`) e o push do pedido, em Postgres com RLS (fixture dois-tenants,
 * banco efêmero do arquivo). Agente `testes`.
 *
 * Valor × regra: o prazo médio que o pedido usa (retrato e teto do cliente) é o RECEBIDO na v2 (40 em 28/56), não o calculado (42).
 * A validação por campo da v2 já tem teste de unidade (modules/integracao/domain/prazo-v2.test.ts); aqui cada código de recusa
 * passa uma vez pelo lote real, para provar que nada chega ao Vendedor.
 * O teto do cliente só vale para o app v1.0.34 em diante (cabeçalho `x-macuxi-app`): o push dos T leva `campo/1.0.34`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { comTenant, PAGAMENTO_FIXTURE, PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteResultado } from '@macuxi/integracao/contracts';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const IP_A = '198.51.100.10';
const VERSAO_CONECTOR = '1.2.0';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const PA = PAGAMENTO_FIXTURE.A;
/** Forma BOLETO de A na fixture (external_id FP-BOL). */
const FORMA_EXT = 'FP-BOL';
const SUF = randomUUID().slice(0, 4).toUpperCase();
const EXT = { v2: `PZ-V2-${SUF}`, v1Sem: `PZ-V1S-${SUF}`, v1Div: `PZ-V1D-${SUF}`, v1Fora: `PZ-V1F-${SUF}` } as const;
const PED = { teto40: randomUUID(), teto41: randomUUID(), teto39: randomUUID() } as const;

type Linha = Record<string, unknown>;

describe.skipIf(semBanco())('v1.0.34 ADR 0072 — prazo do ERP: contrato v2 no Hub, prazo médio recebido no Vendedor e teto do cliente (createApp × despachante)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  let relogioErp = Date.now() - 30 * 60_000;
  const alterado = () => new Date((relogioErp += 1_000)).toISOString();
  let vendedor = '';
  let prodA = '';

  const q = async <T extends pg.QueryResultRow = Linha>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
    for (let i = 0; i < 80; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 80 ciclos');
  };
  const parados = () =>
    q<{ nome: string; external_id: string; ultimo_erro: string | null }>(
      "select nome, payload->>'external_id' as external_id, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0 and payload->>'external_id' like $2",
      [A.tenantId, `%-${SUF}`],
    );
  const cabecalhos = () => ({
    authorization: `Bearer ${A.integracao.chave.chave}`,
    'x-macuxi-conector-id': A.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
  });
  const enviar = async (versao: 'v1' | 'v2', registros: object[], entidade: 'prazo_pagamento' | 'forma_pagamento' = 'prazo_pagamento') => {
    const corpo = { versao_contrato: versao, entidade, modo: 'delta', conector_id: A.integracao.identificador, versao_conector: VERSAO_CONECTOR, enviado_em: new Date().toISOString(), registros };
    const r = await api.app.inject({
      method: 'POST',
      url: '/integracao/v1/lotes',
      headers: { ...cabecalhos(), 'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })) },
      remoteAddress: IP_A,
      payload: corpo,
    });
    expect(r.statusCode, r.body).toBe(202);
    await despachar();
    const loteId = (r.json() as { lote_id: string }).lote_id;
    const c = await api.app.inject({ method: 'GET', url: `/integracao/v1/lotes/${loteId}`, headers: cabecalhos(), remoteAddress: IP_A });
    expect(c.statusCode, c.body).toBe(200);
    return LoteResultado.parse(c.json());
  };
  const prazo = (external_id: string, extra: Linha = {}): Linha => ({
    external_id,
    alterado_em: alterado(),
    forma_external_id: FORMA_EXT,
    codigo: external_id,
    descricao: 'Boleto 28 e 56 (ERP)',
    parcelas_dias: [28, 56],
    prazo_medio_dias: 40,
    ...extra,
  });
  const gravado = async (external_id: string) =>
    (
      await q<{ id: string; descricao: string; prazo_medio_dias: number; parcelas_dias: number[]; forma_pagamento_id: string }>(
        'select id, descricao, prazo_medio_dias, parcelas_dias, forma_pagamento_id from vendedor.prazo_pagamento where tenant_id = $1 and external_id = $2 and deleted_at is null',
        [A.tenantId, external_id],
      )
    )[0];
  const pushPedido = async (pid: string, prazoId: string): Promise<ResultadoItemPush | undefined> => {
    const payload = { id: pid, created_offline_at: new Date().toISOString(), customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: prodA, quantity: 1 }], forma_pagamento_id: PA.formas.boleto, prazo_pagamento_id: prazoId };
    const r = await api.chamar(vendedor, { method: 'POST', url: '/v1/sync/push', headers: { 'x-macuxi-app': 'campo/1.0.34' }, payload: { itens: [{ entidade: 'pedido', id: pid, operacao: 'upsert', payload }] } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados[0];
  };
  const teto = (dias: number | null) => q('update core.cliente set prazo_medio_max_dias = $2 where id = $1', [A.clientes.c1, dias]);

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o Hub precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    const adm = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    expect((await licenca(api, adm, 'tenant', 'integracao', true)).statusCode).toBe(200);
    // a fixture não habilita formas e prazos no Conector de A (8 entidades)
    for (const e of ['forma_pagamento', 'prazo_pagamento']) {
      await api.admin.query('update integracao.conector set entidades = array_append(entidades, $2::text) where tenant_id = $1 and not ($2 = any(entidades))', [A.tenantId, e]);
    }
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    // o Hub só aceita o prazo cuja forma já passou por ele (referencia_ausente): a BOLETO da fixture (FP-BOL) vem do ERP, igual
    const forma = await enviar('v2', [{ external_id: FORMA_EXT, alterado_em: alterado(), codigo: 'BOLETO', nome: 'Boleto', ordem: 2 }], 'forma_pagamento');
    expect(forma.erros, JSON.stringify(forma.erros)).toEqual([]);
    vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
  }, 300_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    if (api) await teto(45).catch(() => undefined);
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  it('H1. RN-VEN-24 (v2): prazo 28/56 com prazo médio digitado 40 e descrição do ERP entra sem aviso; o Vendedor grava 40 (não 42) e a descrição recebida; B não vê o prazo de A', async () => {
    const lote = await enviar('v2', [prazo(EXT.v2)]);
    expect(lote.erros, JSON.stringify(lote.erros)).toEqual([]);
    expect(lote.avisos, 'na v2 não há prazo_medio_divergente').toEqual([]);
    expect(lote.contagens).toMatchObject({ recebidas: 1, novas: 1, com_erro: 0 });
    expect(await parados(), 'nenhum evento parado na outbox').toEqual([]);
    const g = await gravado(EXT.v2);
    expect(g, 'prazo gravado no Vendedor').toBeDefined();
    expect(g!).toMatchObject({ descricao: 'Boleto 28 e 56 (ERP)', prazo_medio_dias: 40, forma_pagamento_id: PA.formas.boleto });
    expect(g!.parcelas_dias.map(Number)).toEqual([28, 56]);
    const deB = await comTenant(api.pool, B.tenantId, (c) => c.query('select 1 from vendedor.prazo_pagamento where external_id = $1', [EXT.v2]));
    expect(deB.rows, 'RLS: o prazo de A não aparece para B').toEqual([]);
  }, 120_000);

  it('H2. RN-VEN-24 (v2): recusa por campo no lote real (campo_obrigatorio, tipo_invalido, valor_fora_da_faixa, regra_invalida), não reprocessável, e nada chega ao Vendedor', async () => {
    const semDescricao = prazo(`PZ-E1-${SUF}`);
    delete semDescricao.descricao;
    const lote = await enviar('v2', [
      semDescricao,
      prazo(`PZ-E2-${SUF}`, { prazo_medio_dias: null }),
      prazo(`PZ-E3-${SUF}`, { prazo_medio_dias: '40' }),
      prazo(`PZ-E4-${SUF}`, { prazo_medio_dias: 400 }),
      prazo(`PZ-E5-${SUF}`, { prazo_medio_dias: 20 }),
    ]);
    expect(lote.status, 'todas as linhas inválidas: o lote não conclui limpo').not.toBe('concluido');
    expect(lote.contagens).toMatchObject({ recebidas: 5, com_erro: 5, novas: 0 });
    const porExt = Object.fromEntries(lote.erros.map((e) => [e.external_id, { campo: e.campo, codigo: e.codigo, reprocessavel: e.reprocessavel }]));
    expect(porExt).toEqual({
      [`PZ-E1-${SUF}`]: { campo: 'descricao', codigo: 'campo_obrigatorio', reprocessavel: false },
      [`PZ-E2-${SUF}`]: { campo: 'prazo_medio_dias', codigo: 'campo_obrigatorio', reprocessavel: false },
      [`PZ-E3-${SUF}`]: { campo: 'prazo_medio_dias', codigo: 'tipo_invalido', reprocessavel: false },
      [`PZ-E4-${SUF}`]: { campo: 'prazo_medio_dias', codigo: 'valor_fora_da_faixa', reprocessavel: false },
      [`PZ-E5-${SUF}`]: { campo: 'prazo_medio_dias', codigo: 'regra_invalida', reprocessavel: false },
    });
    expect(await q('select external_id from vendedor.prazo_pagamento where external_id like $1', [`PZ-E_-${SUF}`])).toEqual([]);
  }, 120_000);

  it('H3. RN-INT-09 (v1 igual a hoje): sem descrição e sem prazo médio entra; o Vendedor gera "28/56 dias" e calcula 42', async () => {
    const semOpcionais = prazo(EXT.v1Sem);
    delete semOpcionais.descricao;
    delete semOpcionais.prazo_medio_dias;
    const lote = await enviar('v1', [semOpcionais]);
    expect(lote.erros, JSON.stringify(lote.erros)).toEqual([]);
    expect(lote.avisos).toEqual([]);
    expect(await parados()).toEqual([]);
    expect(await gravado(EXT.v1Sem)).toMatchObject({ descricao: '28/56 dias', prazo_medio_dias: 42 });
  }, 120_000);

  // ADR 0072 item 4 ("o Hub entrega ao Vendedor o registro já completo nas duas versões"): na v1 o Hub troca o prazo médio informado
  // pelo calculado antes de publicar integracao.prazo_pagamento.atualizado@1; o aviso diz "O Macuxi usa 42" e o Vendedor grava 42.
  it('H4. RN-INT-09 (v1): prazo médio 40 divergente de 28/56 vira o aviso prazo_medio_divergente e o Vendedor grava o calculado 42', async () => {
    const lote = await enviar('v1', [prazo(EXT.v1Div)]);
    expect(lote.erros).toEqual([]);
    expect(lote.avisos.map((a) => [a.external_id, a.codigo])).toEqual([[EXT.v1Div, 'prazo_medio_divergente']]);
    expect(await gravado(EXT.v1Div)).toMatchObject({ prazo_medio_dias: 42 });
  }, 120_000);

  // Mesma regra do H4 com o prazo médio fora das parcelas (10 em 28/56): o Vendedor recebe o calculado 42, então o CHECK
  // vendedor.prazo_medio_coerente (migração 0037) não recusa e nenhum evento fica parado na outbox.
  it('H5. RN-INT-09 (v1): prazo médio 10 fora das parcelas 28/56 vira aviso e entra com o calculado 42, sem evento parado na outbox', async () => {
    const lote = await enviar('v1', [prazo(EXT.v1Fora, { prazo_medio_dias: 10 })]);
    expect(lote.erros).toEqual([]);
    expect(await parados(), 'nenhum evento parado na outbox').toEqual([]);
    expect(await gravado(EXT.v1Fora)).toMatchObject({ prazo_medio_dias: 42 });
  }, 120_000);

  describe('T. RN-VEN-25 (ADR 0072) com o prazo médio RECEBIDO: o teto do cliente compara com 40, não com o calculado 42', () => {
    it('T1. teto 40 (igual ao recebido): o pedido com o prazo v2 é aceito e o retrato leva prazo médio 40', async () => {
      const g = (await gravado(EXT.v2))!;
      await teto(40);
      const r = await pushPedido(PED.teto40, g.id);
      expect(r, JSON.stringify(r)).toMatchObject({ id: PED.teto40, status: 'aceito' });
      const [p] = await q('select prazo_medio_dias, prazo_descricao, prazo_codigo from vendedor.pedido where id = $1', [PED.teto40]);
      expect(p).toEqual({ prazo_medio_dias: 40, prazo_descricao: 'Boleto 28 e 56 (ERP)', prazo_codigo: EXT.v2 });
    });

    it('T2. teto 41 (abaixo do calculado 42, acima do recebido 40): aceito, prova de que a API usa o recebido', async () => {
      const g = (await gravado(EXT.v2))!;
      await teto(41);
      const r = await pushPedido(PED.teto41, g.id);
      expect(r, JSON.stringify(r)).toMatchObject({ id: PED.teto41, status: 'aceito' });
    });

    it('T3. teto 39 (um abaixo do recebido): rejeitado com RN-VEN-25 e nada gravado', async () => {
      const g = (await gravado(EXT.v2))!;
      await teto(39);
      const r = await pushPedido(PED.teto39, g.id);
      expect(r, JSON.stringify(r)).toMatchObject({ id: PED.teto39, status: 'rejeitado', codigo: 'RN-VEN-25' });
      expect(await q('select 1 from vendedor.pedido where id = $1', [PED.teto39])).toEqual([]);
    });
  });
});
