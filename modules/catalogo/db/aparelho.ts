/**
 * Esquema LOCAL do Catálogo no aparelho (SQLite; dono: banco-dados). Desenho T-0008 §1.4 e §2.3; especificação em
 * docs/banco/aparelho-sqlite.md. Declarado pelo módulo em `definirModuloShell({ migracoesAparelho })`.
 *
 * Regras (o adaptador do SDK impõe; db/testes/aparelho-sqlite.test.ts confere com `verificarDonoDasMigracoes`):
 * - SÓ strings SQL, sem import (o arquivo entra no bundle do app e nos testes de qualquer pacote).
 * - Versões inteiras e crescentes, só para frente. Versão publicada NUNCA muda: mudança = nova versão no fim da lista.
 * - Todo objeto leva o prefixo `catalogo__` (a RN-CORE-02 apaga por prefixo), inclusive índice de expressão sobre
 *   `ent_<e>` — e só sobre entidade DO CATÁLOGO (`ent_produto` é do Core: índice nela é proibido).
 * - Sem gatilhos: o SDK mantém a FTS (carga em massa + `'rebuild'`, ou incremental com `'delete'` dos valores antigos).
 * - Caminho de volta: não há "down" no aparelho. Downgrade do app (versão local > versão do app) ou RN-CORE-02 apagam
 *   todos os objetos `catalogo__*` e a linha de `_esquema`; tudo é reconstruído pelas migrações + pull do início.
 */

/**
 * Colunas da FTS na ordem da DDL (= ordem e chaves de `colunas` em `definirIndiceBusca`, modules/catalogo/app). v3
 * (T-0084/T-0085): + `aplicacao` (texto expandido de `expandirAplicacao`, RN-CAT-12) e `referencias` (códigos crus das
 * referências cruzadas, RN-CAT-09); o compacto das referências vai em `codigos`, junto do SKU e do external_id.
 */
export const COLUNAS_BUSCA_CATALOGO = ['sku', 'ean', 'codigos', 'nome', 'marca', 'categoria', 'atributos', 'aplicacao', 'referencias'] as const;

/** Nomes dos objetos da busca (para a declaração do índice no app do Catálogo). */
export const TABELAS_BUSCA_CATALOGO = {
  doc: 'catalogo__busca_doc',
  fts: 'catalogo__busca',
  vocab: 'catalogo__busca_vocab',
  colunaChave: 'produto_id',
} as const;

export const migracoesAparelho: { versao: number; sql: string }[] = [
  {
    // v1 (T-0008 P2): busca offline de produto (FTS5 com content externo), vocabulário para correção de digitação e
    // índice dos atributos por produto (`porCampo('produto_atributo', 'produto_id', id)` no `documento()`).
    versao: 1,
    sql: `
      CREATE TABLE catalogo__busca_doc (
        rid        INTEGER PRIMARY KEY,
        produto_id TEXT NOT NULL UNIQUE,
        sku        TEXT,
        ean        TEXT,
        codigos    TEXT,
        nome       TEXT,
        marca      TEXT,
        categoria  TEXT,
        atributos  TEXT
      );
      CREATE VIRTUAL TABLE catalogo__busca USING fts5(
        sku, ean, codigos, nome, marca, categoria, atributos,
        content = 'catalogo__busca_doc',
        content_rowid = 'rid',
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      );
      CREATE VIRTUAL TABLE catalogo__busca_vocab USING fts5vocab(catalogo__busca, row);
      CREATE INDEX catalogo__produto_atributo_produto ON ent_produto_atributo (json_extract(dados, '$.produto_id'));
    `,
  },
  {
    // v2 (T-0052-B4, R-20261105-141833): índices de expressão para `motor.linhasPorCampo` (`json_extract(dados,
    // '$.<campo>') IN (SELECT value FROM json_each(?))`) — preço, estoque, vínculo do cliente e conteúdo só dos
    // candidatos da busca (até 400 por consulta). O texto da expressão tem de ser IGUAL ao do SDK para o plano usar o
    // índice. Preço: (produto_id, tabela_preco_id) — o prefixo serve a leitura por produto; a tabela do cliente filtra
    // dentro do índice se a consulta passar a levar as duas. Subida sobre aparelho em v1: só cria índices sobre as
    // linhas que já estão em `ent_*` (nada é apagado nem repuxado). Volume: estoque ~40 mil, preço ~20 mil por tabela.
    versao: 2,
    sql: `
      CREATE INDEX catalogo__estoque_saldo_produto ON ent_estoque_saldo (json_extract(dados, '$.produto_id'));
      CREATE INDEX catalogo__tabela_preco_item_produto ON ent_tabela_preco_item (json_extract(dados, '$.produto_id'), json_extract(dados, '$.tabela_preco_id'));
      CREATE INDEX catalogo__cliente_tabela_preco_cliente ON ent_cliente_tabela_preco (json_extract(dados, '$.cliente_id'));
      CREATE INDEX catalogo__produto_conteudo_produto ON ent_produto_conteudo (json_extract(dados, '$.produto_id'));
    `,
  },
  {
    // v3 (T-0084 §6 e T-0085 §7; migração 0033 no servidor): FTS5 com `aplicacao` e `referencias`. Coluna de FTS5 não se
    // acrescenta: a v3 RECRIA a tabela de documentos, a FTS e o vocabulário (nesta ordem de colunas: sku, ean, codigos,
    // nome, marca, categoria, atributos, aplicacao, referencias). Os documentos antigos saem junto; com o índice vazio e
    // as fontes com linhas, o SDK marca a reindexação sozinho (`marcarReindexacaoSeVazio`) e reconstrói a partir de
    // `ent_*` (nada é repuxado). Índice de expressão por produto em `ent_produto_referencia` (entidade do Catálogo, pull
    // escopo tenant) para o `porCampo`/`linhasPorCampo` do `documento()` e da ficha. Pesos (app/indice.ts, modulo-catalogo):
    // aplicacao 2 e referencias 8.
    versao: 3,
    sql: `
      DROP TABLE IF EXISTS catalogo__busca_vocab;
      DROP TABLE IF EXISTS catalogo__busca;
      DROP TABLE IF EXISTS catalogo__busca_doc;
      CREATE TABLE catalogo__busca_doc (
        rid         INTEGER PRIMARY KEY,
        produto_id  TEXT NOT NULL UNIQUE,
        sku         TEXT,
        ean         TEXT,
        codigos     TEXT,
        nome        TEXT,
        marca       TEXT,
        categoria   TEXT,
        atributos   TEXT,
        aplicacao   TEXT,
        referencias TEXT
      );
      CREATE VIRTUAL TABLE catalogo__busca USING fts5(
        sku, ean, codigos, nome, marca, categoria, atributos, aplicacao, referencias,
        content = 'catalogo__busca_doc',
        content_rowid = 'rid',
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      );
      CREATE VIRTUAL TABLE catalogo__busca_vocab USING fts5vocab(catalogo__busca, row);
      CREATE INDEX catalogo__produto_referencia_produto ON ent_produto_referencia (json_extract(dados, '$.produto_id'));
    `,
  },
];
