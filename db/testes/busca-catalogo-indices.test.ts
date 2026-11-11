/**
 * T-0119 (D-T0107b): índices de que dependem as leituras de banco da busca do Catálogo com 20 mil produtos. Dicionário:
 * docs/banco/catalogo.md, "T-0119". O gargalo medido não é o banco (o tempo vai para o ranking em memória); este teste trava
 * que nenhuma migração futura apague ou mude o índice que serve cada leitura da busca e do retrato do catálogo:
 * - preço dos candidatos (`precos`): `tabela_preco_id = $1 and filial_id = $3 and produto_id = any($2) and deleted_at is null`;
 * - filial do preço (`filialDaTabela`): `exists (... tabela_preco_id = $1 and filial_id = $2 and deleted_at is null)`;
 * - estoque dos candidatos (`saldos`): `produto_id = any($1) and deleted_at is null` + depósito pela chave;
 * - tabela do cliente: `cliente_id = $1 and deleted_at is null`;
 * - retrato (`enriquecer`): atributos, conteúdo, referências e miniatura por `produto_id = any(...)`.
 * A RLS põe `tenant_id = plataforma.tenant_atual()` na frente de toda consulta: todo índice começa por tenant_id.
 * Estático (sem Postgres): lê as migrações na ordem. O plano real (EXPLAIN sem Seq Scan) é conferido no CI por
 * modules/catalogo/api/busca-volume.db.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { lerMigracoes } from '../src/migrador';

const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** Todas as `up` na ordem, como uma só sequência de comandos. */
const ups = lerMigracoes().map((m) => ({ versao: m.versao, sql: semComentarios(m.up).replace(/\s+/g, ' ') }));

interface IndiceVivo {
  versao: string;
  unico: boolean;
  tabela: string;
  colunas: string[];
  predicado: string;
}

/** Estado final do índice depois de todas as migrações: a última criação, desde que nenhuma migração posterior o apague. */
function indiceVivo(nome: string): IndiceVivo | null {
  let vivo: IndiceVivo | null = null;
  const criar = new RegExp(`create (unique )?index (?:if not exists )?${nome} on (catalogo\\.\\w+) \\(([^)]*)\\)(?: nulls not distinct)?(?: where ([^;]*))?;`, 'i');
  const apagar = new RegExp(`drop index (?:if exists )?catalogo\\.${nome}\\b`, 'i');
  for (const { versao, sql } of ups) {
    for (const comando of sql.split(/;\s*/).map((c) => `${c.trim()};`)) {
      if (apagar.test(comando)) vivo = null;
      const m = criar.exec(comando);
      if (m) vivo = { versao, unico: Boolean(m[1]), tabela: m[2]!, colunas: m[3]!.split(',').map((c) => c.trim().split(' ')[0]!), predicado: (m[4] ?? '').trim() };
    }
  }
  return vivo;
}

/** Índice esperado: tabela, colunas iniciais (na ordem) e, se parcial, o predicado que a consulta repete. */
const ESPERADOS: { nome: string; tabela: string; prefixo: string[]; predicado?: string; serve: string }[] = [
  { nome: 'tabela_preco_item_filial_vigencia_uk', tabela: 'catalogo.tabela_preco_item', prefixo: ['tenant_id', 'tabela_preco_id', 'filial_id', 'produto_id'], predicado: 'deleted_at is null', serve: 'precos (candidatos) e filialDaTabela' },
  { nome: 'estoque_saldo_produto_ix', tabela: 'catalogo.estoque_saldo', prefixo: ['tenant_id', 'produto_id'], serve: 'saldos (candidatos e corte)' },
  { nome: 'cliente_tabela_preco_cliente_uk', tabela: 'catalogo.cliente_tabela_preco', prefixo: ['tenant_id', 'cliente_id'], predicado: 'deleted_at is null', serve: 'tabela do cliente' },
  { nome: 'produto_atributo_uk', tabela: 'catalogo.produto_atributo', prefixo: ['tenant_id', 'produto_id'], predicado: 'deleted_at is null', serve: 'retrato: atributos' },
  { nome: 'produto_conteudo_produto_uk', tabela: 'catalogo.produto_conteudo', prefixo: ['tenant_id', 'produto_id'], predicado: 'deleted_at is null', serve: 'retrato: aplicação e destaque' },
  { nome: 'produto_referencia_ordem_uk', tabela: 'catalogo.produto_referencia', prefixo: ['tenant_id', 'produto_id'], predicado: 'deleted_at is null', serve: 'retrato: referências cruzadas' },
  { nome: 'produto_midia_principal_uk', tabela: 'catalogo.produto_midia', prefixo: ['tenant_id', 'produto_id'], predicado: 'principal and deleted_at is null', serve: 'retrato: miniatura' },
];

describe('T-0119 índices das leituras da busca do Catálogo (estático)', () => {
  it.each(ESPERADOS)('$nome vivo em $tabela, começando por $prefixo ($serve)', ({ nome, tabela, prefixo, predicado }) => {
    const i = indiceVivo(nome);
    expect(i, `${nome} sumiu das migrações (apagado sem substituto?)`).not.toBeNull();
    expect(i!.tabela).toBe(tabela);
    expect(i!.colunas.slice(0, prefixo.length)).toEqual(prefixo);
    // parcial: a consulta da busca repete o predicado (deleted_at is null), senão o planejador não usa o índice
    if (predicado !== undefined) expect(i!.predicado.toLowerCase()).toBe(predicado);
    else expect(i!.predicado).toBe('');
  });

  it('o depósito do saldo é achado pela chave primária (join por id)', () => {
    const criacao = ups.find((m) => /create table catalogo\.deposito \(/i.test(m.sql));
    expect(criacao?.sql).toMatch(/create table catalogo\.deposito \( id uuid primary key/i);
  });
});
