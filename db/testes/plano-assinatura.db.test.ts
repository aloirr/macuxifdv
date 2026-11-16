/**
 * 0070 e 0071 — planos e licenças no banco (ADR 0047; portal config. enxuto, R-20261114-170600 e R-20261114-181000). Dicionário:
 * docs/banco/plataforma.md ("Planos e assinatura (0070)"). O que o BANCO garante:
 * - plataforma.plano: catálogo da plataforma, sem tenant_id, só por função (nenhum grant de tabela para app, worker ou portal);
 * - plataforma.assinatura: uma VIVA por tenant, RLS por tenant (o macuxi_app só lê a do próprio tenant), CHECK paga ou com teste;
 * - plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb) — a chamada de apps/api/src/planos-portal.ts: só
 *   super-admin (28000 sem sessão, 42501 para o admin do cliente), entrada revalidada (22023, com o código no hint para plano
 *   desconhecido, inativo ou adicional fora do plano), tenant inexistente = P0002, idempotente (uma por tenant: 'existente'
 *   devolve o teste_ate gravado), auditoria sem dado pessoal; EXECUTE só ao macuxi_portal (17 sa_*);
 * - 0071: a sa_listar_tenants da 0039 com plano (nome), teste_ate (AAAA-MM-DD) e paga (false sem assinatura);
 * - up/down: a 0070 só acrescenta (down volta ao catálogo da 0069); o down da 0071 volta ao texto e à ACL da 0039.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero) no CI.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListaEmpresasSchema, MODULOS } from '@macuxi/platform-sdk';
import { ASSINATURAS_FIXTURE, DOIS_TENANTS, PLANOS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0070, FUNCOES_SA_ATE_0071 } from './funcoes-sa';
import { emTransacao, erroDe, erroNoSavepoint, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m39 = migracoes.find((m) => m.versao === '0039')!;
const m70 = migracoes.find((m) => m.versao === '0070')!;
const m71 = migracoes.find((m) => m.versao === '0071')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up70 = semComentarios(m70.up);
const down70 = semComentarios(m70.down);
const up71 = semComentarios(m71.up);
const down71 = semComentarios(m71.down);
/** Do início até o `$$;` que fecha a função. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const GRAVAR = 'plataforma.sa_gravar_assinatura(uuid, uuid, jsonb)';
const LISTAR = 'create or replace function plataforma.sa_listar_tenants(p_sid uuid)';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;

describe('0070 planos e assinatura (estático)', () => {
  it('nomes e posição: 0070_plataforma_plano_assinatura e 0071_plataforma_listar_tenants_plano logo depois da 0069', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    const i = nomes.indexOf('0069_core_cargo_hierarquia');
    expect(nomes.slice(i + 1, i + 3)).toEqual(['0070_plataforma_plano_assinatura', '0071_plataforma_listar_tenants_plano']);
  });

  it('plano: fora dos tenants e só por função; assinatura: RLS por tenant, app só lê, fora do sync; nenhum grant ao portal', () => {
    expect(TABELAS_SEM_TENANT_ID).toHaveProperty(['plataforma.plano']);
    // desde a 0085 o app lê o plano do próprio tenant (planos-troca-licencas.db.test.ts): o plano saiu de TABELAS_SO_POR_FUNCAO
    expect(TABELAS_SO_POR_FUNCAO).not.toContain('plataforma.plano');
    expect(TABELAS_SEM_TENANT_ID).not.toHaveProperty(['plataforma.assinatura']);
    expect(TABELAS_FORA_DO_SYNC).toContain('plataforma.assinatura');
    expect(up70).toContain('create unique index plano_codigo_uk on plataforma.plano (codigo) where deleted_at is null;');
    expect(up70).toContain('create unique index assinatura_tenant_uk on plataforma.assinatura (tenant_id) where deleted_at is null;');
    expect(up70).toContain('plano_id     uuid not null references plataforma.plano (id)');
    expect(up70).toContain('constraint assinatura_paga_ou_teste check (paga or teste_ate is not null)');
    expect(up70).toContain("constraint assinatura_ciclo_valido check (ciclo in ('mensal', 'anual'))");
    // a única permissão de tabela: o app lê a assinatura do próprio tenant
    expect([...up70.matchAll(/\bgrant [^;]+;/g)].map((x) => x[0])).toEqual([
      'grant select on plataforma.assinatura to macuxi_app;',
      `grant execute on function ${GRAVAR} to macuxi_portal;`,
    ]);
    expect(up70).not.toMatch(/create policy [a-z_]+ on plataforma\.plano for [a-z]+ to macuxi_(app|worker|portal)/);
    expect(up70).not.toMatch(/create policy [a-z_]+ on plataforma\.assinatura for [a-z]+ to macuxi_(worker|portal)/);
  });

  it('plano: os módulos do CHECK são os MODULOS do SDK; faixas de teste e meses grátis do contrato (PlanoSchema)', () => {
    const lista = /constraint plano_modulos_validos check \(\s*modulos <@ array\[([^\]]+)\]/.exec(up70)?.[1] ?? '';
    expect([...lista.matchAll(/'([a-z]+)'/g)].map((x) => x[1])).toEqual([...MODULOS]);
    expect(up70).toContain('constraint plano_meses_gratis_faixa check (meses_gratis_anual between 0 and 11)');
    expect(up70).toContain('constraint plano_dias_teste_faixa check (dias_teste between 0 and 90)');
    expect(up70).toContain("constraint plano_codigo_formato check (codigo ~ '^[a-z][a-z0-9_]{1,29}$')");
  });

  it('sa_gravar_assinatura: a assinatura que a API chama, SECURITY DEFINER, 28000/42501, hints do 422, idempotente, só o portal executa', () => {
    expect(FUNCOES_SA_0070).toEqual([GRAVAR]);
    expect(FUNCOES_SA_ATE_0071).toHaveLength(17);
    const b = bloco(up70, 'create function plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb)');
    expect(b).toMatch(/returns jsonb\s+language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
    expect(b).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
    // as chaves da EntradaAssinatura de apps/api/src/planos-portal.ts
    expect(b).toContain("k not in ('plano', 'ciclo', 'adicionais', 'teste_ate', 'paga', 'pedido_id')");
    for (const hint of ['PLANO_DESCONHECIDO', 'PLANO_INATIVO', 'ADICIONAL_FORA_DO_PLANO']) expect(b).toContain(`errcode = '22023', hint = '${hint}'`);
    expect(b).toContain("using errcode = 'P0002'");
    expect(b).toContain("perform pg_advisory_xact_lock(hashtextextended('plataforma.assinatura:' || p_tenant::text, 0));");
    expect(b).toContain("return jsonb_build_object('resultado', v_resultado, 'teste_ate', to_char(v_existente.teste_ate, 'YYYY-MM-DD'));");
    // auditoria sem texto livre nem dado pessoal
    const aud = b.split('\n').filter((l) => /sa_registrar_auditoria|jsonb_build_object\('plano'/.test(l)).join('\n');
    expect(aud).toContain("'sa.assinatura.gravar'");
    expect(aud).not.toMatch(/nome|email|cnpj|documento/);
    expect(up70).toContain(`revoke all on function ${GRAVAR} from public, macuxi_app, macuxi_worker;`);
    expect(up70).toContain('if v_n <> 17 then');
  });

  it('down da 0070: apaga a função e as 2 tabelas (assinatura antes do plano), sem criar nada', () => {
    expect(down70).toContain(`drop function if exists ${GRAVAR};`);
    expect(down70.indexOf('drop table if exists plataforma.assinatura;')).toBeGreaterThan(-1);
    expect(down70.indexOf('drop table if exists plataforma.assinatura;')).toBeLessThan(down70.indexOf('drop table if exists plataforma.plano;'));
    expect(down70).not.toMatch(/create |grant /);
  });

  it('0071: a sa_listar_tenants da 0039 com plano, teste_ate e paga por left join na assinatura viva; down = texto da 0039', () => {
    const de39 = bloco(m39.up, LISTAR);
    const de71 = bloco(m71.up, LISTAR);
    expect(de39).not.toBe('');
    expect(de71).toContain("'plano', pl.nome,");
    expect(de71).toContain("'teste_ate', to_char(a.teste_ate, 'YYYY-MM-DD'),");
    expect(de71).toContain("'paga', coalesce(a.paga, false)");
    expect(de71).toContain('left join plataforma.assinatura a on a.tenant_id = t.id and a.deleted_at is null');
    expect(de71).toContain('left join plataforma.plano pl on pl.id = a.plano_id');
    // o resto é o da 0039: tirando as linhas novas (e o comentário), sobra o texto da 0039
    const novas = [
      "             ), '[]'::jsonb),",
      "             'plano', pl.nome,",
      "             'teste_ate', to_char(a.teste_ate, 'YYYY-MM-DD'),",
      "             'paga', coalesce(a.paga, false)",
      '      left join plataforma.assinatura a on a.tenant_id = t.id and a.deleted_at is null',
      '      left join plataforma.plano pl on pl.id = a.plano_id',
    ];
    const limpar = (s: string) => semComentarios(s).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '' && !novas.includes(l));
    expect(limpar(de71)).toEqual(limpar(de39).filter((l) => l !== "             ), '[]'::jsonb)"));
    // ACL: create or replace mantém o EXECUTE só ao macuxi_portal da 0039
    expect(up71).not.toMatch(/\b(grant|revoke|drop)\b/);
    expect(down71.trim()).toBe(semComentarios(de39).trim());
    expect(down71).not.toMatch(/\b(grant|revoke|drop)\b/);
  });
});

describe.skipIf(semBanco())('0070/0071 planos e assinatura (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado (contexto de tenant opcional) dentro da transação aberta; um erro não aborta o caso. */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = [], tenant = '') {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0];
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.planos@macuxi.exemplo', nome: 'Operador 0070', senha_hash: HASH_TESTE })]))[0]!.r;
    return (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!.sessao_id;
  }
  const gravar = async (sid: string | null, tenant: string | null, e: unknown) =>
    (await portal<{ r: { resultado: string; teste_ate: string | null } }>('select plataforma.sa_gravar_assinatura($1, $2, $3::jsonb) as r', [sid, tenant, JSON.stringify(e)]))[0]!.r;
  /** SQLSTATE e hint do erro (o hint leva o código do 422). */
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      const x = e as { code?: string; hint?: string };
      return { code: x.code, hint: x.hint ?? null };
    }
  };
  const entrada = (extra: Record<string, unknown> = {}) => ({
    plano: PLANOS_FIXTURE.pme.codigo, ciclo: 'mensal', adicionais: [{ adicional: 'promotor', quantidade: 3 }], teste_ate: '2026-11-28',
    paga: false, pedido_id: '00700000-0000-4000-8000-000000000001', ...extra,
  });
  const novoTenant = async (codigo: string) =>
    (await q<{ id: string }>('insert into plataforma.tenant (codigo, nome) values ($1, $2) returning id', [codigo, `Empresa ${codigo}`]))[0]!.id;

  it('acesso direto: plano 42501 para worker e portal (o app lê só o do próprio tenant desde a 0085); assinatura: app só lê a do próprio tenant, sem escrita; worker e portal 42501', async () => {
    await emTransacao(admin, null, async () => {
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        expect((await erroDe(como(papel, 'select 1 from plataforma.plano limit 1', [], A)))?.code, papel).toBe('42501');
      }
      expect((await como<{ id: string }>('macuxi_app', 'select id from plataforma.plano', [], A)).rows).toEqual([{ id: PLANOS_FIXTURE.pme.id }]);
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        expect((await erroDe(como(papel, 'select 1 from plataforma.assinatura limit 1', [], A)))?.code, papel).toBe('42501');
      }
      const deA = await como<{ id: string; tenant_id: string }>('macuxi_app', 'select id, tenant_id from plataforma.assinatura', [], A);
      expect(deA.rows).toEqual([{ id: ASSINATURAS_FIXTURE.A.id, tenant_id: A }]);
      expect((await como('macuxi_app', 'select 1 from plataforma.assinatura where id = $1', [ASSINATURAS_FIXTURE.B.id], A)).rowCount).toBe(0);
      for (const sql of [
        "update plataforma.assinatura set paga = true",
        'delete from plataforma.assinatura',
        `insert into plataforma.assinatura (tenant_id, plano_id, pedido_id, paga) values ('${A}', '${PLANOS_FIXTURE.pme.id}', gen_random_uuid(), true)`,
      ]) {
        expect((await erroDe(como('macuxi_app', sql, [], A)))?.code, sql).toBe('42501');
      }
      // CHECK: sem teste, a assinatura nasce paga; uma viva por tenant
      expect((await erroNoSavepoint(admin, 'update plataforma.assinatura set teste_ate = null, paga = false where id = $1', [ASSINATURAS_FIXTURE.A.id]))?.code).toBe('23514');
      expect((await erroNoSavepoint(admin, 'insert into plataforma.assinatura (tenant_id, plano_id, pedido_id, paga) values ($1, $2, gen_random_uuid(), true)', [A, PLANOS_FIXTURE.pme.id]))?.code).toBe('23505');
    });
  });

  it('sa_gravar_assinatura: sessão (28000), app/worker (42501), admin do cliente (42501); super-admin grava uma vez e repete como existente', async () => {
    await emTransacao(admin, null, async () => {
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_gravar_assinatura(null, null, null)')))?.code, papel).toBe('42501');
      }
      expect((await erroDe(gravar(null, A, entrada())))?.code).toBe('28000');
      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] }))!;
      expect((await erroDe(gravar(cli.sessao_id, A, entrada())))?.code).toBe('42501');

      const sid = await sessaoSuperAdmin();
      const nova = await novoTenant('t0070-nova');
      expect(await gravar(sid, nova, entrada())).toEqual({ resultado: 'criada', teste_ate: '2026-11-28' });
      expect(await q('select plano_id, ciclo, adicionais, teste_ate::text as teste_ate, paga, pedido_id from plataforma.assinatura where tenant_id = $1', [nova])).toEqual([
        { plano_id: PLANOS_FIXTURE.pme.id, ciclo: 'mensal', adicionais: [{ adicional: 'promotor', quantidade: 3 }], teste_ate: '2026-11-28', paga: false, pedido_id: '00700000-0000-4000-8000-000000000001' },
      ]);
      // repetir (mesmo pedido ou outro): nada muda, devolve o teste gravado
      expect(await gravar(sid, nova, entrada())).toEqual({ resultado: 'existente', teste_ate: '2026-11-28' });
      expect(await gravar(sid, nova, entrada({ teste_ate: null, paga: true, ciclo: 'anual', pedido_id: '00700000-0000-4000-8000-000000000002' }))).toEqual({ resultado: 'existente', teste_ate: '2026-11-28' });
      expect(await q<{ n: number }>('select count(*)::int as n from plataforma.assinatura where tenant_id = $1', [nova])).toEqual([{ n: 1 }]);
      // a fixture: A já tem assinatura (em teste até 2026-11-27); B paga, sem teste
      expect(await gravar(sid, A, entrada())).toEqual({ resultado: 'existente', teste_ate: ASSINATURAS_FIXTURE.A.teste_ate });
      expect(await gravar(sid, B, entrada())).toEqual({ resultado: 'existente', teste_ate: null });
      // sem teste: paga, teste_ate nulo
      const paga = await novoTenant('t0070-paga');
      expect(await gravar(sid, paga, entrada({ teste_ate: null, paga: true, adicionais: [] }))).toEqual({ resultado: 'criada', teste_ate: null });
      const aud = await q<{ tenant_alvo_id: string; detalhes: Record<string, unknown> }>(
        "select tenant_alvo_id, detalhes from plataforma.auditoria_plataforma where acao = 'sa.assinatura.gravar' and sessao_id = $1",
        [sid],
      );
      expect(aud).toHaveLength(6);
      expect(aud.filter((x) => x.detalhes.resultado === 'criada').map((x) => x.tenant_alvo_id).sort()).toEqual([nova, paga].sort());
      expect(aud.find((x) => x.tenant_alvo_id === nova && x.detalhes.resultado === 'criada')!.detalhes).toEqual({
        plano: PLANOS_FIXTURE.pme.codigo, ciclo: 'mensal', com_teste: true, resultado: 'criada', origem: 'banco',
      });
    });
  });

  it('sa_gravar_assinatura: entrada fora do contrato = 22023; plano desconhecido, inativo e adicional fora do plano com o código no hint; tenant inexistente = P0002', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const nova = await novoTenant('t0070-erros');
      for (const [caso, e] of [
        ['chave a mais', { ...entrada(), valor: 1 }],
        ['sem plano', { ...entrada(), plano: undefined }],
        ['plano fora do formato', entrada({ plano: 'PME' })],
        ['ciclo', entrada({ ciclo: 'semanal' })],
        ['paga texto', entrada({ paga: 'sim' })],
        ['pedido_id', entrada({ pedido_id: 'x' })],
        ['teste_ate formato', entrada({ teste_ate: '28/11/2026' })],
        ['teste_ate inexistente', entrada({ teste_ate: '2026-02-30' })],
        ['sem teste e não paga', entrada({ teste_ate: null, paga: false })],
        ['adicionais não lista', entrada({ adicionais: {} })],
        ['adicional desconhecido', entrada({ adicionais: [{ adicional: 'gestor', quantidade: 1 }] })],
        ['quantidade 0', entrada({ adicionais: [{ adicional: 'promotor', quantidade: 0 }] })],
        ['quantidade fracionada', entrada({ adicionais: [{ adicional: 'promotor', quantidade: 1.5 }] })],
        ['adicional repetido', entrada({ adicionais: [{ adicional: 'promotor', quantidade: 1 }, { adicional: 'promotor', quantidade: 2 }] })],
        ['entrada não objeto', [1]],
      ] as const) {
        expect(await falha(gravar(sid, nova, e)), caso).toEqual({ code: '22023', hint: null });
      }
      expect(await falha(gravar(sid, nova, entrada({ plano: 'nao_existe' })))).toEqual({ code: '22023', hint: 'PLANO_DESCONHECIDO' });
      expect(await falha(gravar(sid, nova, entrada({ plano: PLANOS_FIXTURE.antigo.codigo, adicionais: [] })))).toEqual({ code: '22023', hint: 'PLANO_INATIVO' });
      expect(await falha(gravar(sid, nova, entrada({ adicionais: [{ adicional: 'treinamento', quantidade: 1 }] })))).toEqual({ code: '22023', hint: 'ADICIONAL_FORA_DO_PLANO' });
      expect((await falha(gravar(sid, '00700000-ffff-4000-8000-000000000000', entrada())))?.code).toBe('P0002');
      expect(await q('select 1 from plataforma.assinatura where tenant_id = $1', [nova])).toEqual([]);
      // Pesquisa é vendida pelo plano da fixture: grava
      expect(await gravar(sid, nova, entrada({ adicionais: [{ adicional: 'pesquisa', quantidade: 5 }] }))).toEqual({ resultado: 'criada', teste_ate: '2026-11-28' });
    });
  });

  it('0071 sa_listar_tenants: plano, teste_ate e paga de cada empresa (sem assinatura = null, null, false); o admin do cliente só as da sessão', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const semPlano = await novoTenant('t0070-sem-plano');
      const bruto = (await portal<{ r: { itens: Array<Record<string, unknown>> } }>('select plataforma.sa_listar_tenants($1) as r', [sid]))[0]!.r;
      const porId = new Map(bruto.itens.map((x) => [x.id, x]));
      expect(porId.get(A)).toMatchObject({ plano: PLANOS_FIXTURE.pme.nome, teste_ate: ASSINATURAS_FIXTURE.A.teste_ate, paga: false });
      expect(porId.get(B)).toMatchObject({ plano: PLANOS_FIXTURE.pme.nome, teste_ate: null, paga: true });
      expect(porId.get(semPlano)).toMatchObject({ plano: null, teste_ate: null, paga: false });
      // os campos de antes continuam (o contrato de main lê a lista e ignora os novos)
      expect(ListaEmpresasSchema.parse(bruto).itens.map((x) => x.id)).toEqual(expect.arrayContaining([A, B, semPlano]));
      // assinatura apagada (deleted_at) não conta; o nome do plano fica mesmo com a linha do plano trocada por versão nova
      await q('update plataforma.plano set deleted_at = now() where id = $1', [PLANOS_FIXTURE.pme.id]);
      await q('update plataforma.assinatura set deleted_at = now() where id = $1', [ASSINATURAS_FIXTURE.B.id]);
      const depois = (await portal<{ r: { itens: Array<Record<string, unknown>> } }>('select plataforma.sa_listar_tenants($1) as r', [sid]))[0]!.r;
      const porId2 = new Map(depois.itens.map((x) => [x.id, x]));
      expect(porId2.get(A)).toMatchObject({ plano: PLANOS_FIXTURE.pme.nome, teste_ate: ASSINATURAS_FIXTURE.A.teste_ate, paga: false });
      expect(porId2.get(B)).toMatchObject({ plano: null, teste_ate: null, paga: false });

      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] }))!;
      const doCliente = (await portal<{ r: { itens: Array<Record<string, unknown>> } }>('select plataforma.sa_listar_tenants($1) as r', [cli.sessao_id]))[0]!.r;
      expect(doCliente.itens.map((x) => [x.id, x.plano, x.teste_ate, x.paga])).toEqual([[A, PLANOS_FIXTURE.pme.nome, ASSINATURAS_FIXTURE.A.teste_ate, false]]);
      expect((await erroDe(portal('select plataforma.sa_listar_tenants(null)')))?.code).toBe('28000');
    });
  });
});

describe.skipIf(semBanco())('0070/0071 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('0070 só acrescenta (2 tabelas e a sa_gravar_assinatura); 0071 troca só o corpo da sa_listar_tenants; os downs voltam exatamente', async () => {
    await comAdmin(b.nome, async (c) => {
      const listar = async () =>
        (await c.query<{ def: string; acl: string }>("select pg_get_functiondef('plataforma.sa_listar_tenants(uuid)'::regprocedure) as def, proacl::text as acl from pg_proc where oid = 'plataforma.sa_listar_tenants(uuid)'::regprocedure")).rows[0]!;
      await migrarUp(c, { ate: '0069' });
      const catalogo = await retratoDoCatalogo(c);
      const listar69 = await listar();
      expect((await migrarUp(c, { ate: '0070' })).aplicadas).toEqual(['0070_plataforma_plano_assinatura']);
      const depois70 = await retratoDoCatalogo(c);
      expect(catalogo.filter((l) => !depois70.includes(l))).toEqual([]);
      const novos = depois70.filter((l) => !catalogo.includes(l));
      expect(novos.filter((l) => l.startsWith('fn '))).toEqual(['fn plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb)']);
      expect(novos.filter((l) => l.startsWith('rel ')).sort()).toEqual([
        'rel plataforma.assinatura r rls=true force=true',
        'rel plataforma.assinatura_pkey i rls=false force=false',
        'rel plataforma.assinatura_plano_ix i rls=false force=false',
        'rel plataforma.assinatura_tenant_uk i rls=false force=false',
        'rel plataforma.plano r rls=true force=true',
        'rel plataforma.plano_codigo_uk i rls=false force=false',
        'rel plataforma.plano_pkey i rls=false force=false',
      ]);
      expect((await c.query<{ n: number }>("select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'plataforma' and p.proname like 'sa\\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute')")).rows).toEqual([{ n: 17 }]);

      expect((await migrarUp(c, { ate: '0071' })).aplicadas).toEqual(['0071_plataforma_listar_tenants_plano']);
      expect(await retratoDoCatalogo(c)).toEqual(depois70);
      const listar71 = await listar();
      expect(listar71.def).toContain("'paga', coalesce(a.paga, false)");
      expect(listar71.acl).toBe(listar69.acl);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0071_plataforma_listar_tenants_plano']);
      expect(await listar()).toEqual(listar69);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0070_plataforma_plano_assinatura']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      await c.query(m70.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      await migrarUp(c, { ate: '0071' });
      expect(await retratoDoCatalogo(c)).toEqual(depois70);
      expect(await listar()).toEqual(listar71);
    });
  });
});
