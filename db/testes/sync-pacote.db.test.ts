/**
 * 0074 — pacote pronto da primeira carga (ADR 0054 proposta; desenho docs/desenho/T-catalogo-pacote.md §1.4, §1.6 e §5 B).
 * Dicionário: docs/banco/sync-pacote.md.
 * - plataforma.sync_pacote: um .sqlite.gz por (tenant, módulo, partição); uma só linha 'pronto' viva por partição; a chave do
 *   armazenamento leva sempre o tenant da linha (CHECK); pronto -> substituido -> apagado;
 * - plataforma.sync_pacote_pedido: pedido de geração idempotente por partição (um só pendente vivo);
 * - macuxi_app: lê os pacotes e lê/insere pedidos só do próprio tenant; macuxi_worker: gera e marca em todos os tenants, apaga só
 *   o que saiu do ciclo; macuxi_portal: nada;
 * - índice por filial em catalogo.tabela_preco_item (tenant_id, filial_id, updated_at, id).
 * Estático na sessão; banco (fixture dois-tenants, ROLLBACK) e up/down num banco efêmero só no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esquemaPlataforma from '../esquema/plataforma';
import { dadosDoisTenants, DOIS_TENANTS, FILIAIS_FIXTURE, ORDEM_TABELAS, SYNC_PACOTE_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const migracoes = lerMigracoes();
const m74 = migracoes.find((m) => m.versao === '0074')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m74.up);
const down = semComentarios(m74.down);
const umaLinha = up.replace(/\s+/g, ' ');
const PACOTE = 'plataforma.sync_pacote';
const PEDIDO = 'plataforma.sync_pacote_pedido';
const COMUNS = ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id'];
const COLUNAS_PACOTE = [
  'id', 'tenant_id', 'modulo', 'particao', 'filial_id', 'formato', 'situacao', 'horizonte', 'geracao_base', 'chave_armazenamento', 'bytes',
  'md5', 'entidades', 'substituido_em', 'arquivo_apagado_em', 'created_at', 'updated_at', 'deleted_at', 'external_id',
];
const COLUNAS_PEDIDO = [
  'id', 'tenant_id', 'modulo', 'particao', 'filial_id', 'origem', 'situacao', 'gerar_apos', 'tentativas', 'ultimo_erro', 'atendido_em',
  'created_at', 'updated_at', 'deleted_at', 'external_id',
];
const MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
const GERACAO = '00000000-0000-4000-8000-000000000070';

/** Corpo do `create table x (...)` da migração. */
const corpoDe = (tabela: string): string => new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(up)?.[1] ?? '';
/** Colunas do `create table x (...)`, na ordem. */
const colunasDoSql = (tabela: string): string[] =>
  [...corpoDe(tabela).matchAll(/^\s+([a-z0-9_]+)\s+(?:uuid|text|integer|bigint|jsonb|timestamptz)\b/gm)].map((m) => m[1]!);
const chave = (tenant: string, modulo: string, particao: string, id: string) => `sync-pacotes/${tenant}/${modulo}/${particao}/${id}.sqlite.gz`;

describe('0074 pacote da primeira carga (estático)', () => {
  it('nome e posição: 0074_plataforma_sync_pacote logo depois da 0073 (registro único da numeração, R-20261115-115000-gerente-projetos)', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[73]).toBe('0074_plataforma_sync_pacote');
  });

  it('aditiva: 2 tabelas novas e 1 índice; nada existente é alterado nem apagado no up', () => {
    expect([...up.matchAll(/create table ([a-z_]+\.[a-z_]+) \(/g)].map((m) => m[1])).toEqual([PACOTE, PEDIDO]);
    expect(up).not.toMatch(/\balter table (?!plataforma\.sync_pacote)|\bdrop\b|^\s*update\b|\bdelete from\b|\binsert into\b|\btruncate\b/im);
    expect(up).not.toMatch(/security definer|create (or replace )?function/i);
  });

  it('colunas: as do desenho + as obrigatórias (regra 5), id uuid e tenant_id com FK para o tenant', () => {
    expect(colunasDoSql(PACOTE)).toEqual(COLUNAS_PACOTE);
    expect(colunasDoSql(PEDIDO)).toEqual(COLUNAS_PEDIDO);
    for (const t of [PACOTE, PEDIDO]) {
      const corpo = corpoDe(t);
      for (const c of COMUNS) expect(corpo, `${t}.${c}`).toMatch(new RegExp(`^\\s+${c}\\s`, 'm'));
      expect(corpo).toMatch(/^\s+id\s+uuid primary key default gen_random_uuid\(\),$/m);
      expect(corpo).toMatch(/^\s+tenant_id\s+uuid not null references plataforma\.tenant \(id\),$/m);
    }
  });

  it('CHECKs do pacote: partição coerente com a filial, chave com o tenant da linha, md5, bytes, entidades e ciclo de vida', () => {
    for (const trecho of [
      "constraint sync_pacote_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$')",
      "constraint sync_pacote_particao_valida check ( (particao = 'tenant' and filial_id is null) or (filial_id is not null and particao = 'filial:' || filial_id::text) )",
      'constraint sync_pacote_formato_positivo check (formato >= 1)',
      "constraint sync_pacote_situacao_valida check (situacao in ('pronto', 'substituido', 'apagado'))",
      "constraint sync_pacote_chave_do_tenant check ( chave_armazenamento = 'sync-pacotes/' || tenant_id::text || '/' || modulo || '/' || particao || '/' || id::text || '.sqlite.gz' )",
      'constraint sync_pacote_bytes_positivo check (bytes > 0)',
      "constraint sync_pacote_md5_formato check (md5 ~ '^[0-9a-f]{32}$')",
      "constraint sync_pacote_entidades_objeto check (jsonb_typeof(entidades) = 'object' and octet_length(entidades::text) <= 8192)",
      "constraint sync_pacote_substituido_coerente check ((situacao = 'pronto') = (substituido_em is null))",
      "constraint sync_pacote_apagado_coerente check ((situacao = 'apagado') = (arquivo_apagado_em is not null))",
    ]) expect(umaLinha).toContain(trecho);
  });

  it('CHECKs do pedido: partição, origem dos 3 gatilhos, situação, tentativas, erro curto e atendido coerente', () => {
    for (const trecho of [
      "constraint sync_pacote_pedido_particao_valida check ( (particao = 'tenant' and filial_id is null) or (filial_id is not null and particao = 'filial:' || filial_id::text) )",
      "constraint sync_pacote_pedido_origem_valida check (origem in ('lote', 'manifesto', 'agendado'))",
      "constraint sync_pacote_pedido_situacao_valida check (situacao in ('pendente', 'atendido', 'descartado'))",
      'constraint sync_pacote_pedido_tentativas_faixa check (tentativas between 0 and 100)',
      'constraint sync_pacote_pedido_ultimo_erro_curto check (ultimo_erro is null or char_length(ultimo_erro) between 1 and 200)',
      "constraint sync_pacote_pedido_atendido_coerente check ((situacao = 'pendente') = (atendido_em is null))",
    ]) expect(umaLinha).toContain(trecho);
  });

  it('índices: pronto único por partição, pendente único por partição, filas do worker, por filial e o de tabela_preco_item', () => {
    for (const ix of [
      "create unique index sync_pacote_pronto_uk on plataforma.sync_pacote (tenant_id, modulo, particao) where situacao = 'pronto' and deleted_at is null;",
      'create index sync_pacote_filial_ix on plataforma.sync_pacote (tenant_id, filial_id) where filial_id is not null;',
      "create index sync_pacote_substituido_ix on plataforma.sync_pacote (substituido_em) where situacao = 'substituido';",
      "create unique index sync_pacote_pedido_pendente_uk on plataforma.sync_pacote_pedido (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null;",
      "create index sync_pacote_pedido_fila_ix on plataforma.sync_pacote_pedido (gerar_apos) where situacao = 'pendente';",
      'create index sync_pacote_pedido_filial_ix on plataforma.sync_pacote_pedido (tenant_id, filial_id) where filial_id is not null;',
      'create index tabela_preco_item_filial_sync_ix on catalogo.tabela_preco_item (tenant_id, filial_id, updated_at, id);',
    ]) expect(umaLinha).toContain(ix);
    // fora do sync: sem o índice (tenant_id, updated_at, id) e declaradas em TABELAS_FORA_DO_SYNC
    expect(up).not.toMatch(/on plataforma\.sync_pacote(_pedido)? \(tenant_id, updated_at, id\)/);
    for (const t of [PACOTE, PEDIDO]) expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain(t);
  });

  it('RLS e grants: app lê o pacote e lê/insere pedido por coluna; worker gera e marca em todos os tenants; portal e PUBLIC nada', () => {
    for (const t of [PACOTE, PEDIDO]) {
      expect(up).toContain(`alter table ${t} enable row level security;`);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(up).toContain(`revoke all on ${t} from public;`);
      expect(up).toContain(`create trigger ${t.split('.')[1]}_updated_at before update on ${t}`);
    }
    for (const p of [
      'create policy sync_pacote_gerador on plataforma.sync_pacote for select to macuxi_worker using (true);',
      'create policy sync_pacote_gerador_gravar on plataforma.sync_pacote for insert to macuxi_worker with check (true);',
      "create policy sync_pacote_gerador_marcar on plataforma.sync_pacote for update to macuxi_worker using (situacao <> 'apagado') with check (true);",
      "create policy sync_pacote_gerador_expurgar on plataforma.sync_pacote for delete to macuxi_worker using (situacao = 'apagado');",
      'create policy sync_pacote_pedido_gerador on plataforma.sync_pacote_pedido for select to macuxi_worker using (true);',
      'create policy sync_pacote_pedido_gerador_gravar on plataforma.sync_pacote_pedido for insert to macuxi_worker with check (true);',
      "create policy sync_pacote_pedido_gerador_marcar on plataforma.sync_pacote_pedido for update to macuxi_worker using (situacao = 'pendente') with check (true);",
      "create policy sync_pacote_pedido_gerador_expurgar on plataforma.sync_pacote_pedido for delete to macuxi_worker using (situacao <> 'pendente');",
    ]) expect(umaLinha).toContain(p);
    const grants = [...up.matchAll(/grant ([^;]*?) on (plataforma\.sync_pacote(?:_pedido)?) to (macuxi_\w+);/g)].map((g) => `${g[3]} ${g[2]}: ${g[1]!.replace(/\s+/g, ' ')}`);
    expect(grants).toEqual([
      'macuxi_app plataforma.sync_pacote: select',
      'macuxi_worker plataforma.sync_pacote: select',
      'macuxi_worker plataforma.sync_pacote: insert (id, tenant_id, modulo, particao, filial_id, formato, horizonte, geracao_base, chave_armazenamento, bytes, md5, entidades)',
      'macuxi_worker plataforma.sync_pacote: update (situacao, substituido_em, arquivo_apagado_em, deleted_at)',
      'macuxi_worker plataforma.sync_pacote: delete',
      'macuxi_app plataforma.sync_pacote_pedido: select',
      'macuxi_app plataforma.sync_pacote_pedido: insert (id, tenant_id, modulo, particao, filial_id, origem)',
      'macuxi_worker plataforma.sync_pacote_pedido: select',
      'macuxi_worker plataforma.sync_pacote_pedido: insert (id, tenant_id, modulo, particao, filial_id, origem, gerar_apos)',
      'macuxi_worker plataforma.sync_pacote_pedido: update (situacao, gerar_apos, tentativas, ultimo_erro, atendido_em, deleted_at)',
      'macuxi_worker plataforma.sync_pacote_pedido: delete',
    ]);
    expect(up).not.toMatch(/macuxi_portal/);
  });

  it('down idempotente desfaz tudo (índice e 2 tabelas), sem criar nada', () => {
    expect(down).toContain('drop index if exists catalogo.tabela_preco_item_filial_sync_ix;');
    expect(down).toContain('drop table if exists plataforma.sync_pacote_pedido;');
    expect(down).toContain('drop table if exists plataforma.sync_pacote;');
    expect(down).not.toMatch(/\b(create|add|grant)\b/i);
  });

  it('espelho Drizzle: mesmas colunas, nulidade e padrões', () => {
    const cfgPacote = getTableConfig(esquemaPlataforma.syncPacote);
    const cfgPedido = getTableConfig(esquemaPlataforma.syncPacotePedido);
    expect(`${cfgPacote.schema}.${cfgPacote.name}`).toBe(PACOTE);
    expect(`${cfgPedido.schema}.${cfgPedido.name}`).toBe(PEDIDO);
    expect(cfgPacote.columns.map((c) => c.name).sort()).toEqual([...COLUNAS_PACOTE].sort());
    expect(cfgPedido.columns.map((c) => c.name).sort()).toEqual([...COLUNAS_PEDIDO].sort());
    const nulas = (cols: { name: string; notNull: boolean }[]) => cols.filter((c) => !c.notNull).map((c) => c.name).sort();
    expect(nulas(cfgPacote.columns)).toEqual(['arquivo_apagado_em', 'deleted_at', 'external_id', 'filial_id', 'substituido_em']);
    expect(nulas(cfgPedido.columns)).toEqual(['atendido_em', 'deleted_at', 'external_id', 'filial_id', 'ultimo_erro']);
    expect(cfgPacote.columns.find((c) => c.name === 'situacao')?.default).toBe('pronto');
    expect(cfgPedido.columns.find((c) => c.name === 'situacao')?.default).toBe('pendente');
  });

  it('fixture: A e B com pacote e pedido; chave no formato do CHECK; um só pronto por partição; nenhum pedido pendente', () => {
    expect(ORDEM_TABELAS.indexOf(PACOTE)).toBeGreaterThan(ORDEM_TABELAS.indexOf('plataforma.tenant'));
    const dados = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const pacotes = dados[PACOTE];
    for (const t of [A, B]) {
      expect(pacotes.some((p) => p.tenant_id === t), `pacote em ${t}`).toBe(true);
      expect(dados[PEDIDO].some((p) => p.tenant_id === t), `pedido em ${t}`).toBe(true);
    }
    for (const p of pacotes) {
      expect(p.chave_armazenamento).toBe(chave(String(p.tenant_id), String(p.modulo), String(p.particao), String(p.id)));
      expect(p.particao).toBe(p.filial_id ? `filial:${String(p.filial_id)}` : 'tenant');
    }
    const prontos = pacotes.filter((p) => p.situacao === 'pronto').map((p) => `${String(p.tenant_id)}|${String(p.modulo)}|${String(p.particao)}`);
    expect(new Set(prontos).size).toBe(prontos.length);
    expect(pacotes.find((p) => p.id === SYNC_PACOTE_FIXTURE.A.filialPadrao)?.filial_id).toBe(FILIAIS_FIXTURE.A.padrao);
    expect(dados[PEDIDO].filter((p) => p.situacao === 'pendente')).toEqual([]);
  });
});

describe.skipIf(semBanco())('0074 pacote da primeira carga (banco, fixture dois-tenants)', () => {
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
  /** O insert do gerador (worker): só as colunas do grant; a chave no formato do CHECK. */
  const gerar = (id: string, tenant: string, modulo: string, filial: string | null, extra: { chave?: string; md5?: string } = {}) => {
    const particao = filial ? `filial:${filial}` : 'tenant';
    return como(
      'macuxi_worker',
      `insert into plataforma.sync_pacote (id, tenant_id, modulo, particao, filial_id, formato, horizonte, geracao_base, chave_armazenamento, bytes, md5, entidades)
       values ($1, $2, $3, $4, $5, 1, now(), $6, $7, 2048, $8, '{"tabela_preco_item": 3}')`,
      [id, tenant, modulo, particao, filial, GERACAO, extra.chave ?? chave(tenant, modulo, particao, id), extra.md5 ?? MD5],
    );
  };
  /** O pedido do manifesto (API, macuxi_app): idempotente por partição. */
  const pedir = (tenant: string, modulo: string, filial: string | null, contexto = tenant) =>
    como(
      'macuxi_app',
      `insert into plataforma.sync_pacote_pedido (id, tenant_id, modulo, particao, filial_id, origem)
       values (gen_random_uuid(), $1, $2, $3, $4, 'manifesto')
       on conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null do nothing`,
      [tenant, modulo, filial ? `filial:${filial}` : 'tenant', filial],
      contexto,
    );

  it('app: lê só os pacotes do próprio tenant; não grava, não marca nem apaga pacote', async () => {
    await emTransacao(admin, null, async () => {
      const deA = await como<{ id: string; tenant_id: string }>('macuxi_app', 'select id, tenant_id from plataforma.sync_pacote order by id', [], A);
      expect(deA.rows.map((r) => r.id).sort()).toEqual([SYNC_PACOTE_FIXTURE.A.catalogo, SYNC_PACOTE_FIXTURE.A.filialPadrao, SYNC_PACOTE_FIXTURE.A.substituido].sort());
      expect((await como('macuxi_app', 'select 1 from plataforma.sync_pacote where id = $1', [SYNC_PACOTE_FIXTURE.B.core], A)).rowCount).toBe(0);
      // o manifesto: o pronto vivo da partição, pelo único parcial
      const manifesto = await como<{ id: string }>(
        'macuxi_app',
        "select id from plataforma.sync_pacote where modulo = 'catalogo' and particao = 'tenant' and situacao = 'pronto' and deleted_at is null",
        [],
        A,
      );
      expect(manifesto.rows).toEqual([{ id: SYNC_PACOTE_FIXTURE.A.catalogo }]);
      // sem contexto: nada
      expect((await como('macuxi_app', 'select 1 from plataforma.sync_pacote')).rowCount).toBe(0);
      for (const sql of [
        "update plataforma.sync_pacote set situacao = 'substituido', substituido_em = now()",
        'delete from plataforma.sync_pacote',
        `insert into plataforma.sync_pacote (tenant_id, modulo, particao, horizonte, geracao_base, chave_armazenamento, bytes, md5, entidades) values ('${A}', 'core', 'tenant', now(), '${GERACAO}', 'x', 1, '${MD5}', '{}')`,
      ]) expect((await erroDe(como('macuxi_app', sql, [], A)))?.code, sql).toBe('42501');
    });
  });

  it('app: pedido idempotente por partição no próprio tenant; não grava em B, não escolhe situação e não marca', async () => {
    await emTransacao(admin, null, async () => {
      expect((await pedir(A, 'catalogo', FILIAIS_FIXTURE.A.boaVista)).rowCount).toBe(1);
      expect((await pedir(A, 'catalogo', FILIAIS_FIXTURE.A.boaVista)).rowCount).toBe(0);
      const pendentes = await como<{ situacao: string; gerar_apos: Date; atendido_em: Date | null }>(
        'macuxi_app',
        "select situacao, gerar_apos, atendido_em from plataforma.sync_pacote_pedido where situacao = 'pendente'",
        [],
        A,
      );
      expect(pendentes.rows).toHaveLength(1);
      expect(pendentes.rows[0]).toMatchObject({ situacao: 'pendente', atendido_em: null });
      // B não vê o pedido de A; A não pede em nome de B
      expect((await como('macuxi_app', "select 1 from plataforma.sync_pacote_pedido where situacao = 'pendente'", [], B)).rowCount).toBe(0);
      expect((await erroDe(pedir(B, 'catalogo', null, A)))?.code).toBe('42501');
      // colunas fora do grant e escrita fora do insert
      for (const sql of [
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, origem, situacao, atendido_em) values ('${A}', 'core', 'tenant', 'manifesto', 'atendido', now())`,
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, origem, gerar_apos) values ('${A}', 'core', 'tenant', 'manifesto', now())`,
        "update plataforma.sync_pacote_pedido set situacao = 'descartado', atendido_em = now()",
        'delete from plataforma.sync_pacote_pedido',
      ]) expect((await erroDe(como('macuxi_app', sql, [], A)))?.code, sql).toBe('42501');
    });
  });

  it('CHECKs: partição sem filial ou com filial diferente, chave de outro tenant, md5, origem e módulo inválidos = 23514', async () => {
    await emTransacao(admin, null, async () => {
      const id = '00700000-0000-4000-8000-000000000001';
      expect((await erroDe(gerar(id, A, 'catalogo', null, { chave: chave(B, 'catalogo', 'tenant', id) })))?.code).toBe('23514');
      expect((await erroDe(gerar(id, A, 'catalogo', null, { md5: 'XYZ' })))?.code).toBe('23514');
      const casos = [
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, filial_id, origem) values ('${A}', 'catalogo', 'filial:${FILIAIS_FIXTURE.A.padrao}', null, 'manifesto')`,
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, filial_id, origem) values ('${A}', 'catalogo', 'filial:${FILIAIS_FIXTURE.A.padrao}', '${FILIAIS_FIXTURE.A.boaVista}', 'manifesto')`,
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, filial_id, origem) values ('${A}', 'catalogo', 'tenant', '${FILIAIS_FIXTURE.A.padrao}', 'manifesto')`,
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, origem) values ('${A}', 'catalogo', 'tenant', 'outra')`,
        `insert into plataforma.sync_pacote_pedido (tenant_id, modulo, particao, origem) values ('${A}', 'Catalogo', 'tenant', 'manifesto')`,
      ];
      for (const sql of casos) expect((await erroDe(como('macuxi_app', sql, [], A)))?.code, sql).toBe('23514');
    });
  });

  it('worker: gera em todos os tenants; um só pronto por partição; substitui, apaga o arquivo e expurga só o apagado', async () => {
    await emTransacao(admin, null, async () => {
      const vistos = await como<{ tenant_id: string }>('macuxi_worker', 'select distinct tenant_id from plataforma.sync_pacote');
      expect(vistos.rows.map((r) => r.tenant_id).sort()).toEqual([A, B].sort());
      const novo = '00700000-0000-4000-8000-000000000011';
      // a partição já tem um pronto vivo: o 2º pronto = 23505 até o anterior virar substituído (mesma transação do gerador)
      expect((await erroDe(gerar(novo, A, 'catalogo', null)))?.code).toBe('23505');
      const anterior = await como('macuxi_worker', "update plataforma.sync_pacote set situacao = 'substituido', substituido_em = now() where id = $1", [SYNC_PACOTE_FIXTURE.A.catalogo]);
      expect(anterior.rowCount).toBe(1);
      expect((await gerar(novo, A, 'catalogo', null)).rowCount).toBe(1);
      const lido = await como<{ situacao: string; formato: number }>('macuxi_worker', 'select situacao, formato from plataforma.sync_pacote where id = $1', [novo]);
      expect(lido.rows).toEqual([{ situacao: 'pronto', formato: 1 }]);
      // em B também (todos os tenants), na partição de filial
      expect((await gerar('00700000-0000-4000-8000-000000000012', B, 'catalogo', FILIAIS_FIXTURE.B.campinas)).rowCount).toBe(1);
      // retenção: apaga o arquivo do substituído; apagado não volta, e só ele sai da tabela
      expect((await como('macuxi_worker', 'delete from plataforma.sync_pacote where id = $1', [SYNC_PACOTE_FIXTURE.A.substituido])).rowCount).toBe(0);
      expect((await como('macuxi_worker', "update plataforma.sync_pacote set situacao = 'apagado', arquivo_apagado_em = now() where id = $1", [SYNC_PACOTE_FIXTURE.A.substituido])).rowCount).toBe(1);
      expect((await como('macuxi_worker', "update plataforma.sync_pacote set situacao = 'pronto', substituido_em = null, arquivo_apagado_em = null where id = $1", [SYNC_PACOTE_FIXTURE.A.substituido])).rowCount).toBe(0);
      expect((await como('macuxi_worker', 'delete from plataforma.sync_pacote where id = $1', [SYNC_PACOTE_FIXTURE.A.substituido])).rowCount).toBe(1);
      // ciclo incoerente = 23514; colunas fora do grant = 42501
      expect((await erroDe(como('macuxi_worker', "update plataforma.sync_pacote set situacao = 'substituido' where id = $1", [novo])))?.code).toBe('23514');
      for (const sql of [
        `update plataforma.sync_pacote set md5 = '${MD5}'`,
        "update plataforma.sync_pacote set tenant_id = tenant_id",
        "update plataforma.sync_pacote set external_id = 'x'",
      ]) expect((await erroDe(como('macuxi_worker', sql)))?.code, sql).toBe('42501');
    });
  });

  it('worker: pedidos de todos os tenants; empurra o gerar_apos do pendente, atende e expurga só o que saiu da fila', async () => {
    await emTransacao(admin, null, async () => {
      const id = '00700000-0000-4000-8000-000000000021';
      const gravado = await como(
        'macuxi_worker',
        `insert into plataforma.sync_pacote_pedido (id, tenant_id, modulo, particao, origem, gerar_apos) values ($1, $2, 'catalogo', 'tenant', 'lote', now() + interval '5 minutes')
         on conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null do update set gerar_apos = excluded.gerar_apos`,
        [id, B],
      );
      expect(gravado.rowCount).toBe(1);
      const fila = await como<{ id: string }>('macuxi_worker', "select id from plataforma.sync_pacote_pedido where situacao = 'pendente' order by gerar_apos limit 10 for update skip locked");
      expect(fila.rows.map((r) => r.id)).toContain(id);
      // pendente não sai da tabela; atendido sai
      expect((await como('macuxi_worker', 'delete from plataforma.sync_pacote_pedido where id = $1', [id])).rowCount).toBe(0);
      expect((await como('macuxi_worker', "update plataforma.sync_pacote_pedido set situacao = 'atendido', atendido_em = now(), tentativas = 1 where id = $1", [id])).rowCount).toBe(1);
      expect((await como('macuxi_worker', "update plataforma.sync_pacote_pedido set ultimo_erro = 'x' where id = $1", [id])).rowCount).toBe(0);
      expect((await como('macuxi_worker', 'delete from plataforma.sync_pacote_pedido where id = $1', [id])).rowCount).toBe(1);
      expect((await erroDe(como('macuxi_worker', "update plataforma.sync_pacote_pedido set origem = 'agendado'")))?.code).toBe('42501');
    });
  });

  it('portal: nenhum acesso; índice por filial em catalogo.tabela_preco_item e índices das tabelas novas no catálogo', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of [PACOTE, PEDIDO]) expect((await erroDe(como('macuxi_portal', `select 1 from ${t} limit 1`)))?.code, t).toBe('42501');
      const ix = await admin.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where (schemaname = 'plataforma' and tablename in ('sync_pacote', 'sync_pacote_pedido')) or indexname = 'tabela_preco_item_filial_sync_ix'",
      );
      expect(ix.rows.map((r) => r.indexname).sort()).toEqual([
        'sync_pacote_filial_ix', 'sync_pacote_pedido_filial_ix', 'sync_pacote_pedido_fila_ix', 'sync_pacote_pedido_pendente_uk', 'sync_pacote_pedido_pkey',
        'sync_pacote_pkey', 'sync_pacote_pronto_uk', 'sync_pacote_substituido_ix', 'tabela_preco_item_filial_sync_ix',
      ].sort());
      expect(ix.rows.find((r) => r.indexname === 'tabela_preco_item_filial_sync_ix')?.indexdef).toContain('(tenant_id, filial_id, updated_at, id)');
    });
  });
});

describe.skipIf(semBanco())('0074 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000070';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('down volta ao catálogo da 0073; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0073' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0074' })).aplicadas).toEqual(['0074_plataforma_sync_pacote']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col plataforma.sync_pacote.chave_armazenamento text nn=true');
      expect(depois).toContain('col plataforma.sync_pacote_pedido.origem text nn=true');
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'pacote70', 'Pacote')", [T]);
      await c.query(
        `insert into plataforma.sync_pacote (tenant_id, id, modulo, particao, horizonte, geracao_base, chave_armazenamento, bytes, md5, entidades)
         values ($1, $2, 'core', 'tenant', now(), $3, $4, 10, $5, '{}')`,
        [T, '00700000-0000-4000-8000-0000000000aa', GERACAO, chave(T, 'core', 'tenant', '00700000-0000-4000-8000-0000000000aa'), MD5],
      );
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0074_plataforma_sync_pacote']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m74.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0074' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
