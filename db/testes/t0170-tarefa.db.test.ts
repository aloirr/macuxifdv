/**
 * 0064 — tarefas do consultor (T-0170, RN-CORE-TAR-01..12; desenho docs/desenho/tarefas-consultor.md §3). Dicionário:
 * docs/banco/core.md, "0064". O que o BANCO garante:
 * - core.tarefa: título 1..120, descrição <= 1000, tipo/alvo fechados, questionário só e sempre na pesquisa, equipe só e sempre
 *   no alvo equipe, cancelamento com quem cancelou, motivo <= 300 só na cancelada; FKs compostas (autor, cliente, equipe);
 * - core.tarefa_destinatario: uma viva por (tarefa, usuário), conclusao_id único (idempotência do push), concluída e recebida
 *   juntas, observação <= 500;
 * - mudar o que o aparelho mostra na tarefa anda o updated_at dos destinatários (gatilho tarefa_tocar_destinatarios);
 * - core.notificacao.tarefa_id: só com subtipo 'tarefa', um aviso por (usuário, tarefa);
 * - RLS enable + force entre dois tenants; macuxi_app sem DELETE.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUBTIPO_NOTIFICACAO_TAREFA, TIPOS_TAREFA } from '../../modules/core/contracts/tarefa';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m64 = migracoes.find((m) => m.versao === '0064')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m64.up);
const down = semComentarios(m64.down);
const umaLinha = up.replace(/\s+/g, ' ');

/** Colunas do `create table x (...)` da migração, na ordem. */
const colunasDoSql = (tabela: string): string[] => {
  const corpo = new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(up)?.[1] ?? '';
  return [...corpo.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|date|timestamptz|boolean|integer)\b/gm)].map((m) => m[1]!);
};
const colunasDrizzle = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).columns.map((c) => c.name).sort();

describe('0064 tarefas do consultor (estático)', () => {
  it('nome e posição: 0064_core_tarefa logo depois da 0063', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0063_core_usuario_limite_desconto') + 1]).toBe('0064_core_tarefa');
  });

  it('core.tarefa: CHECKs e FKs compostas do desenho §3.1; questionário sem FK (schema pesquisa)', () => {
    for (const trecho of [
      'constraint tarefa_tenant_id_uk unique (tenant_id, id)',
      'constraint tarefa_autor_fk foreign key (tenant_id, autor_id) references core.usuario (tenant_id, id)',
      'constraint tarefa_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id)',
      'constraint tarefa_equipe_fk foreign key (tenant_id, equipe_id) references core.equipe (tenant_id, id)',
      'constraint tarefa_cancelada_por_fk foreign key (tenant_id, cancelada_por) references core.usuario (tenant_id, id)',
      "constraint tarefa_titulo_tamanho check (btrim(titulo) <> '' and char_length(titulo) <= 120)",
      'constraint tarefa_descricao_tamanho check (descricao is null or char_length(descricao) <= 1000)',
      "constraint tarefa_questionario_coerente check ((tipo = 'pesquisa') = (questionario_id is not null))",
      "constraint tarefa_equipe_coerente check ((alvo = 'equipe') = (equipe_id is not null))",
      'constraint tarefa_cancelamento_par check ((cancelada_em is null) = (cancelada_por is null))',
      'constraint tarefa_motivo_tamanho check (motivo_cancelamento is null or char_length(motivo_cancelamento) <= 300)',
      'constraint tarefa_motivo_so_cancelada check (motivo_cancelamento is null or cancelada_em is not null)',
    ]) expect(umaLinha).toContain(trecho);
    expect(up).not.toMatch(/references pesquisa\./);
    expect(up).not.toMatch(/provisionar_tenant/);
  });

  it('listas fechadas = contratos (tipo da tarefa; alvo do destino) e o subtipo do aviso é conhecido', () => {
    const valores = (col: string) => [...(new RegExp(`check \\(${col} in \\(([^)]*)\\)\\)`).exec(up)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(valores('tipo')).toEqual([...TIPOS_TAREFA]);
    expect([...nuvemCore.TIPOS_TAREFA_BANCO]).toEqual([...TIPOS_TAREFA]);
    expect(valores('alvo')).toEqual(['usuarios', 'equipe', 'todos']);
    expect([...nuvemCore.ALVOS_TAREFA_BANCO]).toEqual(['usuarios', 'equipe', 'todos']);
    expect(nuvemCore.SUBTIPOS_NOTIFICACAO_CONHECIDOS).toContain(SUBTIPO_NOTIFICACAO_TAREFA);
    expect(umaLinha).toContain(`check (tarefa_id is null or subtipo is not distinct from '${SUBTIPO_NOTIFICACAO_TAREFA}')`);
  });

  it('índices do desenho (sync, autor, abertas, destinatário) e únicos vivos', () => {
    for (const i of [
      'create index tarefa_sync_ix on core.tarefa (tenant_id, updated_at, id);',
      'create index tarefa_autor_ix on core.tarefa (tenant_id, autor_id, created_at desc);',
      'create index tarefa_prazo_abertas_ix on core.tarefa (tenant_id, prazo) where cancelada_em is null and deleted_at is null;',
      'create unique index tarefa_external_uk on core.tarefa (tenant_id, external_id) where external_id is not null and deleted_at is null;',
      'create unique index tarefa_dest_usuario_uk on core.tarefa_destinatario (tenant_id, tarefa_id, usuario_id) where deleted_at is null;',
      'create unique index tarefa_dest_conclusao_uk on core.tarefa_destinatario (tenant_id, conclusao_id) where conclusao_id is not null;',
      'create index tarefa_dest_sync_ix on core.tarefa_destinatario (tenant_id, updated_at, id);',
      'create index tarefa_dest_usuario_sync_ix on core.tarefa_destinatario (tenant_id, usuario_id, updated_at, id);',
      'create index tarefa_dest_abertas_ix on core.tarefa_destinatario (tenant_id, usuario_id) where concluida_em is null and deleted_at is null;',
      'create index tarefa_dest_tarefa_ix on core.tarefa_destinatario (tenant_id, tarefa_id);',
      'create unique index notificacao_tarefa_uk on core.notificacao (tenant_id, usuario_id, tarefa_id) where tarefa_id is not null;',
    ]) expect(up).toContain(i);
  });

  it('RLS enable + force, isolamento_tenant e manutencao; macuxi_app sem DELETE', () => {
    for (const t of ['core.tarefa', 'core.tarefa_destinatario']) {
      expect(up).toContain(`alter table ${t} enable row level security;`);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(up).toContain(`grant select, insert, update on ${t} to macuxi_app;`);
    }
    expect(up).not.toMatch(/grant [^;]*delete[^;]* on core\.tarefa/);
    expect(up).not.toMatch(/macuxi_worker/);
  });

  it('gatilho: só o que o aparelho mostra anda o updated_at dos destinatários', () => {
    expect(umaLinha).toContain(
      'create trigger tarefa_tocar_destinatarios after update on core.tarefa for each row when ((old.titulo, old.descricao, old.prazo, old.tipo, old.cliente_id, old.questionario_id, old.cancelada_em, old.deleted_at) is distinct from (new.titulo, new.descricao, new.prazo, new.tipo, new.cliente_id, new.questionario_id, new.cancelada_em, new.deleted_at)) execute function core.tocar_destinatarios_tarefa();',
    );
  });

  it('down idempotente desfaz tudo (único, CHECK, FK e coluna da notificacao; tabelas; função)', () => {
    for (const trecho of [
      'drop index if exists core.notificacao_tarefa_uk;',
      'alter table core.notificacao drop constraint if exists notificacao_tarefa_subtipo;',
      'alter table core.notificacao drop constraint if exists notificacao_tarefa_fk;',
      'alter table core.notificacao drop column if exists tarefa_id;',
      'drop table if exists core.tarefa_destinatario;',
      'drop table if exists core.tarefa;',
      'drop function if exists core.tocar_destinatarios_tarefa();',
    ]) expect(down).toContain(trecho);
    expect(down.indexOf('drop table if exists core.tarefa_destinatario;')).toBeLessThan(down.indexOf('drop table if exists core.tarefa;'));
    expect(down.indexOf('drop column if exists tarefa_id;')).toBeLessThan(down.indexOf('drop table if exists core.tarefa;'));
    expect(down).not.toMatch(/\b(create|add)\b/i);
  });

  it('espelho Drizzle: mesmas colunas do SQL (tarefa, tarefa_destinatario e notificacao.tarefa_id)', () => {
    expect(colunasDrizzle(nuvemCore.tarefa)).toEqual(colunasDoSql('core.tarefa').sort());
    expect(colunasDrizzle(nuvemCore.tarefaDestinatario)).toEqual(colunasDoSql('core.tarefa_destinatario').sort());
    expect(getTableConfig(nuvemCore.notificacao).columns.find((c) => c.name === 'tarefa_id')?.notNull).toBe(false);
    const suspeita = getTableConfig(nuvemCore.tarefaDestinatario).columns.find((c) => c.name === 'suspeita');
    expect([suspeita?.notNull, suspeita?.default]).toEqual([true, false]);
  });
});

describe.skipIf(semBanco())('0064 tarefas do consultor (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const T1 = 'aaaaaaaa-0170-4000-8000-000000000001';
  const D1 = 'aaaaaaaa-0170-4000-8000-000000000101';
  const D2 = 'aaaaaaaa-0170-4000-8000-000000000102';
  const QUEST = 'aaaaaaaa-0170-4000-8000-000000000901';
  /** hora-fixa-ok: instante de exemplo do cancelamento, nunca comparado ao relógio. */
  const CANCELADA = '2026-11-13T12:00:00Z';

  const criarTarefa = (id = T1, extra = '', vals: unknown[] = []) =>
    q(
      `insert into core.tarefa (id, tenant_id, autor_id, titulo, prazo, cliente_id, tipo, alvo${extra ? `, ${extra}` : ''})
       values ($1, $2, $3, 'Conferir gôndola', current_date + 3, $4, 'simples', 'usuarios'${vals.map((_, i) => `, $${i + 5}`).join('')})`,
      [id, A.tenantId, A.usuarios.gerente, A.clientes.c1, ...vals],
    );
  const criarDestinatarios = async () => {
    // updated_at de ontem: o gatilho da tarefa é o único que pode trazê-lo para now()
    await q("insert into core.tarefa_destinatario (id, tenant_id, tarefa_id, usuario_id, updated_at) values ($1, $2, $3, $4, now() - interval '1 day'), ($5, $2, $3, $6, now() - interval '1 day')", [
      D1, A.tenantId, T1, A.usuarios.vendedor1, D2, A.usuarios.promotor,
    ]);
  };
  const recusa = async (sql: string, p: unknown[], code: string, trecho: string) => {
    await q('savepoint s');
    expect(await erroDe(q(sql, p)), sql).toMatchObject({ code, message: expect.stringContaining(trecho) });
    await q('rollback to savepoint s');
  };

  it('cria a tarefa e uma linha por consultor; padrões (suspeita falsa, sem conclusão)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await criarTarefa();
      await criarDestinatarios();
      const r = await q('select usuario_id, concluida_em, recebida_em, conclusao_id, suspeita, deleted_at from core.tarefa_destinatario where tarefa_id = $1 order by id', [T1]);
      expect(r.rows).toEqual([
        { usuario_id: A.usuarios.vendedor1, concluida_em: null, recebida_em: null, conclusao_id: null, suspeita: false, deleted_at: null },
        { usuario_id: A.usuarios.promotor, concluida_em: null, recebida_em: null, conclusao_id: null, suspeita: false, deleted_at: null },
      ]);
    });
  });

  it('recusas da tarefa = 23514 com o nome do CHECK; FK de outro tenant = 23503', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = `insert into core.tarefa (tenant_id, autor_id, titulo, prazo, tipo, alvo, questionario_id, equipe_id, cancelada_em, cancelada_por, motivo_cancelamento, descricao)
                   values ($1, $2, $3, current_date, $4, $5, $6, $7, $8, $9, $10, $11)`;
      const base: unknown[] = [A.tenantId, A.usuarios.gerente, 'T', 'simples', 'usuarios', null, null, null, null, null, null];
      const com = (i: number, v: unknown, ...mais: [number, unknown][]) => {
        const p = [...base];
        p[i] = v;
        for (const [j, w] of mais) p[j] = w;
        return p;
      };
      await recusa(ins, com(2, '   '), '23514', 'tarefa_titulo_tamanho');
      await recusa(ins, com(2, 'x'.repeat(121)), '23514', 'tarefa_titulo_tamanho');
      await recusa(ins, com(10, 'x'.repeat(1001)), '23514', 'tarefa_descricao_tamanho');
      await recusa(ins, com(3, 'pedido'), '23514', 'tarefa_tipo_valido');
      await recusa(ins, com(3, 'pesquisa'), '23514', 'tarefa_questionario_coerente');
      await recusa(ins, com(5, QUEST), '23514', 'tarefa_questionario_coerente');
      await recusa(ins, com(4, 'equipe'), '23514', 'tarefa_equipe_coerente');
      await recusa(ins, com(6, A.equipes.equipe1), '23514', 'tarefa_equipe_coerente');
      await recusa(ins, com(4, 'gerente'), '23514', 'tarefa_alvo_valido');
      await recusa(ins, com(7, CANCELADA), '23514', 'tarefa_cancelamento_par');
      await recusa(ins, com(9, 'motivo'), '23514', 'tarefa_motivo_so_cancelada');
      await recusa(ins, com(9, 'x'.repeat(301), [7, CANCELADA], [8, A.usuarios.gerente]), '23514', 'tarefa_motivo_tamanho');
      await recusa(ins, com(1, B.usuarios.admin), '23503', 'tarefa_autor_fk');
      // aceitas: pesquisa com questionário (sem FK), equipe com equipe, cancelada com quem e motivo
      await q(ins, com(3, 'pesquisa', [5, QUEST]));
      await q(ins, com(4, 'equipe', [6, A.equipes.equipe1]));
      await q(ins, com(7, CANCELADA, [8, A.usuarios.gerente], [9, 'Cliente fechou']));
    });
  });

  it('destinatário: um vivo por (tarefa, usuário); conclusão em par; conclusao_id único; observação <= 500', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await criarTarefa();
      await criarDestinatarios();
      const ins = 'insert into core.tarefa_destinatario (tenant_id, tarefa_id, usuario_id) values ($1, $2, $3)';
      await recusa(ins, [A.tenantId, T1, A.usuarios.vendedor1], '23505', 'tarefa_dest_usuario_uk');
      await recusa(ins, [A.tenantId, T1, B.usuarios.admin], '23503', 'tarefa_dest_usuario_fk');
      await recusa('update core.tarefa_destinatario set concluida_em = now() where id = $1', [D1], '23514', 'tarefa_dest_conclusao_par');
      await recusa("update core.tarefa_destinatario set observacao = repeat('x', 501) where id = $1", [D1], '23514', 'tarefa_dest_observacao_tamanho');
      const CMD = 'aaaaaaaa-0170-4000-8000-000000000201';
      const concluir = (id: string) =>
        q('update core.tarefa_destinatario set concluida_em = now(), recebida_em = now(), conclusao_id = $2 where id = $1 and concluida_em is null', [id, CMD]);
      expect((await concluir(D1)).rowCount).toBe(1);
      expect((await concluir(D1)).rowCount).toBe(0); // vale a primeira conclusão
      await recusa('update core.tarefa_destinatario set concluida_em = now(), recebida_em = now(), conclusao_id = $2 where id = $1', [D2, CMD], '23505', 'tarefa_dest_conclusao_uk');
      // apagada logicamente, a pessoa pode receber a tarefa de novo
      await q('update core.tarefa_destinatario set deleted_at = now() where id = $1', [D2]);
      await q(ins, [A.tenantId, T1, A.usuarios.promotor]);
    });
  });

  it('gatilho: prazo, descrição e cancelamento andam o updated_at dos destinatários; external_id não', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await criarTarefa();
      await criarDestinatarios();
      const tocadas = async () =>
        (await q('select count(*) filter (where updated_at = now())::int as n from core.tarefa_destinatario where tarefa_id = $1', [T1])).rows[0]!.n as number;
      expect(await tocadas()).toBe(0);
      await q("update core.tarefa set external_id = 'erp-1' where id = $1", [T1]);
      expect(await tocadas()).toBe(0);
      await q('update core.tarefa set prazo = prazo + 1 where id = $1', [T1]);
      expect(await tocadas()).toBe(2);
    });
  });

  it('notificacao.tarefa_id: só com subtipo tarefa; um aviso por (usuário, tarefa)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await criarTarefa();
      const ins = "insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, subtipo, tarefa_id) values ($1, $2, 'sistema', 'Nova tarefa', '', $3, $4)";
      await recusa(ins, [A.tenantId, A.usuarios.vendedor1, null, T1], '23514', 'notificacao_tarefa_subtipo');
      await q(ins, [A.tenantId, A.usuarios.vendedor1, 'tarefa', T1]);
      await recusa(ins, [A.tenantId, A.usuarios.vendedor1, 'tarefa', T1], '23505', 'notificacao_tarefa_uk');
      await recusa(ins, [A.tenantId, A.usuarios.vendedor2, 'tarefa', 'aaaaaaaa-0170-4000-8000-0000000000ff'], '23503', 'notificacao_tarefa_fk');
      await q(ins, [A.tenantId, A.usuarios.vendedor2, 'tarefa', T1]);
    });
  });

  it('macuxi_app não apaga (42501): remover = deleted_at', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await criarTarefa();
      for (const t of ['core.tarefa', 'core.tarefa_destinatario']) {
        await recusa(`delete from ${t}`, [], '42501', t.split('.')[1]!);
      }
    });
  });

  it('vazamento: B não vê, não altera e não grava tarefas de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await criarTarefa();
      await criarDestinatarios();
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await q('select id from core.tarefa where id = $1', [T1])).rowCount).toBe(0);
      expect((await q('select id from core.tarefa_destinatario where tarefa_id = $1', [T1])).rowCount).toBe(0);
      expect((await q("update core.tarefa set titulo = 'X' where id = $1", [T1])).rowCount).toBe(0);
      expect((await q('update core.tarefa_destinatario set suspeita = true where id = $1', [D1])).rowCount).toBe(0);
      await recusa(
        "insert into core.tarefa (tenant_id, autor_id, titulo, prazo, tipo, alvo) values ($1, $2, 'X', current_date, 'simples', 'todos')",
        [A.tenantId, A.usuarios.gerente],
        '42501',
        'row-level security',
      );
    });
  });

  it('sem contexto de tenant: 0 linhas (falha fechado)', async () => {
    await emTransacao(app, '', async () => {
      expect((await q('select id from core.tarefa')).rowCount).toBe(0);
      expect((await q('select id from core.tarefa_destinatario')).rowCount).toBe(0);
    });
  });

  it('pull `tarefa` (escopo proprio) usa tarefa_dest_usuario_sync_ix', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const plano = (
        await q(
          `explain select d.id from core.tarefa_destinatario d join core.tarefa t on t.tenant_id = d.tenant_id and t.id = d.tarefa_id
            where d.tenant_id = '${A.tenantId}' and d.usuario_id = '${A.usuarios.vendedor1}' and (d.updated_at, d.id) > (now() - interval '30 days', '00000000-0000-0000-0000-000000000000'::uuid)
            order by d.updated_at, d.id limit 500`,
        )
      ).rows
        .map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN'])
        .join('\n');
      expect(plano).toMatch(/tarefa_dest_usuario_sync_ix/);
    });
  });
});

describe.skipIf(semBanco())('0064 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000064';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('down volta ao catálogo da 0063 (inclusive core.notificacao); idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0063' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo64', 'Antigo')", [T]);
      expect((await migrarUp(c, { ate: '0064' })).aplicadas).toEqual(['0064_core_tarefa']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('rel core.tarefa r rls=true force=true');
      expect(depois).toContain('rel core.tarefa_destinatario r rls=true force=true');
      expect(depois).toContain('col core.notificacao.tarefa_id uuid nn=false');
      expect(depois).toContain('trg core.tarefa.tarefa_tocar_destinatarios');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0064_core_tarefa']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m64.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0064' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
