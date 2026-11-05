/**
 * 0018 — medidas do produto (T-0063; RN-CORE-19, RF-CORE-14, RN-VEN-15). O que o BANCO garante: cadastro por tenant com
 * RLS forçado, lista inicial em todo tenant (existente e novo), sigla única por tenant (a mesma sigla em tenants
 * diferentes), produto e unidade de venda só com medida cadastrada DO PRÓPRIO tenant (FK composta), embalagem tudo-ou-nada,
 * medida em uso não se apaga (inativar pode), teto da embalagem (2 a 9999) e o item do pedido com medida/quantidades
 * DERIVADAS de unidade/fator/quantidade pelo gatilho (sempre sobrescreve; CHECKs travam a coerência). Revisão da T-0063
 * (R-20261102-232543-engenheiro-software 🟡1/🟡2/🟡5).
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dadosDemo } from '../seeds/demo/demo';
import { dadosDemoMedidas, MEDIDAS_ATIVAS_DEMO } from '../seeds/demo/medidas';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idMedida, MEDIDAS_INICIAIS } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, comMotivo, motivoSemSuperusuario, semBanco } from './estado';
import { comCliente, emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const SIGLAS_INICIAIS = MEDIDAS_INICIAIS.map(([s]) => s);
const migracoes = lerMigracoes();
const m18 = migracoes.find((m) => m.versao === '0018')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0018 medidas (estático)', () => {
  it('lista inicial do SQL = MEDIDAS_INICIAIS (db/src/ids.ts) = doc 02 RF-CORE-14', () => {
    const bloco = /from \(values\s+([\s\S]*?)\) as m \(sigla, descricao\)/.exec(m18.up)?.[1] ?? '';
    const doSql = [...bloco.matchAll(/\('([A-Z]+)', '([^']+)'\)/g)].map((x) => [x[1], x[2]]);
    expect(doSql).toEqual(MEDIDAS_INICIAIS.map(([s, d]) => [s, d]));
    expect(SIGLAS_INICIAIS).toEqual(['UN', 'CX', 'PCT', 'FD', 'LT', 'BD', 'TB', 'GL', 'KG', 'DZ', 'DP']);
  });

  it('único TOTAL (tenant_id, sigla) como alvo das FKs compostas de produto e produto_unidade', () => {
    expect(m18.up).toContain('constraint medida_sigla_uk unique (tenant_id, sigla),');
    expect(m18.up).toContain("constraint medida_sigla_formato check (sigla ~ '^[A-Z]{1,4}$'),");
    expect(m18.up).toContain('add constraint produto_medida_fk foreign key (tenant_id, unidade) references core.medida (tenant_id, sigla);');
    expect(m18.up).toContain('add constraint produto_embalagem_medida_fk foreign key (tenant_id, embalagem_medida) references core.medida (tenant_id, sigla);');
    expect(m18.up).toContain('add constraint produto_unidade_medida_fk foreign key (tenant_id, unidade) references core.medida (tenant_id, sigla);');
    // sem DELETE para a aplicação (medida não se apaga)
    expect(m18.up).toContain('grant select, insert, update on core.medida to macuxi_app;');
  });

  it('fronteira: vendedor.pedido_item sem FK para core.* (retrato da sigla, CHECK de formato)', () => {
    const vendedor = semComentarios(m18.up).split('\n').filter((l) => l.includes('vendedor.'));
    expect(vendedor.join('\n')).not.toMatch(/references/);
    expect(m18.up).toContain("check (medida is null or medida ~ '^[A-Z]{1,4}$')");
    expect(m18.up).toContain('check (medida is not distinct from vendedor.medida_do_item(unidade))');
  });

  it('item: derivadas por gatilho que SEMPRE sobrescreve (não GENERATED: o INSERT ... SELECT dos testes de vazamento copia a linha)', () => {
    const sql = semComentarios(m18.up);
    expect(sql).not.toMatch(/generated always/i);
    const corpo = /function vendedor\.pedido_item_medida\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? '';
    expect(corpo).toContain('new.medida := vendedor.medida_do_item(new.unidade);');
    expect(corpo).toContain('new.quantidade_embalagem := new.fator;');
    expect(corpo).toContain('new.quantidade_unidades := new.quantidade * new.fator;');
    expect(corpo).not.toMatch(/new\.(unidade|fator)\s*:=/); // a unidade histórica nunca é reescrita
    expect(m18.up).toContain('check (quantidade_embalagem = fator)');
    expect(m18.up).toContain('check (quantidade_unidades = quantidade * fator)');
    // backfill sem mexer em updated_at
    expect(sql).toContain('alter table vendedor.pedido_item disable trigger pedido_item_updated_at;');
    expect(sql.indexOf('enable trigger pedido_item_updated_at')).toBeGreaterThan(sql.indexOf('disable trigger pedido_item_updated_at'));
  });

  it('teto da embalagem do produto: 2 a 9999 (mesmo teto do domain do Core e do contrato da Integração)', () => {
    expect(m18.up).toContain('check (embalagem_quantidade is null or embalagem_quantidade between 2 and 9999)');
    expect(m18.down).toContain('drop constraint if exists produto_embalagem_quantidade_faixa;');
  });

  it('semeadura como a 0006: sem SECURITY DEFINER; gatilho em plataforma.tenant e tenants existentes', () => {
    expect(semComentarios(m18.up)).not.toMatch(/security definer/i);
    expect(m18.up).toContain('create trigger tenant_semear_medidas after insert on plataforma.tenant');
    expect(m18.up).toContain('select core.semear_medidas(t.id) from plataforma.tenant t;');
  });

  it('down desfaz tudo o que o up cria', () => {
    for (const trecho of [
      'drop trigger if exists pedido_item_medida on vendedor.pedido_item;',
      'drop function if exists vendedor.pedido_item_medida();',
      'drop function if exists vendedor.medida_do_item(text);',
      'alter table vendedor.pedido_item drop constraint if exists pedido_item_medida_derivada;',
      'alter table vendedor.pedido_item drop column if exists quantidade_unidades;',
      'alter table vendedor.pedido_item drop column if exists quantidade_embalagem;',
      'alter table vendedor.pedido_item drop column if exists medida;',
      'alter table core.produto_unidade drop constraint if exists produto_unidade_medida_fk;',
      'alter table core.produto drop constraint if exists produto_medida_fk;',
      'alter table core.produto drop column if exists embalagem_quantidade;',
      'alter table core.produto drop column if exists embalagem_medida;',
      'drop trigger if exists tenant_semear_medidas on plataforma.tenant;',
      'drop function if exists core.semear_medidas(uuid);',
      'drop table if exists core.medida;',
      'drop function if exists core.medida_em_uso();',
    ]) expect(m18.down).toContain(trecho);
    expect(m18.down.indexOf('drop constraint if exists produto_medida_fk')).toBeLessThan(m18.down.indexOf('drop table if exists core.medida;'));
  });

  it('demo: ativas UN, CX, FD, LT e BD; as demais da lista inicial inativas; produtos só em medida ativa; embalagens = caixas', () => {
    const d = dadosDemo('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: '2026-11-04' }); // hora-fixa-ok: dados estáticos
    const m = dadosDemoMedidas(d);
    const ativas = m.medidas.filter((x) => x.ativo).map((x) => String(x.sigla));
    expect(ativas).toEqual(expect.arrayContaining([...MEDIDAS_ATIVAS_DEMO]));
    // sem sigla extra: o PAP-4 passou de PC para UN (02/11); só as 5 ativas da demo
    expect([...ativas].sort()).toEqual([...MEDIDAS_ATIVAS_DEMO].sort());
    expect(m.medidas.filter((x) => !x.ativo).map((x) => x.sigla)).toEqual(['PCT', 'TB', 'GL', 'KG', 'DZ', 'DP']);
    for (const x of m.medidas) expect(x.id).toBe(idMedida(m.tenantId, String(x.sigla)));
    const ativa = new Set(ativas);
    for (const p of d['core.produto']) expect(ativa.has(String(p.unidade)), String(p.sku)).toBe(true);
    for (const u of d['core.produto_unidade']) expect(ativa.has(String(u.unidade))).toBe(true);
    expect(m.embalagens.length).toBeGreaterThanOrEqual(3);
    expect(m.embalagens.every(([, medida, qtd]) => medida === 'CX' && qtd > 1)).toBe(true);
    expect(m.embalagens.some(([, , qtd]) => qtd === 12)).toBe(true);
  });
});

describe.skipIf(semBanco())('0018 medidas (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const siglas = async () => (await q<{ sigla: string }>('select sigla from core.medida order by sigla')).rows.map((r) => r.sigla);

  it('lista inicial nos dois tenants (+ a sigla própria de cada um) e RLS: cada tenant só vê as suas', async () => {
    const deA = await emTransacao(app, A, siglas);
    const deB = await emTransacao(app, B, siglas);
    expect(deA).toEqual([...SIGLAS_INICIAIS, 'PC'].sort());
    expect(deB).toEqual([...SIGLAS_INICIAIS, 'GF'].sort());
    const alheias = await emTransacao(app, A, () => q<{ n: number }>('select count(*)::int as n from core.medida where tenant_id = $1', [B]));
    expect(alheias.rows[0]!.n).toBe(0);
    const semContexto = await emTransacao(app, null, () => q<{ n: number }>('select count(*)::int as n from core.medida'));
    expect(semContexto.rows[0]!.n).toBe(0);
  });

  it('RLS forçado: A não edita nem insere medida de B', async () => {
    await emTransacao(app, A, async () => {
      const r = await q("update core.medida set descricao = 'X' where tenant_id = $1", [B]);
      expect(r.rowCount).toBe(0);
    });
    const e = await erroDe(emTransacao(app, A, () => q("insert into core.medida (tenant_id, sigla, descricao) values ($1, 'ZZ', 'Z')", [B])));
    expect(e?.code).toBe('42501');
    const del = await erroDe(emTransacao(app, A, () => q("delete from core.medida where sigla = 'DP'")));
    expect(del?.code).toBe('42501'); // sem DELETE para a aplicação
  });

  it('sigla única por tenant; a mesma sigla nova convive em A e em B; formato ^[A-Z]{1,4}$', async () => {
    const dup = await erroDe(emTransacao(app, A, () => q("insert into core.medida (tenant_id, sigla, descricao) values ($1, 'UN', 'Outra')", [A])));
    expect(dup?.code).toBe('23505');
    await emTransacao(app, A, async () => {
      await q("insert into core.medida (tenant_id, sigla, descricao) values ($1, 'GF', 'Garrafa de A')", [A]);
      expect((await q<{ n: number }>("select count(*)::int as n from core.medida where sigla = 'GF'")).rows[0]!.n).toBe(1);
    });
    for (const ruim of ['un', 'ABCDE', 'U1', '']) {
      const e = await erroDe(emTransacao(app, A, () => q('insert into core.medida (tenant_id, sigla, descricao) values ($1, $2, $3)', [A, ruim, 'x'])));
      expect(e?.code, ruim).toBe('23514');
    }
    const semDescricao = await erroDe(emTransacao(app, A, () => q("insert into core.medida (tenant_id, sigla, descricao) values ($1, 'QQ', '  ')", [A])));
    expect(semDescricao?.code).toBe('23514');
  });

  it('produto só aceita medida cadastrada do PRÓPRIO tenant (FK composta): GF existe só em B', async () => {
    const ins = (unidade: string) => q("insert into core.produto (tenant_id, sku, nome, unidade) values ($1, 'T18-' || $2, 'Teste', $2)", [A, unidade]);
    expect((await erroDe(emTransacao(app, A, () => ins('GF'))))?.code).toBe('23503');
    expect((await erroDe(emTransacao(app, A, () => ins('XYZ'))))?.code).toBe('23503');
    expect(await erroDe(emTransacao(app, A, () => ins('PC')))).toBeNull();
    expect(await erroDe(emTransacao(app, B, () => q("insert into core.produto (tenant_id, sku, nome, unidade) values ($1, 'T18-GF', 'Teste', 'GF')", [B])))).toBeNull();
    // unidade de venda idem
    const pu = (unidade: string) =>
      q('insert into core.produto_unidade (tenant_id, produto_id, unidade, fator) values ($1, $2, $3, 6)', [A, DOIS_TENANTS.A.produtos.p2, unidade]);
    expect((await erroDe(emTransacao(app, A, () => pu('GF'))))?.code).toBe('23503');
    expect(await erroDe(emTransacao(app, A, () => pu('FD')))).toBeNull();
  });

  it('embalagem tudo-ou-nada, quantidade > 1, medida diferente da unidade e cadastrada', async () => {
    const emb = (medida: string | null, qtd: number | null) =>
      q('update core.produto set embalagem_medida = $2, embalagem_quantidade = $3 where id = $1', [DOIS_TENANTS.A.produtos.p1, medida, qtd]);
    expect((await erroDe(emTransacao(app, A, () => emb('CX', null))))?.code).toBe('23514');
    expect((await erroDe(emTransacao(app, A, () => emb(null, 12))))?.code).toBe('23514');
    expect((await erroDe(emTransacao(app, A, () => emb('CX', 1))))?.code).toBe('23514');
    expect((await erroDe(emTransacao(app, A, () => emb('CX', 10000))))?.code).toBe('23514'); // teto 9999
    expect((await erroDe(emTransacao(app, A, () => emb('PC', 12))))?.code).toBe('23514'); // = unidade do p1
    expect((await erroDe(emTransacao(app, A, () => emb('GF', 12))))?.code).toBe('23503'); // GF é de B
    await emTransacao(app, A, async () => {
      expect((await emb('CX', 12)).rowCount).toBe(1);
      expect((await emb('CX', 9999)).rowCount).toBe(1);
      expect((await emb('CX', 2)).rowCount).toBe(1);
      expect((await emb(null, null)).rowCount).toBe(1);
    });
  });

  it('não apaga medida em uso (soft delete e troca de sigla recusados); inativar pode; sem uso pode sair', async () => {
    const soft = (sigla: string) => q('update core.medida set deleted_at = now() where sigla = $1', [sigla]);
    const e = await erroDe(emTransacao(app, A, () => soft('PC')));
    expect(e?.code).toBe('23503');
    expect(e?.message).toMatch(/em uso/);
    // CX: usada só pela unidade de venda do p1 (produto_unidade) — também em uso
    expect((await erroDe(emTransacao(app, A, () => soft('CX'))))?.code).toBe('23503');
    // embalagem conta como uso
    await emTransacao(app, A, async () => {
      await q("update core.produto set embalagem_medida = 'DZ', embalagem_quantidade = 12 where id = $1", [DOIS_TENANTS.A.produtos.p2]);
      expect((await erroDe(soft('DZ')))?.code).toBe('23503');
    });
    expect((await erroDe(emTransacao(app, A, () => q("update core.medida set sigla = 'PEC' where sigla = 'PC'"))))?.code).toBe('23503');
    await emTransacao(app, A, async () => {
      expect((await q("update core.medida set ativo = false, descricao = 'Peça avulsa' where sigla = 'PC'")).rowCount).toBe(1);
      expect((await soft('DP')).rowCount).toBe(1);
    });
    // DELETE físico (admin) de medida em uso: a FK recusa
    await comCliente(banco().urlAdmin, async (admin) => {
      const r = await erroDe(emTransacao(admin, null, () => admin.query("delete from core.medida where tenant_id = $1 and sigla = 'PC'", [A])));
      expect(r?.code).toBe('23503');
    });
  });

  it('item do pedido: medida, quantidade_embalagem e quantidade_unidades DERIVADAS de unidade/fator/quantidade (o que vier nelas é ignorado)', async () => {
    type Item = { medida: string | null; unidade: string | null; fator: number; quantidade_embalagem: number; quantidade_unidades: number; quantidade_base: number };
    const COLS = 'medida, unidade, fator, quantidade_embalagem, quantidade_unidades, quantidade_base';
    await emTransacao(app, A, async () => {
      const ped = (await q<{ id: string; produto_id: string }>('select pedido_id as id, produto_id from vendedor.pedido_item limit 1')).rows[0]!;
      const novo = async (extra: string, valores: string) =>
        (await q<Item>(
          `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, total_cents${extra})
           values ($1, $2, (select coalesce(max(sequencia), 0) + 1 from vendedor.pedido_item where pedido_id = $2), $3, 2, 100, 100, 200${valores})
           returning ${COLS}`,
          [A, ped.id, ped.produto_id],
        )).rows[0]!;
      // código atual do Vendedor: grava só unidade/fator (quantidade_base fica no padrão 0 e o gatilho da 0013 a calcula)
      expect(await novo(', unidade, fator', ", 'cx', 12")).toEqual({ medida: 'CX', unidade: 'cx', fator: 12, quantidade_embalagem: 12, quantidade_unidades: 24, quantidade_base: 24 });
      expect(await novo(', unidade', ", 'UN'")).toEqual({ medida: 'UN', unidade: 'UN', fator: 1, quantidade_embalagem: 1, quantidade_unidades: 2, quantidade_base: 2 });
      // valores divergentes gravados direto nas derivadas são sobrescritos (nunca divergem; não vira 23514/500)
      expect(await novo(', unidade, fator, medida, quantidade_embalagem, quantidade_unidades, quantidade_base', ", 'FD', 6, 'CX', 99, 7, 5")).toEqual({
        medida: 'FD', unidade: 'FD', fator: 6, quantidade_embalagem: 6, quantidade_unidades: 12, quantidade_base: 12,
      });
      // unidade fora do formato ou nula: medida nula, unidade preservada como veio
      expect(await novo(', unidade', ", 'CAIXA'")).toMatchObject({ medida: null, unidade: 'CAIXA', quantidade_embalagem: 1, quantidade_unidades: 2 });
      expect(await novo('', '')).toMatchObject({ medida: null, unidade: null, quantidade_embalagem: 1, quantidade_unidades: 2 });
      // UPDATE: troca de unidade/fator/quantidade leva as derivadas; escrever nelas não tem efeito
      const r = await q<Item>(`update vendedor.pedido_item set fator = 10, unidade = 'CX', quantidade = 3 where pedido_id = $1 and unidade = 'UN' returning ${COLS}`, [ped.id]);
      expect(r.rows[0]).toEqual({ medida: 'CX', unidade: 'CX', fator: 10, quantidade_embalagem: 10, quantidade_unidades: 30, quantidade_base: 30 });
      const r2 = await q<Item>(`update vendedor.pedido_item set medida = 'DZ', quantidade_embalagem = 1, quantidade_unidades = 1 where pedido_id = $1 and unidade = 'CX' returning ${COLS}`, [ped.id]);
      expect(r2.rows[0]).toEqual({ medida: 'CX', unidade: 'CX', fator: 10, quantidade_embalagem: 10, quantidade_unidades: 30, quantidade_base: 30 });
      // nenhuma linha do tenant diverge (a derivada da unidade, = fator, = quantidade_base)
      const div = await q<{ n: number }>(
        `select count(*)::int as n from vendedor.pedido_item
          where medida is distinct from vendedor.medida_do_item(unidade) or quantidade_embalagem <> fator or quantidade_unidades <> quantidade_base`,
      );
      expect(div.rows[0]!.n).toBe(0);
    });
    // os CHECKs travam a coerência mesmo com o gatilho desligado (admin, transação desfeita)
    await comCliente(banco().urlAdmin, (admin) =>
      emTransacao(admin, null, async () => {
        await admin.query('alter table vendedor.pedido_item disable trigger pedido_item_medida');
        for (const set of ["medida = 'DZ'", 'quantidade_embalagem = fator + 1', 'quantidade_unidades = quantidade_unidades + 1']) {
          const e = await erroDe(admin.query('savepoint s').then(() => admin.query(`update vendedor.pedido_item set ${set} where tenant_id = $1`, [A])));
          expect(e?.code, set).toBe('23514');
          await admin.query('rollback to savepoint s');
        }
      }),
    );
    // itens que já existiam (fixture): coerentes com unidade / fator / quantidade_base
    const inc = await comCliente(banco().urlAdmin, (admin) =>
      admin.query<{ n: number }>(
        `select count(*)::int as n from vendedor.pedido_item
          where medida is distinct from vendedor.medida_do_item(unidade) or quantidade_embalagem <> fator or quantidade_unidades <> quantidade_base`,
      ),
    );
    expect(inc.rows[0]!.n).toBe(0);
  });

  it('ordem dos BEFORE ROW: pedido_item_medida roda antes de pedido_item_quantidade_base e o resultado é o mesmo', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) =>
      admin.query<{ tgname: string }>(
        `select tgname from pg_trigger where tgrelid = 'vendedor.pedido_item'::regclass and not tgisinternal order by tgname`,
      ),
    );
    const nomes = r.rows.map((x) => x.tgname);
    expect(nomes.indexOf('pedido_item_medida')).toBeLessThan(nomes.indexOf('pedido_item_quantidade_base'));
    // independe da ordem: as duas calculam quantidade × fator a partir das colunas de origem (provado no teste acima com
    // quantidade_base omitida/divergente no INSERT e quantidade_unidades = quantidade_base no RETURNING)
  });

  it('tenant novo recebe as 11 medidas iniciais (gatilho) com o id de idMedida', async () => {
    await comCliente(banco().urlAdmin, (admin) =>
      emTransacao(admin, null, async () => {
        const t = 'cccccccc-0018-4000-8000-000000000001';
        await admin.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 't0018-novo', 'Novo')", [t]);
        const r = await admin.query<{ id: string; sigla: string; ativo: boolean }>('select id, sigla, ativo from core.medida where tenant_id = $1 order by sigla', [t]);
        expect(r.rows.map((x) => x.sigla)).toEqual([...SIGLAS_INICIAIS].sort());
        expect(r.rows.every((x) => x.ativo && x.id === idMedida(t, x.sigla))).toBe(true);
        // contexto restaurado depois da semeadura
        expect((await admin.query("select coalesce(current_setting('app.tenant_id', true), '') as c")).rows[0].c).toBe('');
      }),
    );
  });
});

// Os dados entram na 0017 (antes da 0018), anterior à política manutencao da 0031: sem superusuário (DBaaS) o admin não
// grava nem lê essas linhas e o caso pula com o motivo no título; com superusuário (CI, local) roda sempre.
const semSuperusuario = motivoSemSuperusuario('0017');
describe.skipIf(semBanco() || semSuperusuario !== null)(comMotivo('0018 up/down com dados (banco efêmero)', semSuperusuario), () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000018';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0018_medidas') - 1]!.slice(0, 4);
  const desde0018 = nomes.filter((n) => n >= '0018');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('produto antigo normalizado e sigla usada semeada; item antigo preenchido; down -> catálogo anterior; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo18', 'Antigo')", [T]);
      await c.query(
        `insert into core.produto (id, tenant_id, sku, nome, unidade) values
           ('cccccccc-0018-4000-8000-000000000001', $1, 'P1', 'Um', ' un '),
           ('cccccccc-0018-4000-8000-000000000002', $1, 'P2', 'Dois', 'PC')`,
        [T],
      );
      await c.query("insert into core.produto_unidade (tenant_id, produto_id, unidade, fator) values ($1, 'cccccccc-0018-4000-8000-000000000002', 'GFA', 6)", [T]);
      await c.query(
        "insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status) values ('cccccccc-0018-4000-8000-000000000010', $1, gen_random_uuid(), $2, $2, 'draft')",
        [T, 'cccccccc-0018-4000-8000-000000000020'],
      );
      await c.query(
        `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, total_cents, unidade, fator)
         values ($1, 'cccccccc-0018-4000-8000-000000000010', 1, 'cccccccc-0018-4000-8000-000000000002', 3, 10, 10, 30, 'GFA', 6),
                ($1, 'cccccccc-0018-4000-8000-000000000010', 2, 'cccccccc-0018-4000-8000-000000000001', 2, 10, 10, 20, null, 1),
                ($1, 'cccccccc-0018-4000-8000-000000000010', 3, 'cccccccc-0018-4000-8000-000000000001', 1, 10, 10, 10, ' cx ', 12),
                ($1, 'cccccccc-0018-4000-8000-000000000010', 4, 'cccccccc-0018-4000-8000-000000000001', 1, 10, 10, 10, 'CX12', 12)`,
        [T],
      );
      const itensAntes = (await c.query('select id, unidade, updated_at from vendedor.pedido_item where tenant_id = $1 order by sequencia', [T])).rows;
      // unidade histórica fora do formato no ITEM ("CX12") não aborta (medida nula + NOTICE com tenant e sigla)
      const avisos: string[] = [];
      const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
      c.on('notice', ouvir);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0018);
      c.off('notice', ouvir);
      expect(avisos.join('\n')).toContain("tenant antigo18 (cccccccc-0000-4000-8000-000000000018): 'CX12' x1");
      expect(avisos.join('\n')).not.toContain("' cx '");
      const depois = await retratoDoCatalogo(c);
      const med = await c.query<{ sigla: string; descricao: string }>('select sigla, descricao from core.medida where tenant_id = $1 order by sigla', [T]);
      expect(med.rows.map((x) => x.sigla)).toEqual([...SIGLAS_INICIAIS, 'GFA', 'PC'].sort());
      expect(med.rows.find((x) => x.sigla === 'PC')?.descricao).toBe('PC');
      expect((await c.query("select unidade from core.produto where sku = 'P1'")).rows[0].unidade).toBe('UN');
      const itens = await c.query('select sequencia, medida, quantidade_embalagem, quantidade_unidades from vendedor.pedido_item where tenant_id = $1 order by sequencia', [T]);
      expect(itens.rows).toEqual([
        { sequencia: 1, medida: 'GFA', quantidade_embalagem: 6, quantidade_unidades: 18 },
        { sequencia: 2, medida: null, quantidade_embalagem: 1, quantidade_unidades: 2 },
        { sequencia: 3, medida: 'CX', quantidade_embalagem: 12, quantidade_unidades: 12 },
        { sequencia: 4, medida: null, quantidade_embalagem: 12, quantidade_unidades: 12 },
      ]);
      // backfill: unidade histórica intacta (nem normalizada) e updated_at intacto (nada é puxado de novo)
      expect((await c.query('select id, unidade, updated_at from vendedor.pedido_item where tenant_id = $1 order by sequencia', [T])).rows).toEqual(itensAntes);
      // down (da última até a 0018) volta exatamente ao catálogo anterior; os dados antigos ficam
      expect((await migrarDown(c, { passos: desde0018.length })).aplicadas).toEqual([...desde0018].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select count(*)::int as n from vendedor.pedido_item where tenant_id = $1', [T])).rows[0].n).toBe(4);
      // down de novo (idempotente) não quebra
      await c.query(m18.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      // sigla fora do formato em core.produto / core.produto_unidade aborta o up com mensagem clara: tenant, tabela e sigla
      await c.query("insert into core.produto (tenant_id, sku, nome, unidade) values ($1, 'P3', 'Três', 'LITRO')", [T]);
      await c.query("insert into core.produto_unidade (tenant_id, produto_id, unidade, fator) values ($1, 'cccccccc-0018-4000-8000-000000000001', 'CX12', 12)", [T]);
      const falha = (await migrarUp(c).then(() => null, (e: Error) => e)) as (Error & { cause?: { code?: string; hint?: string } }) | null;
      expect(falha?.cause?.code).toBe('23514');
      expect(falha?.message).toContain('Falha ao aplicar 0018_medidas.up.sql: 0018_medidas: unidade fora do formato de sigla');
      expect(falha?.message).toContain("tenant antigo18 (cccccccc-0000-4000-8000-000000000018): core.produto 'LITRO'");
      expect(falha?.message).toContain("tenant antigo18 (cccccccc-0000-4000-8000-000000000018): core.produto_unidade 'CX12'");
      expect(falha?.cause?.hint).toMatch(/1 a 4 letras/);
      await c.query("delete from core.produto_unidade where unidade = 'CX12'");
      await c.query("delete from core.produto where sku = 'P3'");
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
