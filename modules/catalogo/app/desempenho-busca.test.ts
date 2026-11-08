/**
 * T-0084, critério 5 (driver node): 20 mil produtos com aplicação de ~2.000 caracteres, SQLite/FTS5 real com o índice do
 * Catálogo, e a busca offline da aba (`buscarLocal`) e da C9 do aparelho com p95 < 300 ms. O critério de verdade é medido no
 * aparelho (tela de medição do engenheiro-apps); aqui vale como trava de regressão no PC/CI.
 * Tolerante à máquina como o teste do SDK: MACUXI_FATOR_DESEMPENHO folga o teto (CI compartilhado); o tempo é impresso.
 */
import { cpus, loadavg } from 'node:os';

import { criarArmazenamentoSqlite, type ContextoConsultaAparelho, type LinhaSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { describe, expect, it, onTestFailed } from 'vitest';
import { migracoesAparelho } from '../db/aparelho';
import { pontuacaoTextual, type DocBusca } from '../domain/ranking';
import { INDICE_BUSCA_CATALOGO } from './indice';
import { buscarLocal, comAplicacao, contextoLocal, esquecerMemoriaLocal, preselecionar, produtosLocais, sinonimosLocais, vocabularioMemorizado, type LeitorLocal } from './lib/local';
import { entidadesSyncCatalogo } from '../../../tests/modulos/apoio/entidades-catalogo';
import { buscarProdutos } from '../domain/vitrine';
import { interpretarConsulta } from '../domain/consulta';
import { consultaBuscaProdutosAparelho, esquecerMemoriaTextos } from './texto-consultas';

const AGORA = '2026-11-06T14:00:00.000Z'; // hora-fixa-ok: instante do catálogo medido
const base = { updated_at: '2026-10-01T00:00:00.000000Z', deleted_at: null, external_id: null };
const VEICULOS = ['Uno', 'Palio', 'Gol', 'Fox', 'Celta', 'Corsa', 'Onix', 'Prisma', 'Ka', 'Fiesta', 'Strada', 'Saveiro', 'HB20', 'Sandero', 'Logan', 'Civic', 'Corolla', 'Hilux', 'S10', 'Ranger'];
const VERSOES = ['1.0', '1.0/1.4', '1.6', '2.0 16V', 'Flex', 'Fire', 'Turbo'];
const PECAS = ['Pastilha de freio', 'Filtro de óleo', 'Filtro de ar', 'Correia dentada', 'Amortecedor', 'Vela de ignição', 'Disco de freio', 'Bomba d água'];
const MARCAS = ['Fremax', 'Cobreq', 'Mahle', 'Tecfil', 'Monroe', 'Bosch'];

function gerador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Linha = Record<string, unknown> & LinhaSync;
const N = Number(process.env.MACUXI_N ?? 20_000);
function gerar() {
  const r = gerador(84);
  const pega = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const produto: Linha[] = [];
  const produto_conteudo: Linha[] = [];
  const produto_referencia: Linha[] = [];
  for (let k = 0; k < N; k++) {
    const id = `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
    produto.push({ id, ...base, sku: `P${100000 + k}`, ean: null, nome: `${pega(PECAS)} ${pega(VEICULOS)} ${k}`, marca: pega(MARCAS), categoria: 'Autopeças', unidade: 'UN', ativo: true } as Linha);
    const trechos: string[] = [];
    let tam = 0;
    while (tam < 1950) {
      const de = 1995 + Math.floor(r() * 28);
      const faixa = r() < 0.1 ? `${de} em diante` : `${de}–${de + Math.floor(r() * 8)}`;
      const t = `Fiat ${pega(VEICULOS)} ${pega(VERSOES)} ${faixa} dianteiro motor flex`;
      trechos.push(t);
      tam += t.length + 2;
    }
    produto_conteudo.push({ id: `c${k}`, ...base, produto_id: id, aplicacao: trechos.join('; '), campanha: false, descricao: null, argumentos: [], faq: [], etiquetas: [] } as Linha);
    if (k % 10 === 0) produto_referencia.push({ id: `r${k}`, ...base, produto_id: id, marca_id: '0ca00000-0000-4000-8000-0000000000a1', marca_nome: 'Cobreq', codigo: `CB-${k}`, ordem: 1 } as Linha);
  }
  return { produto, produto_conteudo, produto_referencia };
}

const CONSULTAS = [
  'pastilha uno 2012', 'filtro gol 2014', 'amortecedor palio', 'correia onix 2019', 'vela ka', 'disco hilux 2021', 'filtro ar civic 2008', 'bomba s10',
  'pastilha de freio fiat uno', 'filtro de oleo corsa 2005', 'amortecedor strada', 'fremax pastilha', 'cobreq disco', 'mahle filtro 2016', 'tecfil ar gol', 'monroe saveiro 2010',
  'uno', 'gol 2010', 'onix', 'pastilha', 'CB-1230', 'fiesta 2003', 'sandero logan', 'pastilha frei uno',
];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// marcas de progresso: só em memória, impressas se o teste falhar (nada grava em disco)
const progresso: string[] = [];
const marca = (m: string) => void progresso.push(m + ' ' + new Date().toISOString());
describe('desempenho da busca offline: 20 mil produtos com aplicação de 2.000 caracteres (T-0084 critério 5)', { timeout: 600_000 }, () => {
  // 20 mil produtos levam minutos num PC ocupado: opt-in só com MACUXI_DESEMPENHO=1 (nunca por CI=true: o Actions sempre o define); job próprio do CI
  it.skipIf(process.env.MACUXI_DESEMPENHO !== '1')('RF-CAT-02: aba e C9 com p95 < 300 ms; ranking por produto <= 0,3 ms com a aplicação em memória', async () => {
    onTestFailed(() => console.log(progresso.join('\n')));
    marca("inicio");
    const dados = gerar();
    marca("gerado");
    const agora = () => new Date(AGORA);
    const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), {
      migracoesModulos: { catalogo: migracoesAparelho },
      entidades: [{ nome: 'produto', modulo: 'core' }, ...entidadesSyncCatalogo()],
      indicesBusca: [INDICE_BUSCA_CATALOGO],
      agora,
      registrarErro: (m) => marca("ERRO " + m),
    });
    await armazenamento.busca.conferirVersoes!({});
    const tIndexar = performance.now();
    for (const [nome, linhas] of Object.entries(dados)) for (let k = 0; k < linhas.length; k += 1000) await armazenamento.linhas.aplicar(nome, linhas.slice(k, k + 1000), `k${k}`);
    await armazenamento.busca.finalizar!();
    const msIndexar = performance.now() - tIndexar;
    marca("indexado");
    marca(JSON.stringify(await armazenamento.busca.buscarComDesfecho("catalogo.produto", { grupos: [["pastilha"]], prefixoNoUltimo: true, limite: 3 })).slice(0, 300));

    const L = armazenamento.linhas;
    const leitor: LeitorLocal = {
      linhas: async <X extends LinhaSync>(e: string) => L.listar<X>(e),
      linhasPorIds: async <X extends LinhaSync>(e: string, ids: readonly string[]) => L.porIds<X>(e, ids),
      linhasPorCampo: async <X extends LinhaSync>(e: string, c: string, v: readonly string[]) => L.porCampo!<X>(e, c, v),
      versaoLinhas: () => 1,
      buscarComDesfecho: (i, c) => armazenamento.busca.buscarComDesfecho(i, c),
    };
    const ctx = { ...leitor, agora, usuario: () => null, parametros: () => ({}) } as unknown as ContextoConsultaAparelho;
    const c9 = (q: string) => (consultaBuscaProdutosAparelho as unknown as { executar(e: unknown, c: ContextoConsultaAparelho): Promise<{ itens: unknown[] }> }).executar({ q, limite: 20 }, ctx);
    const aba = (q: string) => buscarLocal(leitor, { perfil: 'vendedor', parametros: {}, agora: AGORA, clienteId: null, q, limit: 20, offset: 0, offline: true });
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();

    // aquecimento: monta o catálogo em memória (uma vez por versão das linhas) e o JIT
    const tAquecer = performance.now();
    await leitor.linhas('produto');
    marca('lido produto');
    await leitor.linhas('produto_conteudo');
    marca('lido conteudo');
    const pr = await produtosLocais(leitor);
    marca('produtosLocais');
    const ca = await preselecionar(leitor, 'pastilha uno', null, [], pr.length);
    marca('preselecionar ' + ca?.size);
    const cc = await comAplicacao(leitor, pr.filter((p) => ca?.has(p.id)));
    marca('comAplicacao ' + cc.length + ' ' + cc[0]?.aplicacao?.length);
    await aba('pastilha uno');
    marca('aba1');
    await c9('pastilha uno');
    marca('c91');
    const msAquecer = performance.now() - tAquecer;
    marca("aquecido");

    const tempos = { aba: new Map<string, number[]>(), c9: new Map<string, number[]>() };
    for (let volta = 0; volta < 3; volta++)
      for (const q of CONSULTAS) {
        for (const [nome, f] of [['aba', aba], ['c9', c9]] as const) {
          const t = performance.now();
          await f(q);
          const l = tempos[nome].get(q) ?? [];
          l.push(performance.now() - t);
          tempos[nome].set(q, l);
        }
      }
    // onde a aba gasta o tempo (consulta "pastilha uno 2012", mediana de 5): pré-seleção, aplicação, contexto, ranking
    const etapas: Record<string, number[]> = { preselecao: [], aplicacao: [], contexto: [], ranking: [] };
    for (let i = 0; i < 5; i++) {
      const sin = await sinonimosLocais(leitor);
      const f = interpretarConsulta('pastilha uno 2012', vocabularioMemorizado(pr));
      let t = performance.now();
      const cand = await preselecionar(leitor, f.text, f.code?.value ?? null, sin, pr.length);
      etapas.preselecao!.push(performance.now() - t);
      t = performance.now();
      const uni = await comAplicacao(leitor, cand ? pr.filter((x) => cand.has(x.id)) : pr);
      etapas.aplicacao!.push(performance.now() - t);
      t = performance.now();
      const cx = await contextoLocal(leitor, { perfil: 'vendedor', parametros: {}, agora: AGORA, clienteId: null }, uni);
      etapas.contexto!.push(performance.now() - t);
      t = performance.now();
      buscarProdutos({ produtos: uni, contexto: cx, filtros: f, chips: {}, sinonimos: sin, limit: 20, offset: 0 });
      etapas.ranking!.push(performance.now() - t);
    }
    const detalhe = Object.entries(etapas).map(([k, v]) => `${k} ${mediana(v).toFixed(0)} ms`).join(', ');
    const lentas = [...tempos.aba.entries()].map(([q, v]) => [q, mediana(v), mediana(tempos.c9.get(q)!)] as const).sort((a, b) => b[1] - a[1]).slice(0, 5);
    marca('mais lentas (aba, C9 em ms): ' + lentas.map(([q, a, c]) => `${q}: ${a.toFixed(0)}/${c.toFixed(0)}`).join('; '));
    const p95Aba = p95([...tempos.aba.values()].flat());
    const p95C9 = p95([...tempos.c9.values()].flat());
    const p95MedAba = p95([...tempos.aba.values()].map(mediana));
    const p95MedC9 = p95([...tempos.c9.values()].map(mediana));
    // resultado de verdade: a C9 acha o Uno de 2012 pela aplicação
    expect((await c9('pastilha uno 2012')).itens.length).toBeGreaterThan(0);

    // custo do ranking por produto (400 docs, aplicação de ~2.000 caracteres): 1ª passada (frio) e melhor das 3 seguintes (com a memória por produto)
    const docs: DocBusca[] = dados.produto.slice(0, 400).map((p, i) => ({
      id: p.id, sku: String(p.sku), ean: null, nome: String(p.nome), marca: 'Fremax', categoria: 'Autopeças', atributos: '',
      aplicacao: String(dados.produto_conteudo[i]!.aplicacao), referencias: [], estoque: 0, vendas: 0, campanha: false, preco_cents: null,
    }));
    const grupos = [['pastilha'], ['uno'], ['2012']];
    const rodar = () => {
      const t = performance.now();
      for (const d of docs) pontuacaoTextual(grupos, d, { anoAtual: 2026 });
      return (performance.now() - t) / docs.length;
    };
    const msPorProdutoFrio = rodar();
    const msPorProduto = Math.min(rodar(), rodar(), rodar());
    console.log(
      `[desempenho T-0084] indexar 20 mil: ${(msIndexar / 1000).toFixed(1)} s; montar catálogo (1ª busca): ${(msAquecer / 1000).toFixed(1)} s; ` +
        `aba por etapa (${detalhe}); aba p95 ${p95Aba.toFixed(0)} ms (p95 das medianas ${p95MedAba.toFixed(0)}); C9 p95 ${p95C9.toFixed(0)} ms (medianas ${p95MedC9.toFixed(0)}); ` +
        `ranking por produto: frio ${msPorProdutoFrio.toFixed(2)} ms, com memória ${msPorProduto.toFixed(3)} ms; carga ${loadavg()[0]!.toFixed(2)}, cpus ${cpus().length}`,
    );
    const folga = Number(process.env.MACUXI_FATOR_DESEMPENHO ?? '1') || 1;
    expect(p95MedAba, `aba p95 das medianas = ${p95MedAba.toFixed(0)} ms`).toBeLessThan(300 * folga);
    expect(p95MedC9, `C9 p95 das medianas = ${p95MedC9.toFixed(0)} ms`).toBeLessThan(300 * folga);
    expect(msPorProduto, `ranking por produto = ${msPorProduto.toFixed(3)} ms`).toBeLessThan(0.3 * folga);
  });
});
