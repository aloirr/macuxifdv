/**
 * 0098 — reenvio do pré-cadastro recusado no mesmo cliente, com histórico de revisões (v1.0.29, ADR 0069; RN-CORE-16, RN-CORE-78,
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
 * - Código FDV do cliente (ADR 0069 item 10, molde da 0080/RN-CORE-59): core.cliente.codigo_fdv emitido pelo banco no insert do
 *   pré-cadastro (nulo no cliente do ERP), em sequência por tenant sem repetir em inserts concorrentes, único entre os vivos, só de
 *   leitura (23514 cliente_codigo_fdv_somente_leitura), informado fica (substituição do APK v1.0.28); contador
 *   core.cliente_codigo_fdv_contador (só o gatilho grava, nunca diminui, piso); carga dos pré-cadastros vivos por created_at, id;
 * - up/down: o down volta exatamente ao catálogo e às ACLs da 0097; os parâmetros ficam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
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
const fdv = (n: number) => String(n).padStart(5, '0');

/** Erro do Postgres com o nome da constraint, num savepoint do admin (o erro esperado não aborta o caso). */
async function erroComConstraint(admin: pg.ClientBase, sql: string, params: unknown[] = []): Promise<{ code?: string; constraint?: string; hint?: string } | null> {
  await admin.query('savepoint erro_constraint');
  try {
    await admin.query(sql, params);
    await admin.query('release savepoint erro_constraint');
    return null;
  } catch (e) {
    await admin.query('rollback to savepoint erro_constraint');
    const err = e as { code?: string; constraint?: string; hint?: string };
    return { code: err.code, constraint: err.constraint, hint: err.hint };
  }
}

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

  it('Código FDV do cliente: coluna, CHECKs, único entre os vivos, grant ao macuxi_leitura e Drizzle', () => {
    const u = umaLinha(up);
    expect(up).toContain('alter table core.cliente add column codigo_fdv text;');
    expect(u).toContain(
      "add constraint cliente_codigo_fdv_formato check (codigo_fdv is null or codigo_fdv ~ '^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$');",
    );
    // o mesmo formato do usuário (0080)
    const m80 = migracoes.find((m) => m.versao === '0080')!;
    const formato = (sql: string, nome: string) => new RegExp(`${nome} check \\(codigo_fdv is null or codigo_fdv ~ '([^']+)'\\)`).exec(umaLinha(sql))![1];
    expect(formato(up, 'cliente_codigo_fdv_formato')).toBe(formato(m80.up, 'usuario_codigo_fdv_formato'));
    expect(u).toContain("add constraint cliente_codigo_fdv_origem check (codigo_fdv is null or origem_cadastro <> 'erp');");
    expect(u).toContain('create unique index cliente_codigo_fdv_uk on core.cliente (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null;');
    expect(up).toContain('grant select (codigo_fdv) on core.cliente to macuxi_leitura;');
    expect(Object.keys(nuvemCore.cliente)).toContain('codigo_fdv');
  });

  it('Código FDV do cliente: contador próprio (RLS, app e leitura só leem, nunca diminui, piso), fora do sync e Drizzle', () => {
    const u = umaLinha(up);
    expect(up).toContain(`create table ${CONTADOR} (`);
    expect(u).toContain('constraint cliente_codigo_fdv_contador_tenant_uk unique (tenant_id)');
    expect(u).toContain('constraint cliente_codigo_fdv_contador_nao_negativo check (ultimo_sequencial >= 0)');
    expect(up).toContain(`alter table ${CONTADOR} force row level security;`);
    expect(up).toContain(`grant select on ${CONTADOR} to macuxi_app;`);
    expect(up).toContain(`grant select on ${CONTADOR} to macuxi_leitura;`);
    expect(up).not.toMatch(new RegExp(`grant [^;]*(insert|update|delete)[^;]* on ${CONTADOR.replace('.', '\\.')}`));
    expect(u).toContain(`create trigger cliente_codigo_fdv_contador_nao_diminui before update on ${CONTADOR}`);
    expect(u).toContain(`create trigger cliente_codigo_fdv_contador_piso before insert on ${CONTADOR}`);
    expect(up).toContain("constraint = 'cliente_codigo_fdv_contador_nao_diminui'");
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(CONTADOR);
    expect(Object.keys(nuvemCore.clienteCodigoFdvContador).filter((k) => COLUNAS_CONTADOR.includes(k)).sort()).toEqual([...COLUNAS_CONTADOR].sort());
  });

  it('Código FDV do cliente: função DEFINER dos 2 gatilhos (emitir só fora do ERP; somente leitura 23514), carga antes dos gatilhos', () => {
    const u = umaLinha(up);
    expect(u).toMatch(/create function core\.cliente_codigo_fdv\(\) returns trigger language plpgsql security definer set search_path = pg_catalog, core, plataforma, pg_temp/);
    expect(up).toContain('revoke all on function core.cliente_codigo_fdv() from public;');
    expect(u).toContain('create trigger cliente_codigo_fdv_emitir before insert on core.cliente for each row execute function core.cliente_codigo_fdv();');
    expect(u).toContain('create trigger cliente_codigo_fdv_somente_leitura before update on core.cliente for each row execute function core.cliente_codigo_fdv();');
    expect(u).toContain("constraint = 'cliente_codigo_fdv_somente_leitura'");
    expect(u).toContain("elsif new.origem_cadastro is not distinct from 'erp' then return new;");
    expect(u).toContain("plataforma.uuid_de_chave(new.tenant_id::text || ':core.cliente_codigo_fdv_contador')");
    expect(u).toContain("lpad(v_n::text, greatest(5, length(v_n::text)), '0')");
    // carga: só os pré-cadastros vivos, por created_at, id; antes dos gatilhos de core.cliente
    expect(u).toContain("row_number() over (partition by c.tenant_id order by c.created_at, c.id) as n from core.cliente c where c.origem_cadastro <> 'erp' and c.deleted_at is null");
    expect(up.indexOf('set codigo_fdv = lpad(')).toBeLessThan(up.indexOf('create trigger cliente_codigo_fdv_somente_leitura'));
    // não divide a numeração com o usuário
    expect(up).not.toMatch(/usuario_codigo_fdv/);
  });

  it('Código FDV do cliente: down apaga gatilhos, função, contador, índice, CHECKs e coluna, antes do resto', () => {
    for (const x of [
      'drop trigger if exists cliente_codigo_fdv_emitir on core.cliente;',
      'drop trigger if exists cliente_codigo_fdv_somente_leitura on core.cliente;',
      'drop function if exists core.cliente_codigo_fdv();',
      `drop table if exists ${CONTADOR};`,
      'drop function if exists core.cliente_codigo_fdv_contador_nao_diminui();',
      'drop function if exists core.cliente_codigo_fdv_contador_piso();',
      'drop index if exists core.cliente_codigo_fdv_uk;',
      'alter table core.cliente drop constraint if exists cliente_codigo_fdv_origem;',
      'alter table core.cliente drop constraint if exists cliente_codigo_fdv_formato;',
      'alter table core.cliente drop column if exists codigo_fdv;',
    ]) expect(down).toContain(x);
    expect(down.indexOf('drop column if exists codigo_fdv')).toBeLessThan(down.indexOf('cliente_fila_erp'));
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

  describe('Código FDV do cliente (ADR 0069 item 10)', () => {
    const PRE = "insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro, codigo_fdv, deleted_at) values ($1, $2, $3, $4, $5, $6) returning id, codigo_fdv";
    const preCadastro = async (t: string, nome: string, origem = 'campo', codigo: string | null = null, apagado = false) =>
      (await comoApp(t, PRE, [t, nome, origem, origem === 'erp' ? null : 'pendente', codigo, apagado ? new Date().toISOString() : null]))[0] as { id: string; codigo_fdv: string | null };
    const contador = async (t: string) =>
      (await q<{ n: number }>(`select ultimo_sequencial::int as n from ${CONTADOR} where tenant_id = $1`, [t]))[0]?.n ?? 0;

    it('fixture: os clientes da fixture vêm do ERP e ficam sem Código FDV', async () => {
      const r = await q<{ n: number }>("select count(*)::int as n from core.cliente where tenant_id in ($1, $2) and origem_cadastro = 'erp' and codigo_fdv is not null", [A.tenantId, B.tenantId]);
      expect(r[0]!.n).toBe(0);
      for (const id of [A.clientes.c1, A.clientes.c2, A.clientes.c3, B.clientes.c1]) {
        expect((await q<{ codigo_fdv: string | null }>('select codigo_fdv from core.cliente where id = $1', [id]))[0]!.codigo_fdv).toBeNull();
      }
    });

    it('o app insere o pré-cadastro e ganha o próximo número do tenant; cliente do ERP sem código; B tem numeração própria', async () => {
      await emTransacao(admin, null, async () => {
        const doUsuario = async () => (await q<{ n: number }>('select ultimo_sequencial::int as n from core.usuario_codigo_fdv_contador where tenant_id = $1', [A.tenantId]))[0]?.n;
        const usuarioAntes = await doUsuario();
        const baseA = await contador(A.tenantId);
        const baseB = await contador(B.tenantId);
        expect((await preCadastro(A.tenantId, 'Pré Campo')).codigo_fdv).toBe(fdv(baseA + 1));
        expect((await preCadastro(A.tenantId, 'Pré BKO', 'bko')).codigo_fdv).toBe(fdv(baseA + 2));
        expect((await preCadastro(A.tenantId, 'Do ERP', 'erp')).codigo_fdv).toBeNull();
        expect((await preCadastro(B.tenantId, 'Pré Beta')).codigo_fdv).toBe(fdv(baseB + 1));
        expect(await contador(A.tenantId)).toBe(baseA + 2);
        expect(await contador(B.tenantId)).toBe(baseB + 1);
        // o contador do usuário não anda (numeração própria)
        expect(await doUsuario()).toBe(usuarioAntes);
      });
    });

    it('só de leitura: trocar, apagar ou dar código = 23514 cliente_codigo_fdv_somente_leitura; outras colunas passam; ERP com código = 23514', async () => {
      await emTransacao(admin, null, async () => {
        const p = await preCadastro(A.tenantId, 'Pré Leitura');
        const upd = (set: string, id = p.id) => erroComConstraint(admin, `update core.cliente set ${set} where id = '${id}'`);
        const leitura = { code: '23514', constraint: 'cliente_codigo_fdv_somente_leitura', hint: 'RN-CORE-59' };
        expect(await upd("codigo_fdv = '99999'")).toEqual(leitura);
        expect(await upd('codigo_fdv = null')).toEqual(leitura);
        expect(await upd("codigo_fdv = '00001'", A.clientes.c1)).toEqual(leitura); // cliente do ERP não ganha código
        expect(await upd(`codigo_fdv = '${p.codigo_fdv}'`)).toBeNull(); // o mesmo valor
        expect(await upd("razao_social = 'Pré Leitura 2', status_cadastro = 'recusado', motivo_recusa = 'x'")).toBeNull();
        expect((await upd("origem_cadastro = 'erp', status_cadastro = null, motivo_recusa = null"))?.constraint).toBe('cliente_codigo_fdv_origem');
        // pelo papel de aplicação, o mesmo erro
        const app = await erroDe(comoApp(A.tenantId, "update core.cliente set codigo_fdv = '77777' where id = $1", [p.id]));
        expect(app?.code).toBe('23514');
      });
    });

    it('informado no insert fica (substituição do APK v1.0.28: X herda o código de Y apagado); único entre os vivos; formato; contador sobe', async () => {
      await emTransacao(admin, null, async () => {
        const y = await preCadastro(A.tenantId, 'Recusado Y');
        await q('update core.cliente set deleted_at = now() where id = $1', [y.id]); // hora-fixa-ok: só apaga
        const x = await preCadastro(A.tenantId, 'Substituto X', 'campo', y.codigo_fdv);
        expect(x.codigo_fdv).toBe(y.codigo_fdv);
        expect((await q<{ codigo_fdv: string }>('select codigo_fdv from core.cliente where id = $1', [y.id]))[0]!.codigo_fdv).toBe(y.codigo_fdv); // o apagado mantém
        const ins = (codigo: string | null, origem = 'campo') =>
          erroComConstraint(admin, PRE, [A.tenantId, 'Outro', origem, origem === 'erp' ? null : 'pendente', codigo, null]);
        expect(await ins(y.codigo_fdv)).toMatchObject({ code: '23505', constraint: 'cliente_codigo_fdv_uk' });
        for (const ruim of ['00000', '000001', '0100000', '1234', 'A0001']) expect((await ins(ruim))?.constraint, ruim).toBe('cliente_codigo_fdv_formato');
        expect((await ins('00123', 'erp'))?.constraint).toBe('cliente_codigo_fdv_origem');
        const antes = await contador(A.tenantId);
        const alto = antes + 50;
        expect(await ins(fdv(alto))).toBeNull();
        expect(await contador(A.tenantId)).toBe(alto);
        expect((await preCadastro(A.tenantId, 'Depois do alto')).codigo_fdv).toBe(fdv(alto + 1));
      });
    });

    it('passa de 99999 para 100000; o contador nunca diminui (23514); o app não escreve no contador; B não vê o de A; leitura lê o código', async () => {
      await emTransacao(admin, null, async () => {
        await preCadastro(A.tenantId, 'Garante a linha');
        await q(`update ${CONTADOR} set ultimo_sequencial = greatest(ultimo_sequencial, 99998) where tenant_id = $1`, [A.tenantId]);
        expect((await preCadastro(A.tenantId, 'Último de 5')).codigo_fdv).toBe('99999');
        expect((await preCadastro(A.tenantId, 'Primeiro de 6')).codigo_fdv).toBe('100000');
        expect(await erroComConstraint(admin, `update ${CONTADOR} set ultimo_sequencial = 1 where tenant_id = $1`, [A.tenantId])).toMatchObject({
          code: '23514', constraint: 'cliente_codigo_fdv_contador_nao_diminui',
        });
        expect((await erroDe(comoApp(A.tenantId, `update ${CONTADOR} set ultimo_sequencial = ultimo_sequencial + 1`)))?.code).toBe('42501');
        expect((await erroDe(comoApp(A.tenantId, `insert into ${CONTADOR} (tenant_id) values ($1)`, [A.tenantId])))?.code).toBe('42501');
        expect(await comoApp(B.tenantId, `select tenant_id from ${CONTADOR} where tenant_id = $1`, [A.tenantId])).toEqual([]);
        expect((await comoApp(A.tenantId, `select ultimo_sequencial::int as n from ${CONTADOR}`))[0]).toEqual({ n: 100000 });
        const r = await comoPapel(admin, 'macuxi_leitura', "select codigo_fdv from core.cliente where codigo_fdv = '100000'", [], A.tenantId);
        expect(r.rows).toEqual([{ codigo_fdv: '100000' }]);
        expect((await comoPapel(admin, 'macuxi_leitura', `select ultimo_sequencial::int as n from ${CONTADOR}`, [], A.tenantId)).rows).toEqual([{ n: 100000 }]);
      });
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

      // Código FDV: os pré-cadastros vivos por created_at, id; o apagado e o do ERP ficam nulos; contador no maior emitido
      const codigos = async () =>
        Object.fromEntries((await c.query<{ id: string; codigo_fdv: string | null }>('select id, codigo_fdv from core.cliente where tenant_id = $1', [t])).rows.map((r) => [r.id, r.codigo_fdv]));
      expect(await codigos()).toEqual({ [erp]: null, [pend]: '00001', [apr]: '00002', [rec]: '00003', [apagado]: null });
      const lerContador = async (tenant: string) => (await c.query<{ n: number; id: string }>(`select ultimo_sequencial::int as n, id from ${CONTADOR} where tenant_id = $1`, [tenant])).rows;
      expect((await lerContador(t)).map((r) => r.n)).toEqual([3]);
      expect((await c.query<{ n: number }>(`select count(*)::int as n from ${CONTADOR}`)).rows[0]!.n).toBe(1); // tenant sem pré-cadastro vivo: sem linha
      expect((await lerContador(t))[0]!.id).toBe((await c.query<{ id: string }>("select plataforma.uuid_de_chave($1::text || ':core.cliente_codigo_fdv_contador') as id", [t])).rows[0]!.id);
      // o apagado sem código que volta a vivo ganha o próximo número
      await c.query('begin');
      try {
        expect((await c.query('update core.cliente set deleted_at = null where id = $1 returning codigo_fdv', [apagado])).rows[0]!.codigo_fdv).toBe('00004');
      } finally {
        await c.query('rollback');
      }

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

      // revisão 1 em todo pré-cadastro (inclusive o apagado); o updated_at andou neles (pull) e não no do ERP
      const rev = (await c.query<{ id: string; revisao_cadastro: number | null; andou: boolean }>(
        "select id, revisao_cadastro, updated_at > now() - interval '1 day' as andou from core.cliente where tenant_id = $1", [t],
      )).rows;
      expect(Object.fromEntries(rev.map((r) => [r.id, [r.revisao_cadastro, r.andou]]))).toEqual({
        [erp]: [null, false], [pend]: [1, true], [apr]: [1, true], [rec]: [1, true], [apagado]: [1, true],
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
      expect(await codigos()).toEqual({ [erp]: null, [pend]: '00001', [apr]: '00002', [rec]: '00003', [apagado]: null });
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

  it('Código FDV: dois inserts simultâneos do mesmo tenant não repetem número (com e sem a linha do contador); ordem do backup; piso', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: VERSAO });
      const ordem = new Map((await c.query<{ tabela: string; ordem: number }>('select tabela, ordem from plataforma.ordem_do_backup()')).rows.map((r) => [r.tabela, r.ordem]));
      expect(ordem.get(CONTADOR)!).toBeLessThan(ordem.get('core.cliente')!);
    });
    const c1 = new pg.Client({ connectionString: b.urlAdmin });
    const c2 = new pg.Client({ connectionString: b.urlAdmin });
    await c1.connect();
    await c2.connect();
    try {
      const T = '98000000-0000-4000-8000-000000000002';
      await c1.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'conc98', 'Concorrência')", [T]);
      const ins = (c: pg.Client, nome: string) =>
        c.query<{ codigo_fdv: string }>("insert into core.cliente (tenant_id, razao_social, origem_cadastro, status_cadastro) values ($1, $2, 'campo', 'pendente') returning codigo_fdv", [T, nome]);
      const emitidos: string[] = [];
      for (const rodada of [1, 2]) {
        await c1.query('begin');
        await c2.query('begin');
        emitidos.push((await ins(c1, `A${rodada}`)).rows[0]!.codigo_fdv);
        let pronto = false;
        const segundo = ins(c2, `B${rodada}`).then((r) => {
          pronto = true;
          return r.rows[0]!.codigo_fdv;
        });
        await esperar(300);
        expect(pronto, `rodada ${rodada}: o 2º espera a linha do contador`).toBe(false);
        await c1.query('commit');
        emitidos.push(await segundo);
        await c2.query('commit');
      }
      expect(emitidos).toEqual(['00001', '00002', '00003', '00004']);
      // piso: sem a linha do contador (backup restaurado sem ela), o próximo parte do maior código gravado (vivo ou apagado)
      await c1.query('begin');
      try {
        await c1.query("update core.cliente set deleted_at = now() where tenant_id = $1 and codigo_fdv = '00004'", [T]); // hora-fixa-ok: só apaga
        await c1.query(`delete from ${CONTADOR} where tenant_id = $1`, [T]);
        expect((await ins(c1, 'Depois do piso')).rows[0]!.codigo_fdv).toBe('00005');
      } finally {
        await c1.query('rollback');
      }
    } finally {
      await c1.end();
      await c2.end();
    }
  });
});
