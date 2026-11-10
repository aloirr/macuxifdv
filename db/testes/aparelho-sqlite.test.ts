/**
 * Esquema SQLite do APARELHO (T-0008 P2; dono: banco-dados). Especificação: docs/banco/aparelho-sqlite.md.
 * Roda no `node:sqlite` (driver do SDK, `@macuxi/platform-sdk/sqlite-node`), sem Postgres.
 *
 * 1. DDL da busca do Catálogo (modules/catalogo/db/aparelho.ts): dono dos objetos (`verificarDonoDasMigracoes`),
 *    colunas na ordem, tokenizer `unicode61 remove_diacritics 2`, `prefix='2 3'`, content externo, vocabulário e o
 *    índices de expressão usados pelo `porCampo` e pelo `linhasPorCampo` (v2, T-0052-B4) (EXPLAIN QUERY PLAN).
 *    A subida v1 → v2 real (dados de preço, estoque, vínculo e conteúdo preservados) e a v2 → v3 real (T-0084/T-0085: FTS
 *    recriada com `aplicacao` e `referencias`, reindexação sozinha a partir de `ent_*`) estão na seção 2.
 * 2. Migrações do aparelho: subida por versão (só a nova roda, dados preservados) e downgrade (recria do zero).
 * 3. RN-CORE-02 (doc 03): módulo desativado = dados locais dele apagados (linhas, `mod:<m>:*`, objetos `<m>__*`,
 *    `_esquema`), o resto intacto; reativação recria pelas migrações.
 * 4. RN-CORE-15 (doc 03): aparelho bloqueado = dados locais do tenant e fila apagados. Procedimento de reserva (quando o
 *    arquivo não pode ser apagado) prova que nada do conteúdo apagado sobra no arquivo nem no WAL.
 * 5. Carga de 20 mil SKUs (+ atributos) e 500 clientes e busca (critérios da T-0008). No `pnpm test` a busca só tem
 *    um limite de regressão folgado (p95 < 1.500 ms: pega FTS sem índice, não carga da máquina); a meta de p95 < 300 ms
 *    só é afirmada com `MACUXI_PERF=1` (job de desempenho à parte) e vale de fato no aparelho (P7). Os números saem no
 *    console (`[aparelho]`) e estão registrados em docs/banco/aparelho-sqlite.md §8.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aplicarMigracoes,
  ARQUIVO_DE_USUARIO_RE,
  arquivoDoUsuario,
  criarArmazenamentoSqlite,
  ddlDaEntidade,
  definirIndiceBusca,
  listarObjetos,
  MIGRACOES_PLATAFORMA,
  normalizarBusca,
  PRAGMAS_ABERTURA,
  verificarDonoDasMigracoes,
  type ConsultaTexto,
  type DriverSqlite,
  type LinhaSync,
  type MigracaoAparelho,
  type ModuloId,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { COLUNAS_BUSCA_CATALOGO, migracoesAparelho, TABELAS_BUSCA_CATALOGO } from '../../modules/catalogo/db/aparelho';
import { manifest as manifestCatalogo } from '../../modules/catalogo/manifest';

const ENTIDADES_CATALOGO = [...manifestCatalogo.sync];
/** Versão mais nova do esquema do Catálogo no app (v2 desde a T-0052-B4; v3 desde a T-0084/T-0085). */
const VERSAO_CATALOGO = migracoesAparelho.at(-1)!.versao;
/** Entidades de outros módulos que o índice lê (ADR 0005: produto é do Core). */
const ENTIDADES_DE_FORA = ['produto'];

// ---------- utilitários ----------

const pastas: string[] = [];
function pastaTemporaria(): string {
  const p = mkdtempSync(join(tmpdir(), 'macuxi-aparelho-'));
  pastas.push(p);
  return p;
}
afterAll(() => {
  // no Windows, arquivo ainda aberto por teste que falhou não sai: não derruba a suíte por isso
  for (const p of pastas)
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a pasta temporária do sistema é limpa depois */
    }
});

/** Banco vazio como o adaptador deixa antes das migrações do Catálogo (PRAGMAs, plataforma e tabelas `ent_<e>`). */
async function bancoComCatalogo(): Promise<DriverSqlite> {
  const d = criarDriverNode();
  await d.executar(PRAGMAS_ABERTURA);
  await aplicarMigracoes(d, 'plataforma', MIGRACOES_PLATAFORMA, () => new Date(0));
  for (const e of [...ENTIDADES_CATALOGO, ...ENTIDADES_DE_FORA]) await d.executar(ddlDaEntidade(e));
  await aplicarMigracoes(d, 'catalogo', migracoesAparelho, () => new Date(0));
  return d;
}

const nomesDasColunas = async (d: DriverSqlite, tabela: string) =>
  (await d.todas<{ name: string }>('SELECT name FROM pragma_table_info(?)', [tabela])).map((c) => c.name);

const PESOS: Record<(typeof COLUNAS_BUSCA_CATALOGO)[number], number> = {
  sku: 10,
  ean: 10,
  codigos: 8,
  nome: 5,
  marca: 3,
  categoria: 2,
  atributos: 1,
  aplicacao: 2,
  referencias: 8,
};
/** Colunas e pesos da FTS até a v2 (para os testes que sobem um aparelho antigo). */
const COLUNAS_ATE_V2 = ['sku', 'ean', 'codigos', 'nome', 'marca', 'categoria', 'atributos'] as const;
const PESOS_ATE_V2 = Object.fromEntries(COLUNAS_ATE_V2.map((c) => [c, PESOS[c]])) as Record<(typeof COLUNAS_ATE_V2)[number], number>;

interface Produto extends LinhaSync {
  sku: string;
  ean: string | null;
  nome: string;
  marca: string;
  categoria: string;
  descricao: string;
}
interface Atributo extends LinhaSync {
  produto_id: string;
  nome: string;
  valor: string;
}
interface Conteudo extends LinhaSync {
  produto_id: string;
  aplicacao?: string | null;
}
interface Referencia extends LinhaSync {
  produto_id: string;
  marca_id: string;
  codigo: string;
  ordem: number;
}
interface Cliente extends LinhaSync {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  cidade: string;
}

const compacto = (s: string) => normalizarBusca(s).join('');

/**
 * Réplica de teste da declaração do índice (a real é do modulo-catalogo, modules/catalogo/app/indice.ts). v3: fontes
 * `produto_conteudo` (aplicação) e `produto_referencia` (códigos crus em `referencias`, compactos em `codigos`), chave =
 * `produto_id` da linha (T-0084 §6). Aqui a aplicação entra crua (a expansão de anos é do domain do Catálogo).
 */
const INDICE = definirIndiceBusca({
  id: 'catalogo.produto',
  modulo: 'catalogo',
  tabelaDoc: TABELAS_BUSCA_CATALOGO.doc,
  tabelaFts: TABELAS_BUSCA_CATALOGO.fts,
  colunaChave: TABELAS_BUSCA_CATALOGO.colunaChave,
  colunas: PESOS,
  fontes: ['produto', 'produto_atributo', 'produto_conteudo', 'produto_referencia'],
  chaveDe: (e, l) => (e === 'produto' ? l.id : ((l as Atributo).produto_id ?? null)),
  async documento(id, ler) {
    const [p] = await ler.porIds<Produto>('produto', [id]);
    if (!p) return null;
    const attrs = await ler.porCampo<Atributo>('produto_atributo', 'produto_id', id);
    const conteudo = (await ler.porCampo<Conteudo>('produto_conteudo', 'produto_id', id)).find((c) => !c.deleted_at);
    const refs = (await ler.porCampo<Referencia>('produto_referencia', 'produto_id', id)).filter((r) => !r.deleted_at).sort((x, y) => x.ordem - y.ordem);
    return {
      sku: p.sku,
      ean: p.ean,
      codigos: [compacto(p.sku), ...refs.map((r) => compacto(r.codigo))].join(' '),
      nome: p.nome,
      marca: p.marca,
      categoria: p.categoria,
      atributos: attrs
        .map((a) => `${a.nome} ${a.valor}`)
        .sort()
        .join(' '),
      aplicacao: conteudo?.aplicacao ?? '',
      referencias: refs.map((r) => r.codigo).join(' '),
    };
  },
});
/** A mesma declaração com as colunas da v2 (aparelho antigo, antes da v3). */
const INDICE_ATE_V2 = definirIndiceBusca({
  id: 'catalogo.produto',
  modulo: 'catalogo',
  tabelaDoc: TABELAS_BUSCA_CATALOGO.doc,
  tabelaFts: TABELAS_BUSCA_CATALOGO.fts,
  colunaChave: TABELAS_BUSCA_CATALOGO.colunaChave,
  colunas: PESOS_ATE_V2,
  fontes: ['produto', 'produto_atributo'],
  chaveDe: (e, l) => (e === 'produto' ? l.id : ((l as Atributo).produto_id ?? null)),
  async documento(id, ler) {
    const [p] = await ler.porIds<Produto>('produto', [id]);
    if (!p) return null;
    const attrs = await ler.porCampo<Atributo>('produto_atributo', 'produto_id', id);
    return {
      sku: p.sku,
      ean: p.ean,
      codigos: compacto(p.sku),
      nome: p.nome,
      marca: p.marca,
      categoria: p.categoria,
      atributos: attrs
        .map((a) => `${a.nome} ${a.valor}`)
        .sort()
        .join(' '),
    };
  },
});

const ENTIDADES_REGISTRO: { nome: string; modulo: ModuloId }[] = [
  { nome: 'produto', modulo: 'core' },
  { nome: 'cliente', modulo: 'core' },
  ...ENTIDADES_CATALOGO.map((nome) => ({ nome, modulo: 'catalogo' as ModuloId })),
];

function abrirArmazenamento(driver: DriverSqlite, migracoes: readonly MigracaoAparelho[] = migracoesAparelho) {
  // o app de cada versão declara o índice com as colunas da FTS dela (até a v2: 7 colunas; v3 em diante: 9)
  const ultima = Math.max(...migracoes.map((m) => m.versao));
  return criarArmazenamentoSqlite(driver, {
    migracoesModulos: { catalogo: migracoes },
    entidades: ENTIDADES_REGISTRO,
    indicesBusca: [ultima >= 3 ? INDICE : INDICE_ATE_V2],
    agora: () => new Date('2026-10-31T12:00:00.000Z'),
  });
}

// ---------- gerador determinístico (mesma forma do P6) ----------

const NOMES = ['Rolamento', 'Pastilha de freio', 'Disco de freio', 'Óleo de motor', 'Filtro de ar', 'Correia dentada', 'Amortecedor', 'Vela de ignição', 'Junta do cabeçote', 'Bomba d’água', 'Lâmpada farol', 'Embreagem'];
const COMPLEMENTOS = ['dianteiro', 'traseiro', 'esquerdo', 'direito', 'reforçado', 'cerâmica', 'sintético 5W30', 'linha pesada', 'ação rápida', 'anti-ruído'];
const MARCAS = ['Bosch', 'NGK', 'Cofap', 'Fras-le', 'SKF', 'Mahle', 'Valeo', 'Gates', 'Nakata', 'Tecfil'];
const CATEGORIAS = ['Freios', 'Motor', 'Suspensão', 'Elétrica', 'Transmissão', 'Filtros', 'Arrefecimento', 'Iluminação'];
const CIDADES = ['Boa Vista', 'Manaus', 'Belém', 'Macapá', 'Santarém', 'Parintins'];

const uuid = (prefixo: number, i: number) => `${String(prefixo).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`;
const QUANDO = '2026-10-01T00:00:00.000Z';

function produto(i: number): Produto {
  return {
    id: uuid(1, i),
    updated_at: QUANDO,
    deleted_at: null,
    sku: `${6000 + (i % 4000)}-${['2RS', 'ZZ', 'C3', 'XL', 'P'][i % 5]}-${i}`,
    ean: i % 7 === 0 ? null : String(7890000000000 + i),
    nome: `${NOMES[i % NOMES.length]} ${COMPLEMENTOS[(i * 7) % COMPLEMENTOS.length]} ${i}`,
    marca: MARCAS[(i * 3) % MARCAS.length]!,
    categoria: CATEGORIAS[i % CATEGORIAS.length]!,
    descricao: 'Descrição técnica do produto para o vendedor, com aplicação, medidas e observações. '.repeat(4),
  };
}
const atributos = (i: number): Atributo[] => [
  { id: uuid(2, i * 2), updated_at: QUANDO, deleted_at: null, produto_id: uuid(1, i), nome: 'aplicação', valor: ['Gol', 'Onix', 'Hilux', 'Strada', 'HB20'][i % 5]! },
  { id: uuid(2, i * 2 + 1), updated_at: QUANDO, deleted_at: null, produto_id: uuid(1, i), nome: 'medida', valor: `${10 + (i % 40)}mm` },
];
const cliente = (i: number): Cliente => ({
  id: uuid(3, i),
  updated_at: QUANDO,
  deleted_at: null,
  razao_social: `Auto Peças São ${['João', 'José', 'Sebastião', 'Pedro'][i % 4]} ${i} Ltda`,
  nome_fantasia: `${['Ponto', 'Casa', 'Central', 'Mundo'][i % 4]} das Peças ${i}`,
  cnpj: String(10_000_000_000_000 + i * 97).padStart(14, '0'),
  cidade: CIDADES[i % CIDADES.length]!,
});

/** Grava em páginas de 1.000 (`TAMANHO_PAGINA_SYNC`), como o pull. */
async function puxar(a: ReturnType<typeof abrirArmazenamento>, entidade: string, linhas: readonly LinhaSync[]) {
  for (let i = 0; i < linhas.length; i += 1000) {
    const pagina = linhas.slice(i, i + 1000);
    await a.linhas.aplicar(entidade, pagina, `${pagina.at(-1)!.updated_at}|${pagina.at(-1)!.id}`);
  }
}

const percentil = (xs: number[], p: number) => {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]!;
};
const ms = (n: number) => Math.round(n * 10) / 10;

// ---------- 1. DDL da busca do Catálogo ----------

describe('aparelho: DDL da busca do Catálogo (modules/catalogo/db/aparelho.ts)', () => {
  it('todo objeto é catalogo__* e índice só sobre entidade do Catálogo (verificarDonoDasMigracoes = [])', async () => {
    expect(await verificarDonoDasMigracoes(criarDriverNode(), 'catalogo', migracoesAparelho, ENTIDADES_CATALOGO, ENTIDADES_DE_FORA)).toEqual([]);
  });

  it('o verificador recusa índice sobre ent_produto (entidade do Core, ADR 0005)', async () => {
    const proibida: MigracaoAparelho[] = [{ versao: 1, sql: "CREATE INDEX catalogo__produto_sku ON ent_produto (json_extract(dados, '$.sku'))" }];
    const problemas = await verificarDonoDasMigracoes(criarDriverNode(), 'catalogo', proibida, ENTIDADES_CATALOGO, ENTIDADES_DE_FORA);
    expect(problemas).toEqual(['índice catalogo__produto_sku sobre ent_produto, que não é do módulo catalogo']);
  });

  it('versões inteiras e crescentes; arquivo só com strings SQL (sem import)', () => {
    const versoes = migracoesAparelho.map((m) => m.versao);
    expect(versoes).toEqual([...versoes].sort((a, b) => a - b));
    expect(new Set(versoes).size).toBe(versoes.length);
    expect(versoes.every((v) => Number.isInteger(v) && v > 0)).toBe(true);
    const fonte = readFileSync(new URL('../../modules/catalogo/db/aparelho.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/\brequire\(/);
  });

  it('objetos criados, colunas na ordem do índice e opções da FTS5', async () => {
    const d = await bancoComCatalogo();
    const doCatalogo = (await listarObjetos(d)).filter((o) => o.name.startsWith('catalogo__')).map((o) => `${o.type} ${o.name}`);
    expect(doCatalogo).toEqual([
      'table catalogo__busca',
      'table catalogo__busca_config',
      'table catalogo__busca_data',
      'table catalogo__busca_doc',
      'table catalogo__busca_docsize',
      'table catalogo__busca_idx',
      'table catalogo__busca_vocab',
      'index catalogo__cliente_tabela_preco_cliente',
      'index catalogo__estoque_saldo_produto',
      'index catalogo__produto_atributo_produto',
      'index catalogo__produto_conteudo_produto',
      'index catalogo__produto_no_no',
      'index catalogo__produto_referencia_produto',
      'index catalogo__produto_relacao_produto',
      'index catalogo__tabela_preco_item_filial',
      'index catalogo__tabela_preco_item_produto',
    ]);
    expect([...COLUNAS_BUSCA_CATALOGO]).toEqual(['sku', 'ean', 'codigos', 'nome', 'marca', 'categoria', 'atributos', 'aplicacao', 'referencias']);
    expect(await nomesDasColunas(d, 'catalogo__busca')).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(Object.keys(PESOS)).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(await nomesDasColunas(d, 'catalogo__busca_doc')).toEqual(['rid', 'produto_id', ...COLUNAS_BUSCA_CATALOGO]);
    const sql = (await d.primeira<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'catalogo__busca'"))!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain("content = 'catalogo__busca_doc'");
    expect(sql).toContain("content_rowid = 'rid'");
    expect(sql).toContain("tokenize = 'unicode61 remove_diacritics 2'");
    expect(sql).toContain("prefix = '2 3'");
    expect(sql).not.toMatch(/detail\s*=/); // detail=full (padrão): consulta de frase
    expect(await d.primeira('SELECT dono, versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ dono: 'catalogo', versao: VERSAO_CATALOGO });
    expect((await d.primeira<{ ok: number }>("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS ok"))!.ok).toBe(1);
  });

  it('tokenizer: sem acento e sem cedilha, código separado e compacto, prefixo de 2 letras, frase e vocabulário', async () => {
    const d = await bancoComCatalogo();
    const docs = [
      ['p1', '6203-2RS', null, '62032rs', 'Rolamento ação rápida', 'SKF', 'Transmissão', 'aplicação Gol', null, null],
      ['p2', 'PF-100', '7891234567895', 'pf100 cb3401', 'Pastilha de freio cerâmica', 'Fras-le', 'Freios', 'aplicação Onix', 'Fiat Uno 1.0/1.4 2010–2014 2011 2012 2013', 'CB 3401'],
      ['p3', 'OL-5W30', null, 'ol5w30 fb0207', 'Óleo de motor sintético 5W30', 'Mahle', 'Motor', 'medida 1L', 'VW Gol G5/G6 1.0/1.6 2009–2016', 'FB-0207'],
    ];
    for (const v of docs)
      await d.rodar(`INSERT INTO catalogo__busca_doc (produto_id, ${COLUNAS_BUSCA_CATALOGO.join(', ')}) VALUES (${['produto_id', ...COLUNAS_BUSCA_CATALOGO].map(() => '?').join(', ')})`, v);
    await d.rodar("INSERT INTO catalogo__busca (catalogo__busca) VALUES ('rebuild')");
    const achar = async (fts: string) =>
      (
        await d.todas<{ produto_id: string }>(
          `SELECT d.produto_id FROM catalogo__busca JOIN catalogo__busca_doc d ON d.rid = catalogo__busca.rowid
            WHERE catalogo__busca MATCH ? ORDER BY bm25(catalogo__busca, ${Object.values(PESOS).join(', ')}), d.produto_id`,
          [fts],
        )
      ).map((r) => r.produto_id);
    expect(await achar('"acao"')).toEqual(['p1']); // "ação" = "acao"
    expect(await achar('"oleo" AND "sintetico"')).toEqual(['p3']); // "Óleo", "sintético"
    expect(await achar('"transmissao"')).toEqual(['p1']);
    expect(await achar('"ce"*')).toEqual(['p2']); // prefixo de 2 letras ("cerâmica")
    expect(await achar('"6203 2rs"')).toEqual(['p1']); // código com hífen = frase
    expect(await achar('"62032rs"*')).toEqual(['p1']); // forma compacta na coluna codigos
    expect(await achar('"7891234567895"')).toEqual(['p2']); // EAN
    expect(await achar('"freio" AND ("ceramica" OR "disco")')).toEqual(['p2']); // sinônimos: AND explícito
    // v3 (RN-CAT-12): aplicação com o ano expandido; "1.0/1.4" e "G5/G6" são termos, não faixa
    expect(await achar('"uno" AND "2012"')).toEqual(['p2']);
    expect(await achar('"gol" AND "g5"')).toEqual(['p3']); // "Gol" também está nos atributos de p1, mas sem "g5"
    expect(await achar('"aplicacao" : "2012"')).toEqual(['p2']); // filtro de coluna da FTS5
    // v3 (RN-CAT-09): código do concorrente cru (frase) e compacto (coluna codigos)
    expect(await achar('"cb 3401"')).toEqual(['p2']);
    expect(await achar('"cb3401"')).toEqual(['p2']);
    expect(await achar('"fb 0207"')).toEqual(['p3']);
    expect(await achar('"referencias" : "fb"*')).toEqual(['p3']);
    const vocab = (await d.todas<{ term: string }>("SELECT term FROM catalogo__busca_vocab WHERE term >= 'ac' AND term < 'ad' ORDER BY term")).map(
      (r) => r.term,
    );
    expect(vocab).toEqual(['acao']);
    // prefixo de 2 e 3 letras vira índice próprio (consulta por prefixo sem varrer o vocabulário)
    const plano = (await d.todas<{ detail: string }>('EXPLAIN QUERY PLAN SELECT rowid FROM catalogo__busca WHERE catalogo__busca MATCH ?', ['"ro"*'])).map(
      (r) => r.detail,
    );
    expect(plano.join(' ')).toMatch(/VIRTUAL TABLE INDEX/);
  });

  it('índice de expressão serve o porCampo do SDK (EXPLAIN QUERY PLAN usa catalogo__produto_atributo_produto)', async () => {
    const d = await bancoComCatalogo();
    // exatamente o SQL de `porCampo` em packages/platform-sdk/src/sqlite/armazenamento.ts
    const plano = await d.todas<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT id, dados FROM ent_produto_atributo WHERE json_extract(dados, '$.produto_id') = ? ORDER BY id",
      ['x'],
    );
    expect(plano.map((p) => p.detail).join(' ')).toContain('USING INDEX catalogo__produto_atributo_produto');
  });

  // v2 (T-0052-B4): exatamente o SQL de `linhasPorCampo` em packages/platform-sdk/src/sqlite/armazenamento.ts
  it.each([
    ['estoque_saldo', 'produto_id', 'catalogo__estoque_saldo_produto'],
    ['tabela_preco_item', 'produto_id', 'catalogo__tabela_preco_item_produto'],
    ['cliente_tabela_preco', 'cliente_id', 'catalogo__cliente_tabela_preco_cliente'],
    ['produto_conteudo', 'produto_id', 'catalogo__produto_conteudo_produto'],
    ['produto_atributo', 'produto_id', 'catalogo__produto_atributo_produto'],
    ['produto_referencia', 'produto_id', 'catalogo__produto_referencia_produto'],
    // v4 (T-0085): lista por linha (vínculos do nível aberto e "oferece junto" dos itens da tela)
    ['produto_no', 'no_id', 'catalogo__produto_no_no'],
    ['produto_relacao', 'produto_id', 'catalogo__produto_relacao_produto'],
  ])('linhasPorCampo(%s, %s) usa o índice de expressão %s (EXPLAIN QUERY PLAN)', async (entidade, campo, indice) => {
    const d = await bancoComCatalogo();
    const plano = await d.todas<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id, dados FROM ent_${entidade} WHERE json_extract(dados, '$.${campo}') IN (SELECT value FROM json_each(?)) ORDER BY id`,
      [JSON.stringify(['a', 'b'])],
    );
    expect(plano.map((p) => p.detail).join(' ')).toContain(`USING INDEX ${indice}`);
  });

  it('preço: o índice (produto_id, tabela_preco_id) também serve produto + tabela do cliente', async () => {
    const d = await bancoComCatalogo();
    const plano = await d.todas<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id, dados FROM ent_tabela_preco_item
        WHERE json_extract(dados, '$.produto_id') IN (SELECT value FROM json_each(?)) AND json_extract(dados, '$.tabela_preco_id') = ?`,
      [JSON.stringify(['a']), 't'],
    );
    // as duas colunas do índice na busca (e não só o prefixo produto_id)
    expect(plano.map((p) => p.detail).join(' ')).toContain('USING INDEX catalogo__tabela_preco_item_produto (<expr>=? AND <expr>=?)');
  });

  // v5 (T-0149, RN-CORE-39): preço por filial
  it('preço por filial (v5): linhasPorCampo(tabela_preco_item, tabela_preco_id) usa o prefixo de catalogo__tabela_preco_item_filial', async () => {
    const d = await bancoComCatalogo();
    const plano = await d.todas<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id, dados FROM ent_tabela_preco_item WHERE json_extract(dados, '$.tabela_preco_id') IN (SELECT value FROM json_each(?)) ORDER BY id`,
      [JSON.stringify(['t'])],
    );
    expect(plano.map((p) => p.detail).join(' ')).toContain('USING INDEX catalogo__tabela_preco_item_filial');
  });

  it('preço por filial (v5): "a tabela tem item nesta filial?" busca pelas duas colunas do índice', async () => {
    const d = await bancoComCatalogo();
    const plano = await d.todas<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT 1 FROM ent_tabela_preco_item
        WHERE json_extract(dados, '$.tabela_preco_id') = ? AND json_extract(dados, '$.filial_id') = ? LIMIT 1`,
      ['t', 'f'],
    );
    expect(plano.map((p) => p.detail).join(' ')).toMatch(/USING (COVERING )?INDEX catalogo__tabela_preco_item_filial \(<expr>=\? AND <expr>=\?\)/);
  });
});

// ---------- 2. Migrações do aparelho: subida e downgrade ----------

describe('aparelho: migrações por versão (subida só para frente; downgrade recria)', () => {
  /** Versão seguinte só de teste (a real mais nova é VERSAO_CATALOGO). */
  const PROXIMA_DE_TESTE: MigracaoAparelho = {
    versao: VERSAO_CATALOGO + 1,
    sql: 'CREATE TABLE catalogo__favorito (produto_id TEXT PRIMARY KEY, criado_em TEXT NOT NULL) WITHOUT ROWID;',
  };

  it('vN → vN+1 aplica só a nova e preserva a busca; app antigo (vN) recria os objetos do Catálogo do zero', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-teste.db');
    let a = abrirArmazenamento(criarDriverNode(arquivo));
    await puxar(a, 'produto', [produto(1), produto(2)]);
    await a.busca.finalizar!();
    expect((await a.busca.buscar('catalogo.produto', { grupos: [['freio']], prefixoNoUltimo: false })).length).toBe(2);
    await a.fechar();

    a = abrirArmazenamento(criarDriverNode(arquivo), [...migracoesAparelho, PROXIMA_DE_TESTE]);
    await a.pronto;
    const d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: VERSAO_CATALOGO + 1 });
    expect(await d.primeira("SELECT count(*) AS n FROM catalogo__busca_doc")).toEqual({ n: 2 }); // v1 não rodou de novo
    expect((await listarObjetos(d)).some((o) => o.name === 'catalogo__favorito')).toBe(true);
    await d.fechar();
    await a.fechar();

    // downgrade: versão do aparelho (N+1) > versão do app (N) ⇒ objetos catalogo__* apagados e recriados; ent_* e kv intactos
    // (repovoar a doc a partir de ent_produto é do SDK: lacuna L-1 em docs/banco/aparelho-sqlite.md §9)
    a = abrirArmazenamento(criarDriverNode(arquivo));
    await a.pronto;
    const d2 = criarDriverNode(arquivo);
    expect(await d2.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: VERSAO_CATALOGO });
    expect((await listarObjetos(d2)).some((o) => o.name === 'catalogo__favorito')).toBe(false);
    expect(await d2.primeira('SELECT count(*) AS n FROM ent_produto')).toEqual({ n: 2 });
    await d2.fechar();
    await a.fechar();
  });

  it('v1 → v2 real (T-0052-B4): só os índices novos; linhas, busca e cursores preservados; linhasPorCampo igual', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-v1-v2.db');
    const V1 = migracoesAparelho.filter((m) => m.versao === 1);
    const ATE_V2 = migracoesAparelho.filter((m) => m.versao <= 2);
    const deposito = uuid(5, 1);
    const tabela = uuid(5, 2);
    const outraTabela = uuid(5, 3);
    const linha = (prefixo: number, i: number, dados: Record<string, unknown>): LinhaSync => ({ id: uuid(prefixo, i), updated_at: QUANDO, deleted_at: null, ...dados });
    const saldos = [1, 2, 3].map((i) => linha(6, i, { produto_id: uuid(1, i), deposito_id: deposito, quantidade: i * 10, atualizado_em: QUANDO }));
    const precos = [1, 2, 3].flatMap((i) => [
      linha(7, i * 2, { tabela_preco_id: tabela, produto_id: uuid(1, i), preco_centavos: 1000 * i }),
      linha(7, i * 2 + 1, { tabela_preco_id: outraTabela, produto_id: uuid(1, i), preco_centavos: 900 * i }),
    ]);
    const vinculos = [linha(8, 1, { cliente_id: uuid(3, 1), tabela_preco_id: tabela }), linha(8, 2, { cliente_id: uuid(3, 2), tabela_preco_id: outraTabela })];
    const conteudos = [1, 2].map((i) => linha(9, i, { produto_id: uuid(1, i), descricao: `Conteúdo ${i}`, argumentos: [], faq: [], campanha: false }));

    // aparelho em v1 com dados
    let a = abrirArmazenamento(criarDriverNode(arquivo), V1);
    await puxar(a, 'produto', [produto(1), produto(2), produto(3)]);
    await puxar(a, 'produto_atributo', [...atributos(1), ...atributos(2), ...atributos(3)]);
    await puxar(a, 'estoque_saldo', saldos);
    await puxar(a, 'tabela_preco_item', precos);
    await puxar(a, 'cliente_tabela_preco', vinculos);
    await puxar(a, 'produto_conteudo', conteudos);
    await a.busca.finalizar!();
    const antesV1 = await a.linhas.porCampo!('tabela_preco_item', 'produto_id', [uuid(1, 1), uuid(1, 3)]);
    expect(antesV1).toHaveLength(4);
    await a.fechar();
    let d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 1 });
    expect((await listarObjetos(d)).some((o) => o.name === 'catalogo__estoque_saldo_produto')).toBe(false);
    await d.fechar();

    // app novo (v1 + v2): só a v2 roda
    a = abrirArmazenamento(criarDriverNode(arquivo), ATE_V2);
    await a.pronto;
    expect(a.modulosIndisponiveis()).toEqual([]);
    d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 2 });
    const indices = (await listarObjetos(d)).filter((o) => o.type === 'index' && o.name.startsWith('catalogo__')).map((o) => o.name);
    expect(indices).toEqual([
      'catalogo__cliente_tabela_preco_cliente',
      'catalogo__estoque_saldo_produto',
      'catalogo__produto_atributo_produto',
      'catalogo__produto_conteudo_produto',
      'catalogo__tabela_preco_item_produto',
    ]);
    const contagens: [string, number][] = [
      ['ent_produto', 3],
      ['ent_produto_atributo', 6],
      ['ent_estoque_saldo', 3],
      ['ent_tabela_preco_item', 6],
      ['ent_cliente_tabela_preco', 2],
      ['ent_produto_conteudo', 2],
      ['catalogo__busca_doc', 3],
    ];
    for (const [t, n] of contagens) expect(await d.primeira(`SELECT count(*) AS n FROM ${t}`)).toEqual({ n });
    expect(await d.primeira('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
    await d.fechar();
    for (const e of ['produto', 'produto_atributo', 'estoque_saldo', 'tabela_preco_item', 'cliente_tabela_preco', 'produto_conteudo'])
      expect(await a.ler(`sync:cursor:${e}`)).not.toBeNull();

    // mesmas respostas, agora pelo índice
    expect(await a.linhas.porCampo!('tabela_preco_item', 'produto_id', [uuid(1, 1), uuid(1, 3)])).toEqual(antesV1);
    expect((await a.linhas.porCampo!<LinhaSync & { quantidade: number }>('estoque_saldo', 'produto_id', [uuid(1, 2)])).map((l) => l.quantidade)).toEqual([20]);
    expect((await a.linhas.porCampo!('cliente_tabela_preco', 'cliente_id', [uuid(3, 2)])).map((l) => l.id)).toEqual([uuid(8, 2)]);
    expect((await a.linhas.porCampo!('produto_conteudo', 'produto_id', [uuid(1, 1), uuid(1, 3)])).map((l) => l.id)).toEqual([uuid(9, 1)]);
    expect((await a.busca.buscar('catalogo.produto', { grupos: [['onix']], prefixoNoUltimo: false })).map((r) => r.chave)).toEqual([uuid(1, 1)]);
    // pull depois da v2 mantém o índice em dia (linha nova achada por ele)
    await puxar(a, 'estoque_saldo', [linha(6, 4, { produto_id: uuid(1, 2), deposito_id: uuid(5, 9), quantidade: 7, atualizado_em: QUANDO })]);
    const saldos2 = await a.linhas.porCampo!<LinhaSync & { quantidade: number }>('estoque_saldo', 'produto_id', [uuid(1, 2)]);
    expect(saldos2.map((l) => l.quantidade).sort((x, y) => x - y)).toEqual([7, 20]);
    await a.fechar();
  });

  it('v2 → v3 real (T-0084/T-0085): FTS recriada com aplicacao e referencias, reindexação sozinha a partir de ent_*, nada repuxado', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-v2-v3.db');
    const ATE_V2 = migracoesAparelho.filter((m) => m.versao <= 2);
    const linha = (prefixo: number, i: number, dados: Record<string, unknown>): LinhaSync => ({ id: uuid(prefixo, i), updated_at: QUANDO, deleted_at: null, ...dados });
    const conteudos = [
      linha(9, 1, { produto_id: uuid(1, 1), aplicacao: 'Fiat Uno 1.0/1.4 2010–2014 2011 2012 2013; Fiat Palio 1.0/1.4 2012–2016' }),
      linha(9, 2, { produto_id: uuid(1, 2), aplicacao: 'VW Gol G5/G6 1.0/1.6 2009–2016' }),
    ];
    const marca = uuid(10, 1);
    const referencias = [
      linha(11, 1, { produto_id: uuid(1, 1), marca_id: marca, codigo: 'CB 3401', ordem: 1 }),
      linha(11, 2, { produto_id: uuid(1, 2), marca_id: marca, codigo: 'FB-0207', ordem: 1 }),
      // apagada: sai do índice
      { ...linha(11, 3, { produto_id: uuid(1, 3), marca_id: marca, codigo: 'XX 9999', ordem: 1 }), deleted_at: QUANDO },
    ];

    // aparelho em v2 com produtos, atributos, conteúdo e referências em ent_* (no APK real, produto_referencia chega com a
    // v3 e é puxada do início; aqui já tem linhas para provar que a reindexação lê todas as fontes)
    let a = abrirArmazenamento(criarDriverNode(arquivo), ATE_V2);
    await puxar(a, 'produto', [produto(1), produto(2), produto(3)]);
    await puxar(a, 'produto_atributo', [...atributos(1), ...atributos(2), ...atributos(3)]);
    await puxar(a, 'produto_conteudo', conteudos);
    await puxar(a, 'produto_referencia', referencias);
    await a.busca.finalizar!();
    expect((await a.busca.buscar('catalogo.produto', { grupos: [['onix']], prefixoNoUltimo: false })).map((r) => r.chave)).toEqual([uuid(1, 1)]);
    await a.fechar();
    let d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 2 });
    expect(await nomesDasColunas(d, 'catalogo__busca')).toEqual([...COLUNAS_ATE_V2]);
    await d.fechar();

    // app novo (v3): recria a FTS (documentos antigos saem), marca a reindexação e reconstrói de ent_* na primeira busca
    a = abrirArmazenamento(criarDriverNode(arquivo), migracoesAparelho.filter((m) => m.versao <= 3));
    await a.pronto;
    expect(a.modulosIndisponiveis()).toEqual([]);
    d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 3 });
    expect(await nomesDasColunas(d, 'catalogo__busca')).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(await nomesDasColunas(d, 'catalogo__busca_doc')).toEqual(['rid', 'produto_id', ...COLUNAS_BUSCA_CATALOGO]);
    expect((await listarObjetos(d)).some((o) => o.name === 'catalogo__produto_referencia_produto')).toBe(true);
    // a referência apagada não fica em ent_* (o pull remove a linha)
    for (const [t, n] of [['ent_produto', 3], ['ent_produto_atributo', 6], ['ent_produto_conteudo', 2], ['ent_produto_referencia', 2]] as const)
      expect(await d.primeira(`SELECT count(*) AS n FROM ${t}`)).toEqual({ n });
    await d.fechar();
    for (const e of ['produto', 'produto_atributo', 'produto_conteudo', 'produto_referencia']) expect(await a.ler(`sync:cursor:${e}`)).not.toBeNull();

    const achar = async (grupos: string[][]) => (await a.busca.buscar('catalogo.produto', { grupos, prefixoNoUltimo: false })).map((r) => r.chave);
    expect(await achar([['onix']])).toEqual([uuid(1, 1)]); // atributo continua (reindexado)
    expect(await achar([['uno'], ['2012']])).toEqual([uuid(1, 1)]); // aplicação (RN-CAT-12)
    expect(await achar([['palio']])).toEqual([uuid(1, 1)]);
    expect(await achar([['g5']])).toEqual([uuid(1, 2)]);
    expect(await achar([['cb3401']])).toEqual([uuid(1, 1)]); // compacto da referência em `codigos` (RN-CAT-09)
    expect(await achar([['fb'], ['0207']])).toEqual([uuid(1, 2)]); // código cru em `referencias`
    expect(await achar([['xx9999']])).toEqual([]); // referência apagada fora do índice
    d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT count(*) AS n FROM catalogo__busca_doc')).toEqual({ n: 3 });
    expect(await d.primeira('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
    await d.fechar();

    // pull depois da v3: referência nova entra no índice pelo incremental (chave = produto_id da linha)
    await puxar(a, 'produto_referencia', [linha(11, 4, { produto_id: uuid(1, 3), marca_id: marca, codigo: 'RF 7788', ordem: 1 })]);
    await a.busca.finalizar!();
    expect(await achar([['rf7788']])).toEqual([uuid(1, 3)]);
    expect((await a.linhas.porCampo!('produto_referencia', 'produto_id', [uuid(1, 1), uuid(1, 3)])).map((l) => l.id).sort()).toEqual([uuid(11, 1), uuid(11, 4)].sort());
    await a.fechar();
  });

  it('v3 → v4 real (T-0085, lista por linha): só os 2 índices novos; linhas, FTS e cursores preservados; linhasPorCampo igual', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-v3-v4.db');
    const ATE_V3 = migracoesAparelho.filter((m) => m.versao <= 3);
    const linha = (prefixo: number, i: number, dados: Record<string, unknown>): LinhaSync => ({ id: uuid(prefixo, i), updated_at: QUANDO, deleted_at: null, ...dados });
    // árvore sistema › grupo › linha (2 linhas) e 4 produtos: 1 e 2 na linha A, 3 na linha B, 4 sem linha
    const sistema = linha(12, 1, { pai_id: null, nivel: 1, codigo: 'S1', nome: 'Freios', ordem: 1, ativo: true });
    const grupo = linha(12, 2, { pai_id: sistema.id, nivel: 2, codigo: 'G1', nome: 'Pastilhas', ordem: 1, ativo: true });
    const linhaA = linha(12, 3, { pai_id: grupo.id, nivel: 3, codigo: 'L1', nome: 'Leves', ordem: 1, ativo: true });
    const linhaB = linha(12, 4, { pai_id: grupo.id, nivel: 3, codigo: 'L2', nome: 'Pesados', ordem: 2, ativo: true });
    const vinculos = [linha(13, 1, { produto_id: uuid(1, 1), no_id: linhaA.id }), linha(13, 2, { produto_id: uuid(1, 2), no_id: linhaA.id }), linha(13, 3, { produto_id: uuid(1, 3), no_id: linhaB.id })];
    const relacoes = [
      linha(14, 1, { produto_id: uuid(1, 1), relacionado_id: uuid(1, 2), tipo: 'complementar', ordem: 1, ativo: true }),
      linha(14, 2, { produto_id: uuid(1, 1), relacionado_id: uuid(1, 4), tipo: 'complementar', ordem: 2, ativo: true }),
      linha(14, 3, { produto_id: uuid(1, 3), relacionado_id: uuid(1, 1), tipo: 'substituto', ordem: 1, ativo: true }),
    ];

    // aparelho em v3 com árvore, vínculos e relações
    let a = abrirArmazenamento(criarDriverNode(arquivo), ATE_V3);
    await puxar(a, 'produto', [1, 2, 3, 4].map(produto));
    await puxar(a, 'catalogo_no', [sistema, grupo, linhaA, linhaB]);
    await puxar(a, 'produto_no', vinculos);
    await puxar(a, 'produto_relacao', relacoes);
    await a.busca.finalizar!();
    const vinculosAntes = await a.linhas.porCampo!('produto_no', 'no_id', [linhaA.id, linhaB.id]);
    const relacoesAntes = await a.linhas.porCampo!('produto_relacao', 'produto_id', [uuid(1, 1), uuid(1, 3)]);
    expect(vinculosAntes).toHaveLength(3);
    expect(relacoesAntes).toHaveLength(3);
    await a.fechar();
    let d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 3 });
    expect((await listarObjetos(d)).some((o) => o.name === 'catalogo__produto_no_no')).toBe(false);
    const docsAntes = await d.todas('SELECT rid, produto_id FROM catalogo__busca_doc ORDER BY rid');
    await d.fechar();

    // app novo (v4): só a v4 roda (a v5 da T-0149 fica de fora: este caso prova só a subida v3 → v4)
    a = abrirArmazenamento(criarDriverNode(arquivo), migracoesAparelho.filter((m) => m.versao <= 4));
    await a.pronto;
    expect(a.modulosIndisponiveis()).toEqual([]);
    d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 4 });
    const indices = (await listarObjetos(d)).filter((o) => o.type === 'index' && o.name.startsWith('catalogo__')).map((o) => o.name);
    expect(indices).toEqual(expect.arrayContaining(['catalogo__produto_no_no', 'catalogo__produto_relacao_produto']));
    for (const [t, n] of [['ent_produto', 4], ['ent_catalogo_no', 4], ['ent_produto_no', 3], ['ent_produto_relacao', 3]] as const)
      expect(await d.primeira(`SELECT count(*) AS n FROM ${t}`)).toEqual({ n });
    // FTS não foi recriada nem reindexada (mesmos documentos, mesmos rid)
    expect(await d.todas('SELECT rid, produto_id FROM catalogo__busca_doc ORDER BY rid')).toEqual(docsAntes);
    expect(await d.primeira('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' });
    // com dados, o plano continua no índice (o SQL exato do `linhasPorCampo` do SDK)
    for (const [t, campo, indice] of [['ent_produto_no', 'no_id', 'catalogo__produto_no_no'], ['ent_produto_relacao', 'produto_id', 'catalogo__produto_relacao_produto']] as const) {
      const plano = await d.todas<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id, dados FROM ${t} WHERE json_extract(dados, '$.${campo}') IN (SELECT value FROM json_each(?)) ORDER BY id`,
        [JSON.stringify(['a'])],
      );
      expect(plano.map((p) => p.detail).join(' ')).toContain(`USING INDEX ${indice}`);
    }
    await d.fechar();
    for (const e of ['produto', 'catalogo_no', 'produto_no', 'produto_relacao']) expect(await a.ler(`sync:cursor:${e}`)).not.toBeNull();

    // mesmas respostas, agora pelo índice
    expect(await a.linhas.porCampo!('produto_no', 'no_id', [linhaA.id, linhaB.id])).toEqual(vinculosAntes);
    expect(await a.linhas.porCampo!('produto_relacao', 'produto_id', [uuid(1, 1), uuid(1, 3)])).toEqual(relacoesAntes);
    expect((await a.linhas.porCampo!('produto_no', 'no_id', [linhaB.id])).map((l) => l.id)).toEqual([uuid(13, 3)]);
    expect(await a.linhas.porCampo!('produto_no', 'no_id', [grupo.id])).toEqual([]); // o grupo não tem vínculo direto
    expect((await a.busca.buscar('catalogo.produto', { grupos: [['freio']], prefixoNoUltimo: false })).map((r) => r.chave).sort()).toEqual([uuid(1, 1), uuid(1, 2)]);
    // pull depois da v4: vínculo novo achado pelo índice; vínculo apagado sai
    await puxar(a, 'produto_no', [linha(13, 4, { produto_id: uuid(1, 4), no_id: linhaB.id }), { ...vinculos[2]!, updated_at: '2026-10-02T00:00:00.000Z', deleted_at: '2026-10-02T00:00:00.000Z' }]);
    expect((await a.linhas.porCampo!('produto_no', 'no_id', [linhaB.id])).map((l) => l.id)).toEqual([uuid(13, 4)]);
    await a.fechar();
  });
});

// ---------- 3. RN-CORE-02 ----------

describe('aparelho: RN-CORE-02 (módulo desativado: dados locais dele apagados do aparelho)', () => {
  it('apaga linhas, mod:catalogo:*, objetos catalogo__* e _esquema do Catálogo; Core intacto; reativação recria', async () => {
    const a = abrirArmazenamento(criarDriverNode());
    await puxar(a, 'produto', [produto(1), produto(2), produto(3)]);
    await puxar(a, 'produto_atributo', [...atributos(1), ...atributos(2)]);
    await puxar(a, 'sinonimo', [{ id: uuid(4, 1), updated_at: QUANDO, deleted_at: null }]);
    await a.gravar('mod:catalogo:favoritos', [uuid(1, 1)]);
    await a.gravar('mod:core:filtro', { cidade: 'Boa Vista' });
    await a.gravar('sync:fila', [{ id: 'item-1', modulo: 'core' }]);
    await a.busca.finalizar!();

    await a.removerModulo!('catalogo');

    expect(await a.linhas.contar('produto_atributo')).toBe(0);
    expect(await a.linhas.contar('sinonimo')).toBe(0);
    expect(await a.linhas.contar('produto')).toBe(3); // entidade do Core
    expect(await a.chaves('mod:catalogo:')).toEqual([]);
    expect(await a.ler('mod:core:filtro')).toEqual({ cidade: 'Boa Vista' });
    expect(await a.ler('sync:fila')).toEqual([{ id: 'item-1', modulo: 'core' }]); // fila nunca em tabela de módulo
    expect(await a.ler('sync:cursor:produto_atributo')).toBeNull();
    expect(await a.ler('sync:cursor:produto')).not.toBeNull();
    await a.fechar();
  });

  it('no arquivo: nenhum catalogo__*, _esquema sem catalogo e espaço devolvido (incremental_vacuum)', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-rn-core-02.db');
    const a = abrirArmazenamento(criarDriverNode(arquivo));
    const produtos = Array.from({ length: 2000 }, (_, i) => produto(i));
    await puxar(a, 'produto', produtos);
    await puxar(a, 'produto_atributo', produtos.flatMap((_, i) => atributos(i)));
    await a.busca.finalizar!();
    const d = criarDriverNode(arquivo);
    const paginas = async () => (await d.primeira<{ n: number }>('SELECT page_count AS n FROM pragma_page_count()'))!.n;
    const antes = await paginas();

    await a.removerModulo!('catalogo');

    expect((await listarObjetos(d)).filter((o) => o.name.startsWith('catalogo__'))).toEqual([]);
    expect(await d.primeira('SELECT count(*) AS n FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ n: 0 });
    expect(await d.primeira('SELECT count(*) AS n FROM ent_produto_atributo')).toEqual({ n: 0 });
    expect(await d.primeira('SELECT count(*) AS n FROM ent_produto')).toEqual({ n: 2000 });
    expect(await paginas()).toBeLessThan(antes); // auto_vacuum=INCREMENTAL + incremental_vacuum
    expect((await d.primeira<{ n: number }>('SELECT freelist_count AS n FROM pragma_freelist_count()'))!.n).toBe(0);

    // reativação: a primeira busca recria pelas migrações; o pull desde o início repõe os atributos
    expect(await a.busca.buscar('catalogo.produto', { grupos: [['gol']], prefixoNoUltimo: false })).toEqual([]);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: VERSAO_CATALOGO });
    await puxar(a, 'produto_atributo', [...atributos(5)]);
    await a.busca.finalizar!();
    const r = await a.busca.buscar('catalogo.produto', { grupos: [['gol']], prefixoNoUltimo: false });
    expect(r.map((x) => x.chave)).toContain(uuid(1, 5));
    await d.fechar();
    await a.fechar();
  });
});

// ---------- 4. RN-CORE-15 ----------

// Arquivos SQLite de usuário no aparelho: `ARQUIVO_DE_USUARIO_RE` e `arquivoDoUsuario` do SDK (T-0088 §1.1 e §10:
// `macuxi-u-<usuario>-t-<tenant|demo>.db`, id fora do formato de UUID vira `h` + 32 hex do SHA-256) e os anexos do WAL.
const TENANT_RN15 = 'aaaaaaaa-0000-4000-8000-000000000015';

/**
 * Reserva da RN-CORE-15 quando o arquivo NÃO pode ser apagado (ex.: outra conexão aberta): esvazia tudo e reescreve o
 * arquivo (VACUUM) com o WAL truncado. O caminho normal é fechar e apagar os arquivos (docs/banco/aparelho-sqlite.md §6).
 */
async function esvaziarArquivoDoAparelho(d: DriverSqlite) {
  const PLATAFORMA = ['kv', '_esquema', '_entidades'];
  await d.transacaoExclusiva(async (tx) => {
    // tabelas virtuais primeiro (levam as tabelas-sombra); depois tudo o que não é da plataforma (ent_*, <m>__*, índices)
    for (const o of (await listarObjetos(tx)).filter((x) => /^CREATE VIRTUAL/i.test(x.sql ?? '')))
      await tx.executar(`DROP TABLE IF EXISTS "${o.name}"`);
    for (const o of await listarObjetos(tx)) {
      if (PLATAFORMA.includes(o.name) || PLATAFORMA.includes(o.tbl_name)) continue;
      const tipo = o.type === 'view' ? 'VIEW' : o.type === 'trigger' ? 'TRIGGER' : o.type === 'index' ? 'INDEX' : 'TABLE';
      await tx.executar(`DROP ${tipo} IF EXISTS "${o.name}"`);
    }
    await tx.executar("DELETE FROM kv; DELETE FROM _entidades; DELETE FROM _esquema WHERE dono <> 'plataforma';");
  });
  await d.executar('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
}

describe('aparelho: RN-CORE-15 (aparelho bloqueado: dados locais do tenant e fila apagados)', () => {
  const MARCA = 'SIGILO-CLIENTE-RN15';

  async function arquivoComDados(pasta: string, usuario: string) {
    const nome = arquivoDoUsuario({ usuarioId: usuario, tenantId: TENANT_RN15 });
    if (!nome) throw new Error('arquivoDoUsuario sem nome para um usuário com id');
    const arquivo = join(pasta, nome);
    const a = abrirArmazenamento(criarDriverNode(arquivo));
    await puxar(a, 'cliente', Array.from({ length: 300 }, (_, i) => ({ ...cliente(i), razao_social: `${MARCA} ${i}` })));
    await puxar(a, 'produto', Array.from({ length: 300 }, (_, i) => ({ ...produto(i), nome: `${MARCA} produto ${i}` })));
    await a.busca.finalizar!();
    await a.gravar('sync:fila', [{ id: 'pedido-1', observacao: `${MARCA} fila` }]);
    return { arquivo, a };
  }
  const contem = (arquivo: string) =>
    [arquivo, `${arquivo}-wal`].some((f) => existsSync(f) && readFileSync(f).includes(Buffer.from(MARCA)));

  it('caminho normal: fechar e apagar .db, -wal e -shm de TODOS os usuários do aparelho', async () => {
    const pasta = pastaTemporaria();
    const u1 = await arquivoComDados(pasta, '11111111-1111-4111-8111-111111111111');
    const u2 = await arquivoComDados(pasta, '22222222-2222-4222-8222-222222222222');
    await u2.a.fechar();
    expect(readdirSync(pasta).filter((f) => ARQUIVO_DE_USUARIO_RE.test(f)).length).toBeGreaterThanOrEqual(2);
    await u1.a.fechar();
    for (const f of readdirSync(pasta).filter((x) => ARQUIVO_DE_USUARIO_RE.test(x))) rmSync(join(pasta, f));
    expect(readdirSync(pasta).filter((f) => f.startsWith('macuxi-u-'))).toEqual([]);
  });

  it('reserva: só DELETE deixa o conteúdo no arquivo; esvaziar + VACUUM + checkpoint não deixa nada', async () => {
    const pasta = pastaTemporaria();
    const { arquivo, a } = await arquivoComDados(pasta, '33333333-3333-4333-8333-333333333333');
    // o que o motor faz hoje (limparAparelho): remove logicamente; o conteúdo ainda está nas páginas livres/WAL
    for (const k of await a.chaves('')) await a.remover(k);
    expect(await a.chaves('')).toEqual([]);
    expect(contem(arquivo)).toBe(true);
    await a.fechar();

    const d = criarDriverNode(arquivo);
    await esvaziarArquivoDoAparelho(d);
    expect(await d.primeira('SELECT count(*) AS n FROM kv')).toEqual({ n: 0 });
    expect((await listarObjetos(d)).map((o) => o.name)).toEqual(['_entidades', '_esquema', 'kv']);
    await d.fechar();
    expect(contem(arquivo)).toBe(false);
  });
});

// ---------- 5. Carga e busca (critérios da T-0008) ----------

// Decisão (docs/banco/aparelho-sqlite.md §8.1): no Node, com a máquina dividida com outras suítes, o p95 varia 3–4×
// (109,8 ms sozinho × 379,8 ms na raiz). O `pnpm test` afirma só um limite de regressão; a meta entra com MACUXI_PERF=1.
const MEDIR_META = process.env.MACUXI_PERF === '1';
const LIMITE_BUSCA_MS = MEDIR_META ? 300 : 1_500;

describe(`aparelho: carga de 20 mil SKUs + 500 clientes e busca p95 < ${LIMITE_BUSCA_MS} ms (node:sqlite)`, () => {
  it('carrega sem bloquear o loop por muito tempo e busca produto e cliente dentro do limite', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-carga.db');
    const a = abrirArmazenamento(criarDriverNode(arquivo));
    await a.pronto;
    const produtos = Array.from({ length: 20_000 }, (_, i) => produto(i));
    const attrs = produtos.flatMap((_, i) => atributos(i));
    const clientes = Array.from({ length: 500 }, (_, i) => cliente(i));

    // "sem travar": maior intervalo entre dois ticks do loop durante a carga (o lote de 500 roda inteiro de uma vez)
    let ultimo = performance.now();
    let maiorBloqueio = 0;
    const pulso = setInterval(() => {
      const agora = performance.now();
      maiorBloqueio = Math.max(maiorBloqueio, agora - ultimo);
      ultimo = agora;
    }, 1);
    const t0 = performance.now();
    await puxar(a, 'produto', produtos);
    const tProdutos = performance.now() - t0;
    await puxar(a, 'produto_atributo', attrs);
    const tAtributos = performance.now() - t0 - tProdutos;
    await puxar(a, 'cliente', clientes);
    const tCarga = performance.now() - t0;
    clearInterval(pulso);
    const t1 = performance.now();
    await a.busca.finalizar!();
    const tRebuild = performance.now() - t1;

    expect(await a.linhas.contar('produto')).toBe(20_000);
    expect(await a.linhas.contar('produto_atributo')).toBe(40_000);
    expect(await a.linhas.contar('cliente')).toBe(500);

    // 300 consultas típicas: prefixo curto, duas palavras, sinônimos (OR), código com hífen, código compacto, EAN
    const consultas: ConsultaTexto[] = [];
    for (let k = 0; k < 300; k++) {
      const i = (k * 7919) % 20_000;
      const p = produto(i);
      const tipo = k % 6;
      if (tipo === 0) consultas.push({ grupos: [[NOMES[k % NOMES.length]!.slice(0, 2)]], prefixoNoUltimo: true, limite: 200 });
      else if (tipo === 1) consultas.push({ grupos: [['pastilha'], ['fre']], prefixoNoUltimo: true, limite: 200 });
      else if (tipo === 2) consultas.push({ grupos: [['oleo', 'lubrificante'], ['motor', 'sintetico']], prefixoNoUltimo: false, limite: 200 });
      else if (tipo === 3) consultas.push({ grupos: [[p.sku]], prefixoNoUltimo: false, limite: 200 });
      else if (tipo === 4) consultas.push({ grupos: [[compacto(p.sku).slice(0, 6)]], prefixoNoUltimo: true, limite: 200 });
      else consultas.push({ grupos: [[p.ean ?? p.sku]], prefixoNoUltimo: false, limite: 200 });
    }
    const TIPOS = ['prefixo_2', 'duas_palavras', 'sinonimos_or', 'sku_hifen', 'codigo_compacto', 'ean'] as const;
    const medirProdutos = async () => {
      const tempos: number[] = [];
      const porTipo = new Map<string, number[]>(TIPOS.map((x) => [x, []]));
      let comResultado = 0;
      for (const [k, c] of consultas.entries()) {
        const t = performance.now();
        const r = await a.busca.buscar('catalogo.produto', c);
        // + leitura dos 50 primeiros (o que a tela mostra)
        await a.linhas.porIds('produto', r.slice(0, 50).map((x) => x.chave));
        tempos.push(performance.now() - t);
        porTipo.get(TIPOS[k % 6]!)!.push(tempos.at(-1)!);
        if (r.length > 0) comResultado++;
      }
      return { tempos, porTipo, comResultado };
    };
    // clientes: 500 filtram em memória (o Core não usa FTS, desenho T-0016 §8): listar + normalizar + includes
    const medirClientes = async () => {
      const tempos: number[] = [];
      for (let k = 0; k < 300; k++) {
        const termo = normalizarBusca(['sao jose', 'ponto', 'boa vista', 'pecas 12', 'central'][k % 5]!);
        const t = performance.now();
        const todos = await a.linhas.listar<Cliente>('cliente');
        const achados = todos.filter((c) => {
          const alvo = normalizarBusca(`${c.razao_social} ${c.nome_fantasia} ${c.cnpj} ${c.cidade}`).join(' ');
          return termo.every((x) => alvo.includes(x));
        });
        tempos.push(performance.now() - t);
        expect(achados.length).toBeGreaterThan(0);
      }
      return tempos;
    };
    // como o job de carga (desenho T-0008 §4.3): uma repetição se estourar (máquina compartilhada), antes de falhar
    let prod = await medirProdutos();
    let tentativasProduto = 1;
    if (percentil(prod.tempos, 95) >= LIMITE_BUSCA_MS) {
      prod = await medirProdutos();
      tentativasProduto++;
    }
    let temposCli = await medirClientes();
    let tentativasCliente = 1;
    if (percentil(temposCli, 95) >= LIMITE_BUSCA_MS) {
      temposCli = await medirClientes();
      tentativasCliente++;
    }
    expect(prod.comResultado).toBeGreaterThanOrEqual(295);
    const exato = await a.busca.buscar('catalogo.produto', { grupos: [[produto(1234).sku]], prefixoNoUltimo: false });
    expect(exato[0]?.chave).toBe(uuid(1, 1234));

    const resumo = {
      carga_total_ms: ms(tCarga),
      produtos_20k_ms: ms(tProdutos),
      atributos_40k_ms: ms(tAtributos),
      maior_bloqueio_loop_ms: ms(maiorBloqueio),
      rebuild_ms: ms(tRebuild),
      busca_produto_p50_ms: ms(percentil(prod.tempos, 50)),
      busca_produto_p95_ms: ms(percentil(prod.tempos, 95)),
      busca_produto_p95_por_tipo_ms: Object.fromEntries([...prod.porTipo].map(([x, v]) => [x, ms(percentil(v, 95))])),
      busca_cliente_p50_ms: ms(percentil(temposCli, 50)),
      busca_cliente_p95_ms: ms(percentil(temposCli, 95)),
      tentativas: { produto: tentativasProduto, cliente: tentativasCliente },
      limite_busca_ms: LIMITE_BUSCA_MS,
      modo: MEDIR_META ? 'meta (MACUXI_PERF=1)' : 'regressao',
    };
    console.info(`[aparelho] ${JSON.stringify(resumo)}`);
    expect(resumo.busca_produto_p95_ms).toBeLessThan(LIMITE_BUSCA_MS);
    expect(resumo.busca_cliente_p95_ms).toBeLessThan(LIMITE_BUSCA_MS);
    // tempo de carga só é registrado (varia 10× com a máquina ocupada); o orçamento de CI (5 s) é do job de carga (P6, testes)
    // tamanho por família de objetos (dbstat) e do WAL, para o dicionário (docs/banco/aparelho-sqlite.md §7)
    const wal = existsSync(`${arquivo}-wal`) ? statSync(`${arquivo}-wal`).size : 0; // antes de fechar (fechar faz checkpoint)
    await a.fechar();
    const d = criarDriverNode(arquivo);
    const familia = (nome: string) =>
      nome.startsWith('catalogo__produto_atributo') ? 'ent_produto_atributo' : nome.startsWith('catalogo__') ? 'catalogo__busca*' : nome.replace(/__cursor$/, '');
    const tamanhos = new Map<string, number>();
    for (const r of await d.todas<{ name: string; s: number }>('SELECT name, sum(pgsize) AS s FROM dbstat GROUP BY name')) {
      const k = familia(r.name.replace(/^sqlite_autoindex_(.+)_\d+$/, '$1'));
      tamanhos.set(k, (tamanhos.get(k) ?? 0) + r.s);
    }
    const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
    console.info(
      `[aparelho] tamanhos_mb ${JSON.stringify({
        ...Object.fromEntries([...tamanhos].filter(([, s]) => s > 1048576 / 10).map(([n, s]) => [n, mb(s)])),
        wal_depois_da_carga: mb(wal),
      })}`,
    );
    await d.fechar();
  }, 600_000);
});
