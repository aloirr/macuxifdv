/**
 * T-0084 (aplicação, critérios 2, 3, 6, 7 e 8) e T-0085 (referência cruzada, oferece junto, exportação, permissões) na API
 * REAL: `createApp` com os 8 módulos, JWT de verdade, Postgres como `macuxi_app` (RLS), o DESPACHANTE real da outbox
 * (`macuxi_worker`) e o Conector simulado falando com `/integracao/v1` (cabeçalhos da ADR 0013), na fixture dois-tenants num
 * banco efêmero próprio do arquivo. Agente `testes`, passo 5 da ordem das duas tarefas. Banco só no CI (sem Docker no PC).
 *
 * O que já está coberto e NÃO se repete aqui: o domain (expandirAplicacao, trechoServeEm, ranking, retratoAplicacao,
 * validarCadastroCatalogo, montarExportacao) nos testes unitários dos módulos; a busca offline com o FTS5 v3 real em
 * tests/modulos/catalogo-aplicacao-offline-t0084.test.ts; a base demo em tests/integracao/demo/catalogo-cadastro-demo-t0084.test.ts.
 *
 * Casos (matrizes docs/testes/T-0084.md e docs/testes/T-0085.md):
 *  H-1  (T-0084 c2, RN-CAT-11): aplicação de 2.500 caracteres vinda do ERP chega ao Catálogo com 2.000 e o aviso
 *       `aplicacao_cortada` no resultado do lote (Conector) e no monitor do BKO; > 20.000 = linha inválida.
 *  H-2  (T-0085 c1/K11): referências, oferece junto e etiquetas atravessam o Hub até o Catálogo; 4 referências = 3 + aviso
 *       `referencias_cortadas`; marca desconhecida não leva a marca (descartada até a marca opcional, R-20261115-073000; depois
 *       entra só com o código e marca_id nulo): as duas formas passam.
 *  H-3  (doc 06): `aplicacao` ausente não altera; `null` limpa.
 *  B-1  (T-0084 c3, RN-CAT-12) online: "pastilha uno 2012" acha com "Serve em" (inclui 2012); "2015" dá lista vazia (R-20261120-194335); "filtro gol 2014".
 *  B-2  (T-0084 c8) multi-tenant: a aplicação de A não aparece para B (busca e ficha) e vice-versa.
 *  P-1  (T-0084 c6, RN-VEN-19): o retrato vai cortado em 300 na palavra com "…"; desmarcado (null) e APK antigo (ausente)
 *       gravam nulo; a API recorta pelo parâmetro do tenant; reenvio idempotente.
 *  P-2  (T-0084 c7): a aplicação aparece no detalhe (Campo/Gestão/BKO: a mesma rota), no pull do aparelho, nos dois PDFs e no
 *       `vendedor.pedido.aprovado@1`; P-2e: o pedido enviado ao ERP (`GET /integracao/v1/pedidos/pendentes`, `ItemPedidoErp.aplicacao`)
 *       leva o texto (1.000 = inteiro); desmarcado (null) e APK antigo (ausente): o item e o pedido saem iguais, sem o texto.
 *  P-3  (T-0084 c8, regra 7): o promotor vê a aplicação na ficha (só leitura), não grava cadastro e não cria pedido.
 *  R-1  (T-0085 c4, RN-CAT-09) online: o código do concorrente acha o produto em 1º com "Equivale a" (retrato `marca_nome`
 *       para o vendedor sem o Promotor); marca inativa some da busca e da ficha de TODOS (T-0113: o cadastro é do Catálogo,
 *       `catalogo.marca_concorrente`, ADR 0034); multi-tenant. O cadastro de marcas em si: marcas-concorrentes-t0113.test.ts.
 *  R-2  (T-0085 c3/c6) limites, perfis e auditoria do `PUT .../cadastro-catalogo`.
 *  E-1  (T-0085 c6/c8) exportação: perfil, licença, tenant e `truncado` (20.001 produtos).
 */
import { createHash, randomUUID } from 'node:crypto';
import { FichaProduto, RespostaBusca, RespostaExportacao } from '@macuxi/catalogo/contracts';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteResultado, PedidosPendentes, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import { OrderDetail } from '@macuxi/vendedor/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { MARCAS_FIXTURE } from '../../../db/seeds/fixtures/dois-tenants';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { retratoAplicacao } from '../../../modules/vendedor/domain/aplicacao';
import { buildOrderPdfHtml, escapeHtml, pdfDoPedido } from '../../../modules/vendedor/domain/pdf-pedido';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

// o `titulo_vencido_dias = 30` do tenant A vale só para este arquivo: o afterAll apaga (os outros arquivos contam com o padrão 5)
const LIMPAR_VENCIDO_DIAS = "delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = 'titulo_vencido_dias'";

const P = `T84${randomUUID().slice(0, 4).toUpperCase()}`;
const EXT = { p1: `${P}-P1`, p2: `${P}-P2`, p3: `${P}-P3` } as const;
const IP_A = '198.51.100.10';
const VERSAO_CONECTOR = '1.2.0';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 2.500 caracteres em palavras de 9 letras (com acento), o 2.000º caractere é letra: o corte esperado é o prefixo exato. */
const APLICACAO_2500 = Array.from({ length: 2500 }, (_, i) => (i % 10 === 4 ? ' ' : i % 3 === 0 ? 'ã' : 'a')).join('');
const APL_UNO = 'Fiat Uno 1.0/1.4 2010–2014; Fiat Palio 1.0/1.4 2012–2016';
const APL_GOL = 'VW Gol G5/G6 1.0/1.6 2009–2016';
/** 400 caracteres em palavras: o retrato (300) corta na última palavra inteira com "…". */
const APL_400 = Array.from({ length: 40 }, (_, i) => `Carro${String(i).padStart(3, '0')}x`).join(' ').padEnd(400, 'z');
/** Exatamente 1.000 caracteres em palavras (teto do item do pedido no contrato e de `aplicacao_max_orcamento`): chega inteiro ao ERP. */
const APL_1000 = Array.from({ length: 100 }, (_, i) => `Modelo${String(i).padStart(3, '0')}`).join(' ').padEnd(1000, 'z');
const PED_ERP = { com: '0f840000-0000-4000-8000-000000000007', sem: '0f840000-0000-4000-8000-000000000008', nulo: '0f840000-0000-4000-8000-000000000009' } as const;
const PED = Object.fromEntries(['longo', 'nulo', 'ausente', 'curto', 'param', 'promotor'].map((k, i) => [k, `0f840000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`])) as Record<
  'longo' | 'nulo' | 'ausente' | 'curto' | 'param' | 'promotor',
  string
>;

describe.skipIf(semBanco())('T-0084/T-0085 — aplicação e referência cruzada do Hub ao PDF (createApp real × Postgres × despachante)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const tk = { vA: '', vB: '', analistaA: '', adminA: '', adminB: '', promotorA: '', gerenteA: '' };
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  let concorrenteA = '';
  let alfa1 = '';
  let alfa2 = '';

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  /** Despachante real com espera zero: um consumidor que depende de outro (Catálogo × Core) tenta de novo no ciclo seguinte. */
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
    for (let i = 0; i < 60; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 60 ciclos');
  };
  const eventosComFalha = () =>
    q<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0', [A.tenantId]);

  // ---------- Conector simulado de A (ADR 0013) ----------
  const cab = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${A.integracao.chave.chave}`,
    'x-macuxi-conector-id': A.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
    ...extra,
  });
  const hub = (method: 'GET' | 'POST', url: string, payload?: object, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    api.app.inject({ method, url: `/integracao/v1${url}`, headers: cab(extra), remoteAddress: IP_A, ...(payload ? { payload } : {}) });
  let relogioErp = Date.now() - 10 * 60_000;
  const alterado = () => new Date((relogioErp += 1_000)).toISOString();
  const enviarProdutos = async (registros: object[]) => {
    const corpo = { versao_contrato: VERSAO_CONTRATO, entidade: 'produto', modo: 'delta', conector_id: A.integracao.identificador, versao_conector: VERSAO_CONECTOR, enviado_em: new Date().toISOString(), registros };
    const r = await hub('POST', '/lotes', corpo, { 'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })) });
    expect(r.statusCode, r.body).toBe(202);
    const loteId = (r.json() as { lote_id: string }).lote_id;
    await despachar();
    const c = await hub('GET', `/lotes/${loteId}`);
    expect(c.statusCode, c.body).toBe(200);
    return { loteId, resultado: LoteResultado.parse(c.json()) };
  };
  const produtoPorExternal = async (ext: string) => (await q<{ id: string }>('select id from core.produto where tenant_id = $1 and external_id = $2 and deleted_at is null', [A.tenantId, ext]))[0]?.id;
  const aplicacaoNoBanco = async (produtoId: string) =>
    (await q<{ aplicacoes: string | null; etiquetas: string[] }>('select aplicacoes, etiquetas from catalogo.produto_conteudo where produto_id = $1 and deleted_at is null', [produtoId]))[0];
  const referenciasNoBanco = (produtoId: string) =>
    q<{ marca_id: string; codigo: string; ordem: number; marca_nome: string | null }>('select marca_id, codigo, ordem, marca_nome from catalogo.produto_referencia where produto_id = $1 and deleted_at is null order by ordem', [produtoId]);

  // ---------- Catálogo e Vendedor ----------
  const buscar = (t: string, texto: string) => api.chamar(t, { method: 'GET', url: `/v1/catalogo/busca?q=${encodeURIComponent(texto)}&limit=20&mode=basica` });
  const itensDaBusca = async (t: string, texto: string) => {
    const r = await buscar(t, texto);
    expect(r.statusCode, `busca "${texto}": ${r.body}`).toBe(200);
    return RespostaBusca.parse(r.json()).items;
  };
  const ficha = (t: string, id: string) => api.chamar(t, { method: 'GET', url: `/v1/catalogo/produtos/${id}` });
  const salvarCadastro = (t: string, id: string, corpo: Record<string, unknown>) =>
    api.chamar(t, { method: 'PUT', url: `/v1/catalogo/produtos/${id}/cadastro-catalogo`, payload: { aplicacao: null, oferece_junto: [], etiquetas: [], ...corpo } });
  const push = async (t: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(t, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const pedido = (id: string, item: Record<string, unknown>) => ({ entidade: 'pedido', id, operacao: 'upsert', payload: { id, customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: alfa1, quantity: 1, ...item }] } });
  const itemNoBanco = async (pedidoId: string) => (await q<{ id: string; aplicacao: string | null }>('select id, aplicacao from vendedor.pedido_item where pedido_id = $1 order by sequencia', [pedidoId]));

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    // T-0184 (P1 A): o A.c1 da fixture tem título vencido há 10 dias e iria para aprovação por inadimplência (RN-VEN-13), com
    // qualquer forma de pagamento; este arquivo não trata disso (tests/integracao/api/aprovacao-motivo-t0184.test.ts trata)
    await api.admin.query(LIMPAR_VENCIDO_DIAS, [A.tenantId]); // sobra de uma rodada interrompida
    await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'titulo_vencido_dias', '30')", [A.tenantId]);
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o Hub precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.vA = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.vB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    tk.analistaA = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.promotorA = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.gerenteA = (await api.sessao('gerente@exemplo.com.br')).access_token;
    expect((await licenca(api, tk.adminA, 'tenant', 'integracao', true)).statusCode).toBe(200);
    for (const perfil of ['admin', 'analista']) expect((await licenca(api, tk.adminA, 'perfil', 'integracao', true, perfil)).statusCode).toBe(200);
    // eventos antigos da fixture e lotes `recebido` sem staging não podem segurar a fila da carga (mesma premissa do ciclo-erp)
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    // T-0113 (0045, ADR 0034): a marca é do Catálogo; a ativa da fixture tem o MESMO id do concorrente antigo do Promotor
    concorrenteA = MARCAS_FIXTURE.A.ativa;
    expect(await q('select 1 from catalogo.marca_concorrente where tenant_id = $1 and id = $2 and ativo and deleted_at is null', [A.tenantId, concorrenteA])).toHaveLength(1);
    alfa1 = A.produtos.p1;
    alfa2 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-002'", [A.tenantId]))[0]!.id;
  }, 300_000);

  afterAll(async () => {
    await api?.admin.query(LIMPAR_VENCIDO_DIAS, [A.tenantId]).catch(() => undefined);
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ Hub → Catálogo
  describe('H. Do ERP ao Catálogo pelo Hub (/integracao/v1/lotes → despachante → consumidores)', () => {
    let loteId = '';
    let resultado: LoteResultado;
    let id1 = '';
    let id2 = '';

    beforeAll(async () => {
      const base = (ext: string, sku: string, nome: string) => ({ external_id: ext, alterado_em: alterado(), sku, ean: null, nome, marca: 'Norfreio', categoria: 'Freios', unidade: 'PC' });
      ({ loteId, resultado } = await enviarProdutos([
        {
          ...base(EXT.p1, `${P}-SKU1`, `Pastilha ${P}`),
          aplicacao: APLICACAO_2500,
          referencias: [
            { marca_nome: 'Freios Rivais', codigo: 'XY 1001' },
            { marca_nome: 'Marca Que Nao Existe', codigo: 'ZZ 0001' },
          ],
          oferece_junto: ['ERP-A-001'],
          etiquetas: ['Dianteira', 'Novo'],
        },
        {
          ...base(EXT.p2, `${P}-SKU2`, `Disco ${P}`),
          aplicacao: APL_GOL,
          referencias: ['R1', 'R2', 'R3', 'R4'].map((codigo) => ({ marca_nome: 'Freios Rivais', codigo })),
          oferece_junto: [EXT.p1, 'ERP-A-001'],
        },
        // proteção do contrato: acima de 20.000 caracteres a linha é inválida (as outras seguem)
        { ...base(EXT.p3, `${P}-SKU3`, `Tambor ${P}`), aplicacao: 'x'.repeat(20_001) },
      ]));
      id1 = (await produtoPorExternal(EXT.p1))!;
      id2 = (await produtoPorExternal(EXT.p2))!;
    }, 240_000);

    it('H-1 (RN-CAT-11): 2.500 caracteres chegam ao Catálogo com 2.000 (prefixo exato) e o aviso aplicacao_cortada no resultado do lote', async () => {
      expect(await eventosComFalha(), 'nenhum consumidor parado').toEqual([]);
      expect(id1, 'produto do ERP criado pelo Core').toBeTruthy();
      const conteudo = await aplicacaoNoBanco(id1);
      expect(conteudo?.aplicacoes?.length).toBe(2000);
      expect(conteudo?.aplicacoes).toBe(APLICACAO_2500.slice(0, 2000));
      const aviso = resultado.avisos.find((a) => a.codigo === 'aplicacao_cortada');
      expect(aviso, JSON.stringify(resultado.avisos)).toMatchObject({ external_id: EXT.p1 });
      expect(aviso!.mensagem).toMatch(/2500.*2000|2\.500.*2\.000/);
      // a ficha devolve o texto inteiro gravado (2.000)
      const f = await ficha(tk.vA, id1);
      expect(f.statusCode, f.body).toBe(200);
      expect((f.json() as { catalogo?: { aplicacao: string | null } }).catalogo?.aplicacao?.length).toBe(2000);
    });

    it('H-1b (RN-CAT-11, monitor do BKO): o analista vê o mesmo aviso em GET /v1/integracao/lotes/:id; o lote aparece no monitor', async () => {
      const r = await api.chamar(tk.analistaA, { method: 'GET', url: `/v1/integracao/lotes/${loteId}` });
      expect(r.statusCode, r.body).toBe(200);
      const bko = LoteResultado.parse(r.json());
      expect(bko.avisos.map((a) => [a.codigo, a.external_id])).toEqual(expect.arrayContaining([['aplicacao_cortada', EXT.p1]]));
      const m = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/integracao/monitor' });
      expect(m.statusCode, m.body).toBe(200);
      expect(m.body).toContain(loteId);
      // o vendedor não vê o monitor (ação monitor.ver)
      expect((await api.chamar(tk.vA, { method: 'GET', url: `/v1/integracao/lotes/${loteId}` })).statusCode).toBe(403);
    });

    it('H-1c (contrato, proteção): aplicação acima de 20.000 caracteres = linha inválida, as outras do lote seguem', async () => {
      expect(resultado.erros.map((e) => e.external_id)).toContain(EXT.p3);
      expect(await produtoPorExternal(EXT.p3)).toBeUndefined();
      expect(resultado.contagens.com_erro).toBe(1);
    });

    it('H-2 (T-0085 K11, RN-CAT-09): referências, oferece junto e etiquetas atravessam o Hub; marca desconhecida não vira marca (descartada ou só com o código); 4 referências = 3 + aviso', async () => {
      // marca desconhecida (RN-CAT-09): antes da marca opcional a referência era descartada; com ela (R-20261115-073000) entra só
      // com o código. Nos dois casos a marca desconhecida nunca vira marca_id nem marca_nome.
      const refs1 = await referenciasNoBanco(id1);
      expect(refs1.filter((r) => r.marca_id !== null)).toEqual([{ marca_id: concorrenteA, codigo: 'XY 1001', ordem: 1, marca_nome: 'Freios Rivais' }]);
      expect(refs1.filter((r) => r.marca_id === null).map((r) => [r.codigo, r.marca_nome])).toEqual(refs1.length === 1 ? [] : [['ZZ 0001', null]]);
      expect((await aplicacaoNoBanco(id1))?.etiquetas).toEqual(['Dianteira', 'Novo']);
      const rel = await q<{ produto_id: string; relacionado_id: string }>("select produto_id, relacionado_id from catalogo.produto_relacao where produto_id = any($1::uuid[]) and tipo = 'complementar' and deleted_at is null order by produto_id, ordem", [[id1, id2]]);
      expect(rel.filter((x) => x.produto_id === id1).map((x) => x.relacionado_id)).toEqual([alfa1]);
      expect(rel.filter((x) => x.produto_id === id2).map((x) => x.relacionado_id)).toEqual([id1, alfa1]);
      expect((await referenciasNoBanco(id2)).map((r) => r.codigo)).toEqual(['R1', 'R2', 'R3']);
      expect(resultado.avisos.find((a) => a.codigo === 'referencias_cortadas'), JSON.stringify(resultado.avisos)).toMatchObject({ external_id: EXT.p2 });
      // a ficha do Catálogo mostra o que veio do ERP (analista tem o Promotor: nome do cadastro)
      // (leitura crua: o produto do ERP ainda não tem preço, e a ficha do analista sem cliente não é o ponto aqui)
      const f = (await ficha(tk.analistaA, id1)).json() as { catalogo?: { referencias?: { marca_id: string | null; marca_nome: string | null; codigo: string }[] } };
      expect(f.catalogo).toMatchObject({ oferece_junto: [{ produto_id: alfa1, erp_code: 'ALFA-001' }], etiquetas: ['Dianteira', 'Novo'] });
      const refsFicha = f.catalogo?.referencias ?? [];
      expect(refsFicha.filter((r) => r.marca_id !== null)).toEqual([{ marca_id: concorrenteA, marca_nome: 'Freios Rivais', codigo: 'XY 1001' }]);
      expect(refsFicha.filter((r) => r.marca_id === null)).toEqual(refs1.length === 1 ? [] : [{ marca_id: null, marca_nome: null, codigo: 'ZZ 0001' }]);
    });

    it('H-3 (doc 06): aplicacao ausente não altera; null limpa', async () => {
      await enviarProdutos([{ external_id: EXT.p2, alterado_em: alterado(), sku: `${P}-SKU2`, ean: null, nome: `Disco ${P} v2`, marca: 'Norfreio', categoria: 'Freios', unidade: 'PC' }]);
      expect((await aplicacaoNoBanco(id2))?.aplicacoes, 'ausente = não altera').toBe(APL_GOL);
      await enviarProdutos([{ external_id: EXT.p2, alterado_em: alterado(), sku: `${P}-SKU2`, ean: null, nome: `Disco ${P} v3`, marca: 'Norfreio', categoria: 'Freios', unidade: 'PC', aplicacao: null }]);
      expect((await aplicacaoNoBanco(id2))?.aplicacoes ?? null, 'null = limpa').toBeNull();
      expect(await eventosComFalha()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ Busca online
  describe('B. Busca online com a aplicação (cadastro pelo BKO)', () => {
    beforeAll(async () => {
      const r1 = await salvarCadastro(tk.analistaA, alfa1, { aplicacao: APL_UNO, oferece_junto: [alfa2], referencias: [{ marca_id: concorrenteA, codigo: 'CB 3401' }, { marca_id: concorrenteA, codigo: 'FR-77.2' }], etiquetas: ['Dianteira'] });
      expect(r1.statusCode, r1.body).toBe(200);
      const r2 = await salvarCadastro(tk.analistaA, alfa2, { aplicacao: APL_GOL });
      expect(r2.statusCode, r2.body).toBe(200);
    });

    it('B-1 (RN-CAT-12 + R-20261120-194335): "pastilha uno 2012" acha ALFA-001 com "Serve em" (≤ 90, inclui 2012); "pastilha uno 2015" (ninguém casa tudo) dá lista vazia; "filtro gol 2014" acha ALFA-002', async () => {
      const r = await itensDaBusca(tk.vA, 'pastilha uno 2012');
      const item = r.find((i) => i.erp_code === 'ALFA-001');
      expect(item, JSON.stringify(r.map((i) => i.erp_code))).toBeTruthy();
      expect(item!.serve_em).toMatchObject({ inclui_ano: 2012 });
      expect(item!.serve_em!.texto.length).toBeLessThanOrEqual(90);
      expect(item!.serve_em!.texto).toContain('Uno');
      // 2015 fora do Uno 2010–2014 (o Palio 2012–2016 é outro trecho, T-0084-A4): ninguém casa as 3 palavras
      const fora = await itensDaBusca(tk.vA, 'pastilha uno 2015');
      expect(fora.map((i) => i.erp_code)).toEqual([]);
      const gol = await itensDaBusca(tk.vA, 'filtro gol 2014');
      expect(gol[0]?.erp_code).toBe('ALFA-002');
      expect(gol[0]!.serve_em).toMatchObject({ inclui_ano: 2014 });
    });

    it('B-2 (RN-CAT-01, multi-tenant): a aplicação de A não aparece para B e a de B não aparece para A', async () => {
      expect((await itensDaBusca(tk.vB, 'pastilha uno 2012')).map((i) => i.erp_code)).not.toContain('ALFA-001');
      expect((await itensDaBusca(tk.vB, 'uno palio')).map((i) => i.erp_code)).toEqual([]);
      // B tem "Carros flex 1.0 a 2.0 2015–2020" no BETA-001: só B acha pelo texto
      expect((await itensDaBusca(tk.vB, 'carros flex 2017')).map((i) => i.erp_code)).toContain('BETA-001');
      expect((await itensDaBusca(tk.vA, 'carros flex 2017')).map((i) => i.erp_code)).not.toContain('BETA-001');
      const deB = await ficha(tk.vB, alfa1);
      expect([deB.statusCode, erroDe(deB).codigo]).toEqual([404, 'PRODUTO_NAO_ENCONTRADO']);
      expect(deB.body).not.toContain('Uno');
    });
  });

  // ------------------------------------------------------------------------------------------------ Referência cruzada
  describe('R. Referência cruzada (RN-CAT-09) e cadastro do Catálogo (K9)', () => {
    it.each(['cb3401', 'CB-3401', 'cb 3401'])('R-1 "%s": ALFA-001 em 1º com "Equivale a: Freios Rivais CB 3401" (vendedor sem o Promotor lê o retrato marca_nome)', async (texto) => {
      const r = await itensDaBusca(tk.vA, texto);
      expect(r[0]?.erp_code, JSON.stringify(r.map((i) => i.erp_code))).toBe('ALFA-001');
      expect(r[0]!.equivale_a).toMatchObject({ marca_id: concorrenteA, marca_nome: 'Freios Rivais', codigo: 'CB 3401' });
      expect(r[0]!.equivale_a!.marcas.length).toBeGreaterThan(0);
    });

    it('R-1b (multi-tenant): B não acha a pastilha de A pelo código do concorrente de A; A não acha o óleo de B por "lb0099"', async () => {
      expect((await itensDaBusca(tk.vB, 'cb3401')).map((i) => i.erp_code)).not.toContain('ALFA-001');
      expect((await itensDaBusca(tk.vA, 'lb0099')).map((i) => i.erp_code)).not.toContain('BETA-001');
      expect((await itensDaBusca(tk.vB, 'lb0099'))[0]?.erp_code).toBe('BETA-001');
    });

    describe('promotor com o Catálogo no perfil (marcas do cadastro do Catálogo, T-0113)', () => {
      beforeAll(async () => {
        expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      });
      afterAll(async () => {
        await api.admin.query('update catalogo.marca_concorrente set ativo = true where id = $1', [concorrenteA]);
        expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
      });

      it('P-3/R-1c (RN-CAT-05 revista, T-0084 c8): o promotor vê a ficha com aplicação, referências, oferece junto, etiquetas e estoque, sem preço; acha por "cb3401"', async () => {
        const f = await ficha(tk.promotorA, alfa1);
        expect(f.statusCode, f.body).toBe(200);
        const fp = FichaProduto.parse(f.json());
        expect(fp.product).toMatchObject({ price_stock_visible: false, price: null });
        // RN-CAT-05 revista (catálogo v2, #503): o estoque é de todos os perfis
        expect(fp.product.availability).not.toBeNull();
        expect(fp.catalogo).toMatchObject({ aplicacao: APL_UNO, oferece_junto: [{ produto_id: alfa2 }], etiquetas: ['Dianteira'] });
        expect(fp.catalogo!.referencias.map((r) => `${r.marca_nome} ${r.codigo}`)).toEqual(['Freios Rivais CB 3401', 'Freios Rivais FR-77.2']);
        const r = await itensDaBusca(tk.promotorA, 'cb3401');
        expect(r[0]).toMatchObject({ erp_code: 'ALFA-001', equivale_a: { marca_nome: 'Freios Rivais', codigo: 'CB 3401' } });
      });

      it('P-3b (regra 7): o promotor não grava o cadastro do Catálogo (403) nem cria pedido com aplicação (rejeitado/403); nada gravado', async () => {
        const put = await salvarCadastro(tk.promotorA, alfa1, { aplicacao: 'invasão' });
        expect([put.statusCode, erroDe(put).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
        const r = await api.chamar(tk.promotorA, { method: 'POST', url: '/v1/sync/push', payload: { itens: [pedido(PED.promotor, { aplicacao: APL_UNO })] } });
        if (r.statusCode === 200) expect((r.json() as { resultados: ResultadoItemPush[] }).resultados[0]!.status).toBe('rejeitado');
        else expect(r.statusCode).toBe(403);
        expect(await q('select 1 from vendedor.pedido where id = $1', [PED.promotor])).toEqual([]);
        expect((await aplicacaoNoBanco(alfa1))?.aplicacoes).toBe(APL_UNO);
      });

      it('R-1d (RN-CAT-09, ADR 0034 §6): marca inativa no cadastro do Catálogo tira o "Equivale a" da busca e da ficha de todos (promotor, analista e vendedor)', async () => {
        // T-0119 (D-T0107b): a busca lê um retrato do catálogo do tenant em memória (TTL 60 s) que só as gravações do PRÓPRIO
        // Catálogo descartam; por isso a marca é inativada e reativada pela rota do cadastro de marcas (RN-CAT-13, marca.gerenciar),
        // como no BKO — um UPDATE direto no banco ficaria invisível à busca até o TTL vencer
        const marca = (ativo: boolean) => api.chamar(tk.analistaA, { method: 'PUT', url: `/v1/catalogo/marcas/${concorrenteA}`, payload: { ativo } });
        const inativar = await marca(false);
        expect(inativar.statusCode, inativar.body).toBe(200);
        try {
          for (const t of [tk.promotorA, tk.vA]) {
            const r = await itensDaBusca(t, 'cb3401');
            expect(r.find((i) => i.erp_code === 'ALFA-001')?.equivale_a ?? null).toBeNull();
          }
          expect(((await ficha(tk.analistaA, alfa1)).json() as { catalogo: { referencias: unknown[] } }).catalogo.referencias).toEqual([]);
        } finally {
          const reativar = await marca(true);
          expect(reativar.statusCode, reativar.body).toBe(200);
        }
        // reativada, volta (o retrato marca_nome não se perdeu)
        expect((await itensDaBusca(tk.vA, 'cb3401'))[0]).toMatchObject({ erp_code: 'ALFA-001', equivale_a: { marca_id: concorrenteA, marca_nome: 'Freios Rivais' } });
      });
    });

    it('R-2 (RN-CAT-09/11, K9): limites revalidados na API = 422 com a regra; nada muda', async () => {
      const casos: Array<[string, Record<string, unknown>, string]> = [
        ['4 referências', { referencias: ['A1', 'A2', 'A3', 'A4'].map((codigo) => ({ marca_id: concorrenteA, codigo })) }, 'RN-CAT-09'],
        ['código com 31', { referencias: [{ marca_id: concorrenteA, codigo: 'X'.repeat(31) }] }, 'RN-CAT-09'],
        ['marca inexistente', { referencias: [{ marca_id: randomUUID(), codigo: 'CB 1' }] }, 'RN-CAT-09'],
        // T-0113 (ADR 0034): a marca é validada no cadastro do próprio Catálogo
        ['marca inativa', { referencias: [{ marca_id: MARCAS_FIXTURE.A.inativa, codigo: 'CB 1' }] }, 'RN-CAT-09'],
        ['marca apagada', { referencias: [{ marca_id: MARCAS_FIXTURE.A.apagada, codigo: 'CB 1' }] }, 'RN-CAT-09'],
        ['marca de outro tenant', { referencias: [{ marca_id: MARCAS_FIXTURE.B.ativa, codigo: 'CB 1' }] }, 'RN-CAT-09'],
        ['6 em oferece junto', { oferece_junto: Array.from({ length: 6 }, () => randomUUID()) }, 'RN-CAT-09'],
        ['o próprio produto', { oferece_junto: [alfa1] }, 'RN-CAT-09'],
        ['5 etiquetas', { etiquetas: ['a', 'b', 'c', 'd', 'e'] }, 'RN-CAT-09'],
        ['aplicação 2.001', { aplicacao: 'a'.repeat(2001) }, 'RN-CAT-11'],
      ];
      for (const [nome, corpo, regra] of casos) {
        const r = await salvarCadastro(tk.analistaA, alfa1, { aplicacao: APL_UNO, ...corpo });
        expect([r.statusCode, erroDe(r).codigo], `${nome}: ${r.body}`).toEqual([422, regra]);
      }
      expect((await aplicacaoNoBanco(alfa1))?.aplicacoes).toBe(APL_UNO);
      expect((await referenciasNoBanco(alfa1)).map((r) => r.codigo)).toEqual(['CB 3401', 'FR-77.2']);
    });

    it('R-2b (RN-CAT-04, multi-tenant): vendedor = 403 PERFIL_SEM_ACESSO; o admin de B não acha o produto de A (404)', async () => {
      const v = await salvarCadastro(tk.vA, alfa1, { aplicacao: 'x' });
      expect([v.statusCode, erroDe(v).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
      const b = await salvarCadastro(tk.adminB, alfa1, { aplicacao: 'x' });
      expect([b.statusCode, erroDe(b).codigo]).toEqual([404, 'PRODUTO_NAO_ENCONTRADO']);
      expect((await aplicacaoNoBanco(alfa1))?.aplicacoes).toBe(APL_UNO);
    });

    it('R-2c (auditoria sem dado do texto): o PUT do analista grava produto.enriquecer com o evento cadastro_alterado, tamanhos e códigos', async () => {
      const [aud] = await q<{ usuario_id: string; depois: Record<string, unknown> }>(
        "select usuario_id, depois from plataforma.auditoria where entidade_id = $1 and acao = 'produto.enriquecer' and depois->>'evento' = 'catalogo.produto.cadastro_alterado' order by created_at desc limit 1",
        [alfa1],
      );
      expect(aud).toMatchObject({ usuario_id: A.usuarios.analista, depois: { aplicacao_tamanho: APL_UNO.length, oferece_junto: [alfa2] } });
      expect(JSON.stringify(aud!.depois)).not.toContain('Uno');
    });
  });

  // ------------------------------------------------------------------------------------------------ Pedido e saídas
  describe('P. Pedido com o retrato da aplicação (RN-VEN-19) e as saídas', () => {
    const retrato300 = retratoAplicacao(APL_400, true, 300)!;

    beforeAll(async () => {
      const r = await push(tk.vA, [
        pedido(PED.longo, { aplicacao: APL_400 }),
        pedido(PED.nulo, { aplicacao: null }),
        pedido(PED.ausente, {}),
        pedido(PED.curto, { aplicacao: APL_UNO }),
      ]);
      expect(r.map((x) => x.status), JSON.stringify(r)).toEqual(['aceito', 'aceito', 'aceito', 'aceito']);
      await despachar();
    });

    it('P-1 (RN-VEN-19): 400 caracteres = retrato de ≤ 300 terminando em palavra inteira + "…"; desmarcado e APK antigo = nulo; curto fica igual', async () => {
      expect(retrato300.length).toBeLessThanOrEqual(300);
      expect(retrato300.endsWith('…')).toBe(true);
      expect(APL_400.startsWith(retrato300.slice(0, -1))).toBe(true);
      expect((await itemNoBanco(PED.longo))[0]!.aplicacao).toBe(retrato300);
      expect((await itemNoBanco(PED.nulo))[0]!.aplicacao).toBeNull();
      expect((await itemNoBanco(PED.ausente))[0]!.aplicacao).toBeNull();
      expect((await itemNoBanco(PED.curto))[0]!.aplicacao).toBe(APL_UNO);
    });

    it('P-1b (RN-VEN-33): reenvio do mesmo pedido é idempotente (aceito, mesmo item, mesmo retrato)', async () => {
      const antes = await itemNoBanco(PED.longo);
      expect((await push(tk.vA, [pedido(PED.longo, { aplicacao: APL_400 })]))[0]!.status).toBe('aceito');
      expect(await itemNoBanco(PED.longo)).toEqual(antes);
    });

    it('P-1c (RN-VEN-19): a API revalida pelo parâmetro do tenant (aplicacao_max_orcamento = 100) e nunca recusa por tamanho', async () => {
      await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'aplicacao_max_orcamento', '100'::jsonb)", [A.tenantId]);
      try {
        const [r] = await push(tk.vA, [pedido(PED.param, { aplicacao: APL_400 })]);
        expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
        const gravado = (await itemNoBanco(PED.param))[0]!.aplicacao!;
        expect(gravado).toBe(retratoAplicacao(APL_400, true, 100));
        expect(gravado.length).toBeLessThanOrEqual(100);
      } finally {
        await api.admin.query("update plataforma.parametro set deleted_at = now() where tenant_id = $1 and modulo = 'vendedor' and chave = 'aplicacao_max_orcamento' and deleted_at is null", [A.tenantId]);
      }
    });

    it('P-2 (T-0084 c7): o detalhe do pedido (vendedor no Campo; gerente na Gestão e no BKO) traz "application" no item', async () => {
      for (const t of [tk.vA, tk.gerenteA]) {
        const r = await api.chamar(t, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.longo}` });
        expect(r.statusCode, r.body).toBe(200);
        expect(OrderDetail.parse(r.json()).items[0]).toMatchObject({ application: retrato300 });
      }
      const nulo = OrderDetail.parse((await api.chamar(tk.vA, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.nulo}` })).json());
      expect(nulo.items[0]!.application ?? null).toBeNull();
    });

    it('P-2b (T-0084 c7, offline): o pull do aparelho leva pedido_item.aplicacao (o detalhe do Campo e da Gestão lê daqui)', async () => {
      await esperarHorizonte();
      const r = await api.chamar(tk.vA, { method: 'GET', url: '/v1/sync/pull?entidade=pedido_item' });
      expect(r.statusCode, r.body).toBe(200);
      const itens = (r.json() as { itens: Array<{ id: string; aplicacao?: string | null }> }).itens;
      const [longo] = await itemNoBanco(PED.longo);
      const [nulo] = await itemNoBanco(PED.nulo);
      expect(itens.find((i) => i.id === longo!.id)?.aplicacao).toBe(retrato300);
      expect(itens.find((i) => i.id === nulo!.id)?.aplicacao ?? null).toBeNull();
      // multi-tenant: o aparelho de B não recebe o item de A
      const b = await api.chamar(tk.vB, { method: 'GET', url: '/v1/sync/pull?entidade=pedido_item' });
      expect((b.json() as { itens: Array<{ id: string }> }).itens.map((i) => i.id)).not.toContain(longo!.id);
      const det = await api.chamar(tk.vB, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.longo}` });
      expect(det.statusCode).toBe(404);
    });

    it('P-2c (T-0084 c7): os dois PDFs (cliente e interno) mostram "Aplicação: <retrato>" abaixo da descrição; sem retrato, sem a linha', async () => {
      const ctx = { tenant_name: 'Distribuidora Alfa', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: new Date().toISOString() };
      const d = OrderDetail.parse((await api.chamar(tk.gerenteA, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.longo}` })).json());
      for (const vista of ['customer', 'bko'] as const) expect(buildOrderPdfHtml(pdfDoPedido(d), vista, ctx), vista).toContain(`Aplicação: ${escapeHtml(retrato300)}`);
      const semRetrato = OrderDetail.parse((await api.chamar(tk.gerenteA, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.nulo}` })).json());
      expect(buildOrderPdfHtml(pdfDoPedido(semRetrato), 'customer', ctx)).not.toContain('Aplicação:');
    });

    it('P-2d (T-0084 c7, C13): vendedor.pedido.aprovado@1 leva itens[].aplicacao (o retrato) para o Hub', async () => {
      const [p] = await q<{ status: string }>('select status from vendedor.pedido where id = $1', [PED.longo]);
      expect(p!.status, 'pedido de 1 item sem desconto sai aprovado na alçada').toBe('approved');
      const [ev] = await q<{ payload: { itens: Array<{ aplicacao?: string | null }> } }>("select payload from plataforma.evento where agregado_id = $1 and nome = 'vendedor.pedido.aprovado@1'", [PED.longo]);
      expect(ev!.payload.itens[0]!.aplicacao).toBe(retrato300);
    });

    // Achado T-0084-A1 resolvido pelo modulo-integracao (R-20261106-040948): `ItemPedidoErp.aplicacao` (TextoOpcional 1000, aditivo na v1).
    it('P-2e (T-0084 c7, C14, RN-VEN-19): pedido aprovado com aplicação chega à fila do ERP com o texto (no limite de 1.000); desmarcado (null) e APK antigo (ausente): nada muda', async () => {
      // A fixture não tem chave do ERP no cliente nem no vendedor: sem elas o Hub RETÉM o pedido (montarSnapshotParaFila), e o
      // retido nunca sai em /pedidos/pendentes. A condição padrão AVISTA já tem de-para (001) na fixture.
      const extCli = `${P}-CLI`;
      const extVen = `${P}-VEN`;
      await api.admin.query('update core.cliente set external_id = $2 where id = $1', [A.clientes.c1, extCli]);
      await api.admin.query('update core.usuario set external_id = $2 where id = $1', [A.usuarios.vendedor1, extVen]);
      await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'aplicacao_max_orcamento', '1000'::jsonb)", [A.tenantId]);
      try {
        const r = await push(tk.vA, [pedido(PED_ERP.com, { aplicacao: APL_1000 }), pedido(PED_ERP.sem, {}), pedido(PED_ERP.nulo, { aplicacao: null })]);
        expect(r.map((x) => x.status), JSON.stringify(r)).toEqual(['aceito', 'aceito', 'aceito']);
        expect((await itemNoBanco(PED_ERP.com))[0]!.aplicacao, 'parâmetro 1.000 = texto inteiro no retrato').toBe(APL_1000);
        expect((await itemNoBanco(PED_ERP.nulo))[0]!.aplicacao).toBeNull();
        await despachar();
        expect(await eventosComFalha()).toEqual([]);
        const fila = await q<{ pedido_uuid: string; estado: string; retencao_codigo: string | null; retencao_mensagem: string | null }>(
          'select pedido_uuid, estado, retencao_codigo, retencao_mensagem from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[]) and deleted_at is null order by pedido_uuid',
          [[PED_ERP.com, PED_ERP.sem, PED_ERP.nulo]],
        );
        expect(fila, 'os três na fila, pendentes e sem retenção').toEqual([PED_ERP.com, PED_ERP.sem, PED_ERP.nulo].sort().map((pedido_uuid) => ({ pedido_uuid, estado: 'pendente', retencao_codigo: null, retencao_mensagem: null })));

        const pend = await hub('GET', '/pedidos/pendentes?limite=100');
        expect(pend.statusCode, pend.body).toBe(200);
        const pedidos = PedidosPendentes.parse(pend.json()).pedidos;
        const com = pedidos.find((x) => x.pedido_uuid === PED_ERP.com);
        const sem = pedidos.find((x) => x.pedido_uuid === PED_ERP.sem);
        const nulo = pedidos.find((x) => x.pedido_uuid === PED_ERP.nulo);
        expect(com, 'pedido com aplicação entregue ao Conector').toBeDefined();
        expect(sem, 'pedido do APK antigo (sem o campo) entregue ao Conector').toBeDefined();
        expect(nulo, 'pedido com a caixa desmarcada entregue ao Conector').toBeDefined();
        expect(com!.itens).toHaveLength(1);
        expect(com!.itens[0]!.aplicacao).toBe(APL_1000);
        expect(com!.itens[0]!.aplicacao!.length).toBe(1000);
        expect(com!.itens[0]).toMatchObject({ produto_external_id: 'ERP-A-001', sequencia: 1 });
        expect(com).toMatchObject({ cliente_external_id: extCli, vendedor_external_id: extVen, condicao_pagamento_erp: '001' });
        // sem aplicação (APK antigo ou desmarcado): nada muda (campo ausente ou nulo; mesmas chaves e valores no resto do item e do pedido)
        const semAplicacao = (i: Record<string, unknown>) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'aplicacao'));
        for (const [rotulo, x] of [['APK antigo', sem!], ['desmarcado', nulo!]] as const) {
          expect(x.itens[0]!.aplicacao ?? null, rotulo).toBeNull();
          expect(semAplicacao(x.itens[0]!), rotulo).toEqual(semAplicacao(com!.itens[0]!));
          expect(Object.keys(x).sort(), rotulo).toEqual(Object.keys(com!).sort());
          expect(x.total_cents, rotulo).toBe(com!.total_cents);
        }
      } finally {
        await api.admin.query("update plataforma.parametro set deleted_at = now() where tenant_id = $1 and modulo = 'vendedor' and chave = 'aplicacao_max_orcamento' and deleted_at is null", [A.tenantId]);
        await api.admin.query('update core.cliente set external_id = null where id = $1', [A.clientes.c1]);
        await api.admin.query('update core.usuario set external_id = null where id = $1', [A.usuarios.vendedor1]);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ Exportação
  describe('E. Exportação do catálogo (K10): perfil, licença, tenant e truncado', () => {
    it('E-1: o analista exporta: aplicação, referências (marcas ativas), oferece junto; sem produto de B; truncado = false', async () => {
      const r = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/catalogo/exportacao' });
      expect(r.statusCode, r.body).toBe(200);
      const e = RespostaExportacao.parse(r.json());
      expect(e.truncado).toBe(false);
      const p1 = e.produtos.find((p) => p.codigo === 'ALFA-001');
      // o nome da marca vem na própria referência (o campo `marcas` da resposta saiu, RD-0544; ler só `referencias`)
      expect(p1).toMatchObject({
        aplicacao: APL_UNO,
        oferece_junto: [alfa2],
        referencias: [{ marca_id: concorrenteA, marca_nome: 'Freios Rivais', codigo: 'CB 3401' }, { marca_id: concorrenteA, marca_nome: 'Freios Rivais', codigo: 'FR-77.2' }],
      });
      expect(e.produtos.map((p) => p.codigo)).not.toContain('BETA-001');
      expect(r.body).not.toMatch(/price|preco/);
    });

    it('E-1b (RN-CAT-04): vendedor e promotor = 403 PERFIL_SEM_ACESSO / MODULO_INATIVO; B exporta só o dele', async () => {
      const v = await api.chamar(tk.vA, { method: 'GET', url: '/v1/catalogo/exportacao' });
      expect([v.statusCode, erroDe(v).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
      const p = await api.chamar(tk.promotorA, { method: 'GET', url: '/v1/catalogo/exportacao' });
      expect(p.statusCode).toBe(403);
      const b = await api.chamar(tk.adminB, { method: 'GET', url: '/v1/catalogo/exportacao' });
      expect(b.statusCode, b.body).toBe(200);
      const eb = RespostaExportacao.parse(b.json());
      expect(eb.produtos.map((x) => x.codigo)).toEqual(['BETA-001']);
      // T-0113 (fecha o achado T-0085-A1): B não tem o Promotor e mesmo assim exporta o nome da marca, do cadastro do Catálogo
      expect(eb.produtos[0]!.referencias).toEqual([{ marca_id: MARCAS_FIXTURE.B.ativa, marca_nome: 'Lubri Rival', codigo: 'LB 0099' }]);
    });

    it('E-1c (RN-CORE-01): Catálogo desligado no tenant = 403 MODULO_INATIVO na exportação; religado, volta', async () => {
      expect((await licenca(api, tk.adminA, 'tenant', 'catalogo', false)).statusCode).toBe(200);
      try {
        const r = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/catalogo/exportacao' });
        expect([r.statusCode, erroDe(r).codigo]).toEqual([403, 'MODULO_INATIVO']);
      } finally {
        expect((await licenca(api, tk.adminA, 'tenant', 'catalogo', true)).statusCode).toBe(200);
      }
      expect((await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/catalogo/exportacao' })).statusCode).toBe(200);
    });

    it(
      'E-1d (K10, limite): com 20.001 produtos ativos com preço, a exportação sai com 20.000 e truncado = true',
      async () => {
        await api.admin.query(
          `insert into core.produto (tenant_id, sku, nome, unidade, ativo) select $1, 'T85C-' || lpad(g::text, 5, '0'), 'Produto de carga ' || g, 'PC', true from generate_series(1, 20001) g`,
          [A.tenantId],
        );
        await api.admin.query(
          `insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, vigencia_inicio, vigencia_fim, external_id)
           select $1, $2, p.id, 100, now() - interval '1 day', null, null from core.produto p where p.tenant_id = $1 and p.sku like 'T85C-%'`,
          [A.tenantId, A.tabelasPreco.padrao],
        );
        const r = await api.chamar(tk.analistaA, { method: 'GET', url: '/v1/catalogo/exportacao' });
        expect(r.statusCode, r.body.slice(0, 500)).toBe(200);
        const e = RespostaExportacao.parse(r.json());
        expect(e.truncado).toBe(true);
        expect(e.produtos).toHaveLength(20_000);
      },
      240_000,
    );
  });
});
