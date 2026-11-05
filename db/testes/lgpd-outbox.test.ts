/**
 * 0024 — T-0078 (robustez essencial; pedido R-20261104-232912-engenheiro-software). O que o BANCO garante:
 * - plataforma.resumo_outbox: o macuxi_app (sem contexto de tenant) recebe SÓ as contagens da outbox de todos os tenants
 *   (pendentes, parados, segundos do pendente mais antigo), filtradas pelos nomes pedidos; o worker e PUBLIC não executam.
 * - LGPD (roteiro docs/banco/lgpd.md): anonimizar_usuario, anonimizar_cliente e anonimizar_contato trocam o dado pessoal do
 *   titular, mantêm os ids (histórico fiscal ligado) e não tocam o outro tenant; excluir_tenant apaga TODAS as linhas do tenant
 *   (toda tabela com tenant_id) e a linha do tenant, só com o código certo e o tenant encerrado, sem tocar o outro tenant.
 *   Nenhuma das quatro é executável pelos papéis da aplicação.
 * Banco: fixture dois-tenants, sempre com ROLLBACK (admin); up/down num banco efêmero. Nada roda em base real.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo, tabelasComTenant } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m24 = migracoes.find((m) => m.versao === '0024')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const FUNCOES_LGPD = [
  'plataforma.anonimizar_usuario(uuid, uuid)',
  'plataforma.anonimizar_cliente(uuid, uuid)',
  'plataforma.anonimizar_contato(uuid, uuid)',
  'plataforma.excluir_tenant(uuid, text)',
];

describe('0024 resumo da outbox e LGPD (estático)', () => {
  it('nome e posição: 0024_plataforma_resumo_outbox_lgpd logo depois da 0023', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0023_core_positivacao_mes') + 1]).toBe('0024_plataforma_resumo_outbox_lgpd');
  });

  it('resumo_outbox: SECURITY DEFINER, search_path com pg_temp, EXECUTE só ao macuxi_app', () => {
    const sql = semComentarios(m24.up);
    expect(sql).toMatch(/create function plataforma\.resumo_outbox\(p_nomes text\[\], p_max_tentativas integer\)\s+returns table \(pendentes integer, parados integer, mais_antigo_s double precision\)\s+language sql stable security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(sql).toContain('revoke all on function plataforma.resumo_outbox(text[], integer) from public;');
    expect([...sql.matchAll(/grant ([^;]+);/g)].map((g) => g[1])).toEqual(['execute on function plataforma.resumo_outbox(text[], integer) to macuxi_app']);
  });

  it('funções da LGPD: invoker (uma só SECURITY DEFINER na migração), search_path fixo, revoke de public, sem grant', () => {
    const sql = semComentarios(m24.up);
    expect(sql.match(/security definer/g)).toHaveLength(1);
    for (const f of FUNCOES_LGPD) expect(sql).toContain(`revoke all on function ${f} from public;`);
    expect(sql.match(/set search_path = pg_catalog, plataforma, pg_temp/g)).toHaveLength(5);
    expect(sql).not.toMatch(/create (table|policy)|alter (table|policy)|drop (table|policy)/);
  });

  it('down apaga as cinco funções (idempotente)', () => {
    for (const f of ['plataforma.resumo_outbox(text[], integer)', ...FUNCOES_LGPD]) expect(m24.down).toContain(`drop function if exists ${f};`);
  });
});

describe.skipIf(semBanco())('0024 resumo da outbox e LGPD (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  /** Roda fn numa transação do admin com ROLLBACK; o erro vira código SQLSTATE. */
  const codigo = async (fn: () => Promise<unknown>) => (await erroDe(emTransacao(admin, null, fn)))?.code;
  const NOME = 'core.teste_resumo.criado@1';
  const inserirEvento = (tenant: string, segundos: number, tentativas: number, publicado: boolean, nome = NOME) =>
    admin.query(
      `insert into plataforma.evento (tenant_id, nome, modulo, ocorrido_em, tentativas, publicado_em)
       values ($1, $2, split_part($2, '.', 1), now() - make_interval(secs => $3), $4, case when $5 then now() end)`,
      [tenant, nome, segundos, tentativas, publicado],
    );

  it('resumo_outbox: macuxi_app sem contexto recebe só as contagens de todos os tenants, filtradas pelo nome', async () => {
    await emTransacao(admin, null, async () => {
      await inserirEvento(A.tenantId, 120, 0, false);
      await inserirEvento(A.tenantId, 30, 2, false);
      await inserirEvento(B.tenantId, 600, 5, false); // parado (tentativas >= 5): não entra no mais antigo
      await inserirEvento(B.tenantId, 900, 0, true); // publicado: fora
      await inserirEvento(B.tenantId, 999, 0, false, 'core.outro_teste.criado@1'); // outro nome: fora
      await admin.query('set local role macuxi_app');
      const r = await admin.query<{ pendentes: number; parados: number; mais_antigo_s: number | null }>(
        'select pendentes, parados, mais_antigo_s from plataforma.resumo_outbox($1::text[], $2::int)',
        [[NOME], 5],
      );
      expect(r.rows).toHaveLength(1);
      expect(Object.keys(r.rows[0]!).sort()).toEqual(['mais_antigo_s', 'parados', 'pendentes']);
      expect(r.rows[0]!.pendentes).toBe(2);
      expect(r.rows[0]!.parados).toBe(1);
      expect(r.rows[0]!.mais_antigo_s).toBeGreaterThanOrEqual(119);
      expect(r.rows[0]!.mais_antigo_s).toBeLessThan(600);
      // sem a função, o macuxi_app não vê a outbox (RLS sem contexto = 0 linhas)
      expect((await admin.query<{ n: number }>('select count(*)::int as n from plataforma.evento')).rows[0]!.n).toBe(0);
      // lista vazia ou nula: zeros e sem mais antigo
      for (const nomes of [[], null]) {
        const v = await admin.query('select pendentes, parados, mais_antigo_s from plataforma.resumo_outbox($1::text[], 5)', [nomes]);
        expect(v.rows).toEqual([{ pendentes: 0, parados: 0, mais_antigo_s: null }]);
      }
    });
  });

  it('resumo_outbox: worker e um papel qualquer (PUBLIC) não executam', async () => {
    expect(await codigo(async () => {
      await admin.query('set local role macuxi_worker');
      await admin.query("select * from plataforma.resumo_outbox(array['x.y.z@1'], 5)");
    })).toBe('42501');
  });

  it('funções da LGPD: nem macuxi_app nem macuxi_worker executam', async () => {
    const chamadas = [
      ['select * from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, A.usuarios.vendedor1]],
      ['select * from plataforma.anonimizar_cliente($1, $2)', [A.tenantId, A.clientes.c1]],
      ['select * from plataforma.anonimizar_contato($1, $2)', [A.tenantId, A.clientes.c1]],
      ['select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]],
    ] as const;
    for (const papel of ['macuxi_app', 'macuxi_worker']) {
      for (const [sql, params] of chamadas) {
        expect(await codigo(async () => {
          await admin.query(`set local role ${papel}`);
          await admin.query(sql, [...params]);
        }), `${papel}: ${sql}`).toBe('42501');
      }
    }
  });

  it('anonimizar_usuario: troca o dado pessoal, revoga sessões, bloqueia aparelho, tira coordenadas; B intacto', async () => {
    await emTransacao(admin, null, async () => {
      const u = A.usuarios.vendedor1;
      await admin.query(
        "insert into plataforma.auditoria (tenant_id, modulo, acao, entidade, entidade_id, antes, depois) values ($1, 'core', 'usuario.editar', 'usuario', $2, $3, $4)",
        [A.tenantId, u, { email: 'vendedor1@exemplo.com.br' }, { email: 'novo@exemplo.com.br' }],
      );
      const bAntes = (await admin.query('select * from core.usuario where tenant_id = $1 order by id', [B.tenantId])).rows;
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, u]);
      const q = new Map(r.rows.map((x) => [x.item, Number(x.quantidade)]));
      expect(q.get('core.usuario')).toBe(1);
      expect(q.get('core.sessao')).toBeGreaterThanOrEqual(1);
      expect(q.get('core.dispositivo')).toBeGreaterThanOrEqual(1);
      expect(q.get('core.visita')).toBeGreaterThanOrEqual(1);
      expect(q.get('plataforma.auditoria')).toBeGreaterThanOrEqual(1);
      const linha = (await admin.query('select * from core.usuario where tenant_id = $1 and id = $2', [A.tenantId, u])).rows[0];
      expect(linha).toMatchObject({ nome: 'Usuário anonimizado', nome_curto: null, email: `anonimizado-${u}@anonimizado.invalid`, senha_hash: null, external_id: null, ativo: false });
      expect(linha.deleted_at).not.toBeNull();
      expect(linha.bloqueado_em).not.toBeNull();
      const ativas = await admin.query('select count(*)::int as n from core.sessao where tenant_id = $1 and usuario_id = $2 and revogado_em is null', [A.tenantId, u]);
      expect(ativas.rows[0].n).toBe(0);
      const disp = await admin.query('select count(*)::int as n from core.dispositivo where tenant_id = $1 and usuario_id = $2 and (nome is not null or bloqueado_em is null)', [A.tenantId, u]);
      expect(disp.rows[0].n).toBe(0);
      const coord = await admin.query('select count(*)::int as n from core.visita where tenant_id = $1 and usuario_id = $2 and (checkin_lat is not null or checkout_lat is not null)', [A.tenantId, u]);
      expect(coord.rows[0].n).toBe(0);
      const aud = await admin.query("select count(*)::int as n from plataforma.auditoria where tenant_id = $1 and entidade_id = $2 and (antes::text like '%exemplo.com.br%' or depois::text like '%exemplo.com.br%')", [A.tenantId, u]);
      expect(aud.rows[0].n).toBe(0);
      const registro = await admin.query("select count(*)::int as n from plataforma.auditoria where tenant_id = $1 and acao = 'lgpd.anonimizar' and entidade = 'usuario' and entidade_id = $2 and antes is null and depois is null", [A.tenantId, u]);
      expect(registro.rows[0].n).toBe(1);
      // o outro tenant e os outros usuários de A não mudam
      expect((await admin.query('select * from core.usuario where tenant_id = $1 order by id', [B.tenantId])).rows).toEqual(bAntes);
      const outro = (await admin.query('select nome from core.usuario where tenant_id = $1 and id = $2', [A.tenantId, A.usuarios.vendedor2])).rows[0];
      expect(outro.nome).not.toBe('Usuário anonimizado');
    });
  });

  it('anonimizar_usuario: titular de outro tenant ou inexistente = P0002, nada muda', async () => {
    expect(await codigo(() => admin.query('select * from plataforma.anonimizar_usuario($1, $2)', [A.tenantId, B.usuarios.vendedor]))).toBe('P0002');
    expect(await codigo(() => admin.query('select * from plataforma.anonimizar_usuario($1, null)', [A.tenantId]))).toBe('22004');
  });

  it('anonimizar_cliente: cliente, contatos, endereços, coordenadas da visita e payload do ERP; contatos de outro cliente e B intactos', async () => {
    await emTransacao(admin, null, async () => {
      const c = A.clientes.c1;
      const outrosContatos = (await admin.query('select * from core.cliente_contato where tenant_id = $1 and cliente_id <> $2 order by id', [A.tenantId, c])).rows;
      const bContatos = (await admin.query('select * from core.cliente_contato where tenant_id = $1 order by id', [B.tenantId])).rows;
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_cliente($1, $2)', [A.tenantId, c]);
      const q = new Map(r.rows.map((x) => [x.item, Number(x.quantidade)]));
      expect(q.get('core.cliente')).toBe(1);
      expect(q.get('core.cliente_contato')).toBe(2);
      const cli = (await admin.query('select * from core.cliente where tenant_id = $1 and id = $2', [A.tenantId, c])).rows[0];
      expect(cli).toMatchObject({ razao_social: 'Cliente anonimizado', nome_fantasia: null, documento: null, telefone: null, email: null, latitude: null, longitude: null, external_id: null, ativo: false });
      expect(cli.deleted_at).not.toBeNull();
      const contatos = (await admin.query('select nome, cargo, telefone, whatsapp, email from core.cliente_contato where tenant_id = $1 and cliente_id = $2', [A.tenantId, c])).rows;
      expect(contatos).toEqual([
        { nome: 'Contato anonimizado', cargo: null, telefone: null, whatsapp: null, email: null },
        { nome: 'Contato anonimizado', cargo: null, telefone: null, whatsapp: null, email: null },
      ]);
      const end = await admin.query("select count(*)::int as n from core.cliente_endereco where tenant_id = $1 and cliente_id = $2 and (logradouro <> 'Anonimizado' or cep is not null or latitude is not null or deleted_at is null)", [A.tenantId, c]);
      expect(end.rows[0].n).toBe(0);
      const coord = await admin.query('select count(*)::int as n from core.visita where tenant_id = $1 and cliente_id = $2 and (checkin_lat is not null or checkout_lat is not null)', [A.tenantId, c]);
      expect(coord.rows[0].n).toBe(0);
      expect((await admin.query('select * from core.cliente_contato where tenant_id = $1 and cliente_id <> $2 order by id', [A.tenantId, c])).rows).toEqual(outrosContatos);
      expect((await admin.query('select * from core.cliente_contato where tenant_id = $1 order by id', [B.tenantId])).rows).toEqual(bContatos);
    });
  });

  it('anonimizar_cliente: payload do ERP (registro_atual da entidade cliente) é anulado pelo external_id', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query("update core.cliente set external_id = 'CLI-1' where tenant_id = $1 and id = $2", [B.tenantId, B.clientes.c1]);
      await admin.query(`update integracao.registro_atual set payload = '{"razao_social":"Pessoa"}' where tenant_id = $1 and entidade = 'cliente' and external_id = 'CLI-1'`, [B.tenantId]);
      const r = await admin.query<{ item: string; quantidade: string }>('select item, quantidade from plataforma.anonimizar_cliente($1, $2)', [B.tenantId, B.clientes.c1]);
      expect(Number(r.rows.find((x) => x.item === 'integracao.registro_atual')!.quantidade)).toBe(1);
      const p = await admin.query("select count(*)::int as n from integracao.registro_atual where tenant_id = $1 and entidade = 'cliente' and external_id = 'CLI-1' and payload is not null", [B.tenantId]);
      expect(p.rows[0].n).toBe(0);
    });
  });

  it('anonimizar_contato: só aquele contato; de outro tenant = P0002', async () => {
    await emTransacao(admin, null, async () => {
      const contatos = (await admin.query<{ id: string; nome: string }>('select id, nome from core.cliente_contato where tenant_id = $1 order by id', [A.tenantId])).rows;
      const alvo = contatos[0]!;
      await admin.query('select * from plataforma.anonimizar_contato($1, $2)', [A.tenantId, alvo.id]);
      const depois = (await admin.query<{ id: string; nome: string }>('select id, nome from core.cliente_contato where tenant_id = $1 order by id', [A.tenantId])).rows;
      expect(depois).toEqual(contatos.map((k) => (k.id === alvo.id ? { id: k.id, nome: 'Contato anonimizado' } : k)));
    });
    const deB = (await admin.query<{ id: string }>('select id from core.cliente_contato where tenant_id = $1 limit 1', [B.tenantId])).rows[0]!.id;
    expect(await codigo(() => admin.query('select * from plataforma.anonimizar_contato($1, $2)', [A.tenantId, deB]))).toBe('P0002');
  });

  it('excluir_tenant: recusa código errado (22023), tenant ativo (55000) e inexistente (P0002)', async () => {
    expect(await codigo(() => admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [A.tenantId]).then(() => admin.query('select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, B.codigo])))).toBe('22023');
    expect(await codigo(() => admin.query('select * from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]))).toBe('55000');
    expect(await codigo(() => admin.query("select * from plataforma.excluir_tenant('00000000-0000-4000-8000-000000000000', 'x')"))).toBe('P0002');
  });

  it('excluir_tenant: apaga toda linha do tenant encerrado em toda tabela com tenant_id e o tenant; B idêntico', async () => {
    const contar = async (tenant: string) => {
      const mapa = new Map<string, number>();
      for (const t of await tabelasComTenant(admin)) {
        const r = await admin.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [tenant]);
        mapa.set(t.nome, r.rows[0]!.n);
      }
      return mapa;
    };
    await emTransacao(admin, null, async () => {
      const bAntes = await contar(B.tenantId);
      const aAntes = await contar(A.tenantId);
      await admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [A.tenantId]);
      const r = await admin.query<{ tabela: string; quantidade: string }>('select tabela, quantidade from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]);
      const apagadas = new Map(r.rows.map((x) => [x.tabela, Number(x.quantidade)]));
      expect(apagadas.get('plataforma.tenant')).toBe(1);
      for (const [nome, n] of aAntes) if (n > 0) expect(apagadas.get(nome), nome).toBe(n);
      for (const [nome, n] of await contar(A.tenantId)) expect(n, nome).toBe(0);
      expect((await admin.query('select count(*)::int as n from plataforma.tenant where id = $1', [A.tenantId])).rows[0].n).toBe(0);
      expect(await contar(B.tenantId)).toEqual(bAntes);
      expect((await admin.query("select current_setting('session_replication_role') as v")).rows[0].v).toBe('origin');
    });
    // ROLLBACK: a fixture volta
    expect((await admin.query('select count(*)::int as n from plataforma.tenant where id = $1', [A.tenantId])).rows[0].n).toBe(1);
  });
});

describe.skipIf(semBanco())('0024 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0024_plataforma_resumo_outbox_lgpd') - 1]!.slice(0, 4);
  const desde0024 = nomes.filter((n) => n >= '0024');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria as funções; down volta exatamente ao catálogo da 0023; up de novo volta ao mesmo catálogo', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0024);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(
        expect.arrayContaining([
          'fn plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)',
          'fn plataforma.anonimizar_usuario(p_tenant uuid, p_usuario uuid)',
          'fn plataforma.anonimizar_cliente(p_tenant uuid, p_cliente uuid)',
          'fn plataforma.anonimizar_contato(p_tenant uuid, p_contato uuid)',
          'fn plataforma.excluir_tenant(p_tenant uuid, p_codigo text)',
        ]),
      );
      expect((await migrarDown(c, { passos: desde0024.length })).aplicadas).toEqual([...desde0024].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m24.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
