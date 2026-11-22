/**
 * 0094 — integração por ERP, fatia F2 (desenho docs/desenho/integracao-modelos-erp.md §2.2–§2.5, §4 e §5; aprovado em
 * R-20261122-005500-alexandre). Dicionário: docs/banco/integracao.md, "0094".
 * - 5 tabelas no schema integracao com os campos comuns, RLS forçado, isolamento_tenant e manutencao; fora do sync;
 * - conector_api: frequência por entidade com piso de 15 min (D3) por CHECK, URL só https e parâmetros sem segredo;
 * - credencial_erp: uma viva por Conector, segredo só na linha viva e SÓ o macuxi_app lê (nem macuxi_leitura, nem worker,
 *   nem portal: TABELAS_SEM_LEITURA);
 * - implantacao (uma viva por tenant), implantacao_dia (um retrato por dia) e coleta_execucao (uma viva por alvo, uma
 *   executando por Conector);
 * - up sobre a 0093, down volta ao catálogo da 0093 (idempotente) e up de novo igual.
 * Estático sempre; banco (fixture dois-tenants, ROLLBACK) e up/down num banco efêmero com o Postgres local.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModoCarga } from '../../modules/integracao/contracts';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_LEITURA } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comCliente, comoPapel, emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const mig = migracoes.find((m) => m.nome === 'integracao_busca_erp')!;
/** A migração logo antes (sem fixar o número: a renumeração na ordem de merge não mexe aqui). */
const anterior = migracoes[migracoes.indexOf(mig) - 1]!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(mig.up);
const umaLinha = up.replace(/\s+/g, ' ');
const down = semComentarios(mig.down);
const TABELAS = [
  'integracao.conector_api',
  'integracao.credencial_erp',
  'integracao.implantacao',
  'integracao.implantacao_dia',
  'integracao.coleta_execucao',
] as const;
const COM_LEITURA = TABELAS.filter((t) => t !== 'integracao.credencial_erp');
const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]!);
const valoresDoCheck = (nome: string, coluna: string) =>
  lista(new RegExp(`constraint ${nome} check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(umaLinha)?.[1] ?? '');

/** Segredo de mentira (bytes aleatórios do tamanho do GCM); nunca um segredo real. */
const IV = Buffer.alloc(12, 1);
const TAG = Buffer.alloc(16, 2);
const CIFRADO = Buffer.from('conteudo-cifrado-de-teste');

describe('0094 integração por ERP (estático)', () => {
  it('número: logo depois da anterior no main', () => {
    expect(Number(mig.versao)).toBe(Number(anterior.versao) + 1);
    expect(anterior.versao).toBe('0093');
  });

  it('5 tabelas com campos comuns, unique (tenant_id, id), gatilho, RLS forçado, isolamento_tenant, manutencao; app sem DELETE', () => {
    expect([...umaLinha.matchAll(/create table ([a-z_.]+) /g)].map((m) => m[1])).toEqual([...TABELAS]);
    for (const t of TABELAS) {
      const curto = t.slice('integracao.'.length);
      const bloco = new RegExp(`create table ${t.replace('.', '\\.')} \\(([^;]*)\\);`).exec(umaLinha)?.[1] ?? '';
      for (const c of ['id uuid primary key default gen_random_uuid()', 'tenant_id uuid not null references plataforma.tenant (id)', 'created_at timestamptz not null default now()', 'updated_at timestamptz not null default now()', 'deleted_at timestamptz,', 'external_id text,', `constraint ${curto}_tenant_id_uk unique (tenant_id, id)`]) {
        expect(bloco, `${t}: ${c}`).toContain(c);
      }
      expect(umaLinha).toContain(`create trigger ${curto}_updated_at before update on ${t} for each row execute function plataforma.definir_updated_at();`);
      expect(umaLinha).toContain(`alter table ${t} enable row level security;`);
      expect(umaLinha).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(umaLinha).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(umaLinha).toContain(`grant select, insert, update on ${t} to macuxi_app;`);
      expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(t);
      expect(down).toContain(`drop table if exists ${t};`);
    }
    expect(up).not.toMatch(/grant [a-z, ]*(delete|truncate)[a-z, ]* on /);
    expect(up).not.toMatch(/to [a-z_, ]*(macuxi_worker|macuxi_portal)/);
    expect(down).toContain('drop function if exists integracao.frequencias_validas(jsonb);');
    expect(down).toContain('drop function if exists integracao.parametros_sem_segredo(jsonb);');
  });

  it('credencial_erp: nenhum grant nem política para o macuxi_leitura (TABELAS_SEM_LEITURA); as outras 4 com a leitura', () => {
    expect(TABELAS_SEM_LEITURA as readonly string[]).toContain('integracao.credencial_erp');
    expect(up).not.toMatch(/on integracao\.credencial_erp (for select )?to [a-z_, ]*macuxi_leitura/);
    expect(umaLinha).toContain('revoke all on integracao.credencial_erp from public;');
    expect(umaLinha).toContain('create unique index credencial_erp_conector_uk on integracao.credencial_erp (tenant_id, conector_id) where deleted_at is null;');
    for (const t of COM_LEITURA) {
      expect(umaLinha).toContain(`grant select on ${t} to macuxi_leitura;`);
      expect(umaLinha).toContain(`create policy leitura on ${t} for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());`);
    }
  });

  it('listas fechadas = constantes do espelho (entidade = ENTIDADES_BANCO, modo = ModoCarga) e Drizzle com as mesmas', () => {
    expect(valoresDoCheck('conector_api_erp_valido', 'erp')).toEqual([...nuvemIntegracao.ERPS_BUSCA_API]);
    expect(valoresDoCheck('implantacao_erp_valido', 'erp')).toEqual([...nuvemIntegracao.ERPS_IMPLANTACAO]);
    expect(valoresDoCheck('implantacao_meio_valido', 'meio')).toEqual([...nuvemIntegracao.MEIOS_IMPLANTACAO]);
    expect(valoresDoCheck('coleta_execucao_entidade_valida', 'entidade')).toEqual([...nuvemIntegracao.ENTIDADES_BANCO]);
    expect(valoresDoCheck('coleta_execucao_modo_valido', 'modo')).toEqual([...ModoCarga.options]);
    expect(valoresDoCheck('coleta_execucao_origem_valida', 'origem')).toEqual([...nuvemIntegracao.ORIGENS_COLETA]);
    expect(valoresDoCheck('coleta_execucao_estado_valido', 'estado')).toEqual([...nuvemIntegracao.ESTADOS_COLETA]);
    expect(valoresDoCheck('coleta_execucao_falha_classe_valida', 'falha_classe')).toEqual([...nuvemIntegracao.CLASSES_FALHA_COLETA]);
    // as entidades da função de frequência
    expect(lista(/when e\.key <> all \(array\[([^\]]*)\]\)/.exec(umaLinha)?.[1] ?? '')).toEqual([...nuvemIntegracao.ENTIDADES_BANCO]);
    expect(umaLinha).toContain(`e.value::numeric < ${nuvemIntegracao.FREQUENCIA_MINIMA_MIN} or e.value::numeric > ${nuvemIntegracao.FREQUENCIA_MAXIMA_MIN}`);
    expect(nuvemIntegracao.coletaExecucao.estado.enumValues).toEqual([...nuvemIntegracao.ESTADOS_COLETA]);
    expect(nuvemIntegracao.conectorApi.erp.enumValues).toEqual([...nuvemIntegracao.ERPS_BUSCA_API]);
  });

  it('espelho Drizzle das 5 tabelas (tipos e nulidade das colunas de segredo)', () => {
    const tipos = (t: Parameters<typeof getTableConfig>[0]) => Object.fromEntries(getTableConfig(t).columns.map((c) => [c.name, [c.getSQLType(), c.notNull]]));
    expect(tipos(nuvemIntegracao.credencialErp)).toMatchObject({
      conector_id: ['uuid', true], cifrado: ['bytea', false], iv: ['bytea', false], tag: ['bytea', false],
      chave_versao: ['smallint', true], atualizada_em: ['timestamp with time zone', true], atualizada_por: ['uuid', false],
    });
    expect(tipos(nuvemIntegracao.conectorApi)).toMatchObject({ frequencias: ['jsonb', true], parametros: ['jsonb', true], url_base: ['text', true] });
    expect(tipos(nuvemIntegracao.implantacaoDia)).toMatchObject({ dia: ['date', true], minutos_fora_do_ar: ['smallint', true] });
  });
});

describe.skipIf(semBanco())('0094 integração por ERP (banco, fixture)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  const API = "insert into integracao.conector_api (tenant_id, conector_id, erp, url_base, frequencias, parametros) values ($1, $2, 'sap_b1', $3, $4::jsonb, $5::jsonb) returning id";
  const CRED = 'insert into integracao.credencial_erp (tenant_id, conector_id, cifrado, iv, tag, chave_versao) values ($1, $2, $3, $4, $5, 1) returning id';
  /** A fixture tem 1 linha viva de cada tabela por tenant: o teste aposenta a de A antes de gravar a dele. */
  const aposentarFixtureA = async () => {
    await q('update integracao.conector_api set deleted_at = now() where tenant_id = $1', [A.tenantId]);
    await q('update integracao.credencial_erp set deleted_at = now(), cifrado = null, iv = null, tag = null where tenant_id = $1', [A.tenantId]);
    await q('update integracao.implantacao set deleted_at = now() where tenant_id = $1', [A.tenantId]);
  };
  const falha = async (sql: string, p: unknown[]) => {
    await q('savepoint s');
    const e = await erroDe(q(sql, p));
    await q('rollback to savepoint s');
    return e;
  };

  it('conector_api: piso de 15 min e teto de 1440 por entidade, entidade conhecida, inteiro (23514); 15 e 1440 passam', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await aposentarFixtureA();
      const ok = await q(API, [A.tenantId, A.integracao.conector, 'https://erp.exemplo.com.br:50000/b1s/v1', '{"preco": 15, "cliente": 60, "filial": 1440}', '{"CompanyDB": "SBO_TESTE"}']);
      expect(ok.rowCount).toBe(1);
      await q('update integracao.conector_api set deleted_at = now() where id = $1', [ok.rows[0].id]);
      for (const f of ['{"estoque": 14}', '{"estoque": 5}', '{"estoque": 0}', '{"estoque": -15}', '{"titulo": 1441}', '{"estoque": 15.5}', '{"estoque": "15"}', '{"pedido": 60}', '[15]']) {
        expect(await falha(API, [A.tenantId, A.integracao.conector, 'https://erp.exemplo.com.br', f, '{}']), f).toMatchObject({
          code: '23514', message: expect.stringContaining('conector_api_frequencias_validas'),
        });
      }
    });
  });

  it('conector_api: URL só https, sem credencial, query nem fragmento; parâmetros sem chave de segredo; uma viva por Conector', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await aposentarFixtureA();
      for (const url of ['http://erp.exemplo.com.br', 'https://usuario:senha@erp.exemplo.com.br', 'https://erp.exemplo.com.br/api?token=x', 'https://erp.exemplo.com.br/#a', 'ftp://erp', 'https://']) {
        expect(await falha(API, [A.tenantId, A.integracao.conector, url, '{}', '{}']), url).toMatchObject({ code: '23514', message: expect.stringContaining('conector_api_url_https') });
      }
      for (const p of ['{"Password": "x"}', '{"senha": "x"}', '{"appkey": "x"}', '{"api_token": "x"}', '{"B1SESSION": "x"}', '[]']) {
        expect(await falha(API, [A.tenantId, A.integracao.conector, 'https://erp.exemplo.com.br', '{}', p]), p).toMatchObject({ code: '23514', message: expect.stringContaining('conector_api_parametros_validos') });
      }
      await q(API, [A.tenantId, A.integracao.conector, 'https://erp.exemplo.com.br', '{}', '{}']);
      expect(await falha(API, [A.tenantId, A.integracao.conector, 'https://outro.exemplo.com.br', '{}', '{}'])).toMatchObject({ code: '23505', message: expect.stringContaining('conector_api_conector_uk') });
    });
  });

  it('credencial_erp: uma viva por Conector (23505); apagada sem segredo; rotação por update; formato do GCM; sem DELETE', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await aposentarFixtureA();
      const id = (await q(CRED, [A.tenantId, A.integracao.conector, CIFRADO, IV, TAG])).rows[0].id as string;
      expect(await falha(CRED, [A.tenantId, A.integracao.conector, CIFRADO, IV, TAG])).toMatchObject({ code: '23505', message: expect.stringContaining('credencial_erp_conector_uk') });
      // rotação: troca na mesma linha
      expect((await q('update integracao.credencial_erp set cifrado = $2, chave_versao = 2, atualizada_em = now() where id = $1', [id, Buffer.from('outro')])).rowCount).toBe(1);
      // formato: iv de 12, tag de 16, os três juntos
      for (const [c, iv, tag, nome] of [[CIFRADO, Buffer.alloc(16), TAG, 'credencial_erp_formato'], [CIFRADO, IV, Buffer.alloc(8), 'credencial_erp_formato'], [CIFRADO, null, TAG, 'credencial_erp_segredo_tudo_ou_nada']] as const) {
        expect(await falha('update integracao.credencial_erp set cifrado = $2, iv = $3, tag = $4 where id = $1', [id, c, iv, tag]), nome).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
      }
      // apagar sem limpar o segredo = 23514; viva sem segredo = 23514
      expect(await falha('update integracao.credencial_erp set deleted_at = now() where id = $1', [id])).toMatchObject({ code: '23514', message: expect.stringContaining('credencial_erp_segredo_so_viva') });
      expect(await falha('update integracao.credencial_erp set cifrado = null, iv = null, tag = null where id = $1', [id])).toMatchObject({ code: '23514', message: expect.stringContaining('credencial_erp_segredo_so_viva') });
      expect(await falha('delete from integracao.credencial_erp where id = $1', [id])).toMatchObject({ code: '42501' });
      // apagar limpando o segredo libera uma nova viva
      await q('update integracao.credencial_erp set deleted_at = now(), cifrado = null, iv = null, tag = null where id = $1', [id]);
      expect((await q(CRED, [A.tenantId, A.integracao.conector, CIFRADO, IV, TAG])).rowCount).toBe(1);
    });
  });

  it('multi-tenant: B não vê nem grava as 5 tabelas de A; Conector de B não serve em A (23503)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await aposentarFixtureA();
      await q(API, [A.tenantId, A.integracao.conector, 'https://erp.exemplo.com.br', '{}', '{}']);
      await q(CRED, [A.tenantId, A.integracao.conector, CIFRADO, IV, TAG]);
      const imp = (await q("insert into integracao.implantacao (tenant_id, erp, meio, conector_id) values ($1, 'sap_b1', 'api_busca', $2) returning id", [A.tenantId, A.integracao.conector])).rows[0].id as string;
      await q("insert into integracao.implantacao_dia (tenant_id, implantacao_id, dia) values ($1, $2, '2026-11-22')", [A.tenantId, imp]);
      await q("insert into integracao.coleta_execucao (tenant_id, conector_id, entidade, modo, origem) values ($1, $2, 'preco', 'delta', 'agendada')", [A.tenantId, A.integracao.conector]);
      expect(await falha(API, [A.tenantId, B.integracao.conector, 'https://erp.exemplo.com.br', '{}', '{}'])).toMatchObject({ code: '23503' });
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      for (const t of TABELAS) {
        expect((await q(`select count(*)::int as n from ${t} where tenant_id = $1`, [A.tenantId])).rows, t).toEqual([{ n: 0 }]);
        expect((await q(`select count(*)::int as n from ${t} where tenant_id <> $1`, [B.tenantId])).rows, t).toEqual([{ n: 0 }]);
        expect((await q(`select count(*)::int as n from ${t}`)).rows[0].n, `${t}: a fixture tem linha de B`).toBeGreaterThan(0);
      }
      expect(await falha(CRED, [A.tenantId, A.integracao.conector, CIFRADO, IV, TAG])).toMatchObject({ code: '42501' });
      expect((await q('update integracao.credencial_erp set chave_versao = 9 where tenant_id = $1', [A.tenantId])).rowCount).toBe(0);
      // sem contexto: 0 linhas
      await q("select set_config('app.tenant_id', '', true)");
      for (const t of TABELAS) expect((await q(`select count(*)::int as n from ${t}`)).rows, t).toEqual([{ n: 0 }]);
    });
  });

  it('implantacao: uma viva por tenant, passo 1..7, concluída só depois do D+0; retrato: um por dia, contagens não negativas', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await aposentarFixtureA();
      const IMP = 'insert into integracao.implantacao (tenant_id, passo, erp, meio) values ($1, $2, $3, $4) returning id';
      const imp = (await q(IMP, [A.tenantId, 1, 'winthor', 'conector'])).rows[0].id as string;
      expect(await falha(IMP, [A.tenantId, 1, null, null])).toMatchObject({ code: '23505', message: expect.stringContaining('implantacao_viva_uk') });
      for (const [p, erp, meio, nome] of [[0, null, null, 'implantacao_passo_faixa'], [8, null, null, 'implantacao_passo_faixa'], [1, 'totvs', null, 'implantacao_erp_valido'], [1, null, 'csv', 'implantacao_meio_valido']] as const) {
        expect(await falha('update integracao.implantacao set passo = $2, erp = $3, meio = $4 where id = $1', [imp, p, erp, meio]), nome).toMatchObject({ code: '23514', message: expect.stringContaining(nome) });
      }
      expect(await falha('update integracao.implantacao set concluida_em = now() where id = $1', [imp])).toMatchObject({ code: '23514', message: expect.stringContaining('implantacao_concluida_depois_da_completa') });
      await q("update integracao.implantacao set marco_primeira_completa_em = '2026-11-01T10:00:00Z', concluida_em = '2026-12-01T10:00:00Z' where id = $1", [imp]);
      const DIA = "insert into integracao.implantacao_dia (tenant_id, implantacao_id, dia, minutos_fora_do_ar, lotes_com_erro) values ($1, $2, '2026-11-02', $3, $4)";
      await q(DIA, [A.tenantId, imp, 0, 0]);
      expect(await falha(DIA, [A.tenantId, imp, 0, 0])).toMatchObject({ code: '23505', message: expect.stringContaining('implantacao_dia_uk') });
      await q("update integracao.implantacao_dia set dia = '2026-11-03' where implantacao_id = $1", [imp]);
      expect(await falha(DIA, [A.tenantId, imp, 1441, 0])).toMatchObject({ code: '23514', message: expect.stringContaining('implantacao_dia_minutos_faixa') });
      expect(await falha(DIA, [A.tenantId, imp, 0, -1])).toMatchObject({ code: '23514', message: expect.stringContaining('implantacao_dia_contagens_nao_negativas') });
    });
  });

  it('coleta_execucao: uma viva por (Conector, entidade), uma executando por Conector e estados coerentes', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const COL = "insert into integracao.coleta_execucao (tenant_id, conector_id, entidade, modo, origem) values ($1, $2, $3, 'delta', 'agendada') returning id";
      const preco = (await q(COL, [A.tenantId, A.integracao.conector, 'preco'])).rows[0].id as string;
      expect(await falha(COL, [A.tenantId, A.integracao.conector, 'preco'])).toMatchObject({ code: '23505', message: expect.stringContaining('coleta_execucao_viva_uk') });
      const estoque = (await q(COL, [A.tenantId, A.integracao.conector, 'estoque'])).rows[0].id as string;
      await q("update integracao.coleta_execucao set estado = 'executando', iniciada_em = now() where id = $1", [preco]);
      expect(await falha("update integracao.coleta_execucao set estado = 'executando', iniciada_em = now() where id = $1", [estoque])).toMatchObject({ code: '23505', message: expect.stringContaining('coleta_execucao_executando_uk') });
      expect(await falha("update integracao.coleta_execucao set estado = 'falhou', concluida_em = now() where id = $1", [preco])).toMatchObject({ code: '23514', message: expect.stringContaining('coleta_execucao_falha_so_no_falhou') });
      expect(await falha("update integracao.coleta_execucao set estado = 'concluida' where id = $1", [preco])).toMatchObject({ code: '23514', message: expect.stringContaining('coleta_execucao_concluida_coerente') });
      expect(await falha("update integracao.coleta_execucao set estado = 'executando' where id = $1", [estoque])).toMatchObject({ code: '23514', message: expect.stringContaining('coleta_execucao_iniciada_coerente') });
      await q("update integracao.coleta_execucao set estado = 'falhou', falha_classe = 'credencial_recusada', http_status = 401, concluida_em = now() where id = $1", [preco]);
      // a falhou libera o alvo e o Conector
      expect((await q(COL, [A.tenantId, A.integracao.conector, 'preco'])).rowCount).toBe(1);
      await q("update integracao.coleta_execucao set estado = 'executando', iniciada_em = now() where id = $1", [estoque]);
      expect(await falha("insert into integracao.coleta_execucao (tenant_id, conector_id, entidade, modo, origem) values ($1, $2, 'pedido', 'delta', 'agendada')", [A.tenantId, A.integracao.conector])).toMatchObject({ code: '23514' });
    });
  });

  it('papéis: macuxi_leitura, macuxi_worker e macuxi_portal sem acesso à credencial_erp (42501); leitura lê as outras 4 só do tenant', async () => {
    await comCliente(banco().urlAdmin, async (c) => {
      await c.query('begin');
      try {
        await c.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
        // a fixture tem 1 credencial_erp e 1 coleta_execucao por tenant
        for (const papel of ['macuxi_leitura', 'macuxi_worker', 'macuxi_portal']) {
          for (const sql of ['select * from integracao.credencial_erp', 'select cifrado from integracao.credencial_erp', 'select count(*) from integracao.credencial_erp']) {
            expect(await erroDe(comoPapel(c, papel, sql, [], A.tenantId)), `${papel}: ${sql}`).toMatchObject({ code: '42501' });
          }
        }
        for (const t of COM_LEITURA) {
          expect((await comoPapel(c, 'macuxi_leitura', `select count(*)::int as n from ${t} where tenant_id <> $1`, [A.tenantId], A.tenantId)).rows, t).toEqual([{ n: 0 }]);
          expect(await erroDe(comoPapel(c, 'macuxi_leitura', `delete from ${t}`, [], A.tenantId)), t).toMatchObject({ code: '42501' });
        }
        const coletas = (t: string) => comoPapel(c, 'macuxi_leitura', 'select tenant_id from integracao.coleta_execucao', [], t);
        expect((await coletas(A.tenantId)).rows).toEqual([{ tenant_id: A.tenantId }]);
        expect((await coletas(B.tenantId)).rows).toEqual([{ tenant_id: B.tenantId }]);
        expect((await comoPapel(c, 'macuxi_leitura', 'select count(*)::int as n from integracao.coleta_execucao', [], '')).rows).toEqual([{ n: 0 }]);
        // o app lê a própria credencial (só ele)
        expect((await comoPapel(c, 'macuxi_app', 'select count(*)::int as n from integracao.credencial_erp', [], A.tenantId)).rows).toEqual([{ n: 1 }]);
      } finally {
        await c.query('rollback');
      }
    });
  });
});

describe.skipIf(semBanco())('0094 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up sobre a anterior, down volta ao catálogo dela (idempotente) e up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior.versao });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: mig.versao })).aplicadas).toEqual([`${mig.versao}_${mig.nome}`]);
      const depois = await retratoDoCatalogo(c);
      expect(depois.some((l) => l.startsWith('rel integracao.credencial_erp '))).toBe(true);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${mig.versao}_${mig.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(mig.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: mig.versao });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
