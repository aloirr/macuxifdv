/**
 * 0030 — core.notificacao.subtipo (T-0039; pedido R-20261105-071918-modulo-core). O que o BANCO garante: coluna text nula,
 * formato ^[a-z_]{1,40}$ (CHECK notificacao_subtipo_formato), sem índice, isolada por tenant pela política isolamento_tenant
 * que já existe (nenhuma política nova, grants iguais); backfill só nas notificações do alerta de etapa pendente
 * (tipo 'sistema', origem 'core', título "Etapa pendente na visita…", envio_id = visita_etapa pendente do mesmo tenant).
 * Down volta exatamente ao catálogo da 0029.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os instantes são literais (2030): nada aqui compara com o relógio real.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const UA = DOIS_TENANTS.A.usuarios;
const migracoes = lerMigracoes();
const m30 = migracoes.find((m) => m.versao === '0030')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0030 notificacao.subtipo (estático)', () => {
  it('nome e posição: 0030_core_notificacao_subtipo logo depois da 0029', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0029_plataforma_provisionar_tenant') + 1]).toBe('0030_core_notificacao_subtipo');
  });

  it('coluna text nula sem padrão, CHECK de formato, sem índice', () => {
    expect(m30.up).toContain('alter table core.notificacao add column subtipo text;');
    expect(m30.up).toContain(
      "alter table core.notificacao add constraint notificacao_subtipo_formato check (subtipo is null or subtipo ~ '^[a-z_]{1,40}$');",
    );
    const sql = semComentarios(m30.up);
    expect(sql).not.toMatch(/create (unique )?index|create policy|grant |revoke |delete from|default |(?<!is )not null/);
  });

  it('backfill restrito ao alerta de etapa pendente (tipo, origem, título e visita_etapa pendente do mesmo tenant)', () => {
    const sql = semComentarios(m30.up);
    const updates = sql.match(/update core\.[a-z_]+/g) ?? [];
    expect(updates).toEqual(['update core.notificacao']);
    for (const trecho of [
      "set subtipo = 'etapa_pendente_checkout'",
      'where n.subtipo is null',
      "and n.tipo = 'sistema'",
      "and n.origem_modulo = 'core'",
      "and n.titulo like 'Etapa pendente na visita%'",
      'where e.tenant_id = n.tenant_id and e.id = n.envio_id and e.pendente_desde is not null',
    ]) expect(sql).toContain(trecho);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    expect(m30.down).toContain('alter table core.notificacao drop constraint if exists notificacao_subtipo_formato;');
    expect(m30.down).toContain('alter table core.notificacao drop column if exists subtipo;');
  });

  it("espelho Drizzle: notificacao.subtipo (text), nula e sem padrão; 'etapa_pendente_checkout' conhecido e no formato do CHECK", () => {
    const col = getTableConfig(nuvemCore.notificacao).columns.find((c) => c.name === 'subtipo');
    expect(col?.getSQLType()).toBe('text');
    expect(col?.notNull).toBe(false);
    expect(col?.hasDefault).toBe(false);
    expect(nuvemCore.SUBTIPOS_NOTIFICACAO_CONHECIDOS).toContain('etapa_pendente_checkout');
    for (const s of nuvemCore.SUBTIPOS_NOTIFICACAO_CONHECIDOS) expect(s).toMatch(/^[a-z_]{1,40}$/);
  });
});

describe.skipIf(semBanco())('0030 notificacao.subtipo (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const contexto = (tenant: string) => q("select set_config('app.tenant_id', $1, true)", [tenant]);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  const nova = (tenant: string, usuario: string, subtipo: string | null) =>
    q<{ id: string; subtipo: string | null }>(
      "insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, subtipo) values ($1, $2, 'sistema', 'Etapa pendente na visita a X', 'Corpo', $3) returning id, subtipo",
      [tenant, usuario, subtipo],
    );

  it('fixture sem subtipo; grava etapa_pendente_checkout e null; lê no pull da caixa do usuário', async () => {
    expect(await codigo(A, async () => {
      expect((await q<{ n: number }>('select count(*)::int as n from core.notificacao where subtipo is not null')).rows[0]!.n).toBe(0);
      const { id, subtipo } = (await nova(A, UA.vendedor1, 'etapa_pendente_checkout')).rows[0]!;
      expect(subtipo).toBe('etapa_pendente_checkout');
      expect((await nova(A, UA.vendedor1, null)).rows[0]!.subtipo).toBeNull();
      const pull = await q<{ id: string; subtipo: string | null }>(
        'select id, subtipo from core.notificacao where tenant_id = $1 and usuario_id = $2 and subtipo is not null order by updated_at, id',
        [A, UA.vendedor1],
      );
      expect(pull.rows).toEqual([{ id, subtipo: 'etapa_pendente_checkout' }]);
      // limpar de volta para null é permitido
      expect((await q('update core.notificacao set subtipo = null where id = $1', [id])).rowCount).toBe(1);
    })).toBeUndefined();
  });

  it.each(['', 'Etapa', 'etapa-pendente', 'etapa pendente', 'etapa1', 'á', 'a'.repeat(41)])('CHECK notificacao_subtipo_formato recusa %j', async (valor) => {
    expect(await codigo(A, () => nova(A, UA.vendedor1, valor))).toBe('23514');
  });

  it('aceita o limite de 40 letras e sublinhado', async () => {
    expect(await codigo(A, () => nova(A, UA.vendedor1, `${'a'.repeat(39)}_`))).toBeUndefined();
  });

  it('vazamento entre tenants: o subtipo de A não aparece nem muda no contexto de B; B não insere em A', async () => {
    await emTransacao(app, A, async () => {
      const { id } = (await nova(A, UA.vendedor1, 'etapa_pendente_checkout')).rows[0]!;
      await contexto(B);
      const visto = await q<{ n: number }>("select count(*)::int as n from core.notificacao where id = $1 or subtipo = 'etapa_pendente_checkout'", [id]);
      expect(visto.rows[0]!.n).toBe(0);
      expect((await q('update core.notificacao set subtipo = null where id = $1', [id])).rowCount).toBe(0);
      await contexto(A);
      expect((await q<{ s: string }>('select subtipo as s from core.notificacao where id = $1', [id])).rows).toEqual([{ s: 'etapa_pendente_checkout' }]);
    });
    expect(await codigo(B, () => nova(A, UA.vendedor1, 'etapa_pendente_checkout'))).toBe('42501');
  });
});

describe.skipIf(semBanco())('0030 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000030';
  const T2 = 'cccccccc-0000-4000-8000-000000000130';
  const U = 'cccccccc-0030-4000-8000-000000000001';
  const U2 = 'cccccccc-0030-4000-8000-000000000101';
  const C = 'cccccccc-0030-4000-8000-000000000002';
  const V = 'cccccccc-0030-4000-8000-000000000003';
  const EP = 'cccccccc-0030-4000-8000-000000000004'; // visita_etapa que esteve pendente
  const EC = 'cccccccc-0030-4000-8000-000000000005'; // visita_etapa concluída sem pendência
  const N_ALERTA = 'cccccccc-0030-4000-8000-000000000010';
  const N_RECADO = 'cccccccc-0030-4000-8000-000000000011';
  const N_SEM_ETAPA = 'cccccccc-0030-4000-8000-000000000012';
  const N_ETAPA_CONCLUIDA = 'cccccccc-0030-4000-8000-000000000013';
  const N_OUTRO_TENANT = 'cccccccc-0030-4000-8000-000000000014';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0030_core_notificacao_subtipo') - 1]!.slice(0, 4);
  const desde0030 = nomes.filter((n) => n >= '0030');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill só no alerta de etapa pendente (updated_at avança só nele); down volta ao catálogo da 0029 com as notificações intactas; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo30', 'Antigo'), ($2, 'outro30', 'Outro')", [T, T2]);
      await c.query(
        "insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v30@exemplo.com.br', 'vendedor'), ($3, $4, 'W', 'w30@exemplo.com.br', 'vendedor')",
        [U, T, U2, T2],
      );
      await c.query("insert into core.cliente (id, tenant_id, razao_social) values ($1, $2, 'Cliente 30')", [C, T]);
      await c.query(
        "insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, sem_gps) values ($1, $2, $3, $4, '2030-04-10', '2030-04-10T14:00:00Z', true)",
        [V, T, U, C],
      );
      await c.query(
        `insert into core.visita_etapa (id, tenant_id, visita_id, modulo, etapa, situacao, rotulo, pendente_desde, alertada_em)
         values ($1, $3, $4, 'pesquisa', 'pesquisa_obrigatoria', 'pendente', 'Pesquisa', '2030-04-10T15:00:00Z', '2030-04-11T15:00:00Z'),
                ($2, $3, $4, 'promotor', 'checklist', 'concluida', null, null, null)`,
        [EP, EC, T, V],
      );
      const alerta = (id: string, tenant: string, usuario: string, envio: string | null) =>
        c.query(
          "insert into core.notificacao (id, tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id) values ($1, $2, $3, 'sistema', 'Etapa pendente na visita a Cliente 30', 'Pesquisa obrigatória', '/m/cliente', 'core', $4)",
          [id, tenant, usuario, envio],
        );
      await alerta(N_ALERTA, T, U, EP);
      await alerta(N_SEM_ETAPA, T, U, null);
      await alerta(N_ETAPA_CONCLUIDA, T, U, EC);
      // envio_id que só existe em OUTRO tenant: não conta
      await alerta(N_OUTRO_TENANT, T2, U2, EP);
      await c.query("insert into core.notificacao (id, tenant_id, usuario_id, tipo, titulo, corpo) values ($1, $2, $3, 'recado', 'Etapa pendente na visita?', 'Recado')", [N_RECADO, T, U]);
      const todas = () => c.query('select id, tipo, titulo, corpo, link, envio_id, updated_at from core.notificacao order by id').then((r) => r.rows);
      const linhasAntes = await todas();
      // políticas conferidas logo depois da 0030: as migrações seguintes podem acrescentar a sua (a 0031 cria a manutencao
      // em toda tabela com RLS), mas a 0030 não cria, troca nem apaga política nenhuma
      const ate0030 = await migrarUp(c, { ate: '0030' });
      const polNa0030 = (await retratoDoCatalogo(c)).filter((l) => l.startsWith('pol '));
      const seguintes = await migrarUp(c);
      expect([...ate0030.aplicadas, ...seguintes.aplicadas]).toEqual(desde0030);
      expect(ate0030.aplicadas).toEqual([desde0030[0]]);
      const depois = await retratoDoCatalogo(c);
      const subtipos = await c.query<{ id: string; subtipo: string | null }>('select id, subtipo from core.notificacao order by id');
      expect(subtipos.rows).toEqual([
        { id: N_ALERTA, subtipo: 'etapa_pendente_checkout' },
        { id: N_RECADO, subtipo: null },
        { id: N_SEM_ETAPA, subtipo: null },
        { id: N_ETAPA_CONCLUIDA, subtipo: null },
        { id: N_OUTRO_TENANT, subtipo: null },
      ]);
      // só a linha marcada avança updated_at (gatilho notificacao_updated_at): volta no próximo pull
      const linhasDepois = await todas();
      for (const [i, l] of linhasDepois.entries()) {
        const a = linhasAntes[i]!;
        if (l.id === N_ALERTA) {
          expect({ ...l, updated_at: null }).toEqual({ ...a, updated_at: null });
          expect((l.updated_at as Date).getTime()).toBeGreaterThan((a.updated_at as Date).getTime());
        } else expect(l).toEqual(a);
      }
      expect(depois).toContain('col core.notificacao.subtipo text nn=false');
      expect(depois.filter((l) => l.startsWith('idx ') && l.includes('subtipo'))).toEqual([]);
      expect(depois).toContain('rel core.notificacao r rls=true force=true');
      expect(polNa0030.filter((l) => l.includes('core.notificacao'))).toEqual(
        antes.filter((l) => l.includes('core.notificacao') && l.startsWith('pol ')),
      );
      expect((await migrarDown(c, { passos: desde0030.length })).aplicadas).toEqual([...desde0030].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select count(*)::int as n from core.notificacao')).rows[0]).toEqual({ n: 5 });
      await c.query(m30.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
