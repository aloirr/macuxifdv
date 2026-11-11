/**
 * 0037 — formas de pagamento e prazos (Vendedor), pagamento do pedido, formas permitidas e prazo médio máximo do cliente
 * (Core), tabela escalonada (Catálogo) e a forma "À vista" semeada em todo tenant (T-0089; RN-VEN-23, RN-VEN-24, RN-VEN-25;
 * desenho docs/desenho/T-0089.md §6 e §8; P7 ajustada pelo gerente em R-20261106-074250).
 * O que o BANCO garante: regra 5 nas 3 tabelas (o bloco S0-023 do estatico.test.ts confere as colunas, a RLS e o índice de
 * sync), únicos sempre com tenant_id, FKs compostas só dentro do schema, CHECKs das parcelas (1..24, 0..365, sem decrescer),
 * do prazo médio (entre a menor e a maior parcela), do pagamento do pedido (8 colunas juntas), dos códigos de forma do
 * cliente e da faixa (medida, quantidade, preço, vigência), a semeadura da forma padrão (gatilho + backfill) e o down.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { ENTIDADES, SIGLA_MEDIDA_FORMATO } from '../../modules/integracao/contracts';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { migracoesAparelho } from '../../modules/catalogo/db/aparelho';
import { dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS, PAGAMENTO_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { idDeChave } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const PA = PAGAMENTO_FIXTURE.A;
const PB = PAGAMENTO_FIXTURE.B;
const migracoes = lerMigracoes();
const m37 = migracoes.find((m) => m.versao === '0037')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const TABELAS = ['vendedor.forma_pagamento', 'vendedor.prazo_pagamento', 'catalogo.tabela_escalonada'] as const;
const COLUNAS_PEDIDO = [
  'forma_pagamento_id', 'prazo_pagamento_id', 'forma_pagamento_codigo', 'forma_pagamento_nome', 'prazo_codigo', 'prazo_descricao', 'prazo_parcelas_dias',
  'prazo_medio_dias',
] as const;
const HASH = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';

describe('0037 formas, prazos e tabela escalonada (estático)', () => {
  const sql = semComentarios(m37.up);
  const down = semComentarios(m37.down);

  it('nome e posição: 0037_forma_prazo_escalonada logo depois da 0036', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0036_core_usuario_convite') + 1]).toBe('0037_forma_prazo_escalonada');
  });

  it('regra 5: as 3 tabelas com RLS forçado, isolamento_tenant e manutencao, grant ao macuxi_app (sem worker) e no sync', () => {
    for (const t of TABELAS) {
      expect(sql).toContain(`alter table ${t} enable row level security;`);
      expect(sql).toContain(`alter table ${t} force row level security;`);
      expect(sql).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(sql).toContain(`grant select, insert, update, delete on ${t} to macuxi_app;`);
      expect(sql).toMatch(new RegExp(`create index [a-z_]+_sync_ix on ${t.replace('.', '\\.')} \\(tenant_id, updated_at, id\\);`));
      expect(sql).toMatch(new RegExp(`create unique index [a-z_]+_external_uk on ${t.replace('.', '\\.')} \\(tenant_id, external_id\\) where external_id is not null and deleted_at is null;`));
      expect(sql).toMatch(new RegExp(`create trigger [a-z_]+_updated_at before update on ${t.replace('.', '\\.')}`));
      expect(TABELAS_FORA_DO_SYNC as readonly string[]).not.toContain(t);
    }
    expect(sql).not.toMatch(/macuxi_worker/);
    expect(ORDEM_TABELAS).toEqual(expect.arrayContaining([...TABELAS]));
  });

  it('todo índice único da 0037 começa por tenant_id (a conformidade reprova único global)', () => {
    const unicos = [...sql.matchAll(/create unique index ([a-z_]+) on [a-z_]+\.[a-z_]+\s*\(([^)]*)\)/g)];
    expect(unicos.map((u) => u[1])).toEqual([
      'forma_pagamento_codigo_uk', 'forma_pagamento_external_uk', 'prazo_pagamento_codigo_uk', 'prazo_pagamento_external_uk', 'tabela_escalonada_faixa_uk',
      'tabela_escalonada_external_uk',
    ]);
    for (const u of unicos) expect(u[2]!.trim().startsWith('tenant_id,'), u[1]).toBe(true);
    for (const c of sql.matchAll(/constraint ([a-z_]+) unique \(([^)]*)\)/g)) expect(c[2]!.startsWith('tenant_id,'), c[1]).toBe(true);
    // a faixa: NULLS NOT DISTINCT (medida e tabela nulas não abrem duplicata) entre as vivas
    expect(sql).toMatch(
      /create unique index tabela_escalonada_faixa_uk on catalogo\.tabela_escalonada\s+\(tenant_id, produto_id, medida, quantidade_minima, tabela_preco_id, vigencia_inicio\) nulls not distinct where deleted_at is null;/,
    );
  });

  it('regra 1: FKs compostas só dentro do schema; produto_id e os códigos de forma do cliente sem FK', () => {
    const fks = [...sql.matchAll(/foreign key \(([^)]*)\) references ([a-z_]+)\.([a-z_]+) \(([^)]*)\)/g)].map((m) => `${m[1]} -> ${m[2]}.${m[3]} (${m[4]})`);
    expect(fks).toEqual([
      'tenant_id, forma_pagamento_id -> vendedor.forma_pagamento (tenant_id, id)',
      'tenant_id, forma_pagamento_id -> vendedor.forma_pagamento (tenant_id, id)',
      'tenant_id, prazo_pagamento_id -> vendedor.prazo_pagamento (tenant_id, id)',
      'tenant_id, tabela_preco_id -> catalogo.tabela_preco (tenant_id, id)',
    ]);
    // a FK de vendedor.pedido e a de vendedor.prazo_pagamento ficam no vendedor; a do catalogo no catalogo; core.cliente sem FK
    expect(sql).not.toMatch(/alter table core\.cliente add constraint [a-z_]+ foreign key/);
    expect(sql).not.toMatch(/references core\./);
  });

  it('CHECKs: parcelas (1..24, 0..365, sem decrescer), prazo médio entre a menor e a maior parcela, pagamento do pedido com as 8 colunas juntas', () => {
    expect(sql).toMatch(/create function vendedor\.parcelas_validas\(p integer\[\]\) returns boolean\s+language sql immutable parallel safe\s+set search_path = pg_catalog, pg_temp/);
    expect(sql).toContain('cardinality(p) between 1 and 24');
    expect(sql).toContain('e between 0 and 365');
    expect(sql).toContain('p[i] >= p[i - 1]');
    expect(sql).toMatch(/create function vendedor\.prazo_medio_coerente\(p integer\[\], m integer\) returns boolean\s+language sql immutable parallel safe/);
    expect(sql).toMatch(/create function core\.codigos_forma_validos\(p text\[\]\) returns boolean\s+language sql immutable parallel safe/);
    expect(sql).toContain('constraint prazo_pagamento_parcelas_validas check (vendedor.parcelas_validas(parcelas_dias))');
    expect(sql).toContain('constraint prazo_pagamento_prazo_medio_coerente check (vendedor.prazo_medio_coerente(parcelas_dias, prazo_medio_dias))');
    expect(sql).toMatch(/add constraint pedido_pagamento_completo check \(\s+num_nulls\(forma_pagamento_id, prazo_pagamento_id, forma_pagamento_codigo, forma_pagamento_nome, prazo_codigo, prazo_descricao,\s+prazo_parcelas_dias, prazo_medio_dias\) in \(0, 8\)\);/);
    expect(sql).toContain('check (prazo_medio_max_dias is null or prazo_medio_max_dias between 0 and 365)');
    expect(sql).toContain("check (medida is null or medida ~ '^[A-Z]{1,4}$')");
    expect(sql).toContain('check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)');
    for (const f of ['vendedor.parcelas_validas(integer[])', 'vendedor.prazo_medio_coerente(integer[], integer)', 'core.codigos_forma_validos(text[])']) {
      expect(sql).toContain(`grant execute on function ${f} to macuxi_app;`);
    }
  });

  it('pedido e cliente: só colunas NULAS novas, sem padrão (pedido antigo e APK antigo não mudam)', () => {
    for (const c of COLUNAS_PEDIDO) expect(sql).toMatch(new RegExp(`alter table vendedor\\.pedido add column ${c} (uuid|text|integer|integer\\[\\]);`));
    expect(sql).toContain('alter table core.cliente add column prazo_medio_max_dias integer;');
    expect(sql).toContain('alter table core.cliente add column formas_pagamento text[];');
    expect(sql).not.toMatch(/alter table (vendedor\.pedido|core\.cliente) add column [a-z_]+ [^;]*(not null|default)/);
    // nada da condição antiga muda (§2: legado)
    expect(sql).not.toMatch(/condicao_pagamento|cliente_condicao/);
  });

  it('P7: forma "À vista" com o prazo "À vista" [0] semeada por gatilho AFTER INSERT em plataforma.tenant e no backfill; função comum (sem DEFINER)', () => {
    expect(sql).toMatch(/create function vendedor\.semear_pagamento\(p_tenant uuid\) returns void\s+language plpgsql\s+set search_path = pg_catalog, vendedor, plataforma, pg_temp/);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toContain("plataforma.uuid_de_chave(p_tenant::text || ':vendedor.forma_pagamento:AVISTA')");
    expect(sql).toContain("plataforma.uuid_de_chave(p_tenant::text || ':vendedor.prazo_pagamento:AVISTA')");
    expect(sql).toContain("'AVISTA', 'À vista', true, 0");
    expect(sql).toContain("'AVISTA', 'À vista', '{0}', 0, true, 0");
    expect(sql).toContain('where not exists (select 1 from vendedor.forma_pagamento f where f.tenant_id = p_tenant)');
    expect(sql).toContain('revoke all on function vendedor.semear_pagamento(uuid) from public;');
    expect(sql).toContain('revoke all on function vendedor.semear_tenant_pagamento() from public;');
    expect(sql).toMatch(/create trigger tenant_semear_pagamento after insert on plataforma\.tenant\s+for each row execute function vendedor\.semear_tenant_pagamento\(\);/);
    expect(sql.trim().endsWith('select vendedor.semear_pagamento(t.id) from plataforma.tenant t;')).toBe(true);
    // o provisionar_tenant não muda: o tenant novo nasce com a forma pelo gatilho
    expect(sql).not.toMatch(/provisionar_tenant/);
  });

  it('Hub v1 (R-20261106-203005): os 7 CHECKs de entidade e o do Conector com as 15 do banco = contrato; padrão do Conector segue as 8; down volta às 12', () => {
    // 0056 (T-0149): o banco ganhou `filial` (ENTIDADES_BANCO, 16 = contrato); a 0037 continua com as 15 (ENTIDADES_0037)
    expect([...nuvemIntegracao.ENTIDADES_BANCO].sort()).toEqual([...ENTIDADES].sort());
    const banco = [...nuvemIntegracao.ENTIDADES_0037];
    expect(banco.slice(-3)).toEqual(['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada']);
    const lista = (trecho: string | undefined) => [...(trecho ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    for (const [texto, esperado] of [[sql, banco], [down, [...nuvemIntegracao.ENTIDADES_0013]]] as const) {
      for (const t of ['sessao_carga', 'lote', 'registro_atual', 'pendencia_inativacao', 'inativacao_auditoria', 'cursor_entidade', 'reconciliacao']) {
        const m = new RegExp(`alter table integracao\\.${t} add constraint ${t}_entidade_valida check \\(entidade in \\(([^)]*)\\)\\);`).exec(texto);
        expect(lista(m?.[1]), t).toEqual(esperado);
      }
      const c = /add constraint conector_entidades_validas check \(cardinality\(entidades\) >= 1 and entidades <@ array\[([^\]]*)\]::text\[\] and integracao\.sem_repeticao\(entidades\)\);/.exec(texto);
      expect(lista(c?.[1])).toEqual(esperado);
    }
    // o padrão de conector.entidades não muda (SQL da 0010 e Drizzle = as 8 originais)
    expect(sql).not.toMatch(/alter column entidades/);
    const padrao = getTableConfig(nuvemIntegracao.conector).columns.find((c) => c.name === 'entidades')!.default;
    expect(padrao).toEqual([...nuvemIntegracao.ENTIDADES_ORIGINAIS]);
    // down: apaga o que o Hub recebeu das 3 antes de restringir o CHECK (sem isso o add constraint falha com 23514)
    const pos = (s: string) => down.indexOf(s);
    expect(pos("delete from integracao.lote where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');")).toBeGreaterThan(-1);
    expect(pos('delete from integracao.pendencia_inativacao')).toBeLessThan(pos('delete from integracao.sessao_carga where'));
    expect(pos('delete from integracao.inativacao_auditoria')).toBeLessThan(pos('delete from integracao.pendencia_inativacao'));
    expect(pos('delete from integracao.registro_atual')).toBeLessThan(pos('alter table integracao.registro_atual add constraint'));
    expect(pos('update integracao.conector set entidades = array[')).toBeLessThan(pos('alter table integracao.conector add constraint'));
  });

  it('faixa: a sigla da medida é a do Hub (SIGLA_MEDIDA_FORMATO, 1 a 4 maiúsculas; vazio = ausente = unidade base = NULO)', () => {
    expect(SIGLA_MEDIDA_FORMATO.source).toBe('^[A-Z]{1,4}$');
    expect(sql).toContain(`constraint tabela_escalonada_medida_formato check (medida is null or medida ~ '${SIGLA_MEDIDA_FORMATO.source}')`);
  });

  it('down desfaz tudo o que o up cria, na ordem (gatilho, pedido, tabelas, cliente, funções), idempotente', () => {
    const criadas = [...sql.matchAll(/create table ([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]!);
    for (const t of criadas) expect(down).toContain(`drop table if exists ${t};`);
    for (const m of sql.matchAll(/alter table ([a-z_]+\.[a-z_]+) add column ([a-z_]+)/g)) expect(down).toContain(`alter table ${m[1]} drop column if exists ${m[2]};`);
    for (const m of sql.matchAll(/alter table ([a-z_]+\.[a-z_]+) add constraint ([a-z_]+)/g)) expect(down).toContain(`alter table ${m[1]} drop constraint if exists ${m[2]};`);
    for (const m of sql.matchAll(/create function ([a-z_]+\.[a-z_]+)\(([^)]*)\)/g)) {
      const tipos = m[2]!.split(',').map((x) => x.trim().split(' ').slice(1).join(' ')).filter(Boolean).join(', ');
      expect(down).toContain(`drop function if exists ${m[1]}(${tipos});`);
    }
    expect(down).toContain('drop trigger if exists tenant_semear_pagamento on plataforma.tenant;');
    const pos = (s: string) => down.indexOf(s);
    expect(pos('drop trigger')).toBeLessThan(pos('alter table vendedor.pedido'));
    expect(pos('alter table vendedor.pedido drop column if exists forma_pagamento_id;')).toBeLessThan(pos('drop table if exists vendedor.forma_pagamento;'));
    expect(pos('drop table if exists vendedor.prazo_pagamento;')).toBeLessThan(pos('drop table if exists vendedor.forma_pagamento;'));
    expect(pos('drop table if exists catalogo.tabela_escalonada;')).toBeLessThan(pos('drop function if exists vendedor.parcelas_validas(integer[]);'));
    expect(pos('alter table core.cliente drop constraint if exists cliente_formas_pagamento_validas;')).toBeLessThan(pos('drop function if exists core.codigos_forma_validos(text[]);'));
    expect(down).not.toMatch(/create |insert /);
    // único update do down: tirar as 3 entidades do Hub da lista dos Conectores
    expect([...down.matchAll(/^update ([a-z_]+\.[a-z_]+)/gm)].map((m) => m[1])).toEqual(['integracao.conector', 'integracao.conector']);
  });

  it('espelho Drizzle: tabelas novas, colunas do pedido e do cliente (int[] e text[] nulos), preço da faixa em bigint e vigência em date', () => {
    const cfg = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t);
    const col = (t: Parameters<typeof getTableConfig>[0], nome: string) => cfg(t).columns.find((c) => c.name === nome)!;
    expect(cfg(nuvemVendedor.formaPagamento).name).toBe('forma_pagamento');
    expect(cfg(nuvemVendedor.prazoPagamento).name).toBe('prazo_pagamento');
    expect(cfg(nuvemCatalogo.tabelaEscalonada).name).toBe('tabela_escalonada');
    expect(col(nuvemVendedor.prazoPagamento, 'parcelas_dias').getSQLType()).toBe('integer[]');
    expect(col(nuvemVendedor.prazoPagamento, 'parcelas_dias').notNull).toBe(true);
    for (const c of COLUNAS_PEDIDO) {
      expect(col(nuvemVendedor.pedido, c).notNull, c).toBe(false);
      expect(col(nuvemVendedor.pedido, c).hasDefault, c).toBe(false);
    }
    expect(col(nuvemVendedor.pedido, 'prazo_parcelas_dias').getSQLType()).toBe('integer[]');
    expect(col(nuvemCore.cliente, 'prazo_medio_max_dias').getSQLType()).toBe('integer');
    expect(col(nuvemCore.cliente, 'formas_pagamento').getSQLType()).toBe('text[]');
    expect(col(nuvemCore.cliente, 'formas_pagamento').notNull).toBe(false);
    expect(col(nuvemCatalogo.tabelaEscalonada, 'preco_unidade_cents').getSQLType()).toBe('bigint');
    expect(col(nuvemCatalogo.tabelaEscalonada, 'vigencia_inicio').getSQLType()).toBe('date');
    expect(col(nuvemCatalogo.tabelaEscalonada, 'vigencia_fim').notNull).toBe(false);
    expect(col(nuvemCatalogo.tabelaEscalonada, 'medida').notNull).toBe(false);
    expect(col(nuvemCatalogo.tabelaEscalonada, 'tabela_preco_id').notNull).toBe(false);
  });

  it('aparelho: sem versão nova (a faixa viaja no JSON de ent_tabela_escalonada); a v4 (T-0085) só traz índices da lista por linha', () => {
    // até a v3 nada mudou por causa desta migração; a v4 é só de índices (produto_no e produto_relacao)
    expect(migracoesAparelho.map((m) => m.versao).slice(0, 3)).toEqual([1, 2, 3]);
    expect(migracoesAparelho.some((m) => m.sql.includes('tabela_escalonada'))).toBe(false);
  });

  it('fixture: forma semeada com id gêmeo do SQL; prazo médio = média arredondada para cima; códigos únicos no tenant; c1 de A com 45 e PIX/BOLETO', () => {
    expect(PA.semeada.forma).toBe(idDeChave(`${A.tenantId}:vendedor.forma_pagamento:AVISTA`));
    expect(PB.semeada.prazo).toBe(idDeChave(`${B.tenantId}:vendedor.prazo_pagamento:AVISTA`));
    const d = dadosDoisTenants(HASH);
    const parcelas = (s: unknown) => String(s).replace(/[{}]/g, '').split(',').map(Number);
    for (const z of d['vendedor.prazo_pagamento']) {
      const p = parcelas(z.parcelas_dias);
      expect(z.prazo_medio_dias, String(z.codigo)).toBe(Math.ceil(p.reduce((s, x) => s + x, 0) / p.length));
    }
    expect(d['vendedor.prazo_pagamento'].find((z) => z.id === PA.prazos.bol2856)).toMatchObject({ parcelas_dias: '{28,56}', prazo_medio_dias: 42, descricao: '28/56 dias' });
    for (const tabela of ['vendedor.forma_pagamento', 'vendedor.prazo_pagamento'] as const) {
      const chaves = d[tabela].map((l) => `${String(l.tenant_id)}|${String(l.codigo)}`);
      expect(new Set(chaves).size, tabela).toBe(chaves.length);
      expect(d[tabela].some((l) => l.codigo === 'AVISTA'), `${tabela}: AVISTA é da semeadura`).toBe(false);
    }
    const c1 = d['core.cliente'].find((c) => c.id === A.clientes.c1)!;
    expect(c1).toMatchObject({ prazo_medio_max_dias: 45, formas_pagamento: '{"PIX","BOLETO"}' });
    expect(d['core.cliente'].find((c) => c.id === B.clientes.c1)).toMatchObject({ prazo_medio_max_dias: 30, formas_pagamento: null });
    expect(d['catalogo.tabela_escalonada'].map((f) => f.tenant_id === A.tenantId)).toEqual([true, true, true, false]);
  });
});

describe.skipIf(semBanco())('0037 formas, prazos e tabela escalonada (banco, papel de aplicação)', () => {
  let app: pg.Client;
  let admin: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await app.connect();
    await admin.connect();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  const prazo = (tenant: string, forma: string, cod: string, parcelas: string, medio: number) =>
    q('insert into vendedor.prazo_pagamento (tenant_id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias) values ($1, $2, $3, $3, $4::int[], $5)', [
      tenant, forma, cod, parcelas, medio,
    ]);

  it('fixture + semeadura: A vê AVISTA, PIX e BOLETO; B vê AVISTA e DINHEIRO; o prazo semeado é [0] com médio 0 e id gêmeo do TS', async () => {
    const formas = (tenant: string) =>
      emTransacao(app, tenant, () => q<{ id: string; codigo: string }>('select id, codigo from vendedor.forma_pagamento order by ordem, codigo').then((r) => r.rows));
    expect(await formas(A.tenantId)).toEqual([
      { id: PA.semeada.forma, codigo: 'AVISTA' },
      { id: PA.formas.pix, codigo: 'PIX' },
      { id: PA.formas.boleto, codigo: 'BOLETO' },
    ]);
    expect(await formas(B.tenantId)).toEqual([
      { id: PB.semeada.forma, codigo: 'AVISTA' },
      { id: PB.formas.dinheiro, codigo: 'DINHEIRO' },
    ]);
    const semeado = await emTransacao(app, B.tenantId, () =>
      q('select forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, external_id from vendedor.prazo_pagamento where id = $1', [PB.semeada.prazo]).then((r) => r.rows),
    );
    expect(semeado).toEqual([{ forma_pagamento_id: PB.semeada.forma, codigo: 'AVISTA', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, external_id: null }]);
  });

  it('tenant novo nasce com a forma padrão; semear de novo não duplica; tenant que apagou a forma não a recebe de volta', async () => {
    await emTransacao(admin, null, async () => {
      const t = (await admin.query<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t37-novo', 'Novo 37') returning id")).rows[0]!.id;
      const contar = async () =>
        (await admin.query<{ f: number; p: number }>(
          'select (select count(*)::int from vendedor.forma_pagamento where tenant_id = $1) as f, (select count(*)::int from vendedor.prazo_pagamento where tenant_id = $1) as p',
          [t],
        )).rows[0];
      expect(await contar()).toEqual({ f: 1, p: 1 });
      expect((await admin.query('select id from vendedor.forma_pagamento where tenant_id = $1', [t])).rows).toEqual([{ id: idDeChave(`${t}:vendedor.forma_pagamento:AVISTA`) }]);
      await admin.query('select vendedor.semear_pagamento($1)', [t]);
      expect(await contar()).toEqual({ f: 1, p: 1 });
      await admin.query('update vendedor.forma_pagamento set deleted_at = now() where tenant_id = $1', [t]);
      await admin.query('select vendedor.semear_pagamento($1)', [t]);
      expect(await contar()).toEqual({ f: 1, p: 1 });
      // o contexto do chamador volta ao que era (a semeadura liga o do tenant só durante a inserção)
      expect((await admin.query<{ c: string }>("select coalesce(current_setting('app.tenant_id', true), '') as c")).rows[0]!.c).toBe('');
    });
  });

  it('prazo: aceita [0], [28,56] médio 42, [30,45] médio 38 e parcelas iguais; o código é único no tenant (entre formas), não entre tenants', async () => {
    expect(await codigo(A.tenantId, async () => {
      await prazo(A.tenantId, PA.formas.pix, 'T37-AV', '{0}', 0);
      await prazo(A.tenantId, PA.formas.boleto, 'T37-2856', '{28,56}', 42);
      await prazo(A.tenantId, PA.formas.boleto, 'T37-3045', '{30,45}', 38);
      await prazo(A.tenantId, PA.formas.boleto, 'T37-3030', '{30,30}', 30);
    })).toBeUndefined();
    expect(await codigo(A.tenantId, () => prazo(A.tenantId, PA.formas.pix, 'BOL-28-56', '{0}', 0))).toBe('23505');
    expect(await codigo(B.tenantId, () => prazo(B.tenantId, PB.formas.dinheiro, 'BOL-28-56', '{28,56}', 42))).toBeUndefined();
    // apagado libera o código
    expect(await codigo(A.tenantId, async () => {
      await q('update vendedor.prazo_pagamento set deleted_at = now() where id = $1', [PA.prazos.bol2856]);
      await prazo(A.tenantId, PA.formas.boleto, 'BOL-28-56', '{28,56}', 42);
    })).toBeUndefined();
  });

  it.each([
    ['vazio', '{}', 0],
    ['25 parcelas', `{${Array.from({ length: 25 }, (_, i) => i + 1).join(',')}}`, 13],
    ['acima de 365', '{30,366}', 198],
    ['negativa', '{-1,30}', 15],
    ['decrescente', '{56,28}', 42],
    ['com nulo', '{28,NULL}', 28],
    ['2 dimensões', '{{28,56}}', 42],
  ])('CHECK prazo_pagamento_parcelas_validas recusa %s', async (_rotulo, parcelas, medio) => {
    const e = await erroDe(emTransacao(app, A.tenantId, () => prazo(A.tenantId, PA.formas.boleto, 'T37-X', parcelas, medio)));
    expect(e).toMatchObject({ code: '23514', message: expect.stringContaining('prazo_pagamento_') });
  });

  it.each([
    ['abaixo da menor parcela', '{28,56}', 27],
    ['acima da maior parcela', '{28,56}', 57],
    ['à vista com médio 1', '{0}', 1],
  ])('CHECK prazo_pagamento_prazo_medio_coerente recusa %s', async (_rotulo, parcelas, medio) => {
    const e = await erroDe(emTransacao(app, A.tenantId, () => prazo(A.tenantId, PA.formas.boleto, 'T37-Y', parcelas, medio)));
    expect(e).toMatchObject({ code: '23514', message: expect.stringContaining('prazo_pagamento_prazo_medio_coerente') });
  });

  it('forma: código único vivo no tenant (23505), 1..20 caracteres; prazo com forma de outro tenant = 23503 (FK composta)', async () => {
    expect(await codigo(A.tenantId, () => q("insert into vendedor.forma_pagamento (tenant_id, codigo, nome) values ($1, 'PIX', 'Pix 2')", [A.tenantId]))).toBe('23505');
    expect(await codigo(B.tenantId, () => q("insert into vendedor.forma_pagamento (tenant_id, codigo, nome) values ($1, 'PIX', 'Pix')", [B.tenantId]))).toBeUndefined();
    expect(await codigo(A.tenantId, () => q("insert into vendedor.forma_pagamento (tenant_id, codigo, nome) values ($1, $2, 'X')", [A.tenantId, 'X'.repeat(21)]))).toBe('23514');
    expect(await codigo(A.tenantId, () => q("insert into vendedor.forma_pagamento (tenant_id, codigo, nome) values ($1, '  ', 'X')", [A.tenantId]))).toBe('23514');
    expect(await codigo(A.tenantId, () => prazo(A.tenantId, PB.formas.dinheiro, 'T37-Z', '{0}', 0))).toBe('23503');
  });

  it('pedido: as 8 colunas do pagamento juntas (23514 sem uma), prazo de outro tenant 23503; pedido antigo segue nulo', async () => {
    const completo: Record<(typeof COLUNAS_PEDIDO)[number], unknown> = {
      forma_pagamento_id: PA.formas.boleto, prazo_pagamento_id: PA.prazos.bol2856, forma_pagamento_codigo: 'BOLETO', forma_pagamento_nome: 'Boleto',
      prazo_codigo: 'BOL-28-56', prazo_descricao: '28/56 dias', prazo_parcelas_dias: [28, 56], prazo_medio_dias: 42,
    };
    const gravar = (troca: Partial<typeof completo> = {}) => {
      const v = { ...completo, ...troca };
      return q(`update vendedor.pedido set ${COLUNAS_PEDIDO.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [A.pedidos.p1, ...COLUNAS_PEDIDO.map((c) => v[c])]);
    };
    expect(await codigo(A.tenantId, async () => {
      expect((await gravar()).rowCount).toBe(1);
    })).toBeUndefined();
    expect(await codigo(A.tenantId, () => gravar({ prazo_codigo: null }))).toBe('23514');
    expect(await codigo(A.tenantId, () => gravar({ prazo_medio_dias: 60 }))).toBe('23514');
    expect(await codigo(A.tenantId, () => gravar({ prazo_parcelas_dias: [56, 28] }))).toBe('23514');
    expect(await codigo(A.tenantId, () => gravar({ prazo_pagamento_id: PB.prazos.dinAvista }))).toBe('23503');
    const antigo = await emTransacao(app, A.tenantId, () =>
      q(`select ${COLUNAS_PEDIDO.join(', ')} from vendedor.pedido where id = $1`, [A.pedidos.p2]).then((r) => r.rows[0]),
    );
    expect(Object.values(antigo!).every((v) => v === null)).toBe(true);
  });

  it('cliente: prazo médio 0..365 e códigos de forma (até 20, 1..20 caracteres, sem repetir; vazio aceito = todas)', async () => {
    const gravar = (prazoMax: number | null, formas: string[] | null) =>
      q('update core.cliente set prazo_medio_max_dias = $2, formas_pagamento = $3::text[] where id = $1', [A.clientes.c2, prazoMax, formas]);
    expect(await codigo(A.tenantId, async () => {
      await gravar(0, []);
      await gravar(365, Array.from({ length: 20 }, (_, i) => `F${i}`));
      await gravar(null, null);
    })).toBeUndefined();
    for (const [p, f] of [[366, null], [-1, null], [45, ['PIX', 'PIX']], [45, ['']], [45, ['X'.repeat(21)]], [45, Array.from({ length: 21 }, (_, i) => `F${i}`)]] as const) {
      expect(await codigo(A.tenantId, () => gravar(p, f as string[] | null)), JSON.stringify([p, f])).toBe('23514');
    }
  });

  it('faixa: medida em sigla, quantidade e preço > 0, vigência fechada (fim = início aceito), única com medida e tabela nulas; tabela de outro tenant = 23503', async () => {
    const faixa = (medida: string | null, qtd: number, preco: number, inicio: string, fim: string | null, tabela: string | null) =>
      q(
        'insert into catalogo.tabela_escalonada (tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio, vigencia_fim, tabela_preco_id) values ($1, $2, $3, $4, $5, $6, $7, $8)',
        [A.tenantId, A.produtos.p2, medida, qtd, preco, inicio, fim, tabela],
      );
    expect(await codigo(A.tenantId, async () => {
      await faixa(null, 10, 45_000, '2026-01-01', '2026-01-01', null);
      await faixa('CX', 10, 44_000, '2026-01-01', null, A.tabelasPreco.padrao);
      await faixa(null, 10, 44_000, '2026-01-01', null, A.tabelasPreco.padrao);
    })).toBeUndefined();
    expect(await codigo(A.tenantId, async () => {
      await faixa(null, 10, 45_000, '2026-01-01', null, null);
      await faixa(null, 10, 44_000, '2026-01-01', null, null);
    })).toBe('23505');
    for (const args of [['cx', 10, 1, '2026-01-01', null], ['CAIXA', 10, 1, '2026-01-01', null], [null, 0, 1, '2026-01-01', null], [null, 10, 0, '2026-01-01', null], [null, 10, 1, '2026-01-02', '2026-01-01']] as const) {
      expect(await codigo(A.tenantId, () => faixa(args[0], args[1], args[2], args[3], args[4], null)), JSON.stringify(args)).toBe('23514');
    }
    expect(await codigo(A.tenantId, () => faixa(null, 10, 1, '2026-01-01', null, B.tabelasPreco.padrao))).toBe('23503');
  });

  it('faixas vigentes do produto pelo índice único (tenant + produto_id = any): EXPLAIN usa tabela_escalonada_faixa_uk', async () => {
    const plano = await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const r = await q<{ 'QUERY PLAN': string }>(
        `explain select medida, quantidade_minima, preco_unidade_cents, tabela_preco_id from catalogo.tabela_escalonada
          where tenant_id = $1 and produto_id = any($2::uuid[]) and deleted_at is null and ativo
            and vigencia_inicio <= $3::date and (vigencia_fim is null or vigencia_fim >= $3::date)
            and (tabela_preco_id is null or tabela_preco_id = $4)`,
        [A.tenantId, [A.produtos.p1, A.produtos.p2], '2026-11-06', A.tabelasPreco.padrao],
      );
      return r.rows.map((x) => x['QUERY PLAN']).join('\n');
    });
    expect(plano).toContain('tabela_escalonada_faixa_uk');
  });

  it('vazamento entre tenants: B não lê nem muda formas, prazos e faixas de A; A não insere em B (42501)', async () => {
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select 1 from vendedor.forma_pagamento where id = any($1::uuid[])', [[PA.formas.pix, PA.semeada.forma]])).rowCount).toBe(0);
      expect((await q('select 1 from vendedor.prazo_pagamento where id = $1', [PA.prazos.bol2856])).rowCount).toBe(0);
      expect((await q('select 1 from catalogo.tabela_escalonada where id = $1', [PA.faixas.un10])).rowCount).toBe(0);
      expect((await q("update vendedor.forma_pagamento set nome = 'x' where id = $1", [PA.formas.pix])).rowCount).toBe(0);
      expect((await q('update catalogo.tabela_escalonada set ativo = false where id = $1', [PA.faixas.un10])).rowCount).toBe(0);
    });
    expect(await codigo(A.tenantId, () => q("insert into vendedor.forma_pagamento (tenant_id, codigo, nome) values ($1, 'T37', 'X')", [B.tenantId]))).toBe('42501');
    expect(await codigo(A.tenantId, () => q("insert into catalogo.tabela_escalonada (tenant_id, produto_id, quantidade_minima, preco_unidade_cents, vigencia_inicio) values ($1, gen_random_uuid(), 1, 1, '2026-01-01')", [B.tenantId]))).toBe('42501');
  });

  it('Hub v1 (R-20261106-203005): lote, staging, registro_atual e cursor de forma_pagamento, prazo_pagamento e tabela_escalonada gravam; Conector aceita as 15; outra entidade = 23514', async () => {
    const IA = A.integracao;
    const hex = (c: string) => c.repeat(64);
    const NOVAS = ['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'] as const;
    await emTransacao(app, A.tenantId, async () => {
      for (const [i, entidade] of NOVAS.entries()) {
        const lote = await q<{ id: string }>(
          `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas)
           values ($1, $2, $3, 'delta', 'v1', $4, $5, 1) returning id`,
          [A.tenantId, IA.conector, entidade, hex(String(i + 1)), hex('b')],
        );
        const loteId = lote.rows[0]!.id;
        await q("insert into integracao.lote_staging (tenant_id, lote_id, corpo) values ($1, $2, '{\"registros\": []}'::jsonb)", [A.tenantId, loteId]);
        await q(
          `insert into integracao.registro_atual (tenant_id, entidade, external_id, conector_id, hash, payload, alterado_em, lote_id, visto_em)
           values ($1, $2, $3, $4, $5, '{}'::jsonb, now(), $6, now())`,
          [A.tenantId, entidade, `ERP-${entidade}`, IA.conector, hex('c'), loteId],
        );
        await q(
          `insert into integracao.cursor_entidade (tenant_id, conector_id, entidade, cursor_alterado_em, cursor_external_id) values ($1, $2, $3, now(), $4)`,
          [A.tenantId, IA.conector, entidade, `ERP-${entidade}`],
        );
      }
      const gravados = await q<{ entidade: string }>("select entidade from integracao.registro_atual where external_id like 'ERP-%' order by entidade");
      expect(gravados.rows.map((r) => r.entidade)).toEqual([...NOVAS]);
      const conector = await q<{ entidades: string[] }>('update integracao.conector set entidades = $2::text[] where id = $1 returning entidades', [
        IA.conector, [...nuvemIntegracao.ENTIDADES_BANCO],
      ]);
      expect(conector.rows[0]!.entidades).toEqual([...nuvemIntegracao.ENTIDADES_BANCO]);
      await q('savepoint s');
      const e = await erroDe(
        q(`insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas)
           values ($1, $2, 'condicao_pagamento', 'delta', 'v1', $3, $4, 1)`, [A.tenantId, IA.conector, hex('9'), hex('b')]),
      );
      expect(e?.code).toBe('23514');
      await q('rollback to savepoint s');
    });
  });
});

describe.skipIf(semBanco())('0037 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000037';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0037_forma_prazo_escalonada') - 1]!.slice(0, 4);
  const desde0037 = nomes.filter((n) => n >= '0037');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill semeia a forma padrão no tenant que já existia; down volta ao catálogo da 0036; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo37', 'Antigo')", [T]);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0037);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col vendedor.prazo_pagamento.parcelas_dias integer[] nn=true');
      expect(depois).toContain('col core.cliente.formas_pagamento text[] nn=false');
      expect(depois).toContain('trg plataforma.tenant.tenant_semear_pagamento');
      const semeado = await c.query(
        'select f.id as forma, f.codigo, p.id as prazo, p.parcelas_dias, p.prazo_medio_dias from vendedor.forma_pagamento f join vendedor.prazo_pagamento p on p.forma_pagamento_id = f.id where f.tenant_id = $1',
        [T],
      );
      expect(semeado.rows).toEqual([
        { forma: idDeChave(`${T}:vendedor.forma_pagamento:AVISTA`), codigo: 'AVISTA', prazo: idDeChave(`${T}:vendedor.prazo_pagamento:AVISTA`), parcelas_dias: [0], prazo_medio_dias: 0 },
      ]);
      expect((await migrarDown(c, { passos: desde0037.length })).aplicadas).toEqual([...desde0037].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m37.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
