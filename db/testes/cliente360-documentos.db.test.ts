/**
 * 0090 — Cliente 360 v2 (T-0186; spec §5, §7, §8 e §9, D2–D5). Dicionário: docs/banco/core.md, "0090".
 * - core.nota_erp: forma_pagamento (1..120) e a NF original da devolução (nf_origem_numero 1..40/serie 1..10: só em devolução; série só
 *   com número); índices da consulta online por período e das devoluções de uma NF;
 * - core.titulo: forma_pagamento, nf_numero e nf_serie (série só com número) e o índice que junta parcelas e NF;
 * - core.documento_tipo, documento_cliente, documento_permissao e documento_excecao: campos comuns, RLS forçado,
 *   isolamento_tenant, manutencao e leitura (0078); macuxi_app com select, insert e update (sem delete); só online (P15):
 *   fora do sync, sem índice (tenant_id, updated_at, id).
 * Estático sempre; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero.
 * Instantes: todos fixos e passados como parâmetro; nenhum relógio real no arquivo.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOCUMENTOS_FIXTURE, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { idPerfilFabrica } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m90 = migracoes.find((m) => m.nome === 'core_cliente360_documentos')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const umaLinha = semComentarios(m90.up).replace(/\s+/g, ' ');
const down = semComentarios(m90.down).replace(/\s+/g, ' ');
const TABELAS = ['core.documento_tipo', 'core.documento_cliente', 'core.documento_permissao', 'core.documento_excecao'] as const;
/** Instante do teste (fixo; sempre passado como parâmetro). */
const T0 = '2026-11-19T12:00:00Z'; // hora-fixa-ok: instante do teste, sempre passado como parâmetro
const lista = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
const bloco = (t: string) => new RegExp(`create table ${t.replace('.', '\\.')} \\(([^;]*)\\);`).exec(umaLinha)?.[1] ?? '';

describe('0090 Cliente 360 v2 (estático)', () => {
  it('número e nome: a 0090 vem logo depois da 0089 (rastreamento)', () => {
    expect(m90.versao).toBe('0090');
    expect(migracoes[migracoes.indexOf(m90) - 1]!.versao).toBe('0089');
  });

  it('nota_erp e titulo: 6 colunas nulas sem default, CHECKs e 3 índices parciais', () => {
    for (const [t, cols] of [
      ['core.nota_erp', ['forma_pagamento', 'nf_origem_numero', 'nf_origem_serie']],
      ['core.titulo', ['forma_pagamento', 'nf_numero', 'nf_serie']],
    ] as const) {
      for (const c of cols) expect(umaLinha).toContain(`alter table ${t} add column ${c} text;`);
    }
    for (const c of [
      "add constraint nota_erp_forma_pagamento_tamanho check (forma_pagamento is null or (btrim(forma_pagamento) <> '' and char_length(forma_pagamento) <= 120));",
      "add constraint nota_erp_nf_origem_so_devolucao check (nf_origem_numero is null or tipo = 'devolucao');",
      'add constraint nota_erp_nf_origem_serie_com_numero check (nf_origem_serie is null or nf_origem_numero is not null);',
      "add constraint nota_erp_nf_origem_tamanho check ((nf_origem_numero is null or (btrim(nf_origem_numero) <> '' and char_length(nf_origem_numero) <= 40)) and (nf_origem_serie is null or (btrim(nf_origem_serie) <> '' and char_length(nf_origem_serie) <= 10)));",
      "add constraint titulo_forma_pagamento_tamanho check (forma_pagamento is null or (btrim(forma_pagamento) <> '' and char_length(forma_pagamento) <= 120));",
      'add constraint titulo_nf_serie_com_numero check (nf_serie is null or nf_numero is not null);',
      "add constraint titulo_nf_tamanho check ((nf_numero is null or (btrim(nf_numero) <> '' and char_length(nf_numero) <= 40)) and (nf_serie is null or (btrim(nf_serie) <> '' and char_length(nf_serie) <= 10)));",
      'create index nota_erp_cliente_emitida_ix on core.nota_erp (tenant_id, cliente_id, emitida_em desc, id desc) where deleted_at is null;',
      'create index nota_erp_nf_origem_ix on core.nota_erp (tenant_id, cliente_id, nf_origem_numero, nf_origem_serie) where nf_origem_numero is not null and deleted_at is null;',
      'create index titulo_nf_ix on core.titulo (tenant_id, cliente_id, nf_numero, nf_serie) where nf_numero is not null and deleted_at is null;',
    ]) expect(umaLinha).toContain(c);
    expect(umaLinha).not.toMatch(/update core\.(nota_erp|titulo) /);
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain('core.nota_erp');
  });

  it('4 tabelas: campos comuns, FKs compostas, CHECKs, únicos vivos, só online (fora do sync), gatilho, RLS forçado e políticas', () => {
    expect(bloco('core.documento_tipo')).toContain("constraint documento_tipo_nome_tamanho check (btrim(nome) <> '' and char_length(nome) <= 80)");
    expect(bloco('core.documento_tipo')).toContain("constraint documento_tipo_grupo_tamanho check (btrim(grupo) <> '' and char_length(grupo) <= 60)");
    expect(lista(/documento_tipo_origem_valida check \(origem in \(([^)]*)\)\)/.exec(umaLinha)?.[1] ?? '')).toEqual([...nuvemCore.ORIGENS_DOCUMENTO_BANCO]);
    expect(lista(/documento_permissao_nivel_valido check \(nivel in \(([^)]*)\)\)/.exec(umaLinha)?.[1] ?? '')).toEqual([...nuvemCore.NIVEIS_DOCUMENTO_BANCO]);
    for (const c of [
      'constraint documento_cliente_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id)',
      'constraint documento_cliente_tipo_fk foreign key (tenant_id, tipo_id) references core.documento_tipo (tenant_id, id)',
      'constraint documento_cliente_enviado_por_fk foreign key (tenant_id, enviado_por) references core.usuario (tenant_id, id)',
      "constraint documento_cliente_nome_tamanho check (btrim(nome) <> '' and char_length(nome) <= 120)",
      'constraint documento_cliente_validade_coerente check (valido_ate is null or valido_ate >= data_documento)',
    ]) expect(bloco('core.documento_cliente')).toContain(c);
    expect(bloco('core.documento_permissao')).toContain('constraint documento_permissao_tipo_fk foreign key (tenant_id, tipo_id) references core.documento_tipo (tenant_id, id)');
    expect(bloco('core.documento_excecao')).toContain('constraint documento_excecao_documento_fk foreign key (tenant_id, documento_id) references core.documento_cliente (tenant_id, id)');
    // perfil_id e arquivo_id sem FK (outro schema, ADR 0010)
    expect(umaLinha).not.toMatch(/references plataforma\.(perfil|arquivo)/);
    for (const c of [
      'create unique index documento_tipo_nome_uk on core.documento_tipo (tenant_id, lower(nome)) where deleted_at is null;',
      'create unique index documento_cliente_arquivo_uk on core.documento_cliente (tenant_id, arquivo_id) where arquivo_id is not null and deleted_at is null;',
      'create index documento_cliente_cliente_ix on core.documento_cliente (tenant_id, cliente_id);',
      'create unique index documento_permissao_tipo_perfil_uk on core.documento_permissao (tenant_id, tipo_id, perfil_id) where deleted_at is null;',
      'create unique index documento_excecao_documento_perfil_uk on core.documento_excecao (tenant_id, documento_id, perfil_id) where deleted_at is null;',
    ]) expect(umaLinha).toContain(c);
    for (const T of TABELAS) {
      const n = T.split('.')[1]!;
      for (const c of [
        'id uuid primary key default gen_random_uuid()', 'tenant_id uuid not null references plataforma.tenant (id)',
        'created_at timestamptz not null default now()', 'updated_at timestamptz not null default now()', 'deleted_at timestamptz,', 'external_id text,',
        `constraint ${n}_tenant_id_uk unique (tenant_id, id)`,
      ]) expect(bloco(T), `${T}: ${c}`).toContain(c);
      for (const c of [
        `create unique index ${n}_external_uk on ${T} (tenant_id, external_id) where external_id is not null and deleted_at is null;`,
        `create trigger ${n}_updated_at before update on ${T} for each row execute function plataforma.definir_updated_at();`,
        `alter table ${T} enable row level security;`,
        `alter table ${T} force row level security;`,
        `create policy isolamento_tenant on ${T} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`,
        `create policy manutencao on ${T} for all to macuxi_manutencao using (true) with check (true);`,
        `create policy leitura on ${T} for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());`,
      ]) expect(umaLinha, `${T}: ${c}`).toContain(c);
      // P15: Documentação só online; nada vai ao aparelho (fora do sync e sem índice de pull)
      expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(T);
      expect(umaLinha).not.toMatch(new RegExp(`on ${T.replace('.', '\\.')} \\(tenant_id, (cliente_id, )?updated_at, id\\)`));
    }
  });

  it('grants: app com select, insert e update (sem delete) e leitura com select; nada mais', () => {
    const grants = [...umaLinha.matchAll(/grant ([^;]*);/g)].map((g) => g[1]!);
    expect(grants).toEqual(TABELAS.flatMap((T) => [`select, insert, update on ${T} to macuxi_app`, `select on ${T} to macuxi_leitura`]));
  });

  it('down: drop das 4 tabelas (filha antes da mãe), dos índices, CHECKs e das 6 colunas (idempotente)', () => {
    const ordem = ['core.documento_excecao', 'core.documento_permissao', 'core.documento_cliente', 'core.documento_tipo'].map((t) => down.indexOf(`drop table if exists ${t};`));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((x, y) => x - y)).toEqual(ordem);
    for (const c of ['nf_origem_serie', 'nf_origem_numero', 'forma_pagamento']) expect(down).toContain(`alter table core.nota_erp drop column if exists ${c};`);
    for (const c of ['nf_serie', 'nf_numero', 'forma_pagamento']) expect(down).toContain(`alter table core.titulo drop column if exists ${c};`);
    for (const i of ['core.titulo_nf_ix', 'core.nota_erp_nf_origem_ix', 'core.nota_erp_cliente_emitida_ix']) expect(down).toContain(`drop index if exists ${i};`);
    expect(down).not.toMatch(/drop (table|index|column|constraint) (?!if exists)/);
  });

  it('espelho Drizzle: as 4 tabelas (tipos e nulidade) e as colunas novas de nota_erp e titulo', () => {
    const tipos = (t: Parameters<typeof getTableConfig>[0]) => Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, [c.getSQLType(), c.notNull]]));
    expect(tipos(nuvemCore.documentoTipo)).toMatchObject({
      nome: ['text', true], grupo: ['text', true], ordem: ['integer', true], origem: ['text', true], tem_validade: ['boolean', true], ativo: ['boolean', true],
    });
    expect(tipos(nuvemCore.documentoCliente)).toMatchObject({
      cliente_id: ['uuid', true], tipo_id: ['uuid', true], nome: ['text', true], arquivo_id: ['uuid', false], data_documento: ['date', true],
      valido_ate: ['date', false], enviado_por: ['uuid', false],
    });
    expect(tipos(nuvemCore.documentoPermissao)).toMatchObject({ tipo_id: ['uuid', true], perfil_id: ['uuid', true], nivel: ['text', true] });
    expect(tipos(nuvemCore.documentoExcecao)).toMatchObject({ documento_id: ['uuid', true], perfil_id: ['uuid', true] });
    expect(tipos(nuvemCore.notaErp)).toMatchObject({ forma_pagamento: ['text', false], nf_origem_numero: ['text', false], nf_origem_serie: ['text', false] });
    expect(tipos(nuvemCore.titulo)).toMatchObject({ forma_pagamento: ['text', false], nf_numero: ['text', false], nf_serie: ['text', false] });
  });
});

describe.skipIf(semBanco())('0090 Cliente 360 v2 (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const noSavepoint = async (sql: string, p: unknown[] = []) => {
    await q('savepoint s');
    const e = await erroDe(q(sql, p));
    await q('rollback to savepoint s');
    return e;
  };
  const INS_TIPO = 'insert into core.documento_tipo (tenant_id, nome, grupo, origem) values ($1, $2, $3, $4) returning id';
  const INS_DOC = 'insert into core.documento_cliente (tenant_id, cliente_id, tipo_id, nome, arquivo_id, data_documento, valido_ate) values ($1, $2, $3, $4, $5, $6, $7) returning id';
  const INS_PERM = 'insert into core.documento_permissao (tenant_id, tipo_id, perfil_id, nivel) values ($1, $2, $3, $4) returning id';
  const INS_EXC = 'insert into core.documento_excecao (tenant_id, documento_id, perfil_id) values ($1, $2, $3) returning id';

  it('fixture: cada tenant vê só a própria linha nas 4 tabelas', async () => {
    for (const [X, F] of [[A, DOCUMENTOS_FIXTURE.A], [B, DOCUMENTOS_FIXTURE.B]] as const) {
      await emTransacao(app, X.tenantId, async () => {
        for (const [T, id] of [
          ['core.documento_tipo', F.tipo], ['core.documento_cliente', F.documento], ['core.documento_permissao', F.permissao], ['core.documento_excecao', F.excecao],
        ] as const) {
          expect((await q(`select id, tenant_id from ${T}`)).rows, T).toEqual([{ id, tenant_id: X.tenantId }]);
        }
      });
    }
  });

  it('multi-tenant: B não vê, não altera nem grava as linhas de A; a mãe de A não existe para B (FK composta)', async () => {
    const F = DOCUMENTOS_FIXTURE.A;
    const perfilB = idPerfilFabrica(B.tenantId, 'vendedor');
    await emTransacao(app, B.tenantId, async () => {
      for (const [T, id] of [
        ['core.documento_tipo', F.tipo], ['core.documento_cliente', F.documento], ['core.documento_permissao', F.permissao], ['core.documento_excecao', F.excecao],
      ] as const) {
        expect((await q(`select count(*)::int as n from ${T} where tenant_id = $1`, [A.tenantId])).rows, T).toEqual([{ n: 0 }]);
        expect((await q(`update ${T} set deleted_at = $2 where id = $1`, [id, T0])).rowCount, T).toBe(0);
      }
      expect(await noSavepoint(INS_TIPO, [A.tenantId, 'Intruso', 'Cadastro', 'app'])).toMatchObject({ code: '42501' });
      expect(await noSavepoint(INS_DOC, [B.tenantId, A.clientes.c1, DOCUMENTOS_FIXTURE.B.tipo, 'X', null, '2026-01-01', null])).toMatchObject({ code: '23503' });
      expect(await noSavepoint(INS_DOC, [B.tenantId, B.clientes.c1, F.tipo, 'X', null, '2026-01-01', null])).toMatchObject({ code: '23503' });
      expect(await noSavepoint(INS_PERM, [B.tenantId, F.tipo, perfilB, 've'])).toMatchObject({ code: '23503' });
      expect(await noSavepoint(INS_EXC, [B.tenantId, F.documento, perfilB])).toMatchObject({ code: '23503' });
    });
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select deleted_at from core.documento_cliente where id = $1', [F.documento])).rows).toEqual([{ deleted_at: null }]);
    });
  });

  it('CHECKs: origem, nivel, validade, tamanhos (23514)', async () => {
    const F = DOCUMENTOS_FIXTURE.A;
    await emTransacao(app, A.tenantId, async () => {
      for (const [sql, p, nome] of [
        [INS_TIPO, [A.tenantId, 'Novo', 'Cadastro', 'portal'], 'documento_tipo_origem_valida'],
        [INS_TIPO, [A.tenantId, '  ', 'Cadastro', 'app'], 'documento_tipo_nome_tamanho'],
        [INS_TIPO, [A.tenantId, 'x'.repeat(81), 'Cadastro', 'app'], 'documento_tipo_nome_tamanho'],
        [INS_TIPO, [A.tenantId, 'Novo', 'g'.repeat(61), 'app'], 'documento_tipo_grupo_tamanho'],
        [INS_PERM, [A.tenantId, F.tipo, idPerfilFabrica(A.tenantId, 'supervisor'), 'edita'], 'documento_permissao_nivel_valido'],
        [INS_DOC, [A.tenantId, A.clientes.c1, F.tipo, 'Alvará', null, '2026-03-10', '2026-03-09'], 'documento_cliente_validade_coerente'],
        [INS_DOC, [A.tenantId, A.clientes.c1, F.tipo, 'n'.repeat(121), null, '2026-03-10', null], 'documento_cliente_nome_tamanho'],
      ] as const) {
        expect(await noSavepoint(sql, [...p]), nome).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
      }
      // validade no mesmo dia e sem validade gravam; os 3 níveis gravam
      expect((await q(INS_DOC, [A.tenantId, A.clientes.c1, F.tipo, 'Alvará do dia', null, '2026-03-10', '2026-03-10'])).rowCount).toBe(1);
      for (const [base, nivel] of [['supervisor', 'nao_ve'], ['gerente', 've'], ['promotor', 've_envia']] as const) {
        expect((await q(INS_PERM, [A.tenantId, F.tipo, idPerfilFabrica(A.tenantId, base), nivel])).rowCount, nivel).toBe(1);
      }
    });
  });

  it('únicos vivos: nome do tipo sem maiúsculas, arquivo, (tipo, perfil) e (documento, perfil); a linha apagada libera', async () => {
    const F = DOCUMENTOS_FIXTURE.A;
    const perfilA = idPerfilFabrica(A.tenantId, 'vendedor');
    const ARQ = 'aaaaaaaa-0090-4000-8000-000000000001';
    await emTransacao(app, A.tenantId, async () => {
      expect(await noSavepoint(INS_TIPO, [A.tenantId, 'ALVARÁ DE FUNCIONAMENTO', 'Outro', 'app'])).toMatchObject({ code: '23505', message: expect.stringContaining('documento_tipo_nome_uk') });
      expect(await noSavepoint(INS_PERM, [A.tenantId, F.tipo, perfilA, 'nao_ve'])).toMatchObject({ code: '23505', message: expect.stringContaining('documento_permissao_tipo_perfil_uk') });
      expect(await noSavepoint(INS_EXC, [A.tenantId, F.documento, perfilA])).toMatchObject({ code: '23505', message: expect.stringContaining('documento_excecao_documento_perfil_uk') });
      expect((await q(INS_DOC, [A.tenantId, A.clientes.c1, F.tipo, 'Com arquivo', ARQ, '2026-03-10', null])).rowCount).toBe(1);
      expect(await noSavepoint(INS_DOC, [A.tenantId, A.clientes.c1, F.tipo, 'Mesmo arquivo', ARQ, '2026-03-10', null])).toMatchObject({ code: '23505', message: expect.stringContaining('documento_cliente_arquivo_uk') });
      // dois documentos sem arquivo gravam (o único é parcial)
      expect((await q(INS_DOC, [A.tenantId, A.clientes.c1, F.tipo, 'Sem arquivo 2', null, '2026-03-10', null])).rowCount).toBe(1);
      // apagar (soft delete) libera o par e anda o updated_at
      const antes = (await q('select updated_at from core.documento_excecao where id = $1', [F.excecao])).rows[0]!.updated_at as Date;
      const r = await q('update core.documento_excecao set deleted_at = $2 where id = $1 returning updated_at', [F.excecao, T0]);
      expect((r.rows[0]!.updated_at as Date).getTime()).toBeGreaterThan(antes.getTime());
      expect((await q(INS_EXC, [A.tenantId, F.documento, perfilA])).rowCount).toBe(1);
      await q('update core.documento_permissao set deleted_at = $2 where id = $1', [F.permissao, T0]);
      expect((await q(INS_PERM, [A.tenantId, F.tipo, perfilA, 'nao_ve'])).rowCount).toBe(1);
    });
  });

  it('o app não apaga (42501) nas 4 tabelas', async () => {
    const F = DOCUMENTOS_FIXTURE.A;
    for (const [T, id] of [
      ['core.documento_excecao', F.excecao], ['core.documento_permissao', F.permissao], ['core.documento_cliente', F.documento], ['core.documento_tipo', F.tipo],
    ] as const) {
      await emTransacao(app, A.tenantId, async () => {
        expect(await erroDe(q(`delete from ${T} where id = $1`, [id])), T).toMatchObject({ code: '42501' });
      });
    }
  });

  it('nota_erp: forma de pagamento e NF original gravam e leem; NF original só em devolução; série sem número não (23514)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const fat = (await q("select id from core.nota_erp where tipo = 'faturamento' and numero = '5001'")).rows[0]!.id as string;
      const dev = (await q("select id from core.nota_erp where tipo = 'devolucao' and numero = '7001'")).rows[0]!.id as string;
      expect((await q('select forma_pagamento, nf_origem_numero, nf_origem_serie from core.nota_erp where id = $1', [fat])).rows).toEqual([
        { forma_pagamento: null, nf_origem_numero: null, nf_origem_serie: null },
      ]);
      await q("update core.nota_erp set forma_pagamento = 'Boleto 28/56' where id = $1", [fat]);
      await q("update core.nota_erp set forma_pagamento = 'Boleto 28/56', nf_origem_numero = '5001', nf_origem_serie = '1' where id = $1", [dev]);
      expect((await q('select forma_pagamento, nf_origem_numero, nf_origem_serie from core.nota_erp where id = $1', [dev])).rows).toEqual([
        { forma_pagamento: 'Boleto 28/56', nf_origem_numero: '5001', nf_origem_serie: '1' },
      ]);
      // as devoluções de uma NF (status Devolvido / Devolvido parcial)
      expect((await q("select id from core.nota_erp where cliente_id = $1 and nf_origem_numero = '5001' and nf_origem_serie = '1' and deleted_at is null", [A.clientes.c1])).rows).toEqual([{ id: dev }]);
      // limites do contrato do Hub: número até 40 e série até 10
      await q('update core.nota_erp set nf_origem_numero = repeat($2, 40), nf_origem_serie = repeat($2, 10) where id = $1', [dev, '9']);
      expect((await q('select char_length(nf_origem_numero) as n, char_length(nf_origem_serie) as s from core.nota_erp where id = $1', [dev])).rows).toEqual([{ n: 40, s: 10 }]);
      for (const [sql, p, nome] of [
        ['update core.nota_erp set nf_origem_numero = repeat($2, 41) where id = $1', [dev, '9'], 'nota_erp_nf_origem_tamanho'],
        ['update core.nota_erp set nf_origem_serie = repeat($2, 11) where id = $1', [dev, '9'], 'nota_erp_nf_origem_tamanho'],
        ["update core.nota_erp set nf_origem_numero = '4000' where id = $1", [fat], 'nota_erp_nf_origem_so_devolucao'],
        ["update core.nota_erp set nf_origem_numero = null, nf_origem_serie = '1' where id = $1", [dev], 'nota_erp_nf_origem_serie_com_numero'],
        ["update core.nota_erp set nf_origem_numero = '  ' where id = $1", [dev], 'nota_erp_nf_origem_tamanho'],
        ["update core.nota_erp set forma_pagamento = '' where id = $1", [fat], 'nota_erp_forma_pagamento_tamanho'],
        ['update core.nota_erp set forma_pagamento = repeat($2, 121) where id = $1', [fat, 'x'], 'nota_erp_forma_pagamento_tamanho'],
      ] as const) {
        expect(await noSavepoint(sql, [...p]), nome).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
      }
    });
  });

  it('titulo: forma de pagamento e NF gravam e leem; série sem número não (23514)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = (await q('select id from core.titulo order by id limit 1')).rows[0]!.id as string;
      expect((await q('select forma_pagamento, nf_numero, nf_serie from core.titulo where id = $1', [id])).rows).toEqual([{ forma_pagamento: null, nf_numero: null, nf_serie: null }]);
      await q("update core.titulo set forma_pagamento = 'PIX', nf_numero = '5001', nf_serie = '1' where id = $1", [id]);
      expect((await q('select forma_pagamento, nf_numero, nf_serie from core.titulo where id = $1', [id])).rows).toEqual([{ forma_pagamento: 'PIX', nf_numero: '5001', nf_serie: '1' }]);
      // limites do contrato do Hub: número até 40 e série até 10
      await q("update core.titulo set nf_numero = repeat('9', 40), nf_serie = repeat('9', 10) where id = $1", [id]);
      expect((await q('select char_length(nf_numero) as n, char_length(nf_serie) as s from core.titulo where id = $1', [id])).rows).toEqual([{ n: 40, s: 10 }]);
      for (const [sql, nome] of [
        ["update core.titulo set nf_numero = repeat('9', 41) where id = $1", 'titulo_nf_tamanho'],
        ["update core.titulo set nf_serie = repeat('9', 11) where id = $1", 'titulo_nf_tamanho'],
        ["update core.titulo set nf_numero = null, nf_serie = '1' where id = $1", 'titulo_nf_serie_com_numero'],
        ["update core.titulo set nf_numero = '' where id = $1", 'titulo_nf_tamanho'],
        ["update core.titulo set forma_pagamento = ' ' where id = $1", 'titulo_forma_pagamento_tamanho'],
      ] as const) {
        expect(await noSavepoint(sql, [id]), nome).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
      }
    });
    await emTransacao(app, B.tenantId, async () => {
      expect((await q("select count(*)::int as n from core.titulo where nf_numero = '5001'")).rows).toEqual([{ n: 0 }]);
    });
  });

  it('macuxi_leitura: SELECT nas 4 tabelas e nas colunas novas; nada de escrita; o app sem delete nem truncate', async () => {
    for (const T of TABELAS) {
      const r = await q(
        `select has_table_privilege('macuxi_leitura', '${T}', 'select') as t,
                has_table_privilege('macuxi_leitura', '${T}', 'insert, update, delete') as e,
                has_table_privilege('macuxi_app', '${T}', 'select, insert, update') as a,
                has_table_privilege('macuxi_app', '${T}', 'delete, truncate') as d`,
      );
      expect(r.rows, T).toEqual([{ t: true, e: false, a: true, d: false }]);
    }
    const c = await q(
      `select has_column_privilege('macuxi_leitura', 'core.nota_erp', 'nf_origem_numero', 'select') as n,
              has_column_privilege('macuxi_leitura', 'core.titulo', 'nf_numero', 'select') as t`,
    );
    expect(c.rows).toEqual([{ n: true, t: true }]);
  });
});

describe.skipIf(semBanco())('0090 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const TEN = 'cccccccc-0000-4000-8000-000000000890';
  const CLI = 'cccccccc-0000-4000-8000-000000001890';
  const NOTA = 'cccccccc-0000-4000-8000-000000002890';
  const TIT = 'cccccccc-0000-4000-8000-000000003890';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up sobre a 0089 mantém notas e títulos (colunas novas nulas, updated_at igual), down volta ao catálogo da 0089 (idempotente) e up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0089' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'c360', 'Cliente 360 0090')", [TEN]);
      await c.query("insert into core.cliente (id, tenant_id, razao_social) values ($1, $2, 'Cliente 0090')", [CLI, TEN]);
      await c.query(
        `insert into core.nota_erp (id, tenant_id, cliente_id, tipo, numero, serie, emitida_em, ano_mes, total_cents, external_id, updated_at)
         values ($1, $2, $3, 'devolucao', '7001', '1', $4, '2026-11', 30000, 'ND-7001', $4)`,
        [NOTA, TEN, CLI, T0],
      );
      await c.query(
        `insert into core.titulo (id, tenant_id, cliente_id, documento, parcela, emissao, vencimento, valor_cents, saldo_cents, updated_at)
         values ($1, $2, $3, 'DUP-1', '1/2', '2026-11-01', '2026-12-01', 50000, 50000, $4)`,
        [TIT, TEN, CLI, T0],
      );
      const nota = 'select id, tipo, numero, serie, total_cents, external_id, updated_at = $2::timestamptz as ok from core.nota_erp where id = $1';
      const tit = 'select id, documento, parcela, valor_cents, saldo_cents, situacao, updated_at = $2::timestamptz as ok from core.titulo where id = $1';
      const notaAntes = (await c.query(nota, [NOTA, T0])).rows;
      const titAntes = (await c.query(tit, [TIT, T0])).rows;
      expect(notaAntes[0]).toMatchObject({ ok: true });
      expect(titAntes[0]).toMatchObject({ ok: true });

      expect((await migrarUp(c, { ate: m90.versao })).aplicadas).toEqual([`${m90.versao}_${m90.nome}`]);
      const depois = await retratoDoCatalogo(c);
      for (const item of [
        'col core.nota_erp.forma_pagamento text nn=false', 'col core.nota_erp.nf_origem_numero text nn=false', 'col core.titulo.nf_serie text nn=false',
        'rel core.documento_cliente r rls=true force=true', 'rel core.documento_excecao r rls=true force=true',
      ]) expect(depois).toContain(item);
      expect((await c.query(nota, [NOTA, T0])).rows).toEqual(notaAntes);
      expect((await c.query(tit, [TIT, T0])).rows).toEqual(titAntes);
      expect((await c.query('select forma_pagamento, nf_origem_numero, nf_origem_serie from core.nota_erp where id = $1', [NOTA])).rows).toEqual([
        { forma_pagamento: null, nf_origem_numero: null, nf_origem_serie: null },
      ]);
      expect((await c.query('select forma_pagamento, nf_numero, nf_serie from core.titulo where id = $1', [TIT])).rows).toEqual([{ forma_pagamento: null, nf_numero: null, nf_serie: null }]);

      // dados nas colunas e tabelas novas: o down apaga sem erro
      await c.query("update core.nota_erp set nf_origem_numero = '5001', forma_pagamento = 'Boleto' where id = $1", [NOTA]);
      const tipo = (await c.query("insert into core.documento_tipo (tenant_id, nome, grupo, origem) values ($1, 'Alvará', 'Cadastro', 'escritorio') returning id", [TEN])).rows[0]!.id as string;
      await c.query("insert into core.documento_cliente (tenant_id, cliente_id, tipo_id, nome, data_documento) values ($1, $2, $3, 'Alvará 2026', '2026-03-10')", [TEN, CLI, tipo]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m90.versao}_${m90.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query(nota, [NOTA, T0])).rows).toHaveLength(1);
      await c.query(m90.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: m90.versao });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
