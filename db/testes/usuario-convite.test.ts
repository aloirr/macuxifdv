/**
 * 0036 — core.usuario_convite, core.usuario.telefone e anonimizar_usuario com convites (T-0087 fatia E, RN-CORE-31; desenho
 * docs/modulos/core/equipe-csv.md; pedido R-20261106-034446-modulo-core). O que o BANCO garante: só o SHA-256 hex do token
 * (CHECK de formato, único GLOBAL), no máximo 1 convite pendente por usuário, usado e revogado exclusivos, autor coerente
 * (id + tipo, sem FK), RLS por tenant com grant select/insert/update ao macuxi_app (sem delete), nada ao macuxi_worker,
 * fora do sync e SEM função SECURITY DEFINER nova (o tenant vem no token). anonimizar_usuario apaga o telefone e revoga os
 * convites pendentes. Down volta exatamente ao catálogo da 0035.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { CONVITES_FIXTURE, dadosDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const C = CONVITES_FIXTURE;
const migracoes = lerMigracoes();
const m36 = migracoes.find((m) => m.versao === '0036')!;
const m24 = migracoes.find((m) => m.versao === '0024')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const corpoAnonimizar = (sql: string) => sql.slice(sql.indexOf('function plataforma.anonimizar_usuario'), sql.indexOf('$$;', sql.indexOf('function plataforma.anonimizar_usuario')));
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

describe('0036 core.usuario_convite (estático)', () => {
  it('nome e posição: 0036_core_usuario_convite logo depois da 0035', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0035_plataforma_super_admin') + 1]).toBe('0036_core_usuario_convite');
  });

  it('tabela com FK composta, hash SHA-256, único global do hash e pendente único por usuário', () => {
    const sql = semComentarios(m36.up);
    expect(sql).toContain('constraint usuario_convite_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(sql).toContain("constraint usuario_convite_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain('constraint usuario_convite_usado_ou_revogado check (usado_em is null or revogado_em is null)');
    expect(sql).toContain("check (criado_por_tipo is null or criado_por_tipo in ('usuario', 'super_admin'))");
    expect(sql).toContain('check ((criado_por_id is null) = (criado_por_tipo is null))');
    expect(sql).toContain('create unique index usuario_convite_token_uk on core.usuario_convite (token_hash);');
    expect(sql).toMatch(/create unique index usuario_convite_pendente_uk on core\.usuario_convite \(tenant_id, usuario_id\)\s+where usado_em is null and revogado_em is null and deleted_at is null;/);
    // sem FK do autor (usuário do tenant OU super-admin de plataforma, como o ator_id da 0035)
    expect(sql).not.toMatch(/criado_por_id\)? references/);
    // o banco não amarra prazo nem uso ao created_at (relógio da API e o simulado dos testes)
    expect(sql).not.toMatch(/expira_em\s*[<>]=?\s*created_at|usado_em\s*[<>]=?\s*created_at/);
  });

  it('RLS forçado, isolamento_tenant + manutencao; macuxi_app sem DELETE; nada ao worker; fora do sync', () => {
    const sql = semComentarios(m36.up);
    expect(sql).toContain('alter table core.usuario_convite force row level security;');
    expect(sql).toContain('create policy manutencao on core.usuario_convite for all to macuxi_manutencao using (true) with check (true);');
    expect(sql).toContain('grant select, insert, update on core.usuario_convite to macuxi_app;');
    expect(sql).not.toMatch(/macuxi_worker/);
    expect(TABELAS_FORA_DO_SYNC).toContain('core.usuario_convite');
    expect(sql).not.toMatch(/on core\.usuario_convite \(tenant_id, updated_at, id\)/);
  });

  it('sem função SECURITY DEFINER nova (o tenant vem no token, como o refresh da 0004)', () => {
    expect(semComentarios(m36.up)).not.toMatch(/security definer/i);
    expect(semComentarios(m36.down)).not.toMatch(/security definer/i);
  });

  it('telefone: coluna nula, CHECK de tamanho, sem índice', () => {
    const sql = semComentarios(m36.up);
    expect(sql).toContain('alter table core.usuario add column telefone text;');
    expect(sql).toContain("check (telefone is null or (btrim(telefone) <> '' and char_length(telefone) <= 30));");
    expect(sql).not.toMatch(/create (unique )?index [a-z_]+ on core\.usuario \(/);
  });

  it('anonimizar_usuario: corpo da 0024 + telefone nulo + revoga os convites pendentes; o down devolve o corpo da 0024', () => {
    const da24 = corpoAnonimizar(m24.up);
    const da36 = corpoAnonimizar(m36.up);
    expect(da36).toContain("nome_curto = null, telefone = null,");
    expect(da36).toMatch(/update core\.usuario_convite c set revogado_em = now\(\)\s+where c\.tenant_id = p_tenant and c\.usuario_id = p_usuario and c\.usado_em is null and c\.revogado_em is null;/);
    expect(da36).toContain("item := 'core.usuario_convite'; quantidade := v_n; return next;");
    expect(da36).not.toMatch(/security definer/i);
    expect(corpoAnonimizar(m36.down)).toBe(da24);
  });

  it('down: função antes da tabela e da coluna; idempotente', () => {
    const down = semComentarios(m36.down);
    const i = (s: string) => down.indexOf(s);
    expect(i('create or replace function plataforma.anonimizar_usuario')).toBeGreaterThanOrEqual(0);
    expect(i('create or replace function plataforma.anonimizar_usuario')).toBeLessThan(i('drop table if exists core.usuario_convite;'));
    expect(i('drop table if exists core.usuario_convite;')).toBeLessThan(i('alter table core.usuario drop constraint if exists usuario_telefone_preenchido;'));
    expect(i('alter table core.usuario drop constraint if exists usuario_telefone_preenchido;')).toBeLessThan(i('alter table core.usuario drop column if exists telefone;'));
  });

  it('espelho Drizzle: usuario_convite (colunas e enum do autor) e usuario.telefone', () => {
    const cols = Object.fromEntries(getTableConfig(nuvemCore.usuarioConvite).columns.map((c) => [c.name, { tipo: c.getSQLType(), nn: c.notNull }]));
    expect(cols).toMatchObject({
      usuario_id: { tipo: 'uuid', nn: true },
      token_hash: { tipo: 'text', nn: true },
      expira_em: { tipo: 'timestamp with time zone', nn: true },
      usado_em: { tipo: 'timestamp with time zone', nn: false },
      revogado_em: { tipo: 'timestamp with time zone', nn: false },
      criado_por_id: { tipo: 'uuid', nn: false },
      criado_por_tipo: { tipo: 'text', nn: false },
    });
    expect([...nuvemCore.CRIADO_POR_CONVITE].sort()).toEqual(['super_admin', 'usuario']);
    const tel = getTableConfig(nuvemCore.usuario).columns.find((c) => c.name === 'telefone');
    expect(tel?.getSQLType()).toBe('text');
    expect(tel?.notNull).toBe(false);
  });

  it('fixture: token `<tenant>.<segredo>`, banco só com o sha256 do segredo; A pendente + revogado + usado, B pendente', () => {
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const linhas = d['core.usuario_convite'];
    for (const x of [C.A.pendente, C.A.revogado, C.A.usado, C.B.pendente]) {
      expect(x.hash).toBe(sha(x.segredo));
      expect(x.token.split('.')[1]).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
      expect(JSON.stringify(linhas)).not.toContain(x.segredo);
    }
    expect(C.A.pendente.token.startsWith(`${A.tenantId}.`)).toBe(true);
    expect(C.B.pendente.token.startsWith(`${B.tenantId}.`)).toBe(true);
    const pendentes = linhas.filter((l) => l.usado_em === null && l.revogado_em === null).map((l) => `${l.tenant_id}:${l.usuario_id}`);
    expect(new Set(pendentes).size).toBe(pendentes.length);
    expect(linhas.find((l) => l.id === C.B.pendente.id)).toMatchObject({ criado_por_tipo: 'super_admin' });
  });
});

describe.skipIf(semBanco())('0036 core.usuario_convite (banco, papel de aplicação)', () => {
  let app: pg.Client;
  let admin: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await app.connect();
    await admin.connect();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const erro = (tenant: string, fn: () => Promise<unknown>) => erroDe(emTransacao(app, tenant, fn));
  const inserir = (usuario: string, hash: string, extra = '', valores: unknown[] = []) =>
    q(`insert into core.usuario_convite (tenant_id, usuario_id, token_hash, expira_em${extra ? `, ${extra}` : ''}) values (plataforma.tenant_atual(), $1, $2, now() + interval '7 days'${valores.map((_, i) => `, $${i + 3}`).join('')}) returning id`, [usuario, hash, ...valores]);

  it('aceite: localiza pelo hash no contexto do tenant do token e consome uma vez só (update condicional)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const l = await q<{ id: string; usuario_id: string }>('select id, usuario_id from core.usuario_convite where token_hash = $1 and deleted_at is null for update', [C.A.pendente.hash]);
      expect(l.rows).toEqual([{ id: C.A.pendente.id, usuario_id: A.usuarios.vendedor2 }]);
      const consumir = () => q('update core.usuario_convite set usado_em = now() where id = $1 and usado_em is null and revogado_em is null and expira_em > now()', [C.A.pendente.id]);
      expect((await consumir()).rowCount).toBe(1);
      expect((await consumir()).rowCount).toBe(0);
      const r = await q<{ mudou: boolean }>('select updated_at >= created_at as mudou from core.usuario_convite where id = $1', [C.A.pendente.id]);
      expect(r.rows).toEqual([{ mudou: true }]);
    });
  });

  it('renovar: revogar e depois inserir passa; inserir outro pendente sem revogar = 23505', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('update core.usuario_convite set revogado_em = now() where usuario_id = $1 and usado_em is null and revogado_em is null', [A.usuarios.vendedor2])).rowCount).toBe(1);
      expect((await inserir(A.usuarios.vendedor2, sha('novo-1'), 'criado_por_id, criado_por_tipo', [A.usuarios.admin, 'usuario'])).rowCount).toBe(1);
    });
    const e = await erro(A.tenantId, () => inserir(A.usuarios.vendedor2, sha('novo-2')));
    expect(e).toMatchObject({ code: '23505', message: expect.stringContaining('usuario_convite_pendente_uk') });
  });

  it.each([
    ['hash fora do formato', () => inserir(A.usuarios.gerente, 'abc'), 'usuario_convite_token_hash_sha256'],
    ['hash em maiúsculas', () => inserir(A.usuarios.gerente, sha('x').toUpperCase()), 'usuario_convite_token_hash_sha256'],
    ['autor sem tipo', () => inserir(A.usuarios.gerente, sha('y'), 'criado_por_id', [A.usuarios.admin]), 'usuario_convite_criado_por_par'],
    ['tipo de autor desconhecido', () => inserir(A.usuarios.gerente, sha('z'), 'criado_por_id, criado_por_tipo', [A.usuarios.admin, 'admin']), 'usuario_convite_criado_por_tipo_valido'],
    ['usado e revogado', () => q('update core.usuario_convite set revogado_em = now() where id = $1', [C.A.usado.id]), 'usuario_convite_usado_ou_revogado'],
  ] as const)('CHECK recusa: %s', async (_nome, fn, restricao) => {
    expect(await erro(A.tenantId, fn)).toMatchObject({ code: '23514', message: expect.stringContaining(restricao) });
  });

  it('hash único GLOBAL (o mesmo hash em outro tenant = 23505) e FK composta (usuário de B em A = 23503)', async () => {
    expect(await erro(B.tenantId, () => inserir(B.usuarios.admin, C.A.pendente.hash))).toMatchObject({ code: '23505', message: expect.stringContaining('usuario_convite_token_uk') });
    expect(await erro(A.tenantId, () => inserir(B.usuarios.admin, sha('fk')))).toMatchObject({ code: '23503' });
  });

  it('vazamento: B não lê, não consome nem revoga o convite de A pelo hash; A não insere em B', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select 1 from core.usuario_convite where token_hash = $1', [C.A.pendente.hash])).rowCount).toBe(0);
      expect((await q('update core.usuario_convite set usado_em = now() where token_hash = $1', [C.A.pendente.hash])).rowCount).toBe(0);
      expect((await q<{ id: string }>('select id from core.usuario_convite order by id')).rows.map((r) => r.id)).toEqual([C.B.pendente.id]);
    });
    const e = await erro(A.tenantId, () =>
      q("insert into core.usuario_convite (tenant_id, usuario_id, token_hash, expira_em) values ($1, $2, $3, now() + interval '7 days')", [B.tenantId, B.usuarios.admin, sha('cruzado')]),
    );
    expect(e?.code).toBe('42501');
  });

  it('sem contexto de tenant: 0 linhas; macuxi_app sem DELETE (42501); macuxi_worker sem SELECT (42501)', async () => {
    await emTransacao(app, null, async () => {
      expect((await q('select 1 from core.usuario_convite')).rowCount).toBe(0);
    });
    expect((await erro(A.tenantId, () => q('delete from core.usuario_convite where id = $1', [C.A.usado.id])))?.code).toBe('42501');
    const w = await erroDe(
      emTransacao(admin, null, async () => {
        await admin.query('set local role macuxi_worker');
        await admin.query('select 1 from core.usuario_convite');
      }),
    );
    expect(w?.code).toBe('42501');
  });

  it('telefone: aceita nulo e até 30 caracteres; recusa vazio e 31 (23514)', async () => {
    const gravar = (v: string | null) => q('update core.usuario set telefone = $2 where id = $1', [A.usuarios.vendedor1, v]);
    expect(await erro(A.tenantId, async () => {
      await gravar('(95) 99111-2222');
      await gravar('9'.repeat(30));
      await gravar(null);
    })).toBeNull();
    for (const v of ['', '   ', '9'.repeat(31)]) {
      expect(await erro(A.tenantId, () => gravar(v)), JSON.stringify(v)).toMatchObject({ code: '23514', message: expect.stringContaining('usuario_telefone_preenchido') });
    }
  });

  it('anonimizar_usuario: tira o telefone e revoga só os convites pendentes do titular; B intacto', async () => {
    await emTransacao(admin, null, async () => {
      const u = A.usuarios.vendedor2;
      await admin.query("update core.usuario set telefone = '95991112222' where tenant_id = $1 and id = $2", [A.tenantId, u]);
      const bAntes = (await admin.query('select * from core.usuario_convite where tenant_id = $1 order by id', [B.tenantId])).rows;
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, u]);
      const itens = r.rows.map((x) => x.item);
      expect(itens.indexOf('core.usuario_convite')).toBe(itens.indexOf('core.dispositivo') + 1);
      expect(Number(r.rows.find((x) => x.item === 'core.usuario_convite')!.quantidade)).toBe(1);
      expect((await admin.query('select telefone from core.usuario where id = $1', [u])).rows).toEqual([{ telefone: null }]);
      const cs = (await admin.query<{ id: string; pendente: boolean }>('select id, (usado_em is null and revogado_em is null) as pendente from core.usuario_convite where tenant_id = $1 order by id', [A.tenantId])).rows;
      expect(cs.filter((c) => c.pendente)).toEqual([]);
      expect((await admin.query('select usado_em is not null as usado, revogado_em is null as sem_revogar from core.usuario_convite where id = $1', [C.A.usado.id])).rows).toEqual([{ usado: true, sem_revogar: true }]);
      expect((await admin.query('select * from core.usuario_convite where tenant_id = $1 order by id', [B.tenantId])).rows).toEqual(bAntes);
    });
  });
});

describe.skipIf(semBanco())('0036 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000036';
  const U = 'cccccccc-0036-4000-8000-000000000001';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0036_core_usuario_convite') - 1]!.slice(0, 4);
  const desde0036 = nomes.filter((n) => n >= '0036');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('usuário anterior intacto (telefone nulo); down volta ao catálogo da 0035 com o usuário; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo36', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Pessoa', 'pessoa@exemplo.com.br', 'vendedor')", [U, T]);
      const linha = () => c.query('select id, nome, email, perfil, updated_at from core.usuario where id = $1', [U]).then((r) => r.rows[0]);
      const linhaAntes = await linha();
      expect((await migrarUp(c)).aplicadas).toEqual(desde0036);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.usuario.telefone text nn=false');
      expect((await c.query('select telefone from core.usuario where id = $1', [U])).rows).toEqual([{ telefone: null }]);
      expect(await linha()).toEqual(linhaAntes);
      await c.query("insert into core.usuario_convite (tenant_id, usuario_id, token_hash, expira_em) values ($1, $2, $3, now() + interval '7 days')", [T, U, sha('up-down')]);
      expect((await migrarDown(c, { passos: desde0036.length })).aplicadas).toEqual([...desde0036].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await linha()).toEqual(linhaAntes);
      await c.query(m36.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
