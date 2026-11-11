/**
 * 0058 — diagnóstico do aparelho na plataforma (T-0158, ADR 0043; desenho docs/desenho/T-0158.md §4; pedido
 * R-20261110-114603-engenheiro-software). O que o BANCO garante:
 * - plataforma.diagnostico com RLS forçado: o macuxi_app só insere (colunas do envio; protocolo, recebido_em e alerta_* são do
 *   banco) e lê o próprio tenant, sem UPDATE nem DELETE; o protocolo é global, da sequência, e não se repete;
 * - o macuxi_worker lê todos os tenants SEM descricao e detalhe e só marca alerta_* de linha pendente/agrupada; não apaga direto;
 * - o macuxi_portal não tem grant de tabela: só sa_listar_diagnosticos e sa_diagnostico (super-admin; admin do cliente = 42501;
 *   sessão inválida = 28000), conferidas pelos schemas do SDK (DiagnosticoListaSchema / DiagnosticoDetalheSchema);
 * - plataforma.expurgar_diagnosticos (só o worker) apaga de fato, com o print, o que passou de 90 dias e o print aguardando de
 *   mais de 7 dias, e devolve as chaves do armazenamento;
 * - up/down: a 0058 só acrescenta; o down volta exatamente ao catálogo e às ACLs da 0057.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 * Instantes: todos FIXOS (passados como parâmetro); o expurgo recebe p_agora fixo.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APPS_DIAGNOSTICO,
  DiagnosticoDetalheSchema,
  DiagnosticoListaSchema,
  FINALIDADE_PRINT_DIAGNOSTICO,
  MAX_SAIDAS_DIAGNOSTICO,
  ORIGENS_DIAGNOSTICO,
  RETENCAO_DIAGNOSTICO_DIAS,
  SITUACOES_ALERTA_DIAGNOSTICO,
} from '@macuxi/platform-sdk';
import { DIAGNOSTICOS_FIXTURE, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0058, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m58 = migracoes.find((m) => m.versao === '0058')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const nome = (f: string) => f.slice(0, f.indexOf('('));
/** Bloco de uma função até o "$$;" que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const lista = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
const EXPURGO = 'plataforma.expurgar_diagnosticos(timestamptz, integer)';
const COLUNAS_INSERT_APP = 'id, tenant_id, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android, android_api, tela, motivo, descricao, detalhe, print_id, ocorrido_em';
const COLUNAS_ALERTA = 'alerta_situacao, alerta_tentativas, alerta_proxima_em, alerta_recado_id, alerta_em';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const VENDEDOR_A = DOIS_TENANTS.A.usuarios.vendedor1;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
/** Instantes FIXOS do teste (a fixture recebe tudo em 2026-10-31 12:00 UTC). */
const OCORRIDO = '2026-11-09T15:00:00Z';
const CORTE_EXPURGO = '2026-11-10T00:00:00Z'; // p_agora do expurgo: 90 dias antes = 2026-08-12
const VELHO = '2026-08-01T10:00:00Z';
const NOVO_O_BASTANTE = '2026-08-20T10:00:00Z';
const H2 = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';

describe('0058 diagnóstico do aparelho (estático)', () => {
  const up = semComentarios(m58.up);
  const corpoTabela = /create table plataforma\.diagnostico \(([\s\S]*?)\n\);/.exec(up)?.[1] ?? '';

  it('nome e posição: 0058_plataforma_diagnostico logo depois da 0057', () => {
    expect(m58.nome).toBe('plataforma_diagnostico');
    expect(migracoes[57]?.versao).toBe('0058');
    expect(migracoes[56]?.versao).toBe('0057');
  });

  it('tabela: colunas comuns, protocolo da sequência global (único), FK composta do usuário, fora do sync', () => {
    for (const col of ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id']) expect(corpoTabela).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
    expect(up).toContain('create sequence plataforma.diagnostico_protocolo_seq as bigint start with 1 minvalue 1 no cycle;');
    expect(corpoTabela).toMatch(/protocolo\s+bigint not null default nextval\('plataforma\.diagnostico_protocolo_seq'\)/);
    expect(up).toContain('alter sequence plataforma.diagnostico_protocolo_seq owned by plataforma.diagnostico.protocolo;');
    expect(up).toContain('create unique index diagnostico_protocolo_uk on plataforma.diagnostico (protocolo);');
    expect(corpoTabela).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain('plataforma.diagnostico');
    // sem FK para o print: o aguardando de 7 dias sai e a linha fica
    expect(corpoTabela).not.toMatch(/references plataforma\.arquivo/);
  });

  it('CHECKs iguais ao contrato do SDK (origem, app, situação do alerta) e só dado técnico', () => {
    expect(lista(/diagnostico_origem_valida check \(origem in \(([^)]*)\)\)/.exec(corpoTabela)?.[1] ?? '')).toEqual([...ORIGENS_DIAGNOSTICO].sort());
    expect(lista(/diagnostico_app_valido check \(app in \(([^)]*)\)\)/.exec(corpoTabela)?.[1] ?? '')).toEqual([...APPS_DIAGNOSTICO].sort());
    expect(lista(/diagnostico_alerta_situacao_valida check \(alerta_situacao in \(([^)]*)\)\)/.exec(corpoTabela)?.[1] ?? '')).toEqual([...SITUACOES_ALERTA_DIAGNOSTICO].sort());
    // tela sem query string nem fragmento; detalhe só com erro, saida_android, sync e ultimas_saidas (T-0158), até 32 KB
    expect(corpoTabela).toContain("position('?' in tela) = 0 and position('#' in tela) = 0");
    expect(corpoTabela).toContain("detalhe - array['erro', 'saida_android', 'sync', 'ultimas_saidas'] = '{}'::jsonb");
    expect(corpoTabela).toContain('octet_length(detalhe::text) <= 32768');
    // nenhuma coluna de dado pessoal
    expect(corpoTabela).not.toMatch(/^\s+(nome|email|e_mail|telefone|cpf|cnpj|cliente_id|imei|serie|numero_serie)\s/m);
  });

  it('índices dos filtros do portal (com a ordem da lista), do alerta pendente e da FK', () => {
    for (const ix of [
      'create index diagnostico_recebido_ix on plataforma.diagnostico (recebido_em desc, id desc);',
      'create index diagnostico_tenant_ix on plataforma.diagnostico (tenant_id, recebido_em desc, id desc);',
      'create index diagnostico_versao_ix on plataforma.diagnostico (versao_app, recebido_em desc, id desc);',
      'create index diagnostico_modelo_ix on plataforma.diagnostico (aparelho_modelo, recebido_em desc, id desc);',
      'create index diagnostico_motivo_ix on plataforma.diagnostico (motivo, recebido_em desc, id desc);',
      "create index diagnostico_alerta_pendente_ix on plataforma.diagnostico (alerta_proxima_em) where alerta_situacao = 'pendente';",
      'create index diagnostico_usuario_ix on plataforma.diagnostico (tenant_id, usuario_id);',
    ]) expect(up).toContain(ix);
  });

  it('RLS e grants: app só SELECT + INSERT por coluna (+ USAGE da sequência); worker SELECT sem texto livre e UPDATE só de alerta_*; portal nada', () => {
    expect(up).toContain('alter table plataforma.diagnostico enable row level security;');
    expect(up).toContain('alter table plataforma.diagnostico force row level security;');
    expect(up).toContain('create policy manutencao on plataforma.diagnostico for all to macuxi_manutencao using (true) with check (true);');
    expect(up).toMatch(/create policy diagnostico_alerta on plataforma\.diagnostico for select to macuxi_worker\s+using \(true\);/);
    expect(up).toMatch(/create policy diagnostico_alerta_marcar on plataforma\.diagnostico for update to macuxi_worker\s+using \(alerta_situacao in \('pendente', 'agrupado'\)\) with check \(true\);/);
    const grants = [...up.matchAll(/grant ([^;]*?) on (?:sequence )?plataforma\.diagnostico(?:_protocolo_seq)? to (macuxi_\w+);/g)].map((g) => `${g[2]}: ${g[1]!.replace(/\s+/g, ' ')}`);
    expect(grants).toEqual([
      'macuxi_app: select',
      `macuxi_app: insert (${COLUNAS_INSERT_APP})`,
      'macuxi_app: usage',
      'macuxi_worker: select (id, tenant_id, protocolo, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android, android_api, tela, motivo, print_id, ocorrido_em, recebido_em, alerta_situacao, alerta_tentativas, alerta_proxima_em, alerta_recado_id, alerta_em)',
      `macuxi_worker: update (${COLUNAS_ALERTA})`,
    ]);
    // o app não grava protocolo, recebido_em, alerta_* nem external_id; o worker não lê descricao nem detalhe
    for (const c of ['protocolo', 'recebido_em', 'alerta_situacao', 'external_id', 'deleted_at']) expect(COLUNAS_INSERT_APP.split(', ')).not.toContain(c);
    expect(grants[3]).not.toMatch(/descricao|detalhe/);
    expect(up).not.toMatch(/grant [^;]* on (table |sequence )?plataforma\.diagnostico[^;]* to macuxi_portal/);
    expect(up).not.toMatch(/grant (update|delete|all)[^;]* on plataforma\.diagnostico to macuxi_app/);
    expect(up).not.toMatch(/grant [^;]*delete[^;]* on plataforma\.diagnostico to macuxi_worker/);
  });

  it('as 2 sa_*: SECURITY DEFINER, search_path com pg_temp por último, EXECUTE só ao portal; 28000 sem sessão, 42501 para o admin do cliente', () => {
    for (const f of FUNCOES_SA_0058) {
      const b = bloco(up, `create function ${nome(f)}(`);
      expect(b, f).toMatch(/returns jsonb\s+language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b, f).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
      expect(b, f).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
      // auditoria sem texto livre
      expect(b, f).toContain('plataforma.sa_registrar_auditoria(');
      expect(b.split('\n').filter((l) => l.includes('sa_registrar_auditoria')).join('\n'), f).not.toMatch(/descricao|detalhe/);
    }
    expect(FUNCOES_SA_ATUAIS).toHaveLength(16);
    expect(up).toContain('if v_n <> 16 then');
    const listar = bloco(up, 'create function plataforma.sa_listar_diagnosticos(');
    expect(listar).toContain("('versao', 'modelo', 'tenant_id', 'motivo', 'origem', 'de', 'ate', 'cursor')");
    expect(listar).toContain('(v_cur_em is null or (d.recebido_em, d.id) < (v_cur_em, v_cur_id))');
    expect(listar).toContain('order by d.recebido_em desc, d.id desc');
    expect(listar).toContain('limit 51');
    expect(listar).toContain('left join plataforma.tenant t on t.id = x.tenant_id');
    const detalhe = bloco(up, 'create function plataforma.sa_diagnostico(');
    expect(detalhe).toContain("'chave_armazenamento', v_chave");
    expect(detalhe).toContain("using errcode = 'P0002'");
    // as 5 saídas do Android (T-0158): diagnóstico sem a lista devolve []
    expect(detalhe).toContain("'ultimas_saidas', coalesce(v_d.detalhe -> 'ultimas_saidas', '[]'::jsonb)");
  });

  it('expurgo: SECURITY DEFINER só do worker; 90 dias (o RETENCAO_DIAGNOSTICO_DIAS do SDK) com o print; aguardando de 7 dias', () => {
    const b = bloco(up, 'create function plataforma.expurgar_diagnosticos(');
    expect(b).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).toContain(`x.recebido_em < p_agora - interval '${RETENCAO_DIAGNOSTICO_DIAS} days'`);
    expect(b).toContain(`a.modulo = 'plataforma' and a.finalidade = '${FINALIDADE_PRINT_DIAGNOSTICO}'`);
    expect(b).toContain("y.situacao = 'aguardando'");
    expect(b).toContain("y.created_at < p_agora - interval '7 days'");
    expect(b).toContain('for update skip locked');
    expect(up).toContain(`revoke all on function ${EXPURGO} from public;`);
    expect(up).toContain(`grant execute on function ${EXPURGO} to macuxi_worker;`);
  });

  it('down: apaga as 3 funções, a tabela e a sequência, sem criar nada', () => {
    const down = semComentarios(m58.down);
    for (const f of [...FUNCOES_SA_0058, EXPURGO]) expect(down).toContain(`drop function if exists ${f};`);
    expect(down).toContain('drop table if exists plataforma.diagnostico;');
    expect(down).toContain('drop sequence if exists plataforma.diagnostico_protocolo_seq;');
    expect(down).not.toMatch(/create |grant /);
  });
});

describe.skipIf(semBanco())('0058 diagnóstico do aparelho (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado (contexto de tenant opcional) dentro da transação aberta; um erro não aborta o caso. */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = [], tenant = '') {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0];
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.t158@macuxi.exemplo', nome: 'Operador 0058', senha_hash: H2 })]))[0]!.r;
    return (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!.sessao_id;
  }
  const listar = async (sid: string, filtro: unknown = {}) =>
    DiagnosticoListaSchema.parse((await portal<{ r: unknown }>('select plataforma.sa_listar_diagnosticos($1, $2::jsonb) as r', [sid, JSON.stringify(filtro)]))[0]!.r);
  const detalhe = async (sid: string, id: string) => (await portal<{ r: Record<string, unknown> }>('select plataforma.sa_diagnostico($1, $2) as r', [sid, id]))[0]!.r;
  /** O insert da API (POST /v1/diagnosticos): só as colunas do envio, idempotente pelo id. */
  const enviar = (tenant: string, id: string, usuario: string, extra: { origem?: string; versao?: string; tela?: string | null; print?: string | null } = {}) =>
    como<{ protocolo: string }>(
      'macuxi_app',
      `insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, aparelho_fabricante, aparelho_modelo, android, android_api, tela, motivo, descricao, detalhe, print_id, ocorrido_em)
       values ($1, $2, $3, 'vendedor', $4, 'campo', $5, 'motorola', 'moto g54', '14', 34, $6, null, 'Travou ao abrir o pedido', '{"sync":{"pendentes":2,"ultimo_sync_em":null}}', $7, $8)
       on conflict (id) do nothing returning protocolo`,
      [id, tenant, usuario, extra.origem ?? 'botao', extra.versao ?? '1.0.4', extra.tela === undefined ? '/m/novo-pedido' : extra.tela, extra.print ?? null, OCORRIDO],
      tenant,
    );

  it('app: insere no próprio tenant com o protocolo da sequência; repetir o id não duplica; não forja protocolo/alerta; sem UPDATE/DELETE; não vê B', async () => {
    await emTransacao(admin, null, async () => {
      const id = '0058a000-0000-4000-8000-000000000001';
      const r1 = await enviar(A, id, VENDEDOR_A);
      expect(r1.rowCount).toBe(1);
      const protocolo = Number(r1.rows[0]!.protocolo);
      expect(protocolo).toBeGreaterThan(0);
      // repetição (fila do aparelho): nada muda; a API relê pelo id e devolve o mesmo protocolo
      expect((await enviar(A, id, VENDEDOR_A)).rowCount).toBe(0);
      const relido = await como<{ protocolo: string; alerta_situacao: string; recebido_em: Date }>('macuxi_app', 'select protocolo, alerta_situacao, recebido_em from plataforma.diagnostico where id = $1', [id], A);
      expect(relido.rows).toHaveLength(1);
      expect(Number(relido.rows[0]!.protocolo)).toBe(protocolo);
      expect(relido.rows[0]!.alerta_situacao).toBe('pendente');
      // outro envio = protocolo maior (sequência global)
      const r2 = await enviar(A, '0058a000-0000-4000-8000-000000000002', VENDEDOR_A);
      expect(Number(r2.rows[0]!.protocolo)).toBeGreaterThan(protocolo);
      // protocolo, alerta, recebido_em e external_id: sem INSERT na coluna
      for (const [col, val] of [['protocolo', 1], ['alerta_situacao', 'enviado'], ['recebido_em', OCORRIDO], ['external_id', 'X']] as const) {
        const e = await erroDe(como('macuxi_app', `insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, ocorrido_em, ${col}) values (gen_random_uuid(), $1, $2, 'vendedor', 'botao', 'campo', '1.0.4', $3, $4)`, [A, VENDEDOR_A, OCORRIDO, val], A));
        expect(e?.code, col).toBe('42501');
      }
      for (const sql of ["update plataforma.diagnostico set descricao = 'x'", 'delete from plataforma.diagnostico']) {
        expect((await erroDe(como('macuxi_app', sql, [], A)))?.code, sql).toBe('42501');
      }
      // mesmo id já usado em B: invisível para A (RLS) e o insert de A não cria nada (a API responde 409)
      const deB = DIAGNOSTICOS_FIXTURE.B.erroTela;
      expect((await enviar(A, deB, VENDEDOR_A)).rowCount).toBe(0);
      expect((await como('macuxi_app', 'select 1 from plataforma.diagnostico where id = $1', [deB], A)).rowCount).toBe(0);
      // A não grava em B (WITH CHECK da isolamento_tenant)
      const cruzado = await erroDe(como('macuxi_app', `insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, ocorrido_em) values (gen_random_uuid(), $1, $2, 'vendedor', 'botao', 'campo', '1.0.4', $3)`, [B, DOIS_TENANTS.B.usuarios.vendedor, OCORRIDO], A));
      expect(cruzado?.code).toBe('42501');
    });
  });

  it('CHECKs: tela com query string, detalhe com chave fora do contrato, origem e perfil desconhecidos = 23514', async () => {
    await emTransacao(admin, null, async () => {
      expect((await erroDe(enviar(A, '0058a000-0000-4000-8000-000000000011', VENDEDOR_A, { tela: '/m/clientes?busca=Maria' })))?.code).toBe('23514');
      expect((await erroDe(enviar(A, '0058a000-0000-4000-8000-000000000012', VENDEDOR_A, { origem: 'outra' })))?.code).toBe('23514');
      const base = `insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, ocorrido_em, detalhe) values (gen_random_uuid(), $1, $2, $3, 'botao', 'campo', '1.0.4', $4, $5)`;
      expect((await erroDe(como('macuxi_app', base, [A, VENDEDOR_A, 'vendedor', OCORRIDO, '{"cliente":"Maria"}'], A)))?.code).toBe('23514');
      expect((await erroDe(como('macuxi_app', base, [A, VENDEDOR_A, 'super_admin', OCORRIDO, '{}'], A)))?.code).toBe('23514');
    });
  });

  it('worker: lê todos os tenants sem descricao/detalhe; marca alerta_* só de pendente/agrupado; não muda outra coluna nem apaga', async () => {
    await emTransacao(admin, null, async () => {
      const id = '0058a000-0000-4000-8000-000000000021';
      await enviar(A, id, VENDEDOR_A);
      const vistos = await como<{ tenant_id: string }>('macuxi_worker', 'select distinct tenant_id from plataforma.diagnostico');
      expect(vistos.rows.map((x) => x.tenant_id).sort()).toEqual([A, B].sort());
      for (const col of ['descricao', 'detalhe']) expect((await erroDe(como('macuxi_worker', `select ${col} from plataforma.diagnostico limit 1`)))?.code, col).toBe('42501');
      const pendentes = await como<{ id: string }>('macuxi_worker', "select id from plataforma.diagnostico where alerta_situacao = 'pendente' order by alerta_proxima_em nulls first limit 10 for update skip locked");
      expect(pendentes.rows.map((x) => x.id)).toContain(id);
      const marcado = await como('macuxi_worker', "update plataforma.diagnostico set alerta_situacao = 'enviado', alerta_recado_id = 'R-20261110-153012-diagnostico', alerta_em = $2 where id = $1", [id, OCORRIDO]);
      expect(marcado.rowCount).toBe(1);
      // já enviado: a política não deixa remarcar (0 linhas); a fixture só tem alertas resolvidos
      expect((await como('macuxi_worker', "update plataforma.diagnostico set alerta_situacao = 'falhou' where id = $1", [id])).rowCount).toBe(0);
      expect((await como('macuxi_worker', "update plataforma.diagnostico set alerta_tentativas = 1 where alerta_situacao = 'enviado'")).rowCount).toBe(0);
      for (const sql of ["update plataforma.diagnostico set versao_app = 'x'", "update plataforma.diagnostico set descricao = 'x'", 'delete from plataforma.diagnostico',
        `insert into plataforma.diagnostico (tenant_id, usuario_id, perfil, origem, app, versao_app, ocorrido_em) values ('${A}', '${VENDEDOR_A}', 'vendedor', 'botao', 'campo', '1', '${OCORRIDO}')`]) {
        expect((await erroDe(como('macuxi_worker', sql)))?.code, sql).toBe('42501');
      }
    });
  });

  it('portal: sem grant de tabela; super-admin lista com filtros e keyset; admin do cliente = 42501; sessão inválida = 28000; filtro inválido = 22023', async () => {
    await emTransacao(admin, null, async () => {
      expect((await erroDe(como('macuxi_portal', 'select 1 from plataforma.diagnostico limit 1')))?.code).toBe('42501');
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_listar_diagnosticos(null, null)')))?.code, papel).toBe('42501');
        expect((await erroDe(como(papel, 'select plataforma.sa_diagnostico(null, null)')))?.code, papel).toBe('42501');
      }
      expect((await erroDe(como('macuxi_portal', 'select plataforma.sa_listar_diagnosticos(null, null)')))?.code).toBe('28000');
      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] }))!;
      expect((await erroDe(listar(cli.sessao_id)))?.code).toBe('42501');
      expect((await erroDe(detalhe(cli.sessao_id, DIAGNOSTICOS_FIXTURE.A.botao)))?.code).toBe('42501');

      const sid = await sessaoSuperAdmin();
      // a fixture (recebida em 2026-10-31): 3 diagnósticos de A e B, do mais novo ao mais antigo, com o nome da empresa
      const ate = { ate: '2026-11-01T00:00:00Z' };
      const todos = await listar(sid, ate);
      expect(todos.itens.map((x) => x.id).sort()).toEqual([DIAGNOSTICOS_FIXTURE.A.botao, DIAGNOSTICOS_FIXTURE.A.queda, DIAGNOSTICOS_FIXTURE.B.erroTela].sort());
      expect(todos.cursor).toBeNull();
      expect(new Set(todos.itens.map((x) => x.tenant_nome)).size).toBe(2);
      expect(todos.itens.every((x) => x.tem_print === false)).toBe(true);
      expect((await listar(sid, { ...ate, tenant_id: B })).itens.map((x) => x.id)).toEqual([DIAGNOSTICOS_FIXTURE.B.erroTela]);
      expect((await listar(sid, { ...ate, origem: 'queda' })).itens.map((x) => x.id)).toEqual([DIAGNOSTICOS_FIXTURE.A.queda]);
      expect((await listar(sid, { ...ate, motivo: 'crash_nativo', modelo: 'SM-A155M', versao: '1.0.4' })).itens.map((x) => x.id)).toEqual([DIAGNOSTICOS_FIXTURE.A.queda]);
      expect((await listar(sid, { ...ate, de: '2026-11-01T00:00:00Z' })).itens).toEqual([]);

      // keyset: 52 envios novos da versão 9.9.9 = página de 50 + página de 2, sem repetir nem pular
      for (let i = 0; i < 52; i++) await enviar(A, `0058b000-0000-4000-8000-${String(i).padStart(12, '0')}`, VENDEDOR_A, { versao: '9.9.9' });
      const p1 = await listar(sid, { versao: '9.9.9' });
      expect(p1.itens).toHaveLength(50);
      expect(p1.cursor).not.toBeNull();
      const p2 = await listar(sid, { versao: '9.9.9', cursor: p1.cursor! });
      expect(p2.itens).toHaveLength(2);
      expect(p2.cursor).toBeNull();
      const ids = [...p1.itens, ...p2.itens].map((x) => x.id);
      expect(new Set(ids).size).toBe(52);
      const ordem = [...p1.itens, ...p2.itens].map((x) => x.protocolo);
      expect(ordem).toEqual([...ordem].sort((x, y) => y - x));

      for (const filtro of [{ outra: 'x' }, { versao: 1 }, { tenant_id: 'nao-e-uuid' }, { de: 'ontem' }, { cursor: 'abc' }, { origem: 'outra' }, { versao: 'x'.repeat(21) }]) {
        expect((await erroDe(listar(sid, filtro)))?.code, JSON.stringify(filtro)).toBe('22023');
      }
      const aud = await q<{ n: number }>("select count(*)::int as n from plataforma.auditoria_plataforma where acao = 'sa.diagnostico.listar' and sessao_id = $1", [sid]);
      expect(aud[0]!.n).toBeGreaterThan(0);
    });
  });

  it('portal: detalhe pelo DiagnosticoDetalheSchema, com a chave do print recebido; id desconhecido = P0002', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const d = DiagnosticoDetalheSchema.parse(await detalhe(sid, DIAGNOSTICOS_FIXTURE.A.queda));
      expect(d).toMatchObject({ origem: 'queda', motivo: 'crash_nativo', perfil: 'promotor', tenant_id: A, tem_print: false, alerta: { situacao: 'desligado', recado_id: null, em: null } });
      expect(d.saida_android).toMatchObject({ motivo: 4, descricao: 'crash' });
      expect(await detalhe(sid, DIAGNOSTICOS_FIXTURE.A.queda)).toMatchObject({ ultimas_saidas: [] });

      // T-0158: a lista das últimas saídas do Android (até MAX_SAIDAS_DIAGNOSTICO) passa no CHECK e volta no detalhe
      const comSaidas = '0058a000-0000-4000-8000-000000000032';
      const saida = { motivo: 4, status: 0, importancia: 100, pss_kb: 0, rss_kb: 0, descricao: 'crash', pilha: null, quando: '2026-11-10T12:00:00.000Z' };
      const lista = Array.from({ length: MAX_SAIDAS_DIAGNOSTICO }, () => saida);
      await como(
        'macuxi_app',
        `insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, ocorrido_em, detalhe) values ($1, $2, $3, 'vendedor', 'botao', 'campo', '1.0.4', $4, $5)`,
        [comSaidas, A, VENDEDOR_A, OCORRIDO, JSON.stringify({ ultimas_saidas: lista })],
        A,
      );
      expect(DiagnosticoDetalheSchema.parse(await detalhe(sid, comSaidas)).ultimas_saidas).toEqual(lista);

      // print recebido pela fila de arquivos (ADR 0010): a API lê os bytes pela chave
      const id = '0058a000-0000-4000-8000-000000000031';
      const print = '0058c000-0000-4000-8000-000000000031';
      await enviar(A, id, VENDEDOR_A, { print });
      await q(
        `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, tamanho_bytes, sha256, situacao, recebido_em, chave_armazenamento)
         values ($1, $2, 'plataforma', $3, 'diagnostico', $4, $5, 1234, repeat('a', 64), 'recebido', $6, $7)`,
        [print, A, FINALIDADE_PRINT_DIAGNOSTICO, id, VENDEDOR_A, OCORRIDO, `${A}/plataforma/2026-11/${print}.jpg`],
      );
      const bruto = await detalhe(sid, id);
      expect(bruto.chave_armazenamento).toBe(`${A}/plataforma/2026-11/${print}.jpg`);
      expect(DiagnosticoDetalheSchema.parse(bruto)).toMatchObject({ tem_print: true, descricao: 'Travou ao abrir o pedido', sync: { pendentes: 2, ultimo_sync_em: null } });
      expect((await erroDe(detalhe(sid, '0058ffff-0000-4000-8000-000000000000')))?.code).toBe('P0002');
      const aud = await q<{ detalhes: Record<string, unknown> }>("select detalhes from plataforma.auditoria_plataforma where acao = 'sa.diagnostico.ver' and sessao_id = $1", [sid]);
      // 4 leituras com sucesso (queda 2x, comSaidas e o do print); o id desconhecido (P0002) não grava auditoria
      expect(aud).toHaveLength(4);
      expect(JSON.stringify(aud)).not.toContain('Travou');
    });
  });

  it('expurgo (só o worker): apaga de fato o que passou de 90 dias com o print e o aguardando de 7 dias; devolve as chaves', async () => {
    await emTransacao(admin, null, async () => {
      for (const papel of ['macuxi_app', 'macuxi_portal']) {
        expect((await erroDe(como(papel, 'select * from plataforma.expurgar_diagnosticos($1, 10)', [CORTE_EXPURGO])))?.code, papel).toBe('42501');
      }
      const velho = '0058a000-0000-4000-8000-000000000041';
      const recente = '0058a000-0000-4000-8000-000000000042';
      const printVelho = '0058c000-0000-4000-8000-000000000041';
      const aguardando = '0058c000-0000-4000-8000-000000000042';
      for (const [id, em, p] of [[velho, VELHO, printVelho], [recente, NOVO_O_BASTANTE, null]] as const) {
        await q(
          `insert into plataforma.diagnostico (id, tenant_id, usuario_id, perfil, origem, app, versao_app, ocorrido_em, recebido_em, print_id, alerta_situacao)
           values ($1, $2, $3, 'vendedor', 'botao', 'campo', '1.0.1', $4, $4, $5, 'enviado')`, [id, A, VENDEDOR_A, em, p]);
      }
      await q(
        `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, tamanho_bytes, sha256, situacao, recebido_em, chave_armazenamento, created_at)
         values ($1, $2, 'plataforma', $3, 'diagnostico', $4, $5, 1234, repeat('b', 64), 'recebido', $6, $7, $6)`,
        [printVelho, A, FINALIDADE_PRINT_DIAGNOSTICO, velho, VENDEDOR_A, VELHO, `${A}/plataforma/2026-08/${printVelho}.jpg`]);
      await q(
        `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, created_at)
         values ($1, $2, 'plataforma', $3, 'diagnostico', $4, $5, $6)`,
        [aguardando, A, FINALIDADE_PRINT_DIAGNOSTICO, recente, VENDEDOR_A, NOVO_O_BASTANTE]);
      const r = await como<{ diagnosticos: number; arquivos: number; chaves: string[] }>('macuxi_worker', 'select * from plataforma.expurgar_diagnosticos($1, 500)', [CORTE_EXPURGO]);
      expect(r.rows).toEqual([{ diagnosticos: 1, arquivos: 2, chaves: [`${A}/plataforma/2026-08/${printVelho}.jpg`] }]);
      expect(await q('select id from plataforma.diagnostico where id = any($1::uuid[]) order by id', [[velho, recente]])).toEqual([{ id: recente }]);
      expect(await q('select id from plataforma.arquivo where id = any($1::uuid[])', [[printVelho, aguardando]])).toEqual([]);
      // a fixture (2026-10-31) fica; de novo não há nada
      expect(await q<{ n: number }>('select count(*)::int as n from plataforma.diagnostico where id = any($1::uuid[])', [Object.values({ ...DIAGNOSTICOS_FIXTURE.A, ...DIAGNOSTICOS_FIXTURE.B })])).toEqual([{ n: 3 }]);
      expect((await como('macuxi_worker', 'select * from plataforma.expurgar_diagnosticos($1, 500)', [CORTE_EXPURGO])).rows).toEqual([{ diagnosticos: 0, arquivos: 0, chaves: [] }]);
      expect((await erroDe(como('macuxi_worker', 'select * from plataforma.expurgar_diagnosticos($1, 0)', [CORTE_EXPURGO])))?.code).toBe('22023');
    });
  });
});

describe.skipIf(semBanco())('0058 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só a sequência, a tabela e as 3 funções; down volta exatamente ao catálogo da 0057 (idempotente); up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0057' });
      const catalogo = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0058' })).aplicadas).toEqual(['0058_plataforma_diagnostico']);
      const depois = await retratoDoCatalogo(c);
      expect(catalogo.filter((l) => !depois.includes(l))).toEqual([]);
      const novos = depois.filter((l) => !catalogo.includes(l));
      expect(novos.filter((l) => l.startsWith('fn ')).sort()).toEqual([
        'fn plataforma.expurgar_diagnosticos(p_agora timestamp with time zone, p_limite integer)',
        'fn plataforma.sa_diagnostico(p_sid uuid, p_id uuid)',
        'fn plataforma.sa_listar_diagnosticos(p_sid uuid, p_filtro jsonb)',
      ]);
      expect(novos.some((l) => l.includes('plataforma.diagnostico'))).toBe(true);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0058_plataforma_diagnostico']);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      expect((await c.query("select to_regclass('plataforma.diagnostico_protocolo_seq') as s")).rows).toEqual([{ s: null }]);
      await c.query(m58.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      await migrarUp(c, { ate: '0058' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
