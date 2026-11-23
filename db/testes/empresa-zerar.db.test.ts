/**
 * 0099 — "Zerar dados" da empresa (v1.0.31; ADR 0068; desenho docs/desenho/empresa-zerar.md §4, §5 e §11; RN-PLA-12).
 * Dicionário: docs/banco/plataforma.md ("Zerar dados da empresa (0099)"). O que o BANCO garante:
 * - a empresa inteira (entidades nulo) = a rotina do #675: o mesmo estado final, o mesmo resumo e a mesma cópia, nos dados de
 *   scripts/producao/teste/limpar-cadastros-dados.sql (rotina congelada em db/testes/referencia/limpar-cadastros-675.sql);
 * - por entidade: as raízes do mapa, a cascata (o pedido que perde item sai inteiro), o Hub e o cursor só da entidade, o
 *   registro_atual das linhas derrubadas; as outras entidades intactas;
 * - ficam usuários administradores, perfis, credenciais, conectores, plano, licenças e parâmetros; o outro tenant fica intacto;
 * - só o super-admin (sa_* 28000/42501), pedido idempotente pelo id, recusas com o código do contrato no hint (55000
 *   ZERAR_HUB_PROCESSANDO, 22023); prévia = a mesma função desfeita (nada muda) e bate com o executar; tudo ou nada; cópia antes e
 *   restaurar_limpeza volta as contagens; expurgar_zerar só nos vencidos; app, worker e portal sem acesso às tabelas;
 * - up/down exato; a 0099 traz as cópias da public.macuxi_limpeza_backup e o down as devolve.
 * Estático (sempre) + banco efêmero com a fixture dois-tenants (cada caso numa transação desfeita).
 * As constantes do contrato (packages/platform-sdk/src/empresa-zerar.ts) ficam repetidas aqui até o SDK entrar no main com
 * esta migração (PR conjunto alexandre/migracao-zerar).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { PASTA_DB } from '../src/config';
import { TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { agoraDaFixture, semBanco } from './estado';
import { carregarFixtureDosTestes } from './fixture-treinamento';
import { FUNCOES_SA_ATUAIS, FUNCOES_SA_ZERAR, FUNCOES_WORKER_ZERAR } from './funcoes-sa';
import { comoPapel, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m99 = migracoes.find((m) => m.versao === '0099')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m99.up);
const down = semComentarios(m99.down);
/** Do início até o `$$;` que fecha a função. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const nomeDe = (f: string) => f.slice(0, f.indexOf('('));

/** Contrato (packages/platform-sdk/src/empresa-zerar.ts): ENTIDADES_ZERAR, limites, situações, modos e lote. */
const ENTIDADES_ZERAR = [
  'filial', 'vendedor', 'catalogo_no', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco',
  'tabela_escalonada', 'estoque', 'cliente', 'cliente_endereco', 'transportadora', 'rota', 'titulo', 'nota',
];
const LIMITE_LINHAS_ZERAR = 2_000_000;
const RETENCAO_COPIA_ZERAR_DIAS = 7;
const SITUACOES_ZERAR = ['em_andamento', 'concluido', 'falhou'];
const MODOS_LIMPEZA = ['soft', 'fisico', 'filial', 'sync_pacote', 'girar'];
const LOTE_LIMPEZA_FORMATO = /^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$/;

const TABELAS = ['plataforma.zerar_empresa', 'plataforma.limpeza_copia'];
/** Sem EXECUTE para ninguém (só o dono e as SECURITY DEFINER de mesmo dono): a regra, a volta, o descarte e as internas. */
const DO_DONO = [
  'plataforma.limpar_cadastros(uuid, text, text[], boolean)',
  'plataforma.mapa_limpeza_entidades()',
  'plataforma.entidades_limpeza_ordenadas(text[])',
  'plataforma.entidades_afetadas_limpeza(jsonb, text[])',
  'plataforma.restaurar_limpeza(uuid, text)',
  'plataforma.descartar_limpeza(uuid, text)',
  'plataforma.zerar_bloqueado(uuid, uuid, bigint)',
  'plataforma.zerar_empresa_json(plataforma.zerar_empresa)',
];
/** Saíram do desenho anterior da 0099 (não podem existir). */
const SAIRAM = [
  'zerar_tenant', 'zerar_tenant_manual', 'restaurar_zerar', 'tabelas_mantidas_no_zerar', 'alvos_do_zerar', 'previa_do_zerar',
  'objetos_do_expurgo_zerar', 'fechar_expurgo_zerar', 'tabelas_com_tenant', 'passos_em_ordem_fk', 'apagar_em_ordem_fk',
];
/** Os dados de exemplo do #675 (kit antigo e ERP novo) e a rotina de referência. */
const DADOS_675 = readFileSync(join(PASTA_DB, '..', 'scripts', 'producao', 'teste', 'limpar-cadastros-dados.sql'), 'utf8');
const ROTINA_675 = readFileSync(join(PASTA_DB, 'testes', 'referencia', 'limpar-cadastros-675.sql'), 'utf8');
/** O bloco `do $$ ... end $$;` dos dados (sem os comandos do psql); lê o tenant de app.tenant_id. */
const BLOCO_DADOS = DADOS_675.slice(DADOS_675.indexOf('do $$'), DADOS_675.lastIndexOf('end $$;') + 'end $$;'.length);

describe('0099 zerar dados da empresa (estático)', () => {
  it('nome e posição: 0099_plataforma_zerar_empresa logo depois da 0098; a excluir_tenant fica a da 0032', () => {
    const i = migracoes.findIndex((m) => m.versao === '0099');
    expect(`${m99.versao}_${m99.nome}`).toBe('0099_plataforma_zerar_empresa');
    expect(migracoes[i - 1]?.versao).toBe('0098');
    expect(up).not.toMatch(/excluir_tenant/);
    expect(down).not.toMatch(/excluir_tenant/);
    for (const f of SAIRAM) expect(up, f).not.toMatch(new RegExp(`plataforma\\.${f}\\(`));
  });

  it('as 2 tabelas: só por função (sem grant), RLS forçado, só a política manutencao; sem tenant_id nem FK', () => {
    for (const t of TABELAS) {
      expect(TABELAS_SO_POR_FUNCAO, t).toContain(t);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(up).toContain(`revoke all on ${t} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
    }
    for (const t of TABELAS) expect(TABELAS_SEM_TENANT_ID, t).toHaveProperty([t]);
    expect(up).not.toMatch(/\breferences\b/);
    expect([...up.matchAll(/\bgrant ([^;]+);/g)].map((x) => x[1]!).filter((g) => !g.startsWith('execute on function '))).toEqual([]);
  });

  it('limpeza_copia: as 6 primeiras colunas = as da public.macuxi_limpeza_backup do #675, na mesma ordem (tenant em empresa_id); a 0099 move e apaga a public', () => {
    const colunas = (sql: string, tabela: string) =>
      new RegExp(`create table (?:if not exists )?${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\s*\\);`).exec(sql)![1]!
        .split('\n').map((l) => l.trim().split(/\s+/)[0]!).filter((c) => c && c !== 'constraint');
    const do675 = colunas(ROTINA_675, 'public.macuxi_limpeza_backup');
    expect(do675).toEqual(['lote', 'tenant_id', 'tabela', 'modo', 'linha', 'copiado_em']);
    // a mesma ordem; o tenant vira empresa_id (sem FK, como nas tabelas da 0072)
    expect(colunas(up, 'plataforma.limpeza_copia').slice(0, 6)).toEqual(do675.map((c) => (c === 'tenant_id' ? 'empresa_id' : c)));
    expect(colunas(down, 'public.macuxi_limpeza_backup')).toEqual(do675);
    expect(up).toContain("constraint limpeza_copia_modo_valido check (modo in ('soft', 'fisico', 'filial', 'sync_pacote'))");
    expect(ROTINA_675).toContain("modo text not null check (modo in ('soft', 'fisico', 'filial', 'sync_pacote'))");
    expect(up).toContain('drop table public.macuxi_limpeza_backup;');
  });

  it('listas do contrato: situações, lote, modos, 7 dias e 2 milhões', () => {
    const lista = (re: RegExp) => [...(re.exec(up)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(lista(/constraint zerar_empresa_situacao_valida check \(situacao in \(([^)]+)\)\)/)).toEqual(SITUACOES_ZERAR);
    expect(up).toContain(`'${LOTE_LIMPEZA_FORMATO.source}'`);
    const modos = new Set(['soft', 'fisico', ...[...up.matchAll(/insert into _limpeza_resumo values \(\d+, '[a-z_.]+', '([a-z_]+)'/g)].map((x) => x[1]!)]);
    expect([...modos].sort()).toEqual([...MODOS_LIMPEZA].sort());
    const executar = bloco(up, 'create function plataforma.executar_zerar(');
    expect(executar).toContain(`copia_expira_em = v_agora + interval '${RETENCAO_COPIA_ZERAR_DIAS} days'`);
    expect(executar).toContain(`if v_total > ${LIMITE_LINHAS_ZERAR} then`);
    expect(bloco(up, 'create function plataforma.zerar_bloqueado(')).toContain(`if p_total > ${LIMITE_LINHAS_ZERAR} then`);
  });

  it('zerar_bloqueado: as recusas da conferirZerar na mesma ordem (exclusão, zerar, backup, Hub, volume)', () => {
    const b = bloco(up, 'create function plataforma.zerar_bloqueado(');
    const ordem = ['TENANT_NAO_ENCONTRADO', 'EXCLUSAO_EM_ANDAMENTO', 'ZERAR_EM_ANDAMENTO', 'BACKUP_EM_ANDAMENTO', 'ZERAR_HUB_PROCESSANDO', 'ZERAR_VOLUME_ALTO'];
    const pos = ordem.map((c) => b.indexOf(`return '${c}';`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it('funções: sa_* só ao portal (28000/42501), as do worker só ao worker e sem argumento de tenant, as do dono de ninguém', () => {
    for (const f of FUNCOES_SA_ZERAR) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b, f).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
      expect(b, f).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(FUNCOES_SA_ATUAIS).toHaveLength(41);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_ZERAR]));
    expect(up).toContain('if v_n <> 41 then');
    for (const f of FUNCOES_WORKER_ZERAR) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b.slice(0, b.indexOf(')')), f).not.toMatch(/tenant/);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_worker;`);
    }
    for (const f of DO_DONO) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      const esperado = f.startsWith('plataforma.limpar_cadastros(')
        ? /security definer\s+set search_path = pg_catalog, pg_temp\s/
        : /security invoker\s+set search_path = pg_catalog, (plataforma, )?pg_temp\s/;
      expect(b, f).toMatch(esperado);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).not.toContain(`grant execute on function ${f} `);
    }
  });

  it('auditoria sem dado pessoal; códigos do contrato no hint', () => {
    for (const c of ['TENANT_NAO_ENCONTRADO', 'ZERAR_CODIGO_NAO_CONFERE', 'ZERAR_HUB_PROCESSANDO', 'ZERAR_VOLUME_ALTO']) expect(up).toContain(`hint = '${c}'`);
    const aud = up.split('\n').filter((l) => /sa_registrar_auditoria|jsonb_build_object\('(zerar_id|tenant_id)'/.test(l)).join('\n');
    expect(aud).not.toMatch(/nome|email|cnpj|documento|razao|senha/);
  });

  it('down: apaga o que o up cria e devolve as cópias à public, sem grant', () => {
    for (const f of [...FUNCOES_SA_ZERAR, ...FUNCOES_WORKER_ZERAR, ...DO_DONO]) expect(down, f).toContain(`drop function if exists ${f};`);
    for (const t of TABELAS) expect(down).toContain(`drop table if exists ${t};`);
    expect(down.indexOf('insert into public.macuxi_limpeza_backup')).toBeLessThan(down.indexOf('drop table if exists plataforma.limpeza_copia;'));
    expect(down.indexOf('drop table if exists plataforma.zerar_empresa;')).toBeLessThan(down.indexOf('drop function if exists plataforma.entidades_limpeza_ordenadas(text[]);'));
    expect(down).not.toMatch(/\bgrant\b/);
  });

  it('referência do #675: a limpar_cadastros traz as mesmas listas e a mesma cascata', () => {
    const corpo = bloco(up, 'create function plataforma.limpar_cadastros(');
    for (const c of ['c_hub', 'c_filas', 'c_derivados', 'c_fica', 'c_nome', 'c_posse', 'c_plataforma', 'c_schemas']) {
      const re = new RegExp(`  ${c} constant [a-z[\\]]+ := ([\\s\\S]*?);\\n`);
      expect(re.exec(corpo)?.[1], c).toBe(re.exec(ROTINA_675)?.[1]);
    }
    const cascata = (s: string) => s.slice(s.indexOf('  with tabelas as ('), s.indexOf("   where x.alvo <> 'core.usuario' or x.coluna = any (c_posse);"));
    expect(cascata(corpo).length).toBeGreaterThan(500);
    expect(cascata(corpo)).toBe(cascata(ROTINA_675));
  });
});

describe.skipIf(semBanco())('0099 zerar dados da empresa (banco efêmero, fixture dois-tenants + dados do #675)', () => {
  let b: BancoDeTeste;
  let admin: pg.Client;
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  /** O lote do portal leva os 8 primeiros dígitos do id: cada id do teste tem os seus (009900nn). */
  const id = (n: number) => `009900${String(n).padStart(2, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const LOTE = '20261123T190000Z';

  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarFixtureDosTestes(c, { agora: agoraDaFixture() }) });
    admin = new pg.Client({ connectionString: b.urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await b?.apagar();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await comoPapel<{ r: T }>(admin, 'macuxi_portal', sql, params)).rows[0]!.r;
  const worker = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await comoPapel<{ r: T }>(admin, 'macuxi_worker', sql, params)).rows[0]!.r;
  const abrir = async (p: unknown) => (await comoPapel<{ sessao_id: string }>(admin, 'macuxi_portal', 'select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)])).rows[0]!;
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.zerar@macuxi.exemplo', nome: 'Operador 0099', senha_hash: HASH_TESTE })]))[0]!.r;
    return (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id })).sessao_id;
  }
  /** SQLSTATE e hint do erro (o hint leva o código do contrato). */
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      const x = e as { code?: string; hint?: string };
      return { code: x.code, hint: x.hint ?? null };
    }
  };
  /** Comando do admin que deve falhar, num savepoint (o erro não aborta a transação do caso): SQLSTATE e hint. */
  async function falhaAdmin(sql: string, params: unknown[] = []) {
    await admin.query('savepoint falha_admin');
    const e = await falha(admin.query(sql, params));
    await admin.query(e ? 'rollback to savepoint falha_admin' : 'release savepoint falha_admin');
    return e;
  }
  /** Transação do caso, sempre desfeita (o banco efêmero volta à fixture), com os dados do #675 nos dois tenants. */
  async function caso(fn: () => Promise<void>) {
    await admin.query('begin');
    try {
      for (const t of [A.tenantId, B.tenantId]) {
        await admin.query("select set_config('app.tenant_id', $1, true)", [t]);
        await admin.query(BLOCO_DADOS);
      }
      // retrato por tabela do tenant: hash da linha inteira, vivas e total (a limpeza_copia fica fora: é a cópia)
      await admin.query(`create function pg_temp.retrato(p_tenant uuid) returns table (tabela text, hash text, vivas bigint, total bigint)
        language plpgsql as $f$
        declare r record; begin
          for r in select n.nspname || '.' || c.relname as nome from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
                   where c.relkind = 'r' and n.nspname in ('core','catalogo','vendedor','promotor','pesquisa','treinamento','gestor','integracao','plataforma')
                     and n.nspname || '.' || c.relname <> 'plataforma.limpeza_copia' order by 1 loop
            tabela := r.nome;
            execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' order by to_jsonb(t)::text), '''')), count(*) filter (where (to_jsonb(t) ->> ''deleted_at'') is null), count(*) from %s t where t.tenant_id = %L', r.nome, p_tenant)
              into hash, vivas, total;
            return next;
          end loop;
          -- a geracao_base gira por sequência (não volta no rollback): fica fora; o giro aparece no resumo (modo girar)
          tabela := 'plataforma.tenant';
          select md5((to_jsonb(t) - 'geracao_base')::text), 1, 1 into hash, vivas, total from plataforma.tenant t where t.id = p_tenant;
          return next;
        end $f$`);
      await fn();
    } finally {
      await admin.query('rollback');
    }
  }
  type Retrato = Record<string, { hash: string; vivas: number; total: number }>;
  async function retrato(tenant: string): Promise<Retrato> {
    const r: Retrato = {};
    for (const x of await q<{ tabela: string; hash: string; vivas: string; total: string }>('select * from pg_temp.retrato($1)', [tenant])) {
      r[x.tabela] = { hash: x.hash, vivas: Number(x.vivas), total: Number(x.total) };
    }
    return r;
  }
  const mudaram = (a: Retrato, d: Retrato) => Object.keys(a).filter((t) => a[t]!.hash !== d[t]?.hash).sort();
  const contagens = (r: Retrato, campo: 'vivas' | 'total') => Object.fromEntries(Object.entries(r).map(([t, v]) => [t, v[campo]]));
  type Linha = { r_ordem: number; r_tabela: string; r_modo: string; r_linhas: string };
  const limpar = (tenant: string, lote: string, entidades: string[] | null, exigir = true) =>
    q<Linha>('select * from plataforma.limpar_cadastros($1, $2, $3::text[], $4)', [tenant, lote, entidades, exigir]);
  const soft = (l: Linha[]) => l.filter((x) => x.r_modo === 'soft' && Number(x.r_linhas) > 0).map((x) => x.r_tabela);
  const comoLista = (l: Linha[]) => JSON.stringify(l.map((x) => ({ tabela: x.r_tabela, modo: x.r_modo, linhas: Number(x.r_linhas) })));
  const afetadas = async (l: Linha[], entidades: string[]) =>
    (await q<{ r: string[] }>('select plataforma.entidades_afetadas_limpeza($1::jsonb, $2::text[]) as r', [comoLista(l), entidades]))[0]!.r;
  const vivo = async (tabela: string, idLinha: string) => (await q<{ v: boolean }>(`select deleted_at is null as v from ${tabela} where id = $1`, [idLinha]))[0]?.v;
  const contar = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0]!.n);
  const processando = (tenant: string) =>
    q("update integracao.lote set status = 'processando' where tenant_id = $1 and chave_idempotencia = 'chave-erp-produto-0001'", [tenant]);
  /** Mantidos (RN-PLA-12): plano, licenças, perfis, parâmetros, conectores, credenciais, mapeamentos e configurações. */
  const MANTIDOS = ['plataforma.assinatura', 'plataforma.tenant_modulo', 'plataforma.perfil', 'plataforma.perfil_modulo',
    'plataforma.perfil_permissao', 'plataforma.parametro', 'integracao.conector', 'integracao.credencial', 'integracao.credencial_erp',
    'integracao.mapeamento', 'core.equipe', 'core.medida', 'core.motivo'];

  it('mapa: as 16 chaves = ENTIDADES_ZERAR, na ordem de carga; ordenadas e afetadas', async () => {
    await caso(async () => {
      const chaves = await q<{ k: string }>("select e.key as k from jsonb_each(plataforma.mapa_limpeza_entidades()) e order by (e.value ->> 'ordem')::int");
      expect(chaves.map((x) => x.k)).toEqual(ENTIDADES_ZERAR);
      expect((await q<{ r: string[] }>("select plataforma.entidades_limpeza_ordenadas(array['nota', 'cliente', 'filial', 'x']) as r"))[0]!.r).toEqual(['filial', 'cliente', 'nota']);
      const afet = await q<{ r: string[] }>(
        `select plataforma.entidades_afetadas_limpeza('[{"tabela":"core.cliente_endereco","modo":"soft","linhas":2},{"tabela":"catalogo.tabela_preco_item","modo":"soft","linhas":0},{"tabela":"core.filial","modo":"filial","linhas":1}]', array['cliente']) as r`,
      );
      expect(afet[0]!.r).toEqual(['filial', 'cliente', 'cliente_endereco']);
    });
  });

  it('acesso: 42501 nas 2 tabelas para app, worker e portal; funções só pelo papel certo; as que saíram não existem', async () => {
    await caso(async () => {
      for (const t of TABELAS) {
        for (const papel of ['macuxi_app', 'macuxi_worker', 'macuxi_portal']) {
          expect((await erroDe(comoPapel(admin, papel, `select 1 from ${t} limit 1`)))?.code, `${papel} ${t}`).toBe('42501');
        }
      }
      const r = await q<{ f: string; app: boolean; worker: boolean; portal: boolean; definer: boolean }>(
        `select f, has_function_privilege('macuxi_app', f::regprocedure, 'execute') as app,
                has_function_privilege('macuxi_worker', f::regprocedure, 'execute') as worker,
                has_function_privilege('macuxi_portal', f::regprocedure, 'execute') as portal,
                (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) as definer
           from unnest($1::text[]) f`,
        [[...FUNCOES_SA_ZERAR, ...FUNCOES_WORKER_ZERAR, ...DO_DONO]],
      );
      expect(r).toHaveLength(FUNCOES_SA_ZERAR.length + FUNCOES_WORKER_ZERAR.length + DO_DONO.length);
      for (const x of r) {
        const sa = (FUNCOES_SA_ZERAR as readonly string[]).includes(x.f);
        const wk = (FUNCOES_WORKER_ZERAR as readonly string[]).includes(x.f);
        expect(x).toEqual({ f: x.f, app: false, worker: wk, portal: sa, definer: sa || wk || x.f.startsWith('plataforma.limpar_cadastros(') });
      }
      for (const f of SAIRAM) expect(await q('select 1 from pg_proc where proname = $1', [f]), f).toEqual([]);
    });
  });

  it('só o super-admin: sessão inválida 28000, admin do cliente 42501', async () => {
    await caso(async () => {
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A.tenantId, usuario_id: A.usuarios.admin }] });
      for (const [sql, args] of [
        ['select plataforma.sa_previa_zerar($1, $2, null) as r', [A.tenantId]],
        ['select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [A.tenantId, id(1), A.codigo]],
        ['select plataforma.sa_ler_zerar($1, $2) as r', [A.tenantId]],
      ] as const) {
        expect((await falha(portal(sql, [null, ...args])))?.code, sql).toBe('28000');
        expect((await falha(portal(sql, [cli.sessao_id, ...args])))?.code, sql).toBe('42501');
      }
      expect(await q('select 1 from plataforma.zerar_empresa')).toEqual([]);
    });
  });

  it('empresa inteira = a rotina do #675: mesmo estado final, mesmo resumo e mesma cópia; mantidos e o outro tenant intactos', async () => {
    await caso(async () => {
      await admin.query(ROTINA_675);
      const antesA = await retrato(A.tenantId);
      const antesB = await retrato(B.tenantId);
      await admin.query('savepoint rotina');
      const r675 = await q<Linha>('select * from pg_temp.macuxi_limpar_cadastros($1, $2, true)', [A.tenantId, LOTE]);
      const depois675 = await retrato(A.tenantId);
      const copia675 = (await q<{ l: string }>('select tabela || modo || linha::text as l from public.macuxi_limpeza_backup where lote = $1', [LOTE])).map((x) => x.l).sort();
      await admin.query('rollback to savepoint rotina');
      expect(await retrato(A.tenantId)).toEqual(antesA);

      const r99 = await limpar(A.tenantId, LOTE, null);
      const depois99 = await retrato(A.tenantId);
      const copia99 = (await q<{ l: string }>('select tabela || modo || linha::text as l from plataforma.limpeza_copia where lote = $1', [LOTE])).map((x) => x.l).sort();
      // a mesma transação (o mesmo now()): o estado final é idêntico, tabela por tabela, inclusive updated_at e deleted_at
      expect(mudaram(depois675, depois99)).toEqual([]);
      expect(mudaram(antesA, depois99).length).toBeGreaterThan(50);
      expect(copia99).toEqual(copia675);
      expect(copia99.length).toBeGreaterThan(200);
      // o resumo: os mesmos números, com o nome puro da tabela (as linhas extras do #675 traziam o rótulo depois do nome)
      const norm = (l: Linha[]) => l.map((x) => `${x.r_ordem} ${x.r_tabela.split(' ')[0]} ${x.r_modo} ${x.r_linhas}`).sort();
      expect(norm(r99)).toEqual(norm(r675));
      expect(r99.filter((x) => x.r_ordem >= 200).map((x) => [x.r_tabela, x.r_modo])).toEqual([
        ['plataforma.evento', 'soft'], ['core.filial', 'filial'], ['plataforma.sync_pacote', 'sync_pacote'], ['plataforma.tenant', 'girar'],
      ]);
      // o que fica e o outro tenant
      expect(mudaram(antesB, await retrato(B.tenantId))).toEqual([]);
      const mudou = mudaram(antesA, depois99);
      expect(MANTIDOS.filter((t) => mudou.includes(t))).toEqual([]);
      expect(await vivo('core.usuario', A.usuarios.admin)).toBe(true);
      expect(await vivo('core.usuario', A.usuarios.vendedor1)).toBe(false);
      expect(await contar('select count(*) as n from integracao.credencial where tenant_id = $1 and deleted_at is null and revogada_em is null', [A.tenantId])).toBeGreaterThan(0);
      expect(await contar('select count(*) as n from integracao.registro_atual where tenant_id = $1', [A.tenantId])).toBe(0);
      expect(await afetadas(r99, [])).toEqual(expect.arrayContaining(['filial', 'vendedor', 'produto', 'cliente', 'titulo']));
    });
  });

  it('por entidade (cliente): clientes do ERP, endereços e os pedidos deles saem; produtos, Hub e cursor de produto ficam', async () => {
    await caso(async () => {
      // um pedido da fixture passa a ser de um cliente do ERP; um endereço do ERP com registro no Hub; cursor de cliente
      const ped = (await q<{ id: string; cliente_id: string }>('select id, cliente_id from vendedor.pedido where tenant_id = $1 and deleted_at is null order by id limit 1', [A.tenantId]))[0]!;
      await q("update core.cliente set external_id = 'ERP-CLI-PED' where id = $1", [ped.cliente_id]);
      const end = (await q<{ id: string }>("select e.id from core.cliente_endereco e join core.cliente c on c.id = e.cliente_id where c.external_id = 'ERP-CLI-1' and e.tenant_id = $1", [A.tenantId]))[0]!;
      await q("update core.cliente_endereco set external_id = 'ERP-END-1' where id = $1", [end.id]);
      const con = (await q<{ id: string }>("select id from integracao.conector where tenant_id = $1 and identificador = 'macuxierp'", [A.tenantId]))[0]!.id;
      await q("insert into integracao.registro_atual (tenant_id, entidade, conector_id, external_id, hash, alterado_em) values ($1, 'cliente_endereco', $2, 'ERP-END-1', repeat('c', 64), now()), ($1, 'cliente_endereco', $2, 'OUTRO-END', repeat('c', 64), now())", [A.tenantId, con]);
      await q("insert into integracao.cursor_entidade (tenant_id, conector_id, entidade) values ($1, $2, 'cliente')", [A.tenantId, con]);
      const antesA = await retrato(A.tenantId);
      const antesB = await retrato(B.tenantId);
      const hub = async (entidade: string) => ({
        registro: await contar('select count(*) as n from integracao.registro_atual where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
        cursor: await contar('select count(*) as n from integracao.cursor_entidade where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
        lote: await contar('select count(*) as n from integracao.lote where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
      });
      const produtoAntes = await hub('produto');
      expect(produtoAntes.registro).toBeGreaterThan(0);
      expect(produtoAntes.cursor).toBeGreaterThan(0);
      const clientesErp = await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null and external_id is not null', [A.tenantId]);
      const clientesSem = await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null and external_id is null', [A.tenantId]);

      const r = await limpar(A.tenantId, LOTE, ['cliente']);
      const linhas = (t: string) => Number(r.find((x) => x.r_tabela === t)?.r_linhas ?? 0);
      expect(linhas('core.cliente')).toBe(clientesErp);
      expect(await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null', [A.tenantId])).toBe(clientesSem);
      expect(await vivo('core.cliente_endereco', end.id)).toBe(false);
      expect(await vivo('vendedor.pedido', ped.id)).toBe(false);
      expect(await contar('select count(*) as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [ped.id])).toBe(0);
      // o Hub: cliente inteiro (cursor incluso); do endereço só o registro da linha derrubada; o de produto intacto
      expect(await hub('cliente')).toEqual({ registro: 0, cursor: 0, lote: 0 });
      expect(await contar("select count(*) as n from integracao.registro_atual where tenant_id = $1 and entidade = 'cliente_endereco'", [A.tenantId])).toBe(1);
      expect(await hub('produto')).toEqual(produtoAntes);
      const mudou = mudaram(antesA, await retrato(A.tenantId));
      for (const t of ['core.produto', 'core.produto_unidade', 'catalogo.tabela_preco', 'catalogo.tabela_preco_item', 'catalogo.estoque_saldo', 'core.usuario', 'core.filial', ...MANTIDOS]) {
        expect(mudou, t).not.toContain(t);
      }
      expect(soft(r)).toEqual(expect.arrayContaining(['core.cliente', 'core.cliente_endereco', 'vendedor.pedido', 'vendedor.pedido_item']));
      expect(r.find((x) => x.r_tabela === 'core.filial')).toBeUndefined();
      expect(mudaram(antesB, await retrato(B.tenantId))).toEqual([]);
      // os títulos e as notas do cliente saem pela cascata: o ERP reenvia também essas entidades
      expect(await afetadas(r, ['cliente'])).toEqual(['cliente', 'cliente_endereco', 'titulo', 'nota']);
    });
  });

  it('por entidade (produto): o pedido com item do produto sai inteiro; os clientes ficam; afetadas trazem as dependentes', async () => {
    await caso(async () => {
      const it0 = (await q<{ id: string; pedido_id: string; produto_id: string }>('select id, pedido_id, produto_id from vendedor.pedido_item where tenant_id = $1 and deleted_at is null order by id limit 1', [A.tenantId]))[0]!;
      await q("update core.produto set external_id = 'ERP-PRD-PED' where id = $1", [it0.produto_id]);
      const itens = await contar('select count(*) as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [it0.pedido_id]);
      const clientes = await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null', [A.tenantId]);
      const r = await limpar(A.tenantId, LOTE, ['produto']);
      expect(itens).toBeGreaterThan(0);
      expect(await vivo('vendedor.pedido', it0.pedido_id)).toBe(false);
      expect(await contar('select count(*) as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [it0.pedido_id])).toBe(0);
      expect(await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null', [A.tenantId])).toBe(clientes);
      expect(await contar("select count(*) as n from integracao.registro_atual where tenant_id = $1 and entidade = 'produto'", [A.tenantId])).toBe(0);
      const afet = await afetadas(r, ['produto']);
      expect(afet).toEqual(expect.arrayContaining(['produto', 'produto_unidade', 'preco', 'estoque']));
      expect(afet).not.toContain('cliente');
    });
  });

  it('por entidade (filial): só o external_id das filiais sai; nenhuma linha soft', async () => {
    await caso(async () => {
      const com = await contar('select count(*) as n from core.filial where tenant_id = $1 and deleted_at is null and external_id is not null', [A.tenantId]);
      const antesA = await retrato(A.tenantId);
      const r = await limpar(A.tenantId, LOTE, ['filial']);
      expect(com).toBeGreaterThan(0);
      expect(soft(r)).toEqual([]);
      expect(r.find((x) => x.r_tabela === 'core.filial')).toMatchObject({ r_modo: 'filial', r_linhas: String(com) });
      expect(await contar('select count(*) as n from core.filial where tenant_id = $1 and external_id is not null', [A.tenantId])).toBe(0);
      const mudou = mudaram(antesA, await retrato(A.tenantId));
      expect(mudou).toContain('core.filial');
      expect(mudou.filter((t) => !['core.filial', 'plataforma.tenant', 'plataforma.sync_pacote'].includes(t))).toEqual([]);
      expect(await afetadas(r, ['filial'])).toEqual(['filial']);
    });
  });

  it('recusas: entidades e lote inválidos 22023; lote repetido 23505; Hub processando 55000 ZERAR_HUB_PROCESSANDO; volume', async () => {
    await caso(async () => {
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, array['xis'])", [A.tenantId, LOTE]))?.code).toBe('22023');
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, array['cliente', 'cliente'])", [A.tenantId, LOTE]))?.code).toBe('22023');
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, '{}'::text[])", [A.tenantId, LOTE]))?.code).toBe('22023');
      expect((await falhaAdmin('select * from plataforma.limpar_cadastros($1, $2)', [A.tenantId, '2026-11-23']))?.code).toBe('22023');
      await limpar(A.tenantId, LOTE, ['nota']);
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, array['titulo'])", [A.tenantId, LOTE]))?.code).toBe('23505');
      await processando(A.tenantId);
      expect(await falhaAdmin("select * from plataforma.limpar_cadastros($1, '20261123T190500Z', array['cliente'])", [A.tenantId])).toEqual({ code: '55000', hint: 'ZERAR_HUB_PROCESSANDO' });
      // sem exigir o Hub parado (prévia e simular) a função roda
      expect((await limpar(A.tenantId, '20261123T190600Z', ['cliente'], false)).length).toBeGreaterThan(0);
      expect((await q<{ r: string | null }>('select plataforma.zerar_bloqueado($1, null, null) as r', [A.tenantId]))[0]!.r).toBe('ZERAR_HUB_PROCESSANDO');
      expect((await q<{ r: string | null }>('select plataforma.zerar_bloqueado($1, null, $2) as r', [B.tenantId, LIMITE_LINHAS_ZERAR + 1]))[0]!.r).toBe('ZERAR_VOLUME_ALTO');
      expect((await q<{ r: string | null }>('select plataforma.zerar_bloqueado($1, null, $2) as r', [B.tenantId, LIMITE_LINHAS_ZERAR]))[0]!.r).toBeNull();
    });
  });

  it('portal e worker: prévia não muda nada e bate com o executar; pedido idempotente; 409 e 422; volta pela cópia', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      const antesA = await retrato(A.tenantId);
      type Previa = { total_linhas: number; tabelas: { tabela: string; modo: string; linhas: number }[]; entidades: string[]; entidades_afetadas: string[]; bloqueio: string | null; codigo: string };
      const previa = await portal<Previa>('select plataforma.sa_previa_zerar($1, $2, $3::text[]) as r', [sid, A.tenantId, ['cliente_endereco', 'cliente']]);
      expect(mudaram(antesA, await retrato(A.tenantId))).toEqual([]);
      expect(await q('select 1 from plataforma.limpeza_copia')).toEqual([]);
      expect(previa).toMatchObject({ codigo: A.codigo, entidades: ['cliente', 'cliente_endereco'], entidades_afetadas: ['cliente', 'cliente_endereco', 'titulo'], bloqueio: null });
      expect(previa.tabelas.every((t) => t.linhas > 0 && MODOS_LIMPEZA.includes(t.modo) && /^[a-z_]+\.[a-z_]+$/.test(t.tabela))).toBe(true);
      expect(previa.total_linhas).toBe(previa.tabelas.filter((t) => t.modo === 'soft' || t.modo === 'fisico').reduce((s, t) => s + t.linhas, 0));
      expect((await falha(portal("select plataforma.sa_previa_zerar($1, $2, array['xis']) as r", [sid, A.tenantId])))?.code).toBe('22023');

      // Hub processando: 409 no pedido e bloqueio na prévia; código errado 422
      await processando(A.tenantId);
      expect(await falha(portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(9), A.codigo]))).toEqual({ code: '55000', hint: 'ZERAR_HUB_PROCESSANDO' });
      expect((await portal<Previa>('select plataforma.sa_previa_zerar($1, $2) as r', [sid, A.tenantId])).bloqueio).toBe('ZERAR_HUB_PROCESSANDO');
      await q("update integracao.lote set status = 'concluido_com_erros' where tenant_id = $1 and chave_idempotencia = 'chave-erp-produto-0001'", [A.tenantId]);
      expect(await falha(portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(9), 'outro']))).toEqual({ code: '22023', hint: 'ZERAR_CODIGO_NAO_CONFERE' });
      expect((await falha(portal("select plataforma.sa_pedir_zerar($1, $2, $3, $4, array['xis']) as r", [sid, A.tenantId, id(9), A.codigo])))?.code).toBe('22023');

      const pedido = await portal<{ id: string; lote: string; situacao: string; entidades: string[] }>(
        'select plataforma.sa_pedir_zerar($1, $2, $3, $4, $5::text[]) as r', [sid, A.tenantId, id(1), ` ${A.codigo.toUpperCase()} `, ['cliente_endereco', 'cliente']]);
      expect(pedido).toMatchObject({ id: id(1), situacao: 'em_andamento', entidades: ['cliente', 'cliente_endereco'], entidades_afetadas: null });
      expect(pedido.lote).toMatch(/^[0-9]{8}T[0-9]{6}Z-00990001$/);
      expect(await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(1), 'qualquer'])).toEqual(pedido);
      expect(await falha(portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(2), A.codigo]))).toEqual({ code: '55000', hint: 'ZERAR_EM_ANDAMENTO' });
      expect(await portal('select plataforma.sa_ler_zerar($1, $2) as r', [sid, A.tenantId])).toEqual(pedido);

      expect((await comoPapel(admin, 'macuxi_worker', 'select id, empresa_id from plataforma.pegar_zerar()')).rows).toEqual([{ id: id(1), empresa_id: A.tenantId }]);
      expect((await comoPapel(admin, 'macuxi_worker', 'select id, empresa_id from plataforma.pegar_zerar()')).rows).toEqual([]);
      type Feito = { situacao: string; contagem: unknown[]; linhas_apagadas: number; entidades_afetadas: string[]; lote: string };
      const feito = await worker<Feito>('select plataforma.executar_zerar($1) as r', [id(1)]);
      expect(feito).toMatchObject({ situacao: 'concluido', linhas_apagadas: previa.total_linhas, entidades_afetadas: previa.entidades_afetadas, lote: pedido.lote });
      expect(feito.contagem).toEqual(previa.tabelas);
      expect(await worker('select plataforma.executar_zerar($1) as r', [id(1)])).toEqual(feito);
      expect(await falha(worker("select plataforma.fechar_zerar($1, 'ZERAR_FALHOU') as r", [id(1)]))).toMatchObject({ code: '55000' });
      const aud = await q<{ acao: string; detalhes: Record<string, unknown> }>("select acao, detalhes from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao like 'tenant.zera%'", [A.tenantId]);
      expect(aud.map((x) => x.acao).sort()).toEqual(['tenant.zerado', 'tenant.zerar_pedido']);
      expect(Object.keys(aud.find((x) => x.acao === 'tenant.zerado')!.detalhes).sort()).toEqual(['codigo', 'copia_expira_em', 'entidades', 'linhas_apagadas', 'lote', 'tenant_id', 'zerado_em', 'zerar_id']);

      // cópia antes e volta: restaurar_limpeza devolve as contagens de toda tabela
      expect(await contar('select count(*) as n from plataforma.limpeza_copia where lote = $1', [pedido.lote])).toBeGreaterThan(0);
      expect(contagens(await retrato(A.tenantId), 'vivas')).not.toEqual(contagens(antesA, 'vivas'));
      await q('select * from plataforma.restaurar_limpeza($1, $2)', [A.tenantId, pedido.lote]);
      const voltou = await retrato(A.tenantId);
      expect(contagens(voltou, 'vivas')).toEqual(contagens(antesA, 'vivas'));
      expect(contagens(voltou, 'total')).toEqual(contagens(antesA, 'total'));
      expect((await q<{ d: boolean }>('select desfeito_em is not null as d from plataforma.zerar_empresa where id = $1', [id(1)]))[0]!.d).toBe(true);
      expect(await contar("select count(*) as n from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.zerar_desfeito'", [A.tenantId])).toBe(1);
      expect(Number((await q<{ n: string }>('select plataforma.descartar_limpeza($1, $2) as n', [A.tenantId, pedido.lote]))[0]!.n)).toBeGreaterThan(0);
      expect(await contar('select count(*) as n from plataforma.limpeza_copia where lote = $1', [pedido.lote])).toBe(0);
    });
  });

  it('tudo ou nada: erro no meio = nada muda, sem cópia, e o job fica em andamento; o worker fecha com o código', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(3), A.codigo]);
      await q("create function public.falha_0099() returns trigger language plpgsql as $f$ begin raise exception 'falha no meio'; end $f$");
      await q('create trigger falha_0099 before update on core.titulo for each row execute function public.falha_0099()');
      const antesA = await retrato(A.tenantId);
      expect((await falha(worker('select plataforma.executar_zerar($1) as r', [id(3)])))?.code).toBe('P0001');
      expect(mudaram(antesA, await retrato(A.tenantId))).toEqual([]);
      expect(await q('select 1 from plataforma.limpeza_copia')).toEqual([]);
      expect((await q<{ s: string }>('select situacao as s from plataforma.zerar_empresa where id = $1', [id(3)]))[0]!.s).toBe('em_andamento');
      const f = await worker<{ situacao: string; erro_codigo: string }>("select plataforma.fechar_zerar($1, 'ZERAR_FALHOU') as r", [id(3)]);
      expect(f).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' });
      expect(await worker("select plataforma.fechar_zerar($1, 'OUTRO') as r", [id(3)])).toEqual(f);
      expect((await falha(worker("select plataforma.fechar_zerar($1, 'minusculo') as r", [id(3)])))?.code).toBe('22023');
      // Hub em processamento entre o pedido e o worker: falhou com o próprio código, nada muda
      await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(4), A.codigo]);
      await processando(A.tenantId);
      const antes2 = await retrato(A.tenantId);
      expect(await worker('select plataforma.executar_zerar($1) as r', [id(4)])).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_HUB_PROCESSANDO' });
      expect(mudaram(antes2, await retrato(A.tenantId))).toEqual([]);
    });
  });

  it('expurgar_zerar: só a cópia dos zerar vencidos; os lotes do workflow ficam', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      const lotes: string[] = [];
      for (const [n, t, codigo, e] of [[5, A.tenantId, A.codigo, ['nota']], [6, B.tenantId, B.codigo, ['titulo']]] as const) {
        lotes.push((await portal<{ lote: string }>('select plataforma.sa_pedir_zerar($1, $2, $3, $4, $5::text[]) as r', [sid, t, id(n), codigo, e])).lote);
        expect(await worker('select plataforma.executar_zerar($1) as r', [id(n)])).toMatchObject({ situacao: 'concluido' });
      }
      await limpar(A.tenantId, LOTE, ['estoque']);
      await q("update plataforma.zerar_empresa set copia_expira_em = now() - interval '1 minute' where id = $1", [id(5)]);
      const copias = async (lote: string) => contar('select count(*) as n from plataforma.limpeza_copia where lote = $1', [lote]);
      expect(await copias(lotes[0]!)).toBeGreaterThan(0);
      expect(await worker<number>('select plataforma.expurgar_zerar(20) as r')).toBe(1);
      expect(await copias(lotes[0]!)).toBe(0);
      expect(await copias(lotes[1]!)).toBeGreaterThan(0);
      expect(await copias(LOTE)).toBeGreaterThan(0);
      expect(await worker<number>('select plataforma.expurgar_zerar(20) as r')).toBe(0);
      expect((await falha(worker('select plataforma.expurgar_zerar(0) as r')))?.code).toBe('22023');
      expect((await q<{ x: boolean }>('select expurgado_em is not null as x from plataforma.zerar_empresa where id = $1', [id(5)]))[0]!.x).toBe(true);
    });
  });
});

describe.skipIf(semBanco())('0099 up/down (banco efêmero vazio)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('a 0099 só acrescenta; o down volta exatamente; as cópias do #675 vão e voltam pela public.macuxi_limpeza_backup', async () => {
    await comAdmin(b.nome, async (c) => {
      const T = '11111111-0000-4000-8000-000000000001';
      await migrarUp(c, { ate: '0098' });
      const antes = await retratoDoCatalogo(c);
      // o workflow do #675 rodou antes: a public existe com uma cópia
      await c.query(`create table public.macuxi_limpeza_backup (lote text not null, tenant_id uuid not null, tabela text not null,
        modo text not null check (modo in ('soft', 'fisico', 'filial', 'sync_pacote')), linha jsonb not null, copiado_em timestamptz not null default now())`);
      await c.query(`insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha) values ('20261123T190000Z', $1, 'core.cliente', 'soft', '{"id": 1}')`, [T]);
      expect((await migrarUp(c, { ate: '0099' })).aplicadas).toEqual(['0099_plataforma_zerar_empresa']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((l) => !depois.includes(l))).toEqual([]);
      expect(depois.filter((l) => !antes.includes(l) && l.startsWith('rel ') && l.endsWith(' r rls=true force=true')).sort()).toEqual(TABELAS.map((t) => `rel ${t} r rls=true force=true`).sort());
      expect((await c.query<{ t: string | null }>("select to_regclass('public.macuxi_limpeza_backup')::text as t")).rows[0]!.t).toBeNull();
      const linha = { lote: '20261123T190000Z', tenant_id: T, tabela: 'core.cliente', modo: 'soft', linha: { id: 1 } };
      expect((await c.query('select lote, empresa_id as tenant_id, tabela, modo, linha from plataforma.limpeza_copia')).rows).toEqual([linha]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0099_plataforma_zerar_empresa']);
      expect((await c.query('select lote, tenant_id, tabela, modo, linha from public.macuxi_limpeza_backup')).rows).toEqual([linha]);
      await c.query('drop table public.macuxi_limpeza_backup');
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m99.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0099' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      await migrarDown(c, { passos: 1 });
      expect(await retratoDoCatalogo(c)).toEqual(antes);
    });
  });
});
