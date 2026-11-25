/**
 * T-0196 (v1.0.36; ADR 0076, RN-VEN-02 v3, RN-VEN-15) — quantidade fracionária de ponta a ponta, com o `createApp` REAL (módulos de
 * `MODULOS_API`, JWT, Postgres como `macuxi_app`, RLS), o DESPACHANTE REAL da outbox (`macuxi_worker`) e um Conector simulado nas
 * rotas `/integracao/v1` (cabeçalhos da ADR 0013). Fixture dois-tenants num banco efêmero do arquivo. Agente `testes`.
 *
 * A trava (ADR 0076 D6) vem das versões publicadas do Campo e do Gestão (`versoesApp` da API, a mesma fonte do 426 e da rota
 * `GET /v1/app/versao`). O teste troca as versões publicadas e avança o relógio da API em 6 min a cada troca (o cache da fonte é de
 * 5 min), como acontece em produção quando o manifesto muda.
 *
 *  V1 fechada (1.0.36 há 1 h; e Campo 1.0.36 há 25 h com Gestão 1.0.35): `GET /v1/app/versao?contrato=3` devolve
 *     `fracao_liberada: false` e o push, o PUT do orçamento, o lote e o retorno do Hub recusam fração com 422
 *     `quantidade_fracionaria_bloqueada`. O V2 segue sem a chave nova. Quantidade inteira em KG passa.
 *  V2 aberta (Campo e Gestão 1.0.36 há 25 h): `fracao_liberada: true` e tudo aceita.
 *  R1 total do item = preço × quantidade ao centavo, meio para cima, com o preço REAL do Catálogo: 1999 × 1,25 = 2499 (2498,75) e
 *     1999 × 0,5 = 1000 (999,5); o total do pedido é a soma das linhas.
 *  R2 fração só em KG e M, até 4 casas: CX (fator 10) com 1,5 e KG com 5 casas = `quantidade_fracionaria_invalida`, com a trava
 *     aberta; no Hub, fator com 5 casas e quantidade faturada com 5 casas também.
 *  E1 outbox: o pedido com fração publica só o `vendedor.pedido.criado@2`; o inteiro publica o `@2` e o `@1`.
 *  P1 pull (pedido, pedido_item e produto_unidade): sem cabeçalho ou `campo/1.0.35`, a linha com fração não chega (a inteira sim);
 *     `campo/1.0.36` recebe, e a `versao_escopo` muda entre as duas (o aparelho que atualiza baixa de novo).
 *  C1 Conector: o pedido com fração entra na fila com `exige_conector` 1.6.0; o Conector 1.5.0 não o recebe (espera) e o 1.6.0
 *     recebe, com `quantidade: 1.25`.
 *  MT o tenant B não vê nada do A (pull de pedido e de unidade, fila do Conector de B); o promotor segue sem criar pedido (RN-PRO-01).
 *
 * G1 Gestor (ADR 0076 D8): com o módulo ligado em A, a projeção aplica só o `criado@2`; o pedido inteiro, que publica os dois, conta
 *     uma vez, com o total e a quantidade do `@2`.
 *
 * Premissas (escritas pelo admin do banco efêmero): o produto ALFA-001 de A passa a ser vendido em KG com preço 1999 na tabela
 * padrão; o vendedor 1 de A ganha `external_id` (o Hub exige a chave do ERP do vendedor); a condição de pagamento é a da fixture.
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { createHash, randomUUID } from 'node:crypto';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { PedidosPendentes, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { LinhaSync, PaginaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

const IP_A = '198.51.100.10';
/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP_B = '203.0.113.5';
const SUF = randomUUID().slice(0, 4).toUpperCase();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const HORA = 3_600_000;
const BLOQUEADA = 'quantidade_fracionaria_bloqueada';
const INVALIDA = 'quantidade_fracionaria_invalida';
const APP_NOVO = { 'x-macuxi-app': 'campo/1.0.36' };
const APP_ANTIGO = { 'x-macuxi-app': 'campo/1.0.35' };

const PED = {
  inteiroFechada: randomUUID(),
  fracaoFechada: randomUUID(),
  orcamento: randomUUID(),
  fracao: randomUUID(),
  meio: randomUUID(),
  inteiro: randomUUID(),
  cxFracao: randomUUID(),
  cincoCasas: randomUUID(),
  promotor: randomUUID(),
  fechadaParcial: randomUUID(),
} as const;

type Versoes = Record<
  'campo' | 'gestao',
  { variante: 'campo' | 'gestao'; versao: string; publicada_em: string }
>;

function conectorSimulado(api: ApiDeTeste, t: Tenant, ip: string, versao: string) {
  const cab = {
    authorization: `Bearer ${t.integracao.chave.chave}`,
    'x-macuxi-conector-id': t.integracao.identificador,
    'x-macuxi-conector-versao': versao,
    'user-agent': `macuxi-conector/${versao}`,
  };
  const chamar = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    extra: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    api.app.inject({
      method,
      url: `/integracao/v1${url}`,
      headers: { ...cab, ...extra },
      remoteAddress: ip,
      ...(payload ? { payload } : {}),
    });
  return {
    pendentes: () => chamar('GET', '/pedidos/pendentes?limite=100'),
    consultarLote: (id: string) => chamar('GET', `/lotes/${id}`),
    retorno: (pedido: string, corpo: object) =>
      chamar('POST', `/pedidos/${pedido}/retorno`, {
        versao_contrato: VERSAO_CONTRATO,
        pedido_uuid: pedido,
        ocorrido_em: new Date().toISOString(),
        ...corpo,
      }),
    lote: (registros: object[]) => {
      const corpo = {
        versao_contrato: VERSAO_CONTRATO,
        entidade: 'produto_unidade',
        modo: 'delta',
        conector_id: t.integracao.identificador,
        versao_conector: versao,
        enviado_em: new Date().toISOString(),
        registros,
      };
      return chamar('POST', '/lotes', corpo, {
        'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })),
      });
    },
  };
}

describe.skipIf(semBanco())(
  'T-0196 — quantidade fracionária (createApp × despachante × Conector simulado × Postgres, dois tenants)',
  () => {
    let api: ApiDeTeste;
    let worker: pg.Pool;
    const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
    const tk = { vendedorA: '', vendedorB: '', promotorA: '', gerenteA: '' };
    let prodKg = '';
    /** Relógio da API: real + deslocamento (cada troca de versão avança 6 min para vencer o cache de 5 min da fonte). */
    let desloc = 0;
    const agora = () => new Date(Date.now() + desloc);
    const versoes: Partial<Versoes> = {};
    const publicar = (campo: [string, number], gestao: [string, number]) => {
      desloc += 6 * 60_000;
      const em = (h: number) => new Date(agora().getTime() - h * HORA).toISOString();
      versoes.campo = { variante: 'campo', versao: campo[0], publicada_em: em(campo[1]) };
      versoes.gestao = { variante: 'gestao', versao: gestao[0], publicada_em: em(gestao[1]) };
    };
    const fechar = () => publicar(['1.0.36', 1], ['1.0.36', 1]);
    const abrir = () => publicar(['1.0.36', 25], ['1.0.36', 25]);

    const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) =>
      (await api.admin.query<T>(sql, p)).rows;
    const despachar = async () => {
      const d = criarDespachante({
        worker,
        app: criarBancoApp(api.pool),
        modulos: api.modulos,
        espera: () => 0,
      });
      for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
      throw new Error('a outbox não esvaziou em 60 ciclos');
    };
    const pedidoPayload = (
      id: string,
      itens: Array<{ quantity: number; unidade?: string }>,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      created_offline_at: agora().toISOString(),
      customer_id: A.clientes.c1,
      discount_pct: 0,
      items: itens.map((i) => ({ product_id: prodKg, ...i })),
      ...extra,
    });
    const push = async (
      token: string,
      id: string,
      itens: Array<{ quantity: number; unidade?: string }>,
      extra: Record<string, unknown> = {},
    ): Promise<ResultadoItemPush> => {
      const r = await api.chamar(token, {
        method: 'POST',
        url: '/v1/sync/push',
        headers: APP_NOVO,
        payload: {
          itens: [{ entidade: 'pedido', id, operacao: 'upsert', payload: pedidoPayload(id, itens, extra) }],
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      return (r.json() as { resultados: ResultadoItemPush[] }).resultados[0]!;
    };
    const itensGravados = (id: string) =>
      linhas<{ quantidade: string; total_cents: string }>(
        'select quantidade::text, total_cents::text from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia',
        [id],
      );
    /** `updated_at` do pedido em ISO UTC com microssegundos (a trava otimista do PUT do orçamento). */
    const atualizadoEm = async (id: string) => {
      const [o] = await linhas<{ atualizado: string }>(
        `select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as atualizado from vendedor.pedido where id = $1`,
        [id],
      );
      return o!.atualizado;
    };
    const versaoV3 = async (variante: 'campo' | 'gestao') => {
      const r = await api.app.inject({
        method: 'GET',
        url: `/v1/app/versao?variante=${variante}&contrato=3`,
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as { variante: string; versao: string; fracao_liberada: boolean };
    };
    const puxar = async (token: string, entidade: string, cab: Record<string, string> = {}) => {
      await esperarHorizonte();
      const todas: LinhaSync[] = [];
      let cursor: string | null = null;
      let versaoEscopo: string | undefined;
      for (let i = 0; i < 50; i += 1) {
        const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
        const r = await api.chamar(token, { method: 'GET', url: `/v1/sync/pull?${q}`, headers: cab });
        expect(r.statusCode, r.body).toBe(200);
        const p = r.json() as PaginaSync<LinhaSync> & { versao_escopo?: string };
        todas.push(...p.itens);
        versaoEscopo = p.versao_escopo ?? versaoEscopo;
        if (!(cursor = p.proximo_cursor)) break;
      }
      return { linhas: todas as Array<LinhaSync & Record<string, unknown>>, versaoEscopo };
    };
    const eventosDo = async (id: string) =>
      (
        await linhas<{ nome: string }>(
          "select nome from plataforma.evento where agregado_id = $1 and nome like 'vendedor.pedido.criado@%' order by nome",
          [id],
        )
      ).map((e) => e.nome);

    let erpA: ReturnType<typeof conectorSimulado>;
    let erpA15: ReturnType<typeof conectorSimulado>;
    let erpB: ReturnType<typeof conectorSimulado>;

    beforeAll(async () => {
      process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
      fechar();
      api = await subirApi({ relogio: agora, versoesApp: versoes });
      if (!api.banco.urlWorker)
        throw new Error(
          'banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o Hub precisa do despachante',
        );
      worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
      const admA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
      const admB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
      for (const t of [admA, admB])
        expect((await licenca(api, t, 'tenant', 'integracao', true)).statusCode).toBe(200);
      // o Gestor de A projeta os pedidos (caso D8: criado@2 × @1)
      expect((await licenca(api, admA, 'tenant', 'gestor', true)).statusCode).toBe(200);
      tk.vendedorA = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
      tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
      tk.promotorA = (await api.sessao('promotor@exemplo.com.br', A)).access_token;
      tk.gerenteA = (await api.sessao('gerente@exemplo.com.br', A)).access_token;
      prodKg = A.produtos.p1;
      // premissas do cabeçalho: ALFA-001 vendido em KG a 1999; vendedor 1 com a chave do ERP; o Conector de A recebe produto_unidade
      await api.admin.query(
        "insert into core.medida (tenant_id, sigla, descricao, ativo) select $1, s, s, true from unnest(array['KG','CX','FD']) s where not exists (select 1 from core.medida m where m.tenant_id = $1 and m.sigla = s)",
        [A.tenantId],
      );
      await api.admin.query("update core.produto set unidade = 'KG' where id = $1", [prodKg]);
      await api.admin.query(
        "update core.produto_unidade set unidade = 'KG' where produto_id = $1 and unidade = 'UN'",
        [prodKg],
      );
      await api.admin.query(
        'update catalogo.tabela_preco_item set preco_cents = 1999 where produto_id = $1',
        [prodKg],
      );
      await api.admin.query(
        "update core.usuario set external_id = coalesce(external_id, 'ERP-VEND-1') where id = $1",
        [A.usuarios.vendedor1],
      );
      await api.admin.query(
        "update core.cliente set external_id = coalesce(external_id, 'ERP-CLI-1') where id = $1",
        [A.clientes.c1],
      );
      await api.admin.query(
        "update integracao.conector set entidades = array_append(entidades, 'produto_unidade') where not ('produto_unidade' = any(entidades))",
      );
      await despachar();
      await api.admin.query(
        "update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')",
      );
      erpA = conectorSimulado(api, A, IP_A, '1.6.0');
      erpA15 = conectorSimulado(api, A, IP_A, '1.5.0');
      erpB = conectorSimulado(api, B, IP_B, '1.6.0');
      // o Hub só aceita unidade de produto que ele já recebeu do ERP: a carga do ALFA-001 (já em KG) vem antes
      const corpo = {
        versao_contrato: VERSAO_CONTRATO,
        entidade: 'produto',
        modo: 'delta',
        conector_id: A.integracao.identificador,
        versao_conector: '1.6.0',
        enviado_em: new Date().toISOString(),
        registros: [
          {
            external_id: 'ERP-A-001',
            alterado_em: new Date(Date.now() - 120_000).toISOString(),
            sku: 'ALFA-001',
            ean: '7890000000011',
            nome: 'Pastilha de freio dianteira',
            marca: 'Norfreio',
            categoria: 'Freios',
            unidade: 'KG',
          },
        ],
      };
      const rp = await api.app.inject({
        method: 'POST',
        url: '/integracao/v1/lotes',
        remoteAddress: IP_A,
        payload: corpo,
        headers: {
          authorization: `Bearer ${A.integracao.chave.chave}`,
          'x-macuxi-conector-id': A.integracao.identificador,
          'x-macuxi-conector-versao': '1.6.0',
          'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })),
        },
      });
      expect(rp.statusCode, rp.body).toBe(202);
      await despachar();
      const lp = await erpA.consultarLote((rp.json() as { lote_id: string }).lote_id);
      expect(lp.json(), lp.body).toMatchObject({ status: 'concluido' });
    }, 300_000);

    afterAll(async () => {
      if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
      else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
      await worker?.end().catch(() => undefined);
      await api?.fechar();
    });

    describe('V1. trava fechada', () => {
      it('ADR 0076 D6: 1.0.36 há 1 h nas duas variantes: fracao_liberada false no V3; o V2 não ganha a chave', async () => {
        fechar();
        for (const v of ['campo', 'gestao'] as const)
          expect(await versaoV3(v)).toMatchObject({ variante: v, versao: '1.0.36', fracao_liberada: false });
        const v2 = await api.app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo&contrato=2' });
        expect(v2.statusCode, v2.body).toBe(200);
        expect(Object.keys(v2.json() as object).sort()).toEqual(['publicada_em', 'variante', 'versao']);
      });

      it('RN-VEN-02 v3: push com 1,25 kg = 422 quantidade_fracionaria_bloqueada, nada gravado; 2 kg inteiro passa', async () => {
        fechar();
        expect(await push(tk.vendedorA, PED.fracaoFechada, [{ quantity: 1.25 }])).toMatchObject({
          status: 'rejeitado',
          codigo: BLOQUEADA,
        });
        expect(await itensGravados(PED.fracaoFechada)).toEqual([]);
        expect(await push(tk.vendedorA, PED.inteiroFechada, [{ quantity: 2 }])).toMatchObject({
          status: 'aceito',
        });
        expect(await itensGravados(PED.inteiroFechada)).toEqual([
          { quantidade: '2.0000', total_cents: '3998' },
        ]);
      });

      it('ADR 0076 D6: as duas na 1.0.35, ou Campo 1.0.36 há 25 h e Gestão 1.0.35: segue fechada no V3 e no push', async () => {
        publicar(['1.0.35', 25], ['1.0.35', 25]);
        expect((await versaoV3('gestao')).fracao_liberada).toBe(false);
        publicar(['1.0.36', 25], ['1.0.35', 25]);
        expect((await versaoV3('campo')).fracao_liberada).toBe(false);
        expect(await push(tk.vendedorA, PED.fechadaParcial, [{ quantity: 0.5 }])).toMatchObject({
          status: 'rejeitado',
          codigo: BLOQUEADA,
        });
      });

      it('RN-VEN-02 v3: PUT do orçamento com fração = 422 quantidade_fracionaria_bloqueada; o orçamento fica como estava', async () => {
        fechar();
        expect(
          await push(tk.vendedorA, PED.orcamento, [{ quantity: 3 }], { tipo: 'orcamento' }),
        ).toMatchObject({ status: 'aceito' });
        const atualizado = await atualizadoEm(PED.orcamento);
        const r = await api.chamar(tk.vendedorA, {
          method: 'PUT',
          url: `/v1/vendedor/orcamentos/${PED.orcamento}`,
          headers: APP_NOVO,
          payload: {
            customer_id: A.clientes.c1,
            discount_pct: 0,
            items: [{ product_id: prodKg, quantity: 1.25 }],
            atualizado_em: atualizado,
          },
        });
        expect(r.statusCode, r.body).toBe(422);
        expect(r.json()).toMatchObject({ codigo: BLOQUEADA });
        expect(await itensGravados(PED.orcamento)).toEqual([{ quantidade: '3.0000', total_cents: '5997' }]);
      });

      it('ADR 0076 D6: lote do Hub com fator 12,5 = 422 bloqueada (erro por registro); fator com 5 casas = 422 invalida', async () => {
        fechar();
        const reg = (fator: number, unidade: string) => ({
          external_id: `ERP-A-001:${unidade}:${SUF}`,
          alterado_em: new Date(Date.now() - 60_000).toISOString(),
          produto_external_id: 'ERP-A-001',
          unidade,
          fator,
        });
        const r = await erpA.lote([reg(12.5, 'CX')]);
        expect(r.statusCode, r.body).toBe(422);
        expect(r.json()).toMatchObject({
          codigo: BLOQUEADA,
          erros: [{ codigo: BLOQUEADA, campo: 'registros[0].fator' }],
        });
        const r5 = await erpA.lote([reg(1.23456, 'CX')]);
        expect(r5.statusCode, r5.body).toBe(422);
        expect(r5.json()).toMatchObject({
          codigo: INVALIDA,
          erros: [{ codigo: INVALIDA, campo: 'registros[0].fator' }],
        });
      });
    });

    describe('V2. trava aberta', () => {
      it('ADR 0076 D6: 1.0.36 há 25 h nas duas: fracao_liberada true no V3 das duas variantes', async () => {
        abrir();
        for (const v of ['campo', 'gestao'] as const) expect((await versaoV3(v)).fracao_liberada).toBe(true);
      });

      it('R1 RN-VEN-02 v3: 1999 × 1,25 kg = 2499 (2498,75) e 1999 × 0,5 kg = 1000 (999,5, meio para cima); total do pedido = soma', async () => {
        abrir();
        expect(await push(tk.vendedorA, PED.fracao, [{ quantity: 1.25 }])).toMatchObject({
          status: 'aceito',
        });
        expect(await itensGravados(PED.fracao)).toEqual([{ quantidade: '1.2500', total_cents: '2499' }]);
        expect(await push(tk.vendedorA, PED.meio, [{ quantity: 0.5 }])).toMatchObject({ status: 'aceito' });
        expect(await itensGravados(PED.meio)).toEqual([{ quantidade: '0.5000', total_cents: '1000' }]);
        const totais = await linhas<{ id: string; total_cents: string }>(
          'select id, total_cents::text from vendedor.pedido where id = any($1::uuid[])',
          [[PED.fracao, PED.meio]],
        );
        expect(Object.fromEntries(totais.map((t) => [t.id, t.total_cents]))).toEqual({
          [PED.fracao]: '2499',
          [PED.meio]: '1000',
        });
        expect(await push(tk.vendedorA, PED.inteiro, [{ quantity: 3 }])).toMatchObject({ status: 'aceito' });
        // o pedido de c1 pede aprovação (título vencido da fixture): o gerente aprova, para seguir ao Hub (aprovado@1)
        for (const id of [PED.fracao, PED.inteiro]) {
          const r = await api.chamar(tk.gerenteA, {
            method: 'POST',
            url: `/v1/vendedor/pedidos/${id}/aprovar`,
            payload: { comentario: 'T-0196' },
          });
          expect(r.statusCode, r.body).toBe(200);
        }
      });

      it('R2 RN-VEN-02 v3: CX (fator 10) com 1,5 e KG com 5 casas não entram, mesmo com a trava aberta', async () => {
        abrir();
        expect(await push(tk.vendedorA, PED.cxFracao, [{ quantity: 1.5, unidade: 'CX' }])).toMatchObject({
          status: 'rejeitado',
          codigo: INVALIDA,
        });
        const r5 = await push(tk.vendedorA, PED.cincoCasas, [{ quantity: 1.23456 }]);
        // mais de 4 casas: 422 quantidade_fracionaria_invalida do domain (ADR 0076 D4)
        expect(r5).toMatchObject({ status: 'rejeitado', codigo: INVALIDA });
        for (const id of [PED.cxFracao, PED.cincoCasas]) expect(await itensGravados(id)).toEqual([]);
      });

      it('RN-VEN-02 v3: PUT do orçamento: CX com 1,5 e 5 casas = 422 invalida (nada muda); 1,25 kg passa e grava 2499', async () => {
        abrir();
        const atualizado = await atualizadoEm(PED.orcamento);
        const editar = (item: { quantity: number; unidade?: string }) =>
          api.chamar(tk.vendedorA, {
            method: 'PUT',
            url: `/v1/vendedor/orcamentos/${PED.orcamento}`,
            headers: APP_NOVO,
            payload: {
              customer_id: A.clientes.c1,
              discount_pct: 0,
              items: [{ product_id: prodKg, ...item }],
              atualizado_em: atualizado,
            },
          });
        const cx = await editar({ quantity: 1.5, unidade: 'CX' });
        expect(cx.statusCode, cx.body).toBe(422);
        expect(cx.json()).toMatchObject({ codigo: INVALIDA });
        // mais de 4 casas: a ROTA do PUT responde 422 quantidade_fracionaria_invalida (ADR 0076 D4), não só o schema
        const cinco = await editar({ quantity: 1.23456 });
        expect(cinco.statusCode, cinco.body).toBe(422);
        expect(cinco.json()).toMatchObject({ codigo: INVALIDA });
        expect(await itensGravados(PED.orcamento)).toEqual([{ quantidade: '3.0000', total_cents: '5997' }]);
        const r = await editar({ quantity: 1.25 });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toMatchObject({ total_cents: 2499 });
      });

      it('RN-VEN-15: lote do Hub com fator 12,5 entra e o consumidor grava a unidade no Core', async () => {
        abrir();
        const r = await erpA.lote([
          {
            external_id: `ERP-A-001:FD:${SUF}`,
            alterado_em: new Date(Date.now() - 60_000).toISOString(),
            produto_external_id: 'ERP-A-001',
            unidade: 'FD',
            fator: 12.5,
          },
        ]);
        expect(r.statusCode, r.body).toBe(202);
        await despachar();
        const res = await erpA.consultarLote((r.json() as { lote_id: string }).lote_id);
        expect(res.json(), res.body).toMatchObject({ status: 'concluido' });
        const u = await linhas<{ fator: string; tenant_id: string }>(
          'select fator::text, tenant_id from core.produto_unidade where produto_id = $1 and fator <> trunc(fator) and deleted_at is null',
          [prodKg],
        );
        expect(u).toEqual([{ fator: '12.5000', tenant_id: A.tenantId }]);
      });

      it('MT/RN-PRO-01: o promotor não cria pedido com fração (nem com a trava aberta)', async () => {
        abrir();
        const r = await api.chamar(tk.promotorA, {
          method: 'POST',
          url: '/v1/sync/push',
          headers: APP_NOVO,
          payload: {
            itens: [
              {
                entidade: 'pedido',
                id: PED.promotor,
                operacao: 'upsert',
                payload: pedidoPayload(PED.promotor, [{ quantity: 1.25 }]),
              },
            ],
          },
        });
        if (r.statusCode === 200)
          expect((r.json() as { resultados: ResultadoItemPush[] }).resultados[0]).toMatchObject({
            status: 'rejeitado',
          });
        else expect(r.statusCode, r.body).toBe(403);
        expect(await linhas('select 1 from vendedor.pedido where id = $1', [PED.promotor])).toEqual([]);
      });
    });

    describe('E1. eventos do pedido (outbox)', () => {
      it('vendedor.pedido.criado@2 sempre; o @1 só no pedido sem fração', async () => {
        expect(await eventosDo(PED.fracao)).toEqual(['vendedor.pedido.criado@2']);
        expect(await eventosDo(PED.inteiro)).toEqual([
          'vendedor.pedido.criado@1',
          'vendedor.pedido.criado@2',
        ]);
        const [ev] = await linhas<{ payload: { itens: Array<{ quantidade: number; total_cents: number }> } }>(
          "select payload from plataforma.evento where agregado_id = $1 and nome = 'vendedor.pedido.criado@2'",
          [PED.fracao],
        );
        expect(ev!.payload.itens.map((i) => [i.quantidade, i.total_cents])).toEqual([[1.25, 2499]]);
        expect(await eventosDo(PED.meio)).toEqual(['vendedor.pedido.criado@2']);
      });

      it('ADR 0076 D8: o Gestor consome o criado@2 e ignora o @1; o pedido inteiro (que publica os dois) conta uma vez só', async () => {
        await despachar();
        const aplicados = async (id: string) =>
          (
            await linhas<{ nome: string }>(
              `select e.nome from gestor.evento_aplicado a join plataforma.evento e on e.id::text = a.evento_id::text
                where a.tenant_id = $1 and e.agregado_id = $2 and e.nome like 'vendedor.pedido.criado@%' and a.deleted_at is null
                order by e.nome`,
              [A.tenantId, id],
            )
          ).map((e) => e.nome);
        expect(await aplicados(PED.inteiro)).toEqual(['vendedor.pedido.criado@2']);
        expect(await aplicados(PED.fracao)).toEqual(['vendedor.pedido.criado@2']);
        // o fato do pedido na projeção: uma linha por pedido, com o total e a quantidade do @2 (1,25 kg = 2499)
        const fatos = await linhas<{ chave: string; total: number; qtds: number[] }>(
          `select chave, (dados->'criado'->>'total_cents')::int as total,
                  array(select (i->>'quantidade')::numeric::float8 from jsonb_array_elements(dados->'criado'->'itens') i) as qtds
             from gestor.projecao_fato
            where tenant_id = $1 and tabela = 'pedidos' and chave = any($2::text[]) and deleted_at is null
            order by chave`,
          [A.tenantId, [PED.fracao, PED.inteiro]],
        );
        expect(Object.fromEntries(fatos.map((f) => [f.chave, [f.total, f.qtds]]))).toEqual({
          [PED.fracao]: [2499, [1.25]],
          [PED.inteiro]: [5997, [3]],
        });
        // reentrega (o despachante roda de novo): nada muda, nenhum evento aplicado em dobro
        await despachar();
        expect(await aplicados(PED.inteiro)).toEqual(['vendedor.pedido.criado@2']);
      });
    });

    describe('P1. pull filtrado pela versão do app (ADR 0076 D6)', () => {
      it('sem cabeçalho e campo/1.0.35: o pedido e a unidade com fração não chegam; os inteiros chegam', async () => {
        abrir();
        for (const cab of [{}, APP_ANTIGO]) {
          const ped = await puxar(tk.vendedorA, 'pedido', cab);
          const ids = ped.linhas.map((l) => l.id);
          expect(ids).not.toContain(PED.fracao);
          expect(ids).toContain(PED.inteiro);
          const itens = await puxar(tk.vendedorA, 'pedido_item', cab);
          expect(itens.linhas.filter((l) => l.pedido_id === PED.fracao)).toEqual([]);
          expect(itens.linhas.every((l) => Number.isInteger(l.quantidade as number))).toBe(true);
          const un = await puxar(tk.vendedorA, 'produto_unidade', cab);
          expect(un.linhas.some((l) => !Number.isInteger(l.fator as number))).toBe(false);
        }
      });

      it('campo/1.0.36 recebe o pedido, os itens (número, não texto) e a unidade de 12,5; a versao_escopo muda ao atualizar', async () => {
        abrir();
        const antigo = await puxar(tk.vendedorA, 'pedido', APP_ANTIGO);
        const novo = await puxar(tk.vendedorA, 'pedido', APP_NOVO);
        expect(novo.linhas.map((l) => l.id)).toContain(PED.fracao);
        expect(novo.versaoEscopo).toBeDefined();
        expect(novo.versaoEscopo).not.toBe(antigo.versaoEscopo);
        const itens = (await puxar(tk.vendedorA, 'pedido_item', APP_NOVO)).linhas.filter(
          (l) => l.pedido_id === PED.fracao,
        );
        expect(itens.map((l) => l.quantidade)).toEqual([1.25]);
        const unAnt = await puxar(tk.vendedorA, 'produto_unidade', APP_ANTIGO);
        const un = await puxar(tk.vendedorA, 'produto_unidade', APP_NOVO);
        expect(un.linhas.filter((l) => l.produto_id === prodKg).map((l) => l.fator)).toContain(12.5);
        expect(un.versaoEscopo).not.toBe(unAnt.versaoEscopo);
      });

      it('MT: o vendedor de B (1.0.36) não recebe o pedido nem a unidade de A', async () => {
        const ped = await puxar(tk.vendedorB, 'pedido', APP_NOVO);
        expect(ped.linhas.map((l) => l.id)).not.toContain(PED.fracao);
        const un = await puxar(tk.vendedorB, 'produto_unidade', APP_NOVO);
        expect(un.linhas.some((l) => l.produto_id === prodKg)).toBe(false);
      });
    });

    describe('C1. Conector: o pedido com fração espera o 1.6.0', () => {
      it('fila com exige_conector 1.6.0; Conector de B e o 1.5.0 de A não recebem; o 1.6.0 recebe com quantidade 1,25', async () => {
        await despachar();
        const [f] = await linhas<{
          estado: string;
          exige_conector: string | null;
          retencao_codigo: string | null;
          retencao_mensagem: string | null;
        }>(
          'select estado, exige_conector, retencao_codigo, retencao_mensagem from integracao.pedido_fila_erp where pedido_uuid = $1',
          [PED.fracao],
        );
        expect(f, `pedido com fração na fila do ERP: ${JSON.stringify(f)}`).toMatchObject({
          estado: 'pendente',
          exige_conector: '1.6.0',
          retencao_codigo: null,
        });

        const rb = await erpB.pendentes();
        expect(rb.statusCode, rb.body).toBe(200);
        expect(PedidosPendentes.parse(rb.json()).pedidos.map((p) => p.pedido_uuid)).not.toContain(PED.fracao);

        const r15 = await erpA15.pendentes();
        expect(r15.statusCode, r15.body).toBe(200);
        expect(PedidosPendentes.parse(r15.json()).pedidos.map((p) => p.pedido_uuid)).not.toContain(
          PED.fracao,
        );
        expect(
          (
            await linhas<{ estado: string }>(
              'select estado from integracao.pedido_fila_erp where pedido_uuid = $1',
              [PED.fracao],
            )
          )[0]!.estado,
        ).toBe('pendente');

        const r = await erpA.pendentes();
        expect(r.statusCode, r.body).toBe(200);
        const p = PedidosPendentes.parse(r.json()).pedidos.find((x) => x.pedido_uuid === PED.fracao);
        expect(p, 'o Conector 1.6.0 recebe o pedido com fração').toBeDefined();
        expect(p!.itens.map((i) => [i.quantidade, i.total_cents])).toEqual([[1.25, 2499]]);
      });

      it('retorno: faturada 0,5 kg passa com a trava aberta; com ela fechada, 0,25 kg = 422 bloqueada; 5 casas = 422 invalida', async () => {
        abrir();
        const integ = await erpA.retorno(PED.fracao, { status: 'integrado', numero_erp: `PV-FR-${SUF}` });
        expect(integ.statusCode, integ.body).toBe(200);
        const nota = (n: string, q: number) => ({
          status: 'faturado_parcial',
          numero_erp: `PV-FR-${SUF}`,
          nota: {
            numero: n,
            serie: '1',
            emitida_em: new Date(Date.now() - 60_000).toISOString(),
            total_cents: 1000,
          },
          itens_faturados: [
            {
              sequencia: 1,
              produto_external_id: 'ERP-A-001',
              quantidade: q,
              valor_cents: Math.round(1999 * q),
            },
          ],
        });
        const ok = await erpA.retorno(PED.fracao, nota(`NF1-${SUF}`, 0.25));
        expect(ok.statusCode, ok.body).toBe(200);
        const cinco = await erpA.retorno(PED.fracao, nota(`NF5-${SUF}`, 0.12345));
        expect(cinco.statusCode, cinco.body).toBe(422);
        expect(cinco.json()).toMatchObject({
          codigo: INVALIDA,
          erros: [{ codigo: INVALIDA, campo: 'itens_faturados[0].quantidade' }],
        });
        fechar();
        const bloq = await erpA.retorno(PED.fracao, nota(`NF2-${SUF}`, 0.25));
        expect(bloq.statusCode, bloq.body).toBe(422);
        expect(bloq.json()).toMatchObject({ codigo: BLOQUEADA });
      });
    });
  },
);
