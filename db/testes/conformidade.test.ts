/**
 * Conformidade do banco migrado (plano S0-023 e S0-028; CLAUDE.md regra 5): campos comuns, RLS
 * ligado e forçado com política, índice de sync e papel de aplicação sem privilégio de ignorar RLS.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diagnosticarPapelApp } from '../src/papeis';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID } from '../src/excecoes';
import { banco, semBanco } from './estado';
import { comCliente, tabelasDeDominio } from './util';

/** Consulta de conferência do checklist B1 (T-0078): zero linhas = toda tabela de domínio conforme. */
const SQL_CONFERIR_RLS = readFileSync(new URL('../scripts/conferir-rls.sql', import.meta.url), 'utf8');

describe('B1 conferência de RLS (estático)', () => {
  it('as exceções da consulta são as de db/src/excecoes.ts', () => {
    expect([...SQL_CONFERIR_RLS.matchAll(/^\s+values \('([a-z_]+\.[a-z_]+)'\)$/gm)].map((m) => m[1])).toEqual(
      Object.keys(TABELAS_SEM_TENANT_ID).filter((n) => !n.startsWith('public.')),
    );
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
          expect.arrayContaining(['RLS desligado', 'RLS não forçado', 'sem política', 'sem política para o macuxi_app', 'coluna created_at ausente, de outro tipo ou anulável']),
        );
        expect(r.rows.filter((x) => x.tabela !== 'plataforma.b1_sem_rls')).toEqual([]);
      } finally {
        await admin.query('rollback');
      }
    });
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
