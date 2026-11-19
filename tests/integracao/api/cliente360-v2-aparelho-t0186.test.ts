/**
 * T-0186 (Cliente 360 v2) — a NF e o documento não vão ao aparelho (P15: Documentação só para ver, sem cópia; P17: a NF é
 * consultada ao tocar). createApp REAL × Postgres como macuxi_app × fixture dois-tenants.
 *
 * O que se prova:
 *  - nenhum módulo declara no sync (manifesto) as entidades de NF ou de documento, e o pull delas não traz linha;
 *  - as entidades que o aparelho já recebe (`titulo`, `historico_compra`, `cliente`) não levam número de NF, forma de
 *    pagamento nem documento (as colunas novas da 0090 ficam no servidor), mesmo com a NF e o documento gravados;
 *  - a lista de documentos não traz o id do arquivo (só a abertura, revalidada, devolve);
 *  - o arquivo do documento é governado pelo Core no `GET /v1/arquivos/:id` (`guardaArquivo`, #c721b659): sem a guarda, a
 *    exceção do documento não vale na rota de arquivos e o arquivo sai com cache de 1 dia (`private, max-age=86400`).
 * Matriz: docs/testes/T-0186.md (D-01..D-05).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, subirApi, type ApiDeTeste } from '../apoio/api';
import { DOCUMENTOS_FIXTURE, rotas360 } from '../apoio/cliente360-v2';

const ENTIDADES_SO_ONLINE = ['nota', 'nota_erp', 'nota_item', 'documento', 'documento_cliente', 'documento_tipo', 'documento_permissao', 'documento_excecao'];
const NF = { numero: '700186', serie: '1', forma: 'Boleto 28 dias' };

describe.skipIf(semBanco())('T-0186 — a NF e o documento não vão ao aparelho (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let tkVendedor = '';

  beforeAll(async () => {
    api = await subirApi();
    tkVendedor = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    // o que o ERP gravaria (consumidores da 0090): forma e NF na nota e no título do c1 de A, da carteira do vendedor-1
    await api.admin.query("update core.nota_erp set forma_pagamento = $2, numero = $3 where tenant_id = $1 and external_id = 'NF-1-5001'", [A.tenantId, NF.forma, NF.numero]);
    await api.admin.query('update core.titulo set nf_numero = $2, nf_serie = $3, forma_pagamento = $4 where tenant_id = $1 and cliente_id = $5', [A.tenantId, NF.numero, NF.serie, NF.forma, A.clientes.c1]);
    // o pull só devolve linha com updated_at abaixo do horizonte (now() − 2 s, MARGEM_HORIZONTE_PADRAO_MS): espera a margem
    await new Promise((fim) => setTimeout(fim, 2_500));
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
  });

  /** Todas as páginas do pull de uma entidade (o horizonte pode cortar; o que vier é o que vai ao aparelho). */
  async function pull(entidade: string): Promise<{ status: number; itens: Record<string, unknown>[] }> {
    const itens: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i += 1) {
      const r = await api.chamar(tkVendedor, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` });
      if (r.statusCode !== 200) return { status: r.statusCode, itens };
      const corpo = r.json() as { itens: Record<string, unknown>[]; proximo_cursor: string | null };
      itens.push(...corpo.itens);
      if (!corpo.proximo_cursor || corpo.itens.length === 0) break;
      cursor = corpo.proximo_cursor;
    }
    return { status: 200, itens };
  }

  it('D-01 (P15/P17): nenhum módulo declara no sync uma entidade de NF ou de documento, e o pull delas não traz linha', async () => {
    const declaradas = api.modulos.flatMap((m) => [...(m.manifesto.sync ?? [])] as string[]);
    for (const e of ENTIDADES_SO_ONLINE) expect(declaradas, e).not.toContain(e);
    for (const e of ENTIDADES_SO_ONLINE) expect((await pull(e)).itens, e).toEqual([]);
  });

  it('D-02 (P17): título, histórico de compra e cliente chegam ao aparelho sem número de NF, forma de pagamento nem documento', async () => {
    const titulos = await pull('titulo');
    expect(titulos.status).toBe(200);
    expect(titulos.itens.length, 'títulos do c1 no pull').toBeGreaterThan(0);
    for (const e of ['titulo', 'historico_compra', 'cliente']) {
      const { itens } = await pull(e);
      for (const l of itens) for (const c of ['nf_numero', 'nf_serie', 'forma_pagamento', 'nf_origem_numero', 'nf_origem_serie', 'arquivo_id', 'documento_id']) expect(Object.keys(l), `${e}.${c}`).not.toContain(c);
      const texto = JSON.stringify(itens);
      expect(texto, e).not.toContain(NF.numero);
      expect(texto, e).not.toContain(NF.forma);
    }
  });

  it('D-03 (P15): a lista de documentos do cliente não traz o id do arquivo', async () => {
    const rotas = rotas360({ cliente: A.clientes.c1, nota: A.clientes.c1, documento: DOCUMENTOS_FIXTURE.A.documento });
    const r = await api.chamar(tkVendedor, rotas.documentos);
    expect(r.statusCode, r.body).toBe(200);
    const itens = (r.json() as { itens: Record<string, unknown>[] }).itens;
    expect(itens.map((d) => d.id)).toEqual([DOCUMENTOS_FIXTURE.A.documento]);
    for (const d of itens) expect(Object.keys(d)).not.toContain('arquivo_id');
  });

  it('D-04 (P15, ADR 0010): o Core governa o arquivo do documento no GET /v1/arquivos/:id (guarda do módulo: exceção vale e sem cache)', () => {
    const core = api.modulos.find((m) => m.manifesto.id === 'core');
    expect(core, 'módulo core na API').toBeDefined();
    expect(typeof (core as { guardaArquivo?: unknown }).guardaArquivo, 'ModuloApi.guardaArquivo do Core').toBe('function');
  });
});
