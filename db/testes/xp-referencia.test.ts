/**
 * 0044 — lançamento de XP com referência maior e chaves de idempotência (T-0106; pedido R-20261107-233051-modulo-treinamento;
 * RN-TRE-01/02/04/08). O que o BANCO garante: treinamento.xp_lancamento.referencia_id com 1..160 caracteres (CHECK
 * xp_lancamento_referencia_tamanho, mesmo nome da 0017); a chave natural xp_lancamento_chave_uk (tenant, usuário, origem,
 * referência) continua TOTAL (alvo do `on conflict` do repositório); xp_lancamento_tenant_id_uk (tenant_id, id); sem índice
 * novo (sob RLS o LIKE não vira Index Cond: o teto do desafio entra pela chave natural com igualdade em tenant, usuário e
 * origem), sem política nem grant novo (append-only). Down volta ao catálogo da 0043 e PARA (P0001) se houver referência acima de 128.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre as fixtures dois-tenants + Treinamento, sempre com ROLLBACK; up/down num banco
 * efêmero. Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { TREINAMENTO_FIXTURE } from './fixture-treinamento';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ALUNO_A = TREINAMENTO_FIXTURE.A.aluno;
const migracoes = lerMigracoes();
const m44 = migracoes.find((m) => m.versao === '0044')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** Referência do desafio como o domain monta (desafio_id:pedido_id:evento_id), esticada até `n` caracteres. */
const referencia = (n: number) => `${'d'.repeat(36)}:${'p'.repeat(36)}:${'e'.repeat(n - 74)}`;

describe('0044 xp_lancamento referência e chaves (estático)', () => {
  it('nome e posição: 0044_treinamento_xp_referencia logo depois da 0043', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0043_integracao_cancelamento_erp') + 1]).toBe('0044_treinamento_xp_referencia');
  });

  it('só treinamento.xp_lancamento: CHECK 1..160 com o mesmo nome e único (tenant_id, id); sem índice, política nem grant', () => {
    const sql = semComentarios(m44.up);
    expect(sql).toContain('alter table treinamento.xp_lancamento drop constraint xp_lancamento_referencia_tamanho;');
    expect(sql).toContain('check (char_length(referencia_id) between 1 and 160);');
    expect(sql).toContain('add constraint xp_lancamento_tenant_id_uk unique (tenant_id, id);');
    expect(sql).not.toMatch(/create table|create (unique )?index|create policy|grant |revoke |update |delete from|insert into|xp_lancamento_chave_uk|where /);
    expect(new Set([...sql.matchAll(/\b([a-z_]+)\.[a-z_]+/g)].map((x) => x[1]))).toEqual(new Set(['treinamento']));
  });

  it('down: confere antes (raise com a contagem), tira o único e volta o CHECK a 1..128; idempotente', () => {
    const down = semComentarios(m44.down);
    expect(down).toContain('where char_length(referencia_id) > 128');
    expect(down).toContain('raise exception');
    expect(down).toContain('drop constraint if exists xp_lancamento_tenant_id_uk;');
    expect(down).toContain('check (char_length(referencia_id) between 1 and 128);');
    expect(down.indexOf('raise exception')).toBeLessThan(down.indexOf('drop constraint'));
  });

  it('a referência do desafio com 3 UUIDs cabe com folga (110 de 160)', () => {
    expect(`${crypto.randomUUID()}:${crypto.randomUUID()}:${crypto.randomUUID()}`.length).toBe(110);
  });
});

describe.skipIf(semBanco())('0044 xp_lancamento (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const lancar = (ref: string, id: string | null = null, sufixo = '') =>
    q(
      `insert into treinamento.xp_lancamento (id, tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, ocorrido_em, dia)
       select coalesce($4::uuid, gen_random_uuid()), $1, $2, 'desafio_vendas', $3, 5, 5, x.dia, x.dia
         from (select dia from treinamento.xp_lancamento where tenant_id = $1 and usuario_id = $2 order by dia limit 1) x ${sufixo}`,
      [A, ALUNO_A, ref, id],
    );

  it('referência de 128 e de 160 caracteres entram; 161 e vazia = 23514 (xp_lancamento_referencia_tamanho)', async () => {
    await emTransacao(app, A, async () => {
      expect((await lancar(referencia(128))).rowCount).toBe(1);
      expect((await lancar(referencia(160))).rowCount).toBe(1);
    });
    for (const ref of [referencia(161), '']) {
      const e = await erroDe(emTransacao(app, A, () => lancar(ref)));
      expect(e).toMatchObject({ code: '23514', message: expect.stringContaining('xp_lancamento_referencia_tamanho') });
    }
  });

  it('chave natural: segundo lançamento igual com outro id = 23505 (xp_lancamento_chave_uk); on conflict do nothing não duplica', async () => {
    const ref = referencia(128);
    const e = await erroDe(
      emTransacao(app, A, async () => {
        await lancar(ref);
        await lancar(ref);
      }),
    );
    expect(e).toMatchObject({ code: '23505', message: expect.stringContaining('xp_lancamento_chave_uk') });
    await emTransacao(app, A, async () => {
      expect((await lancar(ref)).rowCount).toBe(1);
      expect((await lancar(ref, null, 'on conflict (tenant_id, usuario_id, origem, referencia_id) do nothing')).rowCount).toBe(0);
      expect((await q('select count(*)::int as n from treinamento.xp_lancamento where referencia_id = $1', [ref])).rows).toEqual([{ n: 1 }]);
    });
  });

  it('mesmo id com outra referência = 23505 (idempotência por id)', async () => {
    const id = crypto.randomUUID();
    const e = await erroDe(
      emTransacao(app, A, async () => {
        await lancar(referencia(100), id);
        await lancar(referencia(101), id);
      }),
    );
    expect(e?.code).toBe('23505');
  });

  // Com a fixture pequena o planejador escolhe pelo custo (e pela estatística do momento) entre os índices que começam por
  // (tenant_id, usuario_id): a chave natural (0044), o xp_lancamento_usuario_dia_ix e o xp_lancamento_usuario_sync_ix (0017). O que
  // importa ao teto (centenas de linhas por usuário) é a entrada por índice com igualdade em (tenant, usuário), não QUAL índice:
  // o teste aceita qualquer um deles (R-20261108-130439-testes, item 4: o nome fixo deixava o caso frágil).
  it('teto do desafio: entra por índice com igualdade em (tenant, usuário) — qualquer índice do xp_lancamento; o LIKE fica no filtro', async () => {
    await emTransacao(app, A, async () => {
      await q('set local enable_seqscan = off');
      const plano = await q<{ 'QUERY PLAN': string }>(
        `explain select coalesce(sum(pontos), 0) from treinamento.xp_lancamento
          where tenant_id = '${A}' and usuario_id = '${ALUNO_A}' and origem = 'desafio_vendas' and referencia_id like '${'d'.repeat(36)}:%'`,
      );
      const texto = plano.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(texto).toMatch(/(?:Index (?:Only )?Scan using|Bitmap Index Scan on) xp_lancamento_[a-z_]+/);
      expect(texto).toMatch(/Index Cond: .*tenant_id = .*usuario_id = /);
      expect(texto).not.toContain('Seq Scan');
    });
  });

  it('vazamento entre tenants: B não vê o lançamento longo de A', async () => {
    await emTransacao(app, A, async () => {
      await lancar(referencia(160));
      await q("select set_config('app.tenant_id', $1, true)", [B]);
      expect((await q('select 1 from treinamento.xp_lancamento where referencia_id = $1', [referencia(160)])).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0044 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000044';
  const U = 'cccccccc-0044-4000-8000-000000000001';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const desde0044 = nomes.filter((n) => n >= '0044');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('linha de 128 atravessa up e down; com 160 o down para (P0001) sem mudar nada; sem ela volta à 0043; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0043' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo44', 'Antigo')", [T]);
      const inserir = (ref: string) =>
        c.query(
          `insert into treinamento.xp_lancamento (tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, ocorrido_em, dia)
           values ($1, $2, 'licao', $3, 10, 10, '2026-01-02T12:00:00Z', '2026-01-02')`, // hora-fixa-ok: só instantes fixos neste caso
          [T, U, ref],
        );
      await inserir(referencia(128));
      expect((await migrarUp(c)).aplicadas).toEqual(desde0044);
      const depois = await retratoDoCatalogo(c);
      expect(depois.some((l) => l.includes('xp_lancamento_referencia_tamanho') && l.includes('160'))).toBe(true);
      expect(depois.some((l) => l.includes('xp_lancamento_tenant_id_uk') && l.includes('UNIQUE (tenant_id, id)'))).toBe(true);
      await inserir(referencia(160));
      const e = await erroDe(c.query(m44.down));
      expect(e).toMatchObject({ code: 'P0001', message: expect.stringContaining('1 lançamento(s)') });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      await c.query('delete from treinamento.xp_lancamento where char_length(referencia_id) > 128');
      expect((await migrarDown(c, { passos: desde0044.length })).aplicadas).toEqual([...desde0044].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select count(*)::int as n from treinamento.xp_lancamento where tenant_id = $1', [T])).rows).toEqual([{ n: 1 }]);
      await c.query(m44.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
