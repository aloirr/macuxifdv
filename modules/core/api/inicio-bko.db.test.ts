/**
 * Início do BKO e horário da carga × Postgres real (fixture dois-tenants, RLS): RN-CORE-64, RN-CORE-65, RN-CORE-66, RN-CORE-04, RN-AUD-01 (T-0189).
 * O escopo vem dos serviços REAIS (`carteiraDoUsuario`, `usuariosVisiveisDoUsuario`). Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { AcessoBanco, ClienteBanco, ContextoBase, RotaModulo, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InicioBkoSchema, type HorarioCarga, type InicioBko } from '../contracts';
import { carteiraDoUsuario } from './carteira';
import { rotasDeInicioBko } from './inicio-bko';
import { rotasDeParametrosHorarioCarga } from './parametros-horario-carga';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const CHAVE = 'integracao.horario_carga';

describe.skipIf(semBanco())('Core T-0189 × Postgres: Início do BKO e horário da carga', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const gerente = usuario(U.gerente, 'gerente');
  const admin = usuario(U.admin, 'admin');
  const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);

  const ctx = (u: UsuarioAutenticado, requestId: string, modulos: readonly string[]): ContextoBase =>
    ({
      usuario: { ...u, modulos },
      requestId,
      agora: () => new Date('2026-11-20T15:00:00Z'),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, {})),
      carteira: () => carteiraDoUsuario(u, acesso),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    }) as unknown as ContextoBase;
  const inicio = async (u: UsuarioAutenticado, modulos: readonly string[]) => {
    const r: RotaModulo = rotasDeInicioBko[0]!;
    return InicioBkoSchema.parse(await r.executar({ ...ctx(u, 'req-inicio-bko', modulos), corpo: {}, query: {}, params: {} } as never)) as InicioBko;
  };
  const horario = (metodo: 'GET' | 'PUT', u: UsuarioAutenticado, requestId: string, corpo?: unknown) => {
    const r = rotasDeParametrosHorarioCarga.find((x) => x.metodo === metodo)!;
    return r.executar({ ...ctx(u, requestId, ['core']), corpo: r.corpo ? r.corpo.parse(corpo ?? {}) : {}, query: {}, params: {} } as never) as Promise<HorarioCarga>;
  };
  const linhas = (tenant: string) => comTenant(pool, tenant, async (c) => (await c.query("select valor from plataforma.parametro where modulo = 'core' and chave = $1 and deleted_at is null", [CHAVE])).rows);
  const auditorias = (tenant: string, requestId: string) => comTenant(pool, tenant, async (c) => (await c.query("select antes, depois from plataforma.auditoria where acao = 'parametro.inicio' and request_id = $1", [requestId])).rows);
  const limpar = async () => {
    for (const t of [A.tenantId, B.tenantId]) await comTenant(pool, t, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave in ($1, 'metas.feriados')", [CHAVE]));
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    await limpar();
  });
  afterAll(async () => {
    if (pool) {
      await limpar();
      await pool.end();
    }
  });

  it('RN-CORE-64: saudação e data no fuso do tenant; sem Integração licenciada não há configuração de carga; sem Vendedor, sem vendas e pedidos', async () => {
    const r = await inicio(admin, ['core']);
    expect(r.saudacao).toMatch(/^Bom dia, /);
    expect(r.data_extenso).toBe('Sexta, 20 de novembro');
    expect(r.carga).toBeNull();
    expect(r.hoje.vendas).toBeNull();
    expect(r.hoje.pedidos).toBeNull();
    expect(r.hoje.positivacao).toBeNull();
  });

  it('RN-CORE-65: com a Integração licenciada vem o horário padrão 06:00 e se hoje é dia útil', async () => {
    const r = await inicio(admin, ['core', 'integracao']);
    expect(r.carga).toEqual({ dia_util: true, horario: { padrao: '06:00', entidades: {} } });
  });

  it('RN-CORE-65: feriado cadastrado em metas.feriados não é dia útil (sem alerta de carga atrasada)', async () => {
    await comTenant(pool, A.tenantId, (c) => c.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', 'metas.feriados', $1::jsonb)", [JSON.stringify(['2026-11-20'])]));
    expect((await inicio(admin, ['core', 'integracao'])).carga?.dia_util).toBe(false);
    await limpar();
    expect((await inicio(admin, ['core', 'integracao'])).carga?.dia_util).toBe(true);
  });

  it('RN-CORE-04 / RN-CORE-66 / RN-CORE-64: o gerente conta só a carteira e as visitas da equipe dele; o admin vê o tenant; sem ação de usuários não há senha vencida', async () => {
    const ger = await inicio(gerente, ['core', 'vendedor']);
    const adm = await inicio(admin, ['core', 'vendedor']);
    expect(ger.cadastro_incompleto.quantidade).toBeLessThanOrEqual(adm.cadastro_incompleto.quantidade);
    expect(ger.hoje.visitas.planejadas).toBeLessThanOrEqual(adm.hoje.visitas.planejadas);
    expect(ger.usuarios_senha_vencida).toBeNull();
  });

  it('RN-CORE-65 / RN-AUD-01: o PUT grava o horário (auditado), é idempotente, isola o tenant e valida no domain', async () => {
    expect(await horario('GET', admin, 'r-padrao')).toEqual({ padrao: '06:00', entidades: {} });
    const novo = { padrao: '07:30', entidades: { cliente: '05:00', preco: null } };
    expect(await horario('PUT', admin, 'r-grava', novo)).toEqual(novo);
    expect(await horario('GET', admin, 'r-le')).toEqual(novo);
    expect(await horario('GET', adminB, 'r-b')).toEqual({ padrao: '06:00', entidades: {} });
    expect(await linhas(B.tenantId)).toEqual([]);
    const aud = await auditorias(A.tenantId, 'r-grava');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ antes: { horario_carga: { padrao: '06:00', entidades: {} } }, depois: { horario_carga: novo } });
    await horario('PUT', admin, 'r-repete', novo);
    expect(await auditorias(A.tenantId, 'r-repete')).toEqual([]);
    const e = await horario('PUT', admin, 'r-invalido', { padrao: '25:00', entidades: {} }).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-65' });
    expect(await linhas(A.tenantId)).toEqual([{ valor: novo }]);
    const dep = await inicio(admin, ['core', 'integracao']);
    expect(dep.carga?.horario).toEqual(novo);
  });
});
