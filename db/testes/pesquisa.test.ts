/**
 * Pesquisa — migração 0016 (T-0057; pedido R-20261102-132021-modulo-pesquisa), fixture dos dois tenants e seed demo.
 * Estático: listas fechadas do SQL = contratos da Pesquisa; seed e fixture passam nos contratos (Zod); ids do seed = ids
 * do demo.ts. Postgres (papel macuxi_app, sujeito a RLS): isolamento entre A e B em toda tabela do schema, RN-PES-01
 * (publicada imutável, um rascunho, resposta só para publicada), RF-PES-04 (só inserção, idempotência pelo UUID do
 * aparelho), RF-PES-05 (arquivar desce no pull), normalização de itens e fotos, consultas do repositório SQL e o seed.
 * Datas: o "agora" da fixture (agoraDaFixture/hojeDaFixture, mesma semântica do relógio de @macuxi/comum/relogio:
 * MACUXI_AGORA ou o relógio, lido uma vez) — nada de hora fixa contra o relógio real.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATUS_VERSAO, QuestionarioVersao } from '../../modules/pesquisa/contracts/questionario';
import { RespostaPesquisa } from '../../modules/pesquisa/contracts/resposta';
import { TIPOS_PERGUNTA } from '../../modules/pesquisa/contracts/pergunta';
import { FREQUENCIAS, MODOS } from '../../modules/pesquisa/contracts/publico';
import { carregarDoisTenants, dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS } from '../seeds/fixtures/dois-tenants';
import { GRUPOS_PESQUISA_FIXTURE, ORDEM_PESQUISA, PESQUISA_FIXTURE, TABELAS_PESQUISA_DO_GATILHO } from '../seeds/fixtures/pesquisa';
import { carregarDemo, dadosDemo, idClienteDemo, idUsuarioDemo, TENANT_DEMO } from '../seeds/demo/demo';
import { carregarPesquisaDemo, dadosPesquisaDemo, gravarPesquisaDemo, PERFIS_PESQUISA_DEMO, PESQUISA_DEMO } from '../seeds/demo/pesquisa';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { comTenant } from '../src/contexto';
import { somarDias } from '../src/datas';
import { lerMigracoes } from '../src/migrador';
import type { Linha } from '../src/gravar';
import { agoraDaFixture, banco, hojeDaFixture, semBanco } from './estado';
import { comCliente, emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const PA = PESQUISA_FIXTURE.A;
const PB = PESQUISA_FIXTURE.B;
const TABELAS = ['pesquisa.questionario', 'pesquisa.questionario_versao', 'pesquisa.resposta', 'pesquisa.resposta_item', 'pesquisa.resposta_foto'] as const;
const HASH_FALSO = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';

const iso = (x: unknown): string => (x instanceof Date ? x.toISOString() : String(x));
const isoOuNulo = (x: unknown): string | null => (x === null || x === undefined ? null : iso(x));
/** text[] do seed ('{A,B}') ou do banco (array) -> lista. */
const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : String(x).replace(/[{}]/g, '').split(',').filter(Boolean));

/** Linha de pesquisa.questionario_versao (seed ou banco) -> contrato QuestionarioVersao (o mapeamento do repositório SQL). */
function versaoDaLinha(l: Linha): unknown {
  return {
    id: l.id, questionario_id: l.questionario_id, tenant_id: l.tenant_id, numero: l.numero, status: l.status, titulo: l.titulo,
    ...(l.descricao === null || l.descricao === undefined ? {} : { descricao: l.descricao }),
    modo: l.modo, frequencia: l.frequencia, publico_alvo: l.publico_alvo,
    vigencia: { inicio: iso(l.vigencia_inicio), fim: isoOuNulo(l.vigencia_fim) },
    perguntas: l.perguntas, regras: l.regras, criada_em: iso(l.criada_em), publicada_em: isoOuNulo(l.publicada_em), publicada_por: l.publicada_por ?? null,
  };
}

/** Linha de pesquisa.resposta (seed ou banco) -> contrato RespostaPesquisa. */
function respostaDaLinha(l: Linha): unknown {
  return {
    id: l.id, questionario_id: l.questionario_id, versao_id: l.versao_id, cliente_id: l.cliente_id ?? null, visita_id: l.visita_id ?? null,
    respondida_em: iso(l.respondida_em), itens: l.itens, tenant_id: l.tenant_id, usuario_id: l.usuario_id, equipe_id: l.equipe_id ?? null,
    recebida_em: iso(l.recebida_em), suspeita: l.suspeita, motivos_suspeita: lista(l.motivos_suspeita),
  };
}

const m16 = lerMigracoes().find((m) => m.nome === 'pesquisa');
/** Valores de um CHECK `coluna in ('a', 'b')` do up da 0016. */
function valoresDoCheck(constraint: string): string[] {
  const m = new RegExp(`constraint ${constraint} check \\([a-z_]+ in \\(([^)]*)\\)\\)`).exec(m16?.up ?? '');
  return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
}

describe('pesquisa — migração 0016 (estático)', () => {
  it('0016_pesquisa existe com up e down; o down remove o schema inteiro', () => {
    expect(m16?.versao).toBe('0016');
    expect(m16!.down).toMatch(/drop schema if exists pesquisa cascade/);
  });

  it('listas fechadas do SQL = contratos da Pesquisa (status, modo, frequência, 9 tipos de pergunta, motivos de suspeita)', () => {
    expect(valoresDoCheck('questionario_versao_status_valido')).toEqual([...STATUS_VERSAO].sort());
    expect(valoresDoCheck('questionario_versao_modo_valido')).toEqual([...MODOS].sort());
    expect(valoresDoCheck('questionario_versao_frequencia_valida')).toEqual([...FREQUENCIAS].sort());
    expect(valoresDoCheck('resposta_item_tipo_valido')).toEqual([...TIPOS_PERGUNTA].sort());
    expect(TIPOS_PERGUNTA).toHaveLength(9);
    const motivos = /motivos_suspeita <@ array\[([^\]]*)\]/.exec(m16!.up)?.[1] ?? '';
    const doContrato = RespostaPesquisa.shape.motivos_suspeita.removeDefault().element.options;
    expect([...motivos.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...doContrato].sort());
  });

  it('fronteira: nenhuma FK para schema de outro módulo; só pesquisa.*, plataforma.tenant e plataforma.arquivo', () => {
    const refs = [...m16!.up.matchAll(/references ([a-z_]+\.[a-z_]+) \(/g)].map((x) => x[1]!);
    for (const r of refs) expect(['plataforma.tenant', 'plataforma.arquivo', 'pesquisa.questionario', 'pesquisa.questionario_versao', 'pesquisa.resposta']).toContain(r);
    expect(m16!.up).not.toMatch(/references (core|vendedor|catalogo|promotor|gestor|treinamento|integracao)\./);
  });

  it('grants: resposta, itens e fotos só select/insert (RF-PES-04); nada de delete; nada ao macuxi_worker', () => {
    for (const t of ['resposta', 'resposta_item', 'resposta_foto']) expect(m16!.up).toContain(`grant select, insert on pesquisa.${t} to macuxi_app;`);
    for (const t of ['questionario', 'questionario_versao']) expect(m16!.up).toContain(`grant select, insert, update on pesquisa.${t} to macuxi_app;`);
    expect(m16!.up).not.toMatch(/delete on pesquisa\./);
    expect(m16!.up).not.toMatch(/^grant .* to macuxi_worker/m);
  });
});

describe('pesquisa — seed demo e fixture (estático)', () => {
  const hoje = hojeDaFixture();
  const d = dadosPesquisaDemo({ hoje });
  const demo = dadosDemo(HASH_FALSO, { hoje });

  it('seed: ids do tenant, usuários e clientes = os do demo.ts; licença da Pesquisa ativa nos 6 perfis do manifesto', () => {
    const usuariosDemo = new Set(demo['core.usuario'].map((u) => u.id));
    const clientesDemo = new Set(demo['core.cliente'].map((c) => c.id));
    for (const r of d['pesquisa.resposta']) {
      expect(r.tenant_id).toBe(TENANT_DEMO);
      expect(usuariosDemo.has(r.usuario_id)).toBe(true);
      expect(clientesDemo.has(r.cliente_id)).toBe(true);
    }
    expect(d['pesquisa.questionario_versao'].every((v) => v.publicada_por === idUsuarioDemo('analista'))).toBe(true);
    expect(d['plataforma.tenant_modulo']).toEqual([expect.objectContaining({ tenant_id: TENANT_DEMO, modulo: 'pesquisa', ativo: true })]);
    expect(d['plataforma.perfil_modulo'].map((p) => p.perfil).sort()).toEqual([...PERFIS_PESQUISA_DEMO].sort());
  });

  it('seed: 1 avulsa (sim/não, única, número, foto) e 1 obrigatória do checkout, publicadas, sem prazo; passam no contrato', () => {
    const vs = d['pesquisa.questionario_versao'];
    expect(vs.map((v) => [v.modo, v.status, v.vigencia_fim])).toEqual([['avulsa', 'publicada', null], ['checkout_obrigatoria', 'publicada', null]]);
    expect((vs[0]!.perguntas as Linha[]).map((p) => p.tipo)).toEqual(['sim_nao', 'unica', 'numero', 'foto']);
    for (const v of vs) {
      const p = QuestionarioVersao.safeParse(versaoDaLinha(v));
      expect(p.success, JSON.stringify(p.error?.issues)).toBe(true);
    }
  });

  it('seed: 16 respostas da avulsa, no passado (1 a 10 dias), na carteira de quem respondeu e fora da rota de hoje; passam no contrato', () => {
    const rs = d['pesquisa.resposta'];
    expect(rs).toHaveLength(16);
    const carteira = new Set(demo['core.carteira'].map((c) => `${c.usuario_id}:${c.cliente_id}`));
    const rotaDeHoje = new Set(demo['core.rota'].filter((r) => r.data === hoje).flatMap((r) => demo['core.rota_parada'].filter((p) => p.rota_id === r.id).map((p) => `${r.usuario_id}:${p.cliente_id}`)));
    const inicio = Date.parse(String(d['pesquisa.questionario_versao'][0]!.vigencia_inicio));
    for (const r of rs) {
      expect(carteira.has(`${r.usuario_id}:${r.cliente_id}`), `${r.id} fora da carteira`).toBe(true);
      expect(rotaDeHoje.has(`${r.usuario_id}:${r.cliente_id}`), `${r.id} na rota de hoje`).toBe(false);
      expect(String(r.respondida_em) < `${hoje}T04:00:00Z`).toBe(true);
      expect(Date.parse(String(r.respondida_em))).toBeGreaterThanOrEqual(inicio);
      const p = RespostaPesquisa.safeParse(respostaDaLinha(r));
      expect(p.success, JSON.stringify(p.error?.issues)).toBe(true);
    }
    expect(new Set(rs.map((r) => r.usuario_id))).toEqual(new Set([idUsuarioDemo('vendedor'), idUsuarioDemo('vendedor2'), idUsuarioDemo('promotor')]));
    expect(rs.some((r) => r.cliente_id === idClienteDemo(0))).toBe(false);
  });

  it('fixture: versões e respostas dos dois tenants passam nos contratos; A responde os 9 tipos', () => {
    const f = dadosDoisTenants(HASH_FALSO, { agora: agoraDaFixture() });
    for (const v of f['pesquisa.questionario_versao']) expect(QuestionarioVersao.safeParse(versaoDaLinha(v)).success, String(v.id)).toBe(true);
    for (const r of f['pesquisa.resposta']) {
      const p = RespostaPesquisa.safeParse(respostaDaLinha(r));
      expect(p.success, JSON.stringify(p.error?.issues)).toBe(true);
    }
    const a1 = f['pesquisa.resposta'].find((r) => r.id === PA.respostas.v1c1)!;
    expect((a1.itens as Linha[]).map((i) => i.tipo).sort()).toEqual([...TIPOS_PERGUNTA].sort());
    // as fotos da Pesquisa entram em plataforma.arquivo junto das da Sprint 1 (FK de resposta_foto)
    expect(f['plataforma.arquivo'].map((x) => x.id)).toEqual(expect.arrayContaining([PA.arquivos.fotoV1c1, PB.arquivos.fotoC1]));
  });

  it('fixture: a Pesquisa está em ORDEM_TABELAS (itens e fotos pelo gatilho) e os ids não colidem com Gestor, Promotor nem o resto', () => {
    expect(ORDEM_TABELAS).toEqual(expect.arrayContaining([...ORDEM_PESQUISA]));
    for (const t of TABELAS_PESQUISA_DO_GATILHO) expect(ORDEM_TABELAS as readonly string[]).not.toContain(t);
    const f = dadosDoisTenants(HASH_FALSO, { agora: agoraDaFixture() });
    const linhas = Object.entries(f).flatMap(([t, ls]) => ls.map((l) => ({ t, id: String(l.id) })));
    // 0045 (T-0113, ADR 0034): a marca ativa do Catálogo É o concorrente do Promotor copiado (mesmo id, de propósito)
    const doPromotor = new Set(f['promotor.concorrente'].map((l) => String(l.id)));
    const unicas = linhas.filter((l) => !(l.t === 'catalogo.marca_concorrente' && doPromotor.has(l.id)));
    expect(new Set(unicas.map((l) => l.id)).size).toBe(unicas.length);
    // grupo (2º bloco do UUID fixo) da Pesquisa (0x160–0x165) só aparece em linhas da Pesquisa e nas fotos dela
    const grupo = (id: string) => parseInt(id.split('-')[1]!, 16);
    const daPesquisa = new Set<string>([PA.arquivos.fotoV1c1, PB.arquivos.fotoC1]);
    for (const l of linhas) {
      if (l.t.startsWith('pesquisa.') || daPesquisa.has(l.id)) expect(GRUPOS_PESQUISA_FIXTURE, `${l.t} ${l.id}`).toContain(grupo(l.id));
      else expect(GRUPOS_PESQUISA_FIXTURE, `${l.t} ${l.id}`).not.toContain(grupo(l.id));
    }
  });
});

describe.skipIf(semBanco())('pesquisa — banco (papel macuxi_app)', () => {
  let app: pg.Client;

  beforeAll(async () => {
    // a fixture dois-tenants (globalSetup) já traz a Pesquisa de A e B (db/seeds/fixtures/pesquisa.ts)
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('toda tabela do schema: RLS ligado e forçado, política isolamento_tenant, índice (tenant_id, updated_at, id)', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) =>
      admin.query<{ nome: string; rls: boolean; forcado: boolean; politicas: number; sync: number }>(
        `select n.nspname || '.' || c.relname as nome, c.relrowsecurity as rls, c.relforcerowsecurity as forcado,
                (select count(*)::int from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname and p.policyname = 'isolamento_tenant') as politicas,
                (select count(*)::int from pg_indexes i where i.schemaname = n.nspname and i.tablename = c.relname and i.indexdef like '%(tenant_id, updated_at, id)') as sync
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'pesquisa' and c.relkind = 'r' order by 1`,
      ),
    );
    expect(r.rows).toEqual([...TABELAS].sort().map((nome) => ({ nome, rls: true, forcado: true, politicas: 1, sync: 1 })));
  });

  it('privilégios: macuxi_app sem UPDATE/DELETE em resposta, itens e fotos; macuxi_worker sem nada no schema', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) =>
      admin.query<{ tabela: string; papel: string; priv: string }>(
        `select table_name as tabela, grantee as papel, string_agg(privilege_type, ',' order by privilege_type) as priv
           from information_schema.role_table_grants where table_schema = 'pesquisa' and grantee in ('macuxi_app', 'macuxi_worker')
          group by 1, 2 order by 1, 2`,
      ),
    );
    expect(r.rows).toEqual([
      { tabela: 'questionario', papel: 'macuxi_app', priv: 'INSERT,SELECT,UPDATE' },
      { tabela: 'questionario_versao', papel: 'macuxi_app', priv: 'INSERT,SELECT,UPDATE' },
      { tabela: 'resposta', papel: 'macuxi_app', priv: 'INSERT,SELECT' },
      { tabela: 'resposta_foto', papel: 'macuxi_app', priv: 'INSERT,SELECT' },
      { tabela: 'resposta_item', papel: 'macuxi_app', priv: 'INSERT,SELECT' },
    ]);
  });

  describe('isolamento entre tenants (RN-CORE-05)', () => {
    it.each([
      ['A', A],
      ['B', B],
    ])('contexto %s: vê só as próprias linhas, e há linha em toda tabela', async (_r, tenant) => {
      for (const t of TABELAS) {
        const r = await emTransacao(app, tenant, () => app.query<{ total: number; alheias: number }>(`select count(*)::int as total, count(*) filter (where tenant_id <> $1)::int as alheias from ${t}`, [tenant]));
        expect(r.rows[0]!.total, `${t}: sem linha do tenant`).toBeGreaterThan(0);
        expect(r.rows[0]!.alheias, `${t}: vazou`).toBe(0);
      }
    });

    it('A não acha a resposta de B pelo id, nem os itens/fotos dela; sem contexto, nenhuma linha', async () => {
      for (const [t, col] of [['pesquisa.resposta', 'id'], ['pesquisa.resposta_item', 'resposta_id'], ['pesquisa.resposta_foto', 'resposta_id']] as const) {
        const r = await emTransacao(app, A, () => app.query<{ n: number }>(`select count(*)::int as n from ${t} where ${col} = $1`, [PB.respostas.c1]));
        expect(r.rows[0]!.n, t).toBe(0);
      }
      for (const t of TABELAS) {
        const r = await emTransacao(app, null, () => app.query<{ n: number }>(`select count(*)::int as n from ${t}`));
        expect(r.rows[0]!.n, t).toBe(0);
      }
    });

    it('A não grava questionário, versão nem resposta com tenant B (WITH CHECK -> 42501)', async () => {
      const e1 = await erroDe(emTransacao(app, A, () => app.query('insert into pesquisa.questionario (tenant_id) values ($1)', [B])));
      expect(e1?.code).toBe('42501');
      const e2 = await erroDe(
        emTransacao(app, A, () =>
          app.query(
            `insert into pesquisa.resposta (tenant_id, questionario_id, versao_id, usuario_id, respondida_em, itens)
             values ($1, $2, $3, $4, now(), '[{"pergunta_id":"${PB.perguntas.simNao}","tipo":"sim_nao","valor":true}]')`,
            [B, PB.questionarios.avulsa, PB.versoes.avulsaV1, DOIS_TENANTS.B.usuarios.vendedor],
          ),
        ),
      );
      expect(e2?.code).toBe('42501');
    });

    it('FK composta: versão de A não aponta para questionário de B (23503)', async () => {
      const e = await erroDe(
        emTransacao(app, A, () =>
          app.query(
            "insert into pesquisa.questionario_versao (tenant_id, questionario_id, numero, titulo, vigencia_inicio) values ($1, $2, 9, 'x', now())",
            [A, PB.questionarios.avulsa],
          ),
        ),
      );
      expect(e?.code).toBe('23503');
    });
  });

  describe('RN-PES-01: versões', () => {
    it('versão publicada é imutável (23514), mas o rascunho se edita e se publica', async () => {
      const e = await erroDe(emTransacao(app, A, () => app.query("update pesquisa.questionario_versao set titulo = 'mudou' where id = $1", [PA.versoes.exposicaoV1])));
      expect(e?.code).toBe('23514');
      expect(e?.message).toMatch(/RN-PES-01/);
      const r = await emTransacao(app, A, async () => {
        await app.query("update pesquisa.questionario_versao set titulo = 'Exposição v2 revisada' where id = $1", [PA.versoes.exposicaoV2Rascunho]);
        await app.query("update pesquisa.questionario_versao set status = 'publicada', publicada_em = now(), publicada_por = $2 where id = $1", [PA.versoes.exposicaoV2Rascunho, DOIS_TENANTS.A.usuarios.analista]);
        return erroDe(app.query("update pesquisa.questionario_versao set perguntas = '[]' where id = $1", [PA.versoes.exposicaoV2Rascunho]));
      });
      expect(r?.code).toBe('23514');
      // integridade antes da regra: apontar a publicada para um questionário de outro tenant é FK (23503), não RN-PES-01
      const fk = await erroDe(emTransacao(app, A, () => app.query('update pesquisa.questionario_versao set questionario_id = $2 where id = $1', [PA.versoes.exposicaoV1, PB.questionarios.avulsa])));
      expect(fk?.code).toBe('23503');
    });

    it('um rascunho vivo por questionário e número único por questionário (23505)', async () => {
      const novo = (numero: number, status = 'rascunho') =>
        app.query(
          "insert into pesquisa.questionario_versao (tenant_id, questionario_id, numero, status, titulo, vigencia_inicio) values ($1, $2, $3, $4, 'x', now())",
          [A, PA.questionarios.exposicao, numero, status],
        );
      expect((await erroDe(emTransacao(app, A, () => novo(3))))?.code).toBe('23505');
      expect((await erroDe(emTransacao(app, A, () => novo(1))))?.code).toBe('23505');
    });

    it('publicada sem pergunta, sem autor ou com vigência invertida é recusada (23514)', async () => {
      const ins = (fimDiasAtras: number | null, perguntas: string, autor: string | null) =>
        app.query(
          `insert into pesquisa.questionario_versao (tenant_id, questionario_id, numero, status, titulo, vigencia_inicio, vigencia_fim, perguntas, publicada_em, publicada_por)
           values ($1, $2, 7, 'publicada', 'x', now(), now() - make_interval(days => $3::int), $4::jsonb, now(), $5::uuid)`,
          [A, PA.questionarios.checkout, fimDiasAtras, perguntas, autor],
        );
      const umaPergunta = JSON.stringify([{ id: PA.perguntas.checkoutNota }]);
      const admin = DOIS_TENANTS.A.usuarios.admin;
      expect(await erroDe(emTransacao(app, A, () => ins(-1, umaPergunta, admin)))).toBeNull(); // controle positivo
      expect((await erroDe(emTransacao(app, A, () => ins(null, '[]', admin))))?.code).toBe('23514');
      expect((await erroDe(emTransacao(app, A, () => ins(null, umaPergunta, null))))?.code).toBe('23514');
      expect((await erroDe(emTransacao(app, A, () => ins(1, umaPergunta, admin))))?.code).toBe('23514');
    });

    it('resposta só para versão PUBLICADA do MESMO questionário (rascunho: 23514; outro questionário: 23503)', async () => {
      const responder = (questionario: string, versao: string) =>
        app.query(
          `insert into pesquisa.resposta (tenant_id, questionario_id, versao_id, usuario_id, respondida_em, itens)
           values ($1, $2, $3, $4, now(), '[{"pergunta_id":"${PA.perguntas.simNao}","tipo":"sim_nao","valor":true}]')`,
          [A, questionario, versao, DOIS_TENANTS.A.usuarios.vendedor1],
        );
      expect((await erroDe(emTransacao(app, A, () => responder(PA.questionarios.exposicao, PA.versoes.exposicaoV2Rascunho))))?.code).toBe('23514');
      expect((await erroDe(emTransacao(app, A, () => responder(PA.questionarios.checkout, PA.versoes.exposicaoV1))))?.code).toBe('23503');
      expect(await erroDe(emTransacao(app, A, () => responder(PA.questionarios.exposicao, PA.versoes.exposicaoV1)))).toBeNull();
    });
  });

  describe('RF-PES-04: resposta só inserção e idempotente', () => {
    it('macuxi_app não atualiza nem apaga resposta, itens ou fotos (42501)', async () => {
      for (const t of ['pesquisa.resposta', 'pesquisa.resposta_item', 'pesquisa.resposta_foto']) {
        const col = t === 'pesquisa.resposta' ? 'id' : 'resposta_id';
        expect((await erroDe(emTransacao(app, A, () => app.query(`update ${t} set deleted_at = now() where ${col} = $1`, [PA.respostas.v1c1]))))?.code, t).toBe('42501');
        expect((await erroDe(emTransacao(app, A, () => app.query(`delete from ${t} where ${col} = $1`, [PA.respostas.v1c1]))))?.code, t).toBe('42501');
      }
    });

    it('mesmo UUID de novo: INSERT puro dá 23505; ON CONFLICT DO NOTHING não grava nada nem duplica itens', async () => {
      const r = await emTransacao(app, A, async () => {
        const sql = (sufixo: string) =>
          app.query(
            `insert into pesquisa.resposta (id, tenant_id, questionario_id, versao_id, usuario_id, respondida_em, itens)
             values ($1, $2, $3, $4, $5, now(), '[{"pergunta_id":"${PA.perguntas.simNao}","tipo":"sim_nao","valor":false}]') ${sufixo}`,
            [PA.respostas.v1c1, A, PA.questionarios.exposicao, PA.versoes.exposicaoV1, DOIS_TENANTS.A.usuarios.vendedor1],
          );
        const idem = await sql('on conflict (id) do nothing');
        const itens = await app.query<{ n: number }>('select count(*)::int as n from pesquisa.resposta_item where resposta_id = $1', [PA.respostas.v1c1]);
        return { gravou: idem.rowCount, itens: itens.rows[0]!.n, puro: await erroDe(sql('')) };
      });
      expect(r.gravou).toBe(0);
      expect(r.itens).toBe(9);
      expect(r.puro?.code).toBe('23505');
    });

    it('motivo de suspeita sem suspeita, motivo fora da lista e resposta sem item são recusados (23514)', async () => {
      const ins = (suspeita: boolean, motivos: string, itens: string) =>
        app.query(
          `insert into pesquisa.resposta (tenant_id, questionario_id, versao_id, usuario_id, respondida_em, suspeita, motivos_suspeita, itens)
           values ($1, $2, $3, $4, now(), $5, $6, $7)`,
          [A, PA.questionarios.exposicao, PA.versoes.exposicaoV1, DOIS_TENANTS.A.usuarios.vendedor1, suspeita, motivos, itens],
        );
      const item = `[{"pergunta_id":"${PA.perguntas.simNao}","tipo":"sim_nao","valor":true}]`;
      expect((await erroDe(emTransacao(app, A, () => ins(false, '{RELOGIO_ADIANTADO}', item))))?.code).toBe('23514');
      expect((await erroDe(emTransacao(app, A, () => ins(true, '{QUALQUER}', item))))?.code).toBe('23514');
      expect((await erroDe(emTransacao(app, A, () => ins(false, '{}', '[]'))))?.code).toBe('23514');
    });
  });

  describe('normalização (gatilho) e fotos', () => {
    it('a resposta de A vira 9 itens com o valor na coluna do tipo e 1 foto ligada ao arquivo', async () => {
      const r = await emTransacao(app, A, async () => ({
        itens: (await app.query<Linha>('select tipo, valor_bool, valor_num::float8 as valor_num, valor_texto, valor_data::text as valor_data, opcao_ids from pesquisa.resposta_item where resposta_id = $1 order by tipo', [PA.respostas.v1c1])).rows,
        fotos: (await app.query<Linha>('select pergunta_id, arquivo_id, largura_px from pesquisa.resposta_foto where resposta_id = $1', [PA.respostas.v1c1])).rows,
      }));
      const porTipo = Object.fromEntries(r.itens.map((i) => [i.tipo, i]));
      expect(porTipo.sim_nao).toMatchObject({ valor_bool: true });
      expect(porTipo.unica).toMatchObject({ opcao_ids: [PA.opcoes.boa] });
      expect(porTipo.multipla).toMatchObject({ opcao_ids: [PA.opcoes.cafe, PA.opcoes.feijao] });
      expect(porTipo.numero).toMatchObject({ valor_num: 12.5 });
      expect(porTipo.escala).toMatchObject({ valor_num: 4 });
      expect(porTipo.foto).toMatchObject({ valor_num: 1 });
      expect(porTipo.texto).toMatchObject({ valor_texto: 'Gôndola organizada' });
      expect(porTipo.codigo_barras).toMatchObject({ valor_texto: '7891234567895' });
      expect(porTipo.data).toMatchObject({ valor_data: PA.dataRespondida });
      expect(r.fotos).toEqual([{ pergunta_id: PA.perguntas.foto, arquivo_id: PA.arquivos.fotoV1c1, largura_px: 1600 }]);
    });

    it('foto sem linha em plataforma.arquivo é recusada (FK, 23503) e a resposta não fica', async () => {
      const semArquivo = '0e000000-0000-4000-8000-00000000f070';
      const e = await erroDe(
        emTransacao(app, A, () =>
          app.query(
            `insert into pesquisa.resposta (tenant_id, questionario_id, versao_id, usuario_id, respondida_em, itens)
             values ($1, $2, $3, $4, now(), $5)`,
            [A, PA.questionarios.exposicao, PA.versoes.exposicaoV1, DOIS_TENANTS.A.usuarios.vendedor1,
              JSON.stringify([{ pergunta_id: PA.perguntas.foto, tipo: 'foto', fotos: [{ id: semArquivo, referencia: semArquivo, capturada_em: agoraDaFixture().toISOString() }] }])],
          ),
        ),
      );
      expect(e?.code).toBe('23503');
    });
  });

  describe('consultas do repositório SQL (docs/banco/pesquisa.md)', () => {
    it('RF-PES-05: arquivar toca as versões publicadas (não o rascunho) e o pull as devolve com arquivado_em', async () => {
      const r = await emTransacao(app, A, async () => {
        const antes = await app.query<{ id: string; updated_at: Date }>('select id, updated_at from pesquisa.questionario_versao where questionario_id = $1 order by numero', [PA.questionarios.exposicao]);
        const corte = (await app.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora;
        await app.query('update pesquisa.questionario set arquivado_em = now() where id = $1 and arquivado_em is null', [PA.questionarios.exposicao]);
        const pull = await app.query<{ id: string; arquivado_em: Date | null }>(
          `select v.id, q.arquivado_em from pesquisa.questionario_versao v join pesquisa.questionario q on q.tenant_id = v.tenant_id and q.id = v.questionario_id
            where v.status = 'publicada' and v.deleted_at is null and (v.updated_at, v.id) > ($1::timestamptz, $2::uuid) and v.updated_at < $3::timestamptz + interval '1 second'
            order by v.updated_at, v.id limit 100`,
          [new Date(corte.getTime() - 1), '00000000-0000-0000-0000-000000000000', corte],
        );
        return { antes: antes.rows, pull: pull.rows };
      });
      expect(r.antes.map((x) => x.id)).toEqual([PA.versoes.exposicaoV1, PA.versoes.exposicaoV2Rascunho]);
      expect(r.pull.map((x) => x.id)).toEqual([PA.versoes.exposicaoV1]);
      expect(r.pull[0]!.arquivado_em).not.toBeNull();
    });

    it('lista do BKO: questionários com o total de respostas, por tenant', async () => {
      const lista = (t: string) =>
        emTransacao(app, t, () =>
          app.query<{ id: string; respostas: number }>(
            `select q.id, (select count(*)::int from pesquisa.resposta r where r.tenant_id = q.tenant_id and r.questionario_id = q.id and r.deleted_at is null) as respostas
               from pesquisa.questionario q where q.deleted_at is null order by q.criado_em, q.id`,
          ),
        );
      const a = (await lista(A)).rows;
      expect(a.find((x) => x.id === PA.questionarios.exposicao)?.respostas).toBe(1);
      expect(a.find((x) => x.id === PA.questionarios.checkout)?.respostas).toBe(0);
      expect((await lista(B)).rows).toEqual([{ id: PB.questionarios.avulsa, respostas: 1 }]);
    });
  });
});

describe.skipIf(semBanco())('pesquisa — seed demo (Postgres)', () => {
  let b: BancoDeTeste;
  const hoje = hojeDaFixture();

  const contar = () =>
    comAdmin(b.nome, async (c) => {
      const out: Record<string, number> = {};
      for (const t of TABELAS) out[t] = (await c.query<{ n: number }>(`select count(*)::int as n from ${t} where tenant_id = $1`, [TENANT_DEMO])).rows[0]!.n;
      return out;
    });

  beforeAll(async () => {
    b = await criarBancoDeTeste({
      preparar: async (c) => {
        await carregarDoisTenants(c, { agora: agoraDaFixture() });
        await carregarDemo(c, { senha: 'Pesquisa@teste1', hoje });
      },
    });
    await comAdmin(b.nome, (c) => carregarPesquisaDemo(c, { hoje }));
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('licença da Pesquisa ativa no tenant demo e nos perfis; 2 questionários, 2 versões publicadas, 16 respostas normalizadas', async () => {
    const r = await comAdmin(b.nome, async (c) => ({
      licenca: (await c.query<{ ativo: boolean }>("select ativo from plataforma.tenant_modulo where tenant_id = $1 and modulo = 'pesquisa' and deleted_at is null", [TENANT_DEMO])).rows,
      perfis: (await c.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where tenant_id = $1 and modulo = 'pesquisa' order by perfil", [TENANT_DEMO])).rows.map((x) => x.perfil),
    }));
    expect(r.licenca).toEqual([{ ativo: true }]);
    expect(r.perfis).toEqual([...PERFIS_PESQUISA_DEMO].sort());
    const n = await contar();
    expect(n['pesquisa.questionario']).toBe(2);
    expect(n['pesquisa.questionario_versao']).toBe(2);
    expect(n['pesquisa.resposta']).toBe(16);
    expect(n['pesquisa.resposta_item']).toBeGreaterThanOrEqual(32);
    expect(n['pesquisa.resposta_foto']).toBe(0);
  });

  it('pelo macuxi_app: o tenant demo vê as versões publicadas e o tenant A não vê nada da demo', async () => {
    const pool = new pg.Pool({ connectionString: b.urlApp });
    try {
      const demo = await comTenant(pool, TENANT_DEMO, async (c) => (await c.query<{ id: string }>("select id from pesquisa.questionario_versao where status = 'publicada' order by id")).rows.map((x) => x.id));
      expect(demo).toEqual([PESQUISA_DEMO.versoes.exposicaoV1, PESQUISA_DEMO.versoes.satisfacaoV1].sort());
      const deA = await comTenant(pool, A, async (c) => (await c.query<{ n: number }>('select count(*)::int as n from pesquisa.resposta where tenant_id = $1', [TENANT_DEMO])).rows[0]!.n);
      expect(deA).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('idempotente: rodar de novo (mesmo dia ou outro) não duplica e não toca a versão publicada (RN-PES-01)', async () => {
    const antes = await contar();
    const versoes = () => comAdmin(b.nome, async (c) => (await c.query<Linha>('select id, updated_at, vigencia_inicio from pesquisa.questionario_versao where tenant_id = $1 order by id', [TENANT_DEMO])).rows);
    const v1 = await versoes();
    await comAdmin(b.nome, (c) => carregarPesquisaDemo(c, { hoje }));
    await comAdmin(b.nome, (c) => carregarPesquisaDemo(c, { hoje: somarDias(hoje, 1) }));
    expect(await contar()).toEqual(antes);
    expect(await versoes()).toEqual(v1);
  });

  it('dentro da transação do carregarDemo (a linha que liga o seed no demo.ts) também carrega', async () => {
    const outro = await criarBancoDeTeste({
      preparar: async (c) => {
        await carregarDemo(c, { senha: 'Pesquisa@teste1', hoje });
        await c.query('begin');
        await gravarPesquisaDemo(c, { hoje });
        await c.query('commit');
      },
    });
    try {
      const n = await comAdmin(outro.nome, async (c) => (await c.query<{ n: number }>('select count(*)::int as n from pesquisa.resposta where tenant_id = $1', [TENANT_DEMO])).rows[0]!.n);
      expect(n).toBe(16);
    } finally {
      await outro.apagar();
    }
  });
});
