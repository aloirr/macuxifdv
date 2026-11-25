/**
 * 0108 — catálogo de permissões v2 (ADR 0073; SDK CATALOGO_PERMISSOES_VERSAO = 2). O que o BANCO garante:
 * - modelo_permissao v2 = v1 + as 7 chaves de leitura (CHAVES_V2), sem nível e sem alvos, nos modelos das rotas de hoje;
 * - nenhum usuário ganha nem perde acesso: depois da 0108, as concessões de cada usuário = o acesso de antes (gêmea v1 + as chaves
 *   da v2 que a rota de hoje dá pela base); conferir_perfis_sem_base = zero linhas;
 * - o personalizado de cargo administrativo derivado do assistente fica sem questionario.ver, cadastro_trade.ver e
 *   relatorio_trade.ver (decisão do gerente-projetos); o derivado do analista tem as 7;
 * - idempotência (aplicar_catalogo_v2 de novo não muda nenhuma linha, nem o updated_at) e up/down/up (banco efêmero).
 * Fixture dois-tenants (ROLLBACK) e banco efêmero.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as sdk from '@macuxi/platform-sdk';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idCatalogoAplicado, idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { CHAVES_V2, chavesV2DaBase, concessoesDoPerfil, legadoDoPerfil, normalizar, retratoConcessoes, type Permissoes } from './perfis-sem-base-apoio';
import { emTransacao, HASH_TESTE } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const TRES = Object.keys(CHAVES_V2).filter((k) => !CHAVES_V2[k]!.includes('assistente')).sort();

/** Acesso por usuário vivo do tenant: concessões do seu perfil vivo (perfil_codigo -> permissões), por usuário. */
async function acessoPorUsuario(c: pg.ClientBase, tenant: string, fonte: 'concessao' | 'legado'): Promise<Record<string, Permissoes>> {
  const r = await c.query<{ usuario_id: string; perfil_id: string; base: string }>(
    `select u.id as usuario_id, p.id as perfil_id, p.base
       from core.usuario u
       join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
       join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.deleted_at is null
      where u.tenant_id = $1 and u.deleted_at is null order by u.id`,
    [tenant],
  );
  const saida: Record<string, Permissoes> = {};
  for (const l of r.rows) {
    saida[l.usuario_id] = fonte === 'concessao'
      ? await concessoesDoPerfil(c, l.perfil_id)
      // antes da 0108: a gêmea v1 com os parâmetros + o que a rota de hoje aceita pela base
      : normalizar({ ...(await legadoDoPerfil(c, l.perfil_id, true)), ...chavesV2DaBase(l.base) });
  }
  return saida;
}

describe('0108 catálogo v2 (estático)', () => {
  it('nome; a v2 traz só as 7 chaves de CHAVES_V2; aplicar_catalogo_v2 sem EXECUTE para ninguém; o down volta à gêmea v1', () => {
    const m = migracoes.find((x) => x.versao === '0108')!;
    expect(m.nome).toBe('plataforma_catalogo_permissoes_v2');
    const up = semComentarios(m.up);
    const novas = [...up.matchAll(/^ {2}\('([a-z]+)', '([a-z]+)', '([a-z_.]+)'\)/gm)].map((x) => `${x[1]}:${x[3]}`).sort();
    expect(novas).toEqual(Object.entries(CHAVES_V2).flatMap(([k, bases]) => bases.map((b) => `${b}:${k}`)).sort());
    expect(up).toContain('revoke all on function plataforma.aplicar_catalogo_v2(uuid) from public;');
    expect(up).not.toMatch(/grant execute on function plataforma\.aplicar_catalogo_v2\(/);
    expect(up).toContain('m.versao = 2 and m.modelo = p.base');
    expect(semComentarios(m.down)).toContain('m.versao = 1 and m.modelo = p.base');
  });

  it('CHAVES_V2 = ACOES_DA_TRANSICAO do SDK v2 (quando o SDK já a exporta)', () => {
    const transicao = (sdk as unknown as Record<string, unknown>).ACOES_DA_TRANSICAO as Record<string, Record<string, { perfis: readonly string[] }>> | undefined;
    if (!transicao) return;
    const doSdk = Object.fromEntries(Object.values(transicao).flatMap((acoes) => Object.entries(acoes).map(([k, d]) => [k, [...d.perfis].sort()])));
    expect(doSdk).toEqual(Object.fromEntries(Object.entries(CHAVES_V2).map(([k, b]) => [k, [...b].sort()])));
  });
});

describe.skipIf(semBanco())('0108 na fixture dois-tenants (ROLLBACK)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;

  it('A e B na v2: conferir = zero linhas; cada perfil vivo = acesso de hoje; padrão com as chaves da v2 da base', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of [A.tenantId, B.tenantId]) {
        expect(await q('select id, versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1 and deleted_at is null', [t]))
          .toEqual([{ id: idCatalogoAplicado(t, 1), versao: 2, leitura: 'concessao' }]);
        expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [t])).toEqual([]);
        for (const base of sdk.PERFIS) {
          const c = await concessoesDoPerfil(admin, idPerfilFabrica(t, base));
          expect(Object.fromEntries(Object.entries(c).filter(([k]) => k in CHAVES_V2)), `${t} ${base}`).toEqual(chavesV2DaBase(base));
        }
        const perfis = await q<{ id: string }>('select id from plataforma.perfil where tenant_id = $1 and deleted_at is null', [t]);
        for (const p of perfis) expect(await concessoesDoPerfil(admin, p.id)).toEqual(await legadoDoPerfil(admin, p.id, true));
      }
    });
  });

  /** Tenant novo na transição (nasce migrado e na v2), para não disputar as linhas de A e B com os outros arquivos. */
  const NOVO = 'cccccccc-0108-4000-8000-0000000000a1';
  const novoTenant = async () => q("insert into plataforma.tenant (id, codigo, nome) values ($1, 't108-novo', 'Novo 108')", [NOVO]);

  it('backfill: assistente derivado (administrativo) sem as 3 de pesquisa/promotor; analista derivado com as 7; idempotente', async () => {
    const assX = 'cccccccc-0108-4000-8000-000000000001';
    const anaX = 'cccccccc-0108-4000-8000-000000000002';
    await emTransacao(admin, null, async () => {
      await novoTenant();
      expect(await q('select versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1', [NOVO])).toEqual([{ versao: 2, leitura: 'concessao' }]);
      await q("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'assistente_x', 'Assistente X', 'assistente', 'administrativo')", [assX, NOVO]);
      await q("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'analista_x', 'Analista X', 'analista', 'administrativo')", [anaX, NOVO]);
      // o estado de antes da 0108: sem as chaves novas e o tenant na v1
      await q('update plataforma.perfil_concessao set deleted_at = now() where tenant_id = $1 and chave = any($2::text[]) and deleted_at is null', [NOVO, Object.keys(CHAVES_V2)]);
      await q('update plataforma.catalogo_aplicado set versao = 1 where tenant_id = $1', [NOVO]);
      expect(await q('select plataforma.aplicar_catalogo_v2($1) as r', [NOVO])).toEqual([{ r: 'aplicado' }]);
      const ass = Object.keys(await concessoesDoPerfil(admin, assX)).filter((k) => k in CHAVES_V2).sort();
      expect(ass).toEqual(['carteira.ver', 'equipe.ver', 'rota.ver', 'visita.ver']);
      expect(Object.keys(await concessoesDoPerfil(admin, anaX)).filter((k) => k in CHAVES_V2).sort()).toEqual(Object.keys(CHAVES_V2).sort());
      for (const base of sdk.PERFIS) {
        const c = await concessoesDoPerfil(admin, idPerfilFabrica(NOVO, base));
        expect(Object.fromEntries(Object.entries(c).filter(([k]) => k in CHAVES_V2)), base).toEqual(chavesV2DaBase(base));
      }
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [NOVO])).toEqual([]);
      // idempotência: de novo = ja_aplicado; e, com a versão voltada a 1, aplicado sem regravar nenhuma linha
      const antes = await retratoConcessoes(admin, NOVO);
      expect(await q('select plataforma.aplicar_catalogo_v2($1) as r', [NOVO])).toEqual([{ r: 'ja_aplicado' }]);
      await q('update plataforma.catalogo_aplicado set versao = 1 where tenant_id = $1', [NOVO]);
      expect(await q('select plataforma.aplicar_catalogo_v2($1) as r', [NOVO])).toEqual([{ r: 'aplicado' }]);
      expect(await retratoConcessoes(admin, NOVO)).toEqual(antes);
      // o espelho (0107) refaz o perfil pela v2: as chaves novas ficam
      await q('select plataforma.espelhar_perfil($1)', [assX]);
      expect(await retratoConcessoes(admin, NOVO)).toEqual(antes);
    });
  });

  it('tenant em legado: nenhuma concessão gravada, só a versão; a migração dele depois já deriva da v2', async () => {
    await emTransacao(admin, null, async () => {
      await novoTenant();
      await q("update plataforma.catalogo_aplicado set versao = 1, leitura = 'legado' where tenant_id = $1", [NOVO]);
      await q('update plataforma.perfil_concessao set deleted_at = now() where tenant_id = $1 and deleted_at is null', [NOVO]);
      expect(await q('select plataforma.aplicar_catalogo_v2($1) as r', [NOVO])).toEqual([{ r: 'aplicado' }]);
      expect((await retratoConcessoes(admin, NOVO)).vivas).toBe(0);
      expect(await q('select versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1', [NOVO])).toEqual([{ versao: 2, leitura: 'legado' }]);
      expect(await q('select plataforma.migrar_perfis_sem_base($1) as r', [NOVO])).toEqual([{ r: 'migrado' }]);
      expect(await q('select versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1', [NOVO])).toEqual([{ versao: 2, leitura: 'concessao' }]);
      expect(Object.keys(await concessoesDoPerfil(admin, idPerfilFabrica(NOVO, 'analista'))).filter((k) => k in CHAVES_V2)).toHaveLength(7);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [NOVO])).toEqual([]);
    });
  });
});

describe.skipIf(semBanco())('0108 up/down/up com dados de antes (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0108-4000-8000-000000000100';
  const anterior = migracoes[migracoes.findIndex((m) => m.versao === '0108') - 1]!.versao;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('zero diferenças de acesso por usuário antes/depois; assistente derivado sem as 3; down volta à v1; up de novo = mesmas linhas', async () => {
    await comAdmin(b.nome, async (c) => {
      const q = async <R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await c.query<R>(sql, params)).rows;
      await migrarUp(c, { ate: anterior });
      await c.query('begin');
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't108', 'Antigo 108')", [T]);
      const perfisX = { assX: 'cccccccc-0108-4000-8000-000000000201', anaX: 'cccccccc-0108-4000-8000-000000000202' };
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'assistente_x', 'Assistente X', 'assistente', 'administrativo')", [perfisX.assX, T]);
      await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, cargo) values ($1, $2, 'analista_x', 'Analista X', 'analista', 'administrativo')", [perfisX.anaX, T]);
      await c.query("insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida) values ($1, $2, 'meta.ver', false)", [T, idPerfilFabrica(T, 'supervisor')]);
      let n = 0;
      const usuario = async (perfil: string, perfilId: string | null) => {
        const id = `cccccccc-0108-4000-8000-${String(++n).padStart(12, '0')}`;
        await c.query('insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, $3, $4, $5, $6)', [id, T, `Pessoa ${n}`, `p${n}-108@exemplo.com.br`, perfil, HASH_TESTE]);
        if (perfilId) {
          await c.query('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and deleted_at is null', [id]);
          await c.query('insert into plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) values ($1, $2, $3)', [T, id, perfilId]);
        }
      };
      for (const p of sdk.PERFIS) await usuario(p, null);
      await usuario('assistente', perfisX.assX);
      await usuario('analista', perfisX.anaX);
      await c.query('commit');
      expect(await q("select versao from plataforma.catalogo_aplicado where tenant_id = $1", [T])).toEqual([{ versao: 1 }]);
      const antes = await acessoPorUsuario(c, T, 'legado');
      expect(Object.keys(antes)).toHaveLength(9);

      expect((await migrarUp(c, { ate: '0108' })).aplicadas).toContain('0108_plataforma_catalogo_permissoes_v2');
      expect(await acessoPorUsuario(c, T, 'concessao')).toEqual(antes);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [T])).toEqual([]);
      expect(await q('select versao, leitura from plataforma.catalogo_aplicado where tenant_id = $1', [T])).toEqual([{ versao: 2, leitura: 'concessao' }]);
      const ass = Object.keys(await concessoesDoPerfil(c, perfisX.assX));
      for (const k of TRES) expect(ass).not.toContain(k);
      expect(ass).toContain('carteira.ver');
      const primeira = await q('select id, chave, nivel, alvos from plataforma.perfil_concessao where tenant_id = $1 and deleted_at is null order by id', [T]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0108_plataforma_catalogo_permissoes_v2']);
      expect(await q('select count(*)::int as n from plataforma.modelo_permissao where versao = 2')).toEqual([{ n: 0 }]);
      expect(await q('select versao from plataforma.catalogo_aplicado where tenant_id = $1', [T])).toEqual([{ versao: 1 }]);
      expect(await q('select count(*)::int as n from plataforma.perfil_concessao where tenant_id = $1 and deleted_at is null and chave = any($2::text[])', [T, Object.keys(CHAVES_V2)]))
        .toEqual([{ n: 0 }]);
      expect(await q('select * from plataforma.conferir_perfis_sem_base($1)', [T])).toEqual([]);
      const semV2 = Object.fromEntries(Object.entries(antes).map(([u, p]) => [u, Object.fromEntries(Object.entries(p).filter(([k]) => !(k in CHAVES_V2)))]));
      expect(await acessoPorUsuario(c, T, 'concessao')).toEqual(semV2);

      expect((await migrarUp(c, { ate: '0108' })).aplicadas).toEqual(['0108_plataforma_catalogo_permissoes_v2']);
      expect(await q('select id, chave, nivel, alvos from plataforma.perfil_concessao where tenant_id = $1 and deleted_at is null order by id', [T])).toEqual(primeira);
      expect(await acessoPorUsuario(c, T, 'concessao')).toEqual(antes);
    });
  });
});
