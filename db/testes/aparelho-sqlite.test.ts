/**
 * Esquema SQLite do APARELHO (T-0008 P2; dono: banco-dados). Especificação: docs/banco/aparelho-sqlite.md.
 * Roda no `node:sqlite` (driver do SDK, `@macuxi/platform-sdk/sqlite-node`), sem Postgres.
 *
 * 1. DDL da busca do Catálogo (modules/catalogo/db/aparelho.ts): dono dos objetos (`verificarDonoDasMigracoes`),
 *    colunas na ordem, tokenizer `unicode61 remove_diacritics 2`, `prefix='2 3'`, content externo, vocabulário e o
 *    índice de expressão usado pelo `porCampo` (EXPLAIN QUERY PLAN).
 * 2. Migrações do aparelho: subida por versão (só a nova roda, dados preservados) e downgrade (recria do zero).
 * 3. RN-CORE-02 (doc 03): módulo desativado = dados locais dele apagados (linhas, `mod:<m>:*`, objetos `<m>__*`,
 *    `_esquema`), o resto intacto; reativação recria pelas migrações.
 * 4. RN-CORE-15 (doc 03): aparelho bloqueado = dados locais do tenant e fila apagados. Procedimento de reserva (quando o
 *    arquivo não pode ser apagado) prova que nada do conteúdo apagado sobra no arquivo nem no WAL.
 * 5. Carga de 20 mil SKUs (+ atributos) e 500 clientes e busca com p95 < 300 ms (critérios da T-0008). Os números
 *    saem no console (`[aparelho]`) e estão registrados em docs/banco/aparelho-sqlite.md §8.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aplicarMigracoes,
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
};

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
interface Cliente extends LinhaSync {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  cidade: string;
}

const compacto = (s: string) => normalizarBusca(s).join('');

/** Réplica de teste da declaração do índice (a real é do modulo-catalogo, modules/catalogo/app). */
const INDICE = definirIndiceBusca({
  id: 'catalogo.produto',
  modulo: 'catalogo',
  tabelaDoc: TABELAS_BUSCA_CATALOGO.doc,
  tabelaFts: TABELAS_BUSCA_CATALOGO.fts,
  colunaChave: TABELAS_BUSCA_CATALOGO.colunaChave,
  colunas: PESOS,
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
  return criarArmazenamentoSqlite(driver, {
    migracoesModulos: { catalogo: migracoes },
    entidades: ENTIDADES_REGISTRO,
    indicesBusca: [INDICE],
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
      'index catalogo__produto_atributo_produto',
    ]);
    expect(await nomesDasColunas(d, 'catalogo__busca')).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(Object.keys(PESOS)).toEqual([...COLUNAS_BUSCA_CATALOGO]);
    expect(await nomesDasColunas(d, 'catalogo__busca_doc')).toEqual(['rid', 'produto_id', ...COLUNAS_BUSCA_CATALOGO]);
    const sql = (await d.primeira<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'catalogo__busca'"))!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain("content = 'catalogo__busca_doc'");
    expect(sql).toContain("content_rowid = 'rid'");
    expect(sql).toContain("tokenize = 'unicode61 remove_diacritics 2'");
    expect(sql).toContain("prefix = '2 3'");
    expect(sql).not.toMatch(/detail\s*=/); // detail=full (padrão): consulta de frase
    expect(await d.primeira('SELECT dono, versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ dono: 'catalogo', versao: 1 });
    expect((await d.primeira<{ ok: number }>("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS ok"))!.ok).toBe(1);
  });

  it('tokenizer: sem acento e sem cedilha, código separado e compacto, prefixo de 2 letras, frase e vocabulário', async () => {
    const d = await bancoComCatalogo();
    const docs = [
      ['p1', '6203-2RS', null, '62032rs', 'Rolamento ação rápida', 'SKF', 'Transmissão', 'aplicação Gol'],
      ['p2', 'PF-100', '7891234567895', 'pf100', 'Pastilha de freio cerâmica', 'Fras-le', 'Freios', 'aplicação Onix'],
      ['p3', 'OL-5W30', null, 'ol5w30', 'Óleo de motor sintético 5W30', 'Mahle', 'Motor', 'medida 1L'],
    ];
    for (const v of docs)
      await d.rodar(`INSERT INTO catalogo__busca_doc (produto_id, ${COLUNAS_BUSCA_CATALOGO.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, v);
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
});

// ---------- 2. Migrações do aparelho: subida e downgrade ----------

describe('aparelho: migrações por versão (subida só para frente; downgrade recria)', () => {
  const V2_DE_TESTE: MigracaoAparelho = { versao: 2, sql: 'CREATE TABLE catalogo__favorito (produto_id TEXT PRIMARY KEY, criado_em TEXT NOT NULL) WITHOUT ROWID;' };

  it('v1 → v2 aplica só a v2 e preserva a busca; app antigo (v1) recria os objetos do Catálogo do zero', async () => {
    const arquivo = join(pastaTemporaria(), 'macuxi-u-teste.db');
    let a = abrirArmazenamento(criarDriverNode(arquivo));
    await puxar(a, 'produto', [produto(1), produto(2)]);
    await a.busca.finalizar!();
    expect((await a.busca.buscar('catalogo.produto', { grupos: [['freio']], prefixoNoUltimo: false })).length).toBe(2);
    await a.fechar();

    a = abrirArmazenamento(criarDriverNode(arquivo), [...migracoesAparelho, V2_DE_TESTE]);
    await a.pronto;
    const d = criarDriverNode(arquivo);
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 2 });
    expect(await d.primeira("SELECT count(*) AS n FROM catalogo__busca_doc")).toEqual({ n: 2 }); // v1 não rodou de novo
    expect((await listarObjetos(d)).some((o) => o.name === 'catalogo__favorito')).toBe(true);
    await d.fechar();
    await a.fechar();

    // downgrade: versão do aparelho (2) > versão do app (1) ⇒ objetos catalogo__* apagados e recriados; ent_* e kv intactos
    // (repovoar a doc a partir de ent_produto é do SDK: lacuna L-1 em docs/banco/aparelho-sqlite.md §9)
    a = abrirArmazenamento(criarDriverNode(arquivo));
    await a.pronto;
    const d2 = criarDriverNode(arquivo);
    expect(await d2.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 1 });
    expect((await listarObjetos(d2)).some((o) => o.name === 'catalogo__favorito')).toBe(false);
    expect(await d2.primeira('SELECT count(*) AS n FROM ent_produto')).toEqual({ n: 2 });
    await d2.fechar();
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
    expect(await d.primeira('SELECT versao FROM _esquema WHERE dono = ?', ['catalogo'])).toEqual({ versao: 1 });
    await puxar(a, 'produto_atributo', [...atributos(5)]);
    await a.busca.finalizar!();
    const r = await a.busca.buscar('catalogo.produto', { grupos: [['gol']], prefixoNoUltimo: false });
    expect(r.map((x) => x.chave)).toContain(uuid(1, 5));
    await d.fechar();
    await a.fechar();
  });
});

// ---------- 4. RN-CORE-15 ----------

/** Arquivos SQLite de usuário no aparelho: `macuxi-u-<uuid>.db` e os anexos do WAL/rollback. */
const ARQUIVO_DE_USUARIO_RE = /^macuxi-u-[0-9a-f-]{36}\.db(-wal|-shm|-journal)?$/;

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
    const arquivo = join(pasta, `macuxi-u-${usuario}.db`);
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

describe('aparelho: carga de 20 mil SKUs + 500 clientes e busca p95 < 300 ms (node:sqlite)', () => {
  it('carrega sem bloquear o loop por muito tempo e busca produto e cliente dentro da meta', async () => {
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
    if (percentil(prod.tempos, 95) >= 300) {
      prod = await medirProdutos();
      tentativasProduto++;
    }
    let temposCli = await medirClientes();
    let tentativasCliente = 1;
    if (percentil(temposCli, 95) >= 300) {
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
    };
    console.info(`[aparelho] ${JSON.stringify(resumo)}`);
    expect(resumo.busca_produto_p95_ms).toBeLessThan(300);
    expect(resumo.busca_cliente_p95_ms).toBeLessThan(300);
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
