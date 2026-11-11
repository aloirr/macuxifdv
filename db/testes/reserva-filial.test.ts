/**
 * 0061 — filial derivada no item do pedido, para a reserva por filial (T-0149, RN-VEN-20, RN-CORE-39). Dicionário:
 * docs/banco/vendedor.md, "0061". vendedor.pedido_item.filial_id = vendedor.pedido.filial_id, mantida por gatilho (somente
 * leitura); índice pedido_item_reserva_filial_ix (tenant_id, produto_id, filial_id).
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const migracoes = lerMigracoes();
const m61 = migracoes.find((m) => m.versao === '0061')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m61.up);
const down = semComentarios(m61.down);

describe('0061 filial no item para a reserva por filial (estático)', () => {
  it('nome e posição: 0061_vendedor_reserva_filial logo depois da 0060', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0060_vendedor_pedido_item_marca') + 1]).toBe('0061_vendedor_reserva_filial');
  });

  it('aditiva: coluna uuid nula, sem not null nem drop nem delete; RLS e grants intocados', () => {
    expect(up).toContain('alter table vendedor.pedido_item add column filial_id uuid;');
    expect(up).not.toMatch(/(?<!is )not null(?! and)|\bdrop\b|\bdelete\b|\bpolicy\b|\bgrant\b|\brevoke\b|row level security/i);
    expect(up).not.toMatch(/security definer/i);
  });

  it('backfill pela filial do pedido, sem mexer em updated_at', () => {
    const desliga = up.indexOf('disable trigger pedido_item_updated_at');
    const upd = up.indexOf('update vendedor.pedido_item i');
    const liga = up.indexOf('enable trigger pedido_item_updated_at');
    expect(desliga).toBeGreaterThan(-1);
    expect(desliga < upd && upd < liga).toBe(true);
    expect(up).toMatch(/set filial_id = p\.filial_id\s+from vendedor\.pedido p\s+where p\.tenant_id = i\.tenant_id and p\.id = i\.pedido_id and p\.filial_id is not null;/);
  });

  it('gatilhos: item copia do pedido; pedido leva a filial nova aos itens; search_path fixo', () => {
    expect(up).toContain('create trigger pedido_item_filial before insert or update of pedido_id, tenant_id, filial_id on vendedor.pedido_item');
    expect(up).toContain('new.filial_id := (select p.filial_id from vendedor.pedido p where p.tenant_id = new.tenant_id and p.id = new.pedido_id);');
    expect(up).toContain('create trigger pedido_filial_nos_itens after update of filial_id on vendedor.pedido');
    expect(up).toContain('for each row when (old.filial_id is distinct from new.filial_id)');
    expect(up.match(/set search_path = pg_catalog, vendedor, pg_temp/g)).toHaveLength(2);
  });

  it('índice da soma por (tenant, produto, filial), parcial nos itens vivos com filial', () => {
    expect(up).toMatch(
      /create index pedido_item_reserva_filial_ix on vendedor\.pedido_item \(tenant_id, produto_id, filial_id\)\s+include \(pedido_id, quantidade_base, quantidade_faturada\)\s+where deleted_at is null and filial_id is not null;/,
    );
  });

  it('down idempotente desfaz tudo o que o up cria', () => {
    for (const l of [
      'drop index if exists vendedor.pedido_item_reserva_filial_ix;',
      'drop trigger if exists pedido_filial_nos_itens on vendedor.pedido;',
      'drop function if exists vendedor.pedido_filial_nos_itens();',
      'drop trigger if exists pedido_item_filial on vendedor.pedido_item;',
      'drop function if exists vendedor.pedido_item_filial();',
      'alter table vendedor.pedido_item drop column if exists filial_id;',
    ])
      expect(down).toContain(l);
  });

  it('espelho Drizzle: pedido_item.filial_id uuid nula', () => {
    const c = getTableConfig(nuvemVendedor.pedidoItem).columns.find((x) => x.name === 'filial_id');
    expect([c?.getSQLType(), c?.notNull]).toEqual(['uuid', false]);
  });
});

describe.skipIf(semBanco())('0061 filial no item (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('todo item tem a filial do pedido; gravar outra é sobrescrito; trocar a filial do pedido leva aos itens', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const divergentes = await q(
        `select count(*)::int as n from vendedor.pedido_item i join vendedor.pedido p on p.tenant_id = i.tenant_id and p.id = i.pedido_id
          where i.filial_id is distinct from p.filial_id`,
      );
      expect(divergentes.rows[0]!.n).toBe(0);
      const item = (await q('select id, pedido_id from vendedor.pedido_item where tenant_id = $1 limit 1', [A.tenantId])).rows[0] as
        | { id: string; pedido_id: string }
        | undefined;
      if (!item) return; // fixture sem item: os gatilhos são conferidos no up/down abaixo
      const doPedido = (await q('select filial_id from vendedor.pedido where id = $1', [item.pedido_id])).rows[0]!.filial_id;
      const r = await q('update vendedor.pedido_item set filial_id = $2 where id = $1 returning filial_id', [item.id, randomUUID()]);
      expect(r.rows[0]!.filial_id).toBe(doPedido);
      const nova = randomUUID();
      await q(
        `update vendedor.pedido set filial_id = $2::uuid,
                filial = jsonb_build_object('id', $2::text, 'codigo', 'T61', 'nome', 'Filial 0061', 'cidade', null, 'uf', null, 'external_id', null, 'padrao', false)
          where id = $1`,
        [item.pedido_id, nova],
      );
      const itens = await q('select distinct filial_id from vendedor.pedido_item where pedido_id = $1', [item.pedido_id]);
      expect(itens.rows).toEqual([{ filial_id: nova }]);
    });
  });
});

describe.skipIf(semBanco())('0061 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta coluna, índice, funções e gatilhos; down volta ao catálogo da 0060; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0060' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0061' })).aplicadas).toEqual(['0061_vendedor_reserva_filial']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col vendedor.pedido_item.filial_id uuid nn=false');
      expect(depois.some((l) => l.includes('pedido_item_reserva_filial_ix'))).toBe(true);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0061_vendedor_reserva_filial']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m61.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0061' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
