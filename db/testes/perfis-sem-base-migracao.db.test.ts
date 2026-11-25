/**
 * 0105 a 0107 — derivação base + sobreposições -> concessões (plano docs/banco/plano-migracao-perfis-sem-base.md §3, §4.1 a
 * §4.3; ADR 0073 §2.0 e §5). O que o BANCO garante:
 * - nenhum usuário perde nem ganha acesso: conferir_perfis_sem_base = zero DIFERENCA (e zero NOME_DIVERGENTE) em A e B;
 * - perfil_compat(cargo, concessões) = a base nos 7 padrão (core.usuario.perfil de hoje);
 * - motor novo desligado na v1.0.37: A, B e o tenant de antes ficam derivados em 'legado' (nenhum em 'concessao');
 * - idempotência: rodar de novo (migrar e espelho) não muda nenhuma linha, nem o updated_at;
 * - up/down/up com um tenant que já existia (dados antes da 0105): o down devolve o efeito por usuário (sobreposições intocadas e
 *   recalculadas para o perfil mudado depois), e o up de novo grava as mesmas concessões (ids determinísticos).
 * Fixture dois-tenants (sempre com ROLLBACK) e banco efêmero para o up/down.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERFIS } from '@macuxi/platform-sdk';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idCatalogoAplicado, idPerfilConcessao, idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { concessoesDoPerfil, legadoDoPerfil, leitura, retratoConcessoes } from './perfis-sem-base-apoio';
import { emTransacao, HASH_TESTE, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0105 a 0107 perfis sem perfil base (estático)', () => {
  it('nome e posição: 0105, 0106 e 0107 em sequência, depois de todas as anteriores (as seguintes podem existir)', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    const i = nomes.indexOf('0105_plataforma_perfil_concessao');
    expect(migracoes.slice(0, i).every((m) => m.versao < '0105')).toBe(true);
    expect(nomes.slice(i, i + 3)).toEqual([
      '0105_plataforma_perfil_concessao',
      '0106_plataforma_perfis_sem_base_derivacao',
      '0107_plataforma_perfis_sem_base_conferencia_espelho',
    ]);
  });

  it('0105: 4 tabelas com RLS forçado e manutencao; 406 linhas do modelo v1; nenhuma tabela de hoje alterada', () => {
    const up = semComentarios(migracoes.find((m) => m.versao === '0105')!.up);
    for (const t of ['modelo_permissao', 'perfil_concessao', 'catalogo_aplicado', 'perfil_migracao_conflito']) {
      expect(up).toContain(`create table plataforma.${t} (`);
      expect(up).toContain(`alter table plataforma.${t} force row level security;`);
      expect(up).toContain(`create policy manutencao on plataforma.${t} for all to macuxi_manutencao using (true) with check (true);`);
    }
    expect(up.match(/^ {2}\('(vendedor|promotor|supervisor|gerente|analista|assistente|admin)', '[a-z]+', '[a-z_.]+', /gm)).toHaveLength(406);
    expect(up).not.toMatch(/alter table plataforma\.(perfil|perfil_permissao|usuario_perfil) /);
    expect(up).not.toMatch(/macuxi_(worker|portal)/);
  });

  it('0106 e 0107: funções sem EXECUTE para PUBLIC; a migração e o espelho sem EXECUTE para ninguém; gatilhos DEFINER', () => {
    const up4 = semComentarios(migracoes.find((m) => m.versao === '0106')!.up);
    const up5 = semComentarios(migracoes.find((m) => m.versao === '0107')!.up);
    for (const sql of [up4, up5]) {
      const criadas = [...sql.matchAll(/create function (plataforma\.[a-z_]+)\(/g)].map((x) => x[1]!);
      for (const f of criadas) expect(sql, f).toMatch(new RegExp(`revoke all on function ${f.replace('.', '\\.')}\\([^)]*\\) from public;`));
    }
    for (const f of ['migrar_perfis_sem_base', 'sincronizar_concessoes']) expect(up4).not.toMatch(new RegExp(`grant execute on function plataforma\\.${f}\\(`));
    for (const f of ['espelhar_perfil', 'perfil_permissao_espelho', 'perfil_espelho', 'parametro_espelho', 'tenant_semear_concessoes']) {
      expect(up5).not.toMatch(new RegExp(`grant execute on function plataforma\\.${f}\\(`));
    }
    expect(up5.match(/returns trigger\s+language plpgsql security definer/g)).toHaveLength(4);
    expect(up4).not.toMatch(/security definer/);
  });
});

describe.skipIf(semBanco())('0105 a 0107 na fixture dois-tenants (ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;

  it('A e B derivados em legado (nenhum tenant em concessao); conferir_perfis_sem_base = zero linhas nos dois', async () => {
    await emTransacao(admin, null, async () => {
      expect(await q("select count(*)::int as n from plataforma.catalogo_aplicado where leitura = 'concessao'")).toEqual([{ n: 0 }]);
      for (const t of [A.tenantId, B.tenantId]) {
        expect(await leitura(admin, t)).toBe('legado');
        expect(await q('select plataforma.perfis_derivados($1) as d', [t])).toEqual([{ d: true }]);
        expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [t])).toEqual([]);
        expect(await q('select id, versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1 and deleted_at is null', [t]))
          .toEqual([{ id: idCatalogoAplicado(t, 1), versao: 2, leitura: 'legado' }]); // 0108: a mesma linha, na v2
      }
    });
  });

  it('cada perfil vivo: concessões = acesso de hoje com os parâmetros; vendedor_externo com escopo proprio; ids determinísticos', async () => {
    await emTransacao(admin, null, async () => {
      const perfis = await q<{ id: string; tenant_id: string; codigo: string }>(
        'select id, tenant_id, codigo from plataforma.perfil where tenant_id = any($1::uuid[]) and deleted_at is null order by codigo',
        [[A.tenantId, B.tenantId]],
      );
      expect(perfis.length).toBe(16);
      for (const p of perfis) expect(await concessoesDoPerfil(admin, p.id), p.codigo).toEqual(await legadoDoPerfil(admin, p.id, true));
      const ext = await concessoesDoPerfil(admin, A.perfis.vendedorExterno);
      expect(ext['dados.escopo']).toEqual({ nivel: 'proprio' });
      const ids = await q<{ id: string; chave: string }>('select id, chave from plataforma.perfil_concessao where perfil_id = $1 and deleted_at is null', [A.perfis.vendedorExterno]);
      for (const l of ids) expect(l.id).toBe(idPerfilConcessao(A.tenantId, A.perfis.vendedorExterno, l.chave));
      // B: vendedor_balcao sem acesso.campo (sobreposição) e sem usuário = aviso PERFIL_SEM_ACESSO; nada mais
      expect(Object.keys(await concessoesDoPerfil(admin, B.perfis.vendedorBalcao)).filter((k) => k.startsWith('acesso.'))).toEqual([]);
      expect(await q('select tipo, efeito, perfil_codigo from plataforma.perfil_migracao_conflito where tenant_id = $1 and resolvido_em is null', [B.tenantId]))
        .toEqual([{ tipo: 'PERFIL_SEM_ACESSO', efeito: 'aviso', perfil_codigo: 'vendedor_balcao' }]);
    });
  });

  it('perfil_compat(cargo, concessões) = a base nos 7 padrão de A e B (core.usuario.perfil de hoje)', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of [A.tenantId, B.tenantId]) {
        for (const base of PERFIS) {
          const r = await q<{ c: string }>(
            'select plataforma.perfil_compat(p.cargo, plataforma.concessoes_do_perfil(p.id)) as c from plataforma.perfil p where p.id = $1',
            [idPerfilFabrica(t, base)],
          );
          expect(r, `${t} ${base}`).toEqual([{ c: base }]);
        }
      }
    });
  });

  it('idempotência: derivar de novo e o espelho não mudam nenhuma linha (hash com updated_at); em concessao = ja_migrado', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of [A.tenantId, B.tenantId]) {
        const antes = await retratoConcessoes(admin, t);
        expect(antes.vivas).toBeGreaterThan(400);
        expect(await q('select plataforma.migrar_perfis_sem_base($1) as r', [t])).toEqual([{ r: 'derivado' }]);
        await q('select plataforma.espelhar_perfil(id) from plataforma.perfil where tenant_id = $1', [t]);
        expect(await retratoConcessoes(admin, t)).toEqual(antes);
        expect(await leitura(admin, t)).toBe('legado');
        const achados = await q('select count(*)::int as n from plataforma.perfil_migracao_conflito where tenant_id = $1', [t]);
        expect(await q('select plataforma.migrar_perfis_sem_base($1) as r', [t])).toEqual([{ r: 'derivado' }]);
        expect(await retratoConcessoes(admin, t)).toEqual(antes);
        // tenant ligado (a troca é da 0109): migrar não faz nada
        await q("update plataforma.catalogo_aplicado set leitura = 'concessao' where tenant_id = $1", [t]);
        expect(await q('select plataforma.migrar_perfis_sem_base($1) as r', [t])).toEqual([{ r: 'ja_migrado' }]);
        expect(await q('select count(*)::int as n from plataforma.perfil_migracao_conflito where tenant_id = $1', [t])).toEqual(achados);
      }
    });
  });
});

describe.skipIf(semBanco())('0105 a 0107 up/down/up com dados de antes (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0105-4000-8000-000000000001';
  const U = {
    admin: 'cccccccc-0105-4000-8000-000000000101',
    vend: 'cccccccc-0105-4000-8000-000000000102', // vendedor com o perfil personalizado (escopo proprio, sem produto.consultar)
    prom: 'cccccccc-0105-4000-8000-000000000103',
    sup: 'cccccccc-0105-4000-8000-000000000104', // supervisor padrão com uma sobreposição de revogação
    anal: 'cccccccc-0105-4000-8000-000000000105', // analista com senha.redefinir alvos [vendedor, promotor]
  };
  const P = { vendX: 'cccccccc-0105-4000-8000-000000000201', analX: 'cccccccc-0105-4000-8000-000000000202' };
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up com tenant que já existia: zero diferenças; down devolve o efeito por usuário; up de novo = as mesmas concessões', async () => {
    await comAdmin(b.nome, async (c) => {
      const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await c.query<T>(sql, params)).rows;
      await migrarUp(c, { ate: '0104' }); // tudo antes da 0105; as migrações seguintes à 0107 não entram
      const catalogoAntes = await retratoDoCatalogo(c);
      await c.query('begin');
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't103', 'Antigo 103')", [T]);
      const usuario = (id: string, perfil: string) =>
        c.query('insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, $3, $4, $5, $6)', [id, T, `Pessoa ${perfil}`, `${perfil}103@exemplo.com.br`, perfil, HASH_TESTE]);
      for (const [id, perfil] of [[U.admin, 'admin'], [U.vend, 'vendedor'], [U.prom, 'promotor'], [U.sup, 'supervisor'], [U.anal, 'analista']] as const) await usuario(id, perfil);
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'vendedor_x', 'Vendedor X', 'vendedor', 'vendedor')", [P.vendX, T]);
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'analista_x', 'Analista X', 'analista', 'administrativo')", [P.analX, T]);
      const sob = (perfil: string, chave: string, concedida: boolean, nivel: string | null = null, alvos: string[] | null = null) =>
        c.query('insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel, alvos) values ($1, $2, $3, $4, $5, $6)', [T, perfil, chave, concedida, nivel, alvos]);
      await sob(P.vendX, 'dados.escopo', true, 'proprio');
      await sob(P.vendX, 'produto.consultar', false);
      await sob(idPerfilFabrica(T, 'supervisor'), 'meta.ver', false);
      await sob(P.analX, 'senha.redefinir', true, null, ['vendedor', 'promotor']);
      const trocar = async (u: string, perfil: string) => {
        await c.query('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and deleted_at is null', [u]);
        await c.query('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [T, u, perfil]);
      };
      await trocar(U.vend, P.vendX);
      await trocar(U.anal, P.analX);
      await c.query('commit');
      const sobreposicoes = async () => q('select perfil_id, chave, concedida, nivel, alvos from plataforma.perfil_permissao where tenant_id = $1 and deleted_at is null order by perfil_id, chave', [T]);
      const sobAntes = await sobreposicoes();

      expect((await migrarUp(c, { ate: '0107' })).aplicadas).toEqual([
        '0105_plataforma_perfil_concessao', '0106_plataforma_perfis_sem_base_derivacao', '0107_plataforma_perfis_sem_base_conferencia_espelho',
      ]);
      expect(await leitura(c, T)).toBe('legado');
      expect(await q("select count(*)::int as n from plataforma.catalogo_aplicado where leitura = 'concessao'")).toEqual([{ n: 0 }]);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [T])).toEqual([]);
      const ext = await concessoesDoPerfil(c, P.vendX);
      expect([ext['dados.escopo'], ext['produto.consultar'], ext['acesso.campo']]).toEqual([{ nivel: 'proprio' }, undefined, {}]);
      expect((await concessoesDoPerfil(c, P.analX))['senha.redefinir']).toEqual({ alvos: ['promotor', 'vendedor'] });
      const primeira = await q('select id, chave, nivel, alvos from plataforma.perfil_concessao where tenant_id = $1 and deleted_at is null order by id', [T]);

      // tenant ligado (simula a troca da 0109) e a "API nova" muda o perfil do vendedor direto nas concessões (sem passar por
      // sobreposição): tira cliente.pre_cadastrar
      await c.query("update plataforma.catalogo_aplicado set leitura = 'concessao' where tenant_id = $1", [T]);
      await c.query("update plataforma.perfil_concessao set deleted_at = now() where perfil_id = $1 and chave = 'cliente.pre_cadastrar'", [P.vendX]);

      expect((await migrarDown(c, { passos: 3 })).aplicadas).toEqual([
        '0107_plataforma_perfis_sem_base_conferencia_espelho', '0106_plataforma_perfis_sem_base_derivacao', '0105_plataforma_perfil_concessao',
      ]);
      expect(await retratoDoCatalogo(c)).toEqual(catalogoAntes);
      // perfis intocados: as mesmas sobreposições; o vendedor_x (mudado depois) = a diferença para o modelo vendedor
      const depois = await sobreposicoes();
      expect(depois.filter((s) => s.perfil_id !== P.vendX)).toEqual(sobAntes.filter((s) => s.perfil_id !== P.vendX));
      expect(depois.filter((s) => s.perfil_id === P.vendX).map((s) => `${s.chave}:${s.concedida}:${s.nivel ?? ''}`)).toEqual([
        'cliente.pre_cadastrar:false:', 'dados.escopo:true:proprio', 'produto.consultar:false:',
      ]);

      expect((await migrarUp(c, { ate: '0107' })).aplicadas).toHaveLength(3);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [T])).toEqual([]);
      const segunda = await q('select id, chave, nivel, alvos from plataforma.perfil_concessao where tenant_id = $1 and deleted_at is null order by id', [T]);
      expect(segunda).toEqual(primeira.filter((l) => l.id !== idPerfilConcessao(T, P.vendX, 'cliente.pre_cadastrar')));
    });
  });
});
