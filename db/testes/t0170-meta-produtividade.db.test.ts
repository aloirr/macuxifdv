/**
 * 0066 — metas de produtividade, km do dia e meta de itens por pedido (T-0170; desenho
 * docs/desenho/performance-produtividade.md §5, §6.1 e §7.4). Dicionário: docs/banco/core.md, "0066". O que o BANCO garante:
 * - core.meta_produtividade: escopo tenant|equipe|usuario com o alvo só e sempre no escopo dele, um dos 12 indicadores do
 *   contrato, valor >= 0, vigência 'AAAA-MM', uma viva por (tenant, escopo, alvo, indicador, vigência) — inclusive no escopo
 *   tenant, de alvo nulo;
 * - core.deslocamento_dia (vazia até o rastreamento da T-0156): um resumo vivo por (tenant, usuário, data), metros e pontos >= 0,
 *   primeiro e último ponto juntos e em ordem, origem 'rastreamento';
 * - core.meta aceita o indicador 'itens_por_pedido' (centésimos);
 * - RLS enable + force entre dois tenants; macuxi_app sem DELETE.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeslocamentoDiaSchema, ESCOPOS_META_PRODUTIVIDADE, INDICADORES_PRODUTIVIDADE, INDICADORES_RESULTADO } from '../../modules/core/contracts/performance';
import { INDICADORES_META } from '../../modules/core/contracts/sync';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m66 = migracoes.find((m) => m.versao === '0066')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m66.up);
const down = semComentarios(m66.down);
const umaLinha = up.replace(/\s+/g, ' ');
const lista = (v: readonly string[]) => v.map((x) => `'${x}'`).join(', ');

const colunasDoSql = (tabela: string): string[] => {
  const corpo = new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(up)?.[1] ?? '';
  return [...corpo.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|date|timestamptz|boolean|integer)\b/gm)].map((m) => m[1]!);
};
const colunasDrizzle = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).columns.map((c) => c.name).sort();

describe('0066 metas de produtividade e km do dia (estático)', () => {
  it('nome e posição: 0066_core_meta_produtividade logo depois da 0065', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0065_core_frase_avatar') + 1]).toBe('0066_core_meta_produtividade');
  });

  it('meta_produtividade: listas = contrato (12 indicadores, 3 escopos) e as do espelho Drizzle', () => {
    expect(umaLinha).toContain(`constraint meta_produtividade_indicador_valido check (indicador in (${lista(INDICADORES_PRODUTIVIDADE)}))`);
    expect(umaLinha).toContain(`constraint meta_produtividade_escopo_valido check (escopo in (${lista(ESCOPOS_META_PRODUTIVIDADE)}))`);
    expect([...nuvemCore.INDICADORES_PRODUTIVIDADE_BANCO]).toEqual([...INDICADORES_PRODUTIVIDADE]);
    expect([...nuvemCore.ESCOPOS_META_PRODUTIVIDADE_BANCO]).toEqual([...ESCOPOS_META_PRODUTIVIDADE]);
  });

  it('meta_produtividade: alvo coerente, FKs compostas, valor >= 0, vigência AAAA-MM; único vivo com coalesce do alvo', () => {
    for (const trecho of [
      // alvo coerente: gatilho de restrição AFTER (a FK cruzada decide antes; S0-025), não CHECK
      "if (new.escopo = 'equipe') is distinct from (new.equipe_id is not null) then v_regra := 'meta_produtividade_equipe_coerente';",
      "elsif (new.escopo = 'usuario') is distinct from (new.usuario_id is not null) then v_regra := 'meta_produtividade_usuario_coerente';",
      'create constraint trigger meta_produtividade_conferir_alvo after insert or update of escopo, equipe_id, usuario_id on core.meta_produtividade for each row execute function core.meta_produtividade_conferir_alvo();',
      'constraint meta_produtividade_equipe_fk foreign key (tenant_id, equipe_id) references core.equipe (tenant_id, id)',
      'constraint meta_produtividade_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)',
      'constraint meta_produtividade_atualizado_por_fk foreign key (tenant_id, atualizado_por) references core.usuario (tenant_id, id)',
      'constraint meta_produtividade_valor_nao_negativo check (valor >= 0)',
      "constraint meta_produtividade_vigencia_formato check (vigencia_inicio ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')",
      "create unique index meta_produtividade_vigencia_uk on core.meta_produtividade (tenant_id, escopo, coalesce(equipe_id, usuario_id, '00000000-0000-0000-0000-000000000000'::uuid), indicador, vigencia_inicio) where deleted_at is null;",
      'create index meta_produtividade_indicador_ix on core.meta_produtividade (tenant_id, indicador, escopo);',
    ]) expect(umaLinha).toContain(trecho);
  });

  it('deslocamento_dia: origem = contrato; único vivo por (usuário, data); pull por usuário; sem coordenada', () => {
    const origens = DeslocamentoDiaSchema.shape.origem.options;
    expect(umaLinha).toContain(`constraint deslocamento_dia_origem_valida check (origem in (${lista(origens)}))`);
    expect(up).toContain('create unique index deslocamento_dia_uk on core.deslocamento_dia (tenant_id, usuario_id, data) where deleted_at is null;');
    expect(up).toContain('create index deslocamento_dia_usuario_sync_ix on core.deslocamento_dia (tenant_id, usuario_id, updated_at, id);');
    expect(colunasDoSql('core.deslocamento_dia').join(' ')).not.toMatch(/lat|lon|geo/);
    // as colunas do contrato de sync existem na tabela
    for (const c of Object.keys(DeslocamentoDiaSchema.shape)) expect(colunasDoSql('core.deslocamento_dia')).toContain(c);
  });

  it("core.meta.indicador: os 4 de antes + 'itens_por_pedido' (o indicador de resultado novo da Performance)", () => {
    expect(umaLinha).toContain("alter table core.meta drop constraint meta_indicador_valido;");
    expect(umaLinha).toContain(
      "alter table core.meta add constraint meta_indicador_valido check (indicador in ('venda_cents', 'positivacao', 'cobertura_pct', 'visitas', 'itens_por_pedido'));",
    );
    const doCheck = [...(/meta_indicador_valido check \(indicador in \(([^)]*)\)\)/.exec(umaLinha)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    for (const i of INDICADORES_META) expect(doCheck).toContain(i);
    for (const i of INDICADORES_RESULTADO) expect(doCheck).toContain(i);
  });

  it('RLS enable + force, isolamento_tenant e manutencao; macuxi_app sem DELETE', () => {
    for (const t of ['core.meta_produtividade', 'core.deslocamento_dia']) {
      expect(up).toContain(`alter table ${t} enable row level security;`);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(up).toContain(`grant select, insert, update on ${t} to macuxi_app;`);
      expect(up).toContain(`on ${t} (tenant_id, updated_at, id);`);
    }
    expect(up).not.toMatch(/grant [^;]*delete/);
  });

  it('down idempotente: apaga as metas itens_por_pedido, volta o CHECK aos 4 da 0006 e apaga as tabelas', () => {
    expect(down).toContain("delete from core.meta where indicador = 'itens_por_pedido';");
    expect(down.replace(/\s+/g, ' ')).toContain(
      "alter table core.meta add constraint meta_indicador_valido check (indicador in ('venda_cents', 'positivacao', 'cobertura_pct', 'visitas'));",
    );
    expect(down).toContain('alter table core.meta drop constraint if exists meta_indicador_valido;');
    expect(down.indexOf('delete from core.meta')).toBeLessThan(down.indexOf('add constraint meta_indicador_valido'));
    for (const t of ['core.deslocamento_dia', 'core.meta_produtividade']) expect(down).toContain(`drop table if exists ${t};`);
    expect(down).toContain('drop function if exists core.meta_produtividade_conferir_alvo();');
  });

  it('espelho Drizzle: mesmas colunas do SQL', () => {
    expect(colunasDrizzle(nuvemCore.metaProdutividade)).toEqual(colunasDoSql('core.meta_produtividade').sort());
    expect(colunasDrizzle(nuvemCore.deslocamentoDia)).toEqual(colunasDoSql('core.deslocamento_dia').sort());
  });
});

describe.skipIf(semBanco())('0066 metas de produtividade e km do dia (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const recusa = async (sql: string, p: unknown[], code: string, trecho: string) => {
    await q('savepoint s');
    expect(await erroDe(q(sql, p)), `${sql} ${JSON.stringify(p)}`).toMatchObject({ code, message: expect.stringContaining(trecho) });
    await q('rollback to savepoint s');
  };
  const META = 'insert into core.meta_produtividade (tenant_id, escopo, equipe_id, usuario_id, indicador, valor, vigencia_inicio) values ($1, $2, $3, $4, $5, $6, $7)';
  const DESL = 'insert into core.deslocamento_dia (tenant_id, usuario_id, data, metros, pontos, primeiro_ponto_em, ultimo_ponto_em, origem) values ($1, $2, $3, $4, $5, $6, $7, $8)';

  it('meta: tenant, equipe e usuário convivem; repetida viva = 23505 (inclusive no escopo tenant); voltar a herdar libera', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q(`${META} returning id`, [A.tenantId, 'tenant', null, null, 'tma', 30, '2031-12']);
      await q(META, [A.tenantId, 'equipe', A.equipes.equipe1, null, 'tma', 25, '2031-12']);
      await q(META, [A.tenantId, 'usuario', null, A.usuarios.vendedor1, 'tma', 20, '2031-12']);
      await q(META, [A.tenantId, 'tenant', null, null, 'tma', 28, '2032-01']); // vigência nova, mesma meta
      await recusa(META, [A.tenantId, 'tenant', null, null, 'tma', 31, '2031-12'], '23505', 'meta_produtividade_vigencia_uk');
      await recusa(META, [A.tenantId, 'equipe', A.equipes.equipe1, null, 'tma', 1, '2031-12'], '23505', 'meta_produtividade_vigencia_uk');
      await recusa(META, [A.tenantId, 'usuario', null, A.usuarios.vendedor1, 'tma', 1, '2031-12'], '23505', 'meta_produtividade_vigencia_uk');
      await q('update core.meta_produtividade set deleted_at = now() where id = $1', [r.rows[0]!.id]);
      await q(META, [A.tenantId, 'tenant', null, null, 'tma', 31, '2031-12']);
    });
  });

  it('meta: recusas = 23514 com o nome da regra; alvo de outro tenant = 23503 (mesmo com o alvo incoerente)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const casos: [unknown[], string, string][] = [
        [[A.tenantId, 'empresa', null, null, 'tma', 30, '2031-12'], '23514', 'meta_produtividade_escopo_valido'],
        [[A.tenantId, 'equipe', null, null, 'tma', 30, '2031-12'], '23514', 'meta_produtividade_equipe_coerente'],
        [[A.tenantId, 'tenant', A.equipes.equipe1, null, 'tma', 30, '2031-12'], '23514', 'meta_produtividade_equipe_coerente'],
        [[A.tenantId, 'usuario', null, null, 'tma', 30, '2031-12'], '23514', 'meta_produtividade_usuario_coerente'],
        [[A.tenantId, 'tenant', null, A.usuarios.vendedor1, 'tma', 30, '2031-12'], '23514', 'meta_produtividade_usuario_coerente'],
        [[A.tenantId, 'tenant', null, null, 'venda_cents', 30, '2031-12'], '23514', 'meta_produtividade_indicador_valido'],
        [[A.tenantId, 'tenant', null, null, 'tma', -1, '2031-12'], '23514', 'meta_produtividade_valor_nao_negativo'],
        [[A.tenantId, 'tenant', null, null, 'tma', 30, '2031-13'], '23514', 'meta_produtividade_vigencia_formato'],
        [[A.tenantId, 'tenant', null, null, 'tma', 30, '2031-12-01'], '23514', 'meta_produtividade_vigencia_formato'],
        [[A.tenantId, 'usuario', null, B.usuarios.vendedor, 'tma', 30, '2031-12'], '23503', 'meta_produtividade_usuario_fk'],
        [[A.tenantId, 'equipe', B.equipes.equipe, null, 'tma', 30, '2031-12'], '23503', 'meta_produtividade_equipe_fk'],
        // a FK cruzada decide antes da coerência do alvo (gatilho AFTER, S0-025)
        [[A.tenantId, 'tenant', null, B.usuarios.vendedor, 'tma', 30, '2031-12'], '23503', 'meta_produtividade_usuario_fk'],
        [[A.tenantId, 'usuario', B.equipes.equipe, A.usuarios.vendedor1, 'tma', 30, '2031-12'], '23503', 'meta_produtividade_equipe_fk'],
      ];
      for (const [p, code, trecho] of casos) await recusa(META, p, code, trecho);
      for (const indicador of INDICADORES_PRODUTIVIDADE) await q(META, [A.tenantId, 'tenant', null, null, indicador, 0, '2030-01']);
    });
  });

  it('deslocamento_dia: um vivo por (usuário, data); recusas = 23514', async () => {
    await emTransacao(app, A.tenantId, async () => {
      // hora-fixa-ok: instantes de exemplo do resumo, nunca comparados ao relógio
      const p1 = '2031-11-13T12:00:00Z';
      const p2 = '2031-11-13T21:00:00Z'; // hora-fixa-ok: idem
      await q(DESL, [A.tenantId, A.usuarios.vendedor1, '2031-11-13', 84_200, 312, p1, p2, 'rastreamento']);
      await recusa(DESL, [A.tenantId, A.usuarios.vendedor1, '2031-11-13', 1, 1, p1, p1, 'rastreamento'], '23505', 'deslocamento_dia_uk');
      const casos: [unknown[], string][] = [
        [[A.tenantId, A.usuarios.vendedor2, '2031-11-13', -1, 0, null, null, 'rastreamento'], 'deslocamento_dia_metros_nao_negativo'],
        [[A.tenantId, A.usuarios.vendedor2, '2031-11-13', 0, -1, null, null, 'rastreamento'], 'deslocamento_dia_pontos_nao_negativo'],
        [[A.tenantId, A.usuarios.vendedor2, '2031-11-13', 0, 0, p1, null, 'rastreamento'], 'deslocamento_dia_pontos_par'],
        [[A.tenantId, A.usuarios.vendedor2, '2031-11-13', 0, 0, p2, p1, 'rastreamento'], 'deslocamento_dia_pontos_ordem'],
        [[A.tenantId, A.usuarios.vendedor2, '2031-11-13', 0, 0, null, null, 'manual'], 'deslocamento_dia_origem_valida'],
      ];
      for (const [p, trecho] of casos) await recusa(DESL, p, '23514', trecho);
      // recálculo do dia inteiro = update da mesma linha (idempotente)
      await q("update core.deslocamento_dia set metros = 90000, pontos = 330 where usuario_id = $1 and data = '2031-11-13'", [A.usuarios.vendedor1]);
    });
  });

  it("core.meta aceita 'itens_por_pedido' (centésimos); indicador desconhecido continua 23514", async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) values ($1, $2, '2030-01', 'itens_por_pedido', 350)", [A.tenantId, A.usuarios.vendedor1]);
      await recusa("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) values ($1, $2, '2030-01', 'mix', 1)", [A.tenantId, A.usuarios.vendedor1], '23514', 'meta_indicador_valido');
    });
  });

  it('macuxi_app não apaga (42501); vazamento: B não vê, não altera nem grava as de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      for (const t of ['meta_produtividade', 'deslocamento_dia']) await recusa(`delete from core.${t}`, [], '42501', t);
      const meta = (await q(`${META} returning id`, [A.tenantId, 'tenant', null, null, 'raio_checkin', 100, '2030-01'])).rows[0]!.id as string;
      const desl = (
        await q(`${DESL} returning id`, [A.tenantId, A.usuarios.vendedor1, '2030-01-02', 1000, 2, '2030-01-02T12:00:00Z', '2030-01-02T13:00:00Z', 'rastreamento']) // hora-fixa-ok: instantes de exemplo, nunca comparados ao relógio
      ).rows[0]!.id as string;
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await q('select id from core.meta_produtividade where id = $1 or tenant_id = $2', [meta, A.tenantId])).rowCount).toBe(0);
      expect((await q('select id from core.deslocamento_dia where id = $1 or tenant_id = $2', [desl, A.tenantId])).rowCount).toBe(0);
      expect((await q('update core.meta_produtividade set valor = 1 where id = $1', [meta])).rowCount).toBe(0);
      await recusa(META, [A.tenantId, 'tenant', null, null, 'tma', 30, '2030-01'], '42501', 'row-level security');
    });
    await emTransacao(app, '', async () => {
      expect((await q('select id from core.meta_produtividade')).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0066 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000066';
  const U = 'cccccccc-0000-4000-8000-000000001066';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('metas de antes ficam; down apaga só as itens_por_pedido e volta ao catálogo da 0065; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0065' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo66', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Antigo', 'antigo66@exemplo.com.br', 'vendedor')", [U, T]);
      await c.query("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) values ($1, $2, '2026-11', 'venda_cents', 100000)", [T, U]);
      expect((await migrarUp(c, { ate: '0066' })).aplicadas).toEqual(['0066_core_meta_produtividade']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('rel core.meta_produtividade r rls=true force=true');
      expect(depois).toContain('rel core.deslocamento_dia r rls=true force=true');
      await c.query("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) values ($1, $2, '2026-11', 'itens_por_pedido', 350)", [T, U]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0066_core_meta_produtividade']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select indicador, valor::int as valor from core.meta where tenant_id = $1', [T])).rows).toEqual([{ indicador: 'venda_cents', valor: 100000 }]);
      await c.query(m66.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0066' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
