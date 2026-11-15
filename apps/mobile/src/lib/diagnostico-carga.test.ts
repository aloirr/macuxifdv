/**
 * T-0008 (critérios 1 e 2) e T-0084 (critério 5): regra pura do diagnóstico de carga e busca e execuções pequenas no
 * `node:sqlite` (carga com aplicação longa e referências, reindexação completa pelo caminho real e a C9 pelo registro
 * de consultas do SDK).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClienteSyncSchema, ProdutoSyncSchema } from '@macuxi/core/contracts';
import {
  CONSULTA_BUSCA_PRODUTOS,
  ProdutoAtributoSyncSchema,
  ProdutoConteudoSyncSchema,
  ProdutoReferenciaSyncSchema,
  type ProdutoConteudoSync,
} from '@macuxi/catalogo/contracts';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import {
  criarRegistroConsultasAparelho,
  definirIndiceBusca,
  implementarConsultaAparelho,
  normalizarBusca,
  type DriverSqlite,
  type LinhaSync,
  type MigracaoAparelho,
} from '@macuxi/platform-sdk';
import { afterAll, describe, expect, it } from 'vitest';

import {
  aplicacaoSintetica,
  APLICACAO_MAXIMA,
  atributosSinteticos,
  clienteSintetico,
  consultasC9,
  consultasDeProduto,
  conteudoSintetico,
  CONFIG_PADRAO,
  criarContadorToques,
  criarMedidorQuadros,
  diagnosticoDisponivel,
  DiagnosticoCancelado,
  ETAPAS_DIAGNOSTICO,
  etapaDaFase,
  filtrarClientes,
  formatarMs,
  linhasDoVeredito,
  milhar,
  percentil,
  produtoSintetico,
  referenciasSinteticas,
  resumirTempos,
  rodarDiagnosticoCarga,
  TERMOS_CLIENTE,
  textoDoRelatorio,
  TIPOS_BUSCA_C9,
  TIPOS_BUSCA_PRODUTO,
  trechosDaAplicacao,
  tituloDoProgresso,
  veredito,
  type ResultadoDiagnostico,
} from './diagnostico-carga';

/**
 * Driver `node:sqlite` carregado pelo NOME (import dinâmico): assim o typecheck do app não puxa `node:sqlite` para o
 * grafo (desenho T-0008, P3: o Metro e o tsc do apps/mobile nunca veem o driver Node).
 */
async function driverNode(caminho = ':memory:'): Promise<DriverSqlite> {
  const nome = '@macuxi/platform-sdk/sqlite-node';
  const m = (await import(/* @vite-ignore */ nome)) as { criarDriverNode(caminho?: string): DriverSqlite };
  return m.criarDriverNode(caminho);
}

const CTX = {
  quando: new Date('2026-11-05T12:10:00.000Z'),
  fuso: 'America/Manaus',
  app: 'Macuxi Campo',
  versao: '1.0.0',
  perfil: 'producao' as const,
  aparelho: 'samsung SM-A105M',
  sistema: 'Android 10 (API 29)',
  memoriaBytes: 3 * 1024 ** 3,
};

/** Pasta temporária própria (a reindexação reabre o MESMO arquivo, como o aparelho). */
const pasta = mkdtempSync(join(tmpdir(), 'macuxi-diagnostico-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
let arquivos = 0;
const arquivoTemporario = () => join(pasta, `banco-${++arquivos}.db`);

describe('diagnóstico de carga: quem abre', () => {
  it('só no bundle de desenvolvimento; nunca em produção', () => {
    expect(diagnosticoDisponivel('desenvolvimento')).toBe(true);
    expect(diagnosticoDisponivel('producao')).toBe(false);
  });

  it('abre no 7º toque seguido; pausa maior que a janela recomeça a conta', () => {
    const c = criarContadorToques(7, 3000);
    for (let i = 0; i < 6; i++) expect(c.tocar(1000 + i * 200)).toBe(false);
    expect(c.faltam()).toBe(1);
    expect(c.tocar(2400)).toBe(true);
    // zerou: precisa de mais 7
    expect(c.tocar(2500)).toBe(false);
    // pausa de 5 s: recomeça
    for (let i = 0; i < 5; i++) c.tocar(3000 + i * 100);
    expect(c.tocar(9000)).toBe(false);
    expect(c.faltam()).toBe(6);
  });
});

describe('diagnóstico de carga: dados sintéticos no formato do pull', () => {
  it('produto, atributo e cliente passam nos schemas dos contratos (Core e Catálogo)', () => {
    for (const i of [0, 7, 1234, 19_999]) {
      expect(ProdutoSyncSchema.safeParse(produtoSintetico(i)).success).toBe(true);
      for (const a of atributosSinteticos(i)) expect(ProdutoAtributoSyncSchema.safeParse(a).success).toBe(true);
    }
    for (const i of [0, 499]) expect(ClienteSyncSchema.safeParse(clienteSintetico(i)).success).toBe(true);
  });

  it('T-0084 critério 5: conteúdo com aplicação longa e referências passam nos schemas do Catálogo (RN-CAT-11, RN-CAT-09)', () => {
    for (const i of [0, 1, 2, 6, 9, 1234, 19_999]) {
      expect(ProdutoConteudoSyncSchema.safeParse(conteudoSintetico(i)).success).toBe(true);
      for (const r of referenciasSinteticas(i)) expect(ProdutoReferenciaSyncSchema.safeParse(r).success).toBe(true);
    }
    // 2 em cada 3 produtos com a 1ª referência; 1 em cada 6 também com a 2ª (ordem 1 e 2)
    expect(referenciasSinteticas(2)).toEqual([]);
    expect(referenciasSinteticas(6).map((r) => r.ordem)).toEqual([1, 2]);
    expect(referenciasSinteticas(1).map((r) => r.codigo)).toEqual(['FB 1001']);
  });

  it('aplicação: 9 em cada 10 perto do teto de 2.000 caracteres, a 10ª curta; sempre trechos "Marca Modelo motor ano–ano"', () => {
    const tamanhos = Array.from({ length: 1000 }, (_, i) => aplicacaoSintetica(i).length);
    expect(Math.max(...tamanhos)).toBeLessThanOrEqual(APLICACAO_MAXIMA);
    const longas = tamanhos.filter((n) => n >= 1900).length;
    expect(longas).toBe(900);
    expect(tamanhos.filter((_, i) => i % 10 === 9).every((n) => n > 150 && n <= 300)).toBe(true);
    expect(aplicacaoSintetica(0)).toMatch(/^Fiat Uno 1\.0 \d{4}–\d{4} (dianteiro|traseiro) motor (flex|gasolina|diesel); /);
    // janelas diferentes: produtos vizinhos não repetem a mesma aplicação
    expect(aplicacaoSintetica(1)).not.toBe(aplicacaoSintetica(0));
  });

  it('C9: 6 tipos; veículo e ano com um ano dentro da faixa de um trecho do produto; referência e SKU do produto esperado', () => {
    const cs = consultasC9(60, 20_000);
    expect(cs).toHaveLength(60);
    for (const tipo of TIPOS_BUSCA_C9) expect(cs.filter((c) => c.tipo === tipo)).toHaveLength(10);
    for (const c of cs) {
      expect(c.q.length).toBeGreaterThanOrEqual(2);
      expect(c.q.length).toBeLessThanOrEqual(200);
    }
    for (const c of cs.filter((x) => x.tipo === 'veiculo_ano' || x.tipo === 'com_ids')) {
      const [, modelo, ano] = c.q.split(' ');
      const i = Number(c.alvo!.slice(-12));
      const casa = trechosDaAplicacao(i).some((t) => t.modelo.toLowerCase() === modelo && Number(ano) >= t.anoInicio && Number(ano) <= t.anoFim);
      expect(casa, c.q).toBe(true);
    }
    for (const c of cs.filter((x) => x.tipo === 'com_ids')) {
      expect(c.ids).toBe(5000);
      expect(Number(c.alvo!.slice(-12))).toBeLessThan(5000);
    }
    for (const c of cs.filter((x) => x.tipo === 'referencia')) {
      const i = Number(c.alvo!.slice(-12));
      expect(referenciasSinteticas(i)[0]!.codigo).toBe(c.q);
    }
  });

  it('determinístico e com ids únicos', () => {
    expect(produtoSintetico(42)).toEqual(produtoSintetico(42));
    const ids = new Set(Array.from({ length: 2000 }, (_, i) => produtoSintetico(i).id));
    expect(ids.size).toBe(2000);
    const attrs = new Set(Array.from({ length: 1000 }, (_, i) => atributosSinteticos(i).map((a) => a.id)).flat());
    expect(attrs.size).toBe(2000);
  });

  it('consultas alternam os 6 tipos e nenhuma vem vazia', () => {
    const cs = consultasDeProduto(200, 20_000);
    expect(cs).toHaveLength(200);
    for (const tipo of TIPOS_BUSCA_PRODUTO) expect(cs.filter((c) => c.tipo === tipo).length).toBeGreaterThanOrEqual(33);
    for (const { consulta } of cs) expect(consulta.grupos.flat().every((x) => x.length >= 2)).toBe(true);
  });

  it('filtro de cliente acha pelos termos sem acento, em qualquer campo', () => {
    const clientes = Array.from({ length: 500 }, (_, i) => clienteSintetico(i));
    for (const termo of TERMOS_CLIENTE) expect(filtrarClientes(clientes, termo).length).toBeGreaterThan(0);
    expect(filtrarClientes(clientes, 'SÃO JOSÉ').length).toBe(filtrarClientes(clientes, 'sao jose').length);
    expect(filtrarClientes(clientes, 'inexistente xyz')).toEqual([]);
  });
});

describe('diagnóstico de carga: estatística e quadros', () => {
  it('percentil pelo posto mais próximo; lista vazia = 0', () => {
    const xs = Array.from({ length: 100 }, (_, i) => 100 - i); // 1..100 fora de ordem
    expect(percentil(xs, 50)).toBe(51);
    expect(percentil(xs, 95)).toBe(96);
    expect(percentil(xs, 100)).toBe(100);
    expect(percentil([], 95)).toBe(0);
    expect(resumirTempos([5, 1, 9])).toEqual({ n: 3, p50: 5, p95: 9, max: 9 });
    expect(resumirTempos([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
  });

  it('medidor de quadros: maior intervalo e quantos passaram de 100 ms', () => {
    const m = criarMedidorQuadros(100);
    for (const t of [0, 16, 33, 150, 166, 400, 416]) m.quadro(t);
    expect(m.resultado()).toEqual({ quadros: 6, maiorMs: 234, acimaDoLimite: 2 });
  });

  it('formata em pt-BR sem depender do Intl', () => {
    expect(formatarMs(8.74)).toBe('8,7 ms');
    expect(formatarMs(287.4)).toBe('287 ms');
    expect(formatarMs(1234)).toBe('1.234 ms');
    expect(formatarMs(41_230)).toBe('41,2 s');
    expect(milhar(20_000)).toBe('20.000');
    expect(milhar(500)).toBe('500');
  });
});

// índice mínimo de teste com a mesma forma do do Catálogo (o real vem do shell no aparelho)
const MIGRACOES: MigracaoAparelho[] = [
  {
    versao: 1,
    sql: `
      CREATE TABLE catalogo__busca_doc (rid INTEGER PRIMARY KEY, produto_id TEXT NOT NULL UNIQUE, sku TEXT, nome TEXT, aplicacao TEXT);
      CREATE VIRTUAL TABLE catalogo__busca USING fts5(sku, nome, aplicacao, content = 'catalogo__busca_doc', content_rowid = 'rid', tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
      -- os mesmos índices de expressão do Catálogo (db/aparelho.ts v1 e v2): sem eles, cada documento varre o conteúdo inteiro
      CREATE INDEX catalogo__produto_atributo_produto ON ent_produto_atributo (json_extract(dados, '$.produto_id'));
      CREATE INDEX catalogo__produto_conteudo_produto ON ent_produto_conteudo (json_extract(dados, '$.produto_id'));
      CREATE INDEX catalogo__produto_referencia_produto ON ent_produto_referencia (json_extract(dados, '$.produto_id'));
    `,
  },
];
const INDICE = definirIndiceBusca<'sku' | 'nome' | 'aplicacao'>({
  id: 'catalogo.produto',
  modulo: 'catalogo',
  tabelaDoc: 'catalogo__busca_doc',
  tabelaFts: 'catalogo__busca',
  colunaChave: 'produto_id',
  colunas: { sku: 10, nome: 5, aplicacao: 2 },
  fontes: ['produto', 'produto_conteudo'],
  chaveDe: (e, linha) => (e === 'produto' ? linha.id : ((linha as Partial<ProdutoConteudoSync>).produto_id ?? null)),
  async documento(id, ler) {
    const [p] = await ler.porIds<LinhaSync & { sku: string; nome: string }>('produto', [id]);
    if (!p) return null;
    const [c] = await ler.porCampo<LinhaSync & ProdutoConteudoSync>('produto_conteudo', 'produto_id', id);
    return { sku: p.sku, nome: p.nome, aplicacao: c?.aplicacao ?? null };
  },
});
const ENTIDADES = [
  { nome: 'produto', modulo: 'core' as const },
  { nome: 'cliente', modulo: 'core' as const },
  { nome: 'produto_atributo', modulo: 'catalogo' as const },
  { nome: 'produto_conteudo', modulo: 'catalogo' as const },
  { nome: 'produto_referencia', modulo: 'catalogo' as const },
];
const PEQUENO = { produtos: 1500, clientes: 60, buscasProduto: 30, buscasCliente: 10, pagina: 500, buscasC9: 0 };

/**
 * C9 de teste com a forma da do Catálogo (a real está no shell do aparelho): pré-seleção pela busca do SDK
 * (`ctx.buscarComDesfecho`), aplicação só dos candidatos (`ctx.linhasPorCampo`) e `produto_ids` como filtro.
 * Passa pelo registro do SDK (validação Zod da entrada e da saída, leitura só do dono e de `depende`).
 */
const leituras: { entidade: string; n: number }[] = [];
const C9_TESTE = implementarConsultaAparelho(CONSULTA_BUSCA_PRODUTOS, async (entrada, ctx) => {
  const d = await ctx.buscarComDesfecho('catalogo.produto', { grupos: normalizarBusca(entrada.q).map((x) => [x]), prefixoNoUltimo: true, limite: 400 });
  const filtro = entrada.produto_ids ? new Set(entrada.produto_ids) : null;
  const ids = (d.buscou ? d.resultados.map((r) => r.chave) : []).filter((id) => !filtro || filtro.has(id));
  const conteudos = await ctx.linhasPorCampo<LinhaSync & ProdutoConteudoSync>('produto_conteudo', 'produto_id', ids);
  leituras.push({ entidade: 'produto_conteudo', n: conteudos.length });
  return { itens: ids.slice(0, entrada.limite).map((id, k) => ({ produto_id: id, nota: 1 / (k + 1), so_aplicacao: false, serve_em: null, equivale_a: null })) };
});
const REGISTRO = criarRegistroConsultasAparelho([{ manifesto: manifestoCatalogo, consultas: [C9_TESTE] }, { manifesto: manifestoVendedor }]);

// SQLite real com 1.500 produtos e aplicação de ~2.000 caracteres: 5 a 14 s cada (a carga com aplicação e a reindexação), mais
// com a suíte e outros agentes rodando juntos no PC
describe('diagnóstico de carga: execução no SQLite (node:sqlite, carga pequena)', { timeout: 120_000 }, () => {
  it('o registro de teste monta sem problema (consulta oferecida pelo Catálogo e usada pelo Vendedor)', () => {
    expect(REGISTRO.problemas).toEqual([]);
  });

  it('grava (com aplicação e referências), monta o índice, reindexa reabrindo o banco, busca e devolve números coerentes', async () => {
    let relogio = 0;
    const fases = new Set<string>();
    const caminho = arquivoTemporario();
    const r = await rodarDiagnosticoCarga(
      {
        driver: await driverNode(caminho),
        reabrir: () => driverNode(caminho),
        migracoesModulos: { catalogo: MIGRACOES },
        entidades: ENTIDADES,
        indicesBusca: [INDICE],
        agora: () => (relogio += 1),
        aoProgresso: (p) => fases.add(p.fase),
        ceder: async () => {},
      },
      PEQUENO,
    );
    expect(r.linhas).toEqual({ produto: 1500, produto_atributo: 3000, produto_conteudo: 1500, produto_referencia: 1250, cliente: 60 });
    expect(r.aplicacaoMedia).toBeGreaterThan(1700);
    // a reindexação pelo caminho real refez o índice: o SKU exato continua em 1º depois dela (conferido abaixo)
    expect(r.carga.reindexacao).not.toBeNull();
    expect(r.carga.reindexacao!.reindexMs).toBeGreaterThan(0);
    // sem as opções do app, a 1ª busca depois da reabertura espera a reindexação (comportamento antigo do adaptador)
    expect(r.carga.reindexacao!.primeiraBusca.buscou).toBe(true);
    expect(r.buscaC9).toBeNull();
    expect(r.sqlite.fts5).toBe(true);
    expect(r.buscaProduto.n).toBe(30);
    expect(r.buscaCliente.n).toBe(10);
    expect(r.buscaCliente.comResultado).toBe(10);
    expect(r.buscaProduto.comResultado).toBeGreaterThan(20);
    expect(r.skuExatoPrimeiro).toBe(true);
    expect(r.carga.totalMs).toBeGreaterThan(0);
    expect([...fases]).toEqual(['abrindo', 'produtos', 'atributos', 'conteudos', 'referencias', 'clientes', 'indice', 'reindexacao', 'busca_produto', 'busca_cliente', 'pronto']);
  });

  it('depois de esvaziar o índice e reabrir o banco, a C9 volta a achar pela aplicação (reindexação das linhas locais)', async () => {
    const caminho = arquivoTemporario();
    const erros: string[] = [];
    const r = await rodarDiagnosticoCarga(
      {
        driver: await driverNode(caminho),
        reabrir: () => driverNode(caminho),
        migracoesModulos: { catalogo: MIGRACOES },
        entidades: ENTIDADES,
        indicesBusca: [INDICE],
        // T-0088: as opções do motor do usuário (caminho real): a 1ª busca do L-1 não espera e a tela varre
        opcoesAdaptador: { buscaSemEsperarIndexacao: true, registrarErro: (m) => erros.push(m) },
        consultas: REGISTRO.registro,
        agora: () => 0,
        ceder: async () => {},
      },
      { ...PEQUENO, buscasProduto: 6, buscasCliente: 1, buscasC9: 12 },
    );
    expect(r.carga.reindexacao!.primeiraBusca).toMatchObject({ buscou: false, motivo: 'indexando' });
    expect(erros).toEqual([]);
    const c9 = r.buscaC9!;
    expect(c9.n).toBe(12);
    expect(c9.planejadas).toBe(12);
    // veículo e ano, só o veículo e com a lista do cliente acham pela aplicação no índice reconstruído
    expect(c9.comResultado).toBeGreaterThanOrEqual(8);
    expect(c9.comAlvo).toBe(8);
    expect(c9.alvoAchado).toBeGreaterThanOrEqual(6);
    expect(Object.keys(c9.p95PorTipo).sort()).toEqual([...TIPOS_BUSCA_C9].sort());
  });

  it('C9 de ponta a ponta pelo registro do SDK: tempos por tipo, produto esperado achado e só a aplicação dos candidatos', async () => {
    leituras.length = 0;
    let relogio = 0;
    const fases: string[] = [];
    const r = await rodarDiagnosticoCarga(
      {
        driver: await driverNode(),
        migracoesModulos: { catalogo: MIGRACOES },
        entidades: ENTIDADES,
        indicesBusca: [INDICE],
        consultas: REGISTRO.registro,
        agora: () => (relogio += 1),
        aoProgresso: (p) => fases.push(p.fase),
        ceder: async () => {},
      },
      { ...PEQUENO, buscasProduto: 6, buscasCliente: 1, buscasC9: 18, orcamentoC9Ms: 1_000_000 },
    );
    const c9 = r.buscaC9!;
    expect(c9.n).toBe(18);
    expect(c9.primeiraMs).toBe(1);
    expect(c9.p95).toBe(1);
    // veículo e ano e com a lista do cliente: o produto esperado vem (FTS na aplicação); o SKU também
    expect(c9.comAlvo).toBe(12);
    expect(c9.alvoAchado).toBeGreaterThanOrEqual(9);
    // a C9 leu só a aplicação dos candidatos (≤ 400 por busca), nunca as 1.500
    expect(leituras.length).toBe(18);
    expect(Math.max(...leituras.map((x) => x.n))).toBeLessThanOrEqual(400);
    expect(r.carga.reindexacao).toBeNull();
    expect(fases.indexOf('busca_c9')).toBeGreaterThan(fases.indexOf('busca_produto'));
    expect(fases.indexOf('busca_c9')).toBeLessThan(fases.indexOf('busca_cliente'));
  });

  it('C9 lenta para no orçamento de tempo, no fim da busca em curso, e o veredito diz NÃO ATENDE', async () => {
    let relogio = 0;
    const r = await rodarDiagnosticoCarga(
      {
        driver: await driverNode(),
        migracoesModulos: { catalogo: MIGRACOES },
        entidades: ENTIDADES,
        indicesBusca: [INDICE],
        consultas: REGISTRO.registro,
        // cada leitura do relógio anda 400 ms: cada busca da C9 "leva" 400 ms
        agora: () => (relogio += 400),
        ceder: async () => {},
      },
      { ...PEQUENO, buscasProduto: 1, buscasCliente: 1, buscasC9: 60, orcamentoC9Ms: 2000 },
    );
    const c9 = r.buscaC9!;
    expect(c9.n).toBeGreaterThan(0);
    expect(c9.n).toBeLessThan(60);
    expect(c9.planejadas).toBe(60);
    const q = { quadros: 1, maiorMs: 1, acimaDoLimite: 0 };
    expect(veredito(r, q).c9).toBe(false);
    expect(textoDoRelatorio(r, q, CTX)).toContain(`INTERROMPIDA: passou do limite de 2.000 ms com ${c9.n} de 60 buscas`);
  });

  it('para quando o usuário sai da tela (cancelado)', async () => {
    let paginas = 0;
    await expect(
      rodarDiagnosticoCarga(
        {
          driver: await driverNode(),
          migracoesModulos: { catalogo: MIGRACOES },
          entidades: ENTIDADES,
          indicesBusca: [INDICE],
          agora: () => 0,
          aoProgresso: (p) => {
            if (p.fase === 'produtos') paginas++;
          },
          cancelado: () => paginas >= 1,
          ceder: async () => {},
        },
        PEQUENO,
      ),
    ).rejects.toBeInstanceOf(DiagnosticoCancelado);
    expect(paginas).toBe(1);
  });

  it('sem o índice do Catálogo no shell, recusa antes de abrir o banco', async () => {
    await expect(
      rodarDiagnosticoCarga({ driver: await driverNode(), migracoesModulos: {}, entidades: ENTIDADES, indicesBusca: [], agora: () => 0 }, PEQUENO),
    ).rejects.toThrow('Índice de busca do Catálogo');
  });
});

describe('diagnóstico de carga: relatório para colar no recado', () => {
  const r: ResultadoDiagnostico = {
    sqlite: { versao: '3.50.3', fts5: true },
    config: CONFIG_PADRAO,
    linhas: { produto: 20_000, produto_atributo: 40_000, produto_conteudo: 20_000, produto_referencia: 16_667, cliente: 500 },
    aplicacaoMedia: 1784.6,
    carga: {
      produtosMs: 18_100,
      atributosMs: 21_000,
      conteudosMs: 30_000,
      referenciasMs: 9000,
      clientesMs: 400,
      totalMs: 41_230,
      indiceMs: 3200,
      reindexacao: { reaberturaMs: 120, reindexMs: 61_500, primeiraBusca: { buscou: false, motivo: 'indexando', ms: 4 } },
    },
    buscaProduto: {
      n: 200,
      p50: 12,
      p95: 48.2,
      max: 95,
      comResultado: 200,
      p95PorTipo: { prefixo_2: 30, duas_palavras: 40, sinonimos_or: 48, sku_hifen: 9, codigo_compacto: 20, ean: 5 },
    },
    buscaC9: {
      n: 60,
      p50: 80,
      p95: 210,
      max: 900,
      primeiraMs: 900,
      comResultado: 58,
      alvoAchado: 39,
      comAlvo: 40,
      p95PorTipo: { veiculo_ano: 210, veiculo: 190, referencia: 40, sku: 30, nome: 150, com_ids: 250 },
      planejadas: 60,
      orcamentoMs: 90_000,
    },
    buscaCliente: { n: 100, p50: 20, p95: 35, max: 60, comResultado: 100 },
    skuExatoPrimeiro: true,
  };
  const ctx = CTX;

  it('veredito: critério 1 pelos quadros > 100 ms; critério 2 pelos dois p95 < 300 ms; C9 medida inteira com p95 < 300 ms', () => {
    expect(veredito(r, { quadros: 1000, maiorMs: 90, acimaDoLimite: 0 })).toEqual({ criterio1: true, criterio2: true, c9: true });
    expect(veredito({ ...r, buscaC9: { ...r.buscaC9!, p95: 300 } }, { quadros: 1, maiorMs: 1, acimaDoLimite: 0 }).c9).toBe(false);
    // interrompida no orçamento não atende, mesmo com p95 baixo no que mediu
    expect(veredito({ ...r, buscaC9: { ...r.buscaC9!, n: 20 } }, { quadros: 1, maiorMs: 1, acimaDoLimite: 0 }).c9).toBe(false);
    expect(veredito({ ...r, buscaC9: null }, { quadros: 1, maiorMs: 1, acimaDoLimite: 0 }).c9).toBeNull();
    expect(veredito(r, { quadros: 1000, maiorMs: 180, acimaDoLimite: 2 }).criterio1).toBe(false);
    expect(veredito({ ...r, buscaCliente: { ...r.buscaCliente, p95: 300 } }, { quadros: 1, maiorMs: 1, acimaDoLimite: 0 }).criterio2).toBe(false);
  });

  it('texto com hora no fuso do tenant, aparelho, números e os dois critérios', () => {
    const texto = textoDoRelatorio(r, { quadros: 2460, maiorMs: 84, acimaDoLimite: 0 }, ctx);
    expect(texto).toContain('Quando: 2026-11-05 08:10 (America/Manaus)');
    expect(texto).toContain('Aparelho: samsung SM-A105M · Android 10 (API 29) · 3,0 GB');
    expect(texto).toContain('20.000 SKUs + 40.000 atributos + 20.000 aplicações + 16.667 referências + 500 clientes em 41,2 s');
    expect(texto).toContain('p95 48 ms');
    expect(texto).toContain('2.460 quadros · maior 84 ms · acima de 100 ms: 0');
    expect(texto).toContain('Critério 1 (carga sem travar a tela, nenhum quadro > 100 ms): OK');
    expect(texto).toContain('Critério 2 (busca offline p95 < 300 ms): OK');
    expect(texto).toContain('20.000 aplicações + 16.667 referências');
    expect(texto).toContain('aplicação média: 1.785 caracteres');
    expect(texto).toContain('reindexação completa (índice v3 vazio, das linhas locais): 61,5 s · reabertura 120 ms');
    expect(texto).toContain('1ª busca durante a reindexação: respondeu indexando (a tela varre) em 4,0 ms');
    expect(texto).toContain('Busca do Novo pedido (C9, 60 de 60): p50 80 ms · p95 210 ms · máx 900 ms · 1ª (fria) 900 ms · com resultado 58');
    expect(texto).toContain('p95 por tipo: veiculo_ano 210 ms · veiculo 190 ms · referencia 40 ms · sku 30 ms · nome 150 ms · com_ids 250 ms');
    expect(texto).toContain('produto esperado achado: 39 de 40');
    expect(texto).not.toContain('INTERROMPIDA');
    expect(texto).toContain('T-0084 critério 5 (busca do Novo pedido offline, p95 < 300 ms): OK');
    // sem dado pessoal: só sintético e técnico
    expect(texto).not.toMatch(/@/);
  });
});

describe('diagnóstico de carga: textos da tela (revisão de UX)', () => {
  it('a barra diz a etapa: 10 etapas, abrir e pronto fora da contagem', () => {
    expect(ETAPAS_DIAGNOSTICO).toHaveLength(10);
    expect(etapaDaFase('produtos')).toEqual({ numero: 1, total: 10 });
    expect(etapaDaFase('busca_cliente')).toEqual({ numero: 10, total: 10 });
    expect(etapaDaFase('abrindo')).toBeNull();
    expect(etapaDaFase('pronto')).toBeNull();
    expect(tituloDoProgresso({ fase: 'atributos', feito: 12_000, total: 40_000 })).toBe('Etapa 2 de 10 · Gravando atributos · 12.000 de 40.000');
    expect(tituloDoProgresso({ fase: 'indice', feito: 0, total: 1 })).toBe('Etapa 6 de 10 · Montando o índice de busca…');
    expect(tituloDoProgresso({ fase: 'reindexacao', feito: 0, total: 1 })).toBe('Etapa 7 de 10 · Reindexando a busca…');
    expect(tituloDoProgresso({ fase: 'busca_c9', feito: 30, total: 60 })).toBe('Etapa 9 de 10 · Buscando no Novo pedido · 30 de 60');
    expect(tituloDoProgresso({ fase: 'abrindo', feito: 0, total: 1 })).toBe('Abrindo o banco de teste…');
  });

  it('veredito no topo: três linhas com OK, NÃO ATENDE ou NÃO MEDIDO escrito', () => {
    const linhas = linhasDoVeredito({ criterio1: true, criterio2: false, c9: null });
    expect(linhas.map((l) => `${l.texto}: ${l.rotulo}`)).toEqual([
      'Critério 1 · carga sem travar a tela (nenhum quadro > 100 ms): OK',
      'Critério 2 · busca p95 < 300 ms: NÃO ATENDE',
      'Busca do Novo pedido p95 < 300 ms (T-0084, critério 5): NÃO MEDIDO',
    ]);
    expect(linhas.map((l) => l.ok)).toEqual([true, false, false]);
    expect(linhas.map((l) => l.tom)).toEqual(['sucesso', 'erro', 'neutro']);
    expect(linhasDoVeredito({ criterio1: true, criterio2: true, c9: true })[2]!.rotulo).toBe('OK');
  });
});
