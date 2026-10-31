/**
 * T-0002 C2.3 — o seed carrega os usuários fake da Fase M (cenários S0-031 a S0-034 do plano),
 * conferido como o PAPEL DA APLICAÇÃO (macuxi_app) e convivendo com a fixture dois-tenants
 * (três tenants no mesmo banco: o seed não pode vazar nem receber dado dos outros).
 *
 * Lista esperada escrita à mão a partir da Fase M (C:\Users\domon\dev\forca-vendas,
 * apps/mock-api/src/seed/generate.ts, lida só para consulta em 2026-10-31), e não do seed do banco:
 * 8 vendedores + gerente + analista + assistente + admin; perfis convertidos para os do
 * @macuxi/platform-sdk (seller→vendedor, manager→gerente, analyst→analista, bko_assistant→assistente).
 * Banco próprio (efêmero) para não alterar o banco compartilhado dos outros arquivos.
 */
import { carregarDoisTenants, carregarFaseM, comTenant, criarBancoDeTeste, DOIS_TENANTS, TENANT_FASE_M, type BancoDeTeste } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { PERFIS } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar } from '../apoio/banco';

/** [nome, e-mail, perfil na plataforma, equipe] — Fase M: generate.ts, specs e app_user. */
const USUARIOS_FASE_M: Array<[string, string, string, string | null]> = [
  ['Bruna Teixeira', 'bruna@exemplo.com.br', 'vendedor', 'Zona Sul'],
  ['Rafael Souza', 'rafael@exemplo.com.br', 'vendedor', 'Zona Norte'],
  ['Diego Martins', 'diego@exemplo.com.br', 'vendedor', 'Centro'],
  ['Carla Nogueira', 'carla@exemplo.com.br', 'vendedor', 'Interior'],
  ['Marcos Pereira', 'marcos@exemplo.com.br', 'vendedor', 'Zona Leste'],
  ['Lívia Rocha', 'livia@exemplo.com.br', 'vendedor', 'Zona Oeste'],
  ['Thiago Almeida', 'thiago@exemplo.com.br', 'vendedor', 'Interior'],
  ['Paula Vieira', 'paula@exemplo.com.br', 'vendedor', 'Zona Norte'],
  ['Fernando Lima', 'fernando@exemplo.com.br', 'gerente', null],
  ['Juliana Melo', 'juliana@exemplo.com.br', 'analista', null],
  ['Ana Costa', 'ana@exemplo.com.br', 'assistente', null],
  ['Patrícia Gomes', 'patricia@exemplo.com.br', 'admin', null],
];
const EQUIPES_FASE_M = ['Centro', 'Interior', 'Zona Leste', 'Zona Norte', 'Zona Oeste', 'Zona Sul'];

interface Usuario {
  nome: string;
  email: string;
  perfil: string;
  equipe: string | null;
  senha_hash: string | null;
  tenant_id: string;
}

describe.skipIf(semBanco())('S0-031..034 seed da Fase M (lido como macuxi_app, junto com dois-tenants)', () => {
  let banco: BancoDeTeste;
  let pool: pg.Pool;
  const lerUsuarios = (tenant: string) =>
    comTenant(pool, tenant, async (c) =>
      (await c.query<Usuario>(
        `select u.nome, u.email, u.perfil, e.nome as equipe, u.senha_hash, u.tenant_id::text as tenant_id
           from core.usuario u left join core.equipe e on e.tenant_id = u.tenant_id and e.id = u.equipe_id
          order by u.email`,
      )).rows,
    );
  const contagens = (tenant: string) =>
    comTenant(pool, tenant, async (c) => {
      const r = await c.query<{ t: string; n: number }>(`
        select 'usuario' as t, count(*)::int as n from core.usuario union all
        select 'equipe', count(*)::int from core.equipe union all
        select 'cliente', count(*)::int from core.cliente union all
        select 'carteira', count(*)::int from core.carteira union all
        select 'produto', count(*)::int from core.produto union all
        select 'tenant_modulo', count(*)::int from plataforma.tenant_modulo union all
        select 'perfil_modulo', count(*)::int from plataforma.perfil_modulo union all
        select 'parametro', count(*)::int from plataforma.parametro`);
      return Object.fromEntries(r.rows.map((x) => [x.t, x.n]));
    });

  beforeAll(async () => {
    banco = await criarBancoDeTeste({
      preparar: async (admin) => {
        await carregarDoisTenants(admin);
        await carregarFaseM(admin);
      },
    });
    pool = new pg.Pool({ connectionString: banco.urlApp, max: 2 });
  });
  afterAll(async () => {
    await pool?.end();
    await banco?.apagar();
  });

  it('S0-031 os 12 usuários da Fase M existem com nome, e-mail e perfil convertido (gerente, não manager)', async () => {
    const us = await lerUsuarios(TENANT_FASE_M);
    const obtido = us.map((u) => [u.nome, u.email, u.perfil]);
    const esperado = USUARIOS_FASE_M.map(([n, e, p]) => [n, e, p]).sort((x, y) => x[1]!.localeCompare(y[1]!));
    expect(obtido).toEqual(esperado);
    for (const u of us) expect(PERFIS as readonly string[], u.email).toContain(u.perfil);
    expect(us.filter((u) => u.perfil === 'gerente').map((u) => u.nome)).toEqual(['Fernando Lima']);
    // a Fase M não tinha supervisor nem promotor
    expect(us.filter((u) => u.perfil === 'supervisor' || u.perfil === 'promotor')).toEqual([]);
  });

  it('S0-032 as 6 equipes da Fase M existem e cada vendedor está na equipe certa', async () => {
    const us = await lerUsuarios(TENANT_FASE_M);
    for (const [nome, email, perfil, equipe] of USUARIOS_FASE_M) {
      if (perfil !== 'vendedor') continue;
      expect(us.find((u) => u.email === email)?.equipe, nome).toBe(equipe);
    }
    const equipes = await comTenant(pool, TENANT_FASE_M, async (c) =>
      (await c.query<{ nome: string; pai: string | null; responsavel: string | null }>(
        `select e.nome, p.nome as pai, u.nome as responsavel
           from core.equipe e left join core.equipe p on p.tenant_id = e.tenant_id and p.id = e.equipe_pai_id
           left join core.usuario u on u.tenant_id = e.tenant_id and u.id = e.responsavel_id order by e.nome`,
      )).rows,
    );
    expect(equipes.map((e) => e.nome)).toEqual(expect.arrayContaining(EQUIPES_FASE_M));
    // hierarquia: as 6 equipes ficam sob um nó cujo responsável é o gerente (RN-CORE-04)
    const pais = new Set(equipes.filter((e) => EQUIPES_FASE_M.includes(e.nome)).map((e) => e.pai));
    expect(pais.size).toBe(1);
    const topo = equipes.find((e) => e.nome === [...pais][0]);
    expect(topo?.responsavel).toBe('Fernando Lima');
  });

  it('S0-033 seed idempotente: rodar de novo não duplica nada nem muda a senha', async () => {
    const antes = await contagens(TENANT_FASE_M);
    const hashesAntes = (await lerUsuarios(TENANT_FASE_M)).map((u) => u.senha_hash);
    const admin = await conectar(banco.urlAdmin);
    try {
      await carregarFaseM(admin);
      await carregarFaseM(admin);
    } finally {
      await admin.end();
    }
    expect(await contagens(TENANT_FASE_M)).toEqual(antes);
    expect((await lerUsuarios(TENANT_FASE_M)).map((u) => u.senha_hash)).toEqual(hashesAntes);
    expect(antes.usuario).toBe(12);
  });

  it('S0-034 senhas só em argon2id e nenhum e-mail fora do domínio fictício @exemplo.com.br', async () => {
    for (const u of await lerUsuarios(TENANT_FASE_M)) {
      expect(u.senha_hash, u.email).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
      expect(u.senha_hash, u.email).not.toContain('demo-macuxi');
      expect(u.email).toMatch(/@exemplo\.com\.br$/);
    }
  });

  it('três tenants no mesmo banco: Fase M, A e B só veem os próprios usuários', async () => {
    const porTenant = {
      [TENANT_FASE_M]: await lerUsuarios(TENANT_FASE_M),
      [DOIS_TENANTS.A.tenantId]: await lerUsuarios(DOIS_TENANTS.A.tenantId),
      [DOIS_TENANTS.B.tenantId]: await lerUsuarios(DOIS_TENANTS.B.tenantId),
    };
    for (const [tenant, us] of Object.entries(porTenant)) {
      expect(us.length, tenant).toBeGreaterThan(0);
      expect(us.filter((u) => u.tenant_id !== tenant), tenant).toEqual([]);
    }
    expect(porTenant[DOIS_TENANTS.A.tenantId]!.map((u) => u.email)).not.toContain('fernando@exemplo.com.br');
    expect(porTenant[TENANT_FASE_M]!.map((u) => u.email)).not.toContain(DOIS_TENANTS.emailRepetido);
  });
});
