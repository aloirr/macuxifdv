/**
 * 0105/0106 — os 2 parâmetros do tenant que viram caixa (plano §3.3; ADR 0073 §2.4 e §2.0 decisão 5). O que o BANCO garante:
 * - core.promotor_ve_pedidos = false: os perfis de base promotor ficam sem pedido.ver (sem linha ou true = com);
 * - catalogo.promotor_ve_preco_estoque = true: os perfis de base promotor têm produto.ver_preco_estoque (sem linha = sem);
 * - nas outras bases produto.ver_preco_estoque fica sempre (o preço aparece pelo nome do perfil, PERFIS_PRECO_ESTOQUE), mesmo com
 *   a chave revogada por sobreposição: a migração concede e grava o aviso REVOGACAO_SEM_EFEITO;
 * - o espelho (0106) refaz os perfis de base promotor quando o parâmetro muda pelo caminho de hoje, e a conferência segue zerada.
 * Fixture dois-tenants (ROLLBACK).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { idPerfilConcessao, idPerfilFabrica } from '../src/ids';
import { banco, semBanco } from './estado';
import { achados, concessoesDoPerfil } from './perfis-sem-base-apoio';
import { emTransacao } from './util';

const A = DOIS_TENANTS.A;
const PROMOTOR = idPerfilFabrica(A.tenantId, 'promotor');
const VENDEDOR = idPerfilFabrica(A.tenantId, 'vendedor');

describe.skipIf(semBanco())('0105/0106 parâmetros que viram caixa (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const parametro = (modulo: string, chave: string, valor: unknown) =>
    q(
      `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, $2, $3, $4::jsonb)
       on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor`,
      [A.tenantId, modulo, chave, JSON.stringify(valor)],
    );
  const tem = async (perfil: string, chave: string) => chave in (await concessoesDoPerfil(admin, perfil));
  const conferir = () => q('select * from plataforma.conferir_perfis_sem_base($1)', [A.tenantId]);

  it('promotor_ve_pedidos: sem linha = pedido.ver; false tira (o id volta ao ligar de novo); a conferência segue zerada', async () => {
    await emTransacao(admin, null, async () => {
      await q("delete from plataforma.parametro where tenant_id = $1 and chave in ('promotor_ve_pedidos', 'promotor_ve_preco_estoque')", [A.tenantId]);
      expect(await tem(PROMOTOR, 'pedido.ver')).toBe(true);
      await parametro('core', 'promotor_ve_pedidos', false);
      expect(await tem(PROMOTOR, 'pedido.ver')).toBe(false);
      expect(await tem(VENDEDOR, 'pedido.ver')).toBe(true);
      expect(await conferir()).toEqual([]);
      await parametro('core', 'promotor_ve_pedidos', true);
      expect(await tem(PROMOTOR, 'pedido.ver')).toBe(true);
      expect(await q("select id from plataforma.perfil_concessao where perfil_id = $1 and chave = 'pedido.ver' and deleted_at is null", [PROMOTOR]))
        .toEqual([{ id: idPerfilConcessao(A.tenantId, PROMOTOR, 'pedido.ver') }]);
      expect(await conferir()).toEqual([]);
    });
  });

  it('promotor_ve_preco_estoque: sem linha = sem a chave no promotor; true = com; as outras bases sempre com', async () => {
    await emTransacao(admin, null, async () => {
      await q("delete from plataforma.parametro where tenant_id = $1 and chave in ('promotor_ve_pedidos', 'promotor_ve_preco_estoque')", [A.tenantId]);
      expect(await tem(PROMOTOR, 'produto.ver_preco_estoque')).toBe(false);
      await parametro('catalogo', 'promotor_ve_preco_estoque', true);
      expect(await tem(PROMOTOR, 'produto.ver_preco_estoque')).toBe(true);
      await parametro('catalogo', 'promotor_ve_preco_estoque', 'sim');
      expect(await tem(PROMOTOR, 'produto.ver_preco_estoque')).toBe(false);
      for (const base of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']) {
        expect(await tem(idPerfilFabrica(A.tenantId, base), 'produto.ver_preco_estoque'), base).toBe(true);
      }
      expect(await conferir()).toEqual([]);
    });
  });

  it('revogação sem efeito (decisão 5): a caixa fica marcada e o aviso vai na lista; concessão sem efeito no promotor = desmarcada', async () => {
    await emTransacao(admin, null, async () => {
      await q("delete from plataforma.parametro where tenant_id = $1 and chave = 'promotor_ve_preco_estoque'", [A.tenantId]);
      await q("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'produto.ver_preco_estoque', false)", [A.tenantId, VENDEDOR]);
      expect(await tem(VENDEDOR, 'produto.ver_preco_estoque')).toBe(true);
      // a lista do tenant sai da migração (o tenant volta a 'legado' e migra de novo; nenhuma concessão muda)
      await q("update plataforma.catalogo_aplicado set leitura = 'legado' where tenant_id = $1", [A.tenantId]);
      expect(await q('select plataforma.migrar_perfis_sem_base($1) as r', [A.tenantId])).toEqual([{ r: 'migrado' }]);
      expect(await achados(admin, A.tenantId)).toEqual(['REVOGACAO_SEM_EFEITO/aviso/vendedor/produto.ver_preco_estoque']);
      expect(await q("select antes, depois from plataforma.perfil_migracao_conflito where tenant_id = $1 and tipo = 'REVOGACAO_SEM_EFEITO'", [A.tenantId]))
        .toEqual([{ antes: { concedida: false }, depois: { concedida: true } }]);
      expect(await tem(VENDEDOR, 'produto.ver_preco_estoque')).toBe(true);
      expect(await conferir()).toEqual([]);
    });
  });
});
