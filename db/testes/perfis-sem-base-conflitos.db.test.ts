/**
 * 0104 — conflitos na migração por tenant (plano §4.4; ADR 0073 §2.0 decisões 3 a 5). O que o BANCO garante:
 * - com usuário: CARGO_DIFERENTE_DA_BASE, TRAVA_NOVA_CORTA e PERFIL_SEM_ACESSO param o tenant ('para_tenant'): nenhuma concessão
 *   nova, catalogo_aplicado em 'legado', achados gravados (ids e códigos, sem dado pessoal); o outro tenant migra;
 * - sem usuário: o perfil é acertado ('ajustado': cargo da base com auditoria 'perfil.migracao_cargo'; a chave cortada sai) e o
 *   tenant migra; perfil ativo sem acesso e sem usuário = 'aviso';
 * - a chave cortada no perfil sem usuário vai à auditoria 'perfil.migracao_corte' (só chave e valor);
 * - a Consulta 1 de db/scripts/diagnostico-0104.sql (cópia que roda antes da 0103) = subconjunto 'para_tenant' do diagnóstico;
 * - depois de corrigir, a nova rodada migra e os achados antigos ganham resolvido_em; rodar de novo não duplica achado.
 * Fixture dois-tenants com tenants criados no caso (ROLLBACK): o tenant novo nasce migrado (0105) e é posto em 'legado' para
 * simular um tenant de antes da 0103.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idPerfilFabrica } from '../src/ids';
import { banco, semBanco } from './estado';
import { achados, concessoesDoPerfil, leitura, retratoConcessoes } from './perfis-sem-base-apoio';
import { emTransacao, HASH_TESTE } from './util';

const T1 = 'cccccccc-0104-4000-8000-00000000c001';
const T2 = 'cccccccc-0104-4000-8000-00000000c002';
const P = {
  supDoVendedor: 'cccccccc-0104-4000-8000-00000000c101', // base vendedor, cargo supervisor, COM usuário -> para
  gerCampo: 'cccccccc-0104-4000-8000-00000000c102', // base gerente + acesso.campo, COM usuário -> para
  semAcesso: 'cccccccc-0104-4000-8000-00000000c103', // base vendedor sem acesso.campo, COM usuário -> para
  analVend: 'cccccccc-0104-4000-8000-00000000c201', // T2: base analista, cargo vendedor, SEM usuário -> ajustado
  gerCampoLivre: 'cccccccc-0104-4000-8000-00000000c202', // T2: base gerente + acesso.campo, SEM usuário -> ajustado (corta)
  semAcessoLivre: 'cccccccc-0104-4000-8000-00000000c203', // T2: sem acesso, SEM usuário -> aviso
};
const U = { u1: 'cccccccc-0104-4000-8000-00000000c301', u2: 'cccccccc-0104-4000-8000-00000000c302', u3: 'cccccccc-0104-4000-8000-00000000c303' };

describe.skipIf(semBanco())('0104 conflitos por tenant (fixture, ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const migrar = async (t: string) => (await q<{ r: string }>('select plataforma.migrar_perfis_sem_base($1) as r', [t]))[0]!.r;
  const perfil = (t: string, id: string, codigo: string, base: string, cargo: string) =>
    q('insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, $3, $3, $4, $5)', [id, t, codigo, base, cargo]);
  const sob = (t: string, p: string, chave: string, concedida: boolean) =>
    q('insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, $3, $4)', [t, p, chave, concedida]);
  const usuarioCom = async (t: string, u: string, principal: string, p: string) => {
    await q('insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, $3, $4, $5, $6)', [u, t, 'Pessoa 104', `${u.slice(-4)}@exemplo.com.br`, principal, HASH_TESTE]);
    await q('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and deleted_at is null', [u]);
    await q('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [t, u, p]);
  };
  /** Tenant "de antes": criado (nasce migrado), volta a 'legado' e perde as concessões, como se a 0103 ainda não tivesse rodado. */
  const tenantDeAntes = async (t: string, codigo: string) => {
    await q("insert into plataforma.tenant (id, codigo, nome) values ($1, $2, 'Tenant 104')", [t, codigo]);
    await q("update plataforma.catalogo_aplicado set leitura = 'legado' where tenant_id = $1", [t]);
    await q('delete from plataforma.perfil_concessao where tenant_id = $1', [t]);
  };

  /** T1 com os 3 casos que param (com usuário) e T2 com os mesmos casos sem usuário (ajustes e aviso). */
  const fixtureConflitos = async () => {
    await tenantDeAntes(T1, 't104a');
    await perfil(T1, P.supDoVendedor, 'sup_do_vendedor', 'vendedor', 'supervisor');
    await perfil(T1, P.gerCampo, 'gerente_campo', 'gerente', 'gerente');
    await sob(T1, P.gerCampo, 'acesso.campo', true);
    await perfil(T1, P.semAcesso, 'sem_acesso', 'vendedor', 'vendedor');
    await sob(T1, P.semAcesso, 'acesso.campo', false);
    await usuarioCom(T1, U.u1, 'vendedor', P.supDoVendedor);
    await usuarioCom(T1, U.u2, 'gerente', P.gerCampo);
    await usuarioCom(T1, U.u3, 'vendedor', P.semAcesso);
    expect(await leitura(admin, T1)).toBe('legado');
    // os gatilhos de espelho não fazem nada no tenant legado
    expect((await retratoConcessoes(admin, T1)).n).toBe(0);

    await tenantDeAntes(T2, 't104b');
    await perfil(T2, P.analVend, 'analista_vendedor', 'analista', 'vendedor');
    await perfil(T2, P.gerCampoLivre, 'gerente_campo_livre', 'gerente', 'gerente');
    await sob(T2, P.gerCampoLivre, 'acesso.campo', true);
    await perfil(T2, P.semAcessoLivre, 'sem_acesso_livre', 'vendedor', 'vendedor');
    await sob(T2, P.semAcessoLivre, 'acesso.campo', false);
  };

  it('para_tenant com usuário: nada gravado, legado, achados; o outro tenant (só ajustes e avisos) migra', async () => {
    await emTransacao(admin, null, async () => {
      await fixtureConflitos();
      expect(await migrar(T1)).toBe('parado');
      expect(await leitura(admin, T1)).toBe('legado');
      expect((await retratoConcessoes(admin, T1)).n).toBe(0);
      expect(await achados(admin, T1)).toEqual([
        'CARGO_DIFERENTE_DA_BASE/para_tenant/sup_do_vendedor/-',
        'PERFIL_SEM_ACESSO/para_tenant/sem_acesso/-',
        'TRAVA_NOVA_CORTA/para_tenant/gerente_campo/acesso.campo',
      ]);
      const sup = await q('select antes, depois, usuario_id from plataforma.perfil_migracao_conflito where tenant_id = $1 and perfil_id = $2', [T1, P.supDoVendedor]);
      expect(sup).toEqual([{ antes: { base: 'vendedor', cargo: 'supervisor' }, depois: { base: 'vendedor', cargo: 'supervisor' }, usuario_id: null }]);

      expect(await migrar(T2)).toBe('migrado');
      expect(await leitura(admin, T2)).toBe('concessao');
      expect(await achados(admin, T2, false)).toEqual([
        'CARGO_DIFERENTE_DA_BASE/ajustado/analista_vendedor/-',
        'PERFIL_SEM_ACESSO/aviso/sem_acesso_livre/-',
        'TRAVA_NOVA_CORTA/ajustado/gerente_campo_livre/acesso.campo',
      ]);
      expect(await achados(admin, T2)).toEqual(['PERFIL_SEM_ACESSO/aviso/sem_acesso_livre/-']);
      expect(await q('select cargo from plataforma.perfil where id = $1', [P.analVend])).toEqual([{ cargo: 'administrativo' }]);
      expect(await q("select modulo, acao, antes, depois from plataforma.auditoria where entidade_id = $1 and acao = 'perfil.migracao_cargo'", [P.analVend]))
        .toEqual([{ modulo: 'core', acao: 'perfil.migracao_cargo', antes: { base: 'analista', cargo: 'vendedor' }, depois: { base: 'analista', cargo: 'administrativo' } }]);
      expect(await q("select modulo, acao, usuario_id, antes, depois from plataforma.auditoria where entidade_id = $1 and acao = 'perfil.migracao_corte'", [P.gerCampoLivre]))
        .toEqual([{ modulo: 'core', acao: 'perfil.migracao_corte', usuario_id: null, antes: { 'acesso.campo': {} }, depois: null }]);
      expect((await concessoesDoPerfil(admin, P.gerCampoLivre))['acesso.campo']).toBeUndefined();
      expect((await concessoesDoPerfil(admin, P.gerCampoLivre))['acesso.gestao']).toEqual({});
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [T2])).toEqual([]);

      // T1 corrigido (cargo do perfil acertado, sobreposições tiradas): migra; os achados antigos ficam resolvidos
      await q("update plataforma.perfil set cargo = 'vendedor' where id = $1", [P.supDoVendedor]);
      await q('delete from plataforma.perfil_permissao where tenant_id = $1', [T1]);
      expect(await migrar(T1)).toBe('migrado');
      expect(await achados(admin, T1)).toEqual([]);
      expect(await achados(admin, T1, false)).toHaveLength(3);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [T1])).toEqual([]);
      const n = await q('select count(*)::int as n from plataforma.perfil_migracao_conflito where tenant_id = any($1::uuid[])', [[T1, T2]]);
      expect(await migrar(T1)).toBe('ja_migrado');
      expect(await q('select count(*)::int as n from plataforma.perfil_migracao_conflito where tenant_id = any($1::uuid[])', [[T1, T2]])).toEqual(n);
    });
  });

  it('a Consulta 1 de db/scripts/diagnostico-0104.sql (antes da 0103) só traz casos que o diagnóstico dá como para_tenant', async () => {
    const arquivo = readFileSync(fileURLToPath(new URL('../scripts/diagnostico-0104.sql', import.meta.url)), 'utf8');
    const inicio = arquivo.indexOf('with perfis as (');
    const consulta1 = arquivo.slice(inicio, arquivo.indexOf(';', inicio));
    await emTransacao(admin, null, async () => {
      await fixtureConflitos();
      const linhas = (await q<{ tenant_id: string; codigo: string; tipo: string; chave: string | null }>(consulta1))
        .filter((l) => l.tenant_id === T1 || l.tenant_id === T2);
      expect(linhas).toHaveLength(3);
      for (const t of [T1, T2]) {
        const d = await q<{ perfil_codigo: string; tipo: string; chave: string | null; efeito: string }>(
          'select perfil_codigo, tipo, chave, efeito from plataforma.diagnosticar_perfis_sem_base($1)', [t]);
        for (const l of linhas.filter((x) => x.tenant_id === t)) {
          expect(d, `${l.codigo} ${l.tipo}`).toContainEqual({ perfil_codigo: l.codigo, tipo: l.tipo, chave: l.chave, efeito: 'para_tenant' });
        }
      }
    });
  });

  it('o diagnóstico é só leitura e não depende de o tenant estar migrado; o macuxi_app lê os achados do próprio tenant e não grava', async () => {
    await emTransacao(admin, null, async () => {
      await tenantDeAntes(T1, 't104c');
      await perfil(T1, P.gerCampo, 'gerente_campo', 'gerente', 'gerente');
      await sob(T1, P.gerCampo, 'acesso.campo', true);
      const d = await q('select tipo, efeito, chave from plataforma.diagnosticar_perfis_sem_base($1)', [T1]);
      expect(d).toEqual([{ tipo: 'TRAVA_NOVA_CORTA', efeito: 'ajustado', chave: 'acesso.campo' }]);
      expect(await q('select count(*)::int as n from plataforma.perfil_migracao_conflito where tenant_id = $1', [T1])).toEqual([{ n: 0 }]);
      await migrar(T1);
      await q('savepoint app');
      await q('set local role macuxi_app');
      await q("select set_config('app.tenant_id', $1, true)", [T1]);
      expect(await achados(admin, T1, false)).toEqual(['TRAVA_NOVA_CORTA/ajustado/gerente_campo/acesso.campo']);
      expect((await q('select count(*)::int as n from plataforma.perfil_migracao_conflito')).at(0)).toEqual({ n: 1 });
      await q('rollback to savepoint app');
      await q('savepoint app2');
      await q('set local role macuxi_app');
      await q("select set_config('app.tenant_id', $1, true)", [T1]);
      const erro = await admin.query("update plataforma.perfil_migracao_conflito set resolvido_em = now()").catch((e: { code: string }) => e.code);
      expect(erro).toBe('42501');
      await q('rollback to savepoint app2');
      expect(idPerfilFabrica(T1, 'admin')).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
