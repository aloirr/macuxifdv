/**
 * 0098 — reenvio do pré-cadastro recusado no mesmo cliente, com histórico de revisões (v1.0.30, ADR 0069; RN-CORE-16, RN-CORE-78,
 * RN-CORE-79 e RN-INT-22). Dicionários: docs/banco/core.md e docs/banco/integracao.md ("0098"). O que o BANCO garante:
 * - core.cliente.revisao_cadastro (>= 1; 1 em todo pré-cadastro na carga) e erros_recusa (array até 50, só com 'recusado', sem
 *   SELECT do macuxi_leitura);
 * - core.cliente_pre_cadastro_tentativa: única por (tenant, cliente, revisão), FKs compostas, CHECKs (hash sha256 hex, origem,
 *   resultado, respondido x aguardando, motivo e erros só na recusa, quem corrigiu com o perfil), índices do alias e da lista do BKO,
 *   RLS por tenant, sem DELETE, macuxi_leitura sem hash, motivo e erros; carga de uma tentativa por pré-cadastro vivo;
 * - integracao.cliente_fila_erp.revisao (default 1), hash e erros (só com 'rejeitado'); macuxi_leitura só na revisão;
 * - parâmetro unificado: cliente.campos_obrigatorios = E ∪ P e o espelho legado cliente.pre_cadastro.obrigatorios, conferidos
 *   contra o domain (camposExigidos e os contratos do pré-cadastro); a conferência db/scripts/conferencia-0098.sql (antes do up;
 *   só informativa), com a contagem dos duplicados da v1.0.28 (codigo_em_uso);
 * - Código FDV do cliente (ADR 0069 item 10 e D.7): os objetos entram no retrato do catálogo do up/down abaixo; o comportamento
 *   (emissão, carga, concorrência) fica em cliente-codigo-fdv.db.test.ts;
 * - up/down: o down volta exatamente ao catálogo e às ACLs da 0097; os parâmetros ficam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMPOS_CADASTRO_CLIENTE, CAMPOS_PRE_CADASTRO_CONFIGURAVEIS, COLUNAS_ENDERECO_PRE_CADASTRO, ObrigatoriosPreCadastroSchema } from '../../modules/core/contracts';
import { camposExigidos } from '../../modules/core/domain/cadastro';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemIntegracao from '../../modules/integracao/db/nuvem';
import { DOIS_TENANTS, TENTATIVAS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { PASTA_DB } from '../src/config';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0098';
const m98 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m98) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m98.up);
const down = semComentarios(m98.down);
const umaLinha = (sql: string) => sql.replace(/\s+/g, ' ');
const CONFERENCIA = readFileSync(join(PASTA_DB, 'scripts', 'conferencia-0098.sql'), 'utf8');

const TABELA = 'core.cliente_pre_cadastro_tentativa';
const COLUNAS_TENTATIVA = [
  'id', 'tenant_id', 'cliente_id', 'revisao', 'hash', 'origem', 'corrigido_por', 'corrigido_por_perfil', 'cliente_id_original',
  'campos_alterados', 'enviado_em', 'resultado', 'respondido_em', 'motivo', 'erros', 'created_at', 'updated_at', 'deleted_at', 'external_id',
];
const SEM_LEITURA = ['hash', 'motivo', 'erros'];
const LISTA_BKO =
  "select cliente_id from core.cliente_pre_cadastro_tentativa where tenant_id = $1 and resultado = 'recusado' and deleted_at is null order by respondido_em desc, cliente_id limit 50";
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const HASH = 'f'.repeat(64);
const CONTADOR = 'core.cliente_codigo_fdv_contador';
const COLUNAS_CONTADOR = ['id', 'tenant_id', 'ultimo_sequencial', 'created_at', 'updated_at', 'deleted_at', 'external_id'];

/** Resultados de um script com várias consultas (o pg devolve um array quando há mais de um comando). */
async function consultas(c: pg.ClientBase, sql: string): Promise<pg.QueryResult[]> {
  const r = (await c.query(sql)) as unknown as pg.QueryResult | pg.QueryResult[];
  return Array.isArray(r) ? r : [r];
}

/**
 * Referência em TypeScript da migração do parâmetro (ADR 0069 item 6), montada com o domain e os contratos do Core: E pelo
 * camposExigidos, P pelo ObrigatoriosPreCadastroSchema (inválido = vazio) com endereco expandido, espelho = projeção nos
 * configuráveis antigos. Quando o modulo-core publicar obrigatoriosDoPreCadastro e projecaoLegadaObrigatorios, este teste passa a
 * importá-las no lugar desta referência.
 */
function esperado(e: unknown, p: unknown): { unificado: string[]; espelho: string[] } {
  const exigidos = camposExigidos(e);
  const lidoP = ObrigatoriosPreCadastroSchema.safeParse(p);
  const expandido = (lidoP.success ? lidoP.data : []).flatMap((c) => (c === 'endereco' ? [...COLUNAS_ENDERECO_PRE_CADASTRO] : [c]));
  const unificado = CAMPOS_CADASTRO_CLIENTE.filter((c) => exigidos.includes(c) || (expandido as string[]).includes(c));
  const espelho = CAMPOS_PRE_CADASTRO_CONFIGURAVEIS.filter((k) =>
    k === 'endereco' ? COLUNAS_ENDERECO_PRE_CADASTRO.some((c) => (unificado as string[]).includes(c)) : (unificado as string[]).includes(k),
  );
  return { unificado: [...unificado], espelho: [...espelho] };
}

describe('0098 revisão do pré-cadastro (estático)', () => {
  it('nome, colunas e CHECKs em core.cliente, grant só da revisão e espelho Drizzle', () => {
    expect(m98.nome).toBe('core_integracao_pre_cadastro_revisao');
    expect(ANTERIOR).toBe('0097');
    const u = umaLinha(up);
    expect(up).toContain('alter table core.cliente add column revisao_cadastro integer;');
    expect(u).toContain('add constraint cliente_revisao_cadastro_valida check (revisao_cadastro is null or revisao_cadastro >= 1);');
    expect(up).toContain('alter table core.cliente add column erros_recusa jsonb;');
    expect(u).toContain("add constraint cliente_erros_recusa_status check (erros_recusa is null or status_cadastro = 'recusado');");
    expect(up).toContain('grant select (revisao_cadastro) on core.cliente to macuxi_leitura;');
    expect(up).not.toMatch(/grant select \([^)]*erros_recusa/);
    expect(up).toContain("update core.cliente set revisao_cadastro = 1 where origem_cadastro <> 'erp' and revisao_cadastro is null;");
    const colunas = Object.keys(nuvemCore.cliente);
    for (const c of ['revisao_cadastro', 'erros_recusa', 'motivo_recusa']) expect(colunas, c).toContain(c);
  });

  it('tabela de tentativas: colunas, únicos, FKs compostas, RLS sem DELETE, leitura sem hash, motivo e erros, fora do sync e Drizzle', () => {
    expect(up).toContain(`create table ${TABELA} (`);
    const u = umaLinha(up);
    expect(u).toContain('constraint cliente_pre_cadastro_tentativa_revisao_uk unique (tenant_id, cliente_id, revisao)');
    expect(u).toContain('foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id)');
    expect(u).toContain('foreign key (tenant_id, cliente_id_original) references core.cliente (tenant_id, id)');
    expect(u).toContain('foreign key (tenant_id, corrigido_por) references core.usuario (tenant_id, id)');
    expect(u).toContain("check (resultado = 'recusado' or (motivo is null and erros is null))");
    expect(u).toContain(`create index cliente_pre_cadastro_tentativa_original_ix on ${TABELA} (tenant_id, cliente_id_original) where cliente_id_original is not null;`);
    expect(u).toContain(
      `create index cliente_pre_cadastro_tentativa_recusados_ix on ${TABELA} (tenant_id, respondido_em desc, cliente_id) where resultado = 'recusado' and deleted_at is null;`,
    );
    expect(up).toContain(`grant select, insert, update on ${TABELA} to macuxi_app;`);
    const leitura = new RegExp(`grant select \\(([^)]*)\\) on ${TABELA.replace('.', '\\.')} to macuxi_leitura;`).exec(up)![1]!.split(',').map((x) => x.trim());
    expect(leitura.sort()).toEqual(COLUNAS_TENTATIVA.filter((c) => !SEM_LEITURA.includes(c)).sort());
    expect(up).not.toMatch(/grant [^;]*\bdelete\b|to macuxi_(worker|portal)/);
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(TABELA);
    expect(Object.keys(nuvemCore.clientePreCadastroTentativa).filter((k) => COLUNAS_TENTATIVA.includes(k)).sort()).toEqual([...COLUNAS_TENTATIVA].sort());
    const origens = /cliente_pre_cadastro_tentativa_origem_valida check \(origem in \(([^)]*)\)\)/.exec(up)![1]!.split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(origens).toEqual([...nuvemCore.ORIGENS_TENTATIVA_PRE_CADASTRO_BANCO]);
    const resultados = /cliente_pre_cadastro_tentativa_resultado_valido check \(resultado in \(([^)]*)\)\)/.exec(up)![1]!.split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(resultados).toEqual([...nuvemCore.RESULTADOS_TENTATIVA_PRE_CADASTRO_BANCO]);
  });

  it('fila do ERP: revisao, hash e erros com CHECKs; leitura só da revisao; Drizzle', () => {
    const u = umaLinha(up);
    expect(up).toContain('alter table integracao.cliente_fila_erp add column revisao integer not null default 1;');
    expect(up).toContain('alter table integracao.cliente_fila_erp add column hash text;');
    expect(up).toContain('alter table integracao.cliente_fila_erp add column erros jsonb;');
    expect(u).toContain("add constraint cliente_fila_erp_erros_estado check (erros is null or estado = 'rejeitado');");
    expect(up).toContain('grant select (revisao) on integracao.cliente_fila_erp to macuxi_leitura;');
    for (const c of ['revisao', 'hash', 'erros']) expect(Object.keys(nuvemIntegracao.clienteFilaErp), c).toContain(c);
  });

  it('down: desfaz tudo na ordem inversa e não toca nos parâmetros', () => {
    expect(down).toContain(`drop table if exists ${TABELA};`);
    for (const c of ['revisao_cadastro', 'erros_recusa']) expect(down).toContain(`alter table core.cliente drop column if exists ${c};`);
    for (const c of ['revisao', 'hash', 'erros']) expect(down).toContain(`alter table integracao.cliente_fila_erp drop column if exists ${c};`);
    expect(down).not.toMatch(/plataforma\.parametro/);
    expect(down.indexOf('cliente_fila_erp')).toBeLessThan(down.indexOf(TABELA));
    expect(down.indexOf(TABELA)).toBeLessThan(down.indexOf('alter table core.cliente drop constraint if exists cliente_erros_recusa_status'));
  });

  it('a conferência só lê e não leva dado pessoal (código do tenant, nomes de campo e contagens); conta os duplicados da v1.0.28', () => {
    const c = semComentarios(CONFERENCIA);
    expect(c).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant)\b/i);
    expect(c).not.toMatch(/razao_social as|documento as|c\.(razao_social|nome_fantasia|documento|email|telefone)\b/);
    const u = umaLinha(c);
    expect(u).toContain('select t.codigo as tenant, count(distinct c.id)::int as duplicados_v1028 from core.cliente c');
    expect(u).toContain("a.acao = 'cliente.vinculo_erp_recusado' and a.depois ->> 'resultado' = 'codigo_em_uso'");
    expect(CONFERENCIA).toContain('SÓ INFORMATIVA');
  });

});

describe.skipIf(semBanco())('0098 revisão do pré-cadastro (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const comoApp = (t: string, sql: string, p: unknown[] = []) => comoPapel<Record<string, unknown>>(admin, 'macuxi_app', sql, p, t).then((r) => r.rows);
  const cliente = (set: string, p: unknown[] = []) => erroNoSavepoint(admin, `update core.cliente set ${set} where id = '${A.clientes.c1}'`, p);
  const tentativa = (set: string, p: unknown[] = []) => erroNoSavepoint(admin, `update ${TABELA} set ${set} where id = '${TENTATIVAS_FIXTURE.A}'`, p);
  const erros = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ campo: 'documento', codigo: `c${i}`, mensagem: 'Inválido.' })));
  const inserir = (cols: Record<string, unknown>) => {
    const linha = { tenant_id: A.tenantId, cliente_id: A.clientes.c1, revisao: 1, origem: 'campo', enviado_em: new Date().toISOString(), ...cols };
    const nomes = Object.keys(linha);
    return erroNoSavepoint(admin, `insert into ${TABELA} (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(linha));
  };

  it('fixture: uma tentativa por tenant; os clientes da fixture (ERP) sem revisão nem erros', async () => {
    const r = await q<{ tenant_id: string; n: number }>(`select tenant_id, count(*)::int as n from ${TABELA} group by tenant_id order by tenant_id`);
    expect(r).toEqual([{ tenant_id: A.tenantId, n: 1 }, { tenant_id: B.tenantId, n: 1 }].sort((x, y) => x.tenant_id.localeCompare(y.tenant_id)));
    const c = await q<{ n: number }>('select count(*)::int as n from core.cliente where revisao_cadastro is not null or erros_recusa is not null');
    expect(c[0]!.n).toBe(0);
    const f = await q<{ revisao: number; hash: string | null; erros: unknown }>('select revisao, hash, erros from integracao.cliente_fila_erp order by tenant_id');
    expect(f.every((x) => x.revisao === 1 && x.hash === null && x.erros === null)).toBe(true);
  });

  it('CHECKs de core.cliente: revisão >= 1; erros_recusa array até 50 e só com recusado', async () => {
    await emTransacao(admin, null, async () => {
      await q("update core.cliente set origem_cadastro = 'campo', status_cadastro = 'pendente', external_id = null, revisao_cadastro = 1 where id = $1", [A.clientes.c1]);
      expect((await cliente('revisao_cadastro = 0'))?.code).toBe('23514');
      expect(await cliente('revisao_cadastro = 7')).toBeNull();
      expect((await cliente(`erros_recusa = '${erros(1)}'`))?.code).toBe('23514'); // pendente com erros
      expect((await cliente(`status_cadastro = 'recusado', erros_recusa = '{"campo": "x"}'`))?.code).toBe('23514'); // objeto
      expect((await cliente(`status_cadastro = 'recusado', erros_recusa = '"texto"'`))?.code).toBe('23514');
      expect((await cliente(`status_cadastro = 'recusado', erros_recusa = '${erros(51)}'`))?.code).toBe('23514');
      expect(await cliente(`status_cadastro = 'recusado', erros_recusa = '${erros(50)}'`)).toBeNull();
      expect(await cliente("status_cadastro = 'recusado', erros_recusa = '[]'")).toBeNull();
      expect((await cliente("status_cadastro = 'pendente'"))?.code).toBe('23514'); // reabrir sem limpar os erros
      expect(await cliente("status_cadastro = 'pendente', erros_recusa = null, motivo_recusa = null")).toBeNull();
    });
  });

  it('CHECKs, único e FKs da tentativa', async () => {
    await emTransacao(admin, null, async () => {
      expect(await inserir({ revisao: 1, hash: HASH })).toBeNull();
      expect((await inserir({ revisao: 1 }))?.code).toBe('23505'); // mesma revisão do mesmo cliente
      expect(await inserir({ revisao: 2, deleted_at: new Date().toISOString() })).toBeNull();
      expect((await inserir({ revisao: 2 }))?.code).toBe('23505'); // o único vale também para a apagada
      expect((await inserir({ revisao: 0 }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, hash: 'F'.repeat(64) }))?.code).toBe('23514'); // hex minúsculo
      expect((await inserir({ revisao: 3, hash: 'a'.repeat(63) }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, origem: 'erp' }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, resultado: 'pendente' }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, resultado: 'aceito' }))?.code).toBe('23514'); // respondido sem data
      expect((await inserir({ revisao: 3, respondido_em: new Date().toISOString() }))?.code).toBe('23514'); // aguardando com data
      expect((await inserir({ revisao: 3, resultado: 'aceito', respondido_em: new Date().toISOString(), motivo: 'x' }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, resultado: 'recusado', respondido_em: new Date().toISOString(), motivo: 'a'.repeat(501) }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, resultado: 'recusado', respondido_em: new Date().toISOString(), erros: erros(51) }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, resultado: 'recusado', respondido_em: new Date().toISOString(), erros: '{"a": 1}' }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, corrigido_por: A.usuarios.admin }))?.code).toBe('23514'); // sem o perfil
      expect((await inserir({ revisao: 3, corrigido_por_perfil: 'admin' }))?.code).toBe('23514'); // sem o usuário
      expect((await inserir({ revisao: 3, corrigido_por: A.usuarios.admin, corrigido_por_perfil: ' ' }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, campos_alterados: Array.from({ length: 21 }, (_, i) => `c${i}`) }))?.code).toBe('23514');
      expect((await inserir({ revisao: 3, cliente_id_original: A.clientes.c1 }))?.code).toBe('23514'); // alias de si mesmo
      expect((await inserir({ revisao: 3, cliente_id: B.clientes.c1 }))?.code).toBe('23503'); // cliente de outro tenant
      expect((await inserir({ revisao: 3, cliente_id_original: B.clientes.c1 }))?.code).toBe('23503');
      expect((await inserir({ revisao: 3, corrigido_por: B.usuarios.admin, corrigido_por_perfil: 'admin' }))?.code).toBe('23503');
      expect(
        await inserir({
          revisao: 3, hash: HASH, origem: 'bko', corrigido_por: A.usuarios.admin, corrigido_por_perfil: 'admin', cliente_id_original: A.clientes.c2,
          campos_alterados: ['documento', 'cep'], resultado: 'recusado', respondido_em: new Date().toISOString(), motivo: 'a'.repeat(500), erros: erros(50),
        }),
      ).toBeNull();
      expect((await tentativa("resultado = 'aceito'"))?.code).toBe('23514'); // aguardando sem resposta
      expect(await tentativa("resultado = 'aceito', respondido_em = now()")).toBeNull();
    });
  });

  it('RLS: o app de um tenant não lê nem grava a tentativa do outro; sem DELETE; o gatilho anda o updated_at', async () => {
    await emTransacao(admin, null, async () => {
      expect(await comoApp(B.tenantId, `select id from ${TABELA} where id = $1`, [TENTATIVAS_FIXTURE.A])).toEqual([]);
      expect(await comoApp(B.tenantId, `update ${TABELA} set origem = 'campo' where id = $1 returning id`, [TENTATIVAS_FIXTURE.A])).toEqual([]);
      expect(await comoApp(A.tenantId, `select id from ${TABELA}`)).toEqual([{ id: TENTATIVAS_FIXTURE.A }]);
      const ins = `insert into ${TABELA} (tenant_id, cliente_id, revisao, origem, enviado_em) values ($1, $2, 2, 'campo', now())`;
      expect((await erroDe(comoApp(B.tenantId, ins, [A.tenantId, A.clientes.c3])))?.code).toBe('42501'); // with check
      expect((await erroDe(comoApp(A.tenantId, `delete from ${TABELA} where id = $1`, [TENTATIVAS_FIXTURE.A])))?.code).toBe('42501');
      const antes = await q<{ u: Date }>(`select updated_at as u from ${TABELA} where id = $1`, [TENTATIVAS_FIXTURE.A]);
      await comoApp(A.tenantId, `update ${TABELA} set resultado = 'aceito', respondido_em = now() where id = $1`, [TENTATIVAS_FIXTURE.A]);
      const depois = await q<{ u: Date }>(`select updated_at as u from ${TABELA} where id = $1`, [TENTATIVAS_FIXTURE.A]);
      expect(depois[0]!.u.getTime()).toBeGreaterThan(antes[0]!.u.getTime());
    });
  });

  it('lista dos recusados do BKO e alias pelos índices parciais', async () => {
    await emTransacao(admin, null, async () => {
      await q('set local enable_seqscan = off');
      const lista = (await q<{ 'QUERY PLAN': string }>(`explain ${LISTA_BKO.replace('$1', `'${B.tenantId}'`)}`)).map((r) => r['QUERY PLAN']).join('\n');
      expect(lista).toContain('cliente_pre_cadastro_tentativa_recusados_ix');
      const alias = (await q<{ 'QUERY PLAN': string }>(`explain select cliente_id from ${TABELA} where tenant_id = '${A.tenantId}' and cliente_id_original = '${A.clientes.c1}'`))
        .map((r) => r['QUERY PLAN']).join('\n');
      expect(alias).toContain('cliente_pre_cadastro_tentativa_original_ix');
      expect(await comoApp(B.tenantId, LISTA_BKO, [B.tenantId])).toEqual([{ cliente_id: B.clientes.c1 }]);
      expect(await comoApp(A.tenantId, LISTA_BKO, [B.tenantId])).toEqual([]);
    });
  });

  it('CHECKs da fila: revisão >= 1, hash sha256 hex e erros só com rejeitado; o app de B não reabre a linha de A', async () => {
    await emTransacao(admin, null, async () => {
      const fila = (set: string, t: string) => erroNoSavepoint(admin, `update integracao.cliente_fila_erp set ${set} where tenant_id = '${t}'`);
      expect((await fila('revisao = 0', A.tenantId))?.code).toBe('23514');
      expect((await fila("hash = 'xyz'", A.tenantId))?.code).toBe('23514');
      expect((await fila(`erros = '${erros(1)}'`, A.tenantId))?.code).toBe('23514'); // A está pendente
      expect((await fila(`erros = '${erros(51)}'`, B.tenantId))?.code).toBe('23514');
      expect(await fila(`erros = '${erros(2)}', hash = '${HASH}'`, B.tenantId)).toBeNull(); // B está rejeitado
      expect((await fila("estado = 'pendente'", B.tenantId))?.code).toBe('23514'); // reabrir sem limpar os erros
      expect(await fila("estado = 'pendente', erros = null, motivo = null, revisao = 2, tentativas = 0", B.tenantId)).toBeNull();
      const reabrir = "update integracao.cliente_fila_erp set revisao = revisao + 1 where cliente_uuid = $1 returning revisao";
      expect(await comoApp(B.tenantId, reabrir, [A.clientes.c3])).toEqual([]);
      expect(await comoApp(A.tenantId, reabrir, [A.clientes.c3])).toEqual([{ revisao: 2 }]);
    });
  });

  it('macuxi_leitura: lê a revisão; não lê erros_recusa, hash, motivo nem erros', async () => {
    const priv = async (tabela: string, cols: string[]) =>
      Object.fromEntries((await q<{ c: string; ok: boolean }>(
        'select c, has_column_privilege(\'macuxi_leitura\', $1, c, \'SELECT\') as ok from unnest($2::text[]) c',
        [tabela, cols],
      )).map((r) => [r.c, r.ok]));
    expect(await priv('core.cliente', ['revisao_cadastro', 'erros_recusa', 'motivo_recusa'])).toEqual({ revisao_cadastro: true, erros_recusa: false, motivo_recusa: false });
    expect(await priv(TABELA, COLUNAS_TENTATIVA)).toEqual(Object.fromEntries(COLUNAS_TENTATIVA.map((c) => [c, !SEM_LEITURA.includes(c)])));
    expect(await priv('integracao.cliente_fila_erp', ['revisao', 'hash', 'erros'])).toEqual({ revisao: true, hash: false, erros: false });
    await emTransacao(admin, null, async () => {
      expect((await erroDe(comoPapel(admin, 'macuxi_leitura', `select hash from ${TABELA} limit 1`, [], A.tenantId)))?.code).toBe('42501');
      const r = await comoPapel(admin, 'macuxi_leitura', `select id, revisao, resultado from ${TABELA}`, [], B.tenantId);
      expect(r.rows).toEqual([{ id: TENTATIVAS_FIXTURE.B, revisao: 1, resultado: 'recusado' }]);
    });
  });

});

describe.skipIf(semBanco())('0098 revisão do pré-cadastro (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const ACL = `
    select a.attrelid::regclass::text as t, a.attname as c, has_column_privilege('macuxi_leitura', a.attrelid, a.attnum, 'SELECT') as leitura
      from pg_attribute a where a.attrelid in ('core.cliente'::regclass, 'integracao.cliente_fila_erp'::regclass) and a.attnum > 0 and not a.attisdropped
     order by 1, 2`;

  /** Cenários do parâmetro: chave da RN-CORE-16 (E) e do pré-cadastro (P); undefined = sem linha viva. */
  const CENARIOS: { codigo: string; e?: unknown; p?: unknown; pApagada?: unknown; caso: string | null }[] = [
    { codigo: 'p98sem', caso: 'b' },
    { codigo: 'p98soe', e: ['razao_social', 'documento', 'telefone'], caso: 'c' },
    { codigo: 'p98sop', p: ['telefone', 'endereco'], caso: 'a' },
    { codigo: 'p98ambas', e: ['razao_social', 'documento', 'geolocalizacao', 'complemento'], p: ['email', 'nome_fantasia'], caso: 'a' },
    { codigo: 'p98invalidas', e: { x: 1 }, p: ['telefone', 'telefone'], caso: 'c' },
    { codigo: 'p98desconhecido', e: ['xyz', 'cep'], p: [], caso: 'c' },
    { codigo: 'p98apagada', pApagada: ['telefone'], caso: 'b' },
    { codigo: 'p98igual', e: ['razao_social', 'documento', 'inscricao_estadual', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'], p: ['inscricao_estadual', 'endereco'], caso: null },
  ];

  it('up: colunas, tabela, carga das tentativas e da revisão, parâmetro = domain, conferência; down volta à 0097; up de novo igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      const aclAntes = (await c.query(ACL)).rows;

      // pré-cadastros nos 3 status, um apagado (substituído na v1.0.28) e um do ERP
      const t = '98000000-0000-4000-8000-000000000001';
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'carga98', 'Carga')", [t]);
      const ins = `insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro, aprovado_em, motivo_recusa, deleted_at, created_at, updated_at)
                   values ($1, $2, $3, $4, $5, $6, $7, now() - interval '40 days', now() - interval '30 days') returning id`;
      const novo = async (nome: string, origem: string, status: string | null, aprovado: string | null, motivo: string | null, apagado: boolean) =>
        (await c.query<{ id: string }>(ins, [t, nome, origem, status, aprovado, motivo, apagado ? new Date() : null])).rows[0]!.id;
      const erp = await novo('ERP', 'erp', null, null, null, false);
      const pend = await novo('Pendente', 'campo', 'pendente', null, null, false);
      const aprovadoEm = new Date(Date.now() - 20 * 86400000);
      const apr = await novo('Aprovado', 'bko', 'aprovado', aprovadoEm.toISOString(), null, false);
      const rec = await novo('Recusado', 'campo', 'recusado', null, 'CNPJ inválido', false);
      const apagado = await novo('Substituído', 'campo', 'recusado', null, null, true);
      const datas = Object.fromEntries((await c.query<{ id: string; created_at: Date; updated_at: Date }>('select id, created_at, updated_at from core.cliente where tenant_id = $1', [t])).rows.map((r) => [r.id, r]));

      for (const s of CENARIOS) {
        const id = (await c.query<{ id: string }>('insert into plataforma.tenant (codigo, nome) values ($1, $1) returning id', [s.codigo])).rows[0]!.id;
        const par = "insert into plataforma.parametro (tenant_id, modulo, chave, valor, deleted_at) values ($1, 'core', $2, $3, $4)";
        if (s.e !== undefined) await c.query(par, [id, 'cliente.campos_obrigatorios', JSON.stringify(s.e), null]);
        if (s.p !== undefined) await c.query(par, [id, 'cliente.pre_cadastro.obrigatorios', JSON.stringify(s.p), null]);
        if (s.pApagada !== undefined) await c.query(par, [id, 'cliente.pre_cadastro.obrigatorios', JSON.stringify(s.pApagada), new Date()]);
      }

      // duplicado da v1.0.28: o 'vinculado' do pendente caiu em codigo_em_uso; o do recusado, em conflito (não conta)
      const aud = "insert into plataforma.auditoria (tenant_id, modulo, acao, entidade, entidade_id, depois) values ($1, 'core', 'cliente.vinculo_erp_recusado', 'cliente', $2, $3)";
      await c.query(aud, [t, pend, JSON.stringify({ external_id: 'C1', resultado: 'codigo_em_uso' })]);
      await c.query(aud, [t, pend, JSON.stringify({ external_id: 'C1', resultado: 'codigo_em_uso' })]); // repetido conta uma vez
      await c.query(aud, [t, rec, JSON.stringify({ external_id: 'C2', resultado: 'conflito' })]);

      // conferência (antes do up): casos (a), (b) e (c) e o que o pré-cadastro passa a exigir; duplicados da v1.0.28
      const [r1, r2] = await consultas(c, CONFERENCIA);
      const conf = r1!.rows as { tenant: string; caso: string; novos_no_cadastro_completo: string | null; novos_no_pre_cadastro: string | null }[];
      expect(r2!.rows).toEqual([{ tenant: 'carga98', duplicados_v1028: 1 }]);
      const meus = new Map(conf.filter((r) => r.tenant.startsWith('p98')).map((r) => [r.tenant, r]));
      for (const s of CENARIOS) {
        const ref = esperado(s.e, s.p);
        const e = camposExigidos(s.e);
        const novosCompleto = ref.unificado.filter((x) => !(e as string[]).includes(x));
        const lidoP = ObrigatoriosPreCadastroSchema.safeParse(s.p);
        const antesPre = new Set<string>(['razao_social', 'documento', ...(lidoP.success ? lidoP.data : []).flatMap((x) => (x === 'endereco' ? [...COLUNAS_ENDERECO_PRE_CADASTRO] : [x]))]);
        const novosPre = ref.unificado.filter((x) => x !== 'complemento' && x !== 'geolocalizacao' && !antesPre.has(x));
        const linha = meus.get(s.codigo);
        expect(linha?.caso ?? null, s.codigo).toBe(s.caso);
        expect(linha?.novos_no_cadastro_completo ?? null, s.codigo).toBe(novosCompleto.length ? novosCompleto.join(', ') : null);
        expect(linha?.novos_no_pre_cadastro ?? null, s.codigo).toBe(novosPre.length ? novosPre.join(', ') : null);
      }
      expect(conf.find((r) => r.tenant === 'carga98')?.caso).toBe('b'); // sem chave nenhuma

      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m98.nome}`]);
      const depois = await retratoDoCatalogo(c);
      const sairam = antes.filter((x) => !depois.includes(x));
      const novos = depois.filter((x) => !antes.includes(x));
      expect(sairam).toEqual([]);
      expect(novos.filter((x) => x.startsWith('col ') && !x.startsWith(`col ${TABELA}.`) && !x.startsWith(`col ${CONTADOR}.`)).sort()).toEqual([
        'col core.cliente.codigo_fdv text nn=false',
        'col core.cliente.erros_recusa jsonb nn=false',
        'col core.cliente.revisao_cadastro integer nn=false',
        'col integracao.cliente_fila_erp.erros jsonb nn=false',
        'col integracao.cliente_fila_erp.hash text nn=false',
        'col integracao.cliente_fila_erp.revisao integer nn=true',
      ]);
      expect(novos.filter((x) => x.startsWith(`col ${TABELA}.`)).map((x) => x.split(' ')[1]!.split('.')[2]).sort()).toEqual([...COLUNAS_TENTATIVA].sort());
      expect(novos.filter((x) => x.startsWith(`col ${CONTADOR}.`)).map((x) => x.split(' ')[1]!.split('.')[2]).sort()).toEqual([...COLUNAS_CONTADOR].sort());
      expect(novos.filter((x) => x.startsWith('rel ')).sort()).toEqual([
        `rel ${TABELA} r rls=true force=true`,
        'rel core.cliente_pre_cadastro_tentativa_original_ix i rls=false force=false',
        'rel core.cliente_pre_cadastro_tentativa_pkey i rls=false force=false',
        'rel core.cliente_pre_cadastro_tentativa_recusados_ix i rls=false force=false',
        'rel core.cliente_pre_cadastro_tentativa_revisao_uk i rls=false force=false',
        'rel core.cliente_pre_cadastro_tentativa_tenant_id_uk i rls=false force=false',
        `rel ${CONTADOR} r rls=true force=true`,
        'rel core.cliente_codigo_fdv_contador_pkey i rls=false force=false',
        'rel core.cliente_codigo_fdv_contador_tenant_uk i rls=false force=false',
        'rel core.cliente_codigo_fdv_uk i rls=false force=false',
      ].sort());
      expect(novos.filter((x) => x.startsWith('pol ')).map((x) => x.split(' ')[1]).sort()).toEqual(
        [TABELA, CONTADOR].flatMap((tab) => ['isolamento_tenant', 'leitura', 'manutencao'].map((p) => `${tab}.${p}`)).sort(),
      );
      expect(novos.filter((x) => x.startsWith('trg ')).sort()).toEqual([
        `trg ${CONTADOR}.cliente_codigo_fdv_contador_nao_diminui`,
        `trg ${CONTADOR}.cliente_codigo_fdv_contador_piso`,
        `trg ${CONTADOR}.cliente_codigo_fdv_contador_updated_at`,
        'trg core.cliente.cliente_codigo_fdv_emitir',
        'trg core.cliente.cliente_codigo_fdv_somente_leitura',
        `trg ${TABELA}.cliente_pre_cadastro_tentativa_updated_at`,
      ].sort());
      expect(novos.filter((x) => x.startsWith('fn ')).sort()).toEqual([
        'fn core.cliente_codigo_fdv()',
        'fn core.cliente_codigo_fdv_contador_nao_diminui()',
        'fn core.cliente_codigo_fdv_contador_piso()',
      ]);
      expect(novos.filter((x) => !/^(col|con|idx|rel|pol|trg|fn) /.test(x))).toEqual([]);

      // carga das tentativas: uma por pré-cadastro vivo, revisão 1, sem hash, resultado e resposta pelo status
      const tent = (await c.query<{ cliente_id: string; revisao: number; hash: string | null; origem: string; enviado_em: Date; resultado: string; respondido_em: Date | null; motivo: string | null; erros: unknown; corrigido_por: string | null }>(
        `select cliente_id, revisao, hash, origem, enviado_em, resultado, respondido_em, motivo, erros, corrigido_por from ${TABELA} where tenant_id = $1`, [t],
      )).rows;
      const porCliente = Object.fromEntries(tent.map((r) => [r.cliente_id, r]));
      expect(Object.keys(porCliente).sort()).toEqual([pend, apr, rec].sort());
      for (const r of tent) {
        expect(r).toMatchObject({ revisao: 1, hash: null, erros: null, corrigido_por: null });
        expect(r.enviado_em.getTime()).toBe(datas[r.cliente_id]!.created_at.getTime());
      }
      expect(porCliente[pend]).toMatchObject({ origem: 'campo', resultado: 'aguardando', respondido_em: null, motivo: null });
      expect(porCliente[apr]).toMatchObject({ origem: 'bko', resultado: 'aceito', motivo: null });
      expect(porCliente[apr]!.respondido_em!.getTime()).toBe(aprovadoEm.getTime());
      expect(porCliente[rec]).toMatchObject({ origem: 'campo', resultado: 'recusado', motivo: 'CNPJ inválido' });
      expect(porCliente[rec]!.respondido_em!.getTime()).toBe(datas[rec]!.updated_at.getTime()); // o updated_at de antes da 0098

      // revisão 1 em todo pré-cadastro (inclusive o apagado); o updated_at andou neles (pull) e no do ERP vivo (carga do Código FDV)
      const rev = (await c.query<{ id: string; revisao_cadastro: number | null; andou: boolean }>(
        "select id, revisao_cadastro, updated_at > now() - interval '1 day' as andou from core.cliente where tenant_id = $1", [t],
      )).rows;
      expect(Object.fromEntries(rev.map((r) => [r.id, [r.revisao_cadastro, r.andou]]))).toEqual({
        [erp]: [null, true], [pend]: [1, true], [apr]: [1, true], [rec]: [1, true], [apagado]: [1, true],
      });

      // parâmetro unificado e espelho = referência do domain
      const params = (await c.query<{ codigo: string; chave: string; valor: unknown }>(
        "select t.codigo, p.chave, p.valor from plataforma.parametro p join plataforma.tenant t on t.id = p.tenant_id where p.modulo = 'core' and p.deleted_at is null and p.chave in ('cliente.campos_obrigatorios', 'cliente.pre_cadastro.obrigatorios')",
      )).rows;
      const valor = (codigo: string, chave: string) => params.find((r) => r.codigo === codigo && r.chave === chave)?.valor;
      for (const s of CENARIOS) {
        const ref = esperado(s.e, s.p);
        expect(valor(s.codigo, 'cliente.pre_cadastro.obrigatorios'), `${s.codigo} espelho`).toEqual(ref.espelho);
        expect(valor(s.codigo, 'cliente.campos_obrigatorios'), `${s.codigo} unificado`).toEqual(s.p !== undefined ? ref.unificado : s.e);
      }
      expect(valor('carga98', 'cliente.pre_cadastro.obrigatorios')).toEqual(['inscricao_estadual', 'endereco']);
      expect(valor('carga98', 'cliente.campos_obrigatorios')).toBeUndefined();
      const apagadas = (await c.query<{ n: number }>("select count(*)::int as n from plataforma.parametro where deleted_at is not null")).rows[0]!.n;
      expect(apagadas).toBe(1); // a apagada fica como estava

      // fila do ERP: a linha nova nasce com a revisão 1
      await c.query(
        "insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, payload, recebido_em) values ($1, $2, '{}', now())", [t, pend],
      );
      expect((await c.query('select revisao, hash, erros from integracao.cliente_fila_erp where tenant_id = $1', [t])).rows).toEqual([{ revisao: 1, hash: null, erros: null }]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m98.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query(ACL)).rows).toEqual(aclAntes);
      // os parâmetros ficam
      const ficou = (await c.query<{ valor: unknown }>(
        "select p.valor from plataforma.parametro p join plataforma.tenant t on t.id = p.tenant_id where t.codigo = 'p98sop' and p.chave = 'cliente.campos_obrigatorios' and p.deleted_at is null",
      )).rows;
      expect(ficou).toEqual([{ valor: esperado(undefined, ['telefone', 'endereco']).unificado }]);

      await c.query(m98.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await c.query(ACL)).rows.filter((r: { c: string }) => ['codigo_fdv', 'erros_recusa', 'revisao_cadastro', 'revisao', 'hash', 'erros'].includes(r.c))).toEqual([
        { t: 'core.cliente', c: 'codigo_fdv', leitura: true },
        { t: 'core.cliente', c: 'erros_recusa', leitura: false },
        { t: 'core.cliente', c: 'revisao_cadastro', leitura: true },
        { t: 'integracao.cliente_fila_erp', c: 'erros', leitura: false },
        { t: 'integracao.cliente_fila_erp', c: 'hash', leitura: false },
        { t: 'integracao.cliente_fila_erp', c: 'revisao', leitura: true },
      ]);
    });
  });
});
