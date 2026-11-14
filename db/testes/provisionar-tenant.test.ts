/**
 * 0029 — plataforma.provisionar_tenant(jsonb) (T-0083, RN-CORE-31; pedido R-20261105-060454-engenheiro-software; desenho
 * T-0083 §5). O que o BANCO garante:
 * - cria, numa chamada, tenant + licenças + perfis por módulo + admin inicial; os gatilhos da 0006/0018/0037 semeiam motivos,
 *   parâmetros de sempre, medidas e a forma e o prazo "À vista" (P7 da T-0089) como em qualquer tenant (a função não grava
 *   parâmetro nenhum);
 * - idempotente pelo código: 2x a mesma entrada = mesmas contagens em TODAS as tabelas com tenant_id; tenant existente não
 *   muda (aviso); só módulos que faltam entram, com os perfis; perfis de módulo existente não são tocados;
 * - redefinir_senha troca o senha_hash (e, desde a 0040, sobe a sessao_versao e volta a trocar_senha); sem ela a senha fica;
 * - uma linha de auditoria 'tenant.provisionar' (ator nulo) quando algo muda, sem e-mail, nome ou hash;
 * - entrada inválida = 22023 sem e-mail nem hash na mensagem; tenant encerrado = 55000;
 * - SECURITY INVOKER, search_path fixo, sem EXECUTE para PUBLIC, macuxi_app e macuxi_worker (42501).
 * Banco: fixture dois-tenants, sempre com ROLLBACK (admin); up/down num banco efêmero. Nada roda em base real.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idDeChave } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo, tabelasComTenant } from './util';

const migracoes = lerMigracoes();
const m29 = migracoes.find((m) => m.versao === '0029')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

/** Hashes argon2id de mentira (formato PHC válido; nunca uma senha real). */
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
const H2 = '$argon2id$v=19$m=1,t=1,p=1$c2FsZG9pcw$aGFzaGRvaXM';
const EMAIL = 'fulana.admin@distribuidora-t29.com.br';
const NOME_ADMIN = 'Fulana Provisionada';

interface Saida {
  tenant_id: string;
  /** desde a 0068: o código do tenant (o informado ou o número da licença gerado) */
  codigo: string;
  resultado: 'criado' | 'atualizado' | 'sem_mudanca';
  modulos_adicionados: string[];
  admin: 'criado' | 'existente' | 'senha_redefinida';
  avisos: string[];
}

const TODOS = ['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
const MODULOS = [
  { modulo: 'core', licencas: null, perfis: TODOS },
  { modulo: 'catalogo', licencas: null, perfis: TODOS },
  { modulo: 'vendedor', licencas: 20, perfis: ['admin', 'analista', 'supervisor', 'gerente', 'vendedor'] },
];
function entrada(codigo: string, extra: Record<string, unknown> = {}, admin: Record<string, unknown> = {}) {
  return {
    codigo, nome: 'Distribuidora T29', documento: null, fuso: 'America/Manaus', plano: 'piloto', modulos: MODULOS,
    admin: { email: EMAIL, nome: NOME_ADMIN, senha_hash: H1, ...admin }, redefinir_senha: false, ...extra,
  };
}

describe('0029 provisionar_tenant (estático)', () => {
  it('nome e posição: 0029_plataforma_provisionar_tenant logo depois da 0028', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0028_core_plano_rv') + 1]).toBe('0029_plataforma_provisionar_tenant');
  });

  it('SECURITY INVOKER, search_path com pg_temp por último, sem grant algum, nenhuma linha de parâmetro', () => {
    const sql = semComentarios(m29.up);
    expect(sql).toMatch(/create function plataforma\.provisionar_tenant\(p jsonb\)\s+returns jsonb\s+language plpgsql volatile security invoker\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toContain('revoke all on function plataforma.provisionar_tenant(jsonb) from public;');
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/insert into plataforma\.parametro/);
    expect(sql).toContain('on conflict ((lower(codigo))) do nothing');
    expect(sql).not.toMatch(/create (table|policy|index)|alter (table|policy)|drop (table|policy)/);
  });

  it('idempotente: drop if exists antes do create; down apaga a função (if exists)', () => {
    const sql = semComentarios(m29.up);
    const drop = sql.indexOf('drop function if exists plataforma.provisionar_tenant(jsonb);');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(sql.indexOf('create function plataforma.provisionar_tenant('));
    expect(semComentarios(m29.down).trim()).toBe('drop function if exists plataforma.provisionar_tenant(jsonb);');
  });
});

describe.skipIf(semBanco())('0029 provisionar_tenant (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const provisionar = async (e: unknown): Promise<Saida> =>
    (await admin.query<{ r: Saida }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(e)])).rows[0]!.r;
  /** Contagem por tabela com tenant_id (todas as schemas) + a linha do tenant, para comparar duas chamadas. */
  const retratoDoTenant = async (tenant: string): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    for (const t of await tabelasComTenant(admin)) {
      out[t.nome] = (await admin.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [tenant])).rows[0]!.n;
    }
    out['plataforma.tenant'] = (await admin.query('select * from plataforma.tenant where id = $1', [tenant])).rows;
    out['core.usuario.linhas'] = (await admin.query('select * from core.usuario where tenant_id = $1 order by id', [tenant])).rows;
    return out;
  };

  it('cria tenant, licenças, perfis e admin; semeadura dos gatilhos igual à de um tenant comum; auditoria sem dado pessoal', async () => {
    await emTransacao(admin, null, async () => {
      const r = await provisionar(entrada('t29-cria'));
      expect(r).toEqual({ tenant_id: expect.any(String), codigo: 't29-cria', resultado: 'criado', modulos_adicionados: ['catalogo', 'core', 'vendedor'], parametros_gravados: [], admin: 'criado', avisos: [] });
      const t = (await admin.query('select codigo, nome, documento, fuso, plano, status from plataforma.tenant where id = $1', [r.tenant_id])).rows;
      expect(t).toEqual([{ codigo: 't29-cria', nome: 'Distribuidora T29', documento: null, fuso: 'America/Manaus', plano: 'piloto', status: 'ativo' }]);
      const tm = await admin.query('select modulo, ativo, licencas, ativado_em is not null as ativado from plataforma.tenant_modulo where tenant_id = $1 order by modulo', [r.tenant_id]);
      expect(tm.rows).toEqual([
        { modulo: 'catalogo', ativo: true, licencas: null, ativado: true },
        { modulo: 'core', ativo: true, licencas: null, ativado: true },
        { modulo: 'vendedor', ativo: true, licencas: 20, ativado: true },
      ]);
      const pm = await admin.query<{ modulo: string; perfis: string[] }>(
        'select modulo, array_agg(perfil order by perfil) as perfis from plataforma.perfil_modulo where tenant_id = $1 group by modulo order by modulo',
        [r.tenant_id],
      );
      expect(pm.rows).toEqual(MODULOS.map((m) => ({ modulo: m.modulo, perfis: [...m.perfis].sort() })).sort((a, b) => a.modulo.localeCompare(b.modulo)));
      const u = await admin.query('select nome, email, perfil, equipe_id, ativo, bloqueado_em, senha_hash from core.usuario where tenant_id = $1', [r.tenant_id]);
      expect(u.rows).toEqual([{ nome: NOME_ADMIN, email: EMAIL, perfil: 'admin', equipe_id: null, ativo: true, bloqueado_em: null, senha_hash: H1 }]);

      // controle: tenant inserido direto (só os gatilhos) tem os mesmos motivos, parâmetros, medidas, formas e prazos
      const controle = (await admin.query<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t29-controle', 'Controle') returning id")).rows[0]!.id;
      // ids determinísticos por tenant (0037: uuid_de_chave('<tenant>:vendedor.forma_pagamento:<codigo>')): compara o "id gêmeo"
      const gemeo = (tenant: string, tabela: string, codigo: string, id: string) => id === idDeChave(`${tenant}:vendedor.${tabela}:${codigo}`);
      const semeado = async (tenant: string) => ({
        motivos: (await admin.query('select tipo, codigo from core.motivo where tenant_id = $1 order by 1, 2', [tenant])).rows,
        parametros: (await admin.query('select modulo, chave, valor from plataforma.parametro where tenant_id = $1 order by 1, 2', [tenant])).rows,
        medidas: (await admin.query('select sigla from core.medida where tenant_id = $1 order by 1', [tenant])).rows,
        formas: (
          await admin.query<{ id: string; codigo: string }>(
            'select id, codigo, nome, ativo, ordem, external_id, deleted_at from vendedor.forma_pagamento where tenant_id = $1 order by codigo',
            [tenant],
          )
        ).rows.map((f) => ({ ...f, id: gemeo(tenant, 'forma_pagamento', f.codigo, f.id) })),
        prazos: (
          await admin.query<{ id: string; codigo: string; forma_codigo: string; forma_pagamento_id: string }>(
            `select p.id, p.codigo, p.descricao, p.parcelas_dias, p.prazo_medio_dias, p.ativo, p.ordem, p.external_id, p.deleted_at, f.codigo as forma_codigo,
                    p.forma_pagamento_id
               from vendedor.prazo_pagamento p join vendedor.forma_pagamento f on f.tenant_id = p.tenant_id and f.id = p.forma_pagamento_id
              where p.tenant_id = $1 order by p.codigo`,
            [tenant],
          )
        ).rows.map((p) => ({ ...p, id: gemeo(tenant, 'prazo_pagamento', p.codigo, p.id), forma_pagamento_id: gemeo(tenant, 'forma_pagamento', p.forma_codigo, p.forma_pagamento_id) })),
      });
      const doProvisionado = await semeado(r.tenant_id);
      expect(doProvisionado.motivos.length).toBeGreaterThan(0);
      expect(doProvisionado.medidas.length).toBeGreaterThan(0);
      // P7 (T-0089): o tenant de tenant:criar / passo Empresa nasce podendo tirar pedido — forma e prazo "À vista"
      expect(doProvisionado.formas).toEqual([{ id: true, codigo: 'AVISTA', nome: 'À vista', ativo: true, ordem: 0, external_id: null, deleted_at: null }]);
      expect(doProvisionado.prazos).toEqual([
        { id: true, codigo: 'AVISTA', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, ordem: 0, external_id: null, deleted_at: null,
          forma_codigo: 'AVISTA', forma_pagamento_id: true },
      ]);
      expect(doProvisionado).toEqual(await semeado(controle));

      const aud = await admin.query<{ usuario_id: string | null; modulo: string; entidade: string; entidade_id: string; antes: unknown; depois: unknown }>(
        "select usuario_id, modulo, entidade, entidade_id, antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'tenant.provisionar'",
        [r.tenant_id],
      );
      expect(aud.rows).toEqual([{ usuario_id: null, modulo: 'core', entidade: 'tenant', entidade_id: r.tenant_id, antes: null,
        depois: { resultado: 'criado', modulos_adicionados: ['catalogo', 'core', 'vendedor'], admin: 'criado' } }]);
      const texto = JSON.stringify(aud.rows);
      for (const segredo of [EMAIL, NOME_ADMIN, H1, 'argon2id']) expect(texto).not.toContain(segredo);
      // contexto restaurado (estava vazio)
      expect((await admin.query<{ c: string | null }>("select nullif(current_setting('app.tenant_id', true), '') as c")).rows[0]!.c).toBeNull();
    });
  });

  it('2x a mesma entrada: sem_mudanca, mesmas contagens em todas as tabelas, tenant e usuário intactos, sem 2ª auditoria', async () => {
    await emTransacao(admin, null, async () => {
      const r1 = await provisionar(entrada('t29-idem'));
      const antes = await retratoDoTenant(r1.tenant_id);
      const r2 = await provisionar(entrada('t29-idem'));
      expect(r2).toEqual({ tenant_id: r1.tenant_id, codigo: 't29-idem', resultado: 'sem_mudanca', modulos_adicionados: [], parametros_gravados: [], admin: 'existente', avisos: [] });
      expect(await retratoDoTenant(r1.tenant_id)).toEqual(antes);
      // código com maiúsculas no banco não existe (CHECK), mas a busca é sem diferenciar: o mesmo tenant
      expect((await admin.query('select count(*)::int as n from plataforma.tenant where lower(codigo) = $1', ['t29-idem'])).rows[0].n).toBe(1);
    });
  });

  it('tenant existente: nome/fuso/plano não mudam (aviso); módulo novo entra com perfis; perfis personalizados ficam', async () => {
    await emTransacao(admin, null, async () => {
      const r1 = await provisionar(entrada('t29-mod'));
      // o tenant tirou o Catálogo do assistente (personalização)
      await admin.query("delete from plataforma.perfil_modulo where tenant_id = $1 and modulo = 'catalogo' and perfil = 'assistente'", [r1.tenant_id]);
      const tenantAntes = (await admin.query('select * from plataforma.tenant where id = $1', [r1.tenant_id])).rows;
      const r2 = await provisionar(entrada('t29-mod', {
        nome: 'Outro Nome', fuso: 'America/Sao_Paulo', plano: 'pro',
        modulos: [...MODULOS, { modulo: 'pesquisa', licencas: 5, perfis: ['supervisor', 'vendedor', 'promotor'] }],
      }));
      expect(r2.resultado).toBe('atualizado');
      expect(r2.modulos_adicionados).toEqual(['pesquisa']);
      expect(r2.admin).toBe('existente');
      expect(r2.avisos).toEqual(['tenant existente: nome, fuso, plano não mudam']);
      expect((await admin.query('select * from plataforma.tenant where id = $1', [r1.tenant_id])).rows).toEqual(tenantAntes);
      const pm = await admin.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where tenant_id = $1 and modulo = $2 order by 1", [r1.tenant_id, 'pesquisa']);
      expect(pm.rows.map((x) => x.perfil)).toEqual(['promotor', 'supervisor', 'vendedor']);
      const assistente = await admin.query("select 1 from plataforma.perfil_modulo where tenant_id = $1 and modulo = 'catalogo' and perfil = 'assistente'", [r1.tenant_id]);
      expect(assistente.rowCount).toBe(0);
      const lic = await admin.query("select licencas from plataforma.tenant_modulo where tenant_id = $1 and modulo = 'pesquisa'", [r1.tenant_id]);
      expect(lic.rows).toEqual([{ licencas: 5 }]);
      const aud = await admin.query(
        "select antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'tenant.provisionar' and depois ->> 'resultado' = 'atualizado'",
        [r1.tenant_id],
      );
      expect(aud.rows).toHaveLength(1);
      expect(aud.rows[0]).toEqual({ antes: { modulos: ['catalogo', 'core', 'vendedor'] }, depois: { resultado: 'atualizado', modulos_adicionados: ['pesquisa'], admin: 'existente' } });
    });
  });

  it('módulo existente desativado: não é religado (aviso), licenças não mudam', async () => {
    await emTransacao(admin, null, async () => {
      const r1 = await provisionar(entrada('t29-desl'));
      await admin.query("update plataforma.tenant_modulo set ativo = false, desativado_em = ativado_em where tenant_id = $1 and modulo = 'vendedor'", [r1.tenant_id]);
      const r2 = await provisionar(entrada('t29-desl', { modulos: MODULOS.map((m) => (m.modulo === 'vendedor' ? { ...m, licencas: 99 } : m)) }));
      expect(r2.resultado).toBe('sem_mudanca');
      expect(r2.avisos).toEqual(['módulo vendedor existe desativado: não é religado (BKO de licenças)']);
      const v = await admin.query("select ativo, licencas from plataforma.tenant_modulo where tenant_id = $1 and modulo = 'vendedor'", [r1.tenant_id]);
      expect(v.rows).toEqual([{ ativo: false, licencas: 20 }]);
    });
  });

  it('senha: sem redefinir_senha fica; com redefinir_senha troca SÓ o senha_hash; mesmo hash de novo = existente', async () => {
    await emTransacao(admin, null, async () => {
      const r1 = await provisionar(entrada('t29-senha'));
      const linha = async () => (await admin.query('select * from core.usuario where tenant_id = $1', [r1.tenant_id])).rows[0] as Record<string, unknown>;
      const antes = await linha();
      expect((await provisionar(entrada('t29-senha', {}, { senha_hash: H2, nome: 'Outro Nome' }))).admin).toBe('existente');
      expect(await linha()).toEqual(antes);
      const r3 = await provisionar(entrada('t29-senha', { redefinir_senha: true }, { senha_hash: H2, nome: 'Outro Nome' }));
      expect(r3).toMatchObject({ resultado: 'atualizado', admin: 'senha_redefinida', modulos_adicionados: [] });
      const depois = await linha();
      expect(depois.senha_hash).toBe(H2);
      // 0040: a redefinição também sobe a sessao_versao (tokens e sessão do portal caem) e volta a trocar_senha; o resto fica
      expect(depois.sessao_versao).toBe((antes.sessao_versao as number) + 1);
      expect(depois.trocar_senha).toBe(true);
      const semHash = (l: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(l).filter(([k]) => !['senha_hash', 'updated_at', 'sessao_versao', 'trocar_senha'].includes(k)));
      expect(semHash(depois)).toEqual(semHash(antes));
      const r4 = await provisionar(entrada('t29-senha', { redefinir_senha: true }, { senha_hash: H2 }));
      expect(r4).toMatchObject({ resultado: 'sem_mudanca', admin: 'existente' });
    });
  });

  it('e-mail já usado por um não-admin no tenant: mantém o usuário (aviso), não cria outro', async () => {
    await emTransacao(admin, null, async () => {
      const r1 = await provisionar(entrada('t29-perfil'));
      await admin.query("update core.usuario set perfil = 'analista' where tenant_id = $1", [r1.tenant_id]);
      const r2 = await provisionar(entrada('t29-perfil', {}, { email: EMAIL.toUpperCase() }));
      expect(r2.admin).toBe('existente');
      expect(r2.avisos).toEqual(['o usuário do e-mail informado tem perfil analista: o perfil não muda']);
      expect((await admin.query('select count(*)::int as n from core.usuario where tenant_id = $1', [r1.tenant_id])).rows[0].n).toBe(1);
    });
  });

  it.each([
    ['código com maiúscula', entrada('T29-Maiusc')],
    ['sem o core', entrada('t29-semcore', { modulos: MODULOS.filter((m) => m.modulo !== 'core') })],
    ['módulo repetido', entrada('t29-rep', { modulos: [...MODULOS, MODULOS[1]] })],
    ['vendedor para o promotor (RN-PRO-01)', entrada('t29-pro', { modulos: [...MODULOS.slice(0, 2), { modulo: 'vendedor', licencas: null, perfis: ['vendedor', 'promotor'] }] })],
    ['perfil desconhecido', entrada('t29-perf', { modulos: [{ modulo: 'core', licencas: null, perfis: ['dono'] }] })],
    ['licença negativa', entrada('t29-lic', { modulos: [{ modulo: 'core', licencas: -1, perfis: TODOS }] })],
    ['fuso desconhecido', entrada('t29-fuso', { fuso: 'Marte/Base_Alfa' })],
    ['nome vazio', entrada('t29-nome', { nome: '  ' })],
    ['hash que não é argon2id', entrada('t29-hash', {}, { senha_hash: 'senha-em-claro-123' })],
    ['e-mail inválido', entrada('t29-email', {}, { email: 'sem-arroba.com.br' })],
    ['sem admin', { ...entrada('t29-sem-admin'), admin: null }],
  ])('recusa %s com 22023, sem e-mail nem hash na mensagem, e nada grava', async (_caso, e) => {
    const erro = await erroDe(emTransacao(admin, null, () => provisionar(e)));
    expect(erro?.code).toBe('22023');
    for (const segredo of [EMAIL, H1, 'senha-em-claro-123']) expect(erro!.message).not.toContain(segredo);
    const n = await admin.query('select count(*)::int as n from plataforma.tenant where codigo like $1', ['t29-%']);
    expect(n.rows[0].n).toBe(0);
  });

  it('tenant encerrado ou excluído: 55000 e nada muda', async () => {
    for (const situacao of ["status = 'encerrado'", 'deleted_at = created_at']) {
      const erro = await erroDe(emTransacao(admin, null, async () => {
        const r = await provisionar(entrada('t29-fim'));
        await admin.query(`update plataforma.tenant set ${situacao} where id = $1`, [r.tenant_id]);
        await provisionar(entrada('t29-fim', { modulos: [...MODULOS, { modulo: 'pesquisa', licencas: null, perfis: ['vendedor'] }] }));
      }));
      expect(erro?.code).toBe('55000');
    }
  });

  it('macuxi_app (sem contexto e com o tenant A) e macuxi_worker não executam: 42501', async () => {
    const casos: Array<[string, string | null]> = [['macuxi_app', null], ['macuxi_app', DOIS_TENANTS.A.tenantId], ['macuxi_worker', null]];
    for (const [papel, contexto] of casos) {
      const erro = await erroDe(emTransacao(admin, contexto, async () => {
        await admin.query(`set local role ${papel}`);
        await provisionar(entrada('t29-papel'));
      }));
      expect(erro?.code, papel).toBe('42501');
    }
  });

  it('catálogo: SECURITY INVOKER, search_path fixo com pg_temp, sem EXECUTE de PUBLIC, app e worker', async () => {
    const r = await admin.query<{ definer: boolean; config: string[]; worker: boolean; app: boolean; publico: boolean }>(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('macuxi_worker', p.oid, 'execute') as worker,
              has_function_privilege('macuxi_app', p.oid, 'execute') as app,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as publico
         from pg_proc p where p.oid = 'plataforma.provisionar_tenant(jsonb)'::regprocedure`,
    );
    expect(r.rows).toEqual([{ definer: false, config: ['search_path=pg_catalog, plataforma, pg_temp'], worker: false, app: false, publico: false }]);
  });
});

describe.skipIf(semBanco())('0029 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0029_plataforma_provisionar_tenant') - 1]!.slice(0, 4);
  const desde0029 = nomes.filter((n) => n >= '0029');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria a função; up repetido não muda o catálogo; down volta exatamente ao catálogo da 0028', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0029);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(expect.arrayContaining(['fn plataforma.provisionar_tenant(p jsonb)']));
      await c.query(m29.up);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: desde0029.length })).aplicadas).toEqual([...desde0029].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m29.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
