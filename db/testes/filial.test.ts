/**
 * 0056 — filial (T-0149, RN-CORE-39, ADR 0040; desenho docs/desenho/T-0149.md §3; pedidos R-20261110-064112-engenheiro-software
 * e R-20261110-074414-modulo-integracao). O que o BANCO garante:
 * - core.filial com colunas comuns, RLS, códigos/nome/cidade/UF validados, UMA padrão viva por tenant, a padrão sempre ativa e viva;
 * - a filial padrão '0001' nasce com o tenant (gatilho tenant_semear_filial; vale para o provisionar_tenant) e foi semeada nos
 *   tenants que já existiam, com id idFilialPadrao;
 * - core.cliente.filial_id NUNCA nula (FK composta) e nula na escrita vira a padrão (gatilho), inclusive no UPDATE;
 * - catalogo.deposito.filial_id e catalogo.tabela_preco_item.filial_id NOT NULL (nula vira a padrão), SEM FK para o Core;
 *   o único vivo do item inclui a filial; a faixa (tabela_escalonada) tem filial nula = todas e a filial entra no único;
 * - vendedor.pedido.filial_id + retrato filial (objeto, coerente com o id);
 * - o Hub aceita a entidade `filial` (16 = ENTIDADES_BANCO = contrato).
 * Banco: papel de APLICAÇÃO sobre a fixture dois-tenants (ROLLBACK); up/down com dados num banco efêmero (CI).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTIDADES } from '../../modules/integracao/contracts';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { DOIS_TENANTS, FILIAIS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { idFilialPadrao } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m56 = migracoes.find((m) => m.versao === '0056')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m56.up);
const down = semComentarios(m56.down);

describe('0056 filial (estático)', () => {
  it('nome e posição: 0056_core_filial logo depois da 0055', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0055_vendedor_endereco_editado') + 1]).toBe('0056_core_filial');
  });

  it('core.filial: única padrão viva, padrão ativa e viva, código único vivo, UF com 2 letras', () => {
    expect(up).toContain('create unique index filial_padrao_uk on core.filial (tenant_id) where padrao and deleted_at is null;');
    expect(up).toContain('constraint filial_padrao_ativa check (not padrao or (ativo and deleted_at is null))');
    expect(up).toContain('create unique index filial_codigo_uk on core.filial (tenant_id, codigo) where deleted_at is null;');
    expect(up).toContain("constraint filial_uf_formato check (uf is null or uf ~ '^[A-Z]{2}$')");
  });

  it('semeadura: gatilho em plataforma.tenant + backfill; o provisionar_tenant não muda', () => {
    expect(up).toContain("plataforma.uuid_de_chave(p_tenant::text || ':core.filial:padrao'), p_tenant, '0001', 'Filial padrão', true, true");
    expect(up).toMatch(/create trigger tenant_semear_filial after insert on plataforma\.tenant\s+for each row execute function core\.semear_tenant_filial\(\);/);
    expect(up).toContain('select core.semear_filial(t.id) from plataforma.tenant t;');
    expect(up).not.toMatch(/provisionar_tenant/);
  });

  it('backfill antes do NOT NULL; gatilho de padrão em cliente, depósito e item de preço; catálogo sem FK para o Core', () => {
    for (const t of ['core.cliente', 'catalogo.deposito', 'catalogo.tabela_preco_item']) {
      const add = up.indexOf(`alter table ${t} add column filial_id uuid;`);
      const nn = up.indexOf(`alter table ${t} alter column filial_id set not null;`);
      expect(add, t).toBeGreaterThan(-1);
      expect(nn, t).toBeGreaterThan(add);
      expect(up.slice(add, nn), t).toMatch(/update [a-z_.]+ [a-z]\s+set filial_id = f\.id/);
      expect(up).toMatch(new RegExp(`before insert or update of filial_id on ${t.replace('.', '\\.')}\\s+for each row execute function core\\.preencher_filial_padrao\\(\\);`));
    }
    expect(up).toContain('alter table core.cliente add constraint cliente_filial_fk foreign key (tenant_id, filial_id) references core.filial (tenant_id, id);');
    expect(up).not.toMatch(/alter table catalogo\.[a-z_]+ add constraint [a-z_]+ foreign key/);
    expect(up).not.toMatch(/alter table vendedor\.[a-z_]+ add constraint [a-z_]+ foreign key/);
  });

  it('único vivo do item inclui a filial (e a unidade); faixa com filial no único', () => {
    expect(up).toContain('drop index catalogo.tabela_preco_item_unidade_vigencia_uk;');
    expect(up).toMatch(/create unique index tabela_preco_item_filial_vigencia_uk on catalogo\.tabela_preco_item\s+\(tenant_id, tabela_preco_id, filial_id, produto_id, unidade, vigencia_inicio\) nulls not distinct where deleted_at is null;/);
    expect(up).toContain('create index tabela_preco_item_filial_ix on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, filial_id);');
    expect(up).toMatch(/create unique index tabela_escalonada_faixa_uk on catalogo\.tabela_escalonada\s+\(tenant_id, produto_id, medida, quantidade_minima, tabela_preco_id, filial_id, vigencia_inicio\) nulls not distinct where deleted_at is null;/);
  });

  it('Hub: os 7 CHECKs de entidade e o do Conector com as 16 (ENTIDADES_BANCO = contrato); down volta às 15', () => {
    expect([...nuvemIntegracao.ENTIDADES_BANCO].sort()).toEqual([...ENTIDADES].sort());
    expect(nuvemIntegracao.ENTIDADES_BANCO.at(-1)).toBe('filial');
    const lista = (trecho: string | undefined) => [...(trecho ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    for (const [texto, esperado] of [[up, [...nuvemIntegracao.ENTIDADES_BANCO]], [down, [...nuvemIntegracao.ENTIDADES_0037]]] as const) {
      for (const t of ['sessao_carga', 'lote', 'registro_atual', 'pendencia_inativacao', 'inativacao_auditoria', 'cursor_entidade', 'reconciliacao']) {
        const m = new RegExp(`alter table integracao\\.${t} add constraint ${t}_entidade_valida check \\(entidade in \\(([^)]*)\\)\\);`).exec(texto);
        expect(lista(m?.[1]), t).toEqual(esperado);
      }
      const c = /add constraint conector_entidades_validas check \(cardinality\(entidades\) >= 1 and entidades <@ array\[([^\]]*)\]::text\[\] and integracao\.sem_repeticao\(entidades\)\);/.exec(texto);
      expect(lista(c?.[1])).toEqual(esperado);
    }
    expect(down.indexOf("delete from integracao.registro_atual where entidade = 'filial';")).toBeLessThan(down.indexOf('alter table integracao.registro_atual add constraint'));
  });

  it('down: apaga faixas e itens de filial não padrão ANTES de recriar os únicos antigos; tabela por último', () => {
    expect(down.indexOf('update catalogo.tabela_preco_item i set deleted_at = now()')).toBeLessThan(down.indexOf('create unique index tabela_preco_item_unidade_vigencia_uk'));
    expect(down).toContain("if to_regclass('core.filial') is not null then"); // down idempotente (rodar 2x não acha a tabela)
    expect(down.indexOf('update catalogo.tabela_escalonada t set deleted_at = now()')).toBeLessThan(down.indexOf('create unique index tabela_escalonada_faixa_uk'));
    expect(down.trim().endsWith('drop table if exists core.filial;')).toBe(true);
  });

  it('espelho Drizzle: filial; filial_id NOT NULL no cliente, depósito e item; nula na faixa e no pedido; retrato jsonb', () => {
    const col = (t: Parameters<typeof getTableConfig>[0], nome: string) => {
      const c = getTableConfig(t).columns.find((x) => x.name === nome);
      return [c?.getSQLType(), c?.notNull];
    };
    expect(getTableConfig(nuvemCore.filial).columns.map((c) => c.name).sort()).toEqual(
      ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id', 'codigo', 'nome', 'cidade', 'uf', 'padrao', 'ativo',
        // 0059 (T-0159): dados fiscais (filial-dados-fiscais.test.ts)
        'cnpj', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'telefone',
        // 0062 (T-0095): versão do ERP e desligamento pelo BKO
        'erp_alterado_em', 'desligado_no_bko_em'].sort(),
    );
    expect(col(nuvemCore.cliente, 'filial_id')).toEqual(['uuid', true]);
    expect(col(nuvemCatalogo.deposito, 'filial_id')).toEqual(['uuid', true]);
    expect(col(nuvemCatalogo.tabelaPrecoItem, 'filial_id')).toEqual(['uuid', true]);
    expect(col(nuvemCatalogo.tabelaEscalonada, 'filial_id')).toEqual(['uuid', false]);
    expect(col(nuvemVendedor.pedido, 'filial_id')).toEqual(['uuid', false]);
    expect(col(nuvemVendedor.pedido, 'filial')).toEqual(['jsonb', false]);
  });

  it('fixture: a padrão é a do gatilho (idFilialPadrao) e a 0002 de cada tenant está na lista', () => {
    expect(FILIAIS_FIXTURE.A.padrao).toBe(idFilialPadrao(A.tenantId));
    expect(FILIAIS_FIXTURE.B.padrao).toBe(idFilialPadrao(B.tenantId));
  });
});

describe.skipIf(semBanco())('0056 filial (banco, papel de aplicação)', () => {
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
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('cada tenant tem UMA padrão viva (a do gatilho, código 0001) e a 0002 da fixture; o app só vê as do próprio tenant', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q('select id, codigo, padrao, ativo from core.filial order by codigo');
      expect(r.rows).toEqual([
        { id: FILIAIS_FIXTURE.A.padrao, codigo: '0001', padrao: true, ativo: true },
        { id: FILIAIS_FIXTURE.A.boaVista, codigo: '0002', padrao: false, ativo: true },
      ]);
      expect((await q('select core.filial_padrao_id($1) as id', [A.tenantId])).rows[0]!.id).toBe(FILIAIS_FIXTURE.A.padrao);
      // RLS: a padrão de B não aparece nem pela função
      expect((await q('select core.filial_padrao_id($1) as id', [B.tenantId])).rows[0]!.id).toBeNull();
    });
  });

  it('cliente: nulo vira a padrão no INSERT e no UPDATE; outra filial do tenant vale; filial de outro tenant = 23503', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const novo = (await q("insert into core.cliente (tenant_id, razao_social) values ($1, 'Filial T56') returning id, filial_id", [A.tenantId])).rows[0]!;
      expect(novo.filial_id).toBe(FILIAIS_FIXTURE.A.padrao);
      await q('update core.cliente set filial_id = $2 where id = $1', [novo.id, FILIAIS_FIXTURE.A.boaVista]);
      const nulo = await q('update core.cliente set filial_id = null where id = $1 returning filial_id', [novo.id]);
      expect(nulo.rows[0]!.filial_id).toBe(FILIAIS_FIXTURE.A.padrao);
      await q('savepoint s');
      expect(await erroDe(q('update core.cliente set filial_id = $2 where id = $1', [novo.id, FILIAIS_FIXTURE.B.campinas]))).toMatchObject({ code: '23503' });
      await q('rollback to savepoint s');
    });
  });

  it('a padrão não é inativada nem apagada; segunda padrão viva = 23505; trocar a padrão em ordem passa', async () => {
    await emTransacao(app, A.tenantId, async () => {
      for (const sql of ['update core.filial set ativo = false where id = $1', 'update core.filial set deleted_at = now() where id = $1']) {
        await q('savepoint s');
        expect(await erroDe(q(sql, [FILIAIS_FIXTURE.A.padrao]))).toMatchObject({ code: '23514', message: expect.stringContaining('filial_padrao_ativa') });
        await q('rollback to savepoint s');
      }
      await q('savepoint s');
      expect(await erroDe(q('update core.filial set padrao = true where id = $1', [FILIAIS_FIXTURE.A.boaVista]))).toMatchObject({ code: '23505' });
      await q('rollback to savepoint s');
      await q('update core.filial set padrao = false where id = $1', [FILIAIS_FIXTURE.A.padrao]);
      await q('update core.filial set padrao = true where id = $1', [FILIAIS_FIXTURE.A.boaVista]);
      expect((await q('select core.filial_padrao_id($1) as id', [A.tenantId])).rows[0]!.id).toBe(FILIAIS_FIXTURE.A.boaVista);
      // a partir daqui, cliente sem filial cai na nova padrão
      const c = await q("insert into core.cliente (tenant_id, razao_social) values ($1, 'Nova padrão T56') returning filial_id", [A.tenantId]);
      expect(c.rows[0]!.filial_id).toBe(FILIAIS_FIXTURE.A.boaVista);
    });
  });

  it('código: único vivo, 1..20; UF ^[A-Z]{2}$; cidade nula só aceita (a obrigatoriedade é do domain)', async () => {
    const inserir = (codigo: string, uf: string | null) =>
      q("insert into core.filial (tenant_id, codigo, nome, cidade, uf) values ($1, $2, 'X', null, $3)", [A.tenantId, codigo, uf]);
    await emTransacao(app, A.tenantId, async () => {
      await inserir('0003', 'PA');
      for (const [codigo, uf, code] of [['0002', 'PA', '23505'], ['', 'PA', '23514'], ['x'.repeat(21), 'PA', '23514'], ['0004', 'pa', '23514']] as const) {
        await q('savepoint s');
        expect(await erroDe(inserir(codigo, uf)), `${codigo}/${uf}`).toMatchObject({ code });
        await q('rollback to savepoint s');
      }
    });
  });

  it('catálogo: depósito e item sem filial ficam na padrão; o mesmo item vivo em duas filiais convive; repetido na mesma = 23505', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const dep = await q("insert into catalogo.deposito (tenant_id, codigo, nome) values ($1, 'T56', 'Dep T56') returning filial_id", [A.tenantId]);
      expect(dep.rows[0]!.filial_id).toBe(FILIAIS_FIXTURE.A.padrao);
      const item = (filial: string | null) =>
        q('insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, filial_id) values ($1, $2, $3, 777, $4) returning filial_id', [
          A.tenantId, A.tabelasPreco.padrao, A.produtos.p2, filial,
        ]);
      // p2 já tem item na padrão (fixture, início fixo); estes têm início nulo
      expect((await item(null)).rows[0]!.filial_id).toBe(FILIAIS_FIXTURE.A.padrao);
      expect((await item(FILIAIS_FIXTURE.A.boaVista)).rows[0]!.filial_id).toBe(FILIAIS_FIXTURE.A.boaVista);
      await q('savepoint s');
      expect(await erroDe(item(FILIAIS_FIXTURE.A.boaVista))).toMatchObject({ code: '23505', message: expect.stringContaining('tabela_preco_item_filial_vigencia_uk') });
      await q('rollback to savepoint s');
    });
  });

  it('faixa: a da filial e a geral convivem na mesma chave; nula = todas', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const faixa = (filial: string | null) =>
        q("insert into catalogo.tabela_escalonada (tenant_id, produto_id, quantidade_minima, preco_unidade_cents, vigencia_inicio, filial_id) values ($1, $2, 99, 100, '2026-01-01', $3)", [
          A.tenantId, A.produtos.p2, filial,
        ]);
      await faixa(null);
      await faixa(FILIAIS_FIXTURE.A.boaVista);
      await q('savepoint s');
      expect(await erroDe(faixa(FILIAIS_FIXTURE.A.boaVista))).toMatchObject({ code: '23505' });
      await q('rollback to savepoint s');
    });
  });

  it('pedido: retrato objeto e coerente com filial_id; os dois nulos passam (pedido antigo)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const p = A.pedidos.p1;
      const retrato = { id: FILIAIS_FIXTURE.A.boaVista, codigo: '0002', nome: 'Filial Boa Vista', cidade: 'Boa Vista', uf: 'RR', external_id: 'FIL-BV', padrao: false };
      await q('update vendedor.pedido set filial_id = $2, filial = $3::jsonb where id = $1', [p, FILIAIS_FIXTURE.A.boaVista, JSON.stringify(retrato)]);
      for (const [fid, f, nome] of [
        [FILIAIS_FIXTURE.A.padrao, retrato, 'pedido_filial_coerente'],
        [FILIAIS_FIXTURE.A.boaVista, null, 'pedido_filial_coerente'],
        [null, retrato, 'pedido_filial_coerente'],
        [FILIAIS_FIXTURE.A.boaVista, ['x'], 'pedido_filial_(objeto|coerente)'],
      ] as const) {
        await q('savepoint s');
        expect(await erroDe(q('update vendedor.pedido set filial_id = $2, filial = $3::jsonb where id = $1', [p, fid, f === null ? null : JSON.stringify(f)]))).toMatchObject({
          code: '23514',
          message: expect.stringMatching(new RegExp(nome)),
        });
        await q('rollback to savepoint s');
      }
      await q('update vendedor.pedido set filial_id = null, filial = null where id = $1', [p]);
    });
  });

  it('Hub: lote e registro_atual de filial gravam; Conector aceita as 16', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const hex = (c: string) => c.repeat(64);
      const lote = await q(
        `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas)
         values ($1, $2, 'filial', 'delta', 'v1', $3, $4, 1) returning id`,
        [A.tenantId, A.integracao.conector, hex('5'), hex('6')],
      );
      await q(
        `insert into integracao.registro_atual (tenant_id, entidade, external_id, conector_id, hash, payload, alterado_em, lote_id, visto_em)
         values ($1, 'filial', 'FIL-X', $2, $3, '{}'::jsonb, now(), $4, now())`,
        [A.tenantId, A.integracao.conector, hex('7'), lote.rows[0]!.id],
      );
      const c = await q('update integracao.conector set entidades = $2::text[] where id = $1 returning entidades', [A.integracao.conector, [...nuvemIntegracao.ENTIDADES_BANCO]]);
      expect(c.rows[0]!.entidades).toEqual([...nuvemIntegracao.ENTIDADES_BANCO]);
    });
  });

  it('tenant novo (gatilho, como o provisionar_tenant) nasce com a padrão; cliente dele cai nela', async () => {
    await emTransacao(admin, null, async () => {
      const t = (await admin.query<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t56-novo', 'Novo T56') returning id")).rows[0]!.id;
      const f = await admin.query('select id, codigo, nome, cidade, uf, padrao, ativo from core.filial where tenant_id = $1', [t]);
      expect(f.rows).toEqual([{ id: idFilialPadrao(t), codigo: '0001', nome: 'Filial padrão', cidade: null, uf: null, padrao: true, ativo: true }]);
      await admin.query("select set_config('app.tenant_id', $1, true)", [t]);
      const c = await admin.query("insert into core.cliente (tenant_id, razao_social) values ($1, 'C') returning filial_id", [t]);
      expect(c.rows[0]!.filial_id).toBe(idFilialPadrao(t));
      // idempotente: semear de novo não cria outra
      await admin.query('select core.semear_filial($1)', [t]);
      expect((await admin.query('select count(*)::int as n from core.filial where tenant_id = $1', [t])).rows[0]!.n).toBe(1);
    });
  });

  it('pull do estoque por filial e "a tabela tem item nesta filial?" usam os índices novos', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const plano = async (sql: string) => (await q(`explain ${sql}`)).rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
      expect(await plano(`select id from catalogo.deposito where tenant_id = '${A.tenantId}' and filial_id = '${FILIAIS_FIXTURE.A.boaVista}'`)).toContain('deposito_filial_ix');
      expect(
        await plano(`select 1 from catalogo.tabela_preco_item where tenant_id = '${A.tenantId}' and tabela_preco_id = '${A.tabelasPreco.padrao}' and filial_id = '${FILIAIS_FIXTURE.A.boaVista}' and deleted_at is null limit 1`),
      ).toMatch(/tabela_preco_item_filial_(ix|vigencia_uk)/);
      expect(await plano(`select id from core.cliente where tenant_id = '${A.tenantId}' and filial_id = '${FILIAIS_FIXTURE.A.boaVista}'`)).toContain('cliente_filial_ix');
    });
  });
});

describe.skipIf(semBanco())('0056 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000056';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('backfill: tenant, cliente, depósito e item que já existiam ficam na padrão; down volta ao catálogo da 0055; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0055' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo56', 'Antigo')", [T]);
      await c.query("insert into core.cliente (id, tenant_id, razao_social) values ('cccccccc-0004-4000-8000-000000000056', $1, 'C')", [T]);
      await c.query("insert into catalogo.deposito (id, tenant_id, codigo, nome) values ('cccccccc-004b-4000-8000-000000000056', $1, 'D', 'D')", [T]);
      await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ('cccccccc-0040-4000-8000-000000000056', $1, 'T', 'T')", [T]);
      await c.query(
        "insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents) values ($1, 'cccccccc-0040-4000-8000-000000000056', 'cccccccc-0003-4000-8000-000000000056', 10)",
        [T],
      );
      expect((await migrarUp(c, { ate: '0056' })).aplicadas).toEqual(['0056_core_filial']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col core.cliente.filial_id uuid nn=true');
      expect(depois).toContain('col catalogo.tabela_escalonada.filial_id uuid nn=false');
      const padrao = idFilialPadrao(T);
      for (const t of ['core.cliente', 'catalogo.deposito', 'catalogo.tabela_preco_item']) {
        expect((await c.query(`select distinct filial_id from ${t} where tenant_id = $1`, [T])).rows, t).toEqual([{ filial_id: padrao }]);
      }
      // item de outra filial: o down o apaga logicamente antes de recriar o único sem a filial
      await c.query("insert into core.filial (id, tenant_id, codigo, nome) values ('cccccccc-000a-4000-8000-000000000056', $1, '0002', 'Outra')", [T]);
      await c.query(
        "insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, filial_id) values ($1, 'cccccccc-0040-4000-8000-000000000056', 'cccccccc-0003-4000-8000-000000000056', 11, 'cccccccc-000a-4000-8000-000000000056')",
        [T],
      );
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0056_core_filial']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select preco_cents from catalogo.tabela_preco_item where tenant_id = $1 and deleted_at is null', [T])).rows).toEqual([{ preco_cents: '10' }]);
      await c.query(m56.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0056' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
