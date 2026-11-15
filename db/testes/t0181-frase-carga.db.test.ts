/**
 * 0081 — frases da tela de carga (T-0181; spec docs/design/carga-aviso-frases/spec.md §2 a §4 e frases.md, commit 3cdb384).
 * Dicionário: docs/banco/plataforma.md, "Frases da carga (0081)". O que o BANCO garante:
 * - plataforma.frase_carga GLOBAL (sem tenant_id), só por função: RLS enable + force, só a política manutencao, nenhum grant de
 *   tabela para app, worker ou portal; sem DELETE (não há exclusão);
 * - texto 1..90 depois do trim, sem frase repetida entre as vivas (sem diferenciar maiúsculas nem espaços nas pontas), Nº único,
 *   decididos pela tabela (CHECK e índice único; as sa_* propagam 23514 e 23505, RD-0523);
 * - as 30 iniciais com o texto literal do frases.md, Nº e ordem 1..30, todas ativas, id = uuid_de_chave
 *   ('plataforma:frase_carga:NN'), carga idempotente;
 * - portal: sa_listar/sa_incluir/sa_editar_frase_carga só do super-admin (28000 sem sessão, 42501 admin do cliente), auditadas;
 *   a incluída nasce ativa com Nº e ordem = max + 1 e o reenvio com o mesmo id é idempotente; app: frases_carga_ativas() só
 *   com as ativas e vivas. Assinaturas alinhadas com a API (seção 3 de docs/desenho/T-0181.md).
 * Estático na sessão; banco (fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esquemaPlataforma from '../esquema/plataforma';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { idDeChave } from '../src/ids';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0081, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

/** As 30 frases iniciais, texto literal do frases.md aprovado (commit 3cdb384), na ordem do Nº. */
const FRASES_ESPERADAS = [
  'Os Macuxi se autodenominam Pemon e falam uma língua da família Karib.',
  'O território Macuxi vai do lavrado, ao sul, às serras com floresta, ao norte.',
  'Em 2020, o povo Macuxi somava 37.250 pessoas em Roraima.',
  'Os Macuxi chamam de tuma a damurida, caldo de pimenta com peixe ou carne.',
  'A Raposa Serra do Sol, terra dos Macuxi e vizinhos, foi homologada em 2005.',
  'Em Bonfim, a Lei 211/2014 tornou cooficiais as línguas Macuxi e Wapichana.',
  'A pintora Macuxi Carmézia Emiliano nasceu na Maloca do Japó.',
  'O artista Macuxi Jaider Esbell ilustrou Do Roraima ao Orinoco em português.',
  'Com 2.734,9 m, o Monte Roraima é o 7º ponto mais alto do Brasil.',
  'O Monte Roraima fica na fronteira do Brasil com a Venezuela e a Guiana.',
  'O Parque Nacional do Monte Roraima foi criado em 28 de junho de 1989.',
  'As rochas que formam o Monte Roraima têm até 1,95 bilhão de anos.',
  'Um mapa de 1654 chama o Monte Roraima de "montanha de cristais".',
  'Um relato de 1885 sobre o Monte Roraima influenciou O Mundo Perdido.',
  'Em 2019, ICMBio e Ingarikó catalogaram novas espécies no parque do monte.',
  'Ingarikó e Pemon formam um só mundo cultural em torno do Monte Roraima.',
  'Makunaimã, das narrativas Macuxi e Pemon, inspirou Mário de Andrade.',
  'Segundo a tradição Macuxi, Makunaimã e Enxikirang são irmãos, filhos do Sol.',
  'Segundo a tradição Macuxi, o Monte Roraima é o tronco da árvore Wazacá.',
  'Segundo a tradição Taurepang, Makunaimã fez gente e bichos de barro.',
  'Segundo a tradição Ingarikó, o povo descende de Siikë, irmão de Makunaimã.',
  'Segundo a tradição Ingarikó, as plantas cultivadas vêm das sementes da Wayaka.',
  'Entre 1911 e 1913, Koch-Grünberg registrou narrativas de Makunaimã.',
  'A peça Makunaimã (2019) reúne autores Macuxi, Taurepang e Wapichana.',
  'O Forte São Joaquim, de 1775, é o único bem tombado pelo Iphan em Roraima.',
  'Na Pedra Pintada, em Pacaraima, há marcas humanas de cerca de 4.000 anos.',
  'Roraima nasceu em 1943 como Território do Rio Branco; o nome veio em 1962.',
  'O lavrado, a savana de Roraima, cobre cerca de 17% do estado.',
  'O ponto mais ao norte do Brasil é a nascente do rio Ailã, em Uiramutã.',
  'Uiramutã tem a maior proporção de indígenas do Brasil: 96,6% em 2022.',
] as const;
/** FRASE_CARGA_MAX do SDK (spec §3: o campo para em 90). */
const MAX = 90;
/** Id determinístico da frase inicial Nº n (a mesma regra do FRASES_CARGA_INICIAIS do SDK). */
const idInicial = (n: number) => idDeChave(`plataforma:frase_carga:${String(n).padStart(2, '0')}`);

const migracoes = lerMigracoes();
const m81 = migracoes.find((m) => m.versao === '0081')!;
const anterior = migracoes[migracoes.indexOf(m81) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m81.up);
const down = semComentarios(m81.down);
const nome = (f: string) => f.slice(0, f.indexOf('('));
/** Bloco de uma função até o "$$;" que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
/** As linhas do VALUES da carga, na ordem do arquivo. */
const frasesDaMigracao = () =>
  [...m81.up.matchAll(/^\s+\((\d+), '((?:[^']|'')*)'\),?$/gm)].map((m) => ({ numero: Number(m[1]), texto: m[2]!.replace(/''/g, "'") }));
/** Comando da carga (insert ... on conflict do nothing;), para provar a idempotência no banco. */
const CARGA = /insert into plataforma\.frase_carga \(id, numero, texto, ativa, ordem\)[\s\S]*?on conflict do nothing;/.exec(m81.up)?.[0] ?? '';
const corpoTabela = /create table plataforma\.frase_carga \(([\s\S]*?)\n\);/.exec(up)?.[1] ?? '';
const colunasDoSql = () => [...corpoTabela.matchAll(/^\s+([a-z_]+)\s+(?:uuid|text|timestamptz|boolean|integer)\b/gm)].map((m) => m[1]!);
const LEITURA_APP = 'plataforma.frases_carga_ativas()';

describe('0081 frases da carga (estático)', () => {
  it('nome: 0081_plataforma_frase_carga, com up e down', () => {
    expect(`${m81.versao}_${m81.nome}`).toBe('0081_plataforma_frase_carga');
    expect(m81.down.length).toBeGreaterThan(0);
  });

  it('as 30 frases da carga são as do frases.md (texto literal), Nº 1..30, cada uma em 1..90 e sem repetição', () => {
    const daMigracao = frasesDaMigracao();
    expect(daMigracao).toEqual(FRASES_ESPERADAS.map((texto, i) => ({ numero: i + 1, texto })));
    expect(daMigracao).toHaveLength(30);
    for (const f of daMigracao) {
      expect(f.texto).toBe(f.texto.trim());
      expect([...f.texto].length).toBeGreaterThan(0);
      expect([...f.texto].length).toBeLessThanOrEqual(MAX);
    }
    expect(new Set(daMigracao.map((f) => f.texto.trim().toLowerCase())).size).toBe(30);
  });

  it('frases.md no repositório (quando a pasta da spec entrar): mesma lista, todas com situação inicial Ativa', () => {
    const arquivo = new URL('../../docs/design/carga-aviso-frases/frases.md', import.meta.url);
    if (!existsSync(arquivo)) return; // a pasta vem no lote do designer-ux (T-0181); a lista acima é a cópia do commit 3cdb384
    const linhas = readFileSync(arquivo, 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l));
    const doMd = linhas.map((l) => l.replace(/^\| /, '').replace(/ \|$/, '').split(' | '));
    expect(doMd.map((c) => Number(c[0]))).toEqual(FRASES_ESPERADAS.map((_, i) => i + 1));
    expect(doMd.map((c) => c[3])).toEqual([...FRASES_ESPERADAS]);
    expect(doMd.every((c) => c[2] === 'Ativa')).toBe(true);
  });

  it('carga: id = uuid_de_chave(plataforma:frase_carga:NN), ativa, ordem = Nº, idempotente', () => {
    const umaLinha = CARGA.replace(/\s+/g, ' ');
    expect(umaLinha).toContain("select plataforma.uuid_de_chave('plataforma:frase_carga:' || lpad(f.numero::text, 2, '0')), f.numero, f.texto, true, f.numero");
    expect(umaLinha).toMatch(/\) as f\(numero, texto\) on conflict do nothing;$/);
    const ids = FRASES_ESPERADAS.map((_, i) => idInicial(i + 1));
    expect(new Set(ids).size).toBe(30);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('colunas obrigatórias (regra 5, sem tenant_id: tabela global), CHECKs e únicos; espelho Drizzle igual', () => {
    expect(colunasDoSql()).toEqual(['id', 'numero', 'texto', 'ativa', 'ordem', 'created_at', 'updated_at', 'deleted_at', 'external_id']);
    expect(corpoTabela).toMatch(/^\s+id\s+uuid primary key default gen_random_uuid\(\),$/m);
    expect(corpoTabela).toMatch(/^\s+ativa\s+boolean not null default true,$/m);
    expect(corpoTabela).not.toMatch(/^\s+tenant_id\s/m);
    const umaLinha = up.replace(/\s+/g, ' ');
    expect(umaLinha).toContain(`constraint frase_carga_texto_tamanho check (char_length(btrim(texto)) between 1 and ${MAX})`);
    expect(umaLinha).toContain('constraint frase_carga_numero_positivo check (numero >= 1)');
    expect(up).toContain('create unique index frase_carga_numero_uk on plataforma.frase_carga (numero);');
    expect(up).toContain('create unique index frase_carga_texto_uk on plataforma.frase_carga (lower(btrim(texto))) where deleted_at is null;');
    expect(up).toMatch(/create trigger frase_carga_updated_at before update on plataforma\.frase_carga\s+for each row execute function plataforma\.definir_updated_at\(\);/);
    expect(getTableConfig(esquemaPlataforma.fraseCarga).columns.map((c) => c.name).sort()).toEqual(colunasDoSql().sort());
  });

  it('exceção declarada: sem tenant_id e só por função (excecoes.ts), fora do sync por linha', () => {
    expect('plataforma.frase_carga' in TABELAS_SEM_TENANT_ID).toBe(true);
    expect(TABELAS_SO_POR_FUNCAO as readonly string[]).toContain('plataforma.frase_carga');
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).not.toContain('plataforma.frase_carga'); // sem tenant já é fora do sync
  });

  it('RLS enable + force, só a política manutencao, nenhum grant de tabela; sem DELETE e sem função de exclusão', () => {
    expect(up).toContain('alter table plataforma.frase_carga enable row level security;');
    expect(up).toContain('alter table plataforma.frase_carga force row level security;');
    expect(up).toContain('create policy manutencao on plataforma.frase_carga for all to macuxi_manutencao using (true) with check (true);');
    expect([...up.matchAll(/create policy ([a-z_]+) on plataforma\.frase_carga/g)].map((m) => m[1])).toEqual(['manutencao']);
    expect(up).toContain('revoke all on plataforma.frase_carga from public, macuxi_app, macuxi_worker;');
    expect(up).toContain('revoke all on plataforma.frase_carga from macuxi_portal;');
    expect(up).not.toMatch(/grant [^;]* on (table )?plataforma\.frase_carga/);
    expect(up).not.toMatch(/grant [^;]*delete/i);
    expect(up).not.toMatch(/delete from plataforma\.frase_carga/i);
    expect(up).not.toMatch(/excluir|apagar_frase/);
  });

  it('as 3 sa_*: SECURITY DEFINER, pg_temp por último, EXECUTE só ao portal; 28000 sem sessão, 42501 admin do cliente; auditoria sem o texto', () => {
    expect(FUNCOES_SA_0081.map(nome)).toEqual(['plataforma.sa_listar_frases_carga', 'plataforma.sa_incluir_frase_carga', 'plataforma.sa_editar_frase_carga']);
    expect(FUNCOES_SA_ATUAIS).toHaveLength(19);
    for (const f of FUNCOES_SA_0081) {
      const b = bloco(up, `create function ${nome(f)}(`);
      expect(b, f).toMatch(/returns jsonb\s+language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b, f).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
      expect(b, f).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
      const auditoria = b.slice(b.indexOf('sa_registrar_auditoria'), b.indexOf('sa_registrar_auditoria') + 300);
      expect(auditoria, f).toContain(`'sa.frase_carga.`);
      expect(auditoria.split(';')[0], f).not.toMatch(/'texto', /);
    }
    const incluir = bloco(up, 'create function plataforma.sa_incluir_frase_carga(');
    expect(incluir).toContain('coalesce(max(x.numero), 0) + 1 as numero, coalesce(max(x.ordem), 0) + 1 as ordem from plataforma.frase_carga x');
    expect(incluir).toContain('select coalesce(p_id, gen_random_uuid()), n.numero, v_texto, true, n.ordem');
    expect(incluir).toContain('lock table plataforma.frase_carga in share row exclusive mode;');
    // RD-0523: vazia, acima de 90 e repetida ficam com a tabela (CHECK e índice único); as funções não repetem o limite
    for (const b of [incluir, bloco(up, 'create function plataforma.sa_editar_frase_carga(')]) {
      expect(b).not.toContain("errcode = '23514'");
      expect(b).not.toMatch(/char_length|\b90\b|if exists \(select 1 from plataforma\.frase_carga/);
    }
    expect(up).toContain(`constraint frase_carga_texto_tamanho check (char_length(btrim(texto)) between 1 and ${MAX})`);
    expect(up).toContain('create unique index frase_carga_texto_uk on plataforma.frase_carga (lower(btrim(texto))) where deleted_at is null;');
    expect(bloco(up, 'create function plataforma.sa_editar_frase_carga(')).toContain("using errcode = 'P0002'");
    expect(bloco(up, 'create function plataforma.sa_listar_frases_carga(')).toContain('order by f.ativa desc, f.numero');
  });

  it('leitura do app: frases_carga_ativas() SECURITY DEFINER, só ativas e vivas, EXECUTE só ao macuxi_app', () => {
    const b = bloco(up, 'create function plataforma.frases_carga_ativas(');
    expect(b).toMatch(/returns jsonb\s+language sql stable security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).toContain("jsonb_build_object('frases', coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'texto', f.texto, 'ordem', f.ordem)");
    expect(b).toContain('where f.ativa and f.deleted_at is null');
    expect(b).toContain('order by f.ordem, f.numero), \'[]\'::jsonb))');
    expect(up).toContain(`revoke all on function ${LEITURA_APP} from public;`);
    expect([...up.matchAll(/grant execute on function plataforma\.frases_carga_ativas\(\) to ([a-z_]+);/g)].map((m) => m[1])).toEqual(['macuxi_app']);
  });

  it('down idempotente desfaz tudo (4 funções e a tabela), sem criar nada', () => {
    for (const f of [LEITURA_APP, ...FUNCOES_SA_0081]) expect(down).toContain(`drop function if exists ${f};`);
    expect(down).toContain('drop table if exists plataforma.frase_carga;');
    expect(down).not.toMatch(/\b(create|grant|insert)\b/i);
  });
});

describe.skipIf(semBanco())('0081 frases da carga (banco, fixture dois-tenants)', () => {
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
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.t181@macuxi.exemplo', nome: 'Operador 0081', senha_hash: HASH_TESTE })]))[0]!.r;
    return (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }))!.sessao_id;
  }
  type Frase = { id: string; numero: number; texto: string; ativa: boolean; ordem: number };
  const listar = async (sid: string) => (await portal<{ r: { itens: Frase[] } }>('select plataforma.sa_listar_frases_carga($1) as r', [sid]))[0]!.r.itens;
  const incluir = async (sid: string, texto: string | null, id: string | null = null) =>
    (await portal<{ r: Frase }>('select plataforma.sa_incluir_frase_carga($1, $2, $3) as r', [sid, id, texto]))[0]!.r;
  const editar = async (sid: string, id: string, texto: string | null, ativa: boolean | null) =>
    (await portal<{ r: Frase }>('select plataforma.sa_editar_frase_carga($1, $2, $3, $4) as r', [sid, id, texto, ativa]))[0]!.r;
  const ativasDoApp = async (tenant = '') =>
    (await como<{ r: { frases: Array<{ id: string; texto: string; ordem: number }> } }>('macuxi_app', `select ${LEITURA_APP} as r`, [], tenant)).rows[0]!.r.frases;
  const iniciais = () => FRASES_ESPERADAS.map((texto, i) => ({ id: idInicial(i + 1), numero: i + 1, texto, ativa: true, ordem: i + 1 }));

  it('as 30 iniciais no banco: ids do uuid_de_chave (= idDeChave do TS), Nº e ordem 1..30, ativas; carga de novo não muda nada', async () => {
    await emTransacao(admin, null, async () => {
      expect(await q('select id, numero, texto, ativa, ordem from plataforma.frase_carga order by numero')).toEqual(iniciais());
      expect((await admin.query(CARGA)).rowCount).toBe(0);
      expect(await q<{ n: number }>('select count(*)::int as n from plataforma.frase_carga')).toEqual([{ n: 30 }]);
    });
  });

  it('app e worker sem acesso à tabela (42501, com ou sem tenant); app lê as 30 ativas pela função; worker e portal não executam a função', async () => {
    await emTransacao(admin, null, async () => {
      for (const sql of ['select 1 from plataforma.frase_carga', 'delete from plataforma.frase_carga', "update plataforma.frase_carga set ativa = false", "insert into plataforma.frase_carga (numero, texto, ordem) values (99, 'x', 99)"]) {
        expect((await erroDe(como('macuxi_app', sql, [], DOIS_TENANTS.A.tenantId)))?.code, sql).toBe('42501');
        expect((await erroDe(como('macuxi_worker', sql)))?.code, sql).toBe('42501');
        expect((await erroDe(como('macuxi_portal', sql)))?.code, sql).toBe('42501');
      }
      const esperado = iniciais().map(({ id, texto, ordem }) => ({ id, texto, ordem }));
      expect(await ativasDoApp(DOIS_TENANTS.A.tenantId)).toEqual(esperado);
      expect(await ativasDoApp(DOIS_TENANTS.B.tenantId)).toEqual(esperado);
      expect(await ativasDoApp()).toEqual(esperado);
      for (const papel of ['macuxi_worker', 'macuxi_portal']) expect((await erroDe(como(papel, `select ${LEITURA_APP}`)))?.code, papel).toBe('42501');
      for (const papel of ['macuxi_app', 'macuxi_worker']) expect((await erroDe(como(papel, 'select plataforma.sa_listar_frases_carga(null)')))?.code, papel).toBe('42501');
    });
  });

  it('portal: 28000 sem sessão; admin do cliente 42501; super-admin lista, inclui (Nº 31, ativa), idempotente pelo id, recusa vazia/91/repetida e audita', async () => {
    await emTransacao(admin, null, async () => {
      expect((await erroDe(como('macuxi_portal', 'select plataforma.sa_listar_frases_carga(null)')))?.code).toBe('28000');
      const cli = (await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: DOIS_TENANTS.A.tenantId, usuario_id: DOIS_TENANTS.A.usuarios.admin }] }))!;
      expect((await erroDe(listar(cli.sessao_id)))?.code).toBe('42501');
      expect((await erroDe(incluir(cli.sessao_id, 'Frase do cliente.')))?.code).toBe('42501');
      expect((await erroDe(editar(cli.sessao_id, idInicial(1), null, false)))?.code).toBe('42501');

      const sid = await sessaoSuperAdmin();
      expect(await listar(sid)).toEqual(iniciais());
      const ID_NOVA = 'dddddddd-0181-4000-8000-000000000031';
      const nova = await incluir(sid, '  O Rio Branco corta Boa Vista.  ', ID_NOVA);
      expect(nova).toEqual({ id: ID_NOVA, numero: 31, texto: 'O Rio Branco corta Boa Vista.', ativa: true, ordem: 31 });
      expect(await incluir(sid, 'o rio branco corta boa vista.', ID_NOVA)).toEqual(nova); // reenvio: a mesma, sem gravar de novo
      expect((await erroDe(incluir(sid, 'Outra frase com o mesmo id.', ID_NOVA)))?.code).toBe('23505');
      expect((await ativasDoApp()).at(-1)).toEqual({ id: nova.id, texto: nova.texto, ordem: 31 });
      expect(await erroDe(incluir(sid, '   '))).toMatchObject({ code: '23514', message: expect.stringContaining('frase_carga_texto_tamanho') });
      expect(await erroDe(incluir(sid, null))).toMatchObject({ code: '23514' });
      expect((await erroDe(incluir(sid, 'x'.repeat(MAX + 1))))?.code).toBe('23514');
      expect(await incluir(sid, 'y'.repeat(MAX))).toMatchObject({ numero: 32, ordem: 32, ativa: true });
      expect(await erroDe(incluir(sid, ' o rio branco CORTA boa vista. '))).toMatchObject({ code: '23505', message: expect.stringContaining('frase_carga_texto_uk') });
      expect(await erroDe(incluir(sid, FRASES_ESPERADAS[0]))).toMatchObject({ code: '23505' });
      const acoes = await q<{ acao: string; detalhes: Record<string, unknown> }>(
        "select acao, detalhes from plataforma.auditoria_plataforma where acao like 'sa.frase_carga.%' order by created_at, acao");
      // mesma transação = mesmo created_at: confere o conjunto (o reenvio idempotente não audita de novo)
      expect(acoes.map((a) => a.acao)).toEqual(['sa.frase_carga.incluir', 'sa.frase_carga.incluir', 'sa.frase_carga.listar']);
      expect(acoes.map((a) => a.detalhes)).toContainEqual(expect.objectContaining({ frase_id: nova.id, numero: 31 }));
      expect(JSON.stringify(acoes)).not.toContain('Rio Branco');
    });
  });

  it('portal: editar texto e situação (nulo = não muda); desativada sai do app e vai ao fim da lista; P0002 e repetida 23505', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const desativada = await editar(sid, idInicial(2), null, false);
      expect(desativada).toEqual({ ...iniciais()[1], ativa: false });
      expect((await ativasDoApp()).map((f) => f.id)).not.toContain(idInicial(2));
      expect((await ativasDoApp()).length).toBe(29);
      const lista = await listar(sid);
      expect(lista.at(-1)!.id).toBe(idInicial(2));
      expect(lista.slice(0, 29).every((f) => f.ativa)).toBe(true);
      expect(await editar(sid, idInicial(2), null, true)).toEqual(iniciais()[1]);
      const editada = await editar(sid, idInicial(3), '  Em 2020, os Macuxi eram 37.250 em Roraima. ', null);
      expect(editada).toEqual({ ...iniciais()[2], texto: 'Em 2020, os Macuxi eram 37.250 em Roraima.' });
      expect(await editar(sid, idInicial(3), null, null)).toEqual(editada);
      expect(await erroDe(editar(sid, idInicial(4), FRASES_ESPERADAS[0].toUpperCase(), null))).toMatchObject({ code: '23505' });
      expect(await editar(sid, idInicial(1), FRASES_ESPERADAS[0].toUpperCase(), null)).toMatchObject({ numero: 1, texto: FRASES_ESPERADAS[0].toUpperCase() });
      expect((await erroDe(editar(sid, idInicial(4), ' ', null)))?.code).toBe('23514');
      expect((await erroDe(editar(sid, idInicial(4), 'z'.repeat(MAX + 1), null)))?.code).toBe('23514');
      expect((await erroDe(editar(sid, '00000000-0000-4000-8000-000000000000', null, false)))?.code).toBe('P0002');
      const ed = await q<{ detalhes: Record<string, unknown> }>("select detalhes from plataforma.auditoria_plataforma where acao = 'sa.frase_carga.editar' order by created_at");
      expect(ed.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(ed)).not.toContain('Em 2020');
    });
  });
});

describe.skipIf(semBanco())('0081 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria a tabela com as 30 e as 4 funções; down volta ao catálogo anterior; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0081' })).aplicadas).toEqual(['0081_plataforma_frase_carga']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('rel plataforma.frase_carga r rls=true force=true');
      expect((await c.query<{ n: number }>('select count(*)::int as n from plataforma.frase_carga where ativa')).rows[0]!.n).toBe(30);
      expect((await c.query<{ id: string }>('select plataforma.uuid_de_chave($1)::text as id', ['plataforma:frase_carga:07'])).rows[0]!.id).toBe(idInicial(7));
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0081_plataforma_frase_carga']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m81.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0081' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
