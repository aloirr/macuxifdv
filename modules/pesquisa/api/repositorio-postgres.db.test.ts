/**
 * API da Pesquisa × Postgres real (T-0057, migração 0016): fixture dois-tenants, papel macuxi_app, RLS. Usa a API de
 * produção (`moduloApi`, repositório Postgres) pelas rotas e pelo sync, como o `createApp` faz depois das checagens de
 * perfil/licença. Cobre: isolamento entre tenants (RN-CORE-05), versão publicada imutável (RN-PES-01) pela API e pelo
 * banco, idempotência do push de respostas e de fotos (RF-PES-04), conflito de conteúdo, arquivar tocando as versões
 * (RF-PES-05), pull com cursor de microssegundos e escopo de carteira (RN-CORE-04), resultados e galeria por SQL.
 * Sem hora fixa: o "agora" da API é o instante da fixture (`agoraDaFixture()`); os horizontes do pull vêm do relógio do
 * banco. `tx.publicar`/`tx.auditar` são simulados aqui (a versão real é do apps/api); `tx.registrarArquivo` grava a
 * linha do arquivo com a mesma regra da real (testes/arquivo-plataforma.ts: idempotente pelo id, 409 se a foto é de outro registro).
 * Pula sem Postgres/Docker (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { relogioDoBanco } from '@macuxi/comum/relogio';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { agoraDaFixture, banco, semBanco } from '@macuxi/db/teste/estado';
import {
  CODIGOS_ARQUIVO,
  type ClienteBanco,
  type ContextoBase,
  type ItemPush,
  type LinhaSync,
  type Perfil,
  type ResultadoItemPush,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contarArquivos, lerArquivo, registrarArquivoSimulado, type NovoArquivoDeTeste } from '../testes/arquivo-plataforma';
import {
  ExportacaoResponse,
  Galeria,
  ListaQuestionarios,
  ListaRespostas,
  PublicarResponse,
  QuestionarioDetalhe,
  QuestionarioVersaoSync,
  RespostaPesquisaSync,
  ResultadoResponse,
  type RespostaEnvio,
} from '../contracts';
import { criarApiPesquisa, criarRepositorioPostgres, moduloApi } from './index';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0f570000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// perguntas e opções (nove tipos)
const P = { simNao: id(101), unica: id(102), multipla: id(103), numero: id(104), texto: id(105), escala: id(106), data: id(107), foto: id(108), codigo: id(109) };
const OP = { boa: id(201), ruim: id(202), cafe: id(203), arroz: id(204) };
const PERGUNTAS = [
  { id: P.simNao, tipo: 'sim_nao', enunciado: 'Tem o produto na gôndola?', obrigatoria: false },
  { id: P.unica, tipo: 'unica', enunciado: 'Exposição', obrigatoria: false, opcoes: [{ id: OP.boa, rotulo: 'Boa' }, { id: OP.ruim, rotulo: 'Ruim' }] },
  { id: P.multipla, tipo: 'multipla', enunciado: 'Quais faltam?', obrigatoria: false, opcoes: [{ id: OP.cafe, rotulo: 'Café' }, { id: OP.arroz, rotulo: 'Arroz' }] },
  { id: P.numero, tipo: 'numero', enunciado: 'Frentes', obrigatoria: false },
  { id: P.texto, tipo: 'texto', enunciado: 'Observação', obrigatoria: false },
  { id: P.escala, tipo: 'escala', enunciado: 'Nota da loja', obrigatoria: false, minimo: 1, maximo: 5 },
  { id: P.data, tipo: 'data', enunciado: 'Validade mais próxima', obrigatoria: false },
  { id: P.foto, tipo: 'foto', enunciado: 'Foto da gôndola', obrigatoria: false, min_fotos: 1, max_fotos: 3 },
  { id: P.codigo, tipo: 'codigo_barras', enunciado: 'Código do produto', obrigatoria: false },
];

// questionários do teste (um por assunto; as ids de resposta/foto são por teste)
const Q = { ciclo: id(1), idem: id(2), arquivar: id(3), pull1: id(4), pull2: id(5), pull3: id(6), resp: id(7), escopo: id(8), edicao: id(9), b: id(10) };

describe.skipIf(semBanco())('Pesquisa × Postgres: repositório SQL, RLS, imutabilidade e idempotência', () => {
  let pool: pg.Pool;
  let AGORA!: Date;
  let ATE!: string;
  const eventos: Array<{ nome: string; payload: unknown; agregado: string | null | undefined }> = [];
  const auditorias: Array<{ acao: string; entidade: string; entidade_id: string | null | undefined }> = [];

  const em = (deslocamentoMs: number) => new Date(AGORA.getTime() + deslocamentoMs).toISOString();
  const MIN = 60_000;
  const DIA = 86_400_000;

  const U = {
    analista: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' as Perfil },
    vendedor1: { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' as Perfil },
    vendedor2: { id: A.usuarios.vendedor2, tenant_id: A.tenantId, perfil: 'vendedor' as Perfil },
    adminB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' as Perfil },
    vendedorB: { id: B.usuarios.vendedor, tenant_id: B.tenantId, perfil: 'vendedor' as Perfil },
  };
  type Usuario = (typeof U)[keyof typeof U];

  function ctx(u: Usuario, o: { carteira?: ReadonlySet<string> | 'tenant' } = {}): ContextoBase {
    const tx = (c: pg.ClientBase): TransacaoTenant =>
      ({
        publicar: async (def: { nome: string }, payload: unknown, agregado?: string | null) => {
          eventos.push({ nome: def.nome, payload, agregado });
          return {};
        },
        auditar: async (r: { acao: string; entidade: string; entidade_id?: string | null }) => {
          auditorias.push({ acao: r.acao, entidade: r.entidade, entidade_id: r.entidade_id });
        },
        registrarArquivo: (a: NovoArquivoDeTeste) => registrarArquivoSimulado(c, u.id, a),
        consultar: async () => {
          throw new Error('sem consultas na Pesquisa');
        },
      }) as unknown as TransacaoTenant;
    const carteira = o.carteira ?? 'tenant';
    return {
      usuario: { ...u, modulos: ['core', 'pesquisa'] },
      dependencias: {},
      requestId: 'req-teste',
      agora: () => AGORA,
      fuso: () => 'America/Manaus',
      parametros: () => ({}),
      carteira: async () => carteira,
      usuariosVisiveis: async () => (['analista', 'admin', 'assistente'].includes(u.perfil) ? 'tenant' : new Set([u.id])),
      comTenant: <T>(fn: (db: ClienteBanco, t: TransacaoTenant) => Promise<T>) => comTenant(pool, u.tenant_id, (c) => fn(c as unknown as ClienteBanco, tx(c))),
      log: { info() {}, warn() {}, error() {} },
    } as unknown as ContextoBase;
  }

  const rota = (metodo: string, caminho: string) => {
    const r = moduloApi.rotas?.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho} não existe`);
    return r;
  };
  /** Executa como o `createApp` faria depois das checagens (corpo/query/params passam pelo Zod da rota). */
  const chamar = async <T = unknown>(c: ContextoBase, metodo: string, caminho: string, e: { corpo?: unknown; query?: unknown; params?: unknown } = {}): Promise<T> => {
    const r = rota(metodo, caminho);
    const corpo = r.corpo ? r.corpo.parse(e.corpo ?? {}) : (e.corpo ?? {});
    const query = r.query ? r.query.parse(e.query ?? {}) : (e.query ?? {});
    const params = r.params ? r.params.parse(e.params ?? {}) : (e.params ?? {});
    return (await r.executar({ ...c, corpo, query, params } as never)) as T;
  };
  const prov = (nome: string) => {
    const p = moduloApi.sync?.find((s) => s.entidade.nome === nome);
    if (!p) throw new Error(`sem provedor ${nome}`);
    return p;
  };
  const push = (c: ContextoBase, ...envios: RespostaEnvio[]): Promise<ResultadoItemPush[]> =>
    prov('resposta_pesquisa').receber!(c, envios.map((e): ItemPush => ({ entidade: 'resposta_pesquisa', id: e.id, operacao: 'upsert', payload: e })));
  const puxar = (nome: string, c: ContextoBase, o: { desde?: { updated_at: string; id: string } | null; limite?: number; ate?: string } = {}): Promise<LinhaSync[]> =>
    prov(nome).puxar!(c, { desde: o.desde ?? null, ate: o.ate ?? ATE, limite: o.limite ?? 1000 });

  const contar = (tenant: string, sql: string, valores: unknown[] = []) => comTenant(pool, tenant, async (c) => Number((await c.query(sql, valores)).rows[0].n));
  const linhas = <R = Record<string, unknown>>(tenant: string, sql: string, valores: unknown[] = []) => comTenant(pool, tenant, async (c) => (await c.query(sql, valores)).rows as R[]);

  /** Cria, preenche (nove tipos) e publica a v1 do questionário `qid` no tenant A (vigência desde ontem). */
  async function publicarV1(qid: string, titulo = 'Exposição do teste', u: Usuario = U.analista) {
    const c = ctx(u);
    await chamar(c, 'POST', 'questionarios', { corpo: { id: qid, titulo } });
    await chamar(c, 'PUT', 'questionarios/:id/rascunho', { params: { id: qid }, corpo: { perguntas: PERGUNTAS, vigencia: { inicio: em(-DIA), fim: null } } });
    return PublicarResponse.parse(await chamar(c, 'POST', 'questionarios/:id/publicar', { params: { id: qid } }));
  }

  const itensCompletos = (foto: string): RespostaEnvio['itens'] => [
    { pergunta_id: P.simNao, tipo: 'sim_nao', valor: true },
    { pergunta_id: P.unica, tipo: 'unica', opcao_id: OP.boa },
    { pergunta_id: P.multipla, tipo: 'multipla', opcao_ids: [OP.cafe, OP.arroz] },
    { pergunta_id: P.numero, tipo: 'numero', numero: 12.5 },
    { pergunta_id: P.texto, tipo: 'texto', texto: 'Gôndola organizada' },
    { pergunta_id: P.escala, tipo: 'escala', valor: 4 },
    { pergunta_id: P.data, tipo: 'data', data: '2027-06-30' },
    { pergunta_id: P.foto, tipo: 'foto', fotos: [{ id: foto, referencia: foto, capturada_em: em(-11 * MIN), largura_px: 1600, altura_px: 1200 }] },
    { pergunta_id: P.codigo, tipo: 'codigo_barras', codigo: '7891234567895' },
  ];
  const envio = (qid: string, versao: string, rid: string, foto: string, extra: Partial<RespostaEnvio> = {}): RespostaEnvio => ({
    id: rid,
    questionario_id: qid,
    versao_id: versao,
    cliente_id: A.clientes.c1,
    visita_id: null,
    respondida_em: em(-10 * MIN),
    itens: itensCompletos(foto),
    ...extra,
  });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    AGORA = agoraDaFixture();
    // horizonte do pull = relógio do banco (updated_at/created_at vêm do servidor) + 1 dia
    ATE = (await relogioDoBanco(pool)).relativo({ dias: 1 }).toISOString();
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe('ligação: a API em produção usa o Postgres', () => {
    it('moduloApi (a que o apps/api carrega) grava no schema pesquisa e lê de volta pelo contrato', async () => {
      const pub = await publicarV1(Q.ciclo, 'Ciclo completo');
      expect(pub.versao).toMatchObject({ numero: 1, status: 'publicada', publicada_por: U.analista.id, titulo: 'Ciclo completo' });
      const q = await linhas(A.tenantId, 'select tenant_id, arquivado_em from pesquisa.questionario where id = $1', [Q.ciclo]);
      expect(q).toEqual([{ tenant_id: A.tenantId, arquivado_em: null }]);
      const v = await linhas(A.tenantId, 'select status, numero, jsonb_array_length(perguntas) as n, publicada_por from pesquisa.questionario_versao where questionario_id = $1', [Q.ciclo]);
      expect(v).toEqual([{ status: 'publicada', numero: 1, n: 9, publicada_por: U.analista.id }]);
      const d = QuestionarioDetalhe.parse(await chamar(ctx(U.analista), 'GET', 'questionarios/:id', { params: { id: Q.ciclo } }));
      expect(d.versoes).toHaveLength(1);
      expect(d.versoes[0]).toEqual(pub.versao);
      expect(d.respostas).toBe(0);
    });

    it('RN-AUD-01: criar e publicar auditam na mesma transação (acao, entidade e id)', () => {
      const doCiclo = auditorias.filter((a) => a.entidade_id === Q.ciclo || a.acao === 'questionario.publicar');
      expect(doCiclo.map((a) => a.acao)).toEqual(expect.arrayContaining(['questionario.criar', 'questionario.publicar']));
    });

    it('RF-PES-01: criar com o mesmo id devolve o que já existe (1 questionário, 1 versão)', async () => {
      const c = ctx(U.analista);
      const antes = auditorias.length;
      const d = QuestionarioDetalhe.parse(await chamar(c, 'POST', 'questionarios', { corpo: { id: Q.ciclo, titulo: 'Outro nome' } }));
      expect(d.versoes[0]!.titulo).toBe('Ciclo completo');
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.questionario where id = $1', [Q.ciclo])).toBe(1);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.questionario_versao where questionario_id = $1', [Q.ciclo])).toBe(1);
      expect(auditorias.length).toBe(antes);
    });
  });

  describe('RN-CORE-05: isolamento entre tenants (RLS)', () => {
    it('A e B listam só os próprios questionários (a fixture traz um conjunto em cada tenant)', async () => {
      const a = ListaQuestionarios.parse(await chamar(ctx(U.analista), 'GET', 'questionarios')).itens.map((i) => i.titulo);
      expect(a).toEqual(expect.arrayContaining(['Exposição na loja', 'Satisfação no checkout', 'Ciclo completo']));
      expect(a).not.toContain('Avulsa do tenant B');
      const b = ListaQuestionarios.parse(await chamar(ctx(U.adminB), 'GET', 'questionarios')).itens.map((i) => i.titulo);
      expect(b).toContain('Avulsa do tenant B');
      for (const t of ['Exposição na loja', 'Satisfação no checkout', 'Ciclo completo']) expect(b).not.toContain(t);
    });

    it('B não vê (404), não edita, não publica e não arquiva o questionário de A; nada muda no banco', async () => {
      const c = ctx(U.adminB);
      const estado = () => linhas(A.tenantId, `select q.arquivado_em, q.updated_at, v.titulo, v.status, v.updated_at as v_updated from pesquisa.questionario q join pesquisa.questionario_versao v on v.questionario_id = q.id where q.id = $1`, [Q.ciclo]);
      const antes = await estado();
      await expect(chamar(c, 'GET', 'questionarios/:id', { params: { id: Q.ciclo } })).rejects.toMatchObject({ status: 404, codigo: 'QUESTIONARIO_NAO_ENCONTRADO' });
      await expect(chamar(c, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.ciclo }, corpo: { titulo: 'invasão' } })).rejects.toMatchObject({ status: 404 });
      await expect(chamar(c, 'POST', 'questionarios/:id/publicar', { params: { id: Q.ciclo } })).rejects.toMatchObject({ status: 404 });
      await expect(chamar(c, 'POST', 'questionarios/:id/arquivar', { params: { id: Q.ciclo } })).rejects.toMatchObject({ status: 404 });
      await expect(chamar(c, 'GET', 'questionarios/:id/resultado', { params: { id: Q.ciclo } })).rejects.toMatchObject({ status: 404 });
      expect(await estado()).toEqual(antes);
    });

    it('SQL direto no contexto de B não enxerga nem altera as linhas de A (a política filtra e o UPDATE afeta 0 linhas)', async () => {
      const r = await comTenant(pool, B.tenantId, async (c) => ({
        q: (await c.query('select id from pesquisa.questionario where id = $1', [Q.ciclo])).rowCount,
        v: (await c.query('select id from pesquisa.questionario_versao where questionario_id = $1', [Q.ciclo])).rowCount,
        alterou: (await c.query('update pesquisa.questionario set arquivado_em = criado_em where id = $1', [Q.ciclo])).rowCount,
      }));
      expect(r).toEqual({ q: 0, v: 0, alterou: 0 });
    });

    it('B não grava resposta "em nome" de A: o repositório de A dentro da transação de B é recusado pela RLS (42501)', async () => {
      const [v1] = (await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1', [Q.ciclo]));
      const resposta = envio(Q.ciclo, v1!.id, id(900), id(901));
      const completa = { ...resposta, tenant_id: A.tenantId, usuario_id: U.vendedorB.id, equipe_id: null, recebida_em: AGORA.toISOString(), suspeita: false, motivos_suspeita: [] as [] };
      await expect(comTenant(pool, B.tenantId, (c) => criarRepositorioPostgres()(A.tenantId, c as unknown as ClienteBanco).inserirResposta(completa, AGORA.toISOString()))).rejects.toMatchObject({ code: '42501' });
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where id = $1', [id(900)])).toBe(0);
    });

    it('push de B citando o questionário de A é rejeitado (QUESTIONARIO_INEXISTENTE) e não grava nada', async () => {
      const [v1] = (await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1', [Q.ciclo]));
      const r = await push(ctx(U.vendedorB), envio(Q.ciclo, v1!.id, id(902), id(903), { cliente_id: B.clientes.c1 }));
      expect(r).toEqual([expect.objectContaining({ id: id(902), status: 'rejeitado', codigo: 'QUESTIONARIO_INEXISTENTE' })]);
      for (const t of [A.tenantId, B.tenantId]) expect(await contar(t, 'select count(*) as n from pesquisa.resposta where id = $1', [id(902)])).toBe(0);
    });

    it('pull de versões e de respostas: cada tenant recebe só as suas linhas', async () => {
      const verA = await puxar('questionario_versao', ctx(U.vendedor1));
      const verB = await puxar('questionario_versao', ctx(U.vendedorB));
      expect(verA.map((l) => l.id)).toContain((await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1', [Q.ciclo]))[0]!.id);
      const idsB = new Set(verB.map((l) => l.id));
      for (const l of verA) expect(idsB.has(l.id)).toBe(false);
      expect(verB.length).toBeGreaterThan(0);
      const respB = await puxar('resposta_pesquisa', ctx(U.adminB));
      const respA = await puxar('resposta_pesquisa', ctx(U.analista));
      expect(respB.length).toBeGreaterThan(0);
      for (const l of respB) expect(respA.map((x) => x.id)).not.toContain(l.id);
    });
  });

  describe('RN-PES-01: versão publicada é imutável (API e banco)', () => {
    it('editar a publicada pela API abre a v2 em rascunho e a v1 fica intacta no banco', async () => {
      await publicarV1(Q.edicao, 'Imutável');
      const v1Antes = await linhas(A.tenantId, 'select * from pesquisa.questionario_versao where questionario_id = $1 and numero = 1', [Q.edicao]);
      const d = QuestionarioDetalhe.parse(await chamar(ctx(U.analista), 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.edicao }, corpo: { titulo: 'Imutável (v2)', perguntas: PERGUNTAS.slice(0, 2) } }));
      expect(d.versoes.map((v) => [v.numero, v.status, v.titulo])).toEqual([[1, 'publicada', 'Imutável'], [2, 'rascunho', 'Imutável (v2)']]);
      expect(d.validacao_rascunho).not.toBeNull();
      expect(await linhas(A.tenantId, 'select * from pesquisa.questionario_versao where questionario_id = $1 and numero = 1', [Q.edicao])).toEqual(v1Antes);
      // salvar de novo atualiza o MESMO rascunho (não cria v3)
      await chamar(ctx(U.analista), 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.edicao }, corpo: { titulo: 'Imutável (v2 revisada)' } });
      const v = await linhas<{ numero: number; titulo: string }>(A.tenantId, 'select numero, titulo from pesquisa.questionario_versao where questionario_id = $1 order by numero', [Q.edicao]);
      expect(v).toEqual([{ numero: 1, titulo: 'Imutável' }, { numero: 2, titulo: 'Imutável (v2 revisada)' }]);
      // publicar a v2 não mexe na v1
      const pub = PublicarResponse.parse(await chamar(ctx(U.analista), 'POST', 'questionarios/:id/publicar', { params: { id: Q.edicao } }));
      expect(pub.versao).toMatchObject({ numero: 2, status: 'publicada' });
      expect(await linhas(A.tenantId, 'select * from pesquisa.questionario_versao where questionario_id = $1 and numero = 1', [Q.edicao])).toEqual(v1Antes);
    });

    it('pela API: publicar de novo sem rascunho é 409 SEM_RASCUNHO e nada muda', async () => {
      const antes = await linhas(A.tenantId, 'select id, updated_at from pesquisa.questionario_versao where questionario_id = $1 order by numero', [Q.edicao]);
      await expect(chamar(ctx(U.analista), 'POST', 'questionarios/:id/publicar', { params: { id: Q.edicao } })).rejects.toMatchObject({ status: 409, codigo: 'SEM_RASCUNHO' });
      expect(await linhas(A.tenantId, 'select id, updated_at from pesquisa.questionario_versao where questionario_id = $1 order by numero', [Q.edicao])).toEqual(antes);
    });

    it('pelo repositório: gravar conteúdo novo numa versão publicada vira 422 VERSAO_PUBLICADA_IMUTAVEL (23514 do banco, não 500)', async () => {
      const d = QuestionarioDetalhe.parse(await chamar(ctx(U.analista), 'GET', 'questionarios/:id', { params: { id: Q.edicao } }));
      const publicada = d.versoes[0]!;
      const adulterada = { ...publicada, titulo: 'adulterada' };
      await expect(comTenant(pool, A.tenantId, (c) => criarRepositorioPostgres()(A.tenantId, c as unknown as ClienteBanco).gravarVersao(adulterada, AGORA.toISOString()))).rejects.toMatchObject({
        status: 422,
        codigo: 'VERSAO_PUBLICADA_IMUTAVEL',
        detalhes: { rn: 'RN-PES-01' },
      });
      expect((await linhas<{ titulo: string }>(A.tenantId, 'select titulo from pesquisa.questionario_versao where id = $1', [publicada.id]))[0]!.titulo).toBe('Imutável');
    });

    it('pelo banco: UPDATE no conteúdo da publicada dá 23514 com RN-PES-01; tocar updated_at e deleted_at é permitido', async () => {
      const [v1] = await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1 and numero = 1', [Q.edicao]);
      // despublicar cai antes, no CHECK de publicação (também 23514, sem a mensagem do gatilho)
      await expect(comTenant(pool, A.tenantId, (c) => c.query("update pesquisa.questionario_versao set status = 'rascunho' where id = $1", [v1!.id]))).rejects.toMatchObject({ code: '23514' });
      for (const sql of ['titulo = $2', "perguntas = '[{\"id\": 1}]'::jsonb", "vigencia_inicio = vigencia_inicio + interval '1 day'", 'numero = 9']) {
        await expect(comTenant(pool, A.tenantId, (c) => c.query(`update pesquisa.questionario_versao set ${sql} where id = $1`, sql.includes('$2') ? [v1!.id, 'x'] : [v1!.id])), sql).rejects.toMatchObject({
          code: '23514',
          message: expect.stringContaining('RN-PES-01'),
        });
      }
      await comTenant(pool, A.tenantId, async (c) => {
        await c.query("update pesquisa.questionario_versao set updated_at = updated_at + interval '1 second' where id = $1", [v1!.id]);
      });
    });

    it('só um rascunho aberto por questionário: o segundo vira 409 VERSAO_EM_EDICAO (23505)', async () => {
      const c = ctx(U.analista);
      await chamar(c, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.edicao }, corpo: { titulo: 'Imutável (v3)' } }); // abre a v3
      const d = QuestionarioDetalhe.parse(await chamar(c, 'GET', 'questionarios/:id', { params: { id: Q.edicao } }));
      const v3 = d.versoes.find((v) => v.status === 'rascunho')!;
      const outro = { ...v3, id: id(950), numero: 4 };
      await expect(comTenant(pool, A.tenantId, (cx) => criarRepositorioPostgres()(A.tenantId, cx as unknown as ClienteBanco).gravarVersao(outro, AGORA.toISOString()))).rejects.toMatchObject({ status: 409, codigo: 'VERSAO_EM_EDICAO' });
      expect(await contar(A.tenantId, "select count(*) as n from pesquisa.questionario_versao where questionario_id = $1 and status = 'rascunho'", [Q.edicao])).toBe(1);
    });
  });

  describe('RF-PES-04: push de respostas idempotente, com itens e fotos', () => {
    let v1!: string;
    beforeAll(async () => {
      await publicarV1(Q.idem, 'Idempotência');
      v1 = (await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1', [Q.idem]))[0]!.id;
    });

    it('grava a resposta, o gatilho normaliza os 9 itens e a foto (galeria) e a API registra o arquivo antes e publica o evento', async () => {
      const e = envio(Q.idem, v1, id(1001), id(1101));
      const antes = eventos.length;
      const r = await push(ctx(U.vendedor1), e);
      expect(r).toEqual([{ id: e.id, status: 'aceito', em: AGORA.toISOString() }]);
      const resp = (await linhas<{ usuario_id: string; recebida_em: string; suspeita: boolean; n: number }>(A.tenantId, 'select usuario_id, recebida_em, suspeita, jsonb_array_length(itens) as n from pesquisa.resposta where id = $1', [e.id]))[0]!;
      expect(resp).toMatchObject({ usuario_id: U.vendedor1.id, suspeita: false, n: 9 });
      expect(new Date(resp.recebida_em).toISOString()).toBe(AGORA.toISOString());
      const itens = await linhas<{ tipo: string }>(A.tenantId, 'select tipo from pesquisa.resposta_item where resposta_id = $1 order by tipo', [e.id]);
      expect(itens.map((i) => i.tipo)).toEqual(['codigo_barras', 'data', 'escala', 'foto', 'multipla', 'numero', 'sim_nao', 'texto', 'unica']);
      const fotos = await linhas(A.tenantId, 'select arquivo_id, pergunta_id, largura_px, altura_px from pesquisa.resposta_foto where resposta_id = $1', [e.id]);
      expect(fotos).toEqual([{ arquivo_id: id(1101), pergunta_id: P.foto, largura_px: 1600, altura_px: 1200 }]);
      const arq = await comTenant(pool, A.tenantId, (c) => lerArquivo(c, id(1101)));
      expect(arq).toEqual([{ finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: e.id, cliente_id: A.clientes.c1, enviado_por: U.vendedor1.id, modulo: 'pesquisa' }]);
      expect(eventos.slice(antes).map((x) => [x.nome, x.agregado])).toEqual([['pesquisa.resposta.registrada@1', e.id]]);
    });

    it('mesmo UUID enviado 2x (modo avião) = 1 linha em resposta, 9 em resposta_item e 1 em resposta_foto; o evento sai uma vez só', async () => {
      const e = envio(Q.idem, v1, id(1002), id(1102));
      const antes = eventos.length;
      const [r1] = await push(ctx(U.vendedor1), e);
      const [r2] = await push(ctx(U.vendedor1), structuredClone(e));
      expect([r1!.status, r2!.status]).toEqual(['aceito', 'aceito']);
      const cont = (tabela: string) => contar(A.tenantId, `select count(*) as n from pesquisa.${tabela} where ${tabela === 'resposta' ? 'id' : 'resposta_id'} = $1`, [e.id]);
      expect([await cont('resposta'), await cont('resposta_item'), await cont('resposta_foto')]).toEqual([1, 9, 1]);
      expect(await comTenant(pool, A.tenantId, (c) => contarArquivos(c, id(1102)))).toBe(1);
      expect(eventos.length - antes).toBe(1);
    });

    it('mesmo UUID e mesmo conteúdo na mesma remessa (2 itens iguais) também grava uma vez', async () => {
      const e = envio(Q.idem, v1, id(1003), id(1103));
      const r = await push(ctx(U.vendedor1), e, e);
      expect(r.map((x) => x.status)).toEqual(['aceito', 'aceito']);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where id = $1', [e.id])).toBe(1);
    });

    it('a hora do aparelho sem milissegundos não vira conflito no reenvio (grafia do banco ≠ grafia do app)', async () => {
      const e = envio(Q.idem, v1, id(1004), id(1104), { respondida_em: new Date(AGORA.getTime() - 10 * MIN).toISOString().replace('.000Z', 'Z') });
      const r = await push(ctx(U.vendedor1), e);
      expect(r[0]!.status).toBe('aceito');
      const [reenvio] = await push(ctx(U.vendedor1), e);
      expect(reenvio!.status).toBe('aceito');
    });

    it('mesmo UUID com conteúdo diferente = conflito; a resposta gravada não muda (somente inserção)', async () => {
      const original = envio(Q.idem, v1, id(1005), id(1105));
      await push(ctx(U.vendedor1), original);
      const antes = await linhas(A.tenantId, 'select itens, respondida_em, recebida_em, updated_at from pesquisa.resposta where id = $1', [original.id]);
      const outra = { ...original, itens: [{ pergunta_id: P.simNao, tipo: 'sim_nao' as const, valor: false }] };
      const [r] = await push(ctx(U.vendedor1), outra);
      expect(r).toMatchObject({ id: original.id, status: 'conflito' });
      expect(await linhas(A.tenantId, 'select itens, respondida_em, recebida_em, updated_at from pesquisa.resposta where id = $1', [original.id])).toEqual(antes);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta_item where resposta_id = $1', [original.id])).toBe(9);
    });

    it('a mesma foto numa segunda resposta é rejeitada (ARQUIVO_JA_REFERENCIADO) e a transação desfaz tudo', async () => {
      const outra = envio(Q.idem, v1, id(1006), id(1101)); // foto 1101 já é da resposta 1001
      const antes = eventos.length;
      const [r] = await push(ctx(U.vendedor1), outra);
      expect(r).toMatchObject({ id: outra.id, status: 'rejeitado', codigo: CODIGOS_ARQUIVO.jaReferenciado });
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where id = $1', [outra.id])).toBe(0);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta_foto where arquivo_id = $1', [id(1101)])).toBe(1);
      expect(eventos.length).toBe(antes);
    });

    it('duas entregas simultâneas do mesmo UUID: as duas voltam "aceito" e fica uma linha (a perdedora refaz e vê a vencedora)', async () => {
      const e = envio(Q.idem, v1, id(1007), id(1107));
      const [a, b] = await Promise.all([push(ctx(U.vendedor1), e), push(ctx(U.vendedor1), structuredClone(e))]);
      expect([a![0]!.status, b![0]!.status]).toEqual(['aceito', 'aceito']);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where id = $1', [e.id])).toBe(1);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta_foto where resposta_id = $1', [e.id])).toBe(1);
    });

    it('simultâneas com conteúdo diferente: uma entra e a outra vira conflito (nunca sobrescreve)', async () => {
      const a = envio(Q.idem, v1, id(1008), id(1108));
      const b = { ...a, itens: [{ pergunta_id: P.simNao, tipo: 'sim_nao' as const, valor: false }] };
      const [ra, rb] = await Promise.all([push(ctx(U.vendedor1), a), push(ctx(U.vendedor1), b)]);
      expect([ra![0]!.status, rb![0]!.status].sort()).toEqual(['aceito', 'conflito']);
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where id = $1', [a.id])).toBe(1);
    });

    it('RN-PES-01: resposta para versão em rascunho é rejeitada pelo domain e, se chegasse ao repositório, o banco recusa (VERSAO_NAO_PUBLICADA)', async () => {
      await chamar(ctx(U.analista), 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.idem }, corpo: { titulo: 'Idempotência (v2)' } });
      const rascunho = (await linhas<{ id: string }>(A.tenantId, "select id from pesquisa.questionario_versao where questionario_id = $1 and status = 'rascunho'", [Q.idem]))[0]!.id;
      const e = envio(Q.idem, rascunho, id(1009), id(1109));
      const [r] = await push(ctx(U.vendedor1), e);
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'VERSAO_NAO_PUBLICADA' });
      const completa = { ...e, tenant_id: A.tenantId, usuario_id: U.vendedor1.id, equipe_id: null, recebida_em: AGORA.toISOString(), suspeita: false, motivos_suspeita: [] as [] };
      await expect(comTenant(pool, A.tenantId, (c) => criarRepositorioPostgres()(A.tenantId, c as unknown as ClienteBanco).inserirResposta(completa, AGORA.toISOString()))).rejects.toMatchObject({ status: 422, codigo: 'VERSAO_NAO_PUBLICADA' });
      await expect(
        comTenant(pool, A.tenantId, (c) =>
          c.query('insert into pesquisa.resposta (id, tenant_id, questionario_id, versao_id, usuario_id, respondida_em, itens) values ($1, $2, $3, $4, $5, $6, $7::jsonb)', [id(1010), A.tenantId, Q.idem, rascunho, U.vendedor1.id, e.respondida_em, JSON.stringify(e.itens)]),
        ),
      ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('RN-PES-01') });
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where versao_id = $1', [rascunho])).toBe(0);
    });

    it('versão de outro questionário é recusada pelo banco (FK composta → VERSAO_INEXISTENTE)', async () => {
      const outraVersao = (await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1 and numero = 1', [Q.ciclo]))[0]!.id;
      const e = envio(Q.idem, outraVersao, id(1011), id(1111));
      const completa = { ...e, tenant_id: A.tenantId, usuario_id: U.vendedor1.id, equipe_id: null, recebida_em: AGORA.toISOString(), suspeita: false, motivos_suspeita: [] as [] };
      await expect(comTenant(pool, A.tenantId, (c) => criarRepositorioPostgres()(A.tenantId, c as unknown as ClienteBanco).inserirResposta(completa, AGORA.toISOString()))).rejects.toMatchObject({ status: 422, codigo: 'VERSAO_INEXISTENTE' });
    });

    it('resposta é só inserção: o papel da API não atualiza nem apaga (RF-PES-04)', async () => {
      await expect(comTenant(pool, A.tenantId, (c) => c.query("update pesquisa.resposta set suspeita = true where id = $1", [id(1001)]))).rejects.toMatchObject({ code: '42501' });
      await expect(comTenant(pool, A.tenantId, (c) => c.query('delete from pesquisa.resposta where id = $1', [id(1001)]))).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('RF-PES-05: arquivar toca as versões publicadas e elas descem de novo no pull', () => {
    it('arquivar: questionário arquivado, versões publicadas com updated_at maior e arquivado_em no pull; o rascunho não desce; idempotente', async () => {
      await publicarV1(Q.arquivar, 'Para arquivar');
      await chamar(ctx(U.analista), 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.arquivar }, corpo: { titulo: 'Para arquivar (v2)' } });
      const doQuestionario = async () => (await puxar('questionario_versao', ctx(U.vendedor1))).map((l) => QuestionarioVersaoSync.parse(l)).filter((l) => l.questionario_id === Q.arquivar);
      const antes = await doQuestionario();
      expect(antes).toHaveLength(1); // só a publicada; o rascunho v2 não desce (RN-PES-01)
      expect(antes[0]).toMatchObject({ numero: 1, status: 'publicada', arquivado_em: null });

      const c = ctx(U.analista);
      const d = QuestionarioDetalhe.parse(await chamar(c, 'POST', 'questionarios/:id/arquivar', { params: { id: Q.arquivar } }));
      expect(d.questionario.arquivado_em).toBe(AGORA.toISOString());
      const depois = await doQuestionario();
      expect(depois).toHaveLength(1);
      expect(depois[0]!.arquivado_em).toBe(AGORA.toISOString());
      expect(depois[0]!.updated_at > antes[0]!.updated_at).toBe(true);
      // o rascunho não é tocado: continua com o updated_at de antes
      const rasc = await linhas<{ upd: string }>(A.tenantId, "select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as upd from pesquisa.questionario_versao where questionario_id = $1 and status = 'rascunho'", [Q.arquivar]);
      expect(rasc[0]!.upd < depois[0]!.updated_at).toBe(true);

      // idempotente: arquivar de novo não toca nem audita outra vez
      const auditoriasAntes = auditorias.filter((a) => a.acao === 'questionario.arquivar').length;
      await chamar(c, 'POST', 'questionarios/:id/arquivar', { params: { id: Q.arquivar } });
      expect((await doQuestionario())[0]!.updated_at).toBe(depois[0]!.updated_at);
      expect(auditorias.filter((a) => a.acao === 'questionario.arquivar').length).toBe(auditoriasAntes);
      expect(auditoriasAntes).toBe(1);

      // arquivado não se edita nem se publica
      await expect(chamar(c, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q.arquivar }, corpo: { titulo: 'x' } })).rejects.toMatchObject({ status: 422, codigo: 'QUESTIONARIO_ARQUIVADO' });
      await expect(chamar(c, 'POST', 'questionarios/:id/publicar', { params: { id: Q.arquivar } })).rejects.toMatchObject({ status: 422, codigo: 'QUESTIONARIO_ARQUIVADO' });
    });
  });

  describe('pull com cursor (updated_at em microssegundos + id)', () => {
    it('versões: página de 1 em 1 percorre tudo sem repetir nem pular; updated_at tem 6 casas; `ate` antigo devolve nada', async () => {
      for (const [qid, t] of [[Q.pull1, 'Pull 1'], [Q.pull2, 'Pull 2'], [Q.pull3, 'Pull 3']] as const) await publicarV1(qid, t);
      const c = ctx(U.vendedor1);
      const todas = await puxar('questionario_versao', c);
      expect(todas.length).toBeGreaterThanOrEqual(6); // 3 do teste + as da fixture
      for (const l of todas) {
        expect(l.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
        QuestionarioVersaoSync.parse(l);
      }
      const ordem = todas.map((l) => `${l.updated_at}|${l.id}`);
      expect(ordem).toEqual([...ordem].sort());

      const paginas: string[] = [];
      let desde: { updated_at: string; id: string } | null = null;
      for (let i = 0; i < todas.length + 2; i++) {
        const p: LinhaSync[] = await puxar('questionario_versao', c, { desde, limite: 1 });
        if (p.length === 0) break;
        paginas.push(p[0]!.id);
        desde = { updated_at: p[0]!.updated_at as string, id: p[0]!.id };
      }
      expect(paginas).toEqual(todas.map((l) => l.id));
      // `ate` no instante da linha mais antiga: `updated_at < ate` não deixa nenhuma passar
      expect(await puxar('questionario_versao', c, { ate: todas[0]!.updated_at as string })).toEqual([]);
    });

    it('o cursor devolvido por uma linha não a repete e `updated_at >= ate` fica de fora', async () => {
      const c = ctx(U.vendedor1);
      const todas = await puxar('questionario_versao', c);
      const ultima = todas[todas.length - 1]!;
      expect(await puxar('questionario_versao', c, { desde: { updated_at: ultima.updated_at as string, id: ultima.id } })).toEqual([]);
      expect((await puxar('questionario_versao', c, { ate: ultima.updated_at as string })).map((l) => l.id)).not.toContain(ultima.id);
    });
  });

  describe('RN-CORE-04: pull de respostas no escopo do aparelho; resultados por SQL', () => {
    let v1!: string;
    beforeAll(async () => {
      await publicarV1(Q.escopo, 'Escopo');
      v1 = (await linhas<{ id: string }>(A.tenantId, 'select id from pesquisa.questionario_versao where questionario_id = $1', [Q.escopo]))[0]!.id;
      const c1 = new Set([A.clientes.c1]);
      const c2 = new Set([A.clientes.c2]);
      // vendedor1 responde no c1 (2x) e vendedor2 no c2 (2x), intercalado para a página ter que pular linhas de fora do escopo
      expect((await push(ctx(U.vendedor1, { carteira: c1 }), envio(Q.escopo, v1, id(2001), id(2101)))).map((r) => r.status)).toEqual(['aceito']);
      expect((await push(ctx(U.vendedor2, { carteira: c2 }), envio(Q.escopo, v1, id(2002), id(2102), { cliente_id: A.clientes.c2 }))).map((r) => r.status)).toEqual(['aceito']);
      expect((await push(ctx(U.vendedor1, { carteira: c1 }), envio(Q.escopo, v1, id(2003), id(2103)))).map((r) => r.status)).toEqual(['aceito']);
      expect((await push(ctx(U.vendedor2, { carteira: c2 }), envio(Q.escopo, v1, id(2004), id(2104), { cliente_id: A.clientes.c2 }))).map((r) => r.status)).toEqual(['aceito']);
    });

    it('cliente fora da carteira no push é rejeitado (FORA_DA_CARTEIRA) e não grava', async () => {
      const [r] = await push(ctx(U.vendedor2, { carteira: new Set([A.clientes.c2]) }), envio(Q.escopo, v1, id(2005), id(2105))); // c1 não é do vendedor2
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
      expect(await contar(A.tenantId, 'select count(*) as n from pesquisa.resposta where id = $1', [id(2005)])).toBe(0);
    });

    it('cada vendedor puxa as respostas da própria carteira/autoria; as linhas validam o contrato e não levam o conteúdo', async () => {
      const v1Linhas = await puxar('resposta_pesquisa', ctx(U.vendedor1, { carteira: new Set([A.clientes.c1]) }));
      for (const l of v1Linhas) RespostaPesquisaSync.parse(l);
      const mias = v1Linhas.filter((l) => (l as { questionario_id?: string }).questionario_id === Q.escopo).map((l) => l.id);
      expect(mias.sort()).toEqual([id(2001), id(2003)]);
      // a resposta de fixture do vendedor1 no c1 (outro questionário) também está no escopo; nenhuma do vendedor2/c2 do teste
      expect(v1Linhas.map((l) => l.id)).not.toEqual(expect.arrayContaining([id(2002)]));
      const v2Linhas = await puxar('resposta_pesquisa', ctx(U.vendedor2, { carteira: new Set([A.clientes.c2]) }));
      expect(v2Linhas.map((l) => l.id).sort()).toEqual([id(2002), id(2004)]);
      expect(Object.keys(v2Linhas[0]!)).not.toContain('itens');
    });

    it('a página sai cheia mesmo com linhas de fora do escopo no meio (lê em lotes pelo cursor) e a paginação 1 a 1 percorre tudo', async () => {
      const fabrica = criarRepositorioPostgres({ lotePull: 1 });
      const api = criarApiPesquisa(fabrica);
      const p = api.sync!.find((s) => s.entidade.nome === 'resposta_pesquisa')!;
      const c = ctx(U.vendedor2, { carteira: new Set([A.clientes.c2]) });
      const dois = await p.puxar!(c, { desde: null, ate: ATE, limite: 2 });
      expect(dois.map((l) => l.id).sort()).toEqual([id(2002), id(2004)]);
      const ids: string[] = [];
      let desde: { updated_at: string; id: string } | null = null;
      for (let i = 0; i < 5; i++) {
        const pag: LinhaSync[] = await p.puxar!(c, { desde, ate: ATE, limite: 1 });
        if (pag.length === 0) break;
        ids.push(pag[0]!.id);
        desde = { updated_at: pag[0]!.updated_at as string, id: pag[0]!.id };
      }
      expect(ids).toEqual(dois.map((l) => l.id));
    });

    it('RF-PES-06: resultado, respostas, galeria e exportação saem do banco no escopo do analista (tenant)', async () => {
      const a = ctx(U.analista);
      const res = ResultadoResponse.parse(await chamar(a, 'GET', 'questionarios/:id/resultado', { params: { id: Q.escopo } }));
      expect(res.tipo).toBe('consolidado');
      if (res.tipo === 'consolidado') expect(res.resultado.versoes).toEqual([expect.objectContaining({ versao_id: v1, numero: 1, respostas: 4 })]);
      const lista = ListaRespostas.parse(await chamar(a, 'GET', 'questionarios/:id/respostas', { params: { id: Q.escopo } }));
      expect(lista.total).toBe(4);
      expect(lista.itens.map((i) => i.id).sort()).toEqual([id(2001), id(2002), id(2003), id(2004)]);
      expect(lista.itens[0]!.itens).toHaveLength(9);
      const galeria = Galeria.parse(await chamar(a, 'GET', 'questionarios/:id/galeria', { params: { id: Q.escopo } }));
      expect(galeria.itens.map((f) => f.foto_id).sort()).toEqual([id(2101), id(2102), id(2103), id(2104)]);
      const csv = ExportacaoResponse.parse(await chamar(a, 'GET', 'questionarios/:id/exportar', { params: { id: Q.escopo } }));
      expect(csv.conteudo.split('\n').length).toBeGreaterThanOrEqual(5);
      const d = QuestionarioDetalhe.parse(await chamar(a, 'GET', 'questionarios/:id', { params: { id: Q.escopo } }));
      expect(d.respostas).toBe(4);
    });

    it('RN-CORE-04: o supervisor sem os vendedores na equipe não vê respostas no resultado (escopo aplicado sobre as linhas do banco)', async () => {
      const sup = { id: A.usuarios.supervisor, tenant_id: A.tenantId, perfil: 'supervisor' as Perfil };
      const lista = ListaRespostas.parse(await chamar(ctx(sup as unknown as Usuario), 'GET', 'questionarios/:id/respostas', { params: { id: Q.escopo } }));
      expect(lista).toEqual({ itens: [], total: 0 });
    });

    it('a contagem e o resultado de A não somam as respostas de B (mesmo questionário não existe no outro tenant)', async () => {
      expect(await contar(B.tenantId, 'select count(*) as n from pesquisa.resposta where questionario_id = $1', [Q.escopo])).toBe(0);
      expect(await contar(B.tenantId, 'select count(*) as n from pesquisa.resposta_foto where arquivo_id = $1', [id(2101)])).toBe(0);
    });
  });

  describe('fixture dois-tenants: dados do banco chegam pelo contrato', () => {
    it('as versões e respostas da fixture de A passam no contrato do pull (a fixture e o contrato concordam)', async () => {
      const vs = (await puxar('questionario_versao', ctx(U.vendedor1))).map((l) => QuestionarioVersaoSync.parse(l));
      expect(vs.map((l) => l.versao.titulo)).toEqual(expect.arrayContaining(['Exposição na loja', 'Satisfação no checkout']));
      const vb = (await puxar('questionario_versao', ctx(U.vendedorB))).map((l) => QuestionarioVersaoSync.parse(l));
      expect(vb.map((l) => l.versao.titulo)).toContain('Avulsa do tenant B');
      expect(vs.map((l) => l.versao.titulo)).not.toContain('Avulsa do tenant B');
    });

    it('a resposta suspeita da fixture de B (relógio adiantado) é lida de volta com os motivos', async () => {
      const lista = await linhas<{ suspeita: boolean; motivos_suspeita: string[] }>(B.tenantId, 'select suspeita, motivos_suspeita from pesquisa.resposta');
      expect(lista).toEqual([{ suspeita: true, motivos_suspeita: ['RELOGIO_ADIANTADO'] }]);
    });
  });
});
