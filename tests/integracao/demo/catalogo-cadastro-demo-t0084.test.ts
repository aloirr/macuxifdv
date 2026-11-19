/**
 * T-0084 (critério 9) e T-0085 (critério 8, base `demo`) — a BASE DE DEMO (`carregarDemo`, a mesma do `subir-demo.ps1` e do
 * workflow `demo-recriar-base`) com o `createApp` REAL (8 módulos, JWT, Postgres como `macuxi_app`, RLS). Agente `testes`.
 *
 * O banco-dados confere as LINHAS do seed em db/testes/seed-demo.test.ts; aqui o que o dono do produto vai ver na demo, pela
 * API, com os logins da demo:
 *  D-1 (T-0084 c3/c9): "pastilha uno 2012" acha a PST-D01 com "Serve em" (inclui 2012); "pastilha uno 2015" não traz;
 *      "filtro gol 2014" acha o FOL-G01; "filtro volkswagen gol" (sinônimo VW) também.
 *  D-2 (T-0084 c9): aplicação em parte das autopeças (30% a 50%), o texto acima de 300 caracteres (LAM-H4, retrato do
 *      orçamento com "…") e o "a partir de 2018"; produtos fora das autopeças sem aplicação (controle).
 *  D-3 (T-0085 c4/c8): "cb3401" acha a PST-D01 em 1º com "Equivale a: Freiomax CB 3401" para o vendedor da demo (sem o
 *      Promotor: retrato `marca_nome`); "fb0207" acha o FOL-G01.
 *  D-4 (T-0085 c8; T-0113): marcas fictícias (Freiomax, Rodaforte, Filtrobom, Vialume) no cadastro do CATÁLOGO
 *      (`catalogo.marca_concorrente`, ADR 0034) e só elas nas referências; o cadastro antigo do Promotor fica vazio no seed.
 *  D-4b (T-0113): os produtos do concorrente do Trade apontam para marcas do Catálogo do mesmo tenant (mesmo id, sem órfão).
 *  D-5 (T-0085 c7/c8): o promotor da demo abre a ficha da PST-D01 com aplicação, 2 referências, oferece junto (disco e fluido)
 *      e etiquetas, sem preço.
 *  D-6 (T-0085 c6): o analista exporta o catálogo com sistema › grupo › linha e o nome da marca em cada referência; o vendedor não.
 */
import { FichaProduto, RespostaBusca, RespostaExportacao } from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { retratoAplicacao } from '../../../modules/vendedor/domain/aplicacao';
import { DEMO, subirApiDemo, TENANT_DEMO, type ApiDemo } from '../apoio/demo';

const MARCAS_FICTICIAS = ['Filtrobom', 'Freiomax', 'Rodaforte', 'Vialume'];

describe.skipIf(semBanco())('T-0084/T-0085 — aplicação e referência cruzada na base demo (createApp real × Postgres)', () => {
  let api: ApiDemo;
  const tk = { vendedor: '', promotor: '', analista: '' };
  const idPorSku = new Map<string, string>();

  const itens = async (t: string, q: string) => {
    const r = await api.chamar(t, { method: 'GET', url: `/v1/catalogo/busca?q=${encodeURIComponent(q)}&limit=20&mode=basica` });
    expect(r.statusCode, `busca "${q}": ${r.body}`).toBe(200);
    return RespostaBusca.parse(r.json()).items;
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    tk.vendedor = (await api.sessao(DEMO.vendedor)).access_token;
    tk.promotor = (await api.sessao(DEMO.promotor)).access_token;
    tk.analista = (await api.sessao(DEMO.analista)).access_token;
    const rows = (await api.admin.query<{ id: string; sku: string }>('select id, sku from core.produto where tenant_id = $1 and deleted_at is null', [TENANT_DEMO])).rows;
    for (const r of rows) idPorSku.set(r.sku, r.id);
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
  });

  it('D-1 (RN-CAT-12): "pastilha uno 2012" acha a PST-D01 com "Serve em" (inclui 2012); "2015" não; "filtro gol 2014" e "filtro volkswagen gol" acham o FOL-G01', async () => {
    const uno = await itens(tk.vendedor, 'pastilha uno 2012');
    const pst = uno.find((i) => i.erp_code === 'PST-D01');
    expect(pst, JSON.stringify(uno.map((i) => i.erp_code))).toBeTruthy();
    expect(pst!.serve_em).toMatchObject({ inclui_ano: 2012 });
    expect(pst!.serve_em!.texto).toContain('Uno');
    expect(pst!.serve_em!.texto.length).toBeLessThanOrEqual(90);
    expect((await itens(tk.vendedor, 'pastilha uno 2015')).map((i) => i.erp_code)).not.toContain('PST-D01');
    const gol = await itens(tk.vendedor, 'filtro gol 2014');
    expect(gol[0]?.erp_code, JSON.stringify(gol.map((i) => i.erp_code))).toBe('FOL-G01');
    expect(gol[0]!.serve_em).toMatchObject({ inclui_ano: 2014 });
    expect((await itens(tk.vendedor, 'filtro volkswagen gol'))[0]?.erp_code).toBe('FOL-G01');
  });

  it('D-2 (RN-CAT-11, base): aplicação em 30% a 50% das autopeças; LAM-H4 > 300 sem separador (retrato com "…"); AMR-T01 "a partir de 2018"; fora das autopeças, sem aplicação', async () => {
    const linhas = (
      await api.admin.query<{ sku: string; categoria: string | null; aplicacoes: string | null }>(
        `select p.sku, p.categoria, c.aplicacoes from core.produto p left join catalogo.produto_conteudo c on c.produto_id = p.id and c.deleted_at is null
          where p.tenant_id = $1 and p.deleted_at is null`,
        [TENANT_DEMO],
      )
    ).rows;
    const auto = linhas.filter((l) => l.categoria === 'Automotivo');
    const comApl = auto.filter((l) => (l.aplicacoes ?? '').trim() !== '');
    expect(comApl.length / auto.length, `${comApl.length} de ${auto.length}`).toBeGreaterThanOrEqual(0.3);
    expect(comApl.length / auto.length).toBeLessThanOrEqual(0.5);
    expect(linhas.filter((l) => l.categoria !== 'Automotivo' && (l.aplicacoes ?? '').trim() !== '').map((l) => l.sku), 'fora das autopeças').toEqual([]);
    const lam = linhas.find((l) => l.sku === 'LAM-H4')!.aplicacoes!;
    expect(lam.length).toBeGreaterThan(300);
    expect(lam).not.toMatch(/[;|•\n]/);
    const retrato = retratoAplicacao(lam, true, 300)!;
    expect(retrato.length).toBeLessThanOrEqual(300);
    expect(retrato.endsWith('…')).toBe(true);
    expect(linhas.find((l) => l.sku === 'AMR-T01')!.aplicacoes).toContain('a partir de 2018');
    expect(linhas.find((l) => l.sku === 'PST-D01')!.aplicacoes).toContain('Uno 1.0/1.4 2010–2014');
    expect(linhas.find((l) => l.sku === 'FOL-G01')!.aplicacoes).toContain('Gol G5/G6 1.0/1.6 2009–2016');
  });

  it('D-3 (RN-CAT-09): "cb3401" acha a PST-D01 em 1º com "Equivale a: Freiomax CB 3401" (vendedor da demo sem o Promotor); "fb0207" acha o FOL-G01', async () => {
    expect((await api.meusModulos(tk.vendedor)).modulos.map((m) => m.id)).not.toContain('promotor');
    const r = await itens(tk.vendedor, 'cb3401');
    expect(r[0]?.erp_code).toBe('PST-D01');
    expect(r[0]!.equivale_a).toMatchObject({ marca_nome: 'Freiomax', codigo: 'CB 3401' });
    const f = await itens(tk.vendedor, 'fb0207');
    expect(f[0]).toMatchObject({ erp_code: 'FOL-G01', equivale_a: { marca_nome: 'Filtrobom', codigo: 'FB-0207' } });
  });

  it('D-4 (T-0085 c8, T-0113): marcas concorrentes fictícias — as 4 no cadastro do Catálogo e só elas nas referências; o do Promotor vazio', async () => {
    const marcas = (await api.admin.query<{ nome: string }>('select nome from catalogo.marca_concorrente where tenant_id = $1 and deleted_at is null and ativo order by nome', [TENANT_DEMO])).rows.map((x) => x.nome);
    expect(marcas).toEqual(expect.arrayContaining(MARCAS_FICTICIAS));
    // desenho T-0113 B7: as marcas saíram do seed do Promotor (a tabela antiga é só de leitura até a fase 2)
    expect((await api.admin.query('select 1 from promotor.concorrente where tenant_id = $1', [TENANT_DEMO])).rows).toEqual([]);
    const refs = (
      await api.admin.query<{ marca: string | null; retrato: string | null }>(
        `select m.nome as marca, r.marca_nome as retrato from catalogo.produto_referencia r
           left join catalogo.marca_concorrente m on m.tenant_id = r.tenant_id and m.id = r.marca_id
          where r.tenant_id = $1 and r.deleted_at is null`,
        [TENANT_DEMO],
      )
    ).rows;
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const x of refs) {
      expect(MARCAS_FICTICIAS, JSON.stringify(x)).toContain(x.marca);
      expect(x.retrato).toBe(x.marca);
    }
  });

  it('D-4b (T-0113, ADR 0034 §3): todo produto do concorrente do Trade aponta para uma marca viva do Catálogo do mesmo tenant (mesmo id, sem órfão)', async () => {
    const orfaos = (
      await api.admin.query<{ nome: string; concorrente_id: string }>(
        `select p.nome, p.concorrente_id from promotor.produto_concorrente p
          where p.tenant_id = $1 and p.deleted_at is null
            and not exists (select 1 from catalogo.marca_concorrente m where m.tenant_id = p.tenant_id and m.id = p.concorrente_id and m.deleted_at is null)`,
        [TENANT_DEMO],
      )
    ).rows;
    expect(orfaos).toEqual([]);
    expect(Number((await api.admin.query<{ n: number }>('select count(*)::int as n from promotor.produto_concorrente where tenant_id = $1 and deleted_at is null', [TENANT_DEMO])).rows[0]!.n)).toBeGreaterThan(0);
  });

  it('D-5 (RN-CAT-05 revista, T-0085 c7): o promotor da demo abre a ficha da PST-D01 com aplicação, referências, oferece junto, etiquetas e estoque, sem preço', async () => {
    const r = await api.chamar(tk.promotor, { method: 'GET', url: `/v1/catalogo/produtos/${idPorSku.get('PST-D01')}` });
    expect(r.statusCode, r.body).toBe(200);
    const f = FichaProduto.parse(r.json());
    expect(f.product).toMatchObject({ price_stock_visible: false, price: null });
    // RN-CAT-05 revista (catálogo v2, #503): o estoque é de todos os perfis
    expect(f.product.availability).not.toBeNull();
    expect(f.catalogo!.aplicacao).toContain('Fiat Uno');
    expect(f.catalogo!.referencias.map((x) => `${x.marca_nome} ${x.codigo}`)).toEqual(['Freiomax CB 3401', 'Rodaforte RF-1187']);
    expect(f.catalogo!.oferece_junto.map((x) => x.erp_code)).toEqual(['DSC-D01', 'FLU-DOT4']);
    expect(f.catalogo!.etiquetas).toEqual(['Dianteira', 'Novo']);
  });

  it('D-6 (T-0085 c6): o analista exporta o catálogo (sistema › grupo › linha, marcas fictícias, sem preço); o vendedor recebe 403', async () => {
    const r = await api.chamar(tk.analista, { method: 'GET', url: '/v1/catalogo/exportacao' });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const e = RespostaExportacao.parse(r.json());
    expect(e.truncado).toBe(false);
    const pst = e.produtos.find((p) => p.codigo === 'PST-D01')!;
    expect(pst.hierarquia.sistema).toBeTruthy();
    expect(pst.hierarquia.linha).toBeTruthy();
    expect(pst.referencias.map((x) => [x.marca_nome, x.codigo])).toEqual([['Freiomax', 'CB 3401'], ['Rodaforte', 'RF-1187']]);
    expect(pst.oferece_junto).toEqual([idPorSku.get('DSC-D01'), idPorSku.get('FLU-DOT4')]);
    // o nome da marca vem na referência (o campo `marcas` da resposta saiu, RD-0544): só marcas fictícias do cadastro do Catálogo, nenhuma real
    const nomes = new Set(e.produtos.flatMap((p) => p.referencias.flatMap((x) => (x.marca_nome ? [x.marca_nome] : []))));
    expect([...nomes].filter((n) => !MARCAS_FICTICIAS.includes(n))).toEqual([]);
    const v = await api.chamar(tk.vendedor, { method: 'GET', url: '/v1/catalogo/exportacao' });
    expect(v.statusCode).toBe(403);
  });
});
