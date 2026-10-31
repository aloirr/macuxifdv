/**
 * T-0002 critério 1 — migração sobe e desce sem erro (plano S0-020 a S0-022).
 * Cada teste usa o próprio banco efêmero (não mexe no banco compartilhado da fixture).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { carregarFaseM } from '../seeds/fase-m/fase-m';
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
      expect((await migrarUp(c)).aplicadas).toEqual(['0002_core']);
      expect((await migrarUp(c)).aplicadas).toEqual([]);
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
});
