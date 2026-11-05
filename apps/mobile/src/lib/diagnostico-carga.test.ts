/** T-0008 (critérios 1 e 2): regra pura do diagnóstico de carga e busca e uma execução pequena no `node:sqlite`. */
import { ClienteSyncSchema, ProdutoSyncSchema } from '@macuxi/core/contracts';
import { ProdutoAtributoSyncSchema } from '@macuxi/catalogo/contracts';
import { definirIndiceBusca, type DriverSqlite, type LinhaSync, type MigracaoAparelho } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import {
  atributosSinteticos,
  clienteSintetico,
  consultasDeProduto,
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
  resumirTempos,
  rodarDiagnosticoCarga,
  TERMOS_CLIENTE,
  textoDoRelatorio,
  TIPOS_BUSCA_PRODUTO,
  tituloDoProgresso,
  veredito,
  type ResultadoDiagnostico,
} from './diagnostico-carga';

/**
 * Driver `node:sqlite` carregado pelo NOME (import dinâmico): assim o typecheck do app não puxa `node:sqlite` para o
 * grafo (desenho T-0008, P3: o Metro e o tsc do apps/mobile nunca veem o driver Node).
 */
async function driverNode(): Promise<DriverSqlite> {
  const nome = '@macuxi/platform-sdk/sqlite-node';
  const m = (await import(/* @vite-ignore */ nome)) as { criarDriverNode(caminho?: string): DriverSqlite };
  return m.criarDriverNode(':memory:');
}

describe('diagnóstico de carga: quem abre', () => {
  it('só nos builds de desenvolvimento e preview; nunca em produção', () => {
    expect(diagnosticoDisponivel('desenvolvimento')).toBe(true);
    expect(diagnosticoDisponivel('preview')).toBe(true);
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
      CREATE TABLE catalogo__busca_doc (rid INTEGER PRIMARY KEY, produto_id TEXT NOT NULL UNIQUE, sku TEXT, nome TEXT);
      CREATE VIRTUAL TABLE catalogo__busca USING fts5(sku, nome, content = 'catalogo__busca_doc', content_rowid = 'rid', tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    `,
  },
];
const INDICE = definirIndiceBusca<'sku' | 'nome'>({
  id: 'catalogo.produto',
  modulo: 'catalogo',
  tabelaDoc: 'catalogo__busca_doc',
  tabelaFts: 'catalogo__busca',
  colunaChave: 'produto_id',
  colunas: { sku: 10, nome: 5 },
  fontes: ['produto'],
  chaveDe: (_e, linha) => linha.id,
  async documento(id, ler) {
    const [p] = await ler.porIds<LinhaSync & { sku: string; nome: string }>('produto', [id]);
    return p ? { sku: p.sku, nome: p.nome } : null;
  },
});
const ENTIDADES = [
  { nome: 'produto', modulo: 'core' as const },
  { nome: 'cliente', modulo: 'core' as const },
  { nome: 'produto_atributo', modulo: 'catalogo' as const },
];
const PEQUENO = { produtos: 1500, clientes: 60, buscasProduto: 30, buscasCliente: 10, pagina: 500 };

// SQLite real com 1.500 produtos: ~3 s sozinho, passou de 5 s (timeout padrão) com a suíte e outros agentes rodando juntos no PC
describe('diagnóstico de carga: execução no SQLite (node:sqlite, carga pequena)', { timeout: 30_000 }, () => {
  it('grava, monta o índice, busca e devolve números coerentes', async () => {
    let relogio = 0;
    const fases = new Set<string>();
    const r = await rodarDiagnosticoCarga(
      {
        driver: await driverNode(),
        migracoesModulos: { catalogo: MIGRACOES },
        entidades: ENTIDADES,
        indicesBusca: [INDICE],
        agora: () => (relogio += 1),
        aoProgresso: (p) => fases.add(p.fase),
        ceder: async () => {},
      },
      PEQUENO,
    );
    expect(r.linhas).toEqual({ produto: 1500, produto_atributo: 3000, cliente: 60 });
    expect(r.sqlite.fts5).toBe(true);
    expect(r.buscaProduto.n).toBe(30);
    expect(r.buscaCliente.n).toBe(10);
    expect(r.buscaCliente.comResultado).toBe(10);
    expect(r.buscaProduto.comResultado).toBeGreaterThan(20);
    expect(r.skuExatoPrimeiro).toBe(true);
    expect(r.carga.totalMs).toBeGreaterThan(0);
    expect([...fases]).toEqual(['abrindo', 'produtos', 'atributos', 'clientes', 'indice', 'busca_produto', 'busca_cliente', 'pronto']);
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
    linhas: { produto: 20_000, produto_atributo: 40_000, cliente: 500 },
    carga: { produtosMs: 18_100, atributosMs: 21_000, clientesMs: 400, totalMs: 41_230, indiceMs: 3200 },
    buscaProduto: {
      n: 200,
      p50: 12,
      p95: 48.2,
      max: 95,
      comResultado: 200,
      p95PorTipo: { prefixo_2: 30, duas_palavras: 40, sinonimos_or: 48, sku_hifen: 9, codigo_compacto: 20, ean: 5 },
    },
    buscaCliente: { n: 100, p50: 20, p95: 35, max: 60, comResultado: 100 },
    skuExatoPrimeiro: true,
  };
  const ctx = {
    quando: new Date('2026-11-05T12:10:00.000Z'),
    fuso: 'America/Manaus',
    app: 'Macuxi Campo',
    versao: '1.0.0',
    perfil: 'preview' as const,
    aparelho: 'samsung SM-A105M',
    sistema: 'Android 10 (API 29)',
    memoriaBytes: 3 * 1024 ** 3,
  };

  it('veredito: critério 1 pelos quadros > 100 ms; critério 2 pelos dois p95 < 300 ms', () => {
    expect(veredito(r, { quadros: 1000, maiorMs: 90, acimaDoLimite: 0 })).toEqual({ criterio1: true, criterio2: true });
    expect(veredito(r, { quadros: 1000, maiorMs: 180, acimaDoLimite: 2 }).criterio1).toBe(false);
    expect(veredito({ ...r, buscaCliente: { ...r.buscaCliente, p95: 300 } }, { quadros: 1, maiorMs: 1, acimaDoLimite: 0 }).criterio2).toBe(false);
  });

  it('texto com hora no fuso do tenant, aparelho, números e os dois critérios', () => {
    const texto = textoDoRelatorio(r, { quadros: 2460, maiorMs: 84, acimaDoLimite: 0 }, ctx);
    expect(texto).toContain('Quando: 2026-11-05 08:10 (America/Manaus)');
    expect(texto).toContain('Aparelho: samsung SM-A105M · Android 10 (API 29) · 3,0 GB');
    expect(texto).toContain('20.000 SKUs + 40.000 atributos + 500 clientes em 41,2 s');
    expect(texto).toContain('p95 48 ms');
    expect(texto).toContain('2.460 quadros · maior 84 ms · acima de 100 ms: 0');
    expect(texto).toContain('Critério 1 (carga sem travar a tela, nenhum quadro > 100 ms): OK');
    expect(texto).toContain('Critério 2 (busca offline p95 < 300 ms): OK');
    // sem dado pessoal: só sintético e técnico
    expect(texto).not.toMatch(/@/);
  });
});

describe('diagnóstico de carga: textos da tela (revisão de UX)', () => {
  it('a barra diz a etapa: 6 etapas, abrir e pronto fora da contagem', () => {
    expect(ETAPAS_DIAGNOSTICO).toHaveLength(6);
    expect(etapaDaFase('produtos')).toEqual({ numero: 1, total: 6 });
    expect(etapaDaFase('busca_cliente')).toEqual({ numero: 6, total: 6 });
    expect(etapaDaFase('abrindo')).toBeNull();
    expect(etapaDaFase('pronto')).toBeNull();
    expect(tituloDoProgresso({ fase: 'atributos', feito: 12_000, total: 40_000 })).toBe('Etapa 2 de 6 · Gravando atributos · 12.000 de 40.000');
    expect(tituloDoProgresso({ fase: 'indice', feito: 0, total: 1 })).toBe('Etapa 4 de 6 · Montando o índice de busca…');
    expect(tituloDoProgresso({ fase: 'abrindo', feito: 0, total: 1 })).toBe('Abrindo o banco de teste…');
  });

  it('veredito no topo: duas linhas com OK ou NÃO ATENDE escrito', () => {
    const linhas = linhasDoVeredito({ criterio1: true, criterio2: false });
    expect(linhas.map((l) => `${l.texto}: ${l.rotulo}`)).toEqual([
      'Critério 1 · carga sem travar a tela (nenhum quadro > 100 ms): OK',
      'Critério 2 · busca p95 < 300 ms: NÃO ATENDE',
    ]);
    expect(linhas.map((l) => l.ok)).toEqual([true, false]);
  });
});
