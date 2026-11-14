/**
 * 0067 — resumo de visitas por cliente (Oficial, decisão do dono do produto de 14/11/2026: a aba Performance da ficha do
 * cliente mostra o total de visitas e quem visitou por último). Dicionário: docs/banco/core.md, "0067". O que o BANCO garante:
 * - core.v_cliente_visita_resumo: uma linha por (tenant, cliente) com visita; total = visitas concluídas (viva, com checkout e
 *   resultado <> 'nao_finalizado', RN-CORE-11); última = checkin_em da concluída mais recente e quem a fez (core.usuario.nome);
 * - updated_at (cursor do sync) anda com qualquer visita do cliente, inclusive apagada ou aberta;
 * - security_invoker: a RLS de core.visita e core.usuario vale na view (o tenant A não vê o B); macuxi_app só lê.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m67 = migracoes.find((m) => m.versao === '0067')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m67.up);
const down = semComentarios(m67.down);
const umaLinha = up.replace(/\s+/g, ' ');
const VIEW = 'core.v_cliente_visita_resumo';
const CONCLUIDA = "v.deleted_at is null and v.checkout_em is not null and v.resultado <> 'nao_finalizado'";

describe('0067 resumo de visitas por cliente (estático)', () => {
  it('nome e posição: 0067_core_cliente_visita_resumo logo depois da 0066', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0066_core_meta_produtividade') + 1]).toBe('0067_core_cliente_visita_resumo');
  });

  it('aditiva: só a view e 2 índices em core.visita; nada apagado, alterado ou reescrito', () => {
    expect(up).not.toMatch(/\bupdate\b|\bdelete\b|\bdrop\b|\balter\b|\binsert\b|\btruncate\b|create table|\brevoke\b|\bpolicy\b/i);
    expect([...up.matchAll(/^create (?:unique )?index ([a-z_]+) on ([a-z_.]+)/gm)].map((m) => `${m[2]}.${m[1]}`)).toEqual([
      'core.visita.visita_cliente_resumo_ix',
      'core.visita.visita_cliente_sync_ix',
    ]);
    expect(umaLinha).toContain(
      "create index visita_cliente_resumo_ix on core.visita (tenant_id, cliente_id, checkin_em desc, id desc) include (usuario_id) where deleted_at is null and checkout_em is not null and resultado <> 'nao_finalizado';",
    );
    expect(up).toContain('create index visita_cliente_sync_ix on core.visita (tenant_id, cliente_id, updated_at);');
  });

  it('view com security_invoker (RLS de quem consulta), nomes exatos das colunas e só SELECT ao app', () => {
    expect(up).toContain(`create view ${VIEW} with (security_invoker = true) as`);
    for (const col of [
      'p.cliente_id', 'p.tenant_id', 'p.total_visitas', 'l.checkin_em as ultima_visita_em', 'l.usuario_id as ultima_visita_usuario_id',
      'u.nome as ultima_visita_usuario_nome', 'greatest(p.visitas_updated_at, u.updated_at) as updated_at',
    ]) expect(umaLinha).toContain(col);
    // concluída = viva, com checkout real e resultado <> 'nao_finalizado' (contagem e última visita pela mesma regra)
    expect(umaLinha).toContain(`count(*) filter (where ${CONCLUIDA})`);
    expect(umaLinha).toContain(`where ${CONCLUIDA} order by v.tenant_id, v.cliente_id, v.checkin_em desc, v.id desc`);
    // o cursor olha TODAS as visitas do cliente (sem filtro de deleted_at no group by)
    expect(umaLinha).toMatch(/max\(v\.updated_at\) as visitas_updated_at from core\.visita v group by v\.tenant_id, v\.cliente_id/);
    expect(up).toContain(`grant select on ${VIEW} to macuxi_app;`);
    expect([...up.matchAll(/^grant ([^;]+);/gm)].map((m) => m[1])).toEqual([`select on ${VIEW} to macuxi_app`]);
    expect(up).not.toMatch(/macuxi_worker|security definer|materialized/i);
  });

  it('down idempotente desfaz a view e os 2 índices, sem criar nada', () => {
    for (const trecho of [
      `drop view if exists ${VIEW};`,
      'drop index if exists core.visita_cliente_sync_ix;',
      'drop index if exists core.visita_cliente_resumo_ix;',
    ]) expect(down).toContain(trecho);
    expect(down).not.toMatch(/\b(create|add|delete|update|cascade)\b/i);
  });
});

interface Resumo {
  tenant_id: string;
  total_visitas: number;
  ultima_visita_em: Date | null;
  ultima_visita_usuario_id: string | null;
  ultima_visita_usuario_nome: string | null;
  updated_at: Date;
}

describe.skipIf(semBanco())('0067 resumo de visitas por cliente (banco)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const resumo = async (cliente: string): Promise<Resumo | undefined> =>
    (
      await app.query<Resumo>(
        `select tenant_id, total_visitas, ultima_visita_em, ultima_visita_usuario_id, ultima_visita_usuario_nome, updated_at from ${VIEW} where cliente_id = $1`,
        [cliente],
      )
    ).rows[0];
  const nomeDe = async (usuario: string) => (await q('select nome from core.usuario where id = $1', [usuario])).rows[0]!.nome as string;
  const checkinDe = async (visita: string) => (await q('select checkin_em from core.visita where id = $1', [visita])).rows[0]!.checkin_em as Date;
  const agora = async () => (await q('select now() as n')).rows[0]!.n as Date;
  const id = (n: number) => `aaaaaaaa-0067-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  /** Visita no cliente c3 do tenant A, `dias` atrás; fechada com o resultado dado (null = aberta). */
  const inserir = (n: number, usuario: string, dias: number, resultado: 'sem_pedido' | 'nao_finalizado' | null) =>
    q(
      `insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, checkout_em, resultado, fechada_por, motivo_id)
       values ($1, $2, $3, $4, (now() - make_interval(days => $5))::date, now() - make_interval(days => $5),
               case when $6::text is null then null else now() - make_interval(days => $5) + interval '30 minutes' end, $6::text,
               case $6::text when 'nao_finalizado' then 'auto' when 'sem_pedido' then 'usuario' end,
               case when $6::text = 'sem_pedido' then $7::uuid end)`,
      [id(n), A.tenantId, usuario, A.clientes.c3, dias, resultado, A.motivos.estoqueAlto],
    );

  it('fixture: total = concluídas (sem a nao_finalizado e sem a aberta); última = a concluída mais recente e quem a fez', async () => {
    await emTransacao(app, A.tenantId, async () => {
      // c1: pedido do vendedor-1 (hoje 13:05), atendido do promotor (hoje 15:00) e a esquecida nao_finalizado (anteontem)
      expect(await resumo(A.clientes.c1)).toMatchObject({
        tenant_id: A.tenantId, total_visitas: 2, ultima_visita_em: await checkinDe(A.visitas.promotorC1Hoje),
        ultima_visita_usuario_id: A.usuarios.promotor, ultima_visita_usuario_nome: await nomeDe(A.usuarios.promotor),
      });
      // c2: só a visita ABERTA do vendedor-2 → linha com total 0 e sem última
      expect(await resumo(A.clientes.c2)).toMatchObject({ total_visitas: 0, ultima_visita_em: null, ultima_visita_usuario_id: null, ultima_visita_usuario_nome: null });
      // c3: cliente_fechado conta (houve check-out real)
      expect(await resumo(A.clientes.c3)).toMatchObject({ total_visitas: 1, ultima_visita_usuario_id: A.usuarios.vendedor1, ultima_visita_usuario_nome: await nomeDe(A.usuarios.vendedor1) });
    });
  });

  it('visitas em datas diferentes: total soma as concluídas; nao_finalizado e aberta ficam fora mas movem o updated_at', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const antes = (await resumo(A.clientes.c3))!;
      expect(antes.updated_at.getTime()).toBeLessThan((await agora()).getTime());
      await inserir(1, A.usuarios.vendedor2, 10, 'sem_pedido');
      await inserir(2, A.usuarios.vendedor2, 20, 'sem_pedido');
      let r = (await resumo(A.clientes.c3))!;
      expect(r.total_visitas).toBe(3);
      expect(r.ultima_visita_usuario_id).toBe(A.usuarios.vendedor1); // a de ontem continua a mais recente
      expect(r.updated_at).toEqual(await agora());
      // nao_finalizado mais recente que todas: não conta nem vira a última
      await inserir(3, A.usuarios.vendedor2, 0, 'nao_finalizado');
      // aberta do vendedor-1 (ele não tem outra aberta): não conta nem vira a última
      await inserir(4, A.usuarios.vendedor1, 0, null);
      r = (await resumo(A.clientes.c3))!;
      expect(r).toMatchObject({ total_visitas: 3, ultima_visita_em: await checkinDe(A.visitas.v1c3Ontem), ultima_visita_usuario_id: A.usuarios.vendedor1 });
    });
  });

  it('apagada (deleted_at) sai do total e da última, mas move o updated_at; só a apagada = total 0 e última nula', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('update core.visita set deleted_at = now() where id = $1', [A.visitas.v1c3Ontem]);
      expect(await resumo(A.clientes.c3)).toMatchObject({
        total_visitas: 0, ultima_visita_em: null, ultima_visita_usuario_id: null, ultima_visita_usuario_nome: null, updated_at: await agora(),
      });
      await inserir(1, A.usuarios.vendedor2, 10, 'sem_pedido');
      await inserir(2, A.usuarios.vendedor2, 20, 'sem_pedido');
      expect(await resumo(A.clientes.c3)).toMatchObject({
        total_visitas: 2, ultima_visita_em: await checkinDe(id(1)), ultima_visita_usuario_id: A.usuarios.vendedor2,
        ultima_visita_usuario_nome: await nomeDe(A.usuarios.vendedor2),
      });
    });
  });

  it('troca de nome do usuário da última visita aparece na view e move o updated_at (cursor do sync)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await resumo(A.clientes.c1))!.updated_at.getTime()).toBeLessThan((await agora()).getTime());
      await q("update core.usuario set nome = 'Promotor Renomeado' where id = $1", [A.usuarios.promotor]);
      expect(await resumo(A.clientes.c1)).toMatchObject({ ultima_visita_usuario_nome: 'Promotor Renomeado', updated_at: await agora() });
    });
  });

  it('isolamento: o tenant A não vê linha do B (nem filtrando pelo cliente do B); sem tenant não vê nada; app não escreve na view', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect(await resumo(B.clientes.c1)).toBeUndefined();
      const todos = await q(`select distinct tenant_id from ${VIEW}`);
      expect(todos.rows).toEqual([{ tenant_id: A.tenantId }]);
      await q('savepoint s');
      expect(await erroDe(q(`delete from ${VIEW} where cliente_id = $1`, [A.clientes.c1]))).toMatchObject({ code: '42501' });
      await q('rollback to savepoint s');
    });
    await emTransacao(app, B.tenantId, async () => {
      expect(await resumo(B.clientes.c1)).toMatchObject({
        tenant_id: B.tenantId, total_visitas: 2, ultima_visita_em: await checkinDe(B.visitas.c1Hoje), ultima_visita_usuario_id: B.usuarios.vendedor,
      });
      expect(await resumo(A.clientes.c1)).toBeUndefined();
    });
    await emTransacao(app, '', async () => {
      expect((await q(`select 1 from ${VIEW}`)).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0067 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria a view com security_invoker e os 2 índices; down volta ao catálogo da 0066; down de novo e up de novo iguais', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0066' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0067' })).aplicadas).toEqual(['0067_core_cliente_visita_resumo']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain(`rel ${VIEW} v rls=false force=false`);
      const opcoes = await c.query<{ o: string[] }>("select reloptions as o from pg_class where oid = 'core.v_cliente_visita_resumo'::regclass");
      expect(opcoes.rows[0]!.o).toContain('security_invoker=true');
      const colunas = await c.query<{ c: string }>(
        "select column_name as c from information_schema.columns where table_schema = 'core' and table_name = 'v_cliente_visita_resumo' order by ordinal_position",
      );
      expect(colunas.rows.map((x) => x.c)).toEqual([
        'cliente_id', 'tenant_id', 'total_visitas', 'ultima_visita_em', 'ultima_visita_usuario_id', 'ultima_visita_usuario_nome', 'updated_at',
      ]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0067_core_cliente_visita_resumo']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m67.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0067' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
