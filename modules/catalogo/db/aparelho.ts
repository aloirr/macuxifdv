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

/** Colunas da FTS na ordem da DDL (= ordem e chaves de `colunas` em `definirIndiceBusca`, modules/catalogo/app). */
export const COLUNAS_BUSCA_CATALOGO = ['sku', 'ean', 'codigos', 'nome', 'marca', 'categoria', 'atributos'] as const;

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
];
