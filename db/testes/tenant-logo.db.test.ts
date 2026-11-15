/**
 * 0081 — logo do cliente e nome fantasia da empresa (T-0182, número provisório; decisões R-20261114-223500 e
 * R-20261114-234500; desenho docs/desenho/T-0182-logo-cliente.md §1.2, com a decisão do gerente: só o super-admin grava,
 * RN-CORE-33). Dicionário: docs/banco/plataforma.md, "Logo e nome fantasia da empresa (0081)". O que o BANCO garante:
 * - plataforma.tenant ganha nome_fantasia e 8 logo_* nulas, com CHECKs (formato, faixas, chave do próprio tenant e da própria
 *   logo com a extensão do tipo) e tudo-ou-nada (tenant_logo_completa); nenhum índice, política ou grant novo;
 * - sa_marca_da_empresa: super-admin em qualquer empresa; admin do cliente só na empresa atual da sessão (42501 na outra);
 * - sa_gravar_nome_fantasia, sa_gravar_logo, sa_remover_logo: SÓ super-admin (admin do cliente, inclusive o da própria empresa,
 *   = 42501); sessão inválida = 28000; tenant nulo = 22023, inexistente/apagado = P0002; forma = 22023; CHECK = 23514;
 *   idempotentes (igual não muda a linha nem audita) e auditados sem bytes; chave_anterior para a API apagar o objeto antigo;
 * - isolamento: o macuxi_app do tenant B não lê a logo nem o nome fantasia do A (RLS isolamento_tenant da 0001) e não grava;
 * - up/down: a 0081 só acrescenta; o down volta exatamente ao catálogo da migração anterior.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero) no CI.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { tenant } from '../esquema/plataforma';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0081, FUNCOES_SA_ATUAIS, MARCA_INTERNA_0081 } from './funcoes-sa';
import { comoPapel, emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0081';
const m81 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m81) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m81.up);
const down = semComentarios(m81.down);
/** Bloco de uma função até o "$$;" que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^ {0,2}\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const COLUNAS = [
  'nome_fantasia', 'logo_id', 'logo_tipo', 'logo_sha256', 'logo_tamanho_bytes', 'logo_largura_px', 'logo_altura_px', 'logo_chave',
  'logo_atualizada_em',
] as const;
const LER = 'create function plataforma.sa_marca_da_empresa(p_sid uuid, p_tenant uuid)';
const NOME = 'create function plataforma.sa_gravar_nome_fantasia(p_sid uuid, p_tenant uuid, p_nome text)';
const GRAVAR = 'create function plataforma.sa_gravar_logo(p_sid uuid, p_tenant uuid, p jsonb)';
const REMOVER = 'create function plataforma.sa_remover_logo(p_sid uuid, p_tenant uuid)';
const INTERNA = 'create function plataforma.marca_da_empresa_json(p_tenant uuid)';
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const SEM_TENANT = '00000000-0000-4000-8000-000000000081';

describe('0081 logo do cliente (estático)', () => {
  it('nome e posição: 0081_plataforma_tenant_logo', () => {
    expect(m81.nome).toBe('plataforma_tenant_logo');
  });

  it('colunas: as 9 em plataforma.tenant, nulas, com o espelho Drizzle; CHECKs do desenho; nenhum índice, política ou grant novo', () => {
    for (const c of COLUNAS) {
      expect(up, c).toMatch(new RegExp(`^alter table plataforma\\.tenant add column ${c} (text|uuid|integer|timestamptz);$`, 'm'));
      expect(Object.keys(tenant), c).toContain(c);
    }
    expect(up.match(/add column/g)).toHaveLength(COLUNAS.length);
    expect(up).not.toMatch(/add column [a-z_0-9]+ [a-z]+ (not null|default)/);
    expect(up).toContain("nome_fantasia = btrim(nome_fantasia) and nome_fantasia <> '' and char_length(nome_fantasia) <= 80");
    expect(up).toContain("logo_tipo in ('image/png', 'image/jpeg')");
    expect(up).toContain("logo_sha256 ~ '^[0-9a-f]{64}$'");
    expect(up).toContain('logo_tamanho_bytes between 1 and 1048576');
    expect(up).toContain('logo_largura_px between 1 and 4096');
    expect(up).toContain('logo_altura_px between 200 and 4096');
    expect(up).toContain("'^' || id::text || '/plataforma/[0-9]{4}-(0[1-9]|1[0-2])/' || coalesce(logo_id::text, '-') || '\\.(png|jpg)$'");
    expect(up).toContain("(logo_chave like '%.png') = (logo_tipo is not distinct from 'image/png')");
    expect(up).toContain(
      'num_nulls(logo_id, logo_tipo, logo_sha256, logo_tamanho_bytes, logo_largura_px, logo_altura_px, logo_chave, logo_atualizada_em) in (0, 8)',
    );
    expect(up).not.toMatch(/create (unique )?index|create policy|alter policy|create table/);
    expect(up).not.toMatch(/grant [a-z, ()_]+ on plataforma\.tenant to/);
  });

  it('funções: SECURITY DEFINER com search_path fixo; só ao portal; sessão (28000), tenant (22023/P0002) e perfil (42501)', () => {
    for (const inicio of [LER, NOME, GRAVAR, REMOVER]) {
      const b = bloco(up, inicio);
      expect(b, inicio).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
      expect(b, inicio).toContain('from plataforma.sa_sessao_valida(p_sid) v;');
      expect(b, inicio).toContain("using errcode = '28000';");
      expect(b, inicio).toContain("using errcode = '42501';");
      expect(b, inicio).toContain("using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';");
      expect(b, inicio).toContain('t.deleted_at is null');
      expect(b, inicio).toContain('return plataforma.marca_da_empresa_json(p_tenant)');
      // a sessão e o perfil vêm ANTES de qualquer leitura da empresa (admin de outra empresa não descobre se ela existe)
      expect(b.indexOf("'42501'"), inicio).toBeLessThan(b.indexOf('from plataforma.tenant t'));
    }
    // gravar: só o super-admin (decisão do gerente, RN-CORE-33); ler: super-admin ou admin da empresa atual da sessão
    for (const inicio of [NOME, GRAVAR, REMOVER]) {
      expect(bloco(up, inicio), inicio).toContain("if v_tipo is distinct from 'super_admin' or v_sa is null then");
      expect(bloco(up, inicio), inicio).not.toContain('admin_cliente');
    }
    expect(bloco(up, LER)).toContain("if not ((v_tipo = 'super_admin' and v_sa is not null) or (v_tipo = 'admin_cliente' and v_tenant_sessao = p_tenant)) then");
    for (const f of FUNCOES_SA_0081) {
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(up.match(/\bgrant\b/g)).toHaveLength(FUNCOES_SA_0081.length);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_0081]));
    // a interna: invoker, sem EXECUTE para ninguém além do dono; a forma do jsonb num lugar só
    expect(bloco(up, INTERNA)).toMatch(/language sql stable security invoker\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    expect(up).toContain(`revoke all on function ${MARCA_INTERNA_0081} from public;`);
    expect(up.match(/jsonb_build_object\(\s*'tenant_id'/g)).toHaveLength(1);
  });

  it('gravar logo: exatamente as 7 chaves (22023); idempotente pelo sha256 antes do update; audita sem bytes; chave_anterior', () => {
    const b = bloco(up, GRAVAR);
    expect(b).toContain("is distinct from array['altura_px', 'chave', 'id', 'largura_px', 'sha256', 'tamanho_bytes', 'tipo'] then");
    expect(b).toContain("using errcode = '22023';");
    expect(b).toContain('for update;');
    expect(b.indexOf("v_atual.logo_sha256 is not distinct from (p ->> 'sha256')")).toBeLessThan(b.indexOf('update plataforma.tenant'));
    expect(b.indexOf("v_atual.logo_sha256 is not distinct from (p ->> 'sha256')")).toBeLessThan(b.indexOf('sa_registrar_auditoria('));
    expect(b).toContain("'sa.empresa.logo.gravar'");
    expect(b).toContain("jsonb_build_object('sha256_antes', v_atual.logo_sha256, 'sha256_depois', p ->> 'sha256')");
    expect(b).toContain("jsonb_build_object('chave_anterior', v_atual.logo_chave)");
    expect(b).toContain('logo_atualizada_em = now()');
    const r = bloco(up, REMOVER);
    expect(r.indexOf('if v_atual.logo_chave is null then')).toBeLessThan(r.indexOf('update plataforma.tenant'));
    expect(r).toContain("'sa.empresa.logo.remover'");
    const n = bloco(up, NOME);
    expect(n.indexOf('if v_antes is not distinct from p_nome then')).toBeLessThan(n.indexOf('update plataforma.tenant'));
    expect(n).toContain("'sa.empresa.nome_fantasia'");
    expect(n).toContain('for update;');
  });

  it('down: apaga as 5 funções e as 9 colunas, sem criar nada', () => {
    for (const f of [...FUNCOES_SA_0081, MARCA_INTERNA_0081]) expect(down).toContain(`drop function if exists ${f};`);
    for (const c of COLUNAS) expect(down).toContain(`alter table plataforma.tenant drop column if exists ${c};`);
    expect(down).not.toMatch(/create |grant /);
  });
});

describe.skipIf(semBanco())('0081 logo do cliente (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  type Marca = {
    tenant_id: string;
    razao_social: string;
    nome_fantasia: string | null;
    logo: null | { sha256: string; tipo: string; tamanho_bytes: number; largura_px: number; altura_px: number; atualizada_em: string; chave: string };
    chave_anterior?: string | null;
  };
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => comoPapel<T>(admin, 'macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.0081@macuxi.exemplo', nome: 'Operador 0081', senha_hash: HASH_TESTE })]))[0]!.r;
    return { sid: await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }), sa: sa.super_admin_id };
  }
  const um = async (sql: string, params: unknown[]) => (await portal<{ r: Marca }>(sql, params))[0]!.r;
  const ler = (sid: string, t: string | null) => um('select plataforma.sa_marca_da_empresa($1, $2) as r', [sid, t]);
  const nome = (sid: string, t: string | null, n: string | null) => um('select plataforma.sa_gravar_nome_fantasia($1, $2, $3) as r', [sid, t, n]);
  const gravar = (sid: string, t: string | null, p: unknown) => um('select plataforma.sa_gravar_logo($1, $2, $3::jsonb) as r', [sid, t, JSON.stringify(p)]);
  const remover = (sid: string, t: string | null) => um('select plataforma.sa_remover_logo($1, $2) as r', [sid, t]);
  const auditorias = (sid: string, acao: string) =>
    q<{ detalhes: Record<string, unknown>; super_admin_id: string; tenant_alvo_id: string | null }>(
      'select detalhes, super_admin_id, tenant_alvo_id from plataforma.auditoria_plataforma where acao = $1 and sessao_id = $2 order by ocorrido_em, id',
      [acao, sid],
    );
  const logo = (t: string, n: number, extra: Record<string, unknown> = {}) => {
    const id = `00000000-0000-4000-8000-0000000081${String(n).padStart(2, '0')}`;
    return { id, tipo: 'image/png', sha256: String(n % 10).repeat(64), tamanho_bytes: 50_000, largura_px: 600, altura_px: 200, chave: `${t}/plataforma/2026-11/${id}.png`, ...extra };
  };

  it('portal: sessão inválida = 28000; tenant nulo = 22023; inexistente = P0002; app e worker não executam (42501)', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      for (const chamar of [
        () => ler(SEM_TENANT, A), () => nome(SEM_TENANT, A, 'X'), () => gravar(SEM_TENANT, A, logo(A, 1)), () => remover(SEM_TENANT, A),
      ]) expect((await erroDe(chamar()))?.code).toBe('28000');
      for (const chamar of [() => ler(sid, null), () => nome(sid, null, 'X'), () => gravar(sid, null, logo(A, 1)), () => remover(sid, null)]) {
        expect((await erroDe(chamar()))?.code).toBe('22023');
      }
      for (const chamar of [() => ler(sid, SEM_TENANT), () => nome(sid, SEM_TENANT, 'X'), () => gravar(sid, SEM_TENANT, logo(SEM_TENANT, 1)), () => remover(sid, SEM_TENANT)]) {
        expect((await erroDe(chamar()))?.code).toBe('P0002');
      }
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        for (const sql of [
          'select plataforma.sa_marca_da_empresa(null, null)', 'select plataforma.sa_gravar_nome_fantasia(null, null, null)',
          "select plataforma.sa_gravar_logo(null, null, '{}')", 'select plataforma.sa_remover_logo(null, null)',
          'select plataforma.marca_da_empresa_json(null)',
        ]) expect((await erroDe(comoPapel(admin, papel, sql, [], A)))?.code, `${papel}: ${sql}`).toBe('42501');
      }
      expect((await erroDe(portal('select plataforma.marca_da_empresa_json($1)', [A])))?.code).toBe('42501');
      // apagada (deleted_at) = não encontrada
      await q('update plataforma.tenant set deleted_at = now() where id = $1', [B]);
      expect((await erroDe(ler(sid, B)))?.code).toBe('P0002');
    });
  });

  it('admin do cliente: lê a própria empresa; nunca a outra (42501); não grava nada, nem na própria (42501)', async () => {
    await emTransacao(admin, null, async () => {
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      const razaoA = (await q<{ nome: string }>('select nome from plataforma.tenant where id = $1', [A]))[0]!.nome;
      expect(await ler(cli, A)).toEqual({ tenant_id: A, razao_social: razaoA, nome_fantasia: null, logo: null });
      expect((await erroDe(ler(cli, B)))?.code).toBe('42501');
      expect((await erroDe(ler(cli, SEM_TENANT)))?.code).toBe('42501');
      for (const t of [A, B]) {
        expect((await erroDe(nome(cli, t, 'Fantasia')))?.code, t).toBe('42501');
        expect((await erroDe(gravar(cli, t, logo(t, 1))))?.code, t).toBe('42501');
        expect((await erroDe(remover(cli, t)))?.code, t).toBe('42501');
      }
      expect(await q("select count(*)::int as n from plataforma.auditoria_plataforma where acao like 'sa.empresa.%' and sessao_id = $1", [cli])).toEqual([{ n: 0 }]);
    });
  });

  it('nome fantasia: grava, idempotente (não muda a linha nem audita), apaga com null; CHECK = 23514', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, sa } = await sessaoSuperAdmin();
      expect((await nome(sid, A, 'Distribuidora Macuxi')).nome_fantasia).toBe('Distribuidora Macuxi');
      const [l1] = await q<{ updated_at: Date }>('select updated_at from plataforma.tenant where id = $1', [A]);
      expect((await nome(sid, A, 'Distribuidora Macuxi')).nome_fantasia).toBe('Distribuidora Macuxi');
      expect((await q<{ updated_at: Date }>('select updated_at from plataforma.tenant where id = $1', [A]))[0]!.updated_at).toEqual(l1!.updated_at);
      expect(await auditorias(sid, 'sa.empresa.nome_fantasia')).toEqual([
        { super_admin_id: sa, tenant_alvo_id: A, detalhes: { antes: null, depois: 'Distribuidora Macuxi', origem: 'banco' } },
      ]);
      expect((await nome(sid, A, null)).nome_fantasia).toBeNull();
      expect(await auditorias(sid, 'sa.empresa.nome_fantasia')).toHaveLength(2);
      for (const ruim of ['', ' Com espaço', 'Com espaço ', 'x'.repeat(81)]) {
        expect((await erroDe(nome(sid, A, ruim)))?.code, JSON.stringify(ruim)).toBe('23514');
      }
      expect((await nome(sid, A, 'x'.repeat(80))).nome_fantasia).toHaveLength(80);
      // o B não muda
      expect((await ler(sid, B)).nome_fantasia).toBeNull();
    });
  });

  it('logo: grava, idempotente pelo sha256, troca devolve chave_anterior, remove (idempotente); auditada sem bytes', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, sa } = await sessaoSuperAdmin();
      const l1 = logo(A, 1);
      const r1 = await gravar(sid, A, l1);
      expect(r1.chave_anterior).toBeNull();
      expect(r1.logo).toMatchObject({ sha256: l1.sha256, tipo: 'image/png', tamanho_bytes: 50_000, largura_px: 600, altura_px: 200, chave: l1.chave });
      expect(r1.logo!.atualizada_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Object.keys(r1.logo!).sort()).toEqual(['altura_px', 'atualizada_em', 'chave', 'largura_px', 'sha256', 'tamanho_bytes', 'tipo']);
      expect(Object.keys(await ler(sid, A)).sort()).toEqual(['logo', 'nome_fantasia', 'razao_social', 'tenant_id']);

      // mesma imagem (mesmo sha256) com outra chave: nada muda nem audita; a resposta traz a chave GRAVADA
      const igual = logo(A, 11, { sha256: l1.sha256 });
      const r2 = await gravar(sid, A, igual);
      expect(r2.chave_anterior).toBeNull();
      expect(r2.logo!.chave).toBe(l1.chave);
      expect(await auditorias(sid, 'sa.empresa.logo.gravar')).toHaveLength(1);

      // troca: JPG; devolve a chave anterior
      const l2 = logo(A, 2, { tipo: 'image/jpeg', chave: `${A}/plataforma/2026-12/00000000-0000-4000-8000-000000008102.jpg`, largura_px: 4096, altura_px: 4096, tamanho_bytes: 1_048_576 });
      const r3 = await gravar(sid, A, l2);
      expect(r3.chave_anterior).toBe(l1.chave);
      expect(r3.logo).toMatchObject({ tipo: 'image/jpeg', chave: l2.chave, sha256: l2.sha256 });
      expect(await auditorias(sid, 'sa.empresa.logo.gravar')).toEqual([
        { super_admin_id: sa, tenant_alvo_id: A, detalhes: { sha256_antes: null, sha256_depois: l1.sha256, origem: 'banco' } },
        { super_admin_id: sa, tenant_alvo_id: A, detalhes: { sha256_antes: l1.sha256, sha256_depois: l2.sha256, origem: 'banco' } },
      ]);

      // remover: chave_anterior; de novo = nada muda nem audita
      const r4 = await remover(sid, A);
      expect(r4).toMatchObject({ logo: null, chave_anterior: l2.chave });
      expect(await q('select num_nulls(logo_id, logo_tipo, logo_sha256, logo_tamanho_bytes, logo_largura_px, logo_altura_px, logo_chave, logo_atualizada_em) as n from plataforma.tenant where id = $1', [A])).toEqual([{ n: 8 }]);
      expect(await remover(sid, A)).toMatchObject({ logo: null, chave_anterior: null });
      expect(await auditorias(sid, 'sa.empresa.logo.remover')).toEqual([
        { super_admin_id: sa, tenant_alvo_id: A, detalhes: { sha256_antes: l2.sha256, origem: 'banco' } },
      ]);
    });
  });

  it('logo: forma = 22023; fora dos CHECKs = 23514 (faixas, tipo, sha, chave de outro tenant ou de outra logo, extensão)', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      const l = logo(A, 3);
      const { chave: _c, ...semChave } = l;
      for (const ruim of [
        null, [], 'x', {}, semChave, { ...l, extra: 1 }, { ...l, id: 'nao-uuid' }, { ...l, id: l.id.toUpperCase() }, { ...l, tipo: null },
        { ...l, sha256: 1 }, { ...l, chave: null }, { ...l, tamanho_bytes: '50000' }, { ...l, largura_px: 600.5 }, { ...l, altura_px: 1e10 },
      ]) expect((await erroDe(gravar(sid, A, ruim)))?.code, JSON.stringify(ruim)).toBe('22023');
      for (const ruim of [
        { ...l, tipo: 'image/gif' },
        { ...l, sha256: 'A'.repeat(64) },
        { ...l, sha256: '3'.repeat(63) },
        { ...l, tamanho_bytes: 0 },
        { ...l, tamanho_bytes: 1_048_577 },
        { ...l, largura_px: 0 },
        { ...l, largura_px: 4097 },
        { ...l, altura_px: 199 },
        { ...l, altura_px: 4097 },
        { ...l, altura_px: -1 },
        { ...l, chave: `${B}/plataforma/2026-11/${l.id}.png` }, // chave de outro tenant
        { ...l, chave: `${A}/plataforma/2026-11/00000000-0000-4000-8000-000000009999.png` }, // de outra logo
        { ...l, chave: `${A}/core/2026-11/${l.id}.png` },
        { ...l, chave: `${A}/plataforma/2026-13/${l.id}.png` },
        { ...l, chave: `${A}/plataforma/2026-11/${l.id}.jpg` }, // extensão diferente do tipo
        { ...l, tipo: 'image/jpeg' }, // idem
        { ...l, chave: `${A}/plataforma/2026-11/${l.id}.png/../x` },
      ]) expect((await erroDe(gravar(sid, A, ruim)))?.code, JSON.stringify(ruim)).toBe('23514');
      expect((await ler(sid, A)).logo).toBeNull();
      expect(await auditorias(sid, 'sa.empresa.logo.gravar')).toHaveLength(0);
      // tudo ou nada direto na tabela (o dono do banco não passa pela função)
      expect((await erroDe(q('update plataforma.tenant set logo_sha256 = $2 where id = $1', [A, '4'.repeat(64)])))?.code).toBe('23514');
    });
  });

  it('isolamento: o macuxi_app de cada tenant lê só a própria marca e não grava nenhuma', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await sessaoSuperAdmin();
      await gravar(sid, A, logo(A, 5));
      await nome(sid, A, 'Fantasia A');
      const comoApp = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_app', sql, p, t).then((r) => r.rows);
      const sel = `select id, ${COLUNAS.join(', ')} from plataforma.tenant`;
      // B: nem a linha do A aparece, nem filtrando pelo id
      expect((await comoApp(B, sel)).map((x) => x.id)).toEqual([B]);
      expect(await comoApp(B, `${sel} where id = $1`, [A])).toEqual([]);
      expect((await comoApp(B, sel))[0]).toMatchObject({ nome_fantasia: null, logo_chave: null, logo_sha256: null });
      // A: a própria, com a logo e o nome
      expect((await comoApp(A, sel))).toEqual([expect.objectContaining({ id: A, nome_fantasia: 'Fantasia A', logo_sha256: '5'.repeat(64) })]);
      // contexto vazio: nada
      expect(await comoApp('', sel)).toEqual([]);
      // ninguém da aplicação grava direto
      for (const t of [A, B]) {
        expect((await erroDe(comoApp(t, "update plataforma.tenant set nome_fantasia = 'X'")))?.code, t).toBe('42501');
      }
      // o portal não lê a tabela direto (só pelas funções)
      expect((await erroDe(portal('select nome_fantasia from plataforma.tenant')))?.code).toBe('42501');
    });
  });
});

describe.skipIf(semBanco())('0081 logo do cliente (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; down volta exatamente ao catálogo anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual(['0081_plataforma_tenant_logo']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      for (const col of COLUNAS) expect(novos.some((x) => x.startsWith(`col plataforma.tenant.${col} `)), col).toBe(true);
      expect(novos.filter((x) => x.startsWith('fn '))).toHaveLength(5);
      expect(novos.filter((x) => x.startsWith('idx ') || x.startsWith('pol ') || x.startsWith('rel '))).toEqual([]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0081_plataforma_tenant_logo']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
