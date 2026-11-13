/**
 * 0004 (T-0003 Fase 2; pedido R-20261031-121739-modulo-core): core.sessao, core.dispositivo e tentativas de login.
 * Banco efêmero PRÓPRIO (migrações + fixture dois-tenants): o teste recarrega a fixture e grava dados.
 *
 * 1. Fixture idempotente: recarregar não muda nada e DESFAZ o estado de login (tentativas, bloqueio, rotação).
 * 2. Vazamento nas tabelas novas (RN-CORE-05), além da varredura genérica de vazamento.test.ts.
 * 3. O SQL de modules/core/api/repositorio.ts roda contra o esquema real como macuxi_app (nomes de colunas,
 *    upsert do aparelho, rotação e revogação da família).
 * 4. EXPLAIN: as consultas da sessão usam os índices da 0004 (com o predicado da RLS como condição de índice).
 */
import type { AcessoBanco, ClienteBanco } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositorioPublicoSql, repositorioTenantSql } from '../../modules/core/api/repositorio';
import { carregarDoisTenants, DOIS_TENANTS, ORDEM_TABELAS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { agoraDosTestes } from '../src/datas';
import { semBanco } from './estado';
import { emTransacao, erroDe } from './util';

/** Um só "agora" para a carga e as recargas da fixture neste arquivo (recarregar perto da meia-noite não move datas). */
const AGORA = agoraDosTestes();

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const NOVO_HASH = 'a'.repeat(64);

/** Adapta pg.ClientBase ao ClienteBanco do platform-sdk (o que a API entrega ao módulo). */
const cliente = (c: pg.ClientBase): ClienteBanco => ({
  query: async <R>(sql: string, valores?: readonly unknown[]) => {
    const r = await c.query(sql, valores ? [...valores] : undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});

/** Retrato da fixture por tabela (sem created_at/updated_at, que mudam a cada upsert). */
async function retratoDosDados(c: pg.ClientBase): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of ORDEM_TABELAS) {
    const r = await c.query<{ n: number; md5: string | null }>(
      `select count(*)::int as n,
              md5(string_agg((to_jsonb(x) - 'created_at' - 'updated_at' - 'senha_hash')::text, '|' order by x.id)) as md5
         from ${t} x`,
    );
    out[t] = `${r.rows[0]!.n}:${r.rows[0]!.md5}`;
  }
  return out;
}

describe.skipIf(semBanco())('0004 sessão, aparelho e tentativas de login', () => {
  let b: BancoDeTeste;
  let app: pg.Client;

  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c, { senha: 'Teste@1234', agora: AGORA }).then(() => undefined) });
    app = new pg.Client({ connectionString: b.urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
    await b?.apagar();
  });

  describe('fixture dois-tenants idempotente', () => {
    it('recarregar 2x não duplica nem muda nada', async () => {
      await comAdmin(b.nome, async (c) => {
        const antes = await retratoDosDados(c);
        expect(antes['core.sessao']!.startsWith('2:')).toBe(true);
        expect(antes['core.dispositivo']!.startsWith('3:')).toBe(true);
        await carregarDoisTenants(c, { senha: 'Teste@1234', agora: AGORA });
        await carregarDoisTenants(c, { senha: 'Teste@1234', agora: AGORA });
        expect(await retratoDosDados(c)).toEqual(antes);
      });
    });

    it('recarregar desfaz o estado de login (falhas, bloqueio temporário, refresh usado/revogado) e mantém a senha', async () => {
      await comAdmin(b.nome, async (c) => {
        const antes = await retratoDosDados(c);
        const senha = await c.query('select senha_hash from core.usuario where id = $1', [A.usuarios.vendedor1]);
        await c.query("update core.usuario set tentativas_falhas = 5, bloqueio_ate = now() + interval '15 min' where id = $1", [A.usuarios.vendedor1]);
        await c.query('update core.sessao set usado_em = now(), revogado_em = now() where id = $1', [A.sessoes.vendedor1]);
        await c.query('update core.dispositivo set bloqueado_em = now() where id = $1', [A.dispositivos.vendedor1]);
        await carregarDoisTenants(c, { senha: 'Outra@1234', agora: AGORA });
        expect(await retratoDosDados(c)).toEqual(antes);
        const depois = await c.query('select senha_hash from core.usuario where id = $1', [A.usuarios.vendedor1]);
        expect(depois.rows[0].senha_hash).toBe(senha.rows[0].senha_hash);
      });
    });
  });

  describe('RN-CORE-05 vazamento nas tabelas novas (papel de aplicação)', () => {
    it('A não encontra o refresh de B pelo hash nem o aparelho de B pelo id', async () => {
      const r = await emTransacao(app, A.tenantId, async () => ({
        sessao: (await app.query('select id from core.sessao where token_hash = $1', [B.refresh.hash])).rowCount,
        aparelho: (await app.query('select id from core.dispositivo where id = $1', [B.dispositivos.vendedor])).rowCount,
        proprio: (await app.query('select id from core.sessao where token_hash = $1', [A.refresh.hash])).rowCount,
      }));
      expect(r).toEqual({ sessao: 0, aparelho: 0, proprio: 1 });
    });

    it('A não revoga a família nem bloqueia o aparelho de B (0 linhas)', async () => {
      const r = await emTransacao(app, A.tenantId, async () => ({
        familia: (await app.query('update core.sessao set revogado_em = now() where familia_id = $1', [B.familias.vendedor])).rowCount,
        aparelho: (await app.query('update core.dispositivo set bloqueado_em = now() where id = $1', [B.dispositivos.vendedor])).rowCount,
        usuario: (await app.query('update core.usuario set tentativas_falhas = 5 where id = $1', [B.usuarios.vendedor])).rowCount,
      }));
      expect(r).toEqual({ familia: 0, aparelho: 0, usuario: 0 });
    });

    it('FK composta: sessão de A não aponta para usuário nem aparelho de B (23503)', async () => {
      const usuarioB = await erroDe(
        emTransacao(app, A.tenantId, () =>
          app.query(
            "insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), $3, now() + interval '30 days')",
            [A.tenantId, B.usuarios.vendedor, NOVO_HASH],
          ),
        ),
      );
      expect(usuarioB?.code).toBe('23503');
      const aparelhoB = await erroDe(
        emTransacao(app, A.tenantId, () =>
          app.query(
            "insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, dispositivo_id, expira_em) values ($1, $2, gen_random_uuid(), $3, $4, now() + interval '30 days')",
            [A.tenantId, A.usuarios.vendedor1, NOVO_HASH, B.dispositivos.vendedor],
          ),
        ),
      );
      expect(aparelhoB?.code).toBe('23503');
      const aparelhoComUsuarioB = await erroDe(
        emTransacao(app, A.tenantId, () =>
          app.query('insert into core.dispositivo (tenant_id, usuario_id) values ($1, $2)', [A.tenantId, B.usuarios.vendedor]),
        ),
      );
      expect(aparelhoComUsuarioB?.code).toBe('23503');
    });

    it('upsert do login com o id do aparelho de B, no contexto de A, não toca a linha de B e a sessão não o referencia', async () => {
      let linhas: number | null = null;
      const erro = await erroDe(
        emTransacao(app, A.tenantId, async () => {
          const up = await app.query(
            `insert into core.dispositivo (id, tenant_id, usuario_id, nome, ultimo_acesso_em)
             values ($1, plataforma.tenant_atual(), $2, 'invasor', now())
             on conflict (id) do update set ultimo_acesso_em = excluded.ultimo_acesso_em, nome = coalesce(excluded.nome, core.dispositivo.nome)
               where core.dispositivo.usuario_id = excluded.usuario_id`,
            [B.dispositivos.vendedor, A.usuarios.vendedor1],
          );
          linhas = up.rowCount;
        }),
      );
      // conflito com a linha de B, sem inserir nem atualizar: até o Postgres 16.15 o "where" do do update a descarta
      // (0 linhas); a partir do 16.16 a política barra a linha alheia antes do "where" (42501). Os dois são seguros.
      const resultado = erro === null ? { linhas } : { codigo: erro.code };
      expect([{ linhas: 0 }, { codigo: '42501' }]).toContainEqual(resultado);
      const nomeB = await comAdmin(b.nome, (c) => c.query('select nome, tenant_id from core.dispositivo where id = $1', [B.dispositivos.vendedor]));
      expect(nomeB.rows).toEqual([{ nome: 'Aparelho Vendedor Beta', tenant_id: B.tenantId }]);
      // sem o "where", a política barra a atualização da linha alheia
      const semWhere = await erroDe(
        emTransacao(app, A.tenantId, () =>
          app.query(
            `insert into core.dispositivo (id, tenant_id, usuario_id, nome) values ($1, plataforma.tenant_atual(), $2, 'invasor')
             on conflict (id) do update set nome = excluded.nome`,
            [B.dispositivos.vendedor, A.usuarios.vendedor1],
          ),
        ),
      );
      expect(semWhere?.code).toBe('42501');
    });

    it('o mesmo hash pode existir em tenants diferentes (único POR tenant) e repetir no mesmo tenant falha (23505)', async () => {
      const r = await emTransacao(app, B.tenantId, () =>
        app.query(
          "insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), $3, now() + interval '30 days') returning id",
          [B.tenantId, B.usuarios.vendedor, A.refresh.hash],
        ),
      );
      expect(r.rowCount).toBe(1);
      const dup = await erroDe(
        emTransacao(app, A.tenantId, () =>
          app.query(
            "insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), $3, now() + interval '30 days')",
            [A.tenantId, A.usuarios.vendedor2, A.refresh.hash],
          ),
        ),
      );
      expect(dup?.code).toBe('23505');
    });

    it('CHECKs: hash que não é sha256 hex e tentativas negativas são recusados (23514)', async () => {
      const hash = await erroDe(
        emTransacao(app, A.tenantId, () =>
          app.query(
            "insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em) values ($1, $2, gen_random_uuid(), 'segredo-em-claro', now())",
            [A.tenantId, A.usuarios.vendedor1],
          ),
        ),
      );
      expect(hash?.code).toBe('23514');
      const neg = await erroDe(emTransacao(app, A.tenantId, () => app.query('update core.usuario set tentativas_falhas = -1 where id = $1', [A.usuarios.vendedor1])));
      expect(neg?.code).toBe('23514');
    });
  });

  describe('SQL de modules/core/api/repositorio.ts contra o esquema real (macuxi_app)', () => {
    it('login: usuário por e-mail, tentativas, login ok, aparelho e sessão rotativa', async () => {
      await emTransacao(app, A.tenantId, async () => {
        const r = repositorioTenantSql(cliente(app));
        const u = await r.usuarioPorEmail(DOIS_TENANTS.emailRepetido.toUpperCase());
        expect(u).toMatchObject({ id: A.usuarios.vendedor1, perfil: 'vendedor', tentativas_falhas: 0, bloqueio_ate: null, bloqueado_em: null });
        expect(u?.senha_hash?.startsWith('$argon2id$')).toBe(true);

        const ate = new Date(Date.now() + 15 * 60_000); // relógio real: bloqueio_ate e expira_em comparáveis ao now() do banco (T-0042)
        await r.gravarTentativas(A.usuarios.vendedor1, 5, ate);
        expect(await r.usuarioPorEmail(DOIS_TENANTS.emailRepetido)).toMatchObject({ tentativas_falhas: 5, bloqueio_ate: ate });
        await r.registrarLoginOk(A.usuarios.vendedor1, new Date(Date.now() + 20 * 60_000));
        expect(await r.usuarioPorEmail(DOIS_TENANTS.emailRepetido)).toMatchObject({ tentativas_falhas: 0, bloqueio_ate: null });
        expect(await r.usuarioAtual(A.usuarios.vendedor1)).toMatchObject({ id: A.usuarios.vendedor1, perfil: 'vendedor', ativo: true });
        expect(await r.usuarioAtual(B.usuarios.vendedor)).toBeNull();

        // RN-CORE-15: a consulta é só pelo aparelho (vale para o tenant inteiro, não só para o dono registrado)
        expect(await r.dispositivoBloqueado(A.dispositivos.promotorBloqueado)).toBe(true);
        expect(await r.dispositivoBloqueado(A.dispositivos.vendedor1)).toBe(false);
        const novo = 'aaaaaaaa-0006-4000-8000-000000000099';
        await r.upsertDispositivo(A.usuarios.vendedor1, novo, 'Moto G', new Date());
        await r.upsertDispositivo(A.usuarios.vendedor1, novo, null, new Date());
        const ap = await app.query('select nome, tenant_id from core.dispositivo where id = $1', [novo]);
        expect(ap.rows[0]).toEqual({ nome: 'Moto G', tenant_id: A.tenantId });

        const familia = 'aaaaaaaa-0007-4000-8000-000000000199';
        const s1 = { id: 'aaaaaaaa-0007-4000-8000-000000000098', usuario_id: A.usuarios.vendedor1, familia_id: familia, token_hash: 'b'.repeat(64), dispositivo_id: novo, expira_em: new Date(Date.now() + 30 * 86_400_000) };
        await r.criarSessao(s1);
        expect(await r.sessaoPorHash(s1.token_hash)).toMatchObject({ id: s1.id, familia_id: familia, dispositivo_id: novo, usado_em: null, revogado_em: null });
        await r.marcarSessaoUsada(s1.id, new Date());
        await r.criarSessao({ ...s1, id: 'aaaaaaaa-0007-4000-8000-000000000097', token_hash: 'c'.repeat(64) });
        expect((await r.sessaoPorHash(s1.token_hash))?.usado_em).toBeInstanceOf(Date);
        await r.revogarFamilia(familia, new Date());
        const vivas = await app.query('select count(*)::int as n from core.sessao where familia_id = $1 and revogado_em is null', [familia]);
        expect(vivas.rows[0].n).toBe(0);
        // a sessão da fixture (outra família) segue viva; o hash de B não é visto em A
        expect((await r.sessaoPorHash(A.refresh.hash))?.revogado_em).toBeNull();
        expect(await r.sessaoPorHash(B.refresh.hash)).toBeNull();
      });
    });

    it('RN-CORE-15: aparelho bloqueado recusa outro usuário do mesmo tenant e não vaza para o outro tenant', async () => {
      await emTransacao(app, A.tenantId, async () => {
        const r = repositorioTenantSql(cliente(app));
        // o vendedor1 (não é o dono) entra no aparelho bloqueado do promotor: o upsert não troca o dono nem desbloqueia
        await r.upsertDispositivo(A.usuarios.vendedor1, A.dispositivos.promotorBloqueado, null, new Date());
        expect(await r.dispositivoBloqueado(A.dispositivos.promotorBloqueado)).toBe(true);
        const ap = await app.query('select usuario_id, bloqueado_em is not null as bloqueado from core.dispositivo where id = $1', [A.dispositivos.promotorBloqueado]);
        expect(ap.rows[0]).toEqual({ usuario_id: A.usuarios.promotor, bloqueado: true });
      });
      await emTransacao(app, B.tenantId, async () => {
        const r = repositorioTenantSql(cliente(app));
        // vazamento: o aparelho bloqueado de A não existe para B (RLS), e o aparelho de B segue livre
        expect(await r.dispositivoBloqueado(A.dispositivos.promotorBloqueado)).toBe(false);
        expect(await r.dispositivoBloqueado(B.dispositivos.vendedor)).toBe(false);
        // e B não toma o id do aparelho de A: o login cai em 403 DISPOSITIVO_INVALIDO. Até o Postgres 16.15 o upsert é
        // descartado (0 linhas) e a recusa vem da sessão; a partir do 16.16 a política barra o próprio upsert (42501).
        const login = async () => {
          await r.upsertDispositivo(B.usuarios.vendedor, A.dispositivos.promotorBloqueado, 'invasor', new Date());
          await r.criarSessao({ id: 'bbbbbbbb-0007-4000-8000-000000000098', usuario_id: B.usuarios.vendedor, familia_id: 'bbbbbbbb-0007-4000-8000-000000000199', token_hash: 'd'.repeat(64), dispositivo_id: A.dispositivos.promotorBloqueado, expira_em: new Date(Date.now() + 30 * 86_400_000) });
        };
        await expect(login()).rejects.toMatchObject({ codigo: 'DISPOSITIVO_INVALIDO' });
      });
      const linhaA = await comAdmin(b.nome, (c) => c.query('select tenant_id, usuario_id, nome, bloqueado_em is not null as bloqueado from core.dispositivo where id = $1', [A.dispositivos.promotorBloqueado]));
      expect(linhaA.rows).toEqual([{ tenant_id: A.tenantId, usuario_id: A.usuarios.promotor, nome: 'Aparelho Promotor', bloqueado: true }]);
      await emTransacao(app, A.tenantId, async () => {
        // bloquear em B não afeta A
        await app.query("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
        await app.query('update core.dispositivo set bloqueado_em = now() where id = $1', [B.dispositivos.vendedor]);
        await app.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
        const r = repositorioTenantSql(cliente(app));
        expect(await r.dispositivoBloqueado(A.dispositivos.vendedor1)).toBe(false);
        expect(await r.dispositivoBloqueado(B.dispositivos.vendedor)).toBe(false);
      });
    });

    it('público: tenant_por_codigo sem contexto (id e status antes da senha; nome e fuso depois, pela tenant_da_sessao da 0052)', async () => {
      const acesso = { semTenant: async (fn: (db: ClienteBanco) => Promise<unknown>) => fn(cliente(app)) } as unknown as AcessoBanco;
      const p = repositorioPublicoSql(acesso);
      expect(await p.tenantPorCodigo('alfa')).toEqual({ id: A.tenantId, status: 'ativo' });
      expect(await p.tenantPorCodigo('nao-existe')).toBeNull();
      // 0052 (T-0122 N5): nome e fuso só depois da senha, no contexto do tenant (tenant-por-codigo-minimo.test.ts)
      const exibicao = await emTransacao(app, B.tenantId, () => app.query('select id, codigo, nome, fuso from plataforma.tenant_da_sessao()'));
      expect(exibicao.rows).toEqual([{ id: B.tenantId, codigo: 'beta', nome: 'Comercial Beta', fuso: B.fuso }]);
    });
  });

  describe('EXPLAIN: consultas da sessão usam os índices da 0004 (RLS como condição de índice)', () => {
    // Volume de produção em miniatura: 6.000 sessões em A (8 usuários, famílias de 4, 90% já revogadas) + ANALYZE.
    beforeAll(async () => {
      await comAdmin(b.nome, async (c) => {
        await c.query(
          `insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em, revogado_em)
           select $1, (array(select id from core.usuario where tenant_id = $1 order by id))[1 + i % 8],
                  md5('familia' || (i / 4))::uuid, md5('a' || i) || md5('b' || i), now() + interval '30 days',
                  case when i % 10 = 0 then null else now() end
             from generate_series(1, 6000) as i`,
          [A.tenantId],
        );
        await c.query('analyze core.sessao; analyze core.dispositivo; analyze core.equipe');
      });
    });

    const plano = (sql: string, params: unknown[]) =>
      emTransacao(app, A.tenantId, async () => {
        await app.query('set local enable_seqscan = off');
        const r = await app.query<{ 'QUERY PLAN': string }>(`explain ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });

    it.each([
      ['refresh por hash', 'select id from core.sessao where token_hash = $1 and deleted_at is null', [A.refresh.hash], 'sessao_token_uk'],
      ['revogar a família', 'update core.sessao set revogado_em = now() where familia_id = $1 and revogado_em is null', [A.familias.vendedor1], 'sessao_familia_ix'],
      ['revogar tudo do usuário', 'update core.sessao set revogado_em = now() where usuario_id = $1 and revogado_em is null', [A.usuarios.vendedor1], 'sessao_usuario_ativa_ix'],
      ['aparelhos do usuário', 'select id from core.dispositivo where usuario_id = $1', [A.usuarios.vendedor1], 'dispositivo_usuario_ix'],
      ['equipes do responsável', 'select id from core.equipe where responsavel_id = $1', [A.usuarios.supervisor], 'equipe_responsavel_ix'],
    ])('%s', async (_rotulo, sql, params, indice) => {
      const p = await plano(sql, params);
      expect(p).toContain(indice);
      // a política (tenant_id = plataforma.tenant_atual(), função SQL inline) entra como condição do índice
      expect(p).toMatch(/Index Cond: \(\(tenant_id = .*app\.tenant_id/);
    });
  });
});
