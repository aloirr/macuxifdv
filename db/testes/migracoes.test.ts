/**
 * T-0002 critério 1 — migração sobe e desce sem erro (plano S0-020 a S0-022).
 * Cada teste usa o próprio banco efêmero (não mexe no banco compartilhado da fixture).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { carregarFaseM } from '../seeds/fase-m/fase-m';
import { carregarDoisTenants } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { listarAplicadas, lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { semBanco } from './estado';
import { retratoDoCatalogo } from './util';

const criados: BancoDeTeste[] = [];
async function bancoVazio(): Promise<BancoDeTeste> {
  const b = await criarBancoDeTeste({ migrar: false });
  criados.push(b);
  return b;
}

describe.skipIf(semBanco())('migrações up/down', () => {
  afterAll(async () => {
    await Promise.all(criados.map((b) => b.apagar()));
  });

  it('S0-020 vazio -> up completo -> down completo volta ao catálogo inicial', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      const inicial = await retratoDoCatalogo(c);
      const up = await migrarUp(c);
      expect(up.aplicadas).toEqual(lerMigracoes().map((m) => `${m.versao}_${m.nome}`));
      expect(await retratoDoCatalogo(c)).not.toEqual(inicial);
      const down = await migrarDown(c, { tudo: true });
      expect(down.aplicadas).toEqual([...up.aplicadas].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(inicial);
      expect(await listarAplicadas(c)).toEqual([]);
    });
  });

  it('S0-021 up -> down -> up gera o mesmo catálogo', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c);
      const primeiro = await retratoDoCatalogo(c);
      await migrarDown(c, { tudo: true });
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(primeiro);
    });
  });

  it('down passo a passo e up parcial (--ate)', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      expect((await migrarUp(c, { ate: '0001' })).aplicadas).toEqual(['0001_plataforma']);
      expect((await migrarUp(c, { ate: '0002' })).aplicadas).toEqual(['0002_core']);
      expect((await migrarUp(c, { ate: '0003' })).aplicadas).toEqual(['0003_plataforma_worker']);
      expect((await migrarUp(c)).aplicadas).toEqual(['0004_core_sessao', '0005_plataforma_arquivo', '0006_core_lote_a', '0007_vendedor_pedido']);
      expect((await migrarUp(c)).aplicadas).toEqual([]);
      expect((await migrarDown(c)).aplicadas).toEqual(['0007_vendedor_pedido']);
      expect((await migrarDown(c)).aplicadas).toEqual(['0006_core_lote_a']);
      expect((await migrarDown(c)).aplicadas).toEqual(['0005_plataforma_arquivo']);
      expect((await migrarDown(c)).aplicadas).toEqual(['0004_core_sessao']);
      expect((await migrarDown(c)).aplicadas).toEqual(['0003_plataforma_worker']);
      expect((await migrarDown(c)).aplicadas).toEqual(['0002_core']);
      const r = await c.query("select count(*)::int as n from pg_namespace where nspname in ('core', 'plataforma')");
      expect(r.rows[0].n).toBe(1);
    });
  });

  it('S0-022 down com o seed da Fase M carregado não falha (e apaga os dados, documentado)', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c);
      await carregarFaseM(c, { senha: 'x' });
      await expect(migrarDown(c, { tudo: true })).resolves.toBeDefined();
      const r = await c.query("select count(*)::int as n from pg_namespace where nspname in ('core', 'plataforma')");
      expect(r.rows[0].n).toBe(0);
    });
  });

  it('migração aplicada editada (checksum diferente) aborta o up', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c);
      await c.query("update public.macuxi_migracao set checksum = 'adulterado' where versao = '0001'");
      await expect(migrarUp(c)).rejects.toThrow(/foi editada/);
    });
  });

  it('down de migração aplicada editado (checksum_down diferente) aborta o up e o down; linha antiga é completada', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c);
      const migs = lerMigracoes();
      expect((await listarAplicadas(c)).map((a) => a.checksum_down)).toEqual(migs.map((m) => m.checksumDown));
      await c.query("update public.macuxi_migracao set checksum_down = null where versao = '0001'");
      await migrarUp(c);
      expect((await listarAplicadas(c))[0]?.checksum_down).toBe(migs[0]?.checksumDown);
      // adultera o down da ÚLTIMA migração (é a que o próximo down desfaria)
      const ultima = migs[migs.length - 1]!;
      const rotulo = new RegExp(`down da migração aplicada ${ultima.versao}_${ultima.nome} foi editado`);
      await c.query("update public.macuxi_migracao set checksum_down = 'adulterado' where versao = $1", [ultima.versao]);
      await expect(migrarUp(c)).rejects.toThrow(rotulo);
      await expect(migrarDown(c)).rejects.toThrow(rotulo);
      expect((await listarAplicadas(c)).map((a) => a.versao)).toEqual(migs.map((m) => m.versao));
      const r = await c.query("select count(*)::int as n from pg_namespace where nspname = 'core'");
      expect(r.rows[0].n).toBe(1);
    });
  });

  it('0004 com a fixture carregada: up -> down -> up volta ao catálogo da 0003 e a fixture recarrega', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0003' });
      const ate0003 = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0004' })).aplicadas).toEqual(['0004_core_sessao']);
      const com0004 = await retratoDoCatalogo(c);
      await migrarUp(c);
      await carregarDoisTenants(c, { senha: 'x', hoje: '2026-11-03' });
      const n = await c.query('select (select count(*) from core.sessao)::int as s, (select count(*) from core.dispositivo)::int as d');
      expect(n.rows[0]).toEqual({ s: 2, d: 3 });
      // down com dados (0007..0004): apaga sessões e aparelhos (documentado no .down.sql) e volta exatamente à 0003
      expect((await migrarDown(c, { passos: 4 })).aplicadas).toEqual(['0007_vendedor_pedido', '0006_core_lote_a', '0005_plataforma_arquivo', '0004_core_sessao']);
      expect(await retratoDoCatalogo(c)).toEqual(ate0003);
      const col = await c.query("select count(*)::int as n from information_schema.columns where table_schema = 'core' and table_name = 'usuario' and column_name in ('tentativas_falhas', 'bloqueio_ate')");
      expect(col.rows[0].n).toBe(0);
      // up de novo: mesmo catálogo e a fixture volta a carregar (usuários existentes recebem os defaults)
      await migrarUp(c, { ate: '0004' });
      expect(await retratoDoCatalogo(c)).toEqual(com0004);
      const t = await c.query('select count(*)::int as n from core.usuario where tentativas_falhas <> 0 or bloqueio_ate is not null');
      expect(t.rows[0].n).toBe(0);
      await migrarUp(c);
      await carregarDoisTenants(c, { senha: 'x', hoje: '2026-11-03' });
      const n2 = await c.query('select (select count(*) from core.sessao)::int as s, (select count(*) from core.dispositivo)::int as d');
      expect(n2.rows[0]).toEqual({ s: 2, d: 3 });
    });
  });

  it('Sprint 1 (0005–0007) com a fixture: up -> down -> up volta ao catálogo da 0004; padrões semeados nos tenants existentes', async () => {
    const b = await bancoVazio();
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0004' });
      const ate0004 = await retratoDoCatalogo(c);
      // tenants que já existem ANTES da 0006 (só as tabelas até a 0004)
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ('cccccccc-0000-4000-8000-000000000001', 'antigo', 'Tenant antigo')");
      await c.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ('cccccccc-0000-4000-8000-000000000001', 'core', 'outro', '1')");
      expect((await migrarUp(c)).aplicadas).toEqual(['0005_plataforma_arquivo', '0006_core_lote_a', '0007_vendedor_pedido']);
      const completo = await retratoDoCatalogo(c);
      const padroes = async () =>
        (await c.query<{ m: number; s: number; p: number }>(`
          select (select count(*) from core.motivo where tenant_id = 'cccccccc-0000-4000-8000-000000000001')::int as m,
                 (select count(*) from core.motivo where tenant_id = 'cccccccc-0000-4000-8000-000000000001' and sistema)::int as s,
                 (select count(*) from plataforma.parametro where tenant_id = 'cccccccc-0000-4000-8000-000000000001')::int as p`)).rows[0];
      expect(await padroes()).toEqual({ m: 7, s: 2, p: 3 });
      await carregarDoisTenants(c, { senha: 'x', hoje: '2026-11-03' });
      // down com dados: apaga as tabelas novas e os parâmetros semeados (o parâmetro do próprio tenant fica)
      expect((await migrarDown(c, { passos: 3 })).aplicadas).toEqual(['0007_vendedor_pedido', '0006_core_lote_a', '0005_plataforma_arquivo']);
      expect(await retratoDoCatalogo(c)).toEqual(ate0004);
      const p = await c.query("select chave from plataforma.parametro where tenant_id = 'cccccccc-0000-4000-8000-000000000001'");
      expect(p.rows.map((x) => x.chave)).toEqual(['outro']);
      // up de novo: mesmo catálogo, padrões de volta e a fixture recarrega
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(completo);
      expect(await padroes()).toEqual({ m: 7, s: 2, p: 3 });
      await carregarDoisTenants(c, { senha: 'x', hoje: '2026-11-03' });
      const v = await c.query('select (select count(*) from core.visita)::int as v, (select count(*) from vendedor.pedido)::int as p');
      expect(v.rows[0]).toEqual({ v: 7, p: 4 });
    });
  });
});
