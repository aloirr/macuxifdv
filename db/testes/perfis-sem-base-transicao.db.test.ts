/**
 * 0105 a 0107 — transição (plano §5; ADR 0073 §2.8). O que o BANCO garante nesta etapa (E2):
 * - plataforma.leitura_de_perfis: 'concessao' só com a linha viva de catalogo_aplicado; sem linha ou 'legado' = 'legado';
 * - o modelo de hoje segue intacto: perfil.base, perfil.fabrica, perfil_permissao e core.usuario.perfil não mudam com a
 *   migração (a API de hoje continua certa nos dois estados);
 * - a exclusão do tenant (plataforma.excluir_tenant) apaga um tenant migrado sem que o espelho regrave nada no meio;
 * - perfil apagado fisicamente (só o dono) leva as concessões junto e deixa o achado sem o perfil_id.
 * As funções de caminho duplo (perfil_do_usuario, último admin, portal e licença pelo cargo) são da 0109 (perfis-leitura-concessao.db.test.ts).
 * Fixture dois-tenants (ROLLBACK).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { banco, semBanco } from './estado';
import { leitura } from './perfis-sem-base-apoio';
import { emTransacao } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

describe.skipIf(semBanco())('0105 a 0107 transição (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;

  it('leitura_de_perfis: concessao, legado e sem linha', async () => {
    await emTransacao(admin, null, async () => {
      expect(await leitura(admin, A.tenantId)).toBe('legado'); // a fixture grava 'legado' (a 0109 liga os tenants de produção)
      await q("update plataforma.catalogo_aplicado set leitura = 'concessao' where tenant_id = $1", [A.tenantId]);
      expect(await leitura(admin, A.tenantId)).toBe('concessao');
      await q('update plataforma.catalogo_aplicado set leitura = $2, deleted_at = now() where tenant_id = $1', [A.tenantId, 'concessao']);
      expect(await leitura(admin, A.tenantId)).toBe('legado');
    });
  });

  it('o modelo de hoje fica: base e fábrica dos perfis, sobreposições e core.usuario.perfil iguais ao que a fixture gravou', async () => {
    await emTransacao(admin, null, async () => {
      const perfis = await q('select codigo, base, fabrica, cargo from plataforma.perfil where tenant_id = $1 and not fabrica order by codigo', [A.tenantId]);
      expect(perfis).toEqual([{ codigo: 'vendedor_externo', base: 'vendedor', fabrica: false, cargo: 'vendedor' }]);
      expect(await q('select chave, concedida, nivel from plataforma.perfil_permissao where tenant_id = $1 and deleted_at is null', [B.tenantId]))
        .toEqual([{ chave: 'acesso.campo', concedida: false, nivel: null }]);
      expect(await q('select perfil from core.usuario where id = $1', [A.usuarios.promotor])).toEqual([{ perfil: 'promotor' }]);
    });
  });

  it('excluir_tenant apaga um tenant migrado (concessões, achados e catalogo_aplicado inclusive)', async () => {
    await emTransacao(admin, null, async () => {
      await q("update plataforma.tenant set status = 'encerrado' where id = $1", [B.tenantId]);
      const r = await q<{ tabela: string; quantidade: string }>('select * from plataforma.excluir_tenant($1, $2)', [B.tenantId, B.codigo]);
      const apagadas = Object.fromEntries(r.map((x) => [x.tabela, Number(x.quantidade)]));
      expect(apagadas['plataforma.perfil_concessao']).toBeGreaterThan(400);
      expect(apagadas['plataforma.catalogo_aplicado']).toBe(1);
      expect(apagadas['plataforma.perfil_migracao_conflito']).toBe(1);
      for (const t of ['perfil_concessao', 'catalogo_aplicado', 'perfil_migracao_conflito', 'perfil']) {
        expect(await q(`select count(*)::int as n from plataforma.${t} where tenant_id = $1`, [B.tenantId]), t).toEqual([{ n: 0 }]);
      }
    });
  });

  it('perfil apagado fisicamente (dono): as concessões saem junto; o achado fica sem o perfil_id, com o código', async () => {
    await emTransacao(admin, null, async () => {
      await q('set constraints all deferred');
      await q('delete from plataforma.perfil_permissao where perfil_id = $1', [B.perfis.vendedorBalcao]);
      await q('delete from plataforma.perfil_modulo where tenant_id = $1 and perfil = $2', [B.tenantId, 'vendedor_balcao']);
      await q('delete from plataforma.perfil where id = $1', [B.perfis.vendedorBalcao]);
      expect(await q('select count(*)::int as n from plataforma.perfil_concessao where perfil_id = $1', [B.perfis.vendedorBalcao])).toEqual([{ n: 0 }]);
      expect(await q('select perfil_id, perfil_codigo from plataforma.perfil_migracao_conflito where tenant_id = $1', [B.tenantId]))
        .toEqual([{ perfil_id: null, perfil_codigo: 'vendedor_balcao' }]);
    });
  });
});
