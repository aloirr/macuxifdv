/**
 * Conformidade do banco migrado (plano S0-023 e S0-028; CLAUDE.md regra 5): campos comuns, RLS
 * ligado e forçado com política, índice de sync e papel de aplicação sem privilégio de ignorar RLS.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnosticarPapelApp } from '../src/papeis';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_LEITURA, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { banco, semBanco } from './estado';
import { comCliente, tabelasDeDominio } from './util';

/** Consulta de conferência do checklist B1 (T-0078): zero linhas = toda tabela de domínio conforme. */
const SQL_CONFERIR_RLS = readFileSync(new URL('../scripts/conferir-rls.sql', import.meta.url), 'utf8');

describe('B1 conferência de RLS (estático)', () => {
  /** Nomes `('schema.tabela')` de uma CTE `<nome> (nome) as ( values ... )` da consulta. */
  const valoresDaCte = (cte: string): string[] => {
    const bloco = new RegExp(`^${cte} \\(nome\\) as \\(\\n([\\s\\S]*?)\\n\\),$`, 'm').exec(SQL_CONFERIR_RLS)?.[1] ?? '';
    return [...bloco.matchAll(/\('([a-z_]+\.[a-z_]+)'\)/g)].map((m) => m[1]!);
  };

  it('as exceções da consulta são as de db/src/excecoes.ts (sem tenant_id, 0035 só por função e 0089 sem leitura)', () => {
    expect(valoresDaCte('sem_tenant_id')).toEqual(Object.keys(TABELAS_SEM_TENANT_ID).filter((n) => !n.startsWith('public.')));
    expect(valoresDaCte('so_por_funcao')).toEqual([...TABELAS_SO_POR_FUNCAO]);
    expect(valoresDaCte('sem_leitura')).toEqual([...TABELAS_SEM_LEITURA]);
  });
});

const COMUNS: Record<string, string> = {
  id: 'uuid',
  created_at: 'timestamp with time zone',
  updated_at: 'timestamp with time zone',
  deleted_at: 'timestamp with time zone',
  external_id: 'text',
};

describe.skipIf(semBanco())('conformidade do banco migrado', () => {
  it('S0-023 toda tabela de domínio tem os campos comuns, tenant_id (salvo exceções), RLS forçado e política', async () => {
    await comCliente(banco().urlAdmin, async (admin) => {
      const tabelas = await tabelasDeDominio(admin);
      expect(tabelas.length).toBeGreaterThanOrEqual(12);
      for (const t of tabelas) {
        const cols = await admin.query<{ column_name: string; data_type: string; is_nullable: string }>(
          'select column_name, data_type, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2',
          [t.schema, t.tabela],
        );
        const tipo = new Map(cols.rows.map((c) => [c.column_name, c]));
        for (const [col, esperado] of Object.entries(COMUNS)) expect(tipo.get(col)?.data_type, `${t.nome}.${col}`).toBe(esperado);
        if (!(t.nome in TABELAS_SEM_TENANT_ID)) {
          expect(tipo.get('tenant_id')?.data_type, `${t.nome}.tenant_id`).toBe('uuid');
          expect(tipo.get('tenant_id')?.is_nullable, `${t.nome}.tenant_id`).toBe('NO');
        }
        const rls = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; politicas: number }>(
          `select c.relrowsecurity, c.relforcerowsecurity,
                  (select count(*)::int from pg_policies p where p.schemaname = $1 and p.tablename = $2) as politicas
             from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`,
          [t.schema, t.tabela],
        );
        expect(rls.rows[0], t.nome).toEqual({ relrowsecurity: true, relforcerowsecurity: true, politicas: expect.any(Number) });
        expect(rls.rows[0]!.politicas, `${t.nome}: sem política`).toBeGreaterThanOrEqual(1);
        const foraDoSync = (TABELAS_FORA_DO_SYNC as readonly string[]).includes(t.nome) || t.nome in TABELAS_SEM_TENANT_ID;
        if (!foraDoSync) {
          const idx = await admin.query('select 1 from pg_indexes where schemaname = $1 and tablename = $2 and indexdef like $3', [
            t.schema,
            t.tabela,
            '%(tenant_id, updated_at, id)',
          ]);
          expect(idx.rowCount, `${t.nome}: falta índice (tenant_id, updated_at, id)`).toBe(1);
        }
      }
    });
  });

  it('B1 (T-0078) conferência de RLS: db/scripts/conferir-rls.sql não lista nenhuma tabela', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) => admin.query<{ tabela: string; problema: string }>(SQL_CONFERIR_RLS));
    expect(r.rows).toEqual([]);
    // a consulta enxerga as tabelas de domínio (não é vazia por filtro errado)
    const n = await comCliente(banco().urlAdmin, (admin) => tabelasDeDominio(admin));
    expect(n.length).toBeGreaterThanOrEqual(80);
  });

  it('B1 (T-0078) a conferência acusa tabela sem RLS, sem política e sem coluna comum', async () => {
    await comCliente(banco().urlAdmin, async (admin) => {
      await admin.query('begin');
      try {
        await admin.query('create table plataforma.b1_sem_rls (id uuid primary key, tenant_id uuid not null)');
        const r = await admin.query<{ tabela: string; problema: string }>(SQL_CONFERIR_RLS);
        const deB1 = r.rows.filter((x) => x.tabela === 'plataforma.b1_sem_rls').map((x) => x.problema);
        expect(deB1).toEqual(
          expect.arrayContaining([
            'RLS desligado', 'RLS não forçado', 'sem política', 'sem política para o macuxi_app', 'sem política de manutenção',
            'coluna created_at ausente, de outro tipo ou anulável',
          ]),
        );
        expect(r.rows.filter((x) => x.tabela !== 'plataforma.b1_sem_rls')).toEqual([]);
      } finally {
        await admin.query('rollback');
      }
    });
  });

  it('B1 do DBaaS (0031, T-0075): tabela nova com RLS e só a isolamento_tenant é acusada (regra para as migrações futuras)', async () => {
    await comCliente(banco().urlAdmin, async (admin) => {
      await admin.query('begin');
      try {
        await admin.query(`create table plataforma.b1_sem_manutencao (
          id uuid primary key, tenant_id uuid not null references plataforma.tenant (id), created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(), deleted_at timestamptz, external_id text)`);
        await admin.query('alter table plataforma.b1_sem_manutencao enable row level security');
        await admin.query('alter table plataforma.b1_sem_manutencao force row level security');
        await admin.query(`create policy isolamento_tenant on plataforma.b1_sem_manutencao for all to macuxi_app
          using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual())`);
        const antes = await admin.query<{ tabela: string; problema: string }>(SQL_CONFERIR_RLS);
        expect(antes.rows).toEqual([
          { tabela: 'plataforma.b1_sem_manutencao', problema: 'sem a política leitura ou o SELECT do macuxi_leitura (0078)' },
          { tabela: 'plataforma.b1_sem_manutencao', problema: 'sem política de manutenção' },
        ]);
        // 0078: a leitura (só select, só o tenant da sessão) e o SELECT tiram a 1ª linha
        await admin.query('grant select on plataforma.b1_sem_manutencao to macuxi_leitura');
        await admin.query(`create policy leitura on plataforma.b1_sem_manutencao for select to macuxi_leitura
          using (tenant_id = plataforma.tenant_atual())`);
        expect((await admin.query(SQL_CONFERIR_RLS)).rows).toEqual([{ tabela: 'plataforma.b1_sem_manutencao', problema: 'sem política de manutenção' }]);
        // política com outro nome, outro comando ou que não é "true" não vale
        await admin.query('create policy manutencao on plataforma.b1_sem_manutencao for select to macuxi_manutencao using (true)');
        expect((await admin.query(SQL_CONFERIR_RLS)).rows).toHaveLength(1);
        await admin.query('drop policy manutencao on plataforma.b1_sem_manutencao');
        await admin.query('create policy manutencao on plataforma.b1_sem_manutencao for all to macuxi_manutencao using (true) with check (true)');
        expect((await admin.query(SQL_CONFERIR_RLS)).rows).toEqual([]);
      } finally {
        await admin.query('rollback');
      }
    });
  });

  it('B1 do DBaaS (0031): macuxi_app, macuxi_worker e macuxi_portal (0038) NÃO são membros do macuxi_manutencao (nem herdam nem assumem); o migrador herda', async () => {
    await comCliente(banco().urlAdmin, async (admin) => {
      const r = await admin.query<{ papel: string; membro: boolean; herda: boolean; assume: boolean }>(
        `select a.rolname as papel, pg_has_role(a.oid, m.oid, 'MEMBER') as membro, pg_has_role(a.oid, m.oid, 'USAGE') as herda,
                pg_has_role(a.oid, m.oid, 'SET') as assume
           from pg_roles a join pg_roles m on m.rolname = 'macuxi_manutencao'
          where a.rolname in ('macuxi_app', 'macuxi_worker', 'macuxi_portal') order by 1`,
      );
      expect(r.rows).toEqual([
        { papel: 'macuxi_app', membro: false, herda: false, assume: false },
        { papel: 'macuxi_portal', membro: false, herda: false, assume: false },
        { papel: 'macuxi_worker', membro: false, herda: false, assume: false },
      ]);
      const papel = await admin.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'macuxi_manutencao'",
      );
      expect(papel.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);
      // o migrador (conexão admin) herda: as políticas manutencao valem para ele mesmo sem superusuário
      const migrador = await admin.query<{ herda: boolean }>("select pg_has_role(current_user, 'macuxi_manutencao', 'USAGE') as herda");
      expect(migrador.rows[0]!.herda).toBe(true);
      // e um papel da aplicação que virasse membro seria acusado pela conferência e pelo diagnóstico (S0-028)
      await admin.query('begin');
      try {
        await admin.query('grant macuxi_manutencao to macuxi_worker');
        const c = await admin.query<{ tabela: string; problema: string }>(SQL_CONFERIR_RLS);
        expect(c.rows).toEqual([{ tabela: '(papel) macuxi_worker', problema: 'membro de macuxi_manutencao (ignoraria a RLS)' }]);
        expect((await diagnosticarPapelApp(admin, 'macuxi_worker')).ignoraRls).toBe(true);
      } finally {
        await admin.query('rollback');
      }
    });
  });

  it('B1 do DBaaS (0031): toda tabela com RLS tem a política manutencao (for all, using true, with check true) só para macuxi_manutencao', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) =>
      admin.query<{ tabela: string }>(
        `select c.oid::regclass::text as tabela
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
            and not exists (select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname
                              and p.policyname = 'manutencao' and p.roles = '{macuxi_manutencao}' and p.cmd = 'ALL'
                              and p.permissive = 'PERMISSIVE' and p.qual = 'true' and p.with_check = 'true')`,
      ),
    );
    expect(r.rows).toEqual([]);
  });

  it('0038 (T-0091): conferir-rls acusa política ou grant de tabela para o macuxi_portal (ele só executa as sa_*)', async () => {
    await comCliente(banco().urlAdmin, async (admin) => {
      await admin.query('begin');
      try {
        await admin.query('grant select on core.usuario to macuxi_portal');
        await admin.query('create policy portal_indevida on plataforma.super_admin for select to macuxi_portal using (true)');
        const c = await admin.query<{ tabela: string; problema: string }>(SQL_CONFERIR_RLS);
        expect(c.rows).toEqual(expect.arrayContaining([
          { tabela: 'core.usuario', problema: 'política ou grant de tabela para o macuxi_portal (0038: ele só executa as sa_*)' },
          { tabela: 'plataforma.super_admin', problema: 'política ou grant de tabela para o macuxi_portal (0038: ele só executa as sa_*)' },
        ]));
        expect(c.rows).toHaveLength(2);
      } finally {
        await admin.query('rollback');
      }
    });
  });

  it('S0-028 papel do portal (0038): sem SUPERUSER, sem BYPASSRLS, fora do macuxi_manutencao e não é dono de nenhuma tabela', async () => {
    const d = await comCliente(banco().urlAdmin, (admin) => diagnosticarPapelApp(admin, 'macuxi_portal'));
    expect(d).toEqual({ superusuario: false, ignoraRls: false, tabelasDeQueEDono: [] });
  });

  it('S0-028 papel de aplicação: sem SUPERUSER, sem BYPASSRLS e não é dono de nenhuma tabela', async () => {
    const d = await comCliente(banco().urlAdmin, (admin) => diagnosticarPapelApp(admin));
    expect(d).toEqual({ superusuario: false, ignoraRls: false, tabelasDeQueEDono: [] });
  });

  it('controle de migrações não é acessível pela aplicação', async () => {
    const r = await comCliente(banco().urlApp, (app) =>
      app.query('select * from public.macuxi_migracao').then(
        () => 'leu',
        (e: { code?: string }) => e.code,
      ),
    );
    expect(r).toBe('42501');
  });

  it.skipIf(process.env.MACUXI_PG_SEM_VECTOR === '1')('imagem tem pgvector disponível (Catálogo)', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) => admin.query("select 1 from pg_available_extensions where name = 'vector'"));
    expect(r.rowCount).toBe(1);
  });
});
