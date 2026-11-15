/**
 * 0073 — dados legais da Macuxi para o rodapé das telas Entrar (pedido R-20261114-221000-alexandre; spec
 * docs/design/telas/rodape-legal.md §3.2 e §3.3; rotas em apps/api/src/dados-legais.ts). Dicionário: docs/banco/plataforma.md,
 * "Dados legais da Macuxi (0073)". O que o BANCO garante:
 * - plataforma.dados_legais: uma linha só (já criada, razão social e CNPJ nulos, site padrão); sem tenant_id; RLS ligado e
 *   forçado, só a política manutencao; nenhum grant de tabela (app, worker e portal: 42501); CHECKs iguais ao contrato;
 * - dados_legais_publicos() (só o macuxi_app, sem sessão nem contexto) devolve só { razao_social, cnpj, site }
 *   (DadosLegaisSchema), com o padrão quando a linha não existe;
 * - sa_dados_legais / sa_gravar_dados_legais (só o macuxi_portal): super-admin; admin do cliente = 42501; sessão inválida =
 *   28000; entrada fora da forma = 22023; valor fora das regras = 23514; gravação idempotente (o mesmo conteúdo não muda a
 *   linha nem audita) e auditada com o antes e o depois;
 * - up/down: a 0073 só acrescenta; o down volta exatamente ao catálogo e às ACLs da migração anterior.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero) no CI.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DadosLegaisSchema, GravarDadosLegaisSchema, SITE_PADRAO } from '@macuxi/platform-sdk';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { DADOS_LEGAIS_PUBLICOS, FUNCOES_SA_0073, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m73 = migracoes.find((m) => m.versao === '0073')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m73.up);
const down = semComentarios(m73.down);
/** Bloco de uma função até o "$$;" que fecha o corpo. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^ {0,2}\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const TABELA = 'plataforma.dados_legais';
const PUBLICOS = 'create function plataforma.dados_legais_publicos()';
const LER = 'create function plataforma.sa_dados_legais(p_sid uuid)';
const GRAVAR = 'create function plataforma.sa_gravar_dados_legais(p_sid uuid, p jsonb)';
const PADRAO = { razao_social: null, cnpj: null, site: SITE_PADRAO };
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const A = DOIS_TENANTS.A.tenantId;

describe('0073 dados legais (estático)', () => {
  it('nome e posição: 0073_plataforma_dados_legais logo depois da 0072_plataforma_empresa_acoes', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(m73.nome).toBe('plataforma_dados_legais');
    expect(nomes[nomes.indexOf('0072_plataforma_empresa_acoes') + 1]).toBe('0073_plataforma_dados_legais');
  });

  it('tabela: uma linha só, sem tenant_id, RLS forçado, só a manutencao, nenhum grant; CHECKs do contrato; linha criada', () => {
    expect(TABELA in TABELAS_SEM_TENANT_ID).toBe(true);
    expect(TABELAS_SO_POR_FUNCAO).toContain(TABELA);
    const corpo = up.slice(up.indexOf(`create table ${TABELA} (`), up.indexOf(');', up.indexOf(`create table ${TABELA} (`)));
    expect(corpo).not.toMatch(/^\s+tenant_id\s/m);
    expect(corpo).toMatch(/^\s+site\s+text not null default 'macuxifdv\.com\.br',$/m);
    expect(corpo).toMatch(/^\s+atualizado_por\s+uuid references plataforma\.super_admin \(id\),$/m);
    expect(corpo).toContain("cnpj ~ '^[0-9]{14}$'");
    expect(corpo).toContain("razao_social = btrim(razao_social) and razao_social <> '' and char_length(razao_social) <= 120");
    expect(up).toContain(`create unique index dados_legais_uma_linha_uk on ${TABELA} ((true));`);
    expect(up).toContain(`alter table ${TABELA} enable row level security;`);
    expect(up).toContain(`alter table ${TABELA} force row level security;`);
    expect(up).toContain(`create policy manutencao on ${TABELA} for all to macuxi_manutencao using (true) with check (true);`);
    expect(up.match(/create policy/g)).toHaveLength(1);
    expect(up).not.toMatch(/grant [a-z, ()_]+ on plataforma\.dados_legais to/);
    expect(up).toContain(`insert into ${TABELA} (razao_social, cnpj, site) values (null, null, 'macuxifdv.com.br');`);
    expect(SITE_PADRAO).toBe('macuxifdv.com.br');
  });

  it('funções: SECURITY DEFINER com search_path fixo; leitura pública só ao app; sa_* só ao portal; sessão e perfil conferidos', () => {
    expect(bloco(up, PUBLICOS)).toMatch(/language sql stable security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    for (const inicio of [LER, GRAVAR]) {
      const b = bloco(up, inicio);
      expect(b, inicio).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
      expect(b, inicio).toContain('from plataforma.sa_sessao_valida(p_sid) v;');
      expect(b, inicio).toContain("using errcode = '28000';");
      expect(b, inicio).toContain("if v_tipo is distinct from 'super_admin' or v_sa is null then");
      expect(b, inicio).toContain("using errcode = '42501';");
    }
    expect(up).toContain(`revoke all on function ${DADOS_LEGAIS_PUBLICOS} from public, macuxi_worker, macuxi_portal;`);
    expect(up).toContain(`grant execute on function ${DADOS_LEGAIS_PUBLICOS} to macuxi_app;`);
    for (const f of FUNCOES_SA_0073) {
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(up.match(/\bgrant\b/g)).toHaveLength(3);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_0073]));
  });

  it('pública: só razao_social, cnpj e site (DadosLegaisSchema), com o padrão sem a linha', () => {
    const b = bloco(up, PUBLICOS);
    expect(b).toContain("jsonb_build_object('razao_social', d.razao_social, 'cnpj', d.cnpj, 'site', d.site)");
    expect(b).toContain("jsonb_build_object('razao_social', null, 'cnpj', null, 'site', 'macuxifdv.com.br')");
    expect(b).toContain('where d.deleted_at is null');
    expect(Object.keys(DadosLegaisSchema.shape).sort()).toEqual(['cnpj', 'razao_social', 'site']);
  });

  it('gravar: exatamente as 3 chaves do GravarDadosLegaisSchema (22023), trava a linha, idempotente, audita antes e depois', () => {
    const b = bloco(up, GRAVAR);
    expect(b).toContain("is distinct from array['cnpj', 'razao_social', 'site'] then");
    expect(Object.keys(GravarDadosLegaisSchema.shape).sort()).toEqual(['cnpj', 'razao_social', 'site']);
    expect(b).toContain("using errcode = '22023';");
    expect(b).toContain('from plataforma.dados_legais d limit 1 for update;');
    // idempotente: o mesmo conteúdo devolve antes do update e da auditoria
    expect(b.indexOf('v_atual.razao_social is not distinct from v_razao and v_atual.cnpj is not distinct from v_cnpj')).toBeLessThan(b.indexOf('update plataforma.dados_legais'));
    expect(b.indexOf('return plataforma.dados_legais_publicos();')).toBeLessThan(b.indexOf('sa_registrar_auditoria('));
    expect(b).toContain("'sa.dados_legais.gravar'");
    expect(b).toContain("jsonb_build_object('antes', v_antes, 'depois', v_depois)");
    expect(b).toContain('return v_depois;');
  });

  it('down: apaga as 3 funções e a tabela, sem criar nada', () => {
    for (const f of [...FUNCOES_SA_0073, DADOS_LEGAIS_PUBLICOS]) expect(down).toContain(`drop function if exists ${f};`);
    expect(down).toContain(`drop table if exists ${TABELA};`);
    expect(down).not.toMatch(/create |grant /);
  });
});

describe.skipIf(semBanco())('0073 dados legais (banco, fixture dois-tenants)', () => {
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
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.0073@macuxi.exemplo', nome: 'Operador 0073', senha_hash: HASH_TESTE })]))[0]!.r;
    return { sid: await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }), sa: sa.super_admin_id };
  }
  /** As mesmas chamadas da fonteDadosLegaisNoBanco (apps/api/src/dados-legais.ts), conferidas pelo contrato. */
  const publicos = async (papel = 'macuxi_app') =>
    DadosLegaisSchema.parse((await como<{ r: unknown }>(papel, 'select plataforma.dados_legais_publicos() as r')).rows[0]!.r);
  const ler = async (sid: string) => DadosLegaisSchema.parse((await portal<{ r: unknown }>('select plataforma.sa_dados_legais($1) as r', [sid]))[0]!.r);
  const gravar = async (sid: string, dados: unknown) =>
    DadosLegaisSchema.parse((await portal<{ r: unknown }>('select plataforma.sa_gravar_dados_legais($1, $2::jsonb) as r', [sid, JSON.stringify(dados)]))[0]!.r);
  const auditorias = async (sid: string) =>
    q<{ detalhes: Record<string, unknown>; super_admin_id: string; tenant_alvo_id: string | null }>(
      "select detalhes, super_admin_id, tenant_alvo_id from plataforma.auditoria_plataforma where acao = 'sa.dados_legais.gravar' and sessao_id = $1 order by ocorrido_em, id",
      [sid],
    );

  it('tabela: 1 linha (padrão); nenhum papel da aplicação lê ou grava direto (42501); a 2ª linha = 23505', async () => {
    await emTransacao(admin, null, async () => {
      expect(await q(`select razao_social, cnpj, site, atualizado_por from ${TABELA}`)).toEqual([{ ...PADRAO, atualizado_por: null }]);
      for (const papel of ['macuxi_app', 'macuxi_worker', 'macuxi_portal']) {
        expect((await erroDe(como(papel, `select 1 from ${TABELA}`, [], A)))?.code, papel).toBe('42501');
        expect((await erroDe(como(papel, `update ${TABELA} set site = 'x.com'`, [], A)))?.code, papel).toBe('42501');
      }
      expect((await erroDe(q(`insert into ${TABELA} (site) values ('outro.com.br')`)))?.code).toBe('23505');
    });
  });

  it('pública: o app lê sem sessão e sem contexto; worker e portal não executam; sem a linha = padrão', async () => {
    await emTransacao(admin, null, async () => {
      expect(await publicos()).toEqual(PADRAO);
      for (const papel of ['macuxi_worker', 'macuxi_portal']) expect((await erroDe(publicos(papel)))?.code, papel).toBe('42501');
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_dados_legais(null)')))?.code, papel).toBe('42501');
        expect((await erroDe(como(papel, "select plataforma.sa_gravar_dados_legais(null, '{}')")))?.code, papel).toBe('42501');
      }
      await q(`delete from ${TABELA}`);
      expect(await publicos()).toEqual(PADRAO);
    });
  });

  it('portal: sessão inválida = 28000; admin do cliente = 42501; super-admin lê e grava; idempotente; auditado; forma e CHECKs', async () => {
    await emTransacao(admin, null, async () => {
      expect((await erroDe(ler('00000000-0000-4000-8000-000000000073')))?.code).toBe('28000');
      expect((await erroDe(gravar('00000000-0000-4000-8000-000000000073', PADRAO)))?.code).toBe('28000');
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      expect((await erroDe(ler(cli)))?.code).toBe('42501');
      expect((await erroDe(gravar(cli, PADRAO)))?.code).toBe('42501');

      const { sid, sa } = await sessaoSuperAdmin();
      expect(await ler(sid)).toEqual(PADRAO);
      // o corpo como a API manda (saída do GravarDadosLegaisSchema)
      const novo = GravarDadosLegaisSchema.parse({ razao_social: '  Macuxi Tecnologia Ltda  ', cnpj: '11.222.333/0001-81', site: 'https://www.MacuxiFDV.com.br/' });
      expect(novo).toEqual({ razao_social: 'Macuxi Tecnologia Ltda', cnpj: '11222333000181', site: 'macuxifdv.com.br' });
      expect(await gravar(sid, novo)).toEqual(novo);
      expect(await ler(sid)).toEqual(novo);
      expect(await publicos()).toEqual(novo);
      const [linha] = await q<{ atualizado_por: string; updated_at: Date }>(`select atualizado_por, updated_at from ${TABELA}`);
      expect(linha!.atualizado_por).toBe(sa);

      // idempotente: o mesmo conteúdo não muda a linha nem audita de novo
      expect(await gravar(sid, novo)).toEqual(novo);
      expect((await q<{ updated_at: Date }>(`select updated_at from ${TABELA}`))[0]!.updated_at).toEqual(linha!.updated_at);
      const aud = await auditorias(sid);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({ super_admin_id: sa, tenant_alvo_id: null, detalhes: { antes: PADRAO, depois: novo, origem: 'banco' } });

      // limpar: razão social e CNPJ voltam a nulo; o site padrão
      const limpo = GravarDadosLegaisSchema.parse({ razao_social: '   ', cnpj: '', site: '' });
      expect(await gravar(sid, limpo)).toEqual(PADRAO);
      expect(await auditorias(sid)).toHaveLength(2);

      // forma (22023): chave a mais ou a menos, tipo errado, não objeto
      for (const ruim of [{}, { razao_social: null, cnpj: null }, { ...PADRAO, extra: 1 }, { ...PADRAO, site: null }, { ...PADRAO, cnpj: 11222333000181 }, [PADRAO], 'x']) {
        expect((await erroDe(gravar(sid, ruim)))?.code, JSON.stringify(ruim)).toBe('22023');
      }
      // regras (23514): o que a API já recusa, o banco recusa de novo
      for (const ruim of [
        { ...PADRAO, razao_social: ' Com espaço' },
        { ...PADRAO, razao_social: '' },
        { ...PADRAO, razao_social: 'x'.repeat(121) },
        { ...PADRAO, cnpj: '11.222.333/0001-81' },
        { ...PADRAO, cnpj: '1122233300018' },
        { ...PADRAO, site: 'https://macuxifdv.com.br' },
        { ...PADRAO, site: 'MacuxiFDV.com.br' },
        { ...PADRAO, site: 'macuxifdv' },
        { ...PADRAO, site: '' },
      ]) {
        expect((await erroDe(gravar(sid, ruim)))?.code, JSON.stringify(ruim)).toBe('23514');
      }
      expect(await ler(sid)).toEqual(PADRAO);
      expect(await auditorias(sid)).toHaveLength(2);

      // sem a linha (apagada à mão): a gravação cria de novo, uma só
      await q(`delete from ${TABELA}`);
      expect(await gravar(sid, novo)).toEqual(novo);
      expect(await q(`select count(*)::int as n from ${TABELA}`)).toEqual([{ n: 1 }]);
    });
  });
});

describe.skipIf(semBanco())('0073 dados legais (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; down volta exatamente ao catálogo anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: '0072' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0073' })).aplicadas).toEqual(['0073_plataforma_dados_legais']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      expect(depois.filter((x) => !antes.includes(x)).some((x) => x.includes('dados_legais'))).toBe(true);
      expect((await c.query(`select razao_social, cnpj, site from ${TABELA}`)).rows).toEqual([PADRAO]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0073_plataforma_dados_legais']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0073' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
