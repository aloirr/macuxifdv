/**
 * 0024 — T-0078 (robustez essencial; pedido R-20261104-232912-engenheiro-software). O que o BANCO garante:
 * - plataforma.resumo_outbox: o macuxi_app (sem contexto de tenant) recebe SÓ as contagens da outbox de todos os tenants
 *   (pendentes, parados, segundos do pendente mais antigo), filtradas pelos nomes pedidos; o worker e PUBLIC não executam.
 * - LGPD (roteiro docs/banco/lgpd.md): anonimizar_usuario, anonimizar_cliente e anonimizar_contato trocam o dado pessoal do
 *   titular, mantêm os ids (histórico fiscal ligado) e não tocam o outro tenant; excluir_tenant apaga TODAS as linhas do tenant
 *   (toda tabela com tenant_id) e a linha do tenant, só com o código certo e o tenant encerrado, sem tocar o outro tenant.
 *   Nenhuma das quatro é executável pelos papéis da aplicação.
 * - 0032 (T-0075, B2 do plano B do DBaaS): excluir_tenant com a mesma assinatura, sem session_replication_role (DELETE em
 *   ordem de FK do catálogo, ciclo core.usuario <-> core.equipe quebrado por UPDATE, gatilhos ligados); vale também para
 *   um papel SEM superusuário que só enxerga as linhas pela política manutencao da 0031 (B1).
 * Banco: fixture dois-tenants, sempre com ROLLBACK (admin); up/down e o caso sem superusuário num banco efêmero. Nada roda
 * em base real.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { comandoSetRole, SQL_PRECISA_SET_ROLE } from '../src/papeis';
import { agoraDaFixture, banco, semBanco } from './estado';
import { carregarFixtureDosTestes } from './fixture-treinamento';
import { emTransacao, erroDe, retratoDoCatalogo, tabelasComTenant } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m24 = migracoes.find((m) => m.versao === '0024')!;
const m32 = migracoes.find((m) => m.versao === '0032')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const FUNCOES_LGPD = [
  'plataforma.anonimizar_usuario(uuid, uuid)',
  'plataforma.anonimizar_cliente(uuid, uuid)',
  'plataforma.anonimizar_contato(uuid, uuid)',
  'plataforma.excluir_tenant(uuid, text)',
];

describe('0024 resumo da outbox e LGPD (estático)', () => {
  it('nome e posição: 0024_plataforma_resumo_outbox_lgpd logo depois da 0023', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0023_core_positivacao_mes') + 1]).toBe('0024_plataforma_resumo_outbox_lgpd');
  });

  it('resumo_outbox: SECURITY DEFINER, search_path com pg_temp, EXECUTE só ao macuxi_app', () => {
    const sql = semComentarios(m24.up);
    expect(sql).toMatch(/create function plataforma\.resumo_outbox\(p_nomes text\[\], p_max_tentativas integer\)\s+returns table \(pendentes integer, parados integer, mais_antigo_s double precision\)\s+language sql stable security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(sql).toContain('revoke all on function plataforma.resumo_outbox(text[], integer) from public;');
    expect([...sql.matchAll(/grant ([^;]+);/g)].map((g) => g[1])).toEqual(['execute on function plataforma.resumo_outbox(text[], integer) to macuxi_app']);
  });

  it('funções da LGPD: invoker (uma só SECURITY DEFINER na migração), search_path fixo, revoke de public, sem grant', () => {
    const sql = semComentarios(m24.up);
    expect(sql.match(/security definer/g)).toHaveLength(1);
    for (const f of FUNCOES_LGPD) expect(sql).toContain(`revoke all on function ${f} from public;`);
    expect(sql.match(/set search_path = pg_catalog, plataforma, pg_temp/g)).toHaveLength(5);
    expect(sql).not.toMatch(/create (table|policy)|alter (table|policy)|drop (table|policy)/);
  });

  it('down apaga as cinco funções (idempotente)', () => {
    for (const f of ['plataforma.resumo_outbox(text[], integer)', ...FUNCOES_LGPD]) expect(m24.down).toContain(`drop function if exists ${f};`);
  });
});

describe('0032 excluir_tenant em ordem de FK (estático, T-0075 B2)', () => {
  /** Texto da função excluir_tenant num SQL (do create até o revoke). */
  const funcao = (sql: string) =>
    /create (?:or replace )?function plataforma\.excluir_tenant[\s\S]*?\n\$\$;\nrevoke all on function plataforma\.excluir_tenant\(uuid, text\) from public;/.exec(sql)?.[0] ?? '';

  it('nome e posição: 0032_plataforma_excluir_tenant_ordem_fk logo depois da 0031 (B1, política de manutenção)', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0031_plataforma_manutencao') + 1]).toBe('0032_plataforma_excluir_tenant_ordem_fk');
  });

  it('mesma assinatura e retorno da 0024, invoker, search_path fixo, revoke de public, sem grant; sem session_replication_role', () => {
    const sql = semComentarios(m32.up);
    expect(sql).toMatch(
      /create or replace function plataforma\.excluir_tenant\(p_tenant uuid, p_codigo text\)\s+returns table \(tabela text, quantidade bigint\)\s+language plpgsql volatile\s+set search_path = pg_catalog, plataforma, pg_temp/,
    );
    expect(semComentarios(m24.up)).toMatch(/create function plataforma\.excluir_tenant\(p_tenant uuid, p_codigo text\)\s+returns table \(tabela text, quantidade bigint\)/);
    expect(sql).not.toMatch(/security definer|session_replication_role|disable trigger|alter table/i);
    expect(sql).toContain('revoke all on function plataforma.excluir_tenant(uuid, text) from public;');
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/create (table|policy)|drop (table|policy|function)/);
    // as mesmas travas da 0024 (códigos de erro)
    for (const c of ["'22004'", "'P0002'", "'22023'", "'55000'"]) expect(sql).toContain(`errcode = ${c}`);
    // ordem de FK pelo catálogo; ciclo quebrado por UPDATE ... = null
    expect(sql).toContain("con.contype = 'f' and con.conparentid = 0");
    expect(sql).toContain("format('update %s set %s where tenant_id = $1 and (%s)'");
  });

  it('down volta exatamente ao corpo da 0024 (com session_replication_role)', () => {
    const da0024 = funcao(m24.up);
    expect(da0024).toContain("perform set_config('session_replication_role', 'replica', true);");
    expect(funcao(m32.down)).toBe(da0024.replace(/^create function/, 'create or replace function'));
  });
});

describe.skipIf(semBanco())('0024 resumo da outbox e LGPD (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  /** Roda fn numa transação do admin com ROLLBACK; o erro vira código SQLSTATE. */
  const codigo = async (fn: () => Promise<unknown>) => (await erroDe(emTransacao(admin, null, fn)))?.code;
  const NOME = 'core.teste_resumo.criado@1';
  const inserirEvento = (tenant: string, segundos: number, tentativas: number, publicado: boolean, nome = NOME) =>
    admin.query(
      `insert into plataforma.evento (tenant_id, nome, modulo, ocorrido_em, tentativas, publicado_em)
       values ($1, $2, split_part($2, '.', 1), now() - make_interval(secs => $3), $4, case when $5 then now() end)`,
      [tenant, nome, segundos, tentativas, publicado],
    );

  it('resumo_outbox: macuxi_app sem contexto recebe só as contagens de todos os tenants, filtradas pelo nome', async () => {
    await emTransacao(admin, null, async () => {
      await inserirEvento(A.tenantId, 120, 0, false);
      await inserirEvento(A.tenantId, 30, 2, false);
      await inserirEvento(B.tenantId, 600, 5, false); // parado (tentativas >= 5): não entra no mais antigo
      await inserirEvento(B.tenantId, 900, 0, true); // publicado: fora
      await inserirEvento(B.tenantId, 999, 0, false, 'core.outro_teste.criado@1'); // outro nome: fora
      await admin.query('set local role macuxi_app');
      const r = await admin.query<{ pendentes: number; parados: number; mais_antigo_s: number | null }>(
        'select pendentes, parados, mais_antigo_s from plataforma.resumo_outbox($1::text[], $2::int)',
        [[NOME], 5],
      );
      expect(r.rows).toHaveLength(1);
      expect(Object.keys(r.rows[0]!).sort()).toEqual(['mais_antigo_s', 'parados', 'pendentes']);
      expect(r.rows[0]!.pendentes).toBe(2);
      expect(r.rows[0]!.parados).toBe(1);
      expect(r.rows[0]!.mais_antigo_s).toBeGreaterThanOrEqual(119);
      expect(r.rows[0]!.mais_antigo_s).toBeLessThan(600);
      // sem a função, o macuxi_app não vê a outbox (RLS sem contexto = 0 linhas)
      expect((await admin.query<{ n: number }>('select count(*)::int as n from plataforma.evento')).rows[0]!.n).toBe(0);
      // lista vazia ou nula: zeros e sem mais antigo
      for (const nomes of [[], null]) {
        const v = await admin.query('select pendentes, parados, mais_antigo_s from plataforma.resumo_outbox($1::text[], 5)', [nomes]);
        expect(v.rows).toEqual([{ pendentes: 0, parados: 0, mais_antigo_s: null }]);
      }
    });
  });

  it('resumo_outbox: worker e um papel qualquer (PUBLIC) não executam', async () => {
    expect(await codigo(async () => {
      await admin.query('set local role macuxi_worker');
      await admin.query("select * from plataforma.resumo_outbox(array['x.y.z@1'], 5)");
    })).toBe('42501');
  });

  it('funções da LGPD: nem macuxi_app nem macuxi_worker executam', async () => {
    const chamadas = [
      ['select * from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, A.usuarios.vendedor1]],
      ['select * from plataforma.anonimizar_cliente($1, $2)', [A.tenantId, A.clientes.c1]],
      ['select * from plataforma.anonimizar_contato($1, $2)', [A.tenantId, A.clientes.c1]],
      ['select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]],
    ] as const;
    for (const papel of ['macuxi_app', 'macuxi_worker']) {
      for (const [sql, params] of chamadas) {
        expect(await codigo(async () => {
          await admin.query(`set local role ${papel}`);
          await admin.query(sql, [...params]);
        }), `${papel}: ${sql}`).toBe('42501');
      }
    }
  });

  it('anonimizar_usuario: troca o dado pessoal, revoga sessões, bloqueia aparelho, tira coordenadas; B intacto', async () => {
    await emTransacao(admin, null, async () => {
      const u = A.usuarios.vendedor1;
      await admin.query(
        "insert into plataforma.auditoria (tenant_id, modulo, acao, entidade, entidade_id, antes, depois) values ($1, 'core', 'usuario.editar', 'usuario', $2, $3, $4)",
        [A.tenantId, u, { email: 'vendedor1@exemplo.com.br' }, { email: 'novo@exemplo.com.br' }],
      );
      const bAntes = (await admin.query('select * from core.usuario where tenant_id = $1 order by id', [B.tenantId])).rows;
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, u]);
      const q = new Map(r.rows.map((x) => [x.item, Number(x.quantidade)]));
      expect(q.get('core.usuario')).toBe(1);
      expect(q.get('core.sessao')).toBeGreaterThanOrEqual(1);
      expect(q.get('core.dispositivo')).toBeGreaterThanOrEqual(1);
      expect(q.get('core.visita')).toBeGreaterThanOrEqual(1);
      expect(q.get('plataforma.auditoria')).toBeGreaterThanOrEqual(1);
      const linha = (await admin.query('select * from core.usuario where tenant_id = $1 and id = $2', [A.tenantId, u])).rows[0];
      expect(linha).toMatchObject({ nome: 'Usuário anonimizado', nome_curto: null, email: `anonimizado-${u}@anonimizado.invalid`, senha_hash: null, external_id: null, ativo: false });
      expect(linha.deleted_at).not.toBeNull();
      expect(linha.bloqueado_em).not.toBeNull();
      const ativas = await admin.query('select count(*)::int as n from core.sessao where tenant_id = $1 and usuario_id = $2 and revogado_em is null', [A.tenantId, u]);
      expect(ativas.rows[0].n).toBe(0);
      const disp = await admin.query('select count(*)::int as n from core.dispositivo where tenant_id = $1 and usuario_id = $2 and (nome is not null or bloqueado_em is null)', [A.tenantId, u]);
      expect(disp.rows[0].n).toBe(0);
      const coord = await admin.query('select count(*)::int as n from core.visita where tenant_id = $1 and usuario_id = $2 and (checkin_lat is not null or checkout_lat is not null)', [A.tenantId, u]);
      expect(coord.rows[0].n).toBe(0);
      const aud = await admin.query("select count(*)::int as n from plataforma.auditoria where tenant_id = $1 and entidade_id = $2 and (antes::text like '%exemplo.com.br%' or depois::text like '%exemplo.com.br%')", [A.tenantId, u]);
      expect(aud.rows[0].n).toBe(0);
      const registro = await admin.query("select count(*)::int as n from plataforma.auditoria where tenant_id = $1 and acao = 'lgpd.anonimizar' and entidade = 'usuario' and entidade_id = $2 and antes is null and depois is null", [A.tenantId, u]);
      expect(registro.rows[0].n).toBe(1);
      // o outro tenant e os outros usuários de A não mudam
      expect((await admin.query('select * from core.usuario where tenant_id = $1 order by id', [B.tenantId])).rows).toEqual(bAntes);
      const outro = (await admin.query('select nome from core.usuario where tenant_id = $1 and id = $2', [A.tenantId, A.usuarios.vendedor2])).rows[0];
      expect(outro.nome).not.toBe('Usuário anonimizado');
    });
  });

  it('anonimizar_usuario: titular de outro tenant ou inexistente = P0002, nada muda', async () => {
    expect(await codigo(() => admin.query('select * from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, B.usuarios.vendedor]))).toBe('P0002');
    expect(await codigo(() => admin.query('select * from plataforma.anonimizar_usuario($1, null)', [A.tenantId]))).toBe('22004');
  });

  it('anonimizar_cliente: cliente, contatos, endereços, coordenadas da visita e payload do ERP; contatos de outro cliente e B intactos', async () => {
    await emTransacao(admin, null, async () => {
      const c = A.clientes.c1;
      const outrosContatos = (await admin.query('select * from core.cliente_contato where tenant_id = $1 and cliente_id <> $2 order by id', [A.tenantId, c])).rows;
      const bContatos = (await admin.query('select * from core.cliente_contato where tenant_id = $1 order by id', [B.tenantId])).rows;
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_cliente($1, $2)', [A.tenantId, c]);
      const q = new Map(r.rows.map((x) => [x.item, Number(x.quantidade)]));
      expect(q.get('core.cliente')).toBe(1);
      expect(q.get('core.cliente_contato')).toBe(2);
      const cli = (await admin.query('select * from core.cliente where tenant_id = $1 and id = $2', [A.tenantId, c])).rows[0];
      expect(cli).toMatchObject({ razao_social: 'Cliente anonimizado', nome_fantasia: null, documento: null, telefone: null, email: null, latitude: null, longitude: null, external_id: null, ativo: false });
      expect(cli.deleted_at).not.toBeNull();
      const contatos = (await admin.query('select nome, cargo, telefone, whatsapp, email from core.cliente_contato where tenant_id = $1 and cliente_id = $2', [A.tenantId, c])).rows;
      expect(contatos).toEqual([
        { nome: 'Contato anonimizado', cargo: null, telefone: null, whatsapp: null, email: null },
        { nome: 'Contato anonimizado', cargo: null, telefone: null, whatsapp: null, email: null },
      ]);
      const end = await admin.query("select count(*)::int as n from core.cliente_endereco where tenant_id = $1 and cliente_id = $2 and (logradouro <> 'Anonimizado' or cep is not null or latitude is not null or deleted_at is null)", [A.tenantId, c]);
      expect(end.rows[0].n).toBe(0);
      const coord = await admin.query('select count(*)::int as n from core.visita where tenant_id = $1 and cliente_id = $2 and (checkin_lat is not null or checkout_lat is not null)', [A.tenantId, c]);
      expect(coord.rows[0].n).toBe(0);
      expect((await admin.query('select * from core.cliente_contato where tenant_id = $1 and cliente_id <> $2 order by id', [A.tenantId, c])).rows).toEqual(outrosContatos);
      expect((await admin.query('select * from core.cliente_contato where tenant_id = $1 order by id', [B.tenantId])).rows).toEqual(bContatos);
    });
  });

  it('anonimizar_cliente: payload do ERP (registro_atual da entidade cliente) é anulado pelo external_id', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query("update core.cliente set external_id = 'CLI-1' where tenant_id = $1 and id = $2", [B.tenantId, B.clientes.c1]);
      await admin.query(`update integracao.registro_atual set payload = '{"razao_social":"Pessoa"}' where tenant_id = $1 and entidade = 'cliente' and external_id = 'CLI-1'`, [B.tenantId]);
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_cliente($1, $2)', [B.tenantId, B.clientes.c1]);
      expect(Number(r.rows.find((x) => x.item === 'integracao.registro_atual')!.quantidade)).toBe(1);
      const p = await admin.query("select count(*)::int as n from integracao.registro_atual where tenant_id = $1 and entidade = 'cliente' and external_id = 'CLI-1' and payload is not null", [B.tenantId]);
      expect(p.rows[0].n).toBe(0);
    });
  });

  it('anonimizar_contato: só aquele contato; de outro tenant = P0002', async () => {
    await emTransacao(admin, null, async () => {
      const contatos = (await admin.query<{ id: string; nome: string }>('select id, nome from core.cliente_contato where tenant_id = $1 order by id', [A.tenantId])).rows;
      const alvo = contatos[0]!;
      await admin.query('select * from plataforma.anonimizar_contato($1, $2)', [A.tenantId, alvo.id]);
      const depois = (await admin.query<{ id: string; nome: string }>('select id, nome from core.cliente_contato where tenant_id = $1 order by id', [A.tenantId])).rows;
      expect(depois).toEqual(contatos.map((k) => (k.id === alvo.id ? { id: k.id, nome: 'Contato anonimizado' } : k)));
    });
    const deB = (await admin.query<{ id: string }>('select id from core.cliente_contato where tenant_id = $1 limit 1', [B.tenantId])).rows[0]!.id;
    expect(await codigo(() => admin.query('select * from plataforma.anonimizar_contato($1, $2)', [A.tenantId, deB]))).toBe('P0002');
  });

  it('excluir_tenant: recusa código errado (22023), tenant ativo (55000) e inexistente (P0002)', async () => {
    expect(await codigo(() => admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [A.tenantId]).then(() => admin.query('select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, B.codigo])))).toBe('22023');
    expect(await codigo(() => admin.query('select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]))).toBe('55000');
    expect(await codigo(() => admin.query("select * from plataforma.excluir_tenant('00000000-0000-4000-8000-000000000000', 'x')"))).toBe('P0002');
  });

  it('excluir_tenant: apaga toda linha do tenant encerrado em toda tabela com tenant_id e o tenant; B idêntico', async () => {
    const contar = async (tenant: string) => {
      const mapa = new Map<string, number>();
      for (const t of await tabelasComTenant(admin)) {
        const r = await admin.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [tenant]);
        mapa.set(t.nome, r.rows[0]!.n);
      }
      return mapa;
    };
    await emTransacao(admin, null, async () => {
      const bAntes = await contar(B.tenantId);
      const aAntes = await contar(A.tenantId);
      await admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [A.tenantId]);
      const r = await admin.query<{ tabela: string; quantidade: string }>('select tabela, quantidade from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]);
      const apagadas = new Map(r.rows.map((x) => [x.tabela, Number(x.quantidade)]));
      expect(apagadas.get('plataforma.tenant')).toBe(1);
      for (const [nome, n] of aAntes) if (n > 0) expect(apagadas.get(nome), nome).toBe(n);
      for (const [nome, n] of await contar(A.tenantId)) expect(n, nome).toBe(0);
      expect((await admin.query('select count(*)::int as n from plataforma.tenant where id = $1', [A.tenantId])).rows[0].n).toBe(0);
      expect(await contar(B.tenantId)).toEqual(bAntes);
      expect((await admin.query("select current_setting('session_replication_role') as v")).rows[0].v).toBe('origin');
      // 0032 (B2): a função instalada não usa session_replication_role (roda sem superusuário) e segue invoker
      const def = await admin.query<{ d: string; definer: boolean }>(
        "select pg_get_functiondef(p.oid) as d, p.prosecdef as definer from pg_proc p where p.oid = 'plataforma.excluir_tenant(uuid,text)'::regprocedure",
      );
      expect(def.rows[0]!.d).not.toContain('session_replication_role');
      expect(def.rows[0]!.definer).toBe(false);
    });
    // ROLLBACK: a fixture volta
    expect((await admin.query('select count(*)::int as n from plataforma.tenant where id = $1', [A.tenantId])).rows[0].n).toBe(1);
  });
});

describe.skipIf(semBanco())('0032 excluir_tenant sem superusuário (banco efêmero, B1 + B2 do DBaaS)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({
      preparar: (c) => carregarFixtureDosTestes(c, { agora: agoraDaFixture() }),
    });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  /**
   * Papel descartável SEM superusuário e sem BYPASSRLS, que não é dono de nada (como o admin do DBaaS diante do FORCE
   * RLS): DML em toda tabela dos schemas com tenant_id e EXECUTE na excluir_tenant; com `manutencao`, membro do
   * macuxi_manutencao (INHERIT). Tudo numa transação desfeita: o papel e os grants somem no ROLLBACK.
   * Admin sem superusuário (DBaaS, PG 16): quem cria o papel ganha só ADMIN OPTION e não pode `set role` nele (3ª execução:
   * "permission denied to set role macuxi_tlgpd_*"); como no garantirPapelDeLogin (B0), o admin recebe a filiação só com
   * SET, sem INHERIT (não herda os grants nem a manutencao do papel). Com superusuário nada muda (a consulta dá false).
   */
  const comoPapelSemSuperusuario = async <T>(manutencao: boolean, fn: (c: pg.Client) => Promise<T>) =>
    comAdmin(b.nome, async (c) => {
      const papel = `macuxi_tlgpd_${randomBytes(4).toString('hex')}`;
      await c.query('begin');
      try {
        await c.query(`create role ${papel} nologin nosuperuser nobypassrls`);
        if (manutencao) await c.query(`grant macuxi_manutencao to ${papel} with inherit true`);
        const set = await c.query<{ precisa: boolean }>(SQL_PRECISA_SET_ROLE, [papel]);
        if (set.rows[0]?.precisa === true) await c.query(comandoSetRole(papel));
        const schemas = (
          await c.query<{ s: string }>(
            `select distinct ns.nspname as s from pg_attribute a join pg_class k on k.oid = a.attrelid join pg_namespace ns on ns.oid = k.relnamespace
              where a.attname = 'tenant_id' and k.relkind in ('r', 'p') and ns.nspname not like 'pg\\_%' and ns.nspname <> 'information_schema'
              union select 'plataforma' order by 1`,
          )
        ).rows.map((x) => c.escapeIdentifier(x.s));
        await c.query(`grant usage on schema ${schemas.join(', ')} to ${papel}`);
        await c.query(`grant select, insert, update, delete on all tables in schema ${schemas.join(', ')} to ${papel}`);
        await c.query(`grant execute on function plataforma.excluir_tenant(uuid, text) to ${papel}`);
        await c.query("update plataforma.tenant set status = 'encerrado' where id = $1", [A.tenantId]);
        await c.query(`set local role ${papel}`);
        const s = await c.query<{ s: string; bypass: boolean }>(
          "select current_setting('is_superuser') as s, (select rolbypassrls from pg_roles where rolname = current_user) as bypass",
        );
        expect(s.rows[0]).toEqual({ s: 'off', bypass: false });
        return await fn(c);
      } finally {
        await c.query('rollback');
      }
    });

  it('com a política manutencao (0031): apaga todas as linhas do tenant A e o tenant, com FKs e gatilhos ligados; B intacto', async () => {
    await comoPapelSemSuperusuario(true, async (c) => {
      const tabelas = await tabelasComTenant(c);
      const contar = async (tenant: string) => {
        let n = 0;
        for (const t of tabelas) n += (await c.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [tenant])).rows[0]!.n;
        return n;
      };
      const aAntes = await contar(A.tenantId);
      const bAntes = await contar(B.tenantId);
      expect(aAntes).toBeGreaterThan(100);
      // a fixture tem o ciclo usuario <-> equipe preenchido (o UPDATE do passo 2 tem o que anular) e conteúdo do Treinamento
      // (os gatilhos *_toca_trilha disparam no DELETE)
      expect((await c.query<{ n: number }>('select count(*)::int as n from core.equipe where tenant_id = $1 and responsavel_id is not null', [A.tenantId])).rows[0]!.n).toBeGreaterThan(0);
      expect((await c.query<{ n: number }>('select count(*)::int as n from treinamento.alternativa where tenant_id = $1', [A.tenantId])).rows[0]!.n).toBeGreaterThan(0);
      const r = await c.query<{ tabela: string; quantidade: string }>('select tabela, quantidade from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]);
      expect(r.rows.at(-1)).toEqual({ tabela: 'plataforma.tenant', quantidade: '1' });
      expect(r.rows.slice(0, -1).reduce((soma, x) => soma + Number(x.quantidade), 0)).toBe(aAntes);
      // filhas antes das mães
      const pos = (t: string) => r.rows.findIndex((x) => x.tabela === t);
      expect(pos('core.sessao')).toBeGreaterThanOrEqual(0);
      expect(pos('core.usuario')).toBeGreaterThan(pos('core.sessao'));
      expect(pos('core.cliente')).toBeGreaterThan(pos('core.carteira'));
      expect(await contar(A.tenantId)).toBe(0);
      expect((await c.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where id = $1', [A.tenantId])).rows[0]!.n).toBe(0);
      expect(await contar(B.tenantId)).toBe(bAntes);
    });
  });

  it('sem a política manutencao: o papel não enxerga o tenant (P0002) e nada é apagado (a 0031 é o que permite a exclusão)', async () => {
    const e = await erroDe(comoPapelSemSuperusuario(false, (c) => c.query('select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo])));
    expect(e?.code).toBe('P0002');
    const n = await comAdmin(b.nome, (c) => c.query<{ n: number }>('select count(*)::int as n from core.usuario where tenant_id = $1', [A.tenantId]));
    expect(n.rows[0]!.n).toBeGreaterThan(0);
  });
});

describe.skipIf(semBanco())('0024 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0024_plataforma_resumo_outbox_lgpd') - 1]!.slice(0, 4);
  const desde0024 = nomes.filter((n) => n >= '0024');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria as funções; down volta exatamente ao catálogo da 0023; up de novo volta ao mesmo catálogo', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0024);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(
        expect.arrayContaining([
          'fn plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)',
          'fn plataforma.anonimizar_usuario(p_tenant uuid, p_usuario uuid)',
          'fn plataforma.anonimizar_cliente(p_tenant uuid, p_cliente uuid)',
          'fn plataforma.anonimizar_contato(p_tenant uuid, p_contato uuid)',
          'fn plataforma.excluir_tenant(p_tenant uuid, p_codigo text)',
        ]),
      );
      expect((await migrarDown(c, { passos: desde0024.length })).aplicadas).toEqual([...desde0024].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m24.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
