/**
 * 0109 — troca de leitura dos perfis (plano docs/banco/plano-migracao-perfis-sem-base.md §5 passo 2, §4.1 a §4.4; ADR 0073 E6).
 * O que o BANCO garante:
 * - PROVA de que nenhum usuário perde acesso: para cada usuário das fixtures (dois-tenants, demo, um tenant com perfis
 *   personalizados e um com conflito), a permissão efetiva antes da 0109 (permissoes_legado_do_perfil com os 2 parâmetros, a
 *   gêmea de resolverPerfil) = a de depois (perfil_do_usuario, pelo macuxi_app), por chave, nível e alvos; o "admin com gestão",
 *   o admin do portal e as licenças em uso também não mudam;
 * - o tenant sem conflito passa a 'concessao'; o com conflito 'para_tenant' fica em 'legado' com os conflitos gravados;
 * - idempotência: rodar ligar_leitura_por_concessao de novo dá a mesma contagem e o mesmo hash (concessões, catalogo_aplicado e
 *   achados, com o updated_at);
 * - up -> down -> up: o down volta todo tenant a 'legado', as funções recriadas como cópia exata (texto e ACL) e as novas saem; o
 *   perfil mudado pela "API nova" recebe as sobreposições recalculadas (o acesso por usuário fica o que a concessão dava);
 * - db/scripts/diagnostico-0109.sql (só leitura, antes da 0109) prevê o resultado de cada tenant;
 * - uma DIFERENCA na conferência §4.1 para a troca com 23514 (perfis_sem_base_conferencia) e o tenant fica em 'legado';
 * - tenant novo nasce em 'concessao'; último admin pela gestão do acesso; RLS e isolamento entre tenants.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carregarDemo, TENANT_DEMO } from '../seeds/demo/demo';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, agoraDaFixture, semBanco } from './estado';
import { carregarFixtureDosTestes } from './fixture-treinamento';
import { achados, leitura, normalizar, retratoConcessoes, type Permissoes } from './perfis-sem-base-apoio';
import { emTransacao, erroDe, HASH_TESTE } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const TP = 'cccccccc-0109-4000-8000-00000000a001'; // perfis personalizados
const TC = 'cccccccc-0109-4000-8000-00000000a002'; // conflito que para o tenant
const P = {
  vendX: 'cccccccc-0109-4000-8000-00000000b001', // base vendedor: escopo proprio, sem produto.consultar
  analX: 'cccccccc-0109-4000-8000-00000000b002', // base analista: senha.redefinir [vendedor, promotor]
  supDoVend: 'cccccccc-0109-4000-8000-00000000b003', // TC: base vendedor, cargo supervisor, com usuário
};
const U = {
  admin: 'cccccccc-0109-4000-8000-00000000c001',
  vend: 'cccccccc-0109-4000-8000-00000000c002',
  prom: 'cccccccc-0109-4000-8000-00000000c003',
  sup: 'cccccccc-0109-4000-8000-00000000c004',
  anal: 'cccccccc-0109-4000-8000-00000000c005',
  cAdmin: 'cccccccc-0109-4000-8000-00000000c101',
  cVend: 'cccccccc-0109-4000-8000-00000000c102',
};
const FUNCOES = [
  'perfis_do_usuario', // a 0109 não muda (RD-3732): o texto é o mesmo antes, depois do up e depois do down
  'usuario_admin_com_gestao', 'tenant_tem_admin_com_gestao', 'usuario_tem_perfil_admin', 'licencas_em_uso', 'tenant_semear_concessoes',
  'usuario_conferir_acesso', 'usuario_perfil_conferir', 'perfil_conferir', // os 3 gatilhos do último admin (0041, DEFINER da 0049)
];
const NOVAS = ['perfil_do_usuario', 'permissoes_efetivas_do_perfil', 'perfil_com_gestao_na_transacao', 'ligar_leitura_por_concessao', 'perfil_concessao_conferir'];

type Q = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
const consulta = (c: pg.ClientBase): Q => async (sql, params = []) => (await c.query(sql, params)).rows;

interface Acesso {
  tenant: string;
  usuario: string;
  permissoes: Permissoes;
  admin: boolean;
  portal: boolean;
}

/** Acesso de cada usuário vivo: 'legado' pela gêmea de resolverPerfil (antes da 0109); 'efetivo' pelo caminho duplo (0109). */
async function acessos(c: pg.ClientBase, fonte: 'legado' | 'efetivo'): Promise<Acesso[]> {
  const expr = fonte === 'legado' ? 'plataforma.permissoes_legado_do_perfil(p.id, true)' : 'plataforma.permissoes_efetivas_do_perfil(p.id)';
  const r = await c.query<{ tenant: string; usuario: string; permissoes: Permissoes; admin: boolean; portal: boolean }>(
    `select u.tenant_id as tenant, u.id as usuario, ${expr} as permissoes,
            plataforma.usuario_admin_com_gestao(u.tenant_id, u.id) as admin, plataforma.usuario_tem_perfil_admin(u.tenant_id, u.id) as portal
       from core.usuario u
       join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
       join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
      where u.deleted_at is null
      order by u.tenant_id, u.id`,
  );
  return r.rows.map((l) => ({ ...l, permissoes: normalizar(l.permissoes) }));
}

/** perfil_do_usuario pelo macuxi_app, no tenant do usuário (o que a API lê). */
async function pelaApi(url: string, lista: readonly Acesso[]): Promise<Acesso[]> {
  const app = new pg.Client({ connectionString: url });
  await app.connect();
  try {
    const saida: Acesso[] = [];
    for (const a of lista) {
      const r = await emTransacao(app, a.tenant, async () =>
        (await app.query<{ permissoes: Permissoes; leitura: string }>('select permissoes, leitura from plataforma.perfil_do_usuario($1)', [a.usuario])).rows);
      expect(r, a.usuario).toHaveLength(1);
      saida.push({ ...a, permissoes: normalizar(r[0]!.permissoes) });
    }
    return saida;
  } finally {
    await app.end();
  }
}

async function licencas(c: pg.ClientBase): Promise<Record<string, unknown>> {
  const r = await c.query<{ t: string; l: unknown }>(
    "select t.id as t, (select jsonb_object_agg(item, em_uso) from plataforma.licencas_em_uso(t.id)) as l from plataforma.tenant t order by t.id",
  );
  return Object.fromEntries(r.rows.map((x) => [x.t, x.l]));
}

async function leituras(c: pg.ClientBase): Promise<Record<string, string>> {
  const r = await c.query<{ t: string; l: string }>('select t.id as t, plataforma.leitura_de_perfis(t.id) as l from plataforma.tenant t order by t.id');
  return Object.fromEntries(r.rows.map((x) => [x.t, x.l]));
}

/** Texto e ACL das funções (cópia exata no down). */
async function funcoes(c: pg.ClientBase): Promise<Record<string, { def: string; acl: string | null }>> {
  const r = await c.query<{ nome: string; def: string; acl: string | null }>(
    `select p.oid::regprocedure::text as nome, pg_get_functiondef(p.oid) as def, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'plataforma' and p.proname = any ($1) order by 1`,
    [[...FUNCOES, ...NOVAS]],
  );
  return Object.fromEntries(r.rows.map((x) => [x.nome, { def: x.def, acl: x.acl }]));
}

const catalogoDeFuncoes = async (c: pg.ClientBase) =>
  (await c.query<{ f: string }>("select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'plataforma' order by 1")).rows.map((x) => x.f);
const gatilhos = async (c: pg.ClientBase) =>
  (await c.query<{ g: string }>("select tgrelid::regclass::text || ':' || tgname as g from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'plataforma.%' order by 1")).rows.map((x) => x.g);

/** Hash do estado da transição (concessões, catalogo_aplicado e achados, com o updated_at). */
async function retrato(c: pg.ClientBase): Promise<{ n: number; hash: string }> {
  const r = await c.query<{ n: string; hash: string }>(
    `with l as (
       select 'c|' || id || '|' || coalesce(nivel, '') || '|' || coalesce(array_to_string(alvos, ','), '') || '|' || updated_at || '|' || coalesce(deleted_at::text, '') as x from plataforma.perfil_concessao
       union all select 'a|' || id || '|' || versao || '|' || leitura || '|' || aplicado_em || '|' || updated_at from plataforma.catalogo_aplicado
       union all select 'm|' || id || '|' || efeito || '|' || coalesce(resolvido_em::text, '') || '|' || updated_at from plataforma.perfil_migracao_conflito)
     select count(*) as n, md5(string_agg(x, ';' order by x)) as hash from l`,
  );
  return { n: Number(r.rows[0]!.n), hash: r.rows[0]!.hash };
}

/** Tenant com perfis personalizados (TP) e tenant com conflito que para (TC), gravados pelo caminho de hoje (0108). */
async function casos(c: pg.ClientBase): Promise<void> {
  const q = consulta(c);
  await c.query('begin');
  await q("insert into plataforma.tenant (id, codigo, nome) values ($1, 't109p', 'Personalizados 109'), ($2, 't109c', 'Conflito 109')", [TP, TC]);
  const usuario = (t: string, id: string, perfil: string) =>
    q('insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, $3, $4, $5, $6)', [id, t, `Pessoa ${perfil}`, `${id.slice(-4)}@exemplo.com.br`, perfil, HASH_TESTE]);
  for (const [id, perfil] of [[U.admin, 'admin'], [U.vend, 'vendedor'], [U.prom, 'promotor'], [U.sup, 'supervisor'], [U.anal, 'analista']] as const) await usuario(TP, id, perfil);
  await usuario(TC, U.cAdmin, 'admin');
  await usuario(TC, U.cVend, 'vendedor');
  await q("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'vendedor_x', 'Vendedor X', 'vendedor', 'vendedor')", [P.vendX, TP]);
  await q("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'analista_x', 'Analista X', 'analista', 'administrativo')", [P.analX, TP]);
  await q("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'sup_do_vendedor', 'Sup do vendedor', 'vendedor', 'supervisor')", [P.supDoVend, TC]);
  const sob = (t: string, perfil: string, chave: string, concedida: boolean, nivel: string | null = null, alvos: string[] | null = null) =>
    q('insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel, alvos) values ($1, $2, $3, $4, $5, $6)', [t, perfil, chave, concedida, nivel, alvos]);
  await sob(TP, P.vendX, 'dados.escopo', true, 'proprio');
  await sob(TP, P.vendX, 'produto.consultar', false);
  await sob(TP, idPerfilFabrica(TP, 'supervisor'), 'meta.ver', false);
  await sob(TP, P.analX, 'senha.redefinir', true, null, ['vendedor', 'promotor']);
  await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'promotor_ve_pedidos', 'false'::jsonb), ($1, 'catalogo', 'promotor_ve_preco_estoque', 'true'::jsonb)", [TP]);
  const trocar = async (t: string, u: string, perfil: string) => {
    await q('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and deleted_at is null', [u]);
    await q('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [t, u, perfil]);
  };
  await trocar(TP, U.vend, P.vendX);
  await trocar(TP, U.anal, P.analX);
  await trocar(TC, U.cVend, P.supDoVend);
  await c.query('commit');
}

describe.skipIf(semBanco())('0109 troca de leitura: prova por usuário, idempotência e up/down/up (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  }, 300_000);
  afterAll(async () => {
    await b?.apagar();
  });

  it('nenhum usuário perde acesso; conflito fica em legado; idempotente; down devolve tudo; up de novo dá o mesmo', async () => {
    await comAdmin(b.nome, async (c) => {
      const q = consulta(c);
      const avisos: string[] = [];
      c.on('notice', (n) => avisos.push(n.message ?? ''));
      await migrarUp(c, { ate: '0108' });
      await carregarFixtureDosTestes(c, { agora: agoraDaFixture() });
      await carregarDemo(c, { senha: 'Demo@teste109' });
      await casos(c);
      const funcoesAntes = await funcoes(c);
      const catalogoAntes = await catalogoDeFuncoes(c);
      const gatilhosAntes = await gatilhos(c);
      const antes = await acessos(c, 'legado');
      const licencasAntes = await licencas(c);
      const tenants = Object.keys(await leituras(c));
      expect(new Set(antes.map((a) => a.tenant))).toEqual(new Set([A.tenantId, B.tenantId, TENANT_DEMO, TP, TC]));
      expect(antes.length).toBeGreaterThan(20);
      expect(Object.values(await leituras(c)).every((l) => l === 'legado')).toBe(true);
      // os casos: escopo proprio, revogação, alvos e os 2 parâmetros no promotor
      const de = (u: string) => antes.find((a) => a.usuario === u)!.permissoes;
      expect([de(U.vend)['dados.escopo'], de(U.vend)['produto.consultar'], de(U.anal)['senha.redefinir'], de(U.sup)['meta.ver']])
        .toEqual([{ nivel: 'proprio' }, undefined, { alvos: ['promotor', 'vendedor'] }, undefined]);
      expect(['pedido.ver' in de(U.prom), 'produto.ver_preco_estoque' in de(U.prom)]).toEqual([false, true]);

      // o diagnóstico só de leitura (db/scripts/diagnostico-0109.sql) prevê o que a 0109 faz em cada tenant
      const diagnostico = readFileSync(fileURLToPath(new URL('../scripts/diagnostico-0109.sql', import.meta.url)), 'utf8');
      const r0 = await retrato(c);
      const previsto = await q<{ tenant_id: string; previsto: string }>(diagnostico);
      expect(Object.fromEntries(previsto.map((x) => [x.tenant_id, x.previsto]))).toEqual(Object.fromEntries(tenants.map((t) => [t, t === TC ? 'parado' : 'ligado'])));
      expect(await retrato(c)).toEqual(r0); // só leitura

      // up da 0109
      expect((await migrarUp(c)).aplicadas).toEqual(['0109_plataforma_perfis_leitura_concessao']);
      const funcoesDepois = await funcoes(c);
      expect(funcoesDepois['plataforma.perfis_do_usuario(uuid)']).toEqual(funcoesAntes['plataforma.perfis_do_usuario(uuid)']);
      // os 3 gatilhos recriados seguem DEFINER (a 0049), com a mesma ACL
      for (const f of ['usuario_conferir_acesso()', 'usuario_perfil_conferir()', 'perfil_conferir()']) {
        expect(funcoesDepois[`plataforma.${f}`]!.def, f).toMatch(/SECURITY DEFINER/);
        expect(funcoesDepois[`plataforma.${f}`]!.acl, f).toEqual(funcoesAntes[`plataforma.${f}`]!.acl);
        expect(funcoesDepois[`plataforma.${f}`]!.def, f).not.toEqual(funcoesAntes[`plataforma.${f}`]!.def);
      }
      const ligados = tenants.filter((t) => t !== TC);
      expect(await leituras(c)).toEqual(Object.fromEntries(tenants.map((t) => [t, t === TC ? 'legado' : 'concessao'])));
      expect(avisos.filter((a) => a.startsWith('0109:'))).toEqual([
        expect.stringMatching(new RegExp(`^0109: leitura por concessão ligada em ${ligados.length} tenant\\(s\\), 1 parado\\(s\\) em legado, 0 sem mudança; achados abertos: .*CARGO_DIFERENTE_DA_BASE/para_tenant=1`)),
      ]);
      expect(avisos.join('\n')).not.toMatch(/@|Pessoa/); // sem dado pessoal
      expect((await achados(c, TC)).filter((x) => x.includes('para_tenant'))).toEqual(['CARGO_DIFERENTE_DA_BASE/para_tenant/sup_do_vendedor/-']);
      expect(await q("select versao, leitura from plataforma.catalogo_aplicado where tenant_id = any ($1) and deleted_at is null order by leitura", [[A.tenantId, TC]]))
        .toEqual([{ versao: 2, leitura: 'concessao' }, { versao: 2, leitura: 'legado' }]);

      // PROVA: o mesmo acesso por usuário (chave, nível, alvos), admin, portal e licenças
      const depois = await acessos(c, 'efetivo');
      expect(depois).toEqual(antes);
      expect(await pelaApi(b.urlApp, antes)).toEqual(antes);
      expect(await licencas(c)).toEqual(licencasAntes);
      for (const t of ligados) expect(await q("select * from plataforma.conferir_perfis_sem_base($1) where tipo = 'DIFERENCA'", [t]), t).toEqual([]);
      expect(antes).toHaveLength(24);
      console.info(`[0109] ${antes.length} usuário(s) provados sem perda em ${tenants.length} tenant(s): ${ligados.length} em concessao, 1 em legado`);

      // idempotência: rodar de novo não muda nenhuma linha
      const r1 = await retrato(c);
      const res = await q<{ t: string; r: string }>('select t.id as t, plataforma.ligar_leitura_por_concessao(t.id) as r from plataforma.tenant t order by t.id');
      expect(res.map((x) => x.r)).toEqual(res.map((x) => (x.t === TC ? 'parado' : 'ja_ligado')));
      expect(await retrato(c)).toEqual(r1);
      for (const t of [A.tenantId, TP]) expect((await retratoConcessoes(c, t)).n).toBeGreaterThan(0);

      // a "API nova" muda o perfil do vendedor_x direto nas concessões: tira cliente.pre_cadastrar
      await q("update plataforma.perfil_concessao set deleted_at = now() where perfil_id = $1 and chave = 'cliente.pre_cadastrar' and deleted_at is null", [P.vendX]);
      const mudado = await acessos(c, 'efetivo');

      // down
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0109_plataforma_perfis_leitura_concessao']);
      expect(Object.values(await leituras(c)).every((l) => l === 'legado')).toBe(true);
      expect(await funcoes(c)).toEqual(funcoesAntes);
      expect(await catalogoDeFuncoes(c)).toEqual(catalogoAntes);
      expect(await gatilhos(c)).toEqual(gatilhosAntes);
      // por usuário, o acesso de hoje = o que a concessão dava (o vendedor_x sem cliente.pre_cadastrar, pela sobreposição nova)
      const aposDown = await acessos(c, 'legado');
      expect(aposDown).toEqual(mudado);
      expect(aposDown.find((a) => a.usuario === U.vend)!.permissoes['cliente.pre_cadastrar']).toBeUndefined();
      expect(await q("select chave, concedida from plataforma.perfil_permissao where perfil_id = $1 and deleted_at is null order by chave", [P.vendX]))
        .toEqual([{ chave: 'cliente.pre_cadastrar', concedida: false }, { chave: 'dados.escopo', concedida: true }, { chave: 'produto.consultar', concedida: false }]);

      // up de novo: mesmo resultado por tenant e por usuário
      expect((await migrarUp(c)).aplicadas).toEqual(['0109_plataforma_perfis_leitura_concessao']);
      expect(await leituras(c)).toEqual(Object.fromEntries(tenants.map((t) => [t, t === TC ? 'legado' : 'concessao'])));
      expect(await acessos(c, 'efetivo')).toEqual(aposDown);
      expect(lerMigracoes().at(-1)!.versao).toBe('0109');
    });
  }, 600_000);
});

describe.skipIf(semBanco())('0109 funções de caminho duplo (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    app = new pg.Client({ connectionString: banco().urlApp });
    await admin.connect();
    await app.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });
  const q: Q = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const naApp: Q = async (sql, params = []) => (await app.query(sql, params)).rows;

  /** A fixture grava catalogo_aplicado em 'legado' (o motor da API nos outros testes); aqui o tenant A é ligado na transação. */
  const ligarA = (c: Q) => c("update plataforma.catalogo_aplicado set leitura = 'concessao' where tenant_id = $1", [A.tenantId]);

  it('perfil_do_usuario devolve codigo, cargo, base, leitura e as concessões', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ler = () => naApp('select perfil_id, codigo, cargo, base, leitura, permissoes from plataforma.perfil_do_usuario($1)', [A.usuarios.vendedor1]);
      const noLegado = await ler();
      await ligarA(naApp);
      const r = await ler();
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ perfil_id: idPerfilFabrica(A.tenantId, 'vendedor'), codigo: 'vendedor', cargo: 'vendedor', base: 'vendedor', leitura: 'concessao' });
      expect((r[0]!.permissoes as Permissoes)['acesso.campo']).toEqual({});
      expect({ ...noLegado[0], leitura: 'concessao' }).toEqual(r[0]); // os dois caminhos dão o mesmo
    });
  });

  it('RLS: outro tenant e sem contexto = 0 linhas; o perfil de outro tenant não é lido; só o dono liga a leitura', async () => {
    expect(await emTransacao(app, A.tenantId, () => naApp('select * from plataforma.perfil_do_usuario($1)', [B.usuarios.vendedor]))).toEqual([]);
    expect(await emTransacao(app, null, () => naApp('select * from plataforma.perfil_do_usuario($1)', [A.usuarios.vendedor1]))).toEqual([]);
    expect(await emTransacao(app, A.tenantId, () => naApp('select * from plataforma.perfis_do_usuario($1)', [B.usuarios.vendedor]))).toEqual([]);
    expect(await emTransacao(app, A.tenantId, () => naApp('select plataforma.permissoes_efetivas_do_perfil($1) as p', [idPerfilFabrica(B.tenantId, 'vendedor')]))).toEqual([{ p: null }]);
    expect(await emTransacao(app, B.tenantId, () => naApp('select count(*)::int as n from plataforma.perfil_do_usuario($1)', [B.usuarios.vendedor]))).toEqual([{ n: 1 }]);
    expect((await erroDe(emTransacao(app, A.tenantId, () => naApp('select plataforma.ligar_leitura_por_concessao($1)', [A.tenantId]))))?.code).toBe('42501');
    expect((await erroDe(emTransacao(app, A.tenantId, () => naApp('select plataforma.perfil_concessao_conferir()'))))?.code).toBe('42501');
    const portal = banco().urlPortal;
    if (portal) {
      const p = new pg.Client({ connectionString: portal });
      await p.connect();
      try {
        expect((await erroDe(p.query('select * from plataforma.perfil_do_usuario($1)', [A.usuarios.admin])))?.code).toBe('42501');
      } finally {
        await p.end();
      }
    }
  });

  it('tenant novo nasce em concessao, na v2, sem achado que pare', async () => {
    const T = 'cccccccc-0109-4000-8000-00000000d001';
    await emTransacao(admin, null, async () => {
      await q("insert into plataforma.tenant (id, codigo, nome) values ($1, 't109-novo', 'Novo 109')", [T]);
      expect(await leitura(admin, T)).toBe('concessao');
      expect(await q('select versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1 and deleted_at is null', [T])).toEqual([{ versao: 2, leitura: 'concessao' }]);
      expect((await achados(admin, T)).filter((x) => x.includes('para_tenant'))).toEqual([]);
      expect((await retratoConcessoes(admin, T)).vivas).toBeGreaterThan(400);
      expect(await q('select plataforma.ligar_leitura_por_concessao($1) as r', [T])).toEqual([{ r: 'ja_ligado' }]);
    });
  });

  it('último admin pela gestão do acesso: tirar perfil.gerir do único admin para no COMMIT; com um gerente com a gestão, passa', async () => {
    const adminP = idPerfilFabrica(A.tenantId, 'admin');
    const gerenteP = idPerfilFabrica(A.tenantId, 'gerente');
    const gestao = ['perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'];
    const tirarGerir = () => q("update plataforma.perfil_concessao set deleted_at = now() where perfil_id = $1 and chave = 'perfil.gerir' and deleted_at is null", [adminP]);
    await emTransacao(admin, null, async () => {
      await ligarA(q);
      expect(await q('select plataforma.tenant_tem_admin_com_gestao($1) as t', [A.tenantId])).toEqual([{ t: true }]);
      await tirarGerir();
      const e = await erroDe(q('set constraints all immediate'));
      expect([e?.code, e?.message]).toEqual(['23514', expect.stringMatching(/sem nenhum admin/)]);
    });
    await emTransacao(admin, null, async () => {
      await ligarA(q);
      const adm = (u: string) => q<{ a: boolean; p: boolean }>('select plataforma.usuario_admin_com_gestao($1, $2) as a, plataforma.usuario_tem_perfil_admin($1, $2) as p', [A.tenantId, u]);
      expect(await adm(A.usuarios.gerente)).toEqual([{ a: false, p: false }]);
      for (const k of gestao) await q('insert into plataforma.perfil_concessao (tenant_id, perfil_id, chave) values ($1, $2, $3) on conflict do nothing', [A.tenantId, gerenteP, k]);
      expect(await adm(A.usuarios.gerente)).toEqual([{ a: true, p: true }]);
      // no legado, o gerente não conta (base admin)
      await q("update plataforma.catalogo_aplicado set leitura = 'legado' where tenant_id = $1", [A.tenantId]);
      expect(await adm(A.usuarios.gerente)).toEqual([{ a: false, p: false }]);
      await q("update plataforma.catalogo_aplicado set leitura = 'concessao' where tenant_id = $1", [A.tenantId]);
      await tirarGerir();
      expect(await erroDe(q('set constraints all immediate'))).toBeNull();
      expect(await adm(A.usuarios.admin)).toEqual([{ a: false, p: false }]);
    });
  });

  describe('último admin só pela gestão do acesso (RN-CORE-35, perfil de base analista)', () => {
    const G = 'cccccccc-0109-4000-8000-00000000e001'; // perfil personalizado, base analista, com a gestão completa
    const adminP = idPerfilFabrica(A.tenantId, 'admin');
    const analistaP = idPerfilFabrica(A.tenantId, 'analista');
    const gestao = ['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'];
    const tirar = (perfil: string, chave: string) =>
      q('update plataforma.perfil_concessao set deleted_at = now() where tenant_id = $1 and perfil_id = $2 and chave = $3 and deleted_at is null', [A.tenantId, perfil, chave]);
    const noCommit = async (acao: () => Promise<unknown>) => erroDe((async () => {
      await acao();
      await q('set constraints all immediate');
    })());
    const ultimoAdmin = ['23514', 'tenant_ultimo_admin'];
    /** [código, restrição] do erro no COMMIT, ou null. */
    const motivo = async (acao: () => Promise<unknown>): Promise<[string, string] | null> => {
      try {
        await acao();
        await q('set constraints all immediate');
        return null;
      } catch (e) {
        const err = e as { code?: string; constraint?: string; message?: string };
        return [err.code ?? '?', err.constraint ?? err.message ?? ''];
      }
    };

    /** A gestão vai para G (base analista) com o usuário analista; com `tirarDoAdmin`, o admin de base perde perfil.gerir. */
    async function preparar(leituraDoTenant: 'concessao' | 'legado', tirarDoAdmin: boolean): Promise<void> {
      await ligarA(q);
      await q("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'gestao_109', 'Gestão 109', 'analista', 'administrativo')", [G, A.tenantId]);
      for (const k of gestao) await q('insert into plataforma.perfil_concessao (tenant_id, perfil_id, chave) values ($1, $2, $3) on conflict do nothing', [A.tenantId, G, k]);
      await q('update plataforma.usuario_perfil set deleted_at = now() where tenant_id = $1 and usuario_id = $2 and deleted_at is null', [A.tenantId, A.usuarios.analista]);
      await q('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, A.usuarios.analista, G]);
      if (tirarDoAdmin) await tirar(adminP, 'perfil.gerir');
      if (leituraDoTenant === 'legado') await q("update plataforma.catalogo_aplicado set leitura = 'legado' where tenant_id = $1", [A.tenantId]);
      await q('set constraints all immediate'); // o preparo passa: no concessao, o analista é o admin
      await q('set constraints all deferred');
    }
    const adminDe = async (u: string) => (await q<{ a: boolean }>('select plataforma.usuario_admin_com_gestao($1, $2) as a', [A.tenantId, u]))[0]!.a;

    it('em concessao: o único admin pela gestão não é desativado, apagado, trocado de perfil nem perde concessão (23514 no COMMIT)', async () => {
      const casos: Array<[string, () => Promise<unknown>]> = [
        ['desativar o usuário', () => q('update core.usuario set ativo = false where id = $1', [A.usuarios.analista])],
        ['apagar o usuário', () => q('update core.usuario set deleted_at = now() where id = $1', [A.usuarios.analista])],
        ['trocar o perfil (update do vínculo)', () => q('update plataforma.usuario_perfil set perfil_id = $2 where usuario_id = $1 and deleted_at is null', [A.usuarios.analista, analistaP])],
        ['trocar o perfil (sai o vínculo, entra outro)', async () => {
          await q('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and deleted_at is null', [A.usuarios.analista]);
          await q('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [A.tenantId, A.usuarios.analista, analistaP]);
        }],
        ...gestao.map((k): [string, () => Promise<unknown>] => [`tirar ${k} do perfil`, () => tirar(G, k)]),
        ['desativar o perfil (o usuário sai antes)', async () => {
          await q('update plataforma.usuario_perfil set perfil_id = $2 where usuario_id = $1 and deleted_at is null', [A.usuarios.analista, analistaP]);
          await q('update plataforma.perfil set ativo = false where id = $1', [G]);
        }],
        ['apagar o perfil (o usuário sai antes)', async () => {
          await q('update plataforma.usuario_perfil set perfil_id = $2 where usuario_id = $1 and deleted_at is null', [A.usuarios.analista, analistaP]);
          await q('update plataforma.perfil set deleted_at = now() where id = $1', [G]);
        }],
        ['tirar perfil.gerir e desativar o usuário na mesma transação', async () => {
          await tirar(G, 'perfil.gerir');
          await q('update core.usuario set ativo = false where id = $1', [A.usuarios.analista]);
        }],
        ['tirar perfil.gerir e trocar o vínculo na mesma transação', async () => {
          await tirar(G, 'perfil.gerir');
          await q('update plataforma.usuario_perfil set perfil_id = $2 where usuario_id = $1 and deleted_at is null', [A.usuarios.analista, analistaP]);
        }],
      ];
      for (const [nome, acao] of casos) {
        await emTransacao(admin, null, async () => {
          await preparar('concessao', true);
          expect([await adminDe(A.usuarios.analista), await adminDe(A.usuarios.admin)], nome).toEqual([true, false]);
          expect(await q('select plataforma.tenant_tem_admin_com_gestao($1) as t', [A.tenantId]), nome).toEqual([{ t: true }]);
          expect(await motivo(acao), nome).toEqual(ultimoAdmin);
        });
      }
    });

    it('em concessao, com outro admin pela gestão (o de base admin), as mesmas mudanças passam', async () => {
      await emTransacao(admin, null, async () => {
        await preparar('concessao', false);
        expect([await adminDe(A.usuarios.analista), await adminDe(A.usuarios.admin)]).toEqual([true, true]);
        expect(await noCommit(async () => {
          await tirar(G, 'perfil.gerir');
          await q('update core.usuario set ativo = false where id = $1', [A.usuarios.analista]);
        })).toBeNull();
      });
    });

    it('em legado, o comportamento de hoje: o analista com as concessões não conta; o admin de base é o último', async () => {
      await emTransacao(admin, null, async () => {
        await preparar('legado', true);
        expect([await adminDe(A.usuarios.analista), await adminDe(A.usuarios.admin)]).toEqual([false, true]);
        expect(await noCommit(() => q('update core.usuario set ativo = false where id = $1', [A.usuarios.analista]))).toBeNull();
        expect(await motivo(() => q('update core.usuario set ativo = false where id = $1', [A.usuarios.admin]))).toEqual(ultimoAdmin);
      });
      await emTransacao(admin, null, async () => {
        await preparar('legado', true);
        expect(await noCommit(() => tirar(G, 'perfil.gerir'))).toBeNull();
      });
    });
  });

  it('conferência §4.1 com DIFERENCA: ligar_leitura_por_concessao para com 23514 e o tenant fica em legado', async () => {
    await emTransacao(admin, null, async () => {
      // só nesta transação (ROLLBACK): a conferência acusa uma diferença para um usuário do tenant
      await q(`create or replace function plataforma.conferir_perfis_sem_base(p_tenant uuid)
                 returns table (usuario_id uuid, perfil_codigo text, chave text, antes jsonb, depois jsonb, tipo text)
                 language sql stable set search_path = pg_catalog, plataforma, pg_temp
                 as $$ select null::uuid, 'vendedor'::text, 'produto.consultar'::text, '{}'::jsonb, null::jsonb, 'DIFERENCA'::text $$`);
      expect(await leitura(admin, A.tenantId)).toBe('legado');
      await q('savepoint ligar');
      const e = await erroDe(q('select plataforma.ligar_leitura_por_concessao($1)', [A.tenantId]));
      await q('rollback to savepoint ligar');
      expect(e?.code).toBe('23514');
      expect(e?.message).toContain('acesso por concessão diferente');
      expect(await leitura(admin, A.tenantId)).toBe('legado');
    });
  });

  it('licenças em uso pelo cargo = pela base, no tenant ligado', async () => {
    await emTransacao(admin, null, async () => {
      const lic = async () => q('select item, em_uso from plataforma.licencas_em_uso($1)', [A.tenantId]);
      await ligarA(q);
      const concessao = await lic();
      await q("update plataforma.catalogo_aplicado set leitura = 'legado' where tenant_id = $1", [A.tenantId]);
      expect(await lic()).toEqual(concessao);
      expect(concessao.find((l) => l.item === 'bko')!.em_uso).toBeGreaterThan(0);
    });
  });
});
