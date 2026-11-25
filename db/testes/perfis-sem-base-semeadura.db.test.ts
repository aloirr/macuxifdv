/**
 * 0107 — tenant novo nasce migrado (gatilho tenant_semear_perfis_concessao, depois de tenant_semear_perfis; plano §5 passo 2).
 * O que o BANCO garante: o tenant novo tem os 7 perfis padrão com as concessões do modelo v1 (plataforma.modelo_permissao) e
 * catalogo_aplicado (versão 1) em 'concessao', sem nenhum achado; o mesmo pelo provisionamento do portal (sa_* SECURITY DEFINER).
 * Fixture dois-tenants (ROLLBACK).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERFIS } from '@macuxi/platform-sdk';
import { idCatalogoAplicado, idPerfilFabrica } from '../src/ids';
import { banco, semBanco } from './estado';
import { concessoesDoPerfil, leitura, normalizar, VERSAO_DO_BANCO } from './perfis-sem-base-apoio';
import { emTransacao } from './util';

const T = 'cccccccc-0107-4000-8000-00000000a001';

describe.skipIf(semBanco())('0107 semeadura do tenant novo (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;

  it('os 7 perfis com as concessões do modelo, catalogo_aplicado em concessao, nenhum achado; o gatilho roda depois do da semeadura', async () => {
    await emTransacao(admin, null, async () => {
      await q("insert into plataforma.tenant (id, codigo, nome) values ($1, 't105-novo', 'Novo 105')", [T]);
      expect(await leitura(admin, T)).toBe('concessao');
      expect(await q('select id, versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1', [T])).toEqual([{ id: idCatalogoAplicado(T, 1), versao: 2, leitura: 'concessao' }]);
      for (const base of PERFIS) {
        const modelo = await q<{ p: Record<string, { nivel?: string; alvos?: string[] }> }>(
          `select coalesce(jsonb_object_agg(chave, jsonb_strip_nulls(jsonb_build_object('nivel', nivel, 'alvos', to_jsonb(alvos)))), '{}') as p
             from plataforma.modelo_permissao where versao = $2 and modelo = $1 and deleted_at is null`,
          [base, VERSAO_DO_BANCO],
        );
        const doModelo = normalizar(modelo[0]!.p);
        // os parâmetros sem linha: o promotor não tem produto.ver_preco_estoque (o modelo também não)
        expect(await concessoesDoPerfil(admin, idPerfilFabrica(T, base)), base).toEqual(doModelo);
      }
      expect(await q('select count(*)::int as n from plataforma.perfil_migracao_conflito where tenant_id = $1', [T])).toEqual([{ n: 0 }]);
      const ordem = await q<{ tgname: string }>(
        "select tgname from pg_trigger where tgrelid = 'plataforma.tenant'::regclass and tgname like 'tenant_semear_perfis%' order by tgname",
      );
      expect(ordem.map((x) => x.tgname)).toEqual(['tenant_semear_perfis', 'tenant_semear_perfis_concessao']);
    });
  });
});
