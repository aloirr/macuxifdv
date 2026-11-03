/**
 * Repositório SQL do Treinamento × Postgres REAL (T-0058): fixture dois-tenants (A em America/Manaus, B em
 * America/Sao_Paulo), papel de aplicação `macuxi_app` (RLS forçado) e as rotas/sync de verdade sobre a fábrica SQL.
 * Cobre: BKO (criar, trocar a árvore, publicar/arquivar com a linha do tempo), pull com cursor, idempotência do
 * progresso/XP/medalhas (inclusive reenvio concorrente), dados do aluno só com leitura e inserção (42501), ranking só do
 * tenant, dia civil no fuso do tenant e isolamento entre A e B.
 * Sem hora fixa: toda data deriva de `criarRelogio` (dia civil no fuso do tenant) ou do `now()` do banco (cursor do pull).
 * Pula sem Postgres/Docker (com aviso); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { readFileSync } from 'node:fs';
import { localIsoDate } from '@macuxi/comum/fuso';
import { criarRelogio, relogioDoBanco, type RelogioDeTeste } from '@macuxi/comum/relogio';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoBase, LinhaSync, PedidoPull } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BkoTrilhaDetalhe, RankingResposta } from '../contracts/api';
import { TrilhaEdicao, TrilhaSyncLinha } from '../contracts/conteudo';
import { EVENTO_LICAO_CONCLUIDA, EVENTO_MEDALHA_CONQUISTADA } from '../contracts/eventos';
import { AtividadeEnvio, XpLancamentoSyncLinha } from '../contracts/sync';
import { chamar, contexto, novoRegistro, uuid, type OpcoesContexto, type Registro } from './apoio-teste';
import { IDS, licaoEnvio, quizEnvio, trilhaEdicao } from './fixtures-teste';
import { criarApiTreinamento } from './index';
import { criarFabricaPostgres } from './repositorio-postgres';
import type { UsuarioTreinamento } from './repositorio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;

const pessoa = (id: string, nome: string, perfil: UsuarioTreinamento['perfil']): UsuarioTreinamento => ({ id, nome, perfil, equipe_id: null, regional_id: null, ativo: true });
const PESSOAS = {
  A: { aluna: pessoa(A.usuarios.vendedor2, 'Vera A', 'vendedor'), aluna2: pessoa(A.usuarios.promotor, 'Paula A', 'promotor'), bko: pessoa(A.usuarios.analista, 'Ana A', 'analista') },
  B: { aluno: pessoa(B.usuarios.vendedor, 'Beto B', 'vendedor'), bko: pessoa(B.usuarios.admin, 'Admin B', 'admin') },
};
/** O Core simulado conhece os usuários dos DOIS tenants: só a RLS do Treinamento separa um do outro. */
const CADASTRO = [...Object.values(PESSOAS.A), ...Object.values(PESSOAS.B)];

/** Ids do conteúdo e das atividades por tenant: o `id` é chave primária global, então A e B não podem repetir. */
const CONF = {
  A: { tenant: A.tenantId, fuso: A.fuso, conteudo: '1a0000aa', atividade: 'aa000000' },
  B: { tenant: B.tenantId, fuso: B.fuso, conteudo: '1a0000bb', atividade: 'bb000000' },
} as const;
type Lado = keyof typeof CONF;

const renomear = <T>(x: T, conteudo: string): T => JSON.parse(JSON.stringify(x).replaceAll('1a000000', conteudo)) as T;

describe('o repositório SQL nunca atualiza nem apaga dado do aluno (append-only)', () => {
  it('RN-TRE-04: o código do repositório só faz select e insert em progresso, tentativa, xp_lancamento, medalha_usuario e trilha_publicacao', () => {
    const fonte = readFileSync(new URL('./repositorio-postgres.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/\bupdate\s+treinamento\.(progresso|tentativa|xp_lancamento|medalha_usuario|trilha_publicacao)\b/i);
    expect(fonte).not.toMatch(/\bdelete\s+from\s+treinamento\.(progresso|tentativa|xp_lancamento|medalha_usuario|trilha_publicacao)\b/i);
    expect(fonte).not.toMatch(/\bupdate\s+treinamento\.\$\{/i);
  });

  it('regra 1: o repositório não lê tabela de outro schema (core.*, catalogo.*, vendedor.*, plataforma.*)', () => {
    const fonte = readFileSync(new URL('./repositorio-postgres.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/\b(from|join)\s+(core|catalogo|vendedor|promotor|gestor|pesquisa|integracao|plataforma)\./i);
  });
});

describe('base de usuários do painel (RF-TRE-05)', () => {
  const doTenant = (f: ReturnType<typeof criarFabricaPostgres>) => f.doTenant({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco, 'x', () => new Date());
  it('RF-TRE-05: sem a consulta de usuários do Core a base é parcial (o painel avisa); com fonte completa não', () => {
    expect(doTenant(criarFabricaPostgres()).usuariosCompletos).toBe(false);
    const completa = Object.assign(async () => [], { completa: true });
    expect(doTenant(criarFabricaPostgres({ usuarios: completa })).usuariosCompletos).toBe(true);
  });
});

describe.skipIf(semBanco())('Treinamento × Postgres: fábrica SQL, RLS entre A e B, idempotência e ranking', () => {
  let pool: pg.Pool;
  let admin: pg.Pool;
  const api = criarApiTreinamento({ fabrica: criarFabricaPostgres() });
  const registro: Registro = novoRegistro();

  const executor: NonNullable<OpcoesContexto['executor']> = (tenant, fn) => comTenant(pool, tenant, (c) => fn(c as unknown as ClienteBanco));

  /** Relógio do teste no fuso do tenant: ontem às 12:00 (mesmo dia civil em qualquer hora do dia em que o teste roda). */
  function relogioDe(lado: Lado, hora = '12:00', dias = -1): RelogioDeTeste {
    const base = criarRelogio({ fuso: CONF[lado].fuso });
    return criarRelogio({ agora: base.instante({ dias, hora }), fuso: CONF[lado].fuso });
  }

  const como = (lado: Lado, usuario: UsuarioTreinamento, relogio: RelogioDeTeste, extra: Partial<OpcoesContexto> = {}): OpcoesContexto => ({
    usuario,
    tenant: CONF[lado].tenant,
    relogio,
    registro,
    executor,
    cadastro: CADASTRO,
    modulos: ['core', 'treinamento'],
    ...extra,
  });

  const trilhaDe = (lado: Lado, extra: Parameters<typeof trilhaEdicao>[0] = {}) => renomear(trilhaEdicao(extra), CONF[lado].conteudo);
  const idsDe = (lado: Lado) => renomear(IDS, CONF[lado].conteudo);
  const idAtv = (lado: Lado, n: number) => uuid(n, CONF[lado].atividade);

  async function criarEPublicar(lado: Lado, bko: UsuarioTreinamento, relogio: RelogioDeTeste, extra: Parameters<typeof trilhaEdicao>[0] = {}) {
    const corpo = trilhaDe(lado, extra);
    const criada = await chamar(api, 'POST', 'bko/trilhas', { ...como(lado, bko, relogio), corpo });
    expect(criada.status).toBe(201);
    const pub = await chamar<BkoTrilhaDetalhe>(api, 'POST', `bko/trilhas/${corpo.id}/publicar`, como(lado, bko, relogio));
    expect(pub.status).toBe(200);
    return { corpo, publicada: pub.corpo };
  }

  const provedor = (nome: string) => api.sync!.find((p) => p.entidade.nome === nome)!;
  async function push(lado: Lado, aluno: UsuarioTreinamento, relogio: RelogioDeTeste, atividades: AtividadeEnvio[]) {
    const ctx = contexto(como(lado, aluno, relogio));
    return provedor('progresso').receber!(ctx, atividades.map((a) => ({ entidade: 'progresso', id: a.id, operacao: 'upsert' as const, payload: AtividadeEnvio.parse(a) })));
  }
  /** Pull completo, do ponto de vista do aluno, até 1 min depois do `now()` do banco. */
  async function pull(lado: Lado, aluno: UsuarioTreinamento, entidade: string, relogio: RelogioDeTeste): Promise<LinhaSync[]> {
    const doBanco = await comTenant(pool, CONF[lado].tenant, (c) => relogioDoBanco(c));
    const p: PedidoPull = { desde: null, ate: doBanco.relativo({ minutos: 1 }).toISOString(), limite: 1000 };
    return provedor(entidade).puxar!(contexto(como(lado, aluno, relogio)) as ContextoBase, p);
  }

  /** Trilha mínima publicável: um módulo e uma lição de texto (ids n, n+1 e n+2). */
  const unica = (lado: Lado, n: number) => ({ id: uuid(n, CONF[lado].conteudo), modulos: [{ id: uuid(n + 1, CONF[lado].conteudo), ordem: 1, titulo: 'M', licoes: [{ id: uuid(n + 2, CONF[lado].conteudo), ordem: 1, titulo: 'L', tipo: 'texto' as const, texto: 'x' }] }] });

  const lote = (lado: Lado, relogio: RelogioDeTeste) => {
    const ids = idsDe(lado);
    const t = (min: number) => relogio.relativo({ minutos: min - 30 }).toISOString();
    return [
      licaoEnvio(idAtv(lado, 1), ids.l1, t(0)),
      quizEnvio(idAtv(lado, 2), t(10)),
      licaoEnvio(idAtv(lado, 3), ids.l2, t(20)),
    ].map((a) => renomear(a, CONF[lado].conteudo));
  };

  const contar = async (sql: string, valores: unknown[] = []) => Number((await admin.query<{ n: string }>(sql, valores)).rows[0]!.n);
  const xpDo = async (usuarioId: string) => contar(`select coalesce(sum(pontos), 0) as n from treinamento.xp_lancamento where usuario_id = $1`, [usuarioId]);
  const linhasDo = async (tabela: string, usuarioId: string) => contar(`select count(*) as n from treinamento.${tabela} where usuario_id = $1`, [usuarioId]);

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 2 });
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('BKO: trilha, árvore e linha do tempo (RF-TRE-01)', () => {
    it('RF-TRE-01: criar grava a árvore e ler devolve a mesma trilha; repetir o POST (id do cliente) não duplica', async () => {
      const relogio = relogioDe('A');
      const c = CONF.A.conteudo;
      const corpo = TrilhaEdicao.parse({
        id: uuid(901, c),
        titulo: 'Árvore completa',
        modulos: [
          {
            id: uuid(910, c),
            ordem: 1,
            titulo: 'M1',
            licoes: [
              { id: uuid(920, c), ordem: 1, titulo: 'L1', tipo: 'texto', texto: 'a' },
              {
                id: uuid(921, c),
                ordem: 2,
                titulo: 'L2',
                tipo: 'video',
                midia_url: 'https://exemplo.test/v.mp4',
                duracao_estimada_seg: 90,
                pre_requisitos: [uuid(920, c)],
                quiz: {
                  id: uuid(930, c),
                  questoes: [
                    { id: uuid(940, c), ordem: 1, enunciado: 'Q1', alternativas: [{ id: uuid(950, c), texto: 'a', correta: true }, { id: uuid(951, c), texto: 'b', correta: false }] },
                    { id: uuid(941, c), ordem: 2, enunciado: 'Q2', alternativas: [{ id: uuid(952, c), texto: 'c', correta: false }, { id: uuid(953, c), texto: 'd', correta: true }] },
                  ],
                },
              },
            ],
          },
        ],
        publico_alvo: { perfis: ['vendedor', 'promotor'], equipes: [uuid(1, '0e0000aa')] },
        prazo: relogio.dia(30),
      });
      const criada = await chamar<BkoTrilhaDetalhe>(api, 'POST', 'bko/trilhas', { ...como('A', PESSOAS.A.bko, relogio), corpo });
      expect(criada.status).toBe(201);
      expect(criada.corpo).toMatchObject({ id: corpo.id, status: 'rascunho', publicada_em: null, tenant_id: A.tenantId, prazo: relogio.dia(30) });
      const lida = await chamar<BkoTrilhaDetalhe>(api, 'GET', `bko/trilhas/${corpo.id}`, como('A', PESSOAS.A.bko, relogio));
      expect(lida.status).toBe(200);
      expect(lida.corpo.modulos).toEqual(corpo.modulos);
      expect(lida.corpo.publico_alvo).toEqual(corpo.publico_alvo);
      expect(lida.corpo.created_at).toBe(criada.corpo.created_at);
      const repetida = await chamar<BkoTrilhaDetalhe>(api, 'POST', 'bko/trilhas', { ...como('A', PESSOAS.A.bko, relogio), corpo });
      expect(repetida.corpo.updated_at).toBe(criada.corpo.updated_at);
      expect(await contar(`select count(*) as n from treinamento.trilha where id = $1`, [corpo.id])).toBe(1);
      expect(await contar(`select count(*) as n from treinamento.licao where trilha_id = $1`, [corpo.id])).toBe(2);
      expect(await contar(`select count(*) as n from treinamento.alternativa where trilha_id = $1`, [corpo.id])).toBe(4);
    });

    it('RF-TRE-01: editar o rascunho TROCA a árvore (sem nó órfão) e o updated_at da trilha sobe; publicada não é editada', async () => {
      const relogio = relogioDe('A');
      const id = uuid(801, CONF.A.conteudo);
      const m1 = uuid(802, CONF.A.conteudo);
      const l1 = uuid(803, CONF.A.conteudo);
      const l2 = uuid(804, CONF.A.conteudo);
      const m2 = uuid(805, CONF.A.conteudo);
      const base = { id, titulo: 'Rascunho para editar', modulos: [{ id: m1, ordem: 1, titulo: 'Módulo 1', licoes: [{ id: l1, ordem: 1, titulo: 'Lição 1', tipo: 'texto' as const, texto: 'a' }, { id: l2, ordem: 2, titulo: 'Lição 2', tipo: 'video' as const, midia_url: 'https://exemplo.test/v.mp4', duracao_estimada_seg: 60 }] }] };
      const c = await chamar<BkoTrilhaDetalhe>(api, 'POST', 'bko/trilhas', { ...como('A', PESSOAS.A.bko, relogio), corpo: base });
      expect(c.status).toBe(201);
      const nova = { id, titulo: 'Rascunho editado', obrigatoria: true, publico_alvo: { perfis: ['vendedor' as const], equipes: [] }, modulos: [{ id: m2, ordem: 1, titulo: 'Só um módulo novo', licoes: [{ id: l1, ordem: 1, titulo: 'Lição 1 revisada', tipo: 'texto' as const, texto: 'b' }] }] };
      const e = await chamar<BkoTrilhaDetalhe>(api, 'PUT', `bko/trilhas/${id}`, { ...como('A', PESSOAS.A.bko, relogio), corpo: nova });
      expect(e.status).toBe(200);
      expect(e.corpo.updated_at > c.corpo.updated_at).toBe(true);
      expect(e.corpo.created_at).toBe(c.corpo.created_at);
      const lida = await chamar<BkoTrilhaDetalhe>(api, 'GET', `bko/trilhas/${id}`, como('A', PESSOAS.A.bko, relogio));
      expect(lida.corpo).toMatchObject({ titulo: 'Rascunho editado', obrigatoria: true, publico_alvo: { perfis: ['vendedor'], equipes: [] } });
      expect(lida.corpo.modulos.map((m) => [m.id, m.licoes.map((l) => l.titulo)])).toEqual([[m2, ['Lição 1 revisada']]]);
      expect(await contar(`select count(*) as n from treinamento.modulo_trilha where trilha_id = $1`, [id])).toBe(1);
      expect(await contar(`select count(*) as n from treinamento.licao where trilha_id = $1`, [id])).toBe(1);

      expect((await chamar(api, 'POST', `bko/trilhas/${id}/publicar`, como('A', PESSOAS.A.bko, relogio))).status).toBe(200);
      const bloqueada = await chamar(api, 'PUT', `bko/trilhas/${id}`, { ...como('A', PESSOAS.A.bko, relogio), corpo: base });
      expect(bloqueada.status).toBe(422);
      expect((await chamar<BkoTrilhaDetalhe>(api, 'GET', `bko/trilhas/${id}`, como('A', PESSOAS.A.bko, relogio))).corpo.titulo).toBe('Rascunho editado');
    });

    it('RN-AUD-01: publicar e arquivar gravam a linha do tempo (trilha_publicacao); repetir a ação não grava linha nova', async () => {
      const relogio = relogioDe('A');
      const { corpo, publicada } = await criarEPublicar('A', PESSOAS.A.bko, relogio, unica('A', 701));
      void corpo;
      expect(publicada).toMatchObject({ status: 'publicada', publicada_em: relogio.iso() });
      const repetir = await chamar<BkoTrilhaDetalhe>(api, 'POST', `bko/trilhas/${publicada.id}/publicar`, como('A', PESSOAS.A.bko, relogio));
      expect(repetir.status).toBe(200);
      expect(repetir.corpo.updated_at).toBe(publicada.updated_at);
      const arq = await chamar<BkoTrilhaDetalhe>(api, 'POST', `bko/trilhas/${publicada.id}/arquivar`, como('A', PESSOAS.A.bko, relogio));
      expect(arq.corpo).toMatchObject({ status: 'arquivada', arquivada_em: relogio.iso() });
      await chamar(api, 'POST', `bko/trilhas/${publicada.id}/arquivar`, como('A', PESSOAS.A.bko, relogio));
      const linha = await admin.query(`select acao, de, para, autor_id, request_id, ocorrido_em from treinamento.trilha_publicacao where trilha_id = $1 order by created_at, id`, [publicada.id]);
      expect(linha.rows.map((r) => [r.acao, r.de, r.para, r.autor_id])).toEqual([
        ['publicar', 'rascunho', 'publicada', PESSOAS.A.bko.id],
        ['arquivar', 'publicada', 'arquivada', PESSOAS.A.bko.id],
      ]);
      expect(linha.rows[0]!.request_id).toBe('req-teste');
      expect((linha.rows[0]!.ocorrido_em as Date).toISOString()).toBe(relogio.iso());
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('pull com cursor (updated_at, id)', () => {
    it('ADR 0009: trilhasDesde pagina sem repetir nem pular (cursor em microssegundos) e respeita o horizonte `ate`', async () => {
      const relogio = relogioDe('A');
      for (const n of [610, 620, 630]) await criarEPublicar('A', PESSOAS.A.bko, relogio, unica('A', n * 10));
      const fabrica = criarFabricaPostgres();
      const doBanco = await comTenant(pool, A.tenantId, (c) => relogioDoBanco(c));
      const ate = doBanco.relativo({ minutos: 1 }).toISOString();
      const todas = await comTenant(pool, A.tenantId, (c) => fabrica.doTenant(c as unknown as ClienteBanco, A.tenantId, () => relogio.agora()).trilhasDesde({ desde: null, ate, limite: 1000 }));
      expect(todas.length).toBeGreaterThanOrEqual(3);
      const paginas: string[] = [];
      let desde: { updated_at: string; id: string } | null = null;
      for (let i = 0; i < todas.length + 2; i++) {
        const pagina = await comTenant(pool, A.tenantId, (c) => fabrica.doTenant(c as unknown as ClienteBanco, A.tenantId, () => relogio.agora()).trilhasDesde({ desde, ate, limite: 2 }));
        if (pagina.length === 0) break;
        paginas.push(...pagina.map((t) => t.id));
        const ultima = pagina[pagina.length - 1]!;
        desde = { updated_at: ultima.updated_at, id: ultima.id };
      }
      expect(paginas).toEqual(todas.map((t) => t.id));
      expect(new Set(paginas).size).toBe(paginas.length);
      const passado = await comTenant(pool, A.tenantId, (c) => fabrica.doTenant(c as unknown as ClienteBanco, A.tenantId, () => relogio.agora()).trilhasDesde({ desde: null, ate: doBanco.relativo({ dias: -30 }).toISOString(), limite: 1000 }));
      expect(passado).toEqual([]);
    });

    it('RN-TRE-07: o filtro do pull vale antes do limite (mais rascunhos que o limite não escondem as publicadas) e o cursor fica estável', async () => {
      const relogio = relogioDe('A');
      for (const n of [810, 820, 830, 840, 850]) {
        const r = await chamar(api, 'POST', 'bko/trilhas', { ...como('A', PESSOAS.A.bko, relogio), corpo: trilhaDe('A', unica('A', n)) });
        expect(r.status).toBe(201);
      }
      const publicadas: string[] = [];
      for (const n of [860, 870, 880]) publicadas.push((await criarEPublicar('A', PESSOAS.A.bko, relogio, unica('A', n))).corpo.id);
      const doBanco = await comTenant(pool, A.tenantId, (c) => relogioDoBanco(c));
      const ate = doBanco.relativo({ minutos: 1 }).toISOString();
      const ids: string[] = [];
      let desde: { updated_at: string; id: string } | null = null;
      for (let i = 0; i < 20; i++) {
        const pagina = await provedor('trilha').puxar!(contexto(como('A', PESSOAS.A.aluna, relogio)) as ContextoBase, { desde, ate, limite: 2 });
        expect(pagina.length).toBeLessThanOrEqual(2);
        if (pagina.length === 0) break;
        ids.push(...pagina.map((l) => l.id));
        const ultima = pagina[pagina.length - 1]!;
        desde = { updated_at: ultima.updated_at, id: ultima.id };
      }
      for (const id of publicadas) expect(ids).toContain(id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('RN-TRE-07: o aluno baixa só trilha publicada do próprio tenant; rascunho não desce; B nunca vê o conteúdo de A', async () => {
      const relogio = relogioDe('A');
      const rascunho = trilhaDe('A', { id: uuid(501, CONF.A.conteudo), modulos: [] });
      await chamar(api, 'POST', 'bko/trilhas', { ...como('A', PESSOAS.A.bko, relogio), corpo: rascunho });
      const { corpo: publicadaA } = await criarEPublicar('A', PESSOAS.A.bko, relogio, unica('A', 510));
      const vera = await pull('A', PESSOAS.A.aluna, 'trilha', relogio);
      const idsVera = vera.map((l) => l.id);
      expect(idsVera).toContain(publicadaA.id);
      expect(idsVera).not.toContain(rascunho.id);
      for (const l of vera) expect(TrilhaSyncLinha.parse(l).tenant_id).toBe(A.tenantId);
      const beto = await pull('B', PESSOAS.B.aluno, 'trilha', relogioDe('B'));
      expect(beto.map((l) => l.id)).not.toContain(publicadaA.id);
      for (const l of beto) expect((l as unknown as { tenant_id: string }).tenant_id).toBe(B.tenantId);
      expect((await pull('A', PESSOAS.A.bko, 'trilha', relogio))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('idempotência do progresso, do XP e das medalhas (RN-TRE-01/04/06)', () => {
    it('o lote fora de ordem é aceito e gravado; reenviar o MESMO lote não cria linha nem soma XP; o evento sai uma vez só', async () => {
      const relogio = relogioDe('A');
      const aluna = PESSOAS.A.aluna;
      await criarEPublicar('A', PESSOAS.A.bko, relogio);
      const eventosAntes = registro.eventos.length;
      const atividades = lote('A', relogio);
      const r1 = await push('A', aluna, relogio, [atividades[2]!, atividades[1]!, atividades[0]!]);
      expect(r1.map((r) => r.status)).toEqual(['aceito', 'aceito', 'aceito']);
      const depois = { progresso: await linhasDo('progresso', aluna.id), tentativa: await linhasDo('tentativa', aluna.id), xp: await linhasDo('xp_lancamento', aluna.id), medalhas: await linhasDo('medalha_usuario', aluna.id), saldo: await xpDo(aluna.id) };
      expect(depois).toMatchObject({ progresso: 2, tentativa: 1 });
      expect(depois.saldo).toBeGreaterThan(0);
      expect(depois.medalhas).toBeGreaterThanOrEqual(1);
      const eventosDoLote = registro.eventos.slice(eventosAntes);
      expect(eventosDoLote.filter((e) => e.nome === EVENTO_LICAO_CONCLUIDA)).toHaveLength(2);

      const r2 = await push('A', aluna, relogio, atividades);
      expect(r2.map((r) => r.status)).toEqual(['aceito', 'aceito', 'aceito']);
      expect({ progresso: await linhasDo('progresso', aluna.id), tentativa: await linhasDo('tentativa', aluna.id), xp: await linhasDo('xp_lancamento', aluna.id), medalhas: await linhasDo('medalha_usuario', aluna.id), saldo: await xpDo(aluna.id) }).toEqual(depois);
      expect(registro.eventos.slice(eventosAntes)).toHaveLength(eventosDoLote.length);
      expect(registro.eventos.slice(eventosAntes).filter((e) => e.nome === EVENTO_MEDALHA_CONQUISTADA).length).toBe(depois.medalhas);
    });

    it('dois envios IGUAIS ao mesmo tempo (corrida): a trava por aluno serializa e o resultado é o de um só', async () => {
      const relogio = relogioDe('A', '12:00', -2);
      const aluna = PESSOAS.A.aluna2; // promotora
      const ids = idsDe('A');
      const trilhaId = uuid(401, CONF.A.conteudo);
      const licaoId = uuid(402, CONF.A.conteudo);
      await criarEPublicar('A', PESSOAS.A.bko, relogio, { id: trilhaId, modulos: [{ id: uuid(403, CONF.A.conteudo), ordem: 1, titulo: 'M', licoes: [{ id: licaoId, ordem: 1, titulo: 'Única', tipo: 'texto', texto: 'x' }] }] });
      void ids;
      const envio = AtividadeEnvio.parse({ tipo: 'licao', id: idAtv('A', 40), trilha_id: trilhaId, licao_id: licaoId, concluida_em: relogio.relativo({ minutos: -5 }).toISOString(), tempo_gasto_seg: 60 });
      const eventosAntes = registro.eventos.length;
      const [r1, r2] = await Promise.all([push('A', aluna, relogio, [envio]), push('A', aluna, relogio, [envio])]);
      expect([r1[0]!.status, r2[0]!.status]).toEqual(['aceito', 'aceito']);
      expect(await contar(`select count(*) as n from treinamento.progresso where usuario_id = $1 and licao_id = $2`, [aluna.id, licaoId])).toBe(1);
      expect(await contar(`select count(*) as n from treinamento.xp_lancamento where usuario_id = $1 and origem = 'licao' and referencia_id = $2`, [aluna.id, licaoId])).toBe(1);
      expect(registro.eventos.slice(eventosAntes).filter((e) => e.nome === EVENTO_LICAO_CONCLUIDA)).toHaveLength(1);
    });

    it('no SQL: gravar de novo a mesma chave natural com OUTRO id é "do nothing" (progresso, XP, medalha); só a tentativa nova entra', async () => {
      const fabrica = criarFabricaPostgres();
      const usuario = uuid(77, '0b0000aa');
      const licao = uuid(78, '0b0000aa');
      const agora = relogioDe('A').agora();
      const efeitos = (n: number) => ({
        conclusao: { id: uuid(100 + n, '0c0000aa'), trilha_id: uuid(79, '0b0000aa'), licao_id: licao, tempo_gasto_seg: 40, concluida_em: agora.toISOString() },
        tentativa: { id: uuid(200 + n, '0c0000aa'), quiz_id: uuid(80, '0b0000aa'), realizada_em: agora.toISOString(), respostas: [{ questao_id: uuid(81, '0b0000aa'), alternativa_ids: [uuid(82, '0b0000aa')] }], acertos: 1, total_questoes: 3, nota_pct: 33.33, aprovada: false, primeira_tentativa: true, finalizada: true },
        lancamentos: [{ id: uuid(300 + n, '0c0000aa'), tenant_id: A.tenantId, usuario_id: usuario, origem: 'licao' as const, referencia_id: licao, pontos: 10, pontos_base: 10, limitado_pelo_teto: false, ocorrido_em: agora.toISOString(), dia: localIsoDate(agora, A.fuso) }],
        conquistas: [{ id: uuid(400 + n, '0c0000aa'), medalha_codigo: 'primeira_trilha', conquistada_em: agora.toISOString() }],
      });
      const gravar = (n: number) => comTenant(pool, A.tenantId, (c) => fabrica.doTenant(c as unknown as ClienteBanco, A.tenantId, () => agora).gravarAtividade(usuario, efeitos(n)));
      await gravar(1);
      await gravar(2);
      await gravar(1);
      expect({ progresso: await linhasDo('progresso', usuario), xp: await linhasDo('xp_lancamento', usuario), medalhas: await linhasDo('medalha_usuario', usuario), saldo: await xpDo(usuario) }).toEqual({ progresso: 1, xp: 1, medalhas: 1, saldo: 10 });
      expect(await linhasDo('tentativa', usuario)).toBe(2); // tentativa é por id do aparelho: 1 e 2 (a repetida de 1 não entra)
      const estado = await comTenant(pool, A.tenantId, (c) => fabrica.doTenant(c as unknown as ClienteBanco, A.tenantId, () => agora).estadoDoAluno(usuario));
      expect(estado.tentativas.map((t) => [t.nota_pct, t.respostas[0]!.alternativa_ids])).toEqual([[33.33, [uuid(82, '0b0000aa')]], [33.33, [uuid(82, '0b0000aa')]]]);
      expect(estado.lancamentos[0]).toMatchObject({ dia: localIsoDate(agora, A.fuso), pontos: 10, tenant_id: A.tenantId, usuario_id: usuario });
      expect(estado.conclusoes[0]!.concluida_em).toBe(agora.toISOString());
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('dados do aluno: só leitura e inserção', () => {
    for (const tabela of ['progresso', 'tentativa', 'xp_lancamento', 'medalha_usuario', 'trilha_publicacao']) {
      it(`RN-TRE-04: o papel da aplicação não consegue UPDATE nem DELETE em treinamento.${tabela} (42501)`, async () => {
        await expect(comTenant(pool, A.tenantId, (c) => c.query(`update treinamento.${tabela} set updated_at = now()`))).rejects.toMatchObject({ code: '42501' });
        await expect(comTenant(pool, A.tenantId, (c) => c.query(`delete from treinamento.${tabela}`))).rejects.toMatchObject({ code: '42501' });
      });
    }

    it('RN-TRE-02: tentativa com nota fora de 0–100 ou acertos maiores que o total é barrada pelo banco', async () => {
      const base = [uuid(1, '0c0000cc'), A.tenantId, A.usuarios.vendedor2, uuid(2, '0c0000cc'), relogioDe('A').iso()];
      await expect(
        comTenant(pool, A.tenantId, (c) => c.query(`insert into treinamento.tentativa (id, tenant_id, usuario_id, quiz_id, realizada_em, acertos, total_questoes, nota_pct, aprovada, primeira_tentativa) values ($1,$2,$3,$4,$5, 5, 3, 100, true, true)`, base)),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('ranking calculado a partir dos lançamentos do tenant (RF-TRE-04, RN-TRE-03)', () => {
    it('o ranking do tenant A só tem gente de A, com os pontos dos lançamentos; o de B só gente de B', async () => {
      const relogioA = relogioDe('A');
      const relogioB = relogioDe('B');
      const aluna = PESSOAS.A.aluna;
      const aluno = PESSOAS.B.aluno;
      // as duas jornadas (idempotentes): criar/publicar/enviar de novo não muda nada se o teste anterior já rodou
      await criarEPublicar('A', PESSOAS.A.bko, relogioA);
      expect((await push('A', aluna, relogioA, lote('A', relogioA))).map((r) => r.status)).toEqual(['aceito', 'aceito', 'aceito']);
      await criarEPublicar('B', PESSOAS.B.bko, relogioB);
      const idsB = idsDe('B');
      const tB = (min: number) => relogioB.relativo({ minutos: min - 30 }).toISOString();
      const rB = await push('B', aluno, relogioB, [renomear(licaoEnvio(idAtv('B', 1), idsB.l1, tB(0)), CONF.B.conteudo), renomear(quizEnvio(idAtv('B', 2), tB(10)), CONF.B.conteudo), renomear(licaoEnvio(idAtv('B', 3), idsB.l2, tB(20)), CONF.B.conteudo)]);
      expect(rB.map((r) => r.status)).toEqual(['aceito', 'aceito', 'aceito']);
      const saldoA = await xpDo(aluna.id);
      const saldoB = await xpDo(aluno.id);
      expect(saldoA).toBeGreaterThan(0);
      expect(saldoB).toBeGreaterThan(0);

      const rankA = await chamar<RankingResposta>(api, 'GET', 'ranking', { ...como('A', aluna, relogioA), query: { periodo: 'acumulado' } });
      expect(rankA.status).toBe(200);
      const parseA = RankingResposta.parse(rankA.corpo);
      expect(parseA.linhas.map((l) => l.usuario_id)).toContain(aluna.id);
      expect(parseA.linhas.map((l) => l.usuario_id)).not.toContain(aluno.id);
      expect(parseA.minha_linha).toMatchObject({ usuario_id: aluna.id, pontos: saldoA });

      const rankB = RankingResposta.parse((await chamar<RankingResposta>(api, 'GET', 'ranking', { ...como('B', aluno, relogioB), query: { periodo: 'acumulado' } })).corpo);
      expect(rankB.linhas.map((l) => l.usuario_id)).toContain(aluno.id);
      expect(rankB.linhas.map((l) => l.usuario_id)).not.toContain(aluna.id);
      expect(rankB.minha_linha).toMatchObject({ usuario_id: aluno.id, pontos: saldoB });
    });

    it('a leitura do tenant (lançamentos, conclusões, tentativas) traz só linhas do próprio tenant', async () => {
      const fabrica = criarFabricaPostgres();
      for (const lado of ['A', 'B'] as const) {
        const repo = (c: pg.PoolClient) => fabrica.doTenant(c as unknown as ClienteBanco, CONF[lado].tenant, () => new Date());
        const [lanc, conc, tent] = await comTenant(pool, CONF[lado].tenant, async (c) => [await repo(c).lancamentosDoTenant(), await repo(c).conclusoesDoTenant(), await repo(c).tentativasDoTenant()] as const);
        expect(lanc.length).toBeGreaterThan(0);
        for (const l of lanc) expect(l.tenant_id).toBe(CONF[lado].tenant);
        const doOutro = lado === 'A' ? PESSOAS.B.aluno.id : PESSOAS.A.aluna.id;
        expect(lanc.some((l) => l.usuario_id === doOutro)).toBe(false);
        expect(conc.some((x) => x.usuario_id === doOutro)).toBe(false);
        expect(tent.some((x) => x.usuario_id === doOutro)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('dia civil no fuso do tenant (RN-CORE-11)', () => {
    it('o mesmo instante cai em dias civis diferentes em Manaus (A) e São Paulo (B): `dia` do XP segue o fuso do tenant', async () => {
      // 23:30 em Manaus = 00:30 do dia seguinte em São Paulo
      const manaus = criarRelogio({ fuso: A.fuso });
      const instante = manaus.instante({ dias: -3, hora: '23:30' });
      const agoraA = criarRelogio({ agora: new Date(instante.getTime() + 5 * 60_000), fuso: A.fuso });
      const agoraB = criarRelogio({ agora: new Date(instante.getTime() + 5 * 60_000), fuso: B.fuso });
      const diaA = localIsoDate(instante, A.fuso);
      const diaB = localIsoDate(instante, B.fuso);
      expect(diaB).not.toBe(diaA);

      for (const [lado, bko, aluno, agora, n] of [
        ['A', PESSOAS.A.bko, PESSOAS.A.aluna2, agoraA, 301],
        ['B', PESSOAS.B.bko, PESSOAS.B.aluno, agoraB, 301],
      ] as const) {
        const t = unica(lado, n);
        await criarEPublicar(lado, bko, agora, t);
        const r = await push(lado, aluno, agora, [AtividadeEnvio.parse({ tipo: 'licao', id: idAtv(lado, 60), trilha_id: t.id, licao_id: t.modulos[0]!.licoes[0]!.id, concluida_em: instante.toISOString(), tempo_gasto_seg: 60 })]);
        expect(r[0]!.status, lado).toBe('aceito');
      }
      const diaGravado = async (usuario: string, licao: string) => (await admin.query<{ dia: string }>(`select dia::text from treinamento.xp_lancamento where usuario_id = $1 and origem = 'licao' and referencia_id = $2`, [usuario, licao])).rows[0]!.dia;
      expect(await diaGravado(PESSOAS.A.aluna2.id, uuid(303, CONF.A.conteudo))).toBe(diaA);
      expect(await diaGravado(PESSOAS.B.aluno.id, uuid(303, CONF.B.conteudo))).toBe(diaB);
      const linha = XpLancamentoSyncLinha.parse((await pull('B', PESSOAS.B.aluno, 'xp_lancamento', agoraB)).find((l) => (l as unknown as { referencia_id: string }).referencia_id === uuid(303, CONF.B.conteudo)));
      expect(linha.dia).toBe(diaB);
      expect(linha.ocorrido_em).toBe(instante.toISOString());
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('isolamento entre tenants (RLS)', () => {
    it('o tenant B não lê nem grava trilha de A: GET e PUT dão 404; o banco recusa linha com tenant_id de outro (42501)', async () => {
      const relogioB = relogioDe('B');
      const idDeA = uuid(902, CONF.A.conteudo);
      const criada = await chamar(api, 'POST', 'bko/trilhas', { ...como('A', PESSOAS.A.bko, relogioB), corpo: trilhaDe('A', { id: idDeA, modulos: [] }) });
      expect(criada.status).toBe(201);
      expect((await chamar(api, 'GET', `bko/trilhas/${idDeA}`, como('B', PESSOAS.B.bko, relogioB))).status).toBe(404);
      expect((await chamar(api, 'PUT', `bko/trilhas/${idDeA}`, { ...como('B', PESSOAS.B.bko, relogioB), corpo: { ...trilhaDe('A', { id: idDeA, modulos: [] }) } })).status).toBe(404);
      expect((await chamar(api, 'POST', `bko/trilhas/${idDeA}/publicar`, como('B', PESSOAS.B.bko, relogioB))).status).toBe(404);
      const lista = await chamar<{ itens: { id: string }[] }>(api, 'GET', 'bko/trilhas', como('B', PESSOAS.B.bko, relogioB));
      expect(lista.corpo.itens.map((i) => i.id)).not.toContain(idDeA);

      await expect(
        comTenant(pool, B.tenantId, (c) => c.query(`insert into treinamento.trilha (id, tenant_id, titulo) values ($1, $2, 'Invasora')`, [uuid(1, '1a0000ee'), A.tenantId])),
      ).rejects.toMatchObject({ code: '42501' });
      const fabrica = criarFabricaPostgres();
      await expect(
        comTenant(pool, B.tenantId, (c) => fabrica.doTenant(c as unknown as ClienteBanco, B.tenantId, () => new Date()).atualizarTrilha({ ...TrilhaEdicao.parse(trilhaDe('A', { id: idDeA, modulos: [] })), tenant_id: B.tenantId, status: 'rascunho', publicada_em: null, arquivada_em: null, created_at: relogioB.iso(), updated_at: relogioB.iso() })),
      ).rejects.toThrow(/inexistente/);
    });

    it('o tenant B não lê nem grava progresso de A: o pull, o estado e o ranking de B não enxergam o aluno de A; escrever como A em B é barrado', async () => {
      const aluna = PESSOAS.A.aluna;
      const fabrica = criarFabricaPostgres();
      const doB = (c: pg.PoolClient) => fabrica.doTenant(c as unknown as ClienteBanco, B.tenantId, () => new Date());
      const estado = await comTenant(pool, B.tenantId, (c) => doB(c).estadoDoAluno(aluna.id));
      expect(estado).toEqual({ conclusoes: [], tentativas: [], lancamentos: [], conquistas: [] });
      for (const e of ['progresso', 'tentativa', 'xp_lancamento', 'medalha_usuario'] as const) {
        const linhas = await comTenant(pool, B.tenantId, (c) => doB(c).linhasDoAluno(e, aluna.id, { desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1000 }));
        expect(linhas, e).toEqual([]);
      }
      // gravar progresso "de A" numa transação de B: o tenant_id do repositório é o da transação (B) — nunca o de A
      const usuario = uuid(99, '0b0000bb');
      await comTenant(pool, B.tenantId, (c) => doB(c).gravarAtividade(usuario, { conclusao: { id: uuid(1, '0c0000bb'), trilha_id: uuid(2, '0c0000bb'), licao_id: uuid(3, '0c0000bb'), tempo_gasto_seg: 31, concluida_em: relogioDe('B').iso() }, tentativa: null, lancamentos: [], conquistas: [] }));
      expect((await admin.query<{ tenant_id: string }>(`select tenant_id from treinamento.progresso where usuario_id = $1`, [usuario])).rows.map((r) => r.tenant_id)).toEqual([B.tenantId]);
      await expect(comTenant(pool, A.tenantId, (c) => c.query(`select 1 from treinamento.progresso where usuario_id = $1`, [usuario]).then((r) => r.rowCount))).resolves.toBe(0);
      await expect(
        comTenant(pool, B.tenantId, (c) => c.query(`insert into treinamento.progresso (id, tenant_id, usuario_id, trilha_id, licao_id, concluida_em) values ($1, $2, $3, $4, $5, now())`, [uuid(5, '0c0000bb'), A.tenantId, usuario, uuid(2, '0c0000bb'), uuid(6, '0c0000bb')])),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
