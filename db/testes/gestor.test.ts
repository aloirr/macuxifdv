/**
 * Schema gestor (0014, T-0055; pedido R-20261102-131601-modulo-gestor). Estático (sempre) + banco (com Postgres):
 *  - listas fechadas do SQL = contratos do Gestor; nenhuma função SECURITY DEFINER nova nem grant ao worker;
 *  - RLS entre os dois tenants da fixture (leitura, escrita cruzada) nas 4 tabelas;
 *  - unicidade/idempotência que o domain exige: evento_id por tenant, fato por (tabela, chave), UM alerta vivo por chave,
 *    um ajuste por tipo; coerência do encerramento;
 *  - retenção da idempotência pela API sob RLS (só o próprio tenant); seed da demo (licença + projeção pelo domain) idempotente.
 * Linha do tempo única (ADR 0015): o relógio do teste (@macuxi/comum/relogio) para o "hoje" da demo e o relógio do
 * BANCO (relogioDoBanco) para comparar com created_at gravado por now(). Nenhuma hora fixa contra o relógio real.
 */
import { criarRelogio, relogioDoBanco } from '@macuxi/comum/relogio';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALVOS_ALERTA, MOTIVOS_ENCERRAMENTO, STATUS_ALERTA } from '../../modules/gestor/contracts/alerta';
import { SEVERIDADES, TIPOS_ALERTA } from '../../modules/gestor/contracts/base';
import { achatarEstado, montarEstado } from '../../modules/gestor/db/projecao';
import { TABELAS_PROJECAO } from '../../modules/gestor/db/nuvem';
import { estadoInicial } from '../../modules/gestor/domain/projecao';
import { carregarDemo, dadosDemo, TENANT_DEMO, USUARIOS_DEMO } from '../seeds/demo/demo';
import { carregarDemoGestor, dadosGestorDemo, PERFIS_GESTOR_DEMO, projecaoDemo, TENANT_DEMO_GESTOR } from '../seeds/demo/gestor';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { idGestorA, idGestorB } from '../seeds/fixtures/gestor';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comCliente, emTransacao, erroDe } from './util';

const m14 = lerMigracoes().find((m) => m.versao === '0014')!;
/** Tipos que a 0084 acrescenta ao CHECK alerta_tipo_valido (nunca ao alerta_regra_tipo_valido). */
const TIPOS_ALERTA_PRODUTIVIDADE_0084 = ['parado_entre_visitas', 'sem_checkin_inicio'] as const;
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const HASH_FALSO = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';

/** Valores do `check (coluna in (...))` da constraint `nome` na 0014. */
function listaDoCheck(nome: string): string[] {
  const m = new RegExp(`constraint ${nome} check \\([a-z_]+ (?:is null or [a-z_]+ )?in \\(([^)]*)\\)`).exec(m14.up);
  expect(m, `constraint ${nome}`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe('0014 gestor (estático)', () => {
  it('listas fechadas do SQL = contratos do Gestor (tipo, alvo, severidade, status, motivo) e tabelas do EstadoProjecao', () => {
    // os tipos de produtividade (0084, T-0180) entram só no CHECK do alerta, numa migração própria (almoco-alerta-produtividade.db.test.ts)
    const daRegra = TIPOS_ALERTA.filter((t) => !(TIPOS_ALERTA_PRODUTIVIDADE_0084 as readonly string[]).includes(t));
    expect(listaDoCheck('alerta_tipo_valido')).toEqual(daRegra);
    expect(listaDoCheck('alerta_regra_tipo_valido')).toEqual(daRegra);
    expect(listaDoCheck('alerta_alvo_valido')).toEqual([...ALVOS_ALERTA]);
    expect(listaDoCheck('alerta_severidade_valida')).toEqual([...SEVERIDADES]);
    expect(listaDoCheck('alerta_status_valido')).toEqual([...STATUS_ALERTA]);
    expect(listaDoCheck('alerta_motivo_valido')).toEqual([...MOTIVOS_ENCERRAMENTO]);
    expect(listaDoCheck('projecao_fato_tabela_valida')).toEqual([...TABELAS_PROJECAO]);
    // toda tabela do EstadoProjecao (menos `processados`, que é o evento_aplicado) cabe na projecao_fato
    expect(Object.keys(estadoInicial()).filter((k) => k !== 'processados').sort()).toEqual([...TABELAS_PROJECAO].sort());
  });

  it('unicidade e idempotência exigidas pelo domain', () => {
    expect(m14.up).toContain('constraint evento_aplicado_evento_uk unique (tenant_id, evento_id)');
    expect(m14.up).toContain('constraint projecao_fato_chave_uk unique (tenant_id, tabela, chave)');
    expect(m14.up).toContain("create unique index alerta_vivo_uk on gestor.alerta (tenant_id, chave) where status <> 'encerrado' and deleted_at is null;");
    expect(m14.up).toContain('constraint alerta_regra_tipo_uk unique (tenant_id, tipo)');
  });

  it('sem função SECURITY DEFINER nova nem grant ao macuxi_worker (retenção pela API sob RLS); down remove o schema', () => {
    const semComentarios = m14.up.replace(/--.*$/gm, '');
    expect(semComentarios).not.toMatch(/security definer/i);
    expect(semComentarios).not.toMatch(/macuxi_worker/);
    expect(m14.up).toContain('create index evento_aplicado_retencao_ix on gestor.evento_aplicado (tenant_id, created_at);');
    expect(m14.down).toContain('drop schema if exists gestor cascade;');
  });

  it('achatar/montar o EstadoProjecao é ida e volta (formato de docs/banco/gestor.md)', () => {
    const d = dadosDemo(HASH_FALSO, { hoje: criarRelogio().hoje() });
    const { estado, fatos } = projecaoDemo(dadosGestorDemo(d).eventos);
    expect(montarEstado(JSON.parse(JSON.stringify(fatos)), Object.keys(estado.processados))).toEqual(estado);
    expect(achatarEstado(estadoInicial())).toEqual([]);
    // carimbo = maior `v` do fato; pedido com criado + histórico tem o carimbo do criado
    const p = fatos.find((f) => f.tabela === 'pedidos')!;
    expect(p.carimbo).toMatch(/^\d{15}\|/);
    expect(p.ocorrido_em).not.toBeNull();
    expect(p.usuario_id).not.toBeNull();
  });
});

describe('seed da demo do Gestor (estático)', () => {
  const relogio = criarRelogio({ fuso: 'America/Manaus' });
  const d = dadosDemo(HASH_FALSO, { hoje: relogio.hoje() });
  const g = dadosGestorDemo(d);

  it('tenant demo; licença do Gestor no tenant e para supervisor, gerente, analista e admin (nunca vendedor/promotor)', () => {
    expect(TENANT_DEMO_GESTOR).toBe(TENANT_DEMO);
    expect(g['plataforma.tenant_modulo']).toEqual([expect.objectContaining({ tenant_id: TENANT_DEMO, modulo: 'gestor', ativo: true })]);
    expect(g['plataforma.perfil_modulo'].map((x) => x.perfil).sort()).toEqual([...PERFIS_GESTOR_DEMO].sort());
    expect(g['plataforma.perfil_modulo'].every((x) => x.modulo === 'gestor' && x.tenant_id === TENANT_DEMO)).toBe(true);
    // ids sem colisão com as linhas da demo.ts
    const ids = new Set([...d['plataforma.tenant_modulo'], ...d['plataforma.perfil_modulo']].map((x) => x.id));
    expect([...g['plataforma.tenant_modulo'], ...g['plataforma.perfil_modulo']].some((x) => ids.has(x.id))).toBe(false);
  });

  it('todo evento da demo passa no domain do Gestor; projeção coerente com a base (30 clientes, pedidos, aprovações, rotas de hoje)', () => {
    const { estado } = projecaoDemo(g.eventos);
    expect(Object.keys(estado.clientes)).toHaveLength(30);
    expect(Object.keys(estado.pedidos)).toHaveLength(d['vendedor.pedido'].length);
    expect(Object.keys(estado.visitas)).toHaveLength(d['core.visita'].length);
    expect(Object.keys(estado.aprovacoes).sort()).toEqual(d['vendedor.pedido'].filter((p) => p.nivel_aprovacao).map((p) => String(p.id)).sort());
    expect(Object.keys(estado.planejadas).every((k) => k.endsWith(`|${relogio.hoje()}`))).toBe(true);
    // Lucas e Camila são da Renata: a carteira projetada é dos dois vendedores
    const vendedores = new Set(Object.values(estado.clientes).map((c) => c.vendedor_id));
    expect(vendedores).toEqual(new Set([d['core.usuario'].find((u) => u.email === USUARIOS_DEMO.vendedor.email)!.id, d['core.usuario'].find((u) => u.email === USUARIOS_DEMO.vendedor2.email)!.id]));
    // eventos com ids únicos (idempotência por evento_id)
    expect(new Set(g.eventos.map((e) => e.evento_id)).size).toBe(g.eventos.length);
  });
});

describe.skipIf(semBanco())('0014 gestor no banco (papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  /** Tentativa que deve falhar DENTRO da transação: savepoint para o erro não abortar o resto do teste. */
  const tentar = async (fn: () => Promise<unknown>) => {
    await app.query('savepoint tentativa');
    const e = await erroDe(fn());
    await app.query(e ? 'rollback to savepoint tentativa' : 'release savepoint tentativa');
    return e;
  };

  const TABELAS = ['gestor.evento_aplicado', 'gestor.projecao_fato', 'gestor.alerta', 'gestor.alerta_regra'];

  it('RLS: cada tenant só vê as próprias linhas nas 4 tabelas e não enxerga a linha do outro por id', async () => {
    for (const [eu, outro, idOutro] of [
      [A.tenantId, B.tenantId, idGestorB('alerta', 1)],
      [B.tenantId, A.tenantId, idGestorA('alerta', 1)],
    ] as const) {
      for (const t of TABELAS) {
        const r = await emTransacao(app, eu, () => app.query<{ meus: number; alheios: number }>(
          `select count(*) filter (where tenant_id = $1)::int as meus, count(*) filter (where tenant_id = $2)::int as alheios from ${t}`, [eu, outro]));
        expect(r.rows[0]!.meus, `${t} em ${eu}`).toBeGreaterThan(0);
        expect(r.rows[0]!.alheios, `${t}: vazou`).toBe(0);
      }
      const porId = await emTransacao(app, eu, () => app.query('select 1 from gestor.alerta where id = $1', [idOutro]));
      expect(porId.rowCount).toBe(0);
    }
    // sem contexto: nada
    const sem = await emTransacao(app, null, () => app.query('select count(*)::int as n from gestor.projecao_fato'));
    expect(sem.rows[0].n).toBe(0);
  });

  it('RLS: escrita cruzada recusada (INSERT com tenant de B no contexto de A; UPDATE/DELETE em B afetam 0)', async () => {
    const ins = await emTransacao(app, A.tenantId, () =>
      erroDe(app.query("insert into gestor.alerta_regra (tenant_id, tipo, ajuste) values ($1, 'visita_curta', '{}')", [B.tenantId])));
    expect(ins?.code).toBe('42501');
    const upd = await emTransacao(app, A.tenantId, () => app.query("update gestor.projecao_fato set carimbo = 'x' where tenant_id = $1", [B.tenantId]));
    expect(upd.rowCount).toBe(0);
    const del = await emTransacao(app, A.tenantId, () => app.query('delete from gestor.evento_aplicado where tenant_id = $1', [B.tenantId]));
    expect(del.rowCount).toBe(0);
  });

  it('idempotência do consumidor: o mesmo evento_id entra uma vez por tenant (on conflict do nothing = duplicado)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = (t: string) => app.query(
        "insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em) values ($1, 'evt-rep-1', 'vendedor.pedido.criado@1', now()) on conflict (tenant_id, evento_id) do nothing", [t]);
      expect((await ins(A.tenantId)).rowCount).toBe(1);
      expect((await ins(A.tenantId)).rowCount).toBe(0);
      expect(await tentar(() => app.query("insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em) values ($1, 'evt-rep-1', 'vendedor.pedido.criado@1', now())", [A.tenantId]))).toMatchObject({ code: '23505' });
    });
    // o mesmo evento_id em B é outro registro (unicidade por tenant)
    await emTransacao(app, B.tenantId, async () => {
      const r = await app.query("insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em) values ($1, 'evt-rep-1', 'vendedor.pedido.criado@1', now()) on conflict (tenant_id, evento_id) do nothing", [B.tenantId]);
      expect(r.rowCount).toBe(1);
      expect(await tentar(() => app.query("insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em) values ($1, 'evt-2', 'nome sem formato', now())", [B.tenantId]))).toMatchObject({ code: '23514' });
    });
  });

  it('projeção: um fato por (tabela, chave); upsert troca os dados; tabela fora do EstadoProjecao é recusada', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const up = (carimbo: string, dados: unknown) => app.query(
        `insert into gestor.projecao_fato (tenant_id, tabela, chave, carimbo, dados) values ($1, 'metas', 'u|2026-11', $2, $3::jsonb)
         on conflict (tenant_id, tabela, chave) do update set carimbo = excluded.carimbo, dados = excluded.dados returning (xmax = 0) as novo`, [A.tenantId, carimbo, JSON.stringify(dados)]);
      expect((await up('000000000000001|e1', { meta_cents: 1 })).rows[0].novo).toBe(true);
      expect((await up('000000000000002|e2', { meta_cents: 2 })).rows[0].novo).toBe(false);
      const r = await app.query("select count(*)::int as n, max(dados->>'meta_cents') as m from gestor.projecao_fato where tabela = 'metas' and chave = 'u|2026-11'");
      expect(r.rows[0]).toEqual({ n: 1, m: '2' });
      expect(await tentar(() => app.query("insert into gestor.projecao_fato (tenant_id, tabela, chave, dados) values ($1, 'metas', 'u|2026-11', '{}')", [A.tenantId]))).toMatchObject({ code: '23505' });
    });
    const t = await emTransacao(app, A.tenantId, () => erroDe(app.query("insert into gestor.projecao_fato (tenant_id, tabela, chave, dados) values ($1, 'processados', 'x', 'true')", [A.tenantId])));
    expect(t?.code).toBe('23514');
  });

  it('alerta: UM vivo (aberto/dispensado) por chave; encerrado libera a chave para um alerta novo; encerramento coerente', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const alvo = A.clientes.c2;
      const abrir = (id: string, status = 'aberto') => app.query(
        `insert into gestor.alerta (id, tenant_id, chave, tipo, alvo_tipo, alvo_id, severidade, mensagem, status, aberto_em)
         values ($1, $2, $3, 'cliente_sem_visita', 'cliente', $4, 'atencao', 'Cliente sem visita.', $5, now())`, [id, A.tenantId, `cliente_sem_visita:${alvo}`, alvo, status]);
      const [x1, x2, x3] = ['aaaaaaaa-0072-4000-8000-000000000901', 'aaaaaaaa-0072-4000-8000-000000000902', 'aaaaaaaa-0072-4000-8000-000000000903'];
      await abrir(x1);
      expect(await tentar(() => abrir(x2))).toMatchObject({ code: '23505' });
      // dispensado continua vivo (não reabre enquanto a condição persiste)
      await app.query("update gestor.alerta set status = 'dispensado' where id = $1", [x1]);
      expect(await tentar(() => abrir(x2))).toMatchObject({ code: '23505' });
      // encerrar sem instante é recusado; com instante e motivo, libera a chave
      expect(await tentar(() => app.query("update gestor.alerta set status = 'encerrado' where id = $1", [x1]))).toMatchObject({ code: '23514' });
      await app.query("update gestor.alerta set status = 'encerrado', encerrado_em = now(), motivo_encerramento = 'condicao_normalizada' where id = $1", [x1]);
      await abrir(x2);
      expect(await tentar(() => abrir(x3, 'encerrado'))).toMatchObject({ code: '23514' });
      expect(await tentar(() => app.query("update gestor.alerta set motivo_encerramento = 'duplicado' where id = $1", [x2]))).toMatchObject({ code: '23514' });
      expect(await tentar(() => app.query("update gestor.alerta set tipo = 'outro' where id = $1", [x2]))).toMatchObject({ code: '23514' });
      // valor/limiar chegam ao Node como number (double precision)
      await app.query('update gestor.alerta set valor = 12.5, limiar = 10 where id = $1', [x2]);
      const v = await app.query<{ valor: unknown; limiar: unknown }>('select valor, limiar from gestor.alerta where id = $1', [x2]);
      expect(v.rows[0]).toEqual({ valor: 12.5, limiar: 10 });
    });
  });

  it('regra: um ajuste por (tenant, tipo), ajuste é objeto JSON', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await app.query(
        `insert into gestor.alerta_regra (tenant_id, tipo, ajuste) values ($1, 'cliente_sem_visita', '{"ativa": false}')
         on conflict (tenant_id, tipo) do update set ajuste = excluded.ajuste returning ajuste`, [A.tenantId]);
      expect(r.rows[0].ajuste).toEqual({ ativa: false });
      expect(await tentar(() => app.query("insert into gestor.alerta_regra (tenant_id, tipo, ajuste) values ($1, 'cliente_sem_visita', '{}')", [A.tenantId]))).toMatchObject({ code: '23505' });
      expect(await tentar(() => app.query("insert into gestor.alerta_regra (tenant_id, tipo, ajuste) values ($1, 'visita_curta', '[]')", [A.tenantId]))).toMatchObject({ code: '23514' });
    });
  });

  it('retenção: a API apaga, sob RLS, só o evento_aplicado do PRÓPRIO tenant mais velho que 120 dias (relógio do banco)', async () => {
    await comCliente(banco().urlAdmin, async (admin) => {
      const relogio = await relogioDoBanco(admin);
      const velho = relogio.relativo({ dias: -200 }).toISOString();
      await admin.query(
        `insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em, created_at, updated_at) values
           ($1, 'evt-velho-a', 'core.visita.checkin@1', $3, $3, $3), ($2, 'evt-velho-b', 'core.visita.checkin@1', $3, $3, $3)`,
        [A.tenantId, B.tenantId, velho]);
      try {
        // como a API fará na transação do tenant A (macuxi_app, RLS): limite = agora do banco − 120 dias
        await app.query('begin');
        await app.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
        const r = await app.query("delete from gestor.evento_aplicado where created_at < $1::timestamptz - interval '120 days' returning evento_id", [relogio.iso()]);
        await app.query('commit');
        expect(r.rows.map((x) => x.evento_id)).toEqual(['evt-velho-a']);
        // o velho de B não foi tocado (RLS) e as linhas recentes da fixture ficam
        const resta = await admin.query("select evento_id from gestor.evento_aplicado where evento_id in ('evt-velho-a', 'evt-velho-b')");
        expect(resta.rows.map((x) => x.evento_id)).toEqual(['evt-velho-b']);
        const fixture = await admin.query('select 1 from gestor.evento_aplicado where id = any($1::uuid[])', [[idGestorA('evento_aplicado', 1), idGestorB('evento_aplicado', 1)]]);
        expect(fixture.rowCount).toBe(2);
      } finally {
        await app.query('rollback').catch(() => undefined);
        await admin.query("delete from gestor.evento_aplicado where evento_id in ('evt-velho-a', 'evt-velho-b')");
      }
    });
  });
});

describe.skipIf(semBanco())('seed da demo do Gestor (banco)', () => {
  let b: BancoDeTeste;
  const relogio = criarRelogio({ fuso: 'America/Manaus' });
  beforeAll(async () => {
    b = await criarBancoDeTeste();
  });
  afterAll(async () => {
    await b?.apagar();
  });

  /** O que demo.ts fará quando ligar a linha: carregarDemo + carregarDemoGestor na mesma carga. */
  const carregar = (admin: pg.Client) =>
    carregarDemo(admin, { senha: 'Demo@teste1', hoje: relogio.hoje() }).then(async (r) => {
      await admin.query('begin');
      try {
        const g = await carregarDemoGestor(admin, r.dados);
        await admin.query('commit');
        return g;
      } catch (e) {
        await admin.query('rollback');
        throw e;
      }
    });

  it('licença do Gestor ativa no tenant demo, projeção gravada e idempotente (2 cargas = mesmas contagens)', async () => {
    await comAdmin(b.nome, async (admin) => {
      const r1 = await carregar(admin);
      const contar = async () => (await admin.query<{ e: number; f: number; tm: number; pm: number }>(`
        select (select count(*) from gestor.evento_aplicado where tenant_id = $1)::int as e,
               (select count(*) from gestor.projecao_fato where tenant_id = $1)::int as f,
               (select count(*) from plataforma.tenant_modulo where tenant_id = $1 and modulo = 'gestor' and ativo and deleted_at is null)::int as tm,
               (select count(*) from plataforma.perfil_modulo where tenant_id = $1 and modulo = 'gestor' and deleted_at is null)::int as pm`, [TENANT_DEMO])).rows[0];
      const c1 = await contar();
      expect(c1).toEqual({ e: r1.eventos, f: r1.fatos, tm: 1, pm: PERFIS_GESTOR_DEMO.length });
      await carregar(admin);
      expect(await contar()).toEqual(c1);
    });
    // como a API veria: macuxi_app no contexto do tenant demo lê a projeção e remonta o estado
    await comCliente(b.urlApp, async (app) => {
      const fatos = await emTransacao(app, TENANT_DEMO, () => app.query('select tabela, chave, dados from gestor.projecao_fato'));
      const ids = await emTransacao(app, TENANT_DEMO, () => app.query('select evento_id from gestor.evento_aplicado'));
      const estado = montarEstado(fatos.rows, ids.rows.map((x) => String(x.evento_id)));
      expect(Object.keys(estado.clientes)).toHaveLength(30);
      expect(Object.keys(estado.aprovacoes).length).toBeGreaterThan(0);
      // fora do contexto do tenant demo, nada
      const outro = await emTransacao(app, DOIS_TENANTS.A.tenantId, () => app.query('select count(*)::int as n from gestor.projecao_fato where tenant_id = $1', [TENANT_DEMO]));
      expect(outro.rows[0].n).toBe(0);
    });
  });
});
