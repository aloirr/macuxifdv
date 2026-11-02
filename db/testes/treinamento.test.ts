/**
 * 0017_treinamento (T-0058) — schema do Treinamento: listas fechadas = código, fronteira, RLS entre os dois tenants da
 * fixture, unicidade/idempotência (RN-TRE-01/04/06), append-only dos dados do aluno, gatilho que sobe o updated_at da
 * trilha (pull por trilha) e a base de demo do módulo (db/seeds/demo/treinamento.ts).
 * Linha do tempo: a do relógio do teste (`criarRelogio`, @macuxi/comum/relogio) para o seed; a do BANCO (now() da própria
 * transação, comparado dentro do SQL) para o gatilho. Nenhum instante fixo comparado com o relógio real.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { PERFIS } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGENS_XP } from '../../modules/treinamento/domain/xp';
import type { StatusTrilha } from '../../modules/treinamento/domain/trilha';
import { carregarDemo, dadosDemo, FUSO_DEMO, idUsuarioDemo, TENANT_DEMO, USUARIOS_DEMO } from '../seeds/demo/demo';
import {
  carregarTreinamentoDemo, dadosTreinamentoDemo, FUSO_DEMO_TREINAMENTO, idUsuarioDemoTreinamento, MEDALHAS_DEMO, ORDEM_TREINAMENTO_DEMO,
  PERFIS_TREINAMENTO_DEMO, SKUS_DESAFIO_DEMO, TENANT_DEMO_TREINAMENTO, TRILHAS_DEMO,
} from '../seeds/demo/treinamento';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { comTenant } from '../src/contexto';
import { lerMigracoes } from '../src/migrador';
import { banco, semBanco } from './estado';
import { ORDEM_TREINAMENTO, TREINAMENTO_FIXTURE } from './fixture-treinamento';
import { comCliente, emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const m17 = lerMigracoes().find((m) => m.versao === '0017')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** Valores do CHECK `<coluna> in (...)` da tabela (na ordem do SQL). */
function valoresDoIn(sql: string, coluna: string): string[] {
  const m = new RegExp(`check \\(${coluna} in \\(([^)]*)\\)\\)`).exec(sql);
  return m ? [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!) : [];
}
/** Bloco `create table treinamento.<t> ( ... );`. */
const bloco = (t: string) => new RegExp(`create table treinamento\\.${t} \\(([\\s\\S]*?)\\n\\);`).exec(m17.up)?.[1] ?? '';
const SO_INSERCAO = ['trilha_publicacao', 'progresso', 'tentativa', 'xp_lancamento', 'medalha_usuario'];

describe('0017 treinamento (estático)', () => {
  it('cria as 14 tabelas da fixture/ORDEM_TREINAMENTO e o down apaga o schema', () => {
    const criadas = [...m17.up.matchAll(/^create table (treinamento\.[a-z_]+) \(/gm)].map((x) => x[1]!);
    expect(criadas.sort()).toEqual([...ORDEM_TREINAMENTO].sort());
    expect(m17.down).toContain('drop schema if exists treinamento cascade;');
  });

  it('listas fechadas = código do Treinamento (status, tipo de lição, origem do XP, perfis do público, ação de publicação)', () => {
    const status: readonly StatusTrilha[] = ['rascunho', 'publicada', 'arquivada'];
    expect(valoresDoIn(bloco('trilha'), 'status')).toEqual([...status]);
    expect(valoresDoIn(bloco('trilha_publicacao'), 'de')).toEqual([...status]);
    expect(valoresDoIn(bloco('trilha_publicacao'), 'para')).toEqual([...status]);
    expect(valoresDoIn(bloco('trilha_publicacao'), 'acao')).toEqual(['publicar', 'arquivar']);
    expect(valoresDoIn(bloco('licao'), 'tipo')).toEqual(['texto', 'video', 'pdf', 'link']);
    expect(valoresDoIn(bloco('xp_lancamento'), 'origem')).toEqual([...ORIGENS_XP]);
    const perfis = /publico_perfis <@ array\[([^\]]*)\]/.exec(bloco('trilha'))![1]!;
    expect([...perfis.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort()).toEqual([...PERFIS].sort());
  });

  it('idempotência (RN-TRE-01/04/06): chaves naturais únicas do aluno e um quiz vivo por lição', () => {
    expect(bloco('progresso')).toContain('constraint progresso_usuario_licao_uk unique (tenant_id, usuario_id, licao_id)');
    expect(bloco('xp_lancamento')).toContain('constraint xp_lancamento_chave_uk unique (tenant_id, usuario_id, origem, referencia_id)');
    expect(bloco('medalha_usuario')).toContain('constraint medalha_usuario_uk unique (tenant_id, usuario_id, medalha_codigo)');
    expect(m17.up).toContain('create unique index quiz_licao_uk on treinamento.quiz (tenant_id, licao_id) where deleted_at is null;');
    expect(bloco('xp_lancamento')).toContain('check (char_length(referencia_id) between 1 and 128)');
  });

  it('pull: (tenant_id, updated_at, id) em todas e (tenant_id, usuario_id, updated_at, id) nas do aluno', () => {
    for (const t of ORDEM_TREINAMENTO) expect(m17.up).toMatch(new RegExp(`on ${t.replace('.', '\\.')} \\(tenant_id, updated_at, id\\);`));
    for (const t of ['progresso', 'tentativa', 'xp_lancamento', 'medalha_usuario']) {
      expect(m17.up).toContain(`create index ${t}_usuario_sync_ix on treinamento.${t} (tenant_id, usuario_id, updated_at, id);`);
    }
  });

  it('append-only: dados do aluno e linha do tempo da publicação só com select e insert (sem gatilho de updated_at)', () => {
    for (const t of SO_INSERCAO) {
      expect(m17.up).toContain(`grant select, insert on treinamento.${t} to macuxi_app;`);
      expect(m17.up).not.toContain(`create trigger ${t}_updated_at`);
    }
  });

  it('árvore da trilha: todo nó guarda trilha_id preso por FK composta e toca a trilha (gatilho)', () => {
    for (const t of ['modulo_trilha', 'licao', 'quiz', 'questao', 'alternativa']) {
      expect(bloco(t)).toMatch(/^\s+trilha_id\s+uuid not null/m);
      expect(m17.up).toContain(`create trigger ${t}_toca_trilha after insert or update or delete on treinamento.${t}\n  for each row execute function treinamento.tocar_trilha();`);
    }
    expect(bloco('licao')).toContain('foreign key (tenant_id, trilha_id, modulo_id) references treinamento.modulo_trilha (tenant_id, trilha_id, id)');
    expect(bloco('alternativa')).toContain('foreign key (tenant_id, trilha_id, questao_id) references treinamento.questao (tenant_id, trilha_id, id)');
  });

  it('fronteira: nenhuma FK para schema de outro módulo e nenhuma função SECURITY DEFINER', () => {
    expect(semComentarios(m17.up)).not.toMatch(/references (core|vendedor|catalogo|promotor|gestor|pesquisa|integracao)\./);
    expect(semComentarios(m17.up)).not.toMatch(/security definer/i);
    for (const [, alvo] of semComentarios(m17.up).matchAll(/references ([a-z_]+\.[a-z_]+)/g)) expect(alvo).toMatch(/^(treinamento\.|plataforma\.tenant$)/);
  });
});

describe('base de demo do Treinamento (estático)', () => {
  const relogio = criarRelogio({ fuso: FUSO_DEMO });
  const d = dadosTreinamentoDemo({ hoje: relogio.hoje(), agora: relogio.agora() });
  const demo = dadosDemo('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: relogio.hoje() });
  const xpDe = (chave: keyof typeof USUARIOS_DEMO) =>
    d['treinamento.xp_lancamento'].filter((x) => x.usuario_id === idUsuarioDemo(chave)).reduce((s, x) => s + Number(x.pontos), 0);

  it('constantes replicadas = demo.ts (tenant, fuso, usuários, produtos e equipe)', () => {
    expect(TENANT_DEMO_TREINAMENTO).toBe(TENANT_DEMO);
    expect(FUSO_DEMO_TREINAMENTO).toBe(FUSO_DEMO);
    for (const k of Object.keys(USUARIOS_DEMO) as Array<keyof typeof USUARIOS_DEMO>) expect(idUsuarioDemoTreinamento(k)).toBe(idUsuarioDemo(k));
    const produtos = new Map(demo['core.produto'].map((p) => [p.id, p.sku]));
    expect(d['treinamento.desafio_vendas_produto'].map((p) => produtos.get(p.produto_id))).toEqual([...SKUS_DESAFIO_DEMO]);
    const equipes = new Set(demo['core.equipe'].map((e) => e.id));
    for (const t of d['treinamento.trilha']) for (const e of String(t.publico_equipes).replace(/[{}]/g, '').split(',').filter(Boolean)) expect(equipes).toContain(e);
  });

  it('licença ativa do Treinamento no tenant demo, para todos os perfis', () => {
    expect(d['plataforma.tenant_modulo']).toEqual([expect.objectContaining({ tenant_id: TENANT_DEMO, modulo: 'treinamento', ativo: true })]);
    expect(d['plataforma.perfil_modulo'].map((p) => p.perfil).sort()).toEqual([...PERFIS_TREINAMENTO_DEMO].sort());
    expect([...PERFIS_TREINAMENTO_DEMO].sort()).toEqual([...PERFIS].sort());
  });

  it('2 trilhas publicadas (a obrigatória com quiz) e 1 rascunho; todo quiz com uma correta por questão', () => {
    const trilhas = d['treinamento.trilha'];
    expect(trilhas.filter((t) => t.status === 'publicada').length).toBe(2);
    expect(trilhas.filter((t) => t.status === 'rascunho').length).toBe(1);
    const obrigatoria = trilhas.find((t) => t.obrigatoria)!;
    expect(obrigatoria.status).toBe('publicada');
    expect(d['treinamento.quiz'].some((q) => q.trilha_id === obrigatoria.id)).toBe(true);
    for (const q of d['treinamento.questao']) expect(d['treinamento.alternativa'].filter((a) => a.questao_id === q.id && a.correta).length).toBe(1);
    expect(d['treinamento.trilha_publicacao'].length).toBe(2);
    expect(TRILHAS_DEMO.length).toBe(3);
  });

  it('XP coerente: teto diário de 200 respeitado, chave natural sem repetição e ranking Lucas > Camila > Joana', () => {
    const porDia = new Map<string, number>();
    for (const x of d['treinamento.xp_lancamento']) porDia.set(`${x.usuario_id}:${x.dia}`, (porDia.get(`${x.usuario_id}:${x.dia}`) ?? 0) + Number(x.pontos));
    for (const total of porDia.values()) expect(total).toBeLessThanOrEqual(200);
    const chaves = d['treinamento.xp_lancamento'].map((x) => `${x.usuario_id}:${x.origem}:${x.referencia_id}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect([xpDe('vendedor'), xpDe('vendedor2'), xpDe('promotor')]).toEqual([115, 110, 10]);
    expect(xpDe('supervisor') + xpDe('analista') + xpDe('admin')).toBe(0);
    const medalhas = d['treinamento.medalha_usuario'].map((m) => `${m.usuario_id === idUsuarioDemo('vendedor') ? 'lucas' : 'camila'}:${m.medalha_codigo}`).sort();
    expect(medalhas).toEqual(['camila:nota_maxima', 'camila:primeira_trilha', 'lucas:nota_maxima', 'lucas:primeira_trilha']);
    expect(d['treinamento.medalha'].map((m) => m.codigo)).toEqual(MEDALHAS_DEMO.map((m) => m.codigo));
  });

  it('nenhuma atividade depois do "agora" do seed e o dia civil bate com o fuso de Manaus', () => {
    const agoraMs = relogio.ms();
    for (const p of d['treinamento.progresso']) expect(Date.parse(String(p.concluida_em))).toBeLessThanOrEqual(agoraMs);
    for (const x of d['treinamento.xp_lancamento']) {
      expect(Date.parse(String(x.ocorrido_em))).toBeLessThanOrEqual(agoraMs);
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DEMO }).format(new Date(String(x.ocorrido_em)))).toBe(x.dia);
    }
  });

  it('toda linha é do tenant demo', () => {
    for (const t of ORDEM_TREINAMENTO_DEMO) for (const l of d[t]) expect(l.tenant_id).toBe(TENANT_DEMO);
  });
});

describe.skipIf(semBanco())('0017 treinamento no banco (papel de aplicação, fixture dois-tenants)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('RLS: cada tenant só vê as próprias trilhas, XP e progresso; id de B no contexto de A = 0 linhas', async () => {
    for (const [tenant, outro] of [[A, B], [B, A]] as const) {
      const r = await emTransacao(app, tenant, async () => ({
        trilhas: (await app.query<{ tenant_id: string }>('select distinct tenant_id::text from treinamento.trilha')).rows.map((x) => x.tenant_id),
        xp: (await app.query<{ n: number }>('select count(*)::int as n from treinamento.xp_lancamento where tenant_id = $1', [outro])).rows[0]!.n,
      }));
      expect(r).toEqual({ trilhas: [tenant], xp: 0 });
    }
    const porId = await emTransacao(app, A, () => app.query('select 1 from treinamento.trilha where id = $1', [TREINAMENTO_FIXTURE.B.trilha]));
    expect(porId.rowCount).toBe(0);
  });

  it('RLS: escrever no tenant B pelo contexto de A é recusado (42501)', async () => {
    const e = await erroDe(
      emTransacao(app, A, () =>
        app.query(
          `insert into treinamento.xp_lancamento (tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, ocorrido_em, dia)
           values ($1, $2, 'licao', 'x', 1, 1, now(), current_date)`, // hora-fixa-ok: a linha é recusada, nada é comparado
          [B, TREINAMENTO_FIXTURE.B.aluno],
        ),
      ),
    );
    expect(e?.code).toBe('42501');
  });

  it('idempotência: mesma chave natural com outro id = 23505; on conflict do nothing não duplica', async () => {
    const { aluno, licao, quiz } = TREINAMENTO_FIXTURE.A;
    const xp = (sufixo = '') =>
      app.query(
        `insert into treinamento.xp_lancamento (id, tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, ocorrido_em, dia)
         select gen_random_uuid(), tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, ocorrido_em, dia
           from treinamento.xp_lancamento where tenant_id = $1 and usuario_id = $2 and origem = 'licao' and referencia_id = $3 ${sufixo}`,
        [A, aluno, licao],
      );
    const dup = await erroDe(emTransacao(app, A, () => xp()));
    expect(dup).toMatchObject({ code: '23505', message: expect.stringContaining('xp_lancamento_chave_uk') });
    const nada = await emTransacao(app, A, () => xp('on conflict (tenant_id, usuario_id, origem, referencia_id) do nothing'));
    expect(nada.rowCount).toBe(0);
    const progresso = await erroDe(
      emTransacao(app, A, () =>
        app.query(
          `insert into treinamento.progresso (tenant_id, usuario_id, trilha_id, licao_id, concluida_em)
           select tenant_id, usuario_id, trilha_id, licao_id, concluida_em from treinamento.progresso where tenant_id = $1 and usuario_id = $2 and licao_id = $3`,
          [A, aluno, licao],
        ),
      ),
    );
    expect(progresso).toMatchObject({ code: '23505', message: expect.stringContaining('progresso_usuario_licao_uk') });
    const medalha = await erroDe(
      emTransacao(app, A, () =>
        app.query(
          `insert into treinamento.medalha_usuario (tenant_id, usuario_id, medalha_codigo, conquistada_em)
           select tenant_id, usuario_id, medalha_codigo, conquistada_em from treinamento.medalha_usuario where tenant_id = $1 and usuario_id = $2`,
          [A, aluno],
        ),
      ),
    );
    expect(medalha).toMatchObject({ code: '23505', message: expect.stringContaining('medalha_usuario_uk') });
    const quizDuplo = await erroDe(
      emTransacao(app, A, () => app.query('insert into treinamento.quiz (tenant_id, trilha_id, licao_id) select tenant_id, trilha_id, licao_id from treinamento.quiz where id = $1', [quiz])),
    );
    expect(quizDuplo).toMatchObject({ code: '23505', message: expect.stringContaining('quiz_licao_uk') });
  });

  it('append-only: a aplicação não altera nem apaga XP, progresso, tentativa, medalha nem a linha do tempo (42501)', async () => {
    for (const t of SO_INSERCAO) {
      for (const sql of [`update treinamento.${t} set external_id = 'x' where tenant_id = $1`, `delete from treinamento.${t} where tenant_id = $1`]) {
        const e = await erroDe(emTransacao(app, A, () => app.query(sql, [A])));
        expect(e?.code, `${t}: ${sql}`).toBe('42501');
      }
    }
  });

  it('checks: XP incoerente, origem/perfil inválidos, publicada sem data e transição de arquivada = 23514', async () => {
    const { aluno } = TREINAMENTO_FIXTURE.A;
    const casos: Array<[string, string, unknown[]]> = [
      ['pontos > base', `insert into treinamento.xp_lancamento (tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, limitado_pelo_teto, ocorrido_em, dia)
                         select $1, $2, 'licao', 'r1', 20, 10, false, ocorrido_em, dia from treinamento.xp_lancamento where tenant_id = $1 limit 1`, [A, aluno]],
      ['teto incoerente', `insert into treinamento.xp_lancamento (tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, limitado_pelo_teto, ocorrido_em, dia)
                           select $1, $2, 'licao', 'r2', 5, 10, false, ocorrido_em, dia from treinamento.xp_lancamento where tenant_id = $1 limit 1`, [A, aluno]],
      ['origem inválida', `insert into treinamento.xp_lancamento (tenant_id, usuario_id, origem, referencia_id, pontos, pontos_base, ocorrido_em, dia)
                           select $1, $2, 'bonus', 'r3', 1, 1, ocorrido_em, dia from treinamento.xp_lancamento where tenant_id = $1 limit 1`, [A, aluno]],
      ['perfil inválido', "update treinamento.trilha set publico_perfis = '{diretor}' where tenant_id = $1", [A]],
      ['publicada sem data', "update treinamento.trilha set publicada_em = null where tenant_id = $1 and status = 'publicada'", [A]],
      ['publicar arquivada', `insert into treinamento.trilha_publicacao (tenant_id, trilha_id, acao, de, para, autor_id)
                              select tenant_id, id, 'publicar', 'arquivada', 'publicada', $2 from treinamento.trilha where tenant_id = $1 limit 1`, [A, aluno]],
    ];
    for (const [rotulo, sql, params] of casos) {
      const e = await erroDe(emTransacao(app, A, () => app.query(sql, params)));
      expect(e?.code, `${rotulo}: ${e?.message ?? 'passou!'}`).toBe('23514');
    }
  });

  it('pull por trilha: mexer em qualquer nó da árvore sobe o updated_at da trilha (now() da transação)', async () => {
    const { trilha } = TREINAMENTO_FIXTURE.A;
    const tocou = (sql: string) =>
      emTransacao(app, A, async () => {
        const antes = (await app.query<{ igual: boolean }>('select updated_at = now() as igual from treinamento.trilha where id = $1', [trilha])).rows[0]!.igual;
        await app.query(sql, [trilha]);
        const depois = (await app.query<{ igual: boolean }>('select updated_at = now() as igual from treinamento.trilha where id = $1', [trilha])).rows[0]!.igual;
        return { antes, depois };
      });
    expect(await tocou("update treinamento.alternativa set texto = texto || '!' where trilha_id = $1 and not correta")).toEqual({ antes: false, depois: true });
    expect(await tocou('delete from treinamento.alternativa where trilha_id = $1 and not correta')).toEqual({ antes: false, depois: true });
    expect(await tocou("insert into treinamento.modulo_trilha (tenant_id, trilha_id, ordem, titulo) select tenant_id, id, 9, 'Novo' from treinamento.trilha where id = $1")).toEqual({
      antes: false,
      depois: true,
    });
  });
});

describe.skipIf(semBanco())('base de demo do Treinamento no banco', () => {
  let b: BancoDeTeste;
  let pool: pg.Pool;
  const relogio = criarRelogio({ fuso: FUSO_DEMO });
  beforeAll(async () => {
    b = await criarBancoDeTeste();
    await comAdmin(b.nome, async (c) => {
      await carregarDemo(c, { senha: 'senha-do-teste-treinamento', hoje: relogio.hoje() });
      await carregarTreinamentoDemo(c, { hoje: relogio.hoje(), agora: relogio.agora() });
    });
    pool = new pg.Pool({ connectionString: b.urlApp, max: 1 });
  });
  afterAll(async () => {
    await pool?.end();
    await b?.apagar();
  });

  const retrato = () =>
    comTenant(pool, TENANT_DEMO, async (c) => ({
      modulo: (await c.query<{ ativo: boolean }>("select ativo from plataforma.tenant_modulo where modulo = 'treinamento' and deleted_at is null")).rows.map((x) => x.ativo),
      perfis: (await c.query<{ n: number }>("select count(*)::int as n from plataforma.perfil_modulo where modulo = 'treinamento' and deleted_at is null")).rows[0]!.n,
      trilhas: (await c.query<{ status: string; n: number }>('select status, count(*)::int as n from treinamento.trilha group by status order by status')).rows,
      ranking: (await c.query<{ usuario_id: string; xp: number }>(
        'select usuario_id::text, sum(pontos)::int as xp from treinamento.xp_lancamento group by usuario_id order by xp desc',
      )).rows,
      linhas: (await c.query<{ n: number }>(
        `select ((select count(*) from treinamento.licao) + (select count(*) from treinamento.alternativa) + (select count(*) from treinamento.progresso)
              + (select count(*) from treinamento.tentativa) + (select count(*) from treinamento.medalha_usuario))::int as n`,
      )).rows[0]!.n,
    }));

  it('licença ativa, 2 publicadas + 1 rascunho e ranking Lucas 115 > Camila 110 > Joana 10 (pelo papel da aplicação)', async () => {
    const r = await retrato();
    expect(r.modulo).toEqual([true]);
    expect(r.perfis).toBe(PERFIS.length);
    expect(r.trilhas).toEqual([{ status: 'publicada', n: 2 }, { status: 'rascunho', n: 1 }]);
    expect(r.ranking).toEqual([
      { usuario_id: idUsuarioDemo('vendedor'), xp: 115 },
      { usuario_id: idUsuarioDemo('vendedor2'), xp: 110 },
      { usuario_id: idUsuarioDemo('promotor'), xp: 10 },
    ]);
  });

  it('idempotente: rodar de novo não duplica nada', async () => {
    const antes = await retrato();
    await comAdmin(b.nome, (c) => carregarTreinamentoDemo(c, { hoje: relogio.hoje(), agora: relogio.agora() }));
    expect(await retrato()).toEqual(antes);
  });

  it('outro tenant não enxerga a base demo do Treinamento', async () => {
    const n = await comCliente(b.urlApp, (c) =>
      emTransacao(c, DOIS_TENANTS.A.tenantId, async () => (await c.query<{ n: number }>('select count(*)::int as n from treinamento.trilha')).rows[0]!.n),
    );
    expect(n).toBe(0);
  });
});
