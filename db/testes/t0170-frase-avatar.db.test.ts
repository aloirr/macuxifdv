/**
 * 0065 — frase do dia (RN-CORE-41) e foto ou avatar do usuário (RN-CORE-42) (T-0170; desenho
 * docs/desenho/inicio-frase-avatar-pedidos.md §1.1 e §1.2). Dicionário: docs/banco/core.md, "0065". O que o BANCO garante:
 * - core.frase_dia: texto 1..120 depois do trim, sem frase repetida entre as vivas (sem diferenciar maiúsculas nem espaços nas
 *   pontas), código P01..P30 único por tenant MESMO apagada (a padrão removida não volta);
 * - as 30 frases padrão (texto = modules/core/domain/frase-avatar/frases-padrao.ts) nos tenants que já existiam e em todo
 *   tenant novo (gatilho tenant_semear_frase_dia: provisionar_tenant, sa_provisionar_tenant, seeds e fixtures), idempotente;
 * - core.usuario_avatar: uma viva por usuário, código só no avatar, arquivo só na foto e único no tenant;
 * - RLS enable + force entre dois tenants; macuxi_app sem DELETE.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AVATARES, TIPOS_AVATAR } from '../../modules/core/contracts/avatar';
import { FRASE_TEXTO_MAX, PADRAO_CODIGO_REGEX } from '../../modules/core/contracts/frases';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { FRASES_PADRAO } from '../../modules/core/domain/frase-avatar/frases-padrao';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idDeChave } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m65 = migracoes.find((m) => m.versao === '0065')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m65.up);
const down = semComentarios(m65.down);
const umaLinha = up.replace(/\s+/g, ' ');
/** Id determinístico da frase padrão (mesma chave da core.semear_frase_dia). */
const idFrasePadrao = (tenant: string, codigo: string) => idDeChave(`${tenant}:core.frase_dia:${codigo}`);

/** As 30 linhas do VALUES da carga, na ordem do arquivo. */
const frasesDaMigracao = () =>
  [...m65.up.matchAll(/^\s+\('(P\d{2})', (\d+), '((?:[^']|'')*)'\),?$/gm)].map((m) => ({ codigo: m[1]!, ordem: Number(m[2]), texto: m[3]!.replace(/''/g, "'") }));

const colunasDoSql = (tabela: string): string[] => {
  const corpo = new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(up)?.[1] ?? '';
  return [...corpo.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|timestamptz|boolean|integer)\b/gm)].map((m) => m[1]!);
};
const colunasDrizzle = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).columns.map((c) => c.name).sort();

describe('0065 frase do dia e avatar (estático)', () => {
  it('nome e posição: 0065_core_frase_avatar logo depois da 0064', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0064_core_tarefa') + 1]).toBe('0065_core_frase_avatar');
  });

  it('RN-CORE-41: as 30 frases da carga são exatamente as do domain (código, ordem 1..30 e texto), cada uma dentro do limite', () => {
    const daMigracao = frasesDaMigracao();
    expect(daMigracao).toEqual(FRASES_PADRAO.map((f, i) => ({ codigo: f.codigo, ordem: i + 1, texto: f.texto })));
    expect(daMigracao).toHaveLength(30);
    for (const f of daMigracao) {
      expect(f.codigo).toMatch(PADRAO_CODIGO_REGEX);
      expect(f.texto.trim().length).toBeGreaterThan(0);
      expect(f.texto.trim().length).toBeLessThanOrEqual(FRASE_TEXTO_MAX);
    }
    expect(new Set(daMigracao.map((f) => f.texto.trim().toLowerCase())).size).toBe(30);
  });

  it('carga idempotente pelo gatilho em plataforma.tenant (padrão 0056/0057), sem recriar o provisionar_tenant; backfill dos existentes', () => {
    expect(umaLinha).toContain("select plataforma.uuid_de_chave(p_tenant::text || ':core.frase_dia:' || f.codigo), p_tenant, f.texto, true, f.ordem, f.codigo");
    expect(umaLinha).toContain('on conflict do nothing;');
    expect(up).toMatch(/create trigger tenant_semear_frase_dia after insert on plataforma\.tenant\s+for each row execute function core\.semear_tenant_frase_dia\(\);/);
    expect(up).toContain('select core.semear_frase_dia(t.id) from plataforma.tenant t;');
    expect(up).not.toMatch(/provisionar_tenant/);
    expect(up).toContain('revoke all on function core.semear_frase_dia(uuid) from public;');
    expect(up).toContain('revoke all on function core.semear_tenant_frase_dia() from public;');
  });

  it('frase_dia: CHECKs e únicos do desenho (código sem filtro de deleted_at; texto vivo sem maiúsculas nem espaços nas pontas)', () => {
    expect(umaLinha).toContain('constraint frase_dia_texto_tamanho check (char_length(btrim(texto)) between 1 and 120)');
    expect(umaLinha).toContain("constraint frase_dia_padrao_codigo_formato check (padrao_codigo is null or padrao_codigo ~ '^P[0-9]{2,3}$')");
    expect(up).toContain('create unique index frase_dia_padrao_uk on core.frase_dia (tenant_id, padrao_codigo);');
    expect(up).toContain('create unique index frase_dia_texto_uk on core.frase_dia (tenant_id, lower(btrim(texto))) where deleted_at is null;');
    expect(up).toContain('create index frase_dia_sync_ix on core.frase_dia (tenant_id, updated_at, id);');
  });

  it('usuario_avatar: listas = contrato; coerência código/arquivo; uma viva por usuário; arquivo único; pull por usuário', () => {
    expect(umaLinha).toContain(`check (tipo in (${TIPOS_AVATAR.map((t) => `'${t}'`).join(', ')}))`);
    expect(umaLinha).toContain(`check (avatar_codigo is null or avatar_codigo in (${AVATARES.map((t) => `'${t}'`).join(', ')}))`);
    expect([...nuvemCore.TIPOS_AVATAR_BANCO]).toEqual([...TIPOS_AVATAR]);
    expect([...nuvemCore.AVATARES_BANCO]).toEqual([...AVATARES]);
    expect(umaLinha).toContain("constraint usuario_avatar_codigo_coerente check ((tipo = 'avatar') = (avatar_codigo is not null))");
    expect(umaLinha).toContain("constraint usuario_avatar_arquivo_coerente check ((tipo = 'foto') = (arquivo_id is not null))");
    expect(up).toContain('create unique index usuario_avatar_vivo_uk on core.usuario_avatar (tenant_id, usuario_id) where deleted_at is null;');
    expect(up).toContain('create unique index usuario_avatar_arquivo_uk on core.usuario_avatar (tenant_id, arquivo_id);');
    expect(up).toContain('create index usuario_avatar_usuario_sync_ix on core.usuario_avatar (tenant_id, usuario_id, updated_at, id);');
    expect(up).not.toMatch(/references plataforma\.arquivo/);
  });

  it('RLS enable + force, isolamento_tenant e manutencao; macuxi_app sem DELETE', () => {
    for (const t of ['core.frase_dia', 'core.usuario_avatar']) {
      expect(up).toContain(`alter table ${t} enable row level security;`);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(up).toContain(`grant select, insert, update on ${t} to macuxi_app;`);
    }
    expect(up).not.toMatch(/grant [^;]*delete/);
  });

  it('down idempotente desfaz tudo (gatilho, funções e tabelas)', () => {
    for (const trecho of [
      'drop trigger if exists tenant_semear_frase_dia on plataforma.tenant;',
      'drop function if exists core.semear_tenant_frase_dia();',
      'drop function if exists core.semear_frase_dia(uuid);',
      'drop table if exists core.usuario_avatar;',
      'drop table if exists core.frase_dia;',
    ]) expect(down).toContain(trecho);
    expect(down).not.toMatch(/\b(create|add)\b/i);
  });

  it('espelho Drizzle: mesmas colunas do SQL', () => {
    expect(colunasDrizzle(nuvemCore.fraseDia)).toEqual(colunasDoSql('core.frase_dia').sort());
    expect(colunasDrizzle(nuvemCore.usuarioAvatar)).toEqual(colunasDoSql('core.usuario_avatar').sort());
  });
});

describe.skipIf(semBanco())('0065 frase do dia e avatar (banco)', () => {
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
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const recusa = async (sql: string, p: unknown[], code: string, trecho: string) => {
    await q('savepoint s');
    expect(await erroDe(q(sql, p)), sql).toMatchObject({ code, message: expect.stringContaining(trecho) });
    await q('rollback to savepoint s');
  };
  const esperadas = (tenant: string) => FRASES_PADRAO.map((f, i) => ({ id: idFrasePadrao(tenant, f.codigo), texto: f.texto, ativa: true, ordem: i + 1, padrao_codigo: f.codigo }));

  it('A e B têm as 30 padrão, cada um as suas (ids do tenant, ordem 1..30, ativas)', async () => {
    for (const t of [A.tenantId, B.tenantId]) {
      await emTransacao(app, t, async () => {
        const r = await q('select id, texto, ativa, ordem, padrao_codigo from core.frase_dia where padrao_codigo is not null order by ordem');
        expect(r.rows).toEqual(esperadas(t));
      });
    }
  });

  it('frase_dia: repetida (maiúsculas/espaços) = 23505; vazia, longa ou código inválido = 23514; apagada libera o texto', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = 'insert into core.frase_dia (tenant_id, texto, ordem, padrao_codigo) values ($1, $2, 31, $3)';
      await recusa(ins, [A.tenantId, `  ${FRASES_PADRAO[0]!.texto.toUpperCase()} `, null], '23505', 'frase_dia_texto_uk');
      await recusa(ins, [A.tenantId, '   ', null], '23514', 'frase_dia_texto_tamanho');
      await recusa(ins, [A.tenantId, 'x'.repeat(121), null], '23514', 'frase_dia_texto_tamanho');
      await recusa(ins, [A.tenantId, 'Nova', 'X1'], '23514', 'frase_dia_padrao_codigo_formato');
      await recusa(ins, [A.tenantId, 'Nova', 'P01'], '23505', 'frase_dia_padrao_uk');
      await q('insert into core.frase_dia (tenant_id, texto, ordem) values ($1, $2, 31)', [A.tenantId, 'x'.repeat(120)]);
      await q('update core.frase_dia set deleted_at = now() where id = $1', [idFrasePadrao(A.tenantId, 'P02')]);
      await q('insert into core.frase_dia (tenant_id, texto, ordem) values ($1, $2, 32)', [A.tenantId, FRASES_PADRAO[1]!.texto]);
    });
  });

  it('carga de novo não duplica nem devolve a padrão removida (RN-CORE-41)', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      await admin.query('update core.frase_dia set deleted_at = now() where id = $1', [idFrasePadrao(A.tenantId, 'P05')]);
      await admin.query("update core.frase_dia set texto = 'Texto do tenant' where id = $1", [idFrasePadrao(A.tenantId, 'P06')]);
      await admin.query('select core.semear_frase_dia($1)', [A.tenantId]);
      const r = await admin.query<{ n: number; vivas: number; p06: string }>(
        "select count(*)::int as n, count(*) filter (where deleted_at is null)::int as vivas, max(texto) filter (where padrao_codigo = 'P06') as p06 from core.frase_dia where tenant_id = $1 and padrao_codigo is not null",
        [A.tenantId],
      );
      expect(r.rows[0]).toEqual({ n: 30, vivas: 29, p06: 'Texto do tenant' });
    });
  });

  it('tenant novo pelo provisionar_tenant nasce com as 30 (mesma transação, pelo gatilho)', async () => {
    await emTransacao(admin, null, async () => {
      const entrada = {
        codigo: 't0170-frases', nome: 'Distribuidora T0170', documento: null, fuso: 'America/Manaus', plano: 'piloto',
        modulos: [{ modulo: 'core', licencas: null, perfis: ['admin', 'vendedor'] }],
        admin: { email: 'admin@t0170.exemplo.com.br', nome: 'Admin T0170', senha_hash: '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt' }, redefinir_senha: false,
      };
      const r = (await admin.query<{ r: { tenant_id: string } }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(entrada)])).rows[0]!.r;
      const f = await admin.query('select id, texto, ativa, ordem, padrao_codigo from core.frase_dia where tenant_id = $1 order by ordem', [r.tenant_id]);
      expect(f.rows).toEqual(esperadas(r.tenant_id));
    });
  });

  it('usuario_avatar: coerência = 23514; segunda viva = 23505; trocar (apaga a viva e grava a nova) passa; arquivo repetido = 23505', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = 'insert into core.usuario_avatar (id, tenant_id, usuario_id, tipo, avatar_codigo, arquivo_id, alterado_em, alterado_por) values ($1, $2, $3, $4, $5, $6, now(), $3)';
      const id = (n: number) => `aaaaaaaa-0170-4000-8000-0000000003${String(n).padStart(2, '0')}`;
      const ARQ = 'aaaaaaaa-0170-4000-8000-000000000399';
      await recusa(ins, [id(1), A.tenantId, A.usuarios.analista, 'avatar', null, null], '23514', 'usuario_avatar_codigo_coerente');
      await recusa(ins, [id(1), A.tenantId, A.usuarios.analista, 'iniciais', 'm1', null], '23514', 'usuario_avatar_codigo_coerente');
      await recusa(ins, [id(1), A.tenantId, A.usuarios.analista, 'avatar', 'x9', null], '23514', 'usuario_avatar_codigo_valido');
      await recusa(ins, [id(1), A.tenantId, A.usuarios.analista, 'foto', null, null], '23514', 'usuario_avatar_arquivo_coerente');
      await recusa(ins, [id(1), A.tenantId, A.usuarios.analista, 'emoji', null, null], '23514', 'usuario_avatar_tipo_valido');
      await recusa(ins, [id(1), A.tenantId, B.usuarios.admin, 'iniciais', null, null], '23503', 'usuario_avatar_');
      await q(ins, [id(1), A.tenantId, A.usuarios.analista, 'foto', null, ARQ]);
      await recusa(ins, [id(2), A.tenantId, A.usuarios.analista, 'avatar', 'f2', null], '23505', 'usuario_avatar_vivo_uk');
      await q('update core.usuario_avatar set deleted_at = now() where id = $1', [id(1)]);
      await q(ins, [id(2), A.tenantId, A.usuarios.analista, 'avatar', 'f2', null]);
      await recusa(ins, [id(3), A.tenantId, A.usuarios.assistente, 'foto', null, ARQ], '23505', 'usuario_avatar_arquivo_uk');
      await q(ins, [id(4), A.tenantId, A.usuarios.assistente, 'iniciais', null, null]);
    });
  });

  it('macuxi_app não apaga (42501); vazamento: B não vê nem altera as frases e o avatar de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await recusa('delete from core.frase_dia', [], '42501', 'frase_dia');
      await recusa('delete from core.usuario_avatar', [], '42501', 'usuario_avatar');
      await q(
        "insert into core.usuario_avatar (tenant_id, usuario_id, tipo, avatar_codigo, alterado_em, alterado_por) values ($1, $2, 'avatar', 'm1', now(), $2)",
        [A.tenantId, A.usuarios.analista],
      );
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await q('select id from core.frase_dia where id = $1', [idFrasePadrao(A.tenantId, 'P01')])).rowCount).toBe(0);
      expect((await q('select id from core.usuario_avatar where usuario_id = $1', [A.usuarios.analista])).rowCount).toBe(0);
      expect((await q('update core.frase_dia set ativa = false where tenant_id = $1', [A.tenantId])).rowCount).toBe(0);
      await recusa("insert into core.frase_dia (tenant_id, texto, ordem) values ($1, 'Intrusa', 99)", [A.tenantId], '42501', 'row-level security');
    });
    await emTransacao(app, '', async () => {
      expect((await q('select id from core.frase_dia')).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0065 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000065';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill das 30 no tenant que já existia; provisionar_tenant intacto; down volta ao catálogo da 0064; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      const definicao = async () =>
        (await c.query<{ d: string }>("select pg_get_functiondef('plataforma.provisionar_tenant(jsonb)'::regprocedure) as d")).rows[0]!.d;
      await migrarUp(c, { ate: '0064' });
      const antes = await retratoDoCatalogo(c);
      const provisionarAntes = await definicao();
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo65', 'Antigo')", [T]);
      expect((await migrarUp(c, { ate: '0065' })).aplicadas).toEqual(['0065_core_frase_avatar']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('rel core.frase_dia r rls=true force=true');
      expect(depois).toContain('rel core.usuario_avatar r rls=true force=true');
      expect(depois).toContain('trg plataforma.tenant.tenant_semear_frase_dia');
      expect(await definicao()).toBe(provisionarAntes);
      const f = await c.query('select id, texto, ativa, ordem, padrao_codigo from core.frase_dia where tenant_id = $1 order by ordem', [T]);
      expect(f.rows).toEqual(FRASES_PADRAO.map((x, i) => ({ id: idFrasePadrao(T, x.codigo), texto: x.texto, ativa: true, ordem: i + 1, padrao_codigo: x.codigo })));
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0065_core_frase_avatar']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await definicao()).toBe(provisionarAntes);
      await c.query(m65.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0065' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await c.query<{ n: number }>('select count(*)::int as n from core.frase_dia where tenant_id = $1', [T])).rows[0]!.n).toBe(30);
    });
  });
});
