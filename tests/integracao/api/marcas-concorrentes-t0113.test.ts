/**
 * T-0113 (ADR 0034, que substitui a 0027) — marcas concorrentes no CATÁLOGO, lidas pelo Promotor por contrato. Integração na
 * API REAL: `createApp` com os 8 módulos, JWT de verdade, Postgres como `macuxi_app` (RLS), fixture dois-tenants (pós-0045:
 * MARCAS_FIXTURE) num banco efêmero próprio do arquivo. Agente `testes`, fatia T do desenho docs/desenho/T-0113.md.
 * Banco só no CI (sem Docker no PC). Matriz: docs/testes/T-0113.md.
 *
 * O que NÃO se repete aqui (é de outro dono): a migração 0045 (cópia campo a campo, ida e volta, 42501 na escrita do
 * `promotor.concorrente`, FK nova) em db/testes/marca-concorrente.test.ts (banco-dados); o domain (`validarNomeMarca`,
 * `fatoDaEscritaMarca`) e as rotas com repositório simulado nos testes do modulo-catalogo e do modulo-promotor.
 *
 * Fixture: A tem Catálogo + Promotor (analista com os dois no perfil); B tem Catálogo e NÃO tem o Promotor (o caso típico de
 * autopeças). Por tenant: a marca ATIVA com o mesmo id do concorrente antigo do Promotor (PROMOTOR_FIXTURE.X.concorrente),
 * uma INATIVA (com external_id) e uma APAGADA; as referências cruzadas apontam para a ativa.
 *
 * Casos:
 *  MC  cadastro de marcas do Catálogo (`/v1/catalogo/marcas`, fatia K — em andamento no modulo-catalogo quando este arquivo
 *      foi escrito: escrito contra modules/catalogo/contracts/marcas.ts e o desenho; ver a matriz):
 *      MC-1 lista com `situacao` e a contagem `referencias`; MC-2 criar idempotente pelo id + evento + auditoria;
 *      MC-3 limites (nome repetido sem diferenciar maiúsculas, inativa conta, apagada não conta, 120/121, em branco,
 *      external_id repetido); MC-4 perfis; MC-5 multi-tenant; MC-6 licença; MC-7 renomear atualiza o "Equivale a";
 *      MC-8 inativar/reativar: busca, lápide no pull, seletor do Trade, eventos.
 *  SP  tenant SEM o Promotor (B) cadastra marca e grava referência; o vendedor acha pelo código do concorrente.
 *  PV  o Promotor valida o produto do concorrente por `catalogo.marcas@1` (ativa, inativa, apagada, inexistente, de outro
 *      tenant, Catálogo indisponível); a lista `cadastros/concorrentes` vira só leitura.
 *  SY  sync: entidade `marca_concorrente` (escopo tenant) e a legada `concorrente` com página vazia (ADR 0034 §5).
 *  DM  dados migrados com o mesmo id: o produto do concorrente da fixture continua válido e editável.
 */
import {
  MarcaConcorrenteAlteradaSchema,
  MarcaConcorrenteSyncSchema,
  MarcaListaSaidaSchema,
  RespostaBusca,
  type MarcaListaSaida,
} from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LinhaSync, PaginaSync } from '@macuxi/platform-sdk';
import { MarcaConcorrenteListaSchema, ProdutoConcorrenteSync } from '@macuxi/promotor/contracts';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MARCAS_FIXTURE, REFERENCIAS_FIXTURE } from '../../../db/seeds/fixtures/dois-tenants';
import { PROMOTOR_FIXTURE } from '../../../db/seeds/fixtures/promotor';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

const EVENTO = 'catalogo.marca_concorrente.alterada@1';
const NOME_A = 'Freios Rivais';
const NOME_B = 'Lubri Rival';
const ListaPromotor = z.object({ itens: z.array(MarcaConcorrenteListaSchema) });
const ListaProdutosConcorrente = z.object({ itens: z.array(ProdutoConcorrenteSync) });

describe.skipIf(semBanco())('T-0113 — marcas concorrentes no Catálogo, lidas pelo Promotor por contrato (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { analistaA: '', adminA: '', vA: '', promotorA: '', adminB: '', vB: '' };
  let betaP1 = '';

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const linhaMarca = async (id: string) =>
    (await q<{ tenant_id: string; nome: string; ativo: boolean; external_id: string | null; deleted_at: Date | null; updated_at: Date }>('select tenant_id, nome, ativo, external_id, deleted_at, updated_at from catalogo.marca_concorrente where id = $1', [id]))[0];
  const eventos = (id: string) =>
    q<{ payload: unknown }>(`select payload from plataforma.evento where nome = $1 and agregado_id = $2 order by created_at, payload->>'alterada_em'`, [EVENTO, id]).then((r) =>
      r.map((x) => MarcaConcorrenteAlteradaSchema.parse(x.payload)),
    );

  // ---------- Catálogo ----------
  const listar = async (t: string, query = ''): Promise<MarcaListaSaida['marcas']> => {
    const r = await api.chamar(t, { method: 'GET', url: `/v1/catalogo/marcas${query}` });
    expect(r.statusCode, r.body).toBe(200);
    return MarcaListaSaidaSchema.parse(r.json()).marcas;
  };
  const criar = (t: string, corpo: Record<string, unknown>) => api.chamar(t, { method: 'POST', url: '/v1/catalogo/marcas', payload: corpo });
  const alterar = (t: string, id: string, corpo: Record<string, unknown>) => api.chamar(t, { method: 'PUT', url: `/v1/catalogo/marcas/${id}`, payload: corpo });
  const ok = (r: { statusCode: number; body: string }, rotulo: string) => expect([200, 201], `${rotulo}: ${r.statusCode} ${r.body}`).toContain(r.statusCode);
  const buscar = async (t: string, texto: string) => {
    const r = await api.chamar(t, { method: 'GET', url: `/v1/catalogo/busca?q=${encodeURIComponent(texto)}&limit=20&mode=basica` });
    expect(r.statusCode, `busca "${texto}": ${r.body}`).toBe(200);
    return RespostaBusca.parse(r.json()).items;
  };
  const salvarCadastro = (t: string, id: string, corpo: Record<string, unknown>) =>
    api.chamar(t, { method: 'PUT', url: `/v1/catalogo/produtos/${id}/cadastro-catalogo`, payload: { aplicacao: null, oferece_junto: [], etiquetas: [], ...corpo } });
  /** Pull completo de uma entidade (do início), como o aparelho na 1ª sincronização. */
  const puxarTudo = async (t: string, entidade: string): Promise<LinhaSync[]> => {
    const itens: LinhaSync[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const qs = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
      const r = await api.chamar(t, { method: 'GET', url: `/v1/sync/pull?${qs}` });
      expect(r.statusCode, `pull ${entidade}: ${r.body}`).toBe(200);
      const p = r.json() as PaginaSync<LinhaSync>;
      itens.push(...p.itens);
      if (!p.proximo_cursor) return itens;
      cursor = p.proximo_cursor;
    }
    throw new Error(`pull de ${entidade} sem fim em 50 páginas`);
  };

  // ---------- Promotor ----------
  const produtoConcorrente = (id: string, concorrente_id: string, nome = `Produto rival ${id.slice(0, 4)}`) => ({ id, concorrente_id, nome, produto_id: null, categoria_gondola_id: null, ativo: true });
  const postProdutoConcorrente = (t: string, corpo: object) => api.chamar(t, { method: 'POST', url: '/v1/promotor/cadastros/produtos-concorrente', payload: corpo });
  const produtoConcorrenteNoBanco = (id: string) => q('select 1 from promotor.produto_concorrente where id = $1', [id]);
  const marcasDoTrade = async (t: string, incluirRemovidos = false) => {
    const r = await api.chamar(t, { method: 'GET', url: `/v1/promotor/cadastros/concorrentes${incluirRemovidos ? '?incluir_removidos=true' : ''}` });
    expect(r.statusCode, r.body).toBe(200);
    return ListaPromotor.parse(r.json()).itens;
  };

  beforeAll(async () => {
    api = await subirApi();
    tk.analistaA = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.vA = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotorA = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    betaP1 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'BETA-001'", [B.tenantId]))[0]!.id;
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ DM: dados migrados
  describe('DM. Dados migrados com o mesmo id (0045)', () => {
    it('DM-1 (ADR 0034 §4.2): a marca ativa do Catálogo tem o id, o nome e o estado do concorrente antigo do Promotor; o produto do concorrente da fixture aponta para ela', async () => {
      for (const [X, nome] of [['A', NOME_A], ['B', NOME_B]] as const) {
        expect(MARCAS_FIXTURE[X].ativa).toBe(PROMOTOR_FIXTURE[X].concorrente);
        const antigo = (await q<{ nome: string; ativo: boolean; external_id: string | null }>('select nome, ativo, external_id from promotor.concorrente where id = $1', [PROMOTOR_FIXTURE[X].concorrente]))[0];
        expect(await linhaMarca(MARCAS_FIXTURE[X].ativa)).toMatchObject({ ...antigo, nome, deleted_at: null });
      }
      const r = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/promotor/cadastros/produtos-concorrente' });
      expect(r.statusCode, r.body).toBe(200);
      const fixture = ListaProdutosConcorrente.parse(r.json()).itens.find((p) => p.id === PROMOTOR_FIXTURE.A.produtoConcorrente);
      expect(fixture?.concorrente_id).toBe(MARCAS_FIXTURE.A.ativa);
      expect((await marcasDoTrade(tk.analistaA)).map((m) => m.id)).toContain(fixture!.concorrente_id);
    });

    it('DM-2: o produto do concorrente da fixture (id de antes da 0045) é editado pela API, validado pela consulta do Catálogo', async () => {
      const id = PROMOTOR_FIXTURE.A.produtoConcorrente;
      const atual = (await q<{ nome: string; produto_id: string | null; categoria_gondola_id: string | null }>('select nome, produto_id, categoria_gondola_id from promotor.produto_concorrente where id = $1', [id]))[0]!;
      const r = await api.chamar(tk.analistaA, {
        method: 'PUT',
        url: `/v1/promotor/cadastros/produtos-concorrente/${id}`,
        payload: { id, concorrente_id: MARCAS_FIXTURE.A.ativa, nome: `${atual.nome} (T-0113)`, produto_id: atual.produto_id, categoria_gondola_id: atual.categoria_gondola_id, ativo: true },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect((await q<{ nome: string }>('select nome from promotor.produto_concorrente where id = $1', [id]))[0]!.nome).toBe(`${atual.nome} (T-0113)`);
    });
  });

  // ------------------------------------------------------------------------------------------------ PV: Promotor
  describe('PV. O Promotor valida pela consulta catalogo.marcas@1 (fatia P)', () => {
    it('PV-1 (ADR 0034 §3): marca ativa do Catálogo = 201; repetir o POST devolve o mesmo (idempotente)', async () => {
      const id = randomUUID();
      const corpo = produtoConcorrente(id, MARCAS_FIXTURE.A.ativa);
      const r = await postProdutoConcorrente(tk.analistaA, corpo);
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json()).toMatchObject({ id, concorrente_id: MARCAS_FIXTURE.A.ativa });
      const deNovo = await postProdutoConcorrente(tk.analistaA, corpo);
      expect([200, 201]).toContain(deNovo.statusCode);
      expect(await produtoConcorrenteNoBanco(id)).toHaveLength(1);
    });

    it.each([
      ['inativa', MARCAS_FIXTURE.A.inativa],
      ['apagada', MARCAS_FIXTURE.A.apagada],
      ['inexistente', '0f113000-0000-4000-8000-00000000dead'],
      ['de outro tenant (B)', MARCAS_FIXTURE.B.ativa],
    ])('PV-2 (ADR 0034 §3): marca %s = 422 REFERENCIA_INVALIDA; nada gravado', async (_rotulo, marca) => {
      const id = randomUUID();
      const r = await postProdutoConcorrente(tk.analistaA, produtoConcorrente(id, marca));
      expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([422, 'REFERENCIA_INVALIDA']);
      expect(await produtoConcorrenteNoBanco(id)).toEqual([]);
    });

    it('PV-3 (ADR 0034 risco 1): Catálogo desligado no tenant = 422 com "Cadastre as marcas concorrentes no Catálogo"; a lista do Trade = 422 MARCAS_INDISPONIVEIS; religado, volta', async () => {
      const id = randomUUID();
      expect((await licenca(api, tk.adminA, 'tenant', 'catalogo', false)).statusCode).toBe(200);
      try {
        const r = await postProdutoConcorrente(tk.analistaA, produtoConcorrente(id, MARCAS_FIXTURE.A.ativa));
        expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([422, 'REFERENCIA_INVALIDA']);
        expect(erroDe(r).mensagem).toMatch(/Cat[aá]logo/);
        const l = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/promotor/cadastros/concorrentes' });
        expect([l.statusCode, erroDe(l).codigo], l.body).toEqual([422, 'MARCAS_INDISPONIVEIS']);
      } finally {
        expect((await licenca(api, tk.adminA, 'tenant', 'catalogo', true)).statusCode).toBe(200);
      }
      expect(await produtoConcorrenteNoBanco(id)).toEqual([]);
      expect((await postProdutoConcorrente(tk.analistaA, produtoConcorrente(id, MARCAS_FIXTURE.A.ativa))).statusCode).toBe(201);
    });

    it('PV-4 (desenho P3): a lista do Trade vem do Catálogo — só a ativa por padrão; com incluir_removidos, também a inativa; nunca a apagada nem as de B', async () => {
      expect((await marcasDoTrade(tk.analistaA)).map((m) => m.id)).toEqual([MARCAS_FIXTURE.A.ativa]);
      const todas = await marcasDoTrade(tk.analistaA, true);
      expect(todas.map((m) => m.id).sort()).toEqual([MARCAS_FIXTURE.A.ativa, MARCAS_FIXTURE.A.inativa].sort());
      expect(todas.find((m) => m.id === MARCAS_FIXTURE.A.inativa)).toMatchObject({ ativo: false, external_id: 'MARCA-INATIVA-ALFA' });
    });

    it('PV-5 (desenho P3, 0045 §4): o cadastro antigo não aceita escrita pela API (sem POST/PUT/DELETE); nada muda no Catálogo nem no Promotor', async () => {
      const antesCat = await linhaMarca(MARCAS_FIXTURE.A.ativa);
      const antesPro = await q('select nome, ativo, updated_at from promotor.concorrente where id = $1', [PROMOTOR_FIXTURE.A.concorrente]);
      const novo = randomUUID();
      const tentativas = [
        await api.chamar(tk.analistaA, { method: 'POST', url: '/v1/promotor/cadastros/concorrentes', payload: { id: novo, nome: 'Invasora', ativo: true } }),
        await api.chamar(tk.analistaA, { method: 'PUT', url: `/v1/promotor/cadastros/concorrentes/${MARCAS_FIXTURE.A.ativa}`, payload: { id: MARCAS_FIXTURE.A.ativa, nome: 'Invasora', ativo: true } }),
        await api.chamar(tk.analistaA, { method: 'DELETE', url: `/v1/promotor/cadastros/concorrentes/${MARCAS_FIXTURE.A.ativa}` }),
      ];
      for (const r of tentativas) expect(r.statusCode, r.body).toBeGreaterThanOrEqual(400);
      expect(await linhaMarca(MARCAS_FIXTURE.A.ativa)).toEqual(antesCat);
      expect(await q('select nome, ativo, updated_at from promotor.concorrente where id = $1', [PROMOTOR_FIXTURE.A.concorrente])).toEqual(antesPro);
      expect(await q('select 1 from promotor.concorrente where id = $1 union all select 1 from catalogo.marca_concorrente where id = $1', [novo])).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ SY: sync
  describe('SY. Sync (ADR 0034 §2 e §5)', () => {
    it('SY-1: a entidade marca_concorrente (Catálogo, escopo tenant) traz as marcas de A no formato do contrato; nada de B', async () => {
      // a fixture acabou de ser carregada no beforeAll: as linhas só saem quando o horizonte do pull (now() - 2 s, ADR 0009 §3)
      // passar do updated_at delas — sem esperar, o pull logo depois da carga devolve página vazia (CI 42497452838)
      await esperarHorizonte();
      const itens = (await puxarTudo(tk.vA, 'marca_concorrente')).map((l) => MarcaConcorrenteSyncSchema.parse(l));
      const ids = itens.map((m) => m.id);
      expect(ids).toEqual(expect.arrayContaining([MARCAS_FIXTURE.A.ativa, MARCAS_FIXTURE.A.inativa]));
      expect(itens.find((m) => m.id === MARCAS_FIXTURE.A.inativa)).toMatchObject({ ativo: false, deleted_at: null });
      // a apagada, se vier, vem como lápide
      const apagada = itens.find((m) => m.id === MARCAS_FIXTURE.A.apagada);
      if (apagada) expect(apagada.deleted_at).not.toBeNull();
      for (const id of [MARCAS_FIXTURE.B.ativa, MARCAS_FIXTURE.B.inativa, MARCAS_FIXTURE.B.apagada]) expect(ids).not.toContain(id);
    });

    it('SY-2 (ADR 0034 §5): a entidade legada concorrente (Promotor) responde 200 com página vazia (o APK antigo não recebe 404)', async () => {
      expect(await puxarTudo(tk.promotorA, 'concorrente')).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ SP: tenant sem o Promotor
  describe('SP. Tenant sem o Promotor (B) cadastra marcas e referências (critério 2)', () => {
    let aplicacaoB: string | null = null;
    let etiquetasB: string[] = [];

    beforeAll(async () => {
      const c = (await q<{ aplicacoes: string | null; etiquetas: string[] }>('select aplicacoes, etiquetas from catalogo.produto_conteudo where produto_id = $1 and deleted_at is null', [betaP1]))[0];
      aplicacaoB = c?.aplicacoes ?? null;
      etiquetasB = c?.etiquetas ?? [];
    });

    it('SP-0: B não tem o Promotor (nem no tenant, nem nos módulos do vendedor e do admin)', async () => {
      expect(B.modulos).not.toContain('promotor');
      for (const t of [tk.vB, tk.adminB]) expect((await api.meusModulos(t)).modulos.map((m) => m.id)).not.toContain('promotor');
    });

    it('SP-1 (RN-CAT-09): o admin de B grava uma referência com a marca do Catálogo de B; o vendedor de B acha o BETA-001 pelo código com "Equivale a"', async () => {
      const r = await salvarCadastro(tk.adminB, betaP1, {
        aplicacao: aplicacaoB,
        etiquetas: etiquetasB,
        referencias: [
          { marca_id: MARCAS_FIXTURE.B.ativa, codigo: 'LB 0099' },
          { marca_id: MARCAS_FIXTURE.B.ativa, codigo: 'LB 0100' },
        ],
      });
      expect(r.statusCode, r.body).toBe(200);
      const achados = await buscar(tk.vB, 'lb0100');
      expect(achados[0]).toMatchObject({ erp_code: 'BETA-001', equivale_a: { marca_id: MARCAS_FIXTURE.B.ativa, marca_nome: NOME_B, codigo: 'LB 0100' } });
    });

    it('SP-2 (RN-CAT-09, multi-tenant): B com a marca inativa dele ou com a marca de A = 422 RN-CAT-09; nada muda', async () => {
      for (const marca of [MARCAS_FIXTURE.B.inativa, MARCAS_FIXTURE.A.ativa]) {
        const r = await salvarCadastro(tk.adminB, betaP1, { aplicacao: aplicacaoB, etiquetas: etiquetasB, referencias: [{ marca_id: marca, codigo: 'XX 1' }] });
        expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([422, 'RN-CAT-09']);
      }
      expect((await q<{ codigo: string }>('select codigo from catalogo.produto_referencia where produto_id = $1 and deleted_at is null order by ordem', [betaP1])).map((x) => x.codigo)).toEqual(['LB 0099', 'LB 0100']);
    });

    it('SP-3 (fatia K; ADR 0034 consequências): sem o Promotor, o admin de B cadastra uma marca nova e grava a referência com ela; o vendedor de B vê "Equivale a"', async () => {
      const id = randomUUID();
      ok(await criar(tk.adminB, { id, nome: 'Rival Beta Nova' }), 'POST marca em B');
      expect(await linhaMarca(id)).toMatchObject({ tenant_id: B.tenantId, nome: 'Rival Beta Nova', ativo: true });
      const r = await salvarCadastro(tk.adminB, betaP1, {
        aplicacao: aplicacaoB,
        etiquetas: etiquetasB,
        referencias: [
          { marca_id: MARCAS_FIXTURE.B.ativa, codigo: 'LB 0099' },
          { marca_id: id, codigo: 'NB 7788' },
        ],
      });
      expect(r.statusCode, r.body).toBe(200);
      expect((await buscar(tk.vB, 'nb7788'))[0]).toMatchObject({ erp_code: 'BETA-001', equivale_a: { marca_id: id, marca_nome: 'Rival Beta Nova', codigo: 'NB 7788' } });
      expect((await listar(tk.adminB)).find((m) => m.id === id)).toMatchObject({ nome: 'Rival Beta Nova', ativo: true, referencias: 1 });
      expect((await eventos(id)).map((e) => e.fato)).toEqual(['criada']);
    });
  });

  // ------------------------------------------------------------------------------------------------ MC: cadastro do Catálogo
  describe('MC. Cadastro de marcas do Catálogo — /v1/catalogo/marcas (fatia K, RN-CAT-13)', () => {
    it('MC-1: a lista traz as ativas por padrão, com a contagem de referências vivas; inativas e todas pela `situacao`; nunca a apagada nem as de B', async () => {
      const ativas = await listar(tk.analistaA);
      expect(ativas.map((m) => m.id)).toEqual([MARCAS_FIXTURE.A.ativa]);
      expect(ativas[0]).toMatchObject({ nome: NOME_A, ativo: true, external_id: null, referencias: 2 });
      expect((await listar(tk.analistaA, '?situacao=inativas')).map((m) => m.id)).toEqual([MARCAS_FIXTURE.A.inativa]);
      const todas = await listar(tk.analistaA, '?situacao=todas');
      expect(todas.map((m) => m.id).sort()).toEqual([MARCAS_FIXTURE.A.ativa, MARCAS_FIXTURE.A.inativa].sort());
      expect(todas.find((m) => m.id === MARCAS_FIXTURE.A.inativa)).toMatchObject({ ativo: false, external_id: 'MARCA-INATIVA-ALFA', referencias: 0 });
      expect((await listar(tk.analistaA, `?situacao=todas&busca=${encodeURIComponent('freios')}`)).map((m) => m.id)).toEqual([MARCAS_FIXTURE.A.ativa]);
    });

    it('MC-2 (regra 4): criar com o id do cliente; o reenvio igual não duplica nem publica de novo; um evento `criada` (strict) e auditoria com o id', async () => {
      const id = randomUUID();
      const corpo = { id, nome: 'Rival Alfa Nova', external_id: 'MARCA-RAN' };
      ok(await criar(tk.analistaA, corpo), '1º POST');
      ok(await criar(tk.analistaA, corpo), 'reenvio');
      expect(await q('select 1 from catalogo.marca_concorrente where id = $1', [id])).toHaveLength(1);
      expect(await linhaMarca(id)).toMatchObject({ tenant_id: A.tenantId, nome: 'Rival Alfa Nova', ativo: true, external_id: 'MARCA-RAN', deleted_at: null });
      const ev = await eventos(id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ id, nome: 'Rival Alfa Nova', ativo: true, external_id: 'MARCA-RAN', fato: 'criada' });
      expect(await q('select 1 from plataforma.auditoria where tenant_id = $1 and entidade_id = $2', [A.tenantId, id])).not.toHaveLength(0);
      expect((await listar(tk.analistaA)).map((m) => m.nome)).toContain('Rival Alfa Nova');
    });

    it('MC-3 (RN-CAT-13): nome repetido sem diferenciar maiúsculas (a inativa conta) e external_id repetido = 422 RN-CAT-13; em branco e 121 caracteres = 400 VALIDACAO (contrato); 120 e o nome de uma apagada passam', async () => {
      const repetidos: Array<[string, Record<string, unknown>]> = [
        ['nome da ativa em minúsculas', { nome: NOME_A.toLowerCase() }],
        ['nome da inativa', { nome: 'MARCA INATIVA ALFA' }],
        ['external_id da inativa', { nome: 'Outra Marca X', external_id: 'MARCA-INATIVA-ALFA' }],
      ];
      for (const [rotulo, extra] of repetidos) {
        const id = randomUUID();
        const r = await criar(tk.analistaA, { id, ...extra });
        expect([r.statusCode, erroDe(r).codigo], `${rotulo}: ${r.body}`).toEqual([422, 'RN-CAT-13']);
        expect(await linhaMarca(id), rotulo).toBeUndefined();
      }
      for (const [rotulo, nome] of [['em branco', '   '], ['121 caracteres', 'M'.repeat(121)]] as const) {
        const id = randomUUID();
        const r = await criar(tk.analistaA, { id, nome });
        // o desenho (K3) fala em 422 RN-CAT-13 para nome inválido; o contrato (MarcaCriarSchema, Nome 1..120 com trim) barra antes: 400
        expect([r.statusCode, erroDe(r).codigo], `${rotulo}: ${r.body}`).toEqual([400, 'VALIDACAO']);
        expect(await linhaMarca(id), rotulo).toBeUndefined();
      }
      const limite = randomUUID();
      ok(await criar(tk.analistaA, { id: limite, nome: `  ${'L'.repeat(120)}  ` }), '120 caracteres com espaços');
      expect((await linhaMarca(limite))?.nome).toBe('L'.repeat(120));
      const recriada = randomUUID();
      ok(await criar(tk.analistaA, { id: recriada, nome: 'Marca Apagada Alfa' }), 'nome de marca apagada');
    });

    it('MC-4 (RN-CAT-13, perfis): vendedor e promotor não gravam (403); o vendedor lê a lista (produto.consultar); nada gravado', async () => {
      for (const t of [tk.vA, tk.promotorA]) {
        const id = randomUUID();
        const r = await criar(t, { id, nome: `Sem permissão ${id.slice(0, 4)}` });
        expect(r.statusCode, r.body).toBe(403);
        expect(await linhaMarca(id)).toBeUndefined();
        const p = await alterar(t, MARCAS_FIXTURE.A.ativa, { nome: 'Invasora' });
        expect(p.statusCode, p.body).toBe(403);
      }
      const v = await api.chamar(tk.vA, { method: 'GET', url: '/v1/catalogo/marcas' });
      expect(v.statusCode, v.body).toBe(200);
      expect((await linhaMarca(MARCAS_FIXTURE.A.ativa))?.nome).toBe(NOME_A);
    });

    it('MC-5 (multi-tenant): B não vê as marcas de A; não altera a de A (404) nem a sobrescreve com POST do mesmo id', async () => {
      const deB = await listar(tk.adminB, '?situacao=todas');
      for (const id of [MARCAS_FIXTURE.A.ativa, MARCAS_FIXTURE.A.inativa, MARCAS_FIXTURE.A.apagada]) expect(deB.map((m) => m.id)).not.toContain(id);
      expect(deB.map((m) => m.id)).toContain(MARCAS_FIXTURE.B.ativa);
      const antes = await linhaMarca(MARCAS_FIXTURE.A.ativa);
      const put = await alterar(tk.adminB, MARCAS_FIXTURE.A.ativa, { nome: 'Sequestrada' });
      expect(put.statusCode, put.body).toBe(404);
      // o id é do cliente: colidir com o de outro tenant (viva ou apagada) = 409 ID_EM_USO, sem gravar, publicar nem ecoar o nome
      // (revisão final da T-0113, 🟡 1; R-20261108-093259-modulo-catalogo)
      const antesApagada = await linhaMarca(MARCAS_FIXTURE.A.apagada);
      for (const id of [MARCAS_FIXTURE.A.ativa, MARCAS_FIXTURE.A.apagada]) {
        const post = await criar(tk.adminB, { id, nome: 'Sequestrada' });
        expect([post.statusCode, erroDe(post).codigo], `${id}: ${post.body}`).toEqual([409, 'ID_EM_USO']);
        expect(post.body).not.toContain('Sequestrada');
        expect(await eventos(id)).toEqual([]);
      }
      expect(await linhaMarca(MARCAS_FIXTURE.A.ativa)).toEqual(antes);
      expect(await linhaMarca(MARCAS_FIXTURE.A.apagada)).toEqual(antesApagada);
      expect(await q('select 1 from catalogo.marca_concorrente where tenant_id = $1 and nome = $2', [B.tenantId, 'Sequestrada'])).toEqual([]);
    });

    it('MC-6 (RN-CORE-01): Catálogo desligado no tenant = 403 MODULO_INATIVO na lista e na escrita; religado, volta', async () => {
      expect((await licenca(api, tk.adminA, 'tenant', 'catalogo', false)).statusCode).toBe(200);
      try {
        const g = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/catalogo/marcas' });
        expect([g.statusCode, erroDe(g).codigo]).toEqual([403, 'MODULO_INATIVO']);
        const p = await criar(tk.analistaA, { id: randomUUID(), nome: 'Sem licença' });
        expect([p.statusCode, erroDe(p).codigo]).toEqual([403, 'MODULO_INATIVO']);
      } finally {
        expect((await licenca(api, tk.adminA, 'tenant', 'catalogo', true)).statusCode).toBe(200);
      }
      expect((await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/catalogo/marcas' })).statusCode).toBe(200);
    });

    it('MC-7 (RN-CAT-13, ADR 0034 §6): renomear atualiza o retrato marca_nome das referências na mesma transação (updated_at sobe) e o "Equivale a" da busca; evento `alterada`', async () => {
      const id = MARCAS_FIXTURE.A.ativa;
      const antes = await q<{ id: string; updated_at: Date }>('select id, updated_at from catalogo.produto_referencia where marca_id = $1 and deleted_at is null order by id', [id]);
      expect(antes.length).toBe(2);
      ok(await alterar(tk.analistaA, id, { nome: 'Freios Rivais Renomeada' }), 'renomear');
      try {
        const depois = await q<{ id: string; updated_at: Date; marca_nome: string | null }>('select id, updated_at, marca_nome from catalogo.produto_referencia where marca_id = $1 and deleted_at is null order by id', [id]);
        expect(depois.map((r) => r.marca_nome)).toEqual(['Freios Rivais Renomeada', 'Freios Rivais Renomeada']);
        depois.forEach((r, i) => expect(r.updated_at.getTime(), r.id).toBeGreaterThan(antes[i]!.updated_at.getTime()));
        expect((await buscar(tk.vA, 'cb3401'))[0]).toMatchObject({ erp_code: 'ALFA-001', equivale_a: { marca_id: id, marca_nome: 'Freios Rivais Renomeada', codigo: 'CB 3401' } });
        expect((await eventos(id)).at(-1)).toMatchObject({ id, nome: 'Freios Rivais Renomeada', fato: 'alterada' });
      } finally {
        ok(await alterar(tk.analistaA, id, { nome: NOME_A }), 'nome de volta');
      }
      expect((await linhaMarca(id))?.nome).toBe(NOME_A);
    });

    it('MC-8 (RN-CAT-09/13, ADR 0034 §3 e §6): inativar tira a referência da busca, manda lápide no pull e tira a marca do seletor do Trade; reativar devolve tudo; eventos `inativada` e `reativada`', async () => {
      const id = MARCAS_FIXTURE.A.ativa;
      const ref = REFERENCIAS_FIXTURE.A.cb3401;
      ok(await alterar(tk.analistaA, id, { ativo: false }), 'inativar');
      try {
        expect((await linhaMarca(id))?.ativo).toBe(false);
        expect((await listar(tk.analistaA)).map((m) => m.id)).not.toContain(id);
        expect((await listar(tk.analistaA, '?situacao=inativas')).find((m) => m.id === id)).toMatchObject({ ativo: false, referencias: 2 });
        expect((await buscar(tk.vA, 'cb3401')).find((i) => i.erp_code === 'ALFA-001')?.equivale_a ?? null).toBeNull();
        // Trade: a marca inativa sai do seletor e não aceita produto novo
        expect((await marcasDoTrade(tk.analistaA)).map((m) => m.id)).not.toContain(id);
        const pc = await postProdutoConcorrente(tk.analistaA, produtoConcorrente(randomUUID(), id));
        expect([pc.statusCode, erroDe(pc).codigo]).toEqual([422, 'REFERENCIA_INVALIDA']);
        // aparelho (inclusive o APK antigo, que não conhece marca_concorrente): a referência vem como apagada
        await esperarHorizonte();
        expect((await puxarTudo(tk.vA, 'produto_referencia')).find((l) => l.id === ref)?.deleted_at ?? null).not.toBeNull();
        expect((await eventos(id)).at(-1)).toMatchObject({ id, ativo: false, fato: 'inativada' });
      } finally {
        ok(await alterar(tk.analistaA, id, { ativo: true }), 'reativar');
      }
      expect((await buscar(tk.vA, 'cb3401'))[0]).toMatchObject({ erp_code: 'ALFA-001', equivale_a: { marca_id: id, marca_nome: NOME_A } });
      expect((await marcasDoTrade(tk.analistaA)).map((m) => m.id)).toContain(id);
      await esperarHorizonte();
      expect((await puxarTudo(tk.vA, 'produto_referencia')).find((l) => l.id === ref)).toMatchObject({ deleted_at: null });
      expect((await eventos(id)).at(-1)).toMatchObject({ id, ativo: true, fato: 'reativada' });
    });

    it('MC-9 (ADR 0034 §1): não há exclusão de marca pela API (sem DELETE); a marca continua viva', async () => {
      const r = await api.chamar(tk.analistaA, { method: 'DELETE', url: `/v1/catalogo/marcas/${MARCAS_FIXTURE.A.inativa}` });
      expect(r.statusCode, r.body).toBeGreaterThanOrEqual(400);
      expect((await linhaMarca(MARCAS_FIXTURE.A.inativa))?.deleted_at).toBeNull();
    });
  });
});
