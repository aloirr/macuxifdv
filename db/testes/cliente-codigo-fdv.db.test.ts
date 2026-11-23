/**
 * 0098 — Código FDV do cliente (v1.0.30, ADR 0069 item 10 e D.7, decisão "1 B": todo cliente vivo tem código, de qualquer origem;
 * molde da 0080/RN-CORE-59; hint RN-CORE-78). Dicionário: docs/banco/core.md ("0098", Código FDV do cliente). O que o BANCO garante:
 * - core.cliente.codigo_fdv emitido pelo banco no insert de qualquer origem (pré-cadastro do Campo e do BKO e cliente novo da carga
 *   do ERP), em sequência por tenant sem repetir em inserts concorrentes; CHECK cliente_codigo_fdv_vivo (vivo sem código = 23514);
 * - o upsert da carga do ERP sobre o vivo que já existe não gasta número (dez cargas seguidas = contador parado) e trava o vivo
 *   até o fim da transação;
 * - informado no insert fica (backup, substituição do APK v1.0.28), único entre os vivos, só de leitura (23514
 *   cliente_codigo_fdv_somente_leitura), 100000 depois de 99999; contador core.cliente_codigo_fdv_contador (só o gatilho grava,
 *   nunca diminui, piso, ordem do backup);
 * - carga (backfill) de todos os clientes vivos de todas as empresas por created_at, id; apagados nulos; contador no maior número;
 *   o apagado antigo que volta a vivo ganha o próximo número; down e up de novo renumeram igual.
 * O catálogo inteiro da 0098 (up/down) fica em cliente-pre-cadastro-revisao.db.test.ts.
 */
import { setTimeout as esperar } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { CODIGOS_FDV_CLIENTES_FIXTURE, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0098';
const m98 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m98) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m98.up);
const down = semComentarios(m98.down);
const umaLinha = (sql: string) => sql.replace(/\s+/g, ' ');

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const CONTADOR = 'core.cliente_codigo_fdv_contador';
const COLUNAS_CONTADOR = ['id', 'tenant_id', 'ultimo_sequencial', 'created_at', 'updated_at', 'deleted_at', 'external_id'];
const fdv = (n: number) => String(n).padStart(5, '0');
/** O upsert do consumidorClienteDoErp (modules/core/api/consumidores-erp.ts), reduzido às colunas do teste. */
const UPSERT_ERP = `insert into core.cliente (tenant_id, external_id, razao_social, origem_cadastro) values (plataforma.tenant_atual(), $1, $2, 'erp')
  on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set razao_social = excluded.razao_social
  returning id, codigo_fdv`;

/** Erro do Postgres com o nome da constraint, num savepoint do admin (o erro esperado não aborta o caso). */
async function erroComConstraint(admin: pg.ClientBase, sql: string, params: unknown[] = []): Promise<{ code?: string; constraint?: string; hint?: string } | null> {
  await admin.query('savepoint erro_constraint');
  try {
    await admin.query(sql, params);
    await admin.query('release savepoint erro_constraint');
    return null;
  } catch (e) {
    await admin.query('rollback to savepoint erro_constraint');
    const err = e as { code?: string; constraint?: string; hint?: string };
    return { code: err.code, constraint: err.constraint, hint: err.hint };
  }
}

describe('0098 Código FDV do cliente (estático)', () => {
  it('coluna, CHECK de formato (o da 0080), CHECK cliente_codigo_fdv_vivo sem o de origem, único entre os vivos, grant e Drizzle', () => {
    const u = umaLinha(up);
    expect(up).toContain('alter table core.cliente add column codigo_fdv text;');
    expect(u).toContain(
      "add constraint cliente_codigo_fdv_formato check (codigo_fdv is null or codigo_fdv ~ '^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$');",
    );
    const m80 = migracoes.find((m) => m.versao === '0080')!;
    const formato = (sql: string, nome: string) => new RegExp(`${nome} check \\(codigo_fdv is null or codigo_fdv ~ '([^']+)'\\)`).exec(umaLinha(sql))![1];
    expect(formato(up, 'cliente_codigo_fdv_formato')).toBe(formato(m80.up, 'usuario_codigo_fdv_formato'));
    expect(u).toContain('alter table core.cliente add constraint cliente_codigo_fdv_vivo check (deleted_at is not null or codigo_fdv is not null);');
    expect(up).not.toContain('cliente_codigo_fdv_origem');
    expect(u).toContain('create unique index cliente_codigo_fdv_uk on core.cliente (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null;');
    expect(up).toContain('grant select (codigo_fdv) on core.cliente to macuxi_leitura;');
    expect(Object.keys(nuvemCore.cliente)).toContain('codigo_fdv');
  });

  it('contador próprio (RLS, app e leitura só leem, nunca diminui, piso), fora do sync e Drizzle', () => {
    const u = umaLinha(up);
    expect(up).toContain(`create table ${CONTADOR} (`);
    expect(u).toContain('constraint cliente_codigo_fdv_contador_tenant_uk unique (tenant_id)');
    expect(u).toContain('constraint cliente_codigo_fdv_contador_nao_negativo check (ultimo_sequencial >= 0)');
    expect(up).toContain(`alter table ${CONTADOR} force row level security;`);
    expect(up).toContain(`grant select on ${CONTADOR} to macuxi_app;`);
    expect(up).toContain(`grant select on ${CONTADOR} to macuxi_leitura;`);
    expect(up).not.toMatch(new RegExp(`grant [^;]*(insert|update|delete)[^;]* on ${CONTADOR.replace('.', '\\.')}`));
    expect(u).toContain(`create trigger cliente_codigo_fdv_contador_nao_diminui before update on ${CONTADOR}`);
    expect(u).toContain(`create trigger cliente_codigo_fdv_contador_piso before insert on ${CONTADOR}`);
    expect(up).toContain("constraint = 'cliente_codigo_fdv_contador_nao_diminui'");
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(CONTADOR);
    expect(Object.keys(nuvemCore.clienteCodigoFdvContador).filter((k) => COLUNAS_CONTADOR.includes(k)).sort()).toEqual([...COLUNAS_CONTADOR].sort());
  });

  it('função DEFINER dos 2 gatilhos: qualquer origem, procura o vivo do mesmo external_id antes de emitir; carga de todos os vivos antes dos gatilhos e do CHECK', () => {
    const u = umaLinha(up);
    expect(u).toMatch(/create function core\.cliente_codigo_fdv\(\) returns trigger language plpgsql security definer set search_path = pg_catalog, core, plataforma, pg_temp/);
    expect(up).toContain('revoke all on function core.cliente_codigo_fdv() from public;');
    expect(u).toContain('create trigger cliente_codigo_fdv_emitir before insert on core.cliente for each row execute function core.cliente_codigo_fdv();');
    expect(u).toContain('create trigger cliente_codigo_fdv_somente_leitura before update on core.cliente for each row execute function core.cliente_codigo_fdv();');
    expect(u).toContain("constraint = 'cliente_codigo_fdv_somente_leitura', schema = tg_table_schema, table = tg_table_name, column = 'codigo_fdv', hint = 'RN-CORE-78'");
    // nenhuma exceção por origem (decisão 1 B)
    expect(up.slice(up.indexOf('create function core.cliente_codigo_fdv()'))).not.toMatch(/origem_cadastro/);
    expect(u).toContain(
      'select c.codigo_fdv into v_existente from core.cliente c where c.tenant_id = new.tenant_id and c.external_id = new.external_id and c.deleted_at is null for no key update;',
    );
    expect(u).toContain("plataforma.uuid_de_chave(new.tenant_id::text || ':core.cliente_codigo_fdv_contador')");
    expect(u).toContain("lpad(v_n::text, greatest(5, length(v_n::text)), '0')");
    expect(u).toContain('row_number() over (partition by c.tenant_id order by c.created_at, c.id) as n from core.cliente c where c.deleted_at is null )');
    const carga = up.indexOf('set codigo_fdv = lpad(');
    expect(carga).toBeLessThan(up.indexOf('add constraint cliente_codigo_fdv_vivo'));
    expect(up.indexOf('add constraint cliente_codigo_fdv_vivo')).toBeLessThan(up.indexOf('create trigger cliente_codigo_fdv_emitir'));
    expect(carga).toBeLessThan(up.indexOf('create trigger cliente_codigo_fdv_somente_leitura'));
    expect(u).toContain('c.tenant_id, max(c.codigo_fdv::bigint) from core.cliente c where c.codigo_fdv is not null group by c.tenant_id;');
    // não divide a numeração com o usuário
    expect(up).not.toMatch(/usuario_codigo_fdv/);
  });

  it('down apaga gatilhos, função, contador, índice, CHECKs e coluna, antes do resto', () => {
    for (const x of [
      'drop trigger if exists cliente_codigo_fdv_emitir on core.cliente;',
      'drop trigger if exists cliente_codigo_fdv_somente_leitura on core.cliente;',
      'drop function if exists core.cliente_codigo_fdv();',
      `drop table if exists ${CONTADOR};`,
      'drop function if exists core.cliente_codigo_fdv_contador_nao_diminui();',
      'drop function if exists core.cliente_codigo_fdv_contador_piso();',
      'drop index if exists core.cliente_codigo_fdv_uk;',
      'alter table core.cliente drop constraint if exists cliente_codigo_fdv_vivo;',
      'alter table core.cliente drop constraint if exists cliente_codigo_fdv_formato;',
      'alter table core.cliente drop column if exists codigo_fdv;',
    ]) expect(down).toContain(x);
    expect(down).not.toContain('cliente_codigo_fdv_origem');
    expect(down.indexOf('drop column if exists codigo_fdv')).toBeLessThan(down.indexOf('cliente_fila_erp'));
  });
});

describe.skipIf(semBanco())('0098 Código FDV do cliente (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const comoApp = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_app', sql, p, t).then((r) => r.rows);
  const PRE = 'insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro, codigo_fdv, deleted_at) values ($1, $2, $3, $4, $5, $6) returning id, codigo_fdv';
  const novo = async (t: string, nome: string, origem = 'campo', codigo: string | null = null, apagado = false) =>
    (await comoApp(t, PRE, [t, nome, origem, origem === 'erp' ? null : 'pendente', codigo, apagado ? new Date().toISOString() : null]))[0] as { id: string; codigo_fdv: string | null }; // hora-fixa-ok: só marca apagado
  const doErp = async (t: string, ext: string, nome: string) => (await comoApp(t, UPSERT_ERP, [ext, nome]))[0] as { id: string; codigo_fdv: string };
  const contador = async (t: string) => (await q<{ n: number }>(`select ultimo_sequencial::int as n from ${CONTADOR} where tenant_id = $1`, [t]))[0]?.n ?? 0;

  it('fixture: todo cliente vivo tem Código FDV (CODIGOS_FDV_CLIENTES_FIXTURE); contador de A em 3 e de B em 1', async () => {
    for (const t of ['A', 'B'] as const) {
      const clientes = DOIS_TENANTS[t].clientes as Record<string, string>;
      for (const [nome, id] of Object.entries(clientes)) {
        const esperado = (CODIGOS_FDV_CLIENTES_FIXTURE[t] as Record<string, string>)[nome];
        expect((await q<{ codigo_fdv: string | null }>('select codigo_fdv from core.cliente where id = $1', [id]))[0]!.codigo_fdv, `${t}.${nome}`).toBe(esperado);
      }
    }
    expect(await contador(A.tenantId)).toBe(3);
    expect(await contador(B.tenantId)).toBe(1);
    expect((await q<{ n: number }>('select count(*)::int as n from core.cliente where deleted_at is null and codigo_fdv is null'))[0]!.n).toBe(0);
  });

  it('pré-cadastro do Campo e do BKO e cliente novo do ERP ganham o próximo número do tenant; B tem numeração própria; o do usuário não anda', async () => {
    await emTransacao(admin, null, async () => {
      const doUsuario = async () => (await q<{ n: number }>('select ultimo_sequencial::int as n from core.usuario_codigo_fdv_contador where tenant_id = $1', [A.tenantId]))[0]?.n;
      const usuarioAntes = await doUsuario();
      const baseA = await contador(A.tenantId);
      const baseB = await contador(B.tenantId);
      expect((await novo(A.tenantId, 'Pré Campo')).codigo_fdv).toBe(fdv(baseA + 1));
      expect((await novo(A.tenantId, 'Pré BKO', 'bko')).codigo_fdv).toBe(fdv(baseA + 2));
      expect((await doErp(A.tenantId, 'ERP-FDV-1', 'Do ERP')).codigo_fdv).toBe(fdv(baseA + 3));
      expect((await novo(A.tenantId, 'ERP sem external_id', 'erp')).codigo_fdv).toBe(fdv(baseA + 4));
      expect((await novo(B.tenantId, 'Pré Beta')).codigo_fdv).toBe(fdv(baseB + 1));
      expect(await contador(A.tenantId)).toBe(baseA + 4);
      expect(await contador(B.tenantId)).toBe(baseB + 1);
      expect(await doUsuario()).toBe(usuarioAntes);
    });
  });

  it('carga do ERP repetida não gasta número: dez upserts do mesmo cliente = mesmo código e contador parado; o update não mexe no código', async () => {
    await emTransacao(admin, null, async () => {
      const primeiro = await doErp(A.tenantId, 'ERP-FDV-REP', 'Repetido 0');
      const depois = await contador(A.tenantId);
      for (let i = 1; i <= 10; i++) {
        const r = await doErp(A.tenantId, 'ERP-FDV-REP', `Repetido ${i}`);
        expect(r).toEqual(primeiro);
      }
      expect(await contador(A.tenantId)).toBe(depois);
      expect((await q<{ razao_social: string; codigo_fdv: string }>('select razao_social, codigo_fdv from core.cliente where id = $1', [primeiro.id]))[0]).toEqual({
        razao_social: 'Repetido 10', codigo_fdv: primeiro.codigo_fdv,
      });
      // o mesmo external_id em B é outro cliente, com o número de B
      const baseB = await contador(B.tenantId);
      expect((await doErp(B.tenantId, 'ERP-FDV-REP', 'Repetido em B')).codigo_fdv).toBe(fdv(baseB + 1));
      // insert simples (sem on conflict) com o external_id de um vivo: o único do external_id recusa, sem gastar número
      const r = await erroComConstraint(admin, "insert into core.cliente (tenant_id, external_id, razao_social, origem_cadastro) values ($1, 'ERP-FDV-REP', 'Dup', 'erp')", [A.tenantId]);
      expect(r).toMatchObject({ code: '23505', constraint: 'cliente_external_uk' });
      expect(await contador(A.tenantId)).toBe(depois);
    });
  });

  it('cliente_codigo_fdv_vivo: vivo sem código = 23514 (gatilho desligado na transação); apagado sem código passa', async () => {
    await emTransacao(admin, null, async () => {
      await q('alter table core.cliente disable trigger cliente_codigo_fdv_emitir');
      const ins = (apagado: boolean) =>
        erroComConstraint(admin, "insert into core.cliente (tenant_id, razao_social, origem_cadastro, deleted_at) values ($1, 'Sem código', 'erp', $2)", [A.tenantId, apagado ? new Date() : null]); // hora-fixa-ok: só marca apagado
      expect(await ins(false)).toMatchObject({ code: '23514', constraint: 'cliente_codigo_fdv_vivo' });
      expect(await ins(true)).toBeNull();
    });
  });

  it('só de leitura: trocar, apagar ou dar código = 23514 cliente_codigo_fdv_somente_leitura (hint RN-CORE-78); outras colunas passam', async () => {
    await emTransacao(admin, null, async () => {
      const p = await novo(A.tenantId, 'Pré Leitura');
      const upd = (set: string, id = p.id) => erroComConstraint(admin, `update core.cliente set ${set} where id = '${id}'`);
      const leitura = { code: '23514', constraint: 'cliente_codigo_fdv_somente_leitura', hint: 'RN-CORE-78' };
      expect(await upd("codigo_fdv = '99999'")).toEqual(leitura);
      expect(await upd('codigo_fdv = null')).toEqual(leitura);
      expect(await upd("codigo_fdv = '00009'", A.clientes.c1)).toEqual(leitura); // cliente do ERP também
      expect(await upd(`codigo_fdv = '${p.codigo_fdv}'`)).toBeNull(); // o mesmo valor
      expect(await upd("razao_social = 'Pré Leitura 2', status_cadastro = 'recusado', motivo_recusa = 'x'")).toBeNull();
      expect(await upd("origem_cadastro = 'erp', status_cadastro = null, motivo_recusa = null")).toBeNull(); // origem não importa mais
      const app = await erroDe(comoApp(A.tenantId, "update core.cliente set codigo_fdv = '77777' where id = $1", [p.id]));
      expect(app?.code).toBe('23514');
    });
  });

  it('informado no insert fica (substituição do APK v1.0.28: X herda o código de Y apagado); único entre os vivos; formato; contador sobe', async () => {
    await emTransacao(admin, null, async () => {
      const y = await novo(A.tenantId, 'Recusado Y');
      await q('update core.cliente set deleted_at = now() where id = $1', [y.id]); // hora-fixa-ok: só apaga
      const x = await novo(A.tenantId, 'Substituto X', 'campo', y.codigo_fdv);
      expect(x.codigo_fdv).toBe(y.codigo_fdv);
      expect((await q<{ codigo_fdv: string }>('select codigo_fdv from core.cliente where id = $1', [y.id]))[0]!.codigo_fdv).toBe(y.codigo_fdv); // o apagado mantém
      const ins = (codigo: string | null, origem = 'campo') => erroComConstraint(admin, PRE, [A.tenantId, 'Outro', origem, origem === 'erp' ? null : 'pendente', codigo, null]);
      expect(await ins(y.codigo_fdv)).toMatchObject({ code: '23505', constraint: 'cliente_codigo_fdv_uk' });
      for (const ruim of ['00000', '000001', '0100000', '1234', 'A0001']) expect((await ins(ruim))?.constraint, ruim).toBe('cliente_codigo_fdv_formato');
      const antes = await contador(A.tenantId);
      const alto = antes + 50;
      expect(await ins(fdv(alto), 'erp')).toBeNull(); // informado também no cliente do ERP
      expect(await contador(A.tenantId)).toBe(alto);
      expect((await novo(A.tenantId, 'Depois do alto')).codigo_fdv).toBe(fdv(alto + 1));
      // linha já apagada sem código (backup) fica sem código e não gasta número; volta a viva com o próximo
      const morto = await novo(A.tenantId, 'Apagado do backup', 'erp', null, true);
      expect(morto.codigo_fdv).toBeNull();
      expect(await contador(A.tenantId)).toBe(alto + 1);
      expect((await q<{ codigo_fdv: string }>('update core.cliente set deleted_at = null where id = $1 returning codigo_fdv', [morto.id]))[0]!.codigo_fdv).toBe(fdv(alto + 2));
    });
  });

  it('passa de 99999 para 100000; o contador nunca diminui (23514); o app não escreve no contador; B não vê o de A; leitura lê o código', async () => {
    await emTransacao(admin, null, async () => {
      await q(`update ${CONTADOR} set ultimo_sequencial = greatest(ultimo_sequencial, 99998) where tenant_id = $1`, [A.tenantId]);
      expect((await novo(A.tenantId, 'Último de 5')).codigo_fdv).toBe('99999');
      expect((await doErp(A.tenantId, 'ERP-6-DIGITOS', 'Primeiro de 6')).codigo_fdv).toBe('100000');
      expect(await erroComConstraint(admin, `update ${CONTADOR} set ultimo_sequencial = 1 where tenant_id = $1`, [A.tenantId])).toMatchObject({
        code: '23514', constraint: 'cliente_codigo_fdv_contador_nao_diminui', hint: 'RN-CORE-78',
      });
      expect((await erroDe(comoApp(A.tenantId, `update ${CONTADOR} set ultimo_sequencial = ultimo_sequencial + 1`)))?.code).toBe('42501');
      expect((await erroDe(comoApp(A.tenantId, `insert into ${CONTADOR} (tenant_id) values ($1)`, [A.tenantId])))?.code).toBe('42501');
      expect(await comoApp(B.tenantId, `select tenant_id from ${CONTADOR} where tenant_id = $1`, [A.tenantId])).toEqual([]);
      expect((await comoApp(A.tenantId, `select ultimo_sequencial::int as n from ${CONTADOR}`))[0]).toEqual({ n: 100000 });
      const r = await comoPapel(admin, 'macuxi_leitura', "select codigo_fdv from core.cliente where codigo_fdv = '100000'", [], A.tenantId);
      expect(r.rows).toEqual([{ codigo_fdv: '100000' }]);
      expect((await comoPapel(admin, 'macuxi_leitura', `select ultimo_sequencial::int as n from ${CONTADOR}`, [], A.tenantId)).rows).toEqual([{ n: 100000 }]);
    });
  });
});

describe.skipIf(semBanco())('0098 Código FDV do cliente (banco efêmero: carga, up/down, concorrência)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('carga: todos os vivos de todas as empresas por created_at, id (o id desempata); apagados nulos; contador no maior; volta de apagado; down e up de novo iguais', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const t1 = '98fd0000-0000-4000-8000-000000000001';
      const t2 = '98fd0000-0000-4000-8000-000000000002';
      const t3 = '98fd0000-0000-4000-8000-000000000003';
      for (const [id, codigo] of [[t1, 'fdv98a'], [t2, 'fdv98b'], [t3, 'fdv98c']] as const) {
        await c.query('insert into plataforma.tenant (id, codigo, nome) values ($1, $2, $2)', [id, codigo]);
      }
      const ins = `insert into core.cliente (id, tenant_id, razao_social, origem_cadastro, status_cadastro, external_id, deleted_at, created_at, updated_at)
                   values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`;
      const cliente = async (id: string, t: string, origem: string, criado: string, ext: string | null = null, apagado = false) =>
        c.query(ins, [id, t, id.slice(-4), origem, origem === 'erp' ? null : 'pendente', ext, apagado ? new Date() : null, criado]); // hora-fixa-ok: só marca apagado
      const id = (t: number, n: number) => `98fd${String(t).padStart(4, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
      // t1: carga do ERP com o mesmo created_at (o id desempata, inserido fora de ordem), um pré-cadastro antes, um apagado no meio
      await cliente(id(1, 3), t1, 'erp', '2026-01-02T00:00:00Z', 'E3');
      await cliente(id(1, 1), t1, 'erp', '2026-01-02T00:00:00Z', 'E1');
      await cliente(id(1, 2), t1, 'erp', '2026-01-02T00:00:00Z', 'E2');
      await cliente(id(1, 9), t1, 'campo', '2026-01-01T00:00:00Z');
      await cliente(id(1, 5), t1, 'erp', '2026-01-01T12:00:00Z', 'E5', true);
      await cliente(id(1, 6), t1, 'bko', '2026-01-03T00:00:00Z');
      // t2: só ERP; t3: só apagados (fica sem linha no contador)
      await cliente(id(2, 1), t2, 'erp', '2026-02-01T00:00:00Z', 'F1');
      await cliente(id(2, 2), t2, 'erp', '2026-02-02T00:00:00Z', 'F2');
      await cliente(id(3, 1), t3, 'campo', '2026-03-01T00:00:00Z', null, true);

      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m98.nome}`]);
      const esperado = {
        [id(1, 9)]: '00001', [id(1, 1)]: '00002', [id(1, 2)]: '00003', [id(1, 3)]: '00004', [id(1, 6)]: '00005', [id(1, 5)]: null,
        [id(2, 1)]: '00001', [id(2, 2)]: '00002', [id(3, 1)]: null,
      };
      const codigos = async () =>
        Object.fromEntries((await c.query<{ id: string; codigo_fdv: string | null }>('select id, codigo_fdv from core.cliente where tenant_id in ($1, $2, $3)', [t1, t2, t3])).rows.map((r) => [r.id, r.codigo_fdv]));
      expect(await codigos()).toEqual(esperado);
      const contadores = async () =>
        Object.fromEntries((await c.query<{ tenant_id: string; n: number }>(`select tenant_id, ultimo_sequencial::int as n from ${CONTADOR} where tenant_id in ($1, $2, $3)`, [t1, t2, t3])).rows.map((r) => [r.tenant_id, r.n]));
      expect(await contadores()).toEqual({ [t1]: 5, [t2]: 2 });
      const idContador = (await c.query<{ id: string }>(`select id from ${CONTADOR} where tenant_id = $1`, [t1])).rows[0]!.id;
      expect(idContador).toBe((await c.query<{ id: string }>("select plataforma.uuid_de_chave($1::text || ':core.cliente_codigo_fdv_contador') as id", [t1])).rows[0]!.id);
      // o updated_at de todo vivo andou (o pull leva o código); o do apagado não
      const andou = (await c.query<{ id: string; andou: boolean }>("select id, updated_at > now() - interval '1 hour' as andou from core.cliente where tenant_id = $1", [t1])).rows; // hora-fixa-ok: a carga grava now() no updated_at
      expect(Object.fromEntries(andou.map((r) => [r.id, r.andou]))).toMatchObject({ [id(1, 1)]: true, [id(1, 9)]: true, [id(1, 5)]: false });

      await c.query('begin');
      try {
        // o apagado antigo que volta a vivo ganha o próximo número (de qualquer origem); o de t3 nasce o contador
        expect((await c.query('update core.cliente set deleted_at = null where id = $1 returning codigo_fdv', [id(1, 5)])).rows[0]!.codigo_fdv).toBe('00006');
        expect((await c.query('update core.cliente set deleted_at = null where id = $1 returning codigo_fdv', [id(3, 1)])).rows[0]!.codigo_fdv).toBe('00001');
        expect(await contadores()).toEqual({ [t1]: 6, [t2]: 2, [t3]: 1 });
        // carga do ERP sobre o que já existe não gasta número; o cliente novo do ERP ganha o próximo
        await c.query("select set_config('app.tenant_id', $1, true)", [t2]);
        expect((await c.query(UPSERT_ERP, ['F1', 'De novo'])).rows[0]!.codigo_fdv).toBe('00001');
        expect((await c.query(UPSERT_ERP, ['F3', 'Novo'])).rows[0]!.codigo_fdv).toBe('00003');
        expect(await contadores()).toEqual({ [t1]: 6, [t2]: 3, [t3]: 1 });
      } finally {
        await c.query('rollback');
      }

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m98.nome}`]);
      expect((await c.query("select 1 from information_schema.columns where table_schema = 'core' and table_name = 'cliente' and column_name = 'codigo_fdv'")).rowCount).toBe(0);
      await migrarUp(c, { ate: VERSAO });
      expect(await codigos()).toEqual(esperado);
      expect(await contadores()).toEqual({ [t1]: 5, [t2]: 2 });
    });
  });

  it('concorrência: inserts simultâneos não repetem número (com e sem a linha do contador); carga do ERP trava o vivo; ordem do backup; piso', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: VERSAO });
      const ordem = new Map((await c.query<{ tabela: string; ordem: number }>('select tabela, ordem from plataforma.ordem_do_backup()')).rows.map((r) => [r.tabela, r.ordem]));
      expect(ordem.get(CONTADOR)!).toBeLessThan(ordem.get('core.cliente')!);
    });
    const c1 = new pg.Client({ connectionString: b.urlAdmin });
    const c2 = new pg.Client({ connectionString: b.urlAdmin });
    await c1.connect();
    await c2.connect();
    try {
      const T = '98fd0000-0000-4000-8000-0000000000c1';
      await c1.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'conc98fdv', 'Concorrência')", [T]);
      const ins = (c: pg.Client, nome: string, origem: string) =>
        c.query<{ codigo_fdv: string }>('insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro) values ($1, $2, $3, $4) returning codigo_fdv', [
          T, nome, origem, origem === 'erp' ? null : 'pendente',
        ]);
      /** O 2º comando começa com o 1º aberto, espera (não termina em 300 ms) e só anda depois do commit do 1º. */
      const emFila = async (rotulo: string, primeiro: () => Promise<string>, segundo: () => Promise<string>): Promise<string[]> => {
        await c1.query('begin');
        await c2.query('begin');
        await c1.query("select set_config('app.tenant_id', $1, true)", [T]);
        await c2.query("select set_config('app.tenant_id', $1, true)", [T]);
        const a = await primeiro();
        let pronto = false;
        const p2 = segundo().then((r) => {
          pronto = true;
          return r;
        });
        await esperar(300);
        expect(pronto, `${rotulo}: o 2º espera o 1º`).toBe(false);
        await c1.query('commit');
        const r2 = await p2;
        await c2.query('commit');
        return [a, r2];
      };
      const emitidos: string[] = [];
      for (const [rodada, origem] of [[1, 'campo'], [2, 'erp']] as const) {
        emitidos.push(...(await emFila(`rodada ${rodada}`, async () => (await ins(c1, `A${rodada}`, origem)).rows[0]!.codigo_fdv, async () => (await ins(c2, `B${rodada}`, origem)).rows[0]!.codigo_fdv)));
      }
      expect(emitidos).toEqual(['00001', '00002', '00003', '00004']);

      // duas cargas do mesmo cliente novo ao mesmo tempo: um cliente só, sem repetir número (no máximo um buraco)
      const novoErp = await emFila(
        'carga do mesmo cliente novo',
        async () => (await c1.query(UPSERT_ERP, ['X-NOVO', 'Carga 1'])).rows[0]!.codigo_fdv,
        async () => (await c2.query(UPSERT_ERP, ['X-NOVO', 'Carga 2'])).rows[0]!.codigo_fdv,
      );
      expect(novoErp).toEqual(['00005', '00005']);
      expect((await c1.query("select count(*)::int as n from core.cliente where tenant_id = $1 and external_id = 'X-NOVO'", [T])).rows[0]!.n).toBe(1);
      expect((await c1.query<{ n: number }>(`select ultimo_sequencial::int as n from ${CONTADOR} where tenant_id = $1`, [T])).rows[0]!.n).toBe(6); // o buraco aceito

      // a carga do ERP sobre o vivo o trava até o fim da transação: apagar o mesmo cliente espera
      const apagado = await emFila(
        'apagar durante a carga',
        async () => (await c1.query(UPSERT_ERP, ['X-NOVO', 'Carga 3'])).rows[0]!.codigo_fdv,
        async () => (await c2.query("update core.cliente set deleted_at = now() where tenant_id = $1 and external_id = 'X-NOVO' returning codigo_fdv", [T])).rows[0]!.codigo_fdv, // hora-fixa-ok: só apaga
      );
      expect(apagado).toEqual(['00005', '00005']);

      // piso: sem a linha do contador (backup restaurado sem ela), o próximo parte do maior código gravado (vivo ou apagado)
      await c1.query('begin');
      try {
        await c1.query(`delete from ${CONTADOR} where tenant_id = $1`, [T]);
        expect((await ins(c1, 'Depois do piso', 'campo')).rows[0]!.codigo_fdv).toBe('00006'); // maior gravado: 00005 (apagado)
      } finally {
        await c1.query('rollback');
      }
    } finally {
      await c1.end();
      await c2.end();
    }
  });
});
