/**
 * 0107 — espelho da janela de transição (plano §5; ADR 0073 §2.0 decisão 6). Com o tenant derivado (perfis_derivados; na
 * v1.0.37 todos ficam em 'legado', com o motor novo desligado), o que o caminho de hoje grava (sobreposição, "restaurar padrão",
 * perfil novo, troca de cargo) refaz as concessões do perfil; o que a trava do cargo corta vira aviso TRAVA_NOVA_CORTA (resolvido
 * quando deixa de valer); o espelho nunca apaga nem altera o modelo antigo (sobreposições, parâmetros, perfis); tenant não
 * derivado (parado com 'para_tenant') não é tocado; nada muda (nem o updated_at) quando o conjunto já é o mesmo. Fixture
 * dois-tenants (ROLLBACK).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { idPerfilConcessao, idPerfilFabrica } from '../src/ids';
import { banco, semBanco } from './estado';
import { achados, concessoesDoPerfil, legadoDoPerfil, retratoConcessoes } from './perfis-sem-base-apoio';
import { emTransacao } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const VENDEDOR = idPerfilFabrica(A.tenantId, 'vendedor');
const NOVO = 'cccccccc-0107-4000-8000-00000000e001';

describe.skipIf(semBanco())('0107 espelho do caminho de hoje (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  /** Grava como o macuxi_app do tenant (o caminho da API de hoje). */
  async function comoApp(sql: string, params: unknown[] = [], tenant = A.tenantId) {
    await q('savepoint app');
    await q('set local role macuxi_app');
    await q("select set_config('app.tenant_id', $1, true)", [tenant]);
    try {
      return await q(sql, params);
    } finally {
      await q('release savepoint app');
      await q('reset role');
    }
  }
  const linha = (perfil: string, chave: string) =>
    q<{ id: string; vivo: boolean; nivel: string | null }>('select id, deleted_at is null as vivo, nivel from plataforma.perfil_concessao where perfil_id = $1 and chave = $2', [perfil, chave]);

  it('sobreposição pelo macuxi_app: revogar apaga (soft), restaurar reativa a MESMA linha; nível muda no lugar; resto intocado', async () => {
    await emTransacao(admin, null, async () => {
      const antes = await retratoConcessoes(admin, A.tenantId);
      await comoApp("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'produto.consultar', false)", [A.tenantId, VENDEDOR]);
      expect(await linha(VENDEDOR, 'produto.consultar')).toEqual([{ id: idPerfilConcessao(A.tenantId, VENDEDOR, 'produto.consultar'), vivo: false, nivel: null }]);
      expect((await retratoConcessoes(admin, A.tenantId)).vivas).toBe(antes.vivas - 1);
      await comoApp("delete from plataforma.perfil_permissao where perfil_id = $1 and chave = 'produto.consultar'", [VENDEDOR]);
      expect(await linha(VENDEDOR, 'produto.consultar')).toEqual([{ id: idPerfilConcessao(A.tenantId, VENDEDOR, 'produto.consultar'), vivo: true, nivel: null }]);
      await comoApp("update plataforma.perfil_permissao set nivel = 'carteira' where perfil_id = $1 and chave = 'dados.escopo'", [A.perfis.vendedorExterno]);
      expect((await linha(A.perfis.vendedorExterno, 'dados.escopo')).map((x) => [x.vivo, x.nivel])).toEqual([[true, 'carteira']]);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [A.tenantId])).toEqual([]);
      // nada muda nos outros perfis (o hash do tenant só difere nas 2 linhas mexidas)
      const n = await q<{ n: number }>(
        'select count(*)::int as n from plataforma.perfil_concessao where tenant_id = $1 and perfil_id not in ($2, $3) and updated_at >= now()',
        [A.tenantId, VENDEDOR, A.perfis.vendedorExterno],
      );
      expect(n).toEqual([{ n: 0 }]);
    });
  });

  it('perfil novo e troca de cargo pelo caminho de hoje; corte pela trava do cargo vira aviso e se resolve', async () => {
    await emTransacao(admin, null, async () => {
      await comoApp("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'gerente_novo', 'Gerente novo', 'gerente', 'gerente')", [NOVO, A.tenantId]);
      expect(await concessoesDoPerfil(admin, NOVO)).toEqual(await legadoDoPerfil(admin, NOVO, true));
      await comoApp("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'acesso.campo', true)", [A.tenantId, NOVO]);
      expect('acesso.campo' in (await concessoesDoPerfil(admin, NOVO))).toBe(false);
      expect(await achados(admin, A.tenantId)).toEqual(['TRAVA_NOVA_CORTA/aviso/gerente_novo/acesso.campo']);
      await comoApp("delete from plataforma.perfil_permissao where perfil_id = $1 and chave = 'acesso.campo'", [NOVO]);
      expect(await achados(admin, A.tenantId)).toEqual([]);
      // troca de cargo (perfil sem usuário): o teto do escopo passa a ser o do cargo
      await comoApp("update plataforma.perfil set cargo = 'supervisor' where id = $1", [NOVO]);
      const c = await concessoesDoPerfil(admin, NOVO);
      expect([c['dados.escopo'], 'acesso.bko' in c, 'acesso.gestao' in c]).toEqual([{ nivel: 'equipe' }, false, true]);
    });
  });

  it('o espelho não apaga nem altera nada do modelo antigo (sobreposições, parâmetros, perfis)', async () => {
    await emTransacao(admin, null, async () => {
      const t = A.tenantId;
      const hash = async (tabela: string) =>
        (await q<{ h: string; n: number }>(`select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) as h, count(*)::int as n from ${tabela} x where x.tenant_id = $1`, [t]))[0]!;
      const modeloAntigo = async () => ({ sob: await hash('plataforma.perfil_permissao'), par: await hash('plataforma.parametro'), perfil: await hash('plataforma.perfil') });
      const antes = await modeloAntigo();
      expect(antes.sob.n).toBeGreaterThan(0);
      await q('select plataforma.migrar_perfis_sem_base($1)', [t]);
      await q('select plataforma.espelhar_perfil(id) from plataforma.perfil where tenant_id = $1', [t]);
      expect(await modeloAntigo()).toEqual(antes);
      // gravações pelo caminho de hoje: só a linha gravada muda; as outras ficam iguais
      const sobAntes = await q('select * from plataforma.perfil_permissao where tenant_id = $1 order by id', [t]);
      await comoApp("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'produto.consultar', false)", [t, VENDEDOR]);
      await comoApp("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'promotor_ve_pedidos', 'false') on conflict do nothing", [t]);
      await comoApp("update plataforma.perfil set cargo = 'vendedor' where id = $1", [A.perfis.vendedorExterno]);
      const sobDepois = await q<{ chave: string; perfil_id: string }>('select * from plataforma.perfil_permissao where tenant_id = $1 order by id', [t]);
      expect(sobDepois.filter((x) => !(x.perfil_id === VENDEDOR && x.chave === 'produto.consultar'))).toEqual(sobAntes);
      expect(sobDepois).toHaveLength(sobAntes.length + 1);
      expect((await modeloAntigo()).perfil.n).toBe(antes.perfil.n);
      expect((await linha(VENDEDOR, 'produto.consultar')).map((x) => x.vivo)).toEqual([false]);
    });
  });

  it('tenant não derivado (parado com para_tenant em aberto): o espelho não grava nada', async () => {
    await emTransacao(admin, null, async () => {
      await q("insert into plataforma.perfil_migracao_conflito (id, tenant_id, tipo, efeito) values (gen_random_uuid(), $1, 'TENANT_SEM_ADMIN', 'para_tenant')", [B.tenantId]);
      expect(await q('select plataforma.perfis_derivados($1) as d', [B.tenantId])).toEqual([{ d: false }]);
      const antes = await retratoConcessoes(admin, B.tenantId);
      await comoApp("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'produto.consultar', false)", [B.tenantId, idPerfilFabrica(B.tenantId, 'vendedor')], B.tenantId);
      await comoApp("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'promotor_ve_pedidos', 'false')", [B.tenantId], B.tenantId);
      expect(await retratoConcessoes(admin, B.tenantId)).toEqual(antes);
    });
  });
});
