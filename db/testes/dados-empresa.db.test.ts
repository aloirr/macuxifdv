/**
 * 0102 — dados da empresa, "quem sou eu" e senha do super-admin no portal (v1.0.34; autorização R-20261124-191902).
 * Dicionário: docs/banco/plataforma.md, "Dados da empresa, quem sou eu e senha do super-admin (0102)". O que o BANCO garante:
 * - plataforma.tenant ganha 10 colunas text nulas (logradouro, numero, complemento, bairro, municipio, uf, cep, telefone, email,
 *   inscricao_estadual), cada uma com o CHECK tenant_<col>_formato; o macuxi_leitura ganha SELECT nelas;
 * - sa_dados_da_empresa / sa_gravar_dados_da_empresa: super-admin em qualquer empresa ativa, admin do cliente só na da sessão
 *   (senão 42501; sessão inválida 28000); exatamente as 11 chaves (22023); btrim e vazio = null; razão social obrigatória
 *   (2..200); CNPJ e nome fantasia nunca gravados aqui; auditoria 'sa.empresa.cadastro' só com os nomes dos campos;
 * - sa_quem_sou: super-admin (nome, sem perfil e cargo), admin com empresa (nome, perfil e cargo do vínculo vivo), admin sem
 *   empresa (0 linhas);
 * - sa_gravar_senha_super_admin: só super-admin; hash argon2id; hash atual errado = false; zera falhas e bloqueio; revoga
 *   todas as sessões do super-admin; auditoria 'sa.senha.trocada' { sessoes_revogadas };
 * - EXECUTE só ao macuxi_portal; up/down volta exatamente ao catálogo anterior.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { tenant } from '../esquema/plataforma';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0102, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { comoPapel, emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0102';
const m102 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m102) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m102.up);
const down = semComentarios(m102.down);
const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const ADMIN_B = DOIS_TENANTS.B.usuarios.admin;
const SEM_SESSAO = '00000000-0000-4000-8000-000000000102';
const COLUNAS = ['logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep', 'telefone', 'email', 'inscricao_estadual'] as const;
const CHAVES_GRAVAR = ['razao_social', ...COLUNAS];
const CHAVES_LER = ['tenant_id', 'cnpj', 'razao_social', 'nome_fantasia', ...COLUNAS, 'atualizado_em'];
const HASH_NOVO = '$argon2id$v=19$m=1,t=1,p=1$bm92bw$bm92b2hhc2g';

describe('0102 dados da empresa (estático)', () => {
  it('nome; 10 colunas text nulas com CHECK de formato e espelho Drizzle; SELECT ao macuxi_leitura; nada mais de tabela', () => {
    expect(m102.nome).toBe('plataforma_dados_da_empresa');
    for (const c of COLUNAS) {
      expect(up).toMatch(new RegExp(`^alter table plataforma\\.tenant add column ${c} text;$`, 'm'));
      expect(up).toContain(`add constraint tenant_${c}_formato check (`);
      expect(Object.keys(tenant)).toContain(c);
      expect(down).toContain(`alter table plataforma.tenant drop column if exists ${c};`);
    }
    expect(up.match(/add column/g)).toHaveLength(10);
    expect(up).toContain(`grant select (${COLUNAS.join(', ')}) on plataforma.tenant to macuxi_leitura;`);
    expect(up).not.toMatch(/create (unique )?index|create policy|alter policy|create table|sa_sessao_valida\(p_sid uuid\)\s+returns|sa_gravar_nome_fantasia/);
  });

  it('funções: SECURITY DEFINER, search_path fixo, EXECUTE só ao portal; o down apaga as 4', () => {
    for (const f of FUNCOES_SA_0102) {
      const nome = f.slice(0, f.indexOf('('));
      const i = up.indexOf(`create function ${nome}(`);
      expect(i, f).toBeGreaterThanOrEqual(0);
      const b = up.slice(i, up.indexOf('$$;', up.indexOf('$$', i) + 2) + 3);
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
      expect(down).toContain(`drop function if exists ${f};`);
    }
    expect(up.match(/\bgrant execute\b/g)).toHaveLength(4);
    expect(up.match(/\bcreate function\b/g)).toHaveLength(4);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_0102]));
  });
});

describe.skipIf(semBanco())('0102 dados da empresa (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  type Dados = Record<string, string | null>;
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => comoPapel<T>(admin, 'macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  async function superAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.0102@macuxi.exemplo', nome: 'Operador 0102', senha_hash: HASH_TESTE })]))[0]!.r;
    return { sid: await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }), sa: sa.super_admin_id };
  }
  const adminA = () => abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
  const ler = async (sid: string, t: string | null) => (await portal<{ r: Dados }>('select plataforma.sa_dados_da_empresa($1, $2) as r', [sid, t]))[0]!.r;
  // exatamente a chamada da rota (parâmetros sem tipo, como o node-postgres manda)
  const gravar = async (sid: string, t: string | null, p: unknown) => (await portal<{ r: Dados }>('select plataforma.sa_gravar_dados_da_empresa($1, $2, $3) as r', [sid, t, p === null ? null : JSON.stringify(p)]))[0]!.r;
  const quemSou = (sid: string) => portal<{ nome: string; perfil: string | null; cargo: string | null }>('select * from plataforma.sa_quem_sou($1)', [sid]);
  const senha = async (sid: string, atual: string | null, novo: string | null) => (await portal<{ r: boolean }>('select plataforma.sa_gravar_senha_super_admin($1, $2, $3) as r', [sid, atual, novo]))[0]!.r;
  const auditorias = (acao: string, t: string | null = null) =>
    q<{ detalhes: Record<string, unknown>; ator_tipo: string; super_admin_id: string | null; usuario_id: string | null }>(
      'select detalhes, ator_tipo, super_admin_id, usuario_id from plataforma.auditoria_plataforma where acao = $1 and tenant_alvo_id is not distinct from $2 order by ocorrido_em, id',
      [acao, t],
    );
  const completo = (extra: Partial<Record<string, unknown>> = {}) => ({
    razao_social: 'Distribuidora A Ltda',
    logradouro: 'Av. Djalma Batista',
    numero: '1200',
    complemento: 'Sala 3',
    bairro: 'Chapada',
    municipio: 'Manaus',
    uf: 'AM',
    cep: '69050010',
    telefone: '92988887777',
    email: 'contato@empresa-a.exemplo',
    inscricao_estadual: '041234567',
    ...extra,
  });

  it('leitura: as 15 chaves; super-admin em A e B; admin do cliente só na própria (B = 42501); CNPJ e razão social de documento e nome', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await superAdmin();
      const [ta] = await q<{ documento: string | null; nome: string; nome_fantasia: string | null }>('select documento, nome, nome_fantasia from plataforma.tenant where id = $1', [A]);
      const d = await ler(sid, A);
      expect(Object.keys(d).sort()).toEqual([...CHAVES_LER].sort());
      expect(d).toMatchObject({ tenant_id: A, cnpj: ta!.documento, razao_social: ta!.nome, nome_fantasia: ta!.nome_fantasia });
      for (const c of COLUNAS) expect(d[c], c).toBeNull();
      expect(d.atualizado_em).toMatch(/Z$/);
      expect((await ler(sid, B)).tenant_id).toBe(B);
      const cli = await adminA();
      expect(await ler(cli, A)).toEqual(d);
      expect((await erroDe(ler(cli, B)))?.code).toBe('42501');
      expect((await erroDe(ler(SEM_SESSAO, A)))?.code).toBe('28000');
      expect((await erroDe(ler(sid, null)))?.code).toBe('22023');
      expect((await erroDe(ler(sid, SEM_SESSAO)))?.code).toBe('42501');
      // empresa inativa: o super-admin também não lê (sa_tenant_ativo)
      await q("update plataforma.tenant set status = 'suspenso', inativada_em = now() where id = $1", [B]);
      expect((await erroDe(ler(sid, B)))?.code).toBe('42501');
    });
  });

  it('gravação: btrim e vazio = null; devolve a leitura; nada mudou = não grava nem audita; auditoria só com os nomes dos campos', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, sa } = await superAdmin();
      const [antes] = await q<{ documento: string | null; nome_fantasia: string | null }>('select documento, nome_fantasia from plataforma.tenant where id = $1', [A]);
      const r = await gravar(sid, A, completo({ razao_social: '  Distribuidora A Ltda  ', complemento: '   ', email: '' }));
      expect(r).toEqual(await ler(sid, A));
      expect(r).toMatchObject({ razao_social: 'Distribuidora A Ltda', complemento: null, email: null, uf: 'AM', cep: '69050010', cnpj: antes!.documento, nome_fantasia: antes!.nome_fantasia });
      const aud = await auditorias('sa.empresa.cadastro', A);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({ ator_tipo: 'super_admin', super_admin_id: sa, usuario_id: null });
      expect(aud[0]!.detalhes).toEqual({ campos: ['bairro', 'cep', 'inscricao_estadual', 'logradouro', 'municipio', 'numero', 'razao_social', 'telefone', 'uf'], origem: 'banco' });
      expect(JSON.stringify(aud[0]!.detalhes)).not.toMatch(/Manaus|69050010|Djalma/);
      // igual = não muda a linha nem audita
      const [l1] = await q<{ updated_at: Date }>('select updated_at from plataforma.tenant where id = $1', [A]);
      await gravar(sid, A, completo({ complemento: null, email: null }));
      expect((await q<{ updated_at: Date }>('select updated_at from plataforma.tenant where id = $1', [A]))[0]!.updated_at).toEqual(l1!.updated_at);
      expect(await auditorias('sa.empresa.cadastro', A)).toHaveLength(1);
      // admin do cliente grava a própria; auditoria com o usuário
      const cli = await adminA();
      expect((await gravar(cli, A, completo({ complemento: null, email: 'fiscal@empresa-a.exemplo' }))).email).toBe('fiscal@empresa-a.exemplo');
      const aud2 = await auditorias('sa.empresa.cadastro', A);
      // mesma transação = mesmo ocorrido_em: acha a linha pelo ator, não pela ordem
      expect(aud2).toHaveLength(2);
      expect(aud2.find((a) => a.ator_tipo === 'admin_cliente')).toMatchObject({ ator_tipo: 'admin_cliente', super_admin_id: null, usuario_id: ADMIN_A, detalhes: { campos: ['email'], origem: 'banco' } });
      expect((await erroDe(gravar(cli, B, completo())))?.code).toBe('42501');
      // documento e nome fantasia intocados
      expect(await q('select documento, nome_fantasia from plataforma.tenant where id = $1', [A])).toEqual([antes]);
    });
  });

  it('chaves exatas e tipos: faltando, a mais, cnpj ou nome_fantasia, não objeto, valor não texto = 22023; razão social obrigatória', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await superAdmin();
      const sem = (k: string) => Object.fromEntries(Object.entries(completo()).filter(([c]) => c !== k));
      for (const k of CHAVES_GRAVAR) expect((await erroDe(gravar(sid, A, sem(k))))?.code, `sem ${k}`).toBe('22023');
      for (const extra of ['cnpj', 'nome_fantasia', 'documento', 'x']) expect((await erroDe(gravar(sid, A, completo({ [extra]: '1' }))))?.code, extra).toBe('22023');
      for (const p of [null, [], 'x', {}]) expect((await erroDe(gravar(sid, A, p)))?.code, JSON.stringify(p)).toBe('22023');
      for (const v of [12, true, {}, ['a']]) expect((await erroDe(gravar(sid, A, completo({ numero: v }))))?.code, JSON.stringify(v)).toBe('22023');
      for (const v of [null, '', '   ']) expect((await erroDe(gravar(sid, A, completo({ razao_social: v }))))?.code, `razão ${JSON.stringify(v)}`).toBe('22023');
      for (const v of ['A', 'x'.repeat(201)]) expect((await erroDe(gravar(sid, A, completo({ razao_social: v }))))?.code, v.slice(0, 5)).toBe('23514');
      expect((await gravar(sid, A, completo({ razao_social: 'AB' }))).razao_social).toBe('AB');
      expect((await erroDe(gravar(SEM_SESSAO, A, completo())))?.code).toBe('28000');
      expect((await erroDe(gravar(sid, null, completo())))?.code).toBe('22023');
    });
  });

  it('CHECKs de formato (23514) pela função e direto na tabela; os válidos passam', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await superAdmin();
      const ruins: Array<[string, string]> = [
        ['logradouro', 'x'.repeat(201)], ['numero', 'x'.repeat(21)], ['complemento', 'x'.repeat(101)], ['bairro', 'x'.repeat(101)],
        ['municipio', 'x'.repeat(101)], ['uf', 'am'], ['uf', 'XX'], ['uf', 'AMZ'], ['cep', '69050-010'], ['cep', '6905001'],
        ['telefone', '(92) 98888-7777'], ['telefone', '929888877'], ['telefone', '929888877771'], ['email', 'sem-arroba'],
        ['email', `${'a'.repeat(250)}@b.co`], ['inscricao_estadual', 'isento'], ['inscricao_estadual', '1'], ['inscricao_estadual', '123456789012345'],
        ['inscricao_estadual', '04.123.456-7'],
      ];
      for (const [c, v] of ruins) {
        const e = await erroDe(gravar(sid, A, completo({ [c]: v })));
        expect(e?.code, `${c}=${v.slice(0, 12)}`).toBe('23514');
        expect(e?.message, c).toContain(`tenant_${c}_formato`);
      }
      // direto na tabela (dono): espaço nas pontas e vazio também caem
      for (const c of ['logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'email']) {
        for (const v of [' x', '']) {
          const e = await erroDe(q('savepoint s').then(() => q(`update plataforma.tenant set ${c} = $1 where id = $2`, [v, A])));
          await q('rollback to savepoint s');
          expect(e?.code, `${c}=${JSON.stringify(v)}`).toBe('23514');
        }
      }
      for (const [c, v] of [['uf', 'DF'], ['uf', 'TO'], ['telefone', '9233334444'], ['inscricao_estadual', 'ISENTO'], ['inscricao_estadual', '12'], ['inscricao_estadual', '12345678901234']] as const) {
        expect((await gravar(sid, A, completo({ [c]: v })))[c], `${c}=${v}`).toBe(v);
      }
    });
  });

  it('quem sou: super-admin (sem perfil e cargo); admin com empresa (perfil e cargo do vínculo vivo); admin sem empresa = 0 linhas; inválida 28000', async () => {
    await emTransacao(admin, null, async () => {
      const { sid } = await superAdmin();
      expect(await quemSou(sid)).toEqual([{ nome: 'Operador 0102', perfil: null, cargo: null }]);
      const esperado = await q<{ nome: string; perfil: string; cargo: string }>(
        `select u.nome, p.nome as perfil, p.cargo from core.usuario u
           join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
           join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
          where u.tenant_id = $1 and u.id = $2`,
        [A, ADMIN_A],
      );
      expect(esperado).toHaveLength(1);
      expect(await quemSou(await adminA())).toEqual(esperado);
      const semEmpresa = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }, { tenant_id: B, usuario_id: ADMIN_B }] });
      expect(await quemSou(semEmpresa)).toEqual([]);
      expect((await erroDe(quemSou(SEM_SESSAO)))?.code).toBe('28000');
    });
  });

  it('senha do super-admin: só super-admin; hash errado = false; formato argon2id; zera falhas e bloqueio; revoga todas as sessões; auditada', async () => {
    await emTransacao(admin, null, async () => {
      const { sid, sa } = await superAdmin();
      const outra = await abrir({ tipo: 'super_admin', super_admin_id: sa });
      const cli = await adminA();
      expect((await erroDe(senha(cli, HASH_TESTE, HASH_NOVO)))?.code).toBe('42501');
      expect((await erroDe(senha(SEM_SESSAO, HASH_TESTE, HASH_NOVO)))?.code).toBe('28000');
      for (const novo of [null, 'texto', '$argon2i$v=19$m=1,t=1,p=1$bm92bw$bm92b2hhc2g', `${HASH_NOVO} `]) {
        expect((await erroDe(senha(sid, HASH_TESTE, novo)))?.code, String(novo)).toBe('22023');
      }
      expect((await erroDe(senha(sid, null, HASH_NOVO)))?.code).toBe('22023');
      await q("update plataforma.super_admin set falhas = 3, bloqueado_ate = now() + interval '5 minutes' where id = $1", [sa]);
      expect(await senha(sid, HASH_NOVO, HASH_NOVO)).toBe(false);
      expect(await q('select senha_hash, falhas from plataforma.super_admin where id = $1', [sa])).toEqual([{ senha_hash: HASH_TESTE, falhas: 3 }]);
      expect(await auditorias('sa.senha.trocada')).toEqual([]);
      expect(await senha(sid, HASH_TESTE, HASH_NOVO)).toBe(true);
      expect(await q('select senha_hash, falhas, bloqueado_ate from plataforma.super_admin where id = $1', [sa])).toEqual([{ senha_hash: HASH_NOVO, falhas: 0, bloqueado_ate: null }]);
      // as duas sessões do super-admin caem (inclusive a atual); a do admin do cliente fica
      expect(await q('select count(*)::int as n from plataforma.portal_sessao where super_admin_id = $1 and revogada_em is null', [sa])).toEqual([{ n: 0 }]);
      for (const s of [sid, outra]) expect((await erroDe(quemSou(s)))?.code).toBe('28000');
      expect(await quemSou(cli)).toHaveLength(1);
      const aud = await auditorias('sa.senha.trocada');
      expect(aud).toEqual([{ ator_tipo: 'super_admin', super_admin_id: sa, usuario_id: null, detalhes: { sessoes_revogadas: 2, origem: 'banco' } }]);
      expect(JSON.stringify(aud)).not.toContain('argon2');
    });
  });

  it('grants: EXECUTE só ao macuxi_portal; app e worker 42501; o portal não lê a tabela; o macuxi_leitura lê as 10 colunas', async () => {
    await emTransacao(admin, null, async () => {
      for (const f of FUNCOES_SA_0102) {
        expect(await q(`select has_function_privilege('macuxi_portal', $1, 'EXECUTE') as p, has_function_privilege('macuxi_app', $1, 'EXECUTE') as a, has_function_privilege('macuxi_worker', $1, 'EXECUTE') as w, has_function_privilege('public', $1, 'EXECUTE') as pub`, [f]), f).toEqual([{ p: true, a: false, w: false, pub: false }]);
      }
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(comoPapel(admin, papel, 'select plataforma.sa_dados_da_empresa(null, null)', [], A)))?.code, papel).toBe('42501');
      }
      expect((await erroDe(portal('select logradouro from plataforma.tenant')))?.code).toBe('42501');
      for (const c of COLUNAS) expect(await q("select has_column_privilege('macuxi_leitura', 'plataforma.tenant', $1, 'SELECT') as tem", [c]), c).toEqual([{ tem: true }]);
      // o app lê as colunas da própria linha (isolamento_tenant) e não grava
      expect(await comoPapel(admin, 'macuxi_app', 'select uf from plataforma.tenant', [], A).then((r) => r.rows)).toEqual([{ uf: null }]);
      expect((await erroDe(comoPapel(admin, 'macuxi_app', "update plataforma.tenant set uf = 'AM'", [], A)))?.code).toBe('42501');
    });
  });
});

describe.skipIf(semBanco())('0102 dados da empresa (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up só acrescenta; down volta exatamente ao catálogo anterior; up de novo = igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual(['0102_plataforma_dados_da_empresa']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((x) => !depois.includes(x))).toEqual([]);
      const novos = depois.filter((x) => !antes.includes(x));
      expect(novos.filter((x) => x.startsWith('col '))).toEqual(COLUNAS.map((col) => `col plataforma.tenant.${col} text nn=false`).sort());
      expect(novos.filter((x) => x.startsWith('con ')).map((x) => x.split(' ')[1])).toEqual(COLUNAS.map((col) => `plataforma.tenant_${col}_formato`).sort());
      expect(novos.filter((x) => x.startsWith('fn '))).toEqual([
        'fn plataforma.sa_dados_da_empresa(p_sid uuid, p_tenant uuid)',
        'fn plataforma.sa_gravar_dados_da_empresa(p_sid uuid, p_tenant uuid, p jsonb)',
        'fn plataforma.sa_gravar_senha_super_admin(p_sid uuid, p_hash_atual text, p_hash_novo text)',
        'fn plataforma.sa_quem_sou(p_sid uuid)',
      ]);
      expect(novos).toHaveLength(24);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0102_plataforma_dados_da_empresa']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
