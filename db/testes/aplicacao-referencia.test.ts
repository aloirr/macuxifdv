/**
 * 0033 — aplicação do produto (T-0084: RN-CAT-11, RN-CAT-12, RN-VEN-19) e referência cruzada (T-0085: RN-CAT-09). Desenhos
 * docs/desenho/T-0084.md §6/§7 e T-0085.md §7, com a correção do gerente (05/11 21h, ordem do Alexandre): as marcas
 * concorrentes ficam no cadastro `concorrente` do PROMOTOR, lidas pelo contrato dele — nada em core.* nem em promotor.*.
 * O que o BANCO garante:
 * - produto_conteudo: aplicação até 2.000 caracteres; etiquetas até 4, cada uma não vazia e com até 20 caracteres;
 * - produto_busca: aplicação no peso C e referências no peso A do documento (gatilho), backfill da aplicação;
 * - produto_referencia: RLS forçado por tenant, ordem 1..3 (até 3 vivas por produto), código 1..30 não vazio, compacto
 *   `^[a-z0-9]{1,30}$`, únicos vivos, índice do código normalizado, SEM FK (nem para core.produto nem para o Promotor);
 * - pedido_item.aplicacao: nulo ou até 1.000 caracteres (retrato do item).
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { dadosDoisTenants, DOIS_TENANTS, MARCAS_FIXTURE, REFERENCIAS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { PROMOTOR_FIXTURE } from '../seeds/fixtures/promotor';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { idFixo } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m33 = migracoes.find((m) => m.versao === '0033')!;
const m13 = migracoes.find((m) => m.versao === '0013')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** Corpo da função do gatilho do documento de busca (entre os $$). */
const corpoDoGatilho = (sql: string) => /create (?:or replace )?function catalogo\.produto_busca_documento\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql)?.[1] ?? '';
/** Forma normalizada do código (a mesma regra do `codigoCompacto` do domain do Catálogo: sem acento, minúsculas, só [a-z0-9]). */
const compacto = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Item 1 do pedido p1 de A na fixture (com o retrato da aplicação). */
const ITEM_P1 = idFixo('aaaaaaaa', 0x31, 1);

describe('0033 aplicação e referência cruzada (estático)', () => {
  it('nome e posição: 0033_catalogo_aplicacao_referencia logo depois da 0032', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0032_plataforma_excluir_tenant_ordem_fk') + 1]).toBe('0033_catalogo_aplicacao_referencia');
  });

  it('correção do gerente (ADR 0027 não vale): nada em core.* nem em promotor.*; marca_id sem FK', () => {
    const sql = semComentarios(m33.up);
    expect(sql).not.toMatch(/\bcore\./);
    expect(sql).not.toMatch(/\bpromotor\./);
    expect(sql).not.toMatch(/marca_concorrente/);
    // única FK da tabela nova = o tenant
    const tabela = /create table catalogo\.produto_referencia \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    expect([...tabela.matchAll(/references ([a-z_.]+)/g)].map((x) => x[1])).toEqual(['plataforma.tenant']);
    expect(tabela).toMatch(/^\s+marca_id\s+uuid not null,$/m);
    expect(tabela).toMatch(/^\s+produto_id\s+uuid not null,$/m);
  });

  it('RN-CAT-11: aplicação até 2.000 (corte antes do CHECK) e etiquetas até 4 de até 20 caracteres', () => {
    const sql = semComentarios(m33.up);
    expect(sql).toContain('update catalogo.produto_conteudo set aplicacoes = rtrim(left(aplicacoes, 2000)) where char_length(aplicacoes) > 2000;');
    expect(sql.indexOf('rtrim(left(aplicacoes, 2000))')).toBeLessThan(sql.indexOf('produto_conteudo_aplicacoes_tamanho'));
    expect(sql).toContain('add constraint produto_conteudo_aplicacoes_tamanho check (aplicacoes is null or char_length(aplicacoes) <= 2000);');
    expect(sql).toContain("alter table catalogo.produto_conteudo add column etiquetas text[] not null default '{}';");
    expect(sql).toContain('add constraint produto_conteudo_etiquetas_validas check (catalogo.etiquetas_validas(etiquetas));');
    expect(sql).toMatch(/create function catalogo\.etiquetas_validas\(p text\[\]\) returns boolean\s+language sql immutable parallel safe\s+set search_path = pg_catalog, pg_temp/);
    expect(sql).toContain('cardinality(p) <= 4');
    expect(sql).toContain("btrim(e) <> '' and char_length(e) <= 20");
    expect(sql).not.toMatch(/security definer/);
  });

  it('RN-CAT-12/RN-CAT-09: gatilho com referencias no peso A, aplicacao no peso C e conteudo no D; backfill da aplicação', () => {
    const corpo = corpoDoGatilho(m33.up);
    expect(corpo).toContain("concat_ws(' ', new.sku, new.ean, new.nome, new.referencias))), 'A')");
    expect(corpo).toContain("concat_ws(' ', new.marca, new.categoria))), 'B')");
    expect(corpo).toContain("concat_ws(' ', new.atributos, new.aplicacao))), 'C')");
    expect(corpo).toContain("catalogo.sem_acento(new.conteudo)), 'D')");
    expect(m33.up).toContain('alter table catalogo.produto_busca add column aplicacao text;');
    expect(m33.up).toContain('alter table catalogo.produto_busca add column referencias text;');
    expect(semComentarios(m33.up)).toMatch(/update catalogo\.produto_busca b\s+set aplicacao = c\.aplicacoes\s+from catalogo\.produto_conteudo c/);
  });

  it('RN-CAT-09: produto_referencia com checks, únicos vivos, índice do código normalizado, sync, RLS e manutencao', () => {
    const sql = semComentarios(m33.up);
    for (const trecho of [
      "constraint produto_referencia_codigo_preenchido check (btrim(codigo) <> '' and char_length(codigo) <= 30)",
      "constraint produto_referencia_codigo_compacto_formato check (codigo_compacto ~ '^[a-z0-9]{1,30}$')",
      'constraint produto_referencia_ordem_faixa check (ordem between 1 and 3)',
      'create unique index produto_referencia_ordem_uk on catalogo.produto_referencia (tenant_id, produto_id, ordem) where deleted_at is null;',
      'create unique index produto_referencia_codigo_uk on catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo_compacto) where deleted_at is null;',
      'create index produto_referencia_codigo_compacto_ix on catalogo.produto_referencia (tenant_id, codigo_compacto text_pattern_ops) where deleted_at is null;',
      'create index produto_referencia_sync_ix on catalogo.produto_referencia (tenant_id, updated_at, id);',
      'create unique index produto_referencia_external_uk on catalogo.produto_referencia (tenant_id, external_id) where external_id is not null and deleted_at is null;',
      'alter table catalogo.produto_referencia force row level security;',
      'create policy manutencao on catalogo.produto_referencia for all to macuxi_manutencao using (true) with check (true);',
      'grant select, insert, update, delete on catalogo.produto_referencia to macuxi_app;',
    ]) expect(sql).toContain(trecho);
    // o compacto é gravado pela API (uma implementação só, a do JS): nada de coluna gerada
    expect(sql).not.toMatch(/generated always/);
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).not.toContain('catalogo.produto_referencia');
  });

  it('RN-VEN-19: pedido_item.aplicacao nulo ou até 1.000, sem backfill', () => {
    const sql = semComentarios(m33.up);
    expect(sql).toContain('alter table vendedor.pedido_item add column aplicacao text;');
    expect(sql).toContain('add constraint pedido_item_aplicacao_tamanho check (aplicacao is null or char_length(aplicacao) <= 1000);');
    expect(sql).not.toMatch(/update vendedor\./);
  });

  it('espelhos Drizzle com as colunas novas', () => {
    expect(nuvemCatalogo.produtoConteudo.etiquetas.notNull).toBe(true);
    expect(nuvemCatalogo.produtoBusca.aplicacao.notNull).toBe(false);
    expect(nuvemCatalogo.produtoBusca.referencias.notNull).toBe(false);
    for (const c of ['produto_id', 'codigo', 'codigo_compacto', 'ordem'] as const) expect(nuvemCatalogo.produtoReferencia[c].notNull, c).toBe(true);
    expect(nuvemVendedor.pedidoItem.aplicacao.notNull).toBe(false);
  });

  it('down desfaz tudo o que o up cria e devolve o gatilho da 0013 (idempotente)', () => {
    const down = semComentarios(m33.down);
    for (const trecho of [
      'drop table if exists catalogo.produto_referencia;',
      'alter table vendedor.pedido_item drop constraint if exists pedido_item_aplicacao_tamanho;',
      'alter table vendedor.pedido_item drop column if exists aplicacao;',
      'alter table catalogo.produto_busca drop column if exists referencias;',
      'alter table catalogo.produto_busca drop column if exists aplicacao;',
      'alter table catalogo.produto_conteudo drop constraint if exists produto_conteudo_etiquetas_validas;',
      'alter table catalogo.produto_conteudo drop column if exists etiquetas;',
      'drop function if exists catalogo.etiquetas_validas(text[]);',
      'alter table catalogo.produto_conteudo drop constraint if exists produto_conteudo_aplicacoes_tamanho;',
    ]) expect(down).toContain(trecho);
    const constraints = [...m33.up.matchAll(/add constraint ([a-z_]+) /g)].map((x) => x[1]!);
    expect(constraints).toEqual(['produto_conteudo_aplicacoes_tamanho', 'produto_conteudo_etiquetas_validas', 'pedido_item_aplicacao_tamanho']);
    expect(corpoDoGatilho(m33.down).trim()).toBe(corpoDoGatilho(m13.up).trim());
    // as colunas saem só depois que o gatilho deixa de usá-las
    expect(down.indexOf('create or replace function catalogo.produto_busca_documento()')).toBeLessThan(down.indexOf('drop column if exists referencias'));
  });

  it('fixture: referências em A e B com o compacto da regra do domain, marca = concorrente do Promotor do mesmo tenant', () => {
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const refs = d['catalogo.produto_referencia'];
    for (const r of refs) {
      expect(r.codigo_compacto, String(r.codigo)).toBe(compacto(String(r.codigo)));
      expect(String(r.codigo).length).toBeLessThanOrEqual(30);
      expect(r.marca_id).toBe(r.tenant_id === A.tenantId ? PROMOTOR_FIXTURE.A.concorrente : PROMOTOR_FIXTURE.B.concorrente);
    }
    expect(refs.filter((r) => r.tenant_id === A.tenantId && r.deleted_at === null).map((r) => r.ordem)).toEqual([1, 2]);
    expect(refs.filter((r) => r.tenant_id === B.tenantId).map((r) => r.id)).toEqual([REFERENCIAS_FIXTURE.B.lb0099]);
    const aplicacoes = d['catalogo.produto_conteudo'].map((c) => [c.tenant_id, c.aplicacoes]);
    expect(aplicacoes).toEqual([[A.tenantId, 'Motos 150 cc'], [B.tenantId, 'Carros flex 1.0 a 2.0 2015–2020']]);
  });
});

describe.skipIf(semBanco())('0033 aplicação e referência cruzada (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const erroEmA = async (fn: () => Promise<unknown>) => erroDe(emTransacao(app, A.tenantId, fn));
  const conteudoA = idFixo('aaaaaaaa', 0x46, 1);

  it('RN-CAT-11: aplicação com 2.000 passa e com 2.001 é recusada; nula passa', async () => {
    expect(await erroEmA(() => q('update catalogo.produto_conteudo set aplicacoes = $2 where id = $1', [conteudoA, 'á'.repeat(2000)]))).toBeNull();
    expect(await erroEmA(() => q('update catalogo.produto_conteudo set aplicacoes = null where id = $1', [conteudoA]))).toBeNull();
    expect(await erroEmA(() => q('update catalogo.produto_conteudo set aplicacoes = $2 where id = $1', [conteudoA, 'x'.repeat(2001)])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('produto_conteudo_aplicacoes_tamanho') });
  });

  it('etiquetas: 4 de 20 passam; 5, uma de 21, vazia, só espaço e nula são recusadas; padrão vazio', async () => {
    const gravar = (v: unknown) => q('update catalogo.produto_conteudo set etiquetas = $2::text[] where id = $1', [conteudoA, v]);
    expect(await erroEmA(() => gravar(['Dianteira', 'Traseira', 'Novo', 'x'.repeat(20)]))).toBeNull();
    expect(await erroEmA(() => gravar([]))).toBeNull();
    for (const ruim of [['a', 'b', 'c', 'd', 'e'], ['x'.repeat(21)], [''], ['   '], ['ok', null]])
      expect(await erroEmA(() => gravar(ruim)), JSON.stringify(ruim)).toMatchObject({ code: '23514', message: expect.stringContaining('produto_conteudo_etiquetas_validas') });
    expect((await erroEmA(() => q('update catalogo.produto_conteudo set etiquetas = null where id = $1', [conteudoA])))?.code).toBe('23502');
    const r = await emTransacao(app, B.tenantId, () => q<{ e: string[] }>('select etiquetas as e from catalogo.produto_conteudo'));
    expect(r.rows).toEqual([{ e: [] }]);
  });

  it('RN-CAT-12: a aplicação entra no peso C e as referências no peso A; o conteúdo fica no D; o gatilho recalcula', async () => {
    const r = await emTransacao(app, A.tenantId, async () => {
      const peso = (pesos: string, termo: string) =>
        q<{ ok: boolean }>(`select ts_filter(documento, $1::"char"[]) @@ to_tsquery('portuguese', $2) as ok from catalogo.produto_busca where produto_id = $3`, [
          pesos,
          termo,
          A.produtos.p1,
        ]).then((x) => x.rows[0]!.ok);
      const antes = { motoC: await peso('{c}', 'motos'), motoA: await peso('{a}', 'motos'), refA: await peso('{a}', 'cb3401'), refC: await peso('{c}', 'cb3401') };
      await q("update catalogo.produto_busca set aplicacao = 'Fiat Uno 1.0/1.4 2010–2014 2011 2012 2013', conteudo = 'Pastilha cerâmica' where produto_id = $1", [A.produtos.p1]);
      const depois = { uno: await peso('{c}', 'uno & 2012'), moto: await peso('{c}', 'motos'), conteudoD: await peso('{d}', 'ceramica') };
      return { antes, depois };
    });
    expect(r.antes).toEqual({ motoC: true, motoA: false, refA: true, refC: false });
    expect(r.depois).toEqual({ uno: true, moto: false, conteudoD: true });
  });

  it('pedido_item.aplicacao: retrato da fixture; 1.000 passa, 1.001 é recusado, nulo passa', async () => {
    const r = await emTransacao(app, A.tenantId, () => q<{ id: string; aplicacao: string | null }>('select id, aplicacao from vendedor.pedido_item where pedido_id = $1 order by sequencia', [A.pedidos.p1]));
    expect(r.rows).toEqual([{ id: ITEM_P1, aplicacao: 'Motos 150 cc' }, { id: expect.any(String), aplicacao: null }]);
    expect(await erroEmA(() => q('update vendedor.pedido_item set aplicacao = $2 where id = $1', [ITEM_P1, 'é'.repeat(1000)]))).toBeNull();
    expect(await erroEmA(() => q('update vendedor.pedido_item set aplicacao = null where id = $1', [ITEM_P1]))).toBeNull();
    expect(await erroEmA(() => q('update vendedor.pedido_item set aplicacao = $2 where id = $1', [ITEM_P1, 'x'.repeat(1001)])))
      .toMatchObject({ code: '23514', message: expect.stringContaining('pedido_item_aplicacao_tamanho') });
  });

  it('produto_referencia — RLS: cada tenant só vê as próprias; sem contexto, nenhuma; escrever no alheio é recusado', async () => {
    const contar = (ctx: string | null) =>
      emTransacao(app, ctx, () =>
        q<{ n: number; vivas: number; alheias: number }>(
          `select count(*)::int as n, count(*) filter (where deleted_at is null)::int as vivas,
                  count(*) filter (where tenant_id <> coalesce(nullif(current_setting('app.tenant_id', true), ''), '00000000-0000-4000-8000-000000000000')::uuid)::int as alheias
             from catalogo.produto_referencia`,
        ),
      );
    expect((await contar(A.tenantId)).rows[0]).toEqual({ n: 3, vivas: 2, alheias: 0 });
    expect((await contar(B.tenantId)).rows[0]).toEqual({ n: 1, vivas: 1, alheias: 0 });
    expect((await contar(null)).rows[0]!.n).toBe(0);
    const inserirEmB = () =>
      q("insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, gen_random_uuid(), gen_random_uuid(), 'X 1', 'x1', 1)", [B.tenantId]);
    expect((await erroEmA(inserirEmB))?.code).toBe('42501');
    const upd = await emTransacao(app, A.tenantId, () => q("update catalogo.produto_referencia set codigo = 'Y' where tenant_id = $1", [B.tenantId]));
    expect(upd.rowCount).toBe(0);
    const del = await emTransacao(app, A.tenantId, () => q('delete from catalogo.produto_referencia where tenant_id = $1', [B.tenantId]));
    expect(del.rowCount).toBe(0);
    // a busca pelo código do concorrente de B não acha nada em A (e vice-versa)
    const achar = (ctx: string, c: string) => emTransacao(app, ctx, () => q('select produto_id from catalogo.produto_referencia where codigo_compacto = $1 and deleted_at is null', [c]));
    expect((await achar(A.tenantId, 'lb0099')).rowCount).toBe(0);
    expect((await achar(B.tenantId, 'cb3401')).rowCount).toBe(0);
    expect((await achar(A.tenantId, 'cb3401')).rows).toEqual([{ produto_id: A.produtos.p1 }]);
  });

  it('produto_referencia — checks (ordem 1..3, código 1..30 não vazio, compacto), até 3 vivas, sem repetir o compacto no produto (0075), FK só da marca (0045), updated_at', async () => {
    const inserir = (o: { produto?: string; marca?: string; codigo?: string; compacto?: string; ordem?: number | null; external?: string | null }) =>
      q('insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem, external_id) values ($1, $2, $3, $4, $5, $6, $7)', [
        A.tenantId,
        o.produto ?? A.produtos.p2,
        o.marca ?? PROMOTOR_FIXTURE.A.concorrente,
        o.codigo ?? 'FB-0207',
        o.compacto ?? 'fb0207',
        o.ordem === undefined ? 1 : o.ordem,
        o.external ?? null,
      ]);
    const checa = async (o: Parameters<typeof inserir>[0], restricao: string) =>
      expect(await erroEmA(() => inserir(o)), restricao).toMatchObject({ code: '23514', message: expect.stringContaining(restricao) });
    await checa({ ordem: 0 }, 'produto_referencia_ordem_faixa');
    await checa({ ordem: 4 }, 'produto_referencia_ordem_faixa');
    await checa({ codigo: 'x'.repeat(31), compacto: 'x'.repeat(30) }, 'produto_referencia_codigo_preenchido');
    await checa({ codigo: '   ' }, 'produto_referencia_codigo_preenchido');
    await checa({ compacto: 'FB0207' }, 'produto_referencia_codigo_compacto_formato');
    await checa({ compacto: 'fb-0207' }, 'produto_referencia_codigo_compacto_formato');
    await checa({ compacto: '' }, 'produto_referencia_codigo_compacto_formato');
    expect((await erroEmA(() => inserir({ ordem: null })))?.code).toBe('23502');
    // limite exato: código de 30 caracteres passa
    expect(await erroEmA(() => inserir({ codigo: 'x'.repeat(30), compacto: 'x'.repeat(30) }))).toBeNull();
    // p1 de A já tem as ordens 1 e 2 vivas: a 3 passa, de novo a 1 não (a apagada na ordem 1 não conta); 4ª impossível
    expect(await erroEmA(() => inserir({ produto: A.produtos.p1, codigo: 'ZZ 1', compacto: 'zz1', ordem: 3 }))).toBeNull();
    expect((await erroEmA(() => inserir({ produto: A.produtos.p1, codigo: 'ZZ 2', compacto: 'zz2', ordem: 1 })))?.code).toBe('23505');
    // mesma marca e mesmo compacto com outra grafia ("cb-3401" x "CB 3401") no mesmo produto: recusado
    expect((await erroEmA(() => inserir({ produto: A.produtos.p1, codigo: 'cb-3401', compacto: 'cb3401', ordem: 3 })))?.code).toBe('23505');
    // a apagada (cb3400) não conta: o mesmo código volta a valer
    expect(await erroEmA(() => inserir({ produto: A.produtos.p1, codigo: 'CB-3400', compacto: 'cb3400', ordem: 3 }))).toBeNull();
    // external_id único vivo por tenant
    expect((await erroEmA(() => inserir({ external: 'REF-A-1' })))?.code).toBe('23505');
    // produto sem FK (core.produto, a API valida pelo Core); marca com FK desde a 0045 (T-0113): inexistente = 23503
    expect(await erroEmA(() => q("insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, gen_random_uuid(), $2, 'A1', 'a1', 1)", [A.tenantId, MARCAS_FIXTURE.A.ativa]))).toBeNull();
    expect(await erroEmA(() => q("insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, gen_random_uuid(), gen_random_uuid(), 'A1', 'a1', 1)", [A.tenantId]))).toMatchObject({
      code: '23503',
      message: expect.stringContaining('produto_referencia_marca_fk'),
    });
    // gatilho de updated_at
    await emTransacao(app, A.tenantId, async () => {
      const r = await q<{ mudou: boolean }>("update catalogo.produto_referencia set codigo = 'CB  3401' where id = $1 returning updated_at > created_at as mudou", [REFERENCIAS_FIXTURE.A.cb3401]);
      expect(r.rows).toEqual([{ mudou: true }]);
    });
  });

  it('busca pelo código normalizado usa índice: igualdade e prefixo no codigo_compacto_ix ou no produto_codigo_uk (0075)', async () => {
    const plano = (sql: string, params: unknown[]) =>
      emTransacao(app, A.tenantId, async () => {
        await q('set local enable_seqscan = off');
        return (await q<{ 'QUERY PLAN': string }>(`explain ${sql}`, params)).rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    const filtro = 'from catalogo.produto_referencia where tenant_id = $1 and deleted_at is null';
    // 0075: o único (tenant_id, produto_id, codigo_compacto) também atende a igualdade (Index Only Scan, já traz o produto_id)
    const igual = await plano(`select produto_id ${filtro} and codigo_compacto = $2`, [A.tenantId, 'cb3401']);
    expect(igual).toMatch(/produto_referencia_(codigo_compacto_ix|produto_codigo_uk)/);
    expect(igual).not.toContain('Seq Scan');
    // com tabela pequena o planejador também prefere o único da 0075 para o prefixo (filtro dentro do Index Only Scan)
    const prefixo = await plano(`select produto_id ${filtro} and codigo_compacto like $2`, [A.tenantId, 'cb34%']);
    expect(prefixo).toMatch(/produto_referencia_(codigo_compacto_ix|produto_codigo_uk)/);
    expect(prefixo).not.toContain('Seq Scan');
  });
});

describe.skipIf(semBanco())('0033 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000033';
  const P = 'cccccccc-0033-4000-8000-000000000001';
  const M = 'cccccccc-0033-4000-8000-000000000002';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0033_catalogo_aplicacao_referencia') - 1]!.slice(0, 4);
  const desde0033 = nomes.filter((n) => n >= '0033');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('corta a aplicação acima de 2.000, preenche a busca e recalcula o documento; down volta ao catálogo da 0032; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      const gatilhoAntes = (await c.query<{ d: string }>("select pg_get_functiondef('catalogo.produto_busca_documento()'::regprocedure) as d")).rows[0]!.d;
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo33', 'Antigo')", [T]);
      const longa = `Fiat Uno 1.0/1.4 2010–2014 ${'palavra '.repeat(400)}`; // > 2.000
      await c.query('insert into catalogo.produto_conteudo (tenant_id, produto_id, aplicacoes) values ($1, $2, $3)', [T, P, longa]);
      await c.query("insert into catalogo.produto_busca (tenant_id, produto_id, sku, nome) values ($1, $2, 'PAS-1', 'Pastilha')", [T, P]);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0033);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('rel catalogo.produto_referencia r rls=true force=true');
      const conteudo = (await c.query<{ n: number; fim: string }>('select char_length(aplicacoes)::int as n, right(aplicacoes, 1) as fim from catalogo.produto_conteudo where tenant_id = $1', [T])).rows[0]!;
      expect(conteudo.n).toBeLessThanOrEqual(2000);
      expect(conteudo.fim).not.toBe(' ');
      const busca = (await c.query<{ ok: boolean; igual: boolean }>(
        `select ts_filter(b.documento, '{c}') @@ to_tsquery('portuguese', 'uno & 2010') as ok, b.aplicacao = c.aplicacoes as igual
           from catalogo.produto_busca b join catalogo.produto_conteudo c on c.produto_id = b.produto_id where b.tenant_id = $1`,
        [T],
      )).rows[0]!;
      expect(busca).toEqual({ ok: true, igual: true });
      // com referência, etiqueta e retrato gravados, o down apaga e volta ao catálogo anterior
      // 0045 (T-0113): a marca tem de existir no Catálogo (FK produto_referencia_marca_fk)
      await c.query("insert into catalogo.marca_concorrente (id, tenant_id, nome) values ($1, $2, 'Freiomax')", [M, T]);
      await c.query("insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, $2, $3, 'CB 3401', 'cb3401', 1)", [T, P, M]);
      await c.query("update catalogo.produto_conteudo set etiquetas = '{Dianteira}' where tenant_id = $1", [T]);
      expect((await migrarDown(c, { passos: desde0033.length })).aplicadas).toEqual([...desde0033].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query<{ d: string }>("select pg_get_functiondef('catalogo.produto_busca_documento()'::regprocedure) as d")).rows[0]!.d).toBe(gatilhoAntes);
      // documento recalculado sem a aplicação (que saiu do peso C): só o sku/nome continuam
      const doc = (await c.query<{ uno: boolean; nome: boolean }>(
        "select documento @@ to_tsquery('portuguese', 'uno') as uno, documento @@ to_tsquery('portuguese', 'pastilha') as nome from catalogo.produto_busca where tenant_id = $1",
        [T],
      )).rows[0]!;
      expect(doc).toEqual({ uno: false, nome: true });
      // down idempotente e up de novo chega ao mesmo catálogo
      await c.query(m33.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
