/**
 * 0095 — origem, status e aprovação do cadastro do cliente (v1.0.27, RF-CORE-10). Dicionário: docs/banco/core.md ("0095").
 * O que o BANCO garante:
 * - core.cliente ganha origem_cadastro ('erp' | 'campo' | 'bko', not null default 'erp'), status_cadastro ('pendente' |
 *   'aprovado' | 'recusado', nulo se e só se a origem é 'erp'), aprovado_em e aprovado_por (juntos, só com 'aprovado');
 * - índice parcial cliente_aprovado_sem_erp_ix (fila do Hub); a unicidade do external_id vivo por tenant é a de sempre;
 * - grant de SELECT do macuxi_leitura nas 4 colunas;
 * - up/down: a 0095 só acrescenta; o down volta exatamente ao catálogo da anterior.
 * Este teste confere só o que a 0095 criou (texto e up/down no banco efêmero). O estado atual (CHECKs, fila, isolamento,
 * leitura e espelho Drizzle, depois da 0097) fica em cliente-pre-cadastro-erp.db.test.ts.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { semBanco } from './estado';
import { retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0095';
const m95 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m95) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m95.up);
const down = semComentarios(m95.down);

const COLUNAS = ['origem_cadastro', 'status_cadastro', 'aprovado_em', 'aprovado_por'];
const CHECKS = [
  'cliente_origem_cadastro_valida', 'cliente_status_cadastro_valido', 'cliente_status_cadastro_origem', 'cliente_aprovacao_par',
  'cliente_aprovacao_status',
];
const INDICE = 'cliente_aprovado_sem_erp_ix';

describe('0095 cadastro e aprovação do cliente (estático)', () => {
  it('nome, colunas, CHECKs, índice e grant do macuxi_leitura', () => {
    expect(m95.nome).toBe('core_cliente_cadastro_aprovacao');
    expect(up).toContain("alter table core.cliente add column origem_cadastro text not null default 'erp';");
    expect(up).toContain('alter table core.cliente add column status_cadastro text;');
    expect(up).toContain('alter table core.cliente add column aprovado_em timestamptz;');
    expect(up).toContain('alter table core.cliente add column aprovado_por uuid;');
    for (const k of CHECKS) expect(up, k).toContain(`add constraint ${k}`);
    expect(up.replace(/\s+/g, ' ')).toContain(
      `create index ${INDICE} on core.cliente (tenant_id, aprovado_em, id) where external_id is null and aprovado_em is not null and deleted_at is null;`,
    );
    expect(up).toContain('grant select (origem_cadastro, status_cadastro, aprovado_em, aprovado_por) on core.cliente to macuxi_leitura;');
    expect(up).not.toMatch(/create unique index|create table|create policy|alter policy|row level security|\bupdate\b|\bdelete\b/i);
    expect(up).not.toMatch(/to macuxi_(app|worker|portal)/);
    // a unicidade do external_id vivo já é da 0002
    expect(migracoes.find((m) => m.versao === '0002')!.up).toContain(
      'create unique index cliente_external_uk on core.cliente (tenant_id, external_id) where external_id is not null and deleted_at is null;',
    );
  });

  it('down: apaga índice, CHECKs e colunas', () => {
    expect(down).toContain(`drop index if exists core.${INDICE};`);
    for (const k of CHECKS) expect(down).toContain(`alter table core.cliente drop constraint if exists ${k};`);
    for (const c of COLUNAS) expect(down).toContain(`alter table core.cliente drop column if exists ${c};`);
    expect(down).not.toMatch(/create |update |grant /);
  });
});

describe.skipIf(semBanco())('0095 cadastro e aprovação do cliente (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; o índice é usado na fila; down volta ao catálogo da anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m95.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      expect(novos.filter((x) => x.startsWith('col ')).sort()).toEqual(
        [
          'col core.cliente.aprovado_em timestamp with time zone nn=false',
          'col core.cliente.aprovado_por uuid nn=false',
          'col core.cliente.origem_cadastro text nn=true',
          'col core.cliente.status_cadastro text nn=false',
        ],
      );
      expect(novos.filter((x) => x.startsWith('con ')).map((x) => x.split(' ')[1]).sort()).toEqual(CHECKS.map((k) => `core.${k}`).sort());
      expect(novos.filter((x) => x.startsWith('idx '))).toHaveLength(1);
      expect(novos.filter((x) => x.startsWith('idx '))[0]).toContain(INDICE);
      expect(novos.filter((x) => x.startsWith('rel '))).toEqual([`rel core.${INDICE} i rls=false force=false`]);
      expect(novos.filter((x) => !/^(col|con|idx|rel) /.test(x))).toEqual([]);
      await c.query('set enable_seqscan = off');
      const plano = await c.query(
        "explain select id from core.cliente where tenant_id = '00000000-0000-0000-0000-000000000001' and external_id is null and aprovado_em is not null and deleted_at is null order by aprovado_em, id limit 50",
      );
      expect(plano.rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n')).toContain(INDICE);
      await c.query('reset enable_seqscan');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m95.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
