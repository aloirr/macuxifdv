/**
 * Espelho Drizzle (`nuvem.ts`) × `create table` da migração 0016 (somente leitura do SQL): mesmas tabelas, mesmas
 * colunas, mesmo tipo e mesma obrigatoriedade. Pega o espelho que ficou para trás quando a migração muda. Não precisa
 * de Postgres. A prova contra o banco real (inclusive CHECKs e listas fechadas) é de db/testes/pesquisa.test.ts.
 */
import { lerMigracoes } from '@macuxi/db';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { questionario, questionarioVersao, resposta, respostaFoto, respostaItem } from './nuvem';

/** A 0016 vem pelo pacote `@macuxi/db` (devDependency): o hash do turbo cobre db/ e o teste não sai do pacote. */
const MIGRACAO_0016 = lerMigracoes().find((m) => m.versao === '0016');
if (MIGRACAO_0016?.nome !== 'pesquisa') throw new Error('migração 0016_pesquisa não encontrada em @macuxi/db');
const SQL = MIGRACAO_0016.up;

const TIPO_SQL: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  integer: 'integer',
  jsonb: 'jsonb',
  boolean: 'boolean',
  numeric: 'numeric',
  date: 'date',
  timestamptz: 'timestamp with time zone',
  'text[]': 'text[]',
  'uuid[]': 'uuid[]',
};

interface ColunaSql {
  tipo: string;
  obrigatoria: boolean;
}

/** Colunas do `create table pesquisa.<nome> (...)` (linhas que não são constraint). */
function colunasDoSql(tabela: string): Map<string, ColunaSql> {
  const bloco = new RegExp(`create table pesquisa\\.${tabela} \\(\\n([\\s\\S]*?)\\n\\);`).exec(SQL)?.[1];
  if (!bloco) throw new Error(`create table pesquisa.${tabela} não encontrado na 0016`);
  const colunas = new Map<string, ColunaSql>();
  for (const linha of bloco.split('\n')) {
    const m = /^ {2}([a-z_]+)\s+(text\[\]|uuid\[\]|uuid|text|integer|jsonb|boolean|numeric|date|timestamptz)(?=[\s,]|$)(.*?),?\s*$/.exec(linha);
    if (!m || m[1] === 'constraint') continue;
    const resto = m[3] ?? '';
    colunas.set(m[1]!, { tipo: TIPO_SQL[m[2]!]!, obrigatoria: /not null|primary key/.test(resto) });
  }
  return colunas;
}

const TABELAS: Array<[string, PgTable]> = [
  ['questionario', questionario],
  ['questionario_versao', questionarioVersao],
  ['resposta', resposta],
  ['resposta_item', respostaItem],
  ['resposta_foto', respostaFoto],
];

describe('espelho Drizzle do schema pesquisa × 0016_pesquisa.up.sql', () => {
  it('as 5 tabelas do schema estão no espelho, no schema `pesquisa`', () => {
    const doSql = [...SQL.matchAll(/create table pesquisa\.([a-z_]+) \(/g)].map((m) => m[1]).sort();
    expect(TABELAS.map(([n]) => n).sort()).toEqual(doSql);
    for (const [nome, tabela] of TABELAS) {
      const cfg = getTableConfig(tabela);
      expect(cfg.schema, nome).toBe('pesquisa');
      expect(cfg.name).toBe(nome);
    }
  });

  for (const [nome, tabela] of TABELAS) {
    it(`pesquisa.${nome}: mesmas colunas, tipos e obrigatoriedade do create table`, () => {
      const sql = colunasDoSql(nome);
      const espelho = new Map(getTableConfig(tabela).columns.map((c) => [c.name, { tipo: c.getSQLType(), obrigatoria: c.notNull }] as const));
      expect([...espelho.keys()].sort()).toEqual([...sql.keys()].sort());
      for (const [coluna, def] of sql) expect(espelho.get(coluna), `${nome}.${coluna}`).toEqual(def);
    });

    it(`pesquisa.${nome}: tem os campos comuns da regra 5 (id, tenant_id, created_at, updated_at, deleted_at, external_id)`, () => {
      const nomes = getTableConfig(tabela).columns.map((c) => c.name);
      expect(nomes).toEqual(expect.arrayContaining(['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id']));
    });
  }
});
