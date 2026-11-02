/**
 * Os schemas Drizzle (espelho tipado) batem com o banco migrado: mesmas tabelas, colunas e NOT NULL.
 * Evita a API consultar coluna que a migração não criou (e vice-versa).
 */
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import * as nuvemGestor from '../../modules/gestor/db/nuvem';
import * as esquemaPlataforma from '../esquema/plataforma';
import { banco, semBanco } from './estado';
import { comCliente, tabelasDeDominio } from './util';

const valores: unknown[] = [...Object.values(esquemaPlataforma), ...Object.values(nuvemCore), ...Object.values(nuvemCatalogo), ...Object.values(nuvemVendedor), ...Object.values(nuvemIntegracao), ...Object.values(nuvemGestor)];
const SCHEMAS = ['plataforma', 'core', 'catalogo', 'vendedor', 'integracao', 'gestor'];
const tabelas = valores.filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

describe.skipIf(semBanco())('Drizzle x banco migrado', () => {
  it('mesmo conjunto de tabelas em plataforma, core, catalogo, vendedor, integracao e gestor', async () => {
    const doBanco = await comCliente(banco().urlAdmin, (c) => tabelasDeDominio(c));
    expect(doBanco.filter((t) => SCHEMAS.includes(t.schema)).map((t) => t.nome).sort()).toEqual(tabelas.map((t) => `${t.schema}.${t.name}`).sort());
  });

  it('colunas e NOT NULL iguais', async () => {
    await comCliente(banco().urlAdmin, async (c) => {
      for (const t of tabelas) {
        const r = await c.query<{ column_name: string; is_nullable: string }>(
          'select column_name, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2 order by column_name',
          [t.schema, t.name],
        );
        const doBanco = r.rows.map((x) => `${x.column_name} ${x.is_nullable === 'NO' ? 'not null' : 'null'}`).sort();
        const doDrizzle = t.columns.map((col) => `${col.name} ${col.notNull ? 'not null' : 'null'}`).sort();
        expect(doDrizzle, `${t.schema}.${t.name}`).toEqual(doBanco);
      }
    });
  });
});
