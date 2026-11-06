/**
 * Carga por arquivo EM PARTES (RF-INT-03) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): o handler REAL de
 * `POST cargas-arquivo` recebe cada parte da MESMA sessão, o consumidor A7 REAL as aplica e `GET cargas-arquivo/sessoes/:id` mostra o
 * progresso. Cobre RN-INT-06 (só a última parte aplicada fecha a sessão e inativa; parte faltando ou prazo vencido não inativa nada),
 * RN-INT-12 (a mesma chave base em todas as partes; reenvio da parte = repetição; conteúdo diferente = 409) e multi-tenant.
 * Cada cenário usa um Conector arquivo próprio (a fila de aplicação é por Conector e entidade). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroHttpModulo, ErroNaoEncontrado, type ContextoConsumo, type DefinicaoEvento, type Perfil } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProgressoSessaoArquivo, type CargaArquivoAceita } from '../contracts';
import { chaveDaParte, converterCsvParaLote, dividirCsvEmPartes, hashConteudoArquivo, PARAMETROS_PADRAO, sha256Hex, validarEnvelope } from '../domain';
import { aplicarLote } from './aplicar-lote';
import { rotaCargaArquivo, rotaProgressoSessaoArquivo } from './bko-carga-arquivo';
import { gravarLote } from './rotas-lotes';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const P = `T0087PRT${randomUUID().slice(0, 6)}`;
const BOM = String.fromCharCode(0xfeff);
const AGORA = new Date();
const DEPOIS_DO_TTL = new Date(AGORA.getTime() + (PARAMETROS_PADRAO.ttlSessaoMin + 60) * 60_000);
const TIMEOUT_GRANDE = 600_000;

interface Capturado {
  nome: string;
  payload: Record<string, unknown>;
}

describe.skipIf(semBanco())('Carga por arquivo em partes × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let eventos: Capturado[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const conectores: string[] = [];
  let seqConector = 0;

  const tx = {
    publicar: async (def: DefinicaoEvento, payload: unknown) => {
      eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
      return {} as never;
    },
    auditar: async () => undefined,
  };
  const quem = (tenantId: string, perfil: Perfil = 'admin') => ({ id: tenantId === A.tenantId ? A.usuarios.admin : B.usuarios.admin, tenant_id: tenantId, perfil });
  const ctxRota = (tenantId: string, corpo: unknown, extra: Record<string, unknown> = {}) =>
    ({
      usuario: quem(tenantId),
      corpo,
      query: {},
      params: {},
      parametros: () => ({}),
      agora: () => AGORA,
      log,
      comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, tx)),
      ...extra,
    }) as never;

  /** Um Conector tipo arquivo novo (identificador único) por cenário. */
  const novoConector = async (tenantId: string): Promise<{ id: string; identificador: string }> => {
    const identificador = `${P}-c${++seqConector}`;
    const { rows } = await admin.query<{ id: string }>(
      "insert into integracao.conector (tenant_id, identificador, nome, tipo, recebe_pedidos, entidades) values ($1, $2, 'Planilhas', 'arquivo', false, array['transportadora', 'catalogo_no']) returning id",
      [tenantId, identificador],
    );
    conectores.push(rows[0]!.id);
    return { id: rows[0]!.id, identificador };
  };

  const csvTransp = (tag: string, ids: string[], nomeDe: (id: string) => string = (id) => `Transp ${id}`) =>
    `external_id;nome;documento\n${ids.map((id) => `${P}-${tag}-${id};${nomeDe(id)};`).join('\n')}\n`;
  const idsDe = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => String(de + i).padStart(5, '0'));

  const falha = async (promessa: Promise<unknown>): Promise<ErroHttpModulo> => {
    try {
      await promessa;
    } catch (e) {
      if (e instanceof ErroHttpModulo) return e;
      throw e;
    }
    throw new Error('esperado erro do módulo');
  };

  interface Envio {
    tenantId?: string;
    conector: string;
    base: string;
    sessao: string;
    parte: number;
    total: number;
    conteudo: string;
    modo?: string;
    entidade?: string;
    linhaInicial?: number;
    agora?: Date;
  }
  const corpoParte = (e: Envio) => ({
    entidade: e.entidade ?? 'transportadora',
    modo: e.modo ?? 'completo',
    chave_idempotencia: e.base,
    conector_id: e.conector,
    conteudo: e.conteudo,
    sessao_id: e.sessao,
    parte: e.parte,
    total_partes: e.total,
    ...(e.linhaInicial ? { linha_inicial: e.linhaInicial } : {}),
  });
  const enviarParte = async (e: Envio): Promise<CargaArquivoAceita> =>
    (await rotaCargaArquivo.executar(ctxRota(e.tenantId ?? A.tenantId, corpoParte(e), e.agora ? { agora: () => e.agora } : {}))) as CargaArquivoAceita;

  /** Aplica UM lote como o despachante da outbox (A7 real). NÃO mexe nos outros lotes: as partes são aplicadas em ordem. */
  const aplicar = (tenantId: string, loteId: string, conector: string, entidade = 'transportadora', modo = 'completo') =>
    comTenant(pool, tenantId, (db) =>
      aplicarLote(
        { lote_id: loteId, conector_id: conector, entidade: entidade as never, modo: modo as never, recebidas: 1, recebido_em: AGORA.toISOString() },
        {
          envelope: { evento_id: randomUUID(), tenant_id: tenantId },
          db,
          agora: () => AGORA,
          publicar: (async (def: DefinicaoEvento, payload: unknown) => {
            eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
            return {} as never;
          }) as never,
          log,
          consultar: async () => ({ resultados: [] }),
        } as unknown as ContextoConsumo,
      ),
    );

  const progresso = async (tenantId: string, sessao: string, agora?: Date) =>
    ProgressoSessaoArquivo.parse(await rotaProgressoSessaoArquivo.executar(ctxRota(tenantId, undefined, { params: { sessao_id: sessao }, ...(agora ? { agora: () => agora } : {}) })));
  const registros = (tenantId: string, like: string) =>
    comTenant(pool, tenantId, async (db) =>
      (await db.query<{ external_id: string; hash: string; payload: unknown; ativo: boolean; deleted_at: Date | null }>("select external_id, hash, payload, ativo, deleted_at from integracao.registro_atual where entidade = 'transportadora' and external_id like $1 order by external_id", [like])).rows,
    );
  const lotesDaSessao = (tenantId: string, sessao: string) =>
    comTenant(pool, tenantId, async (db) => Number((await db.query<{ n: string }>('select count(*)::text as n from integracao.lote where starts_with(chave_idempotencia, $1)', [`${sessao}.`])).rows[0]?.n));
  const nomes = (nome: string) => eventos.filter((e) => e.nome === nome);
  const situacaoGravada = async (conectorId: string, sessao: string) => (await admin.query<{ situacao: string }>('select situacao from integracao.sessao_carga where conector_id = $1 and sessao_uuid = $2', [conectorId, sessao])).rows[0]?.situacao;

  /** Carga delta de base (1 lote) para ter o que inativar. */
  const cargaBase = async (conector: { id: string; identificador: string }, tag: string, ids: string[]) => {
    const r = await enviarParte({ conector: conector.identificador, base: `${P}-base-${tag}-${randomUUID().slice(0, 8)}`, sessao: randomUUID(), parte: 1, total: 1, conteudo: csvTransp(tag, ids), modo: 'delta' });
    await aplicar(A.tenantId, r.lote_id, conector.id, 'transportadora', 'delta');
    return r;
  };

  async function limpar() {
    if (conectores.length === 0) return;
    await admin.query('delete from integracao.inativacao_auditoria where conector_id = any($1)', [conectores]);
    await admin.query('delete from integracao.pendencia_inativacao where conector_id = any($1)', [conectores]);
    await admin.query('delete from integracao.lote_linha_erro where lote_id in (select id from integracao.lote where conector_id = any($1))', [conectores]);
    await admin.query('delete from integracao.lote_staging where lote_id in (select id from integracao.lote where conector_id = any($1))', [conectores]);
    await admin.query('delete from integracao.lote where conector_id = any($1)', [conectores]);
    await admin.query('delete from integracao.sessao_carga_recebido where sessao_id in (select id from integracao.sessao_carga where conector_id = any($1))', [conectores]);
    await admin.query('delete from integracao.sessao_carga where conector_id = any($1)', [conectores]);
    await admin.query('delete from integracao.registro_atual where conector_id = any($1)', [conectores]);
    await admin.query('delete from integracao.cursor_entidade where conector_id = any($1)', [conectores]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    if (admin) {
      await limpar();
      await admin.query('delete from integracao.conector where id = any($1)', [conectores]);
    }
    await admin?.end();
    await pool?.end();
  });

  // ---------------------------------------------------------------------------------------------------------- 20 mil linhas

  it(
    'RF-INT-03/RN-INT-06: 20 mil linhas de transportadora em 4 partes (completo) pela rota real + A7 real = o mesmo resultado de 4 lotes de 5.000 montados à mão; progresso 4/4 completa',
    async () => {
      eventos = [];
      const ca = await novoConector(A.tenantId);
      const cb = await novoConector(B.tenantId);
      const ids = idsDe(1, 20_000);
      // algumas linhas inválidas no Hub (nome vazio): têm de dar o mesmo erro nos dois caminhos
      const invalido = new Set(['00007', '05003', '12000', '19999']);
      const texto = csvTransp('big', ids, (id) => (invalido.has(id) ? '' : `Transp ${id}`));

      // caminho 1: a rota real, partes da divisão da tela
      const d = dividirCsvEmPartes(texto, { maxLinhas: 5000 });
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      expect(d.partes).toHaveLength(4);
      const sessaoA = randomUUID();
      const baseA = `${P}-big-${randomUUID().slice(0, 8)}`;
      const lotesA: string[] = [];
      for (const p of d.partes) {
        const r = await enviarParte({ conector: ca.identificador, base: baseA, sessao: sessaoA, parte: p.parte, total: p.total_partes, conteudo: p.texto, linhaInicial: p.linha_inicial });
        expect(r).toMatchObject({ status: 'recebido', modo: 'completo', recebidos: 5000, linhas_lidas: 5000, sessao: { id: sessaoA, parte: p.parte, total_partes: 4, consulta: `/v1/integracao/cargas-arquivo/sessoes/${sessaoA}` } });
        lotesA.push(r.lote_id);
      }
      for (const [i, l] of lotesA.entries()) {
        await aplicar(A.tenantId, l, ca.id);
        if (i < 3) expect((await progresso(A.tenantId, sessaoA)).situacao).toBe('aberta');
      }
      const pa = await progresso(A.tenantId, sessaoA);
      expect(pa).toMatchObject({ situacao: 'completa', total_partes: 4, partes_recebidas: 4, partes_aplicadas: 4, partes_faltando: [], contagens: { recebidas: 20_000, novas: 19_996, com_erro: 4 }, erros_total: 4 });
      expect(pa.partes.map((x) => x.parte)).toEqual([1, 2, 3, 4]);

      // caminho 2: 4 CSVs de 5.000 linhas montados à mão (sem a divisão da tela), gravados direto como partes 1..4 de OUTRA sessão no tenant B
      const linhas = texto.split('\n').slice(1, -1);
      const sessaoB = randomUUID();
      for (let n = 1; n <= 4; n++) {
        const csv = `external_id;nome;documento\n${linhas.slice((n - 1) * 5000, n * 5000).join('\n')}\n`;
        const conv = converterCsvParaLote({ entidade: 'transportadora', modo: 'completo', texto: csv, agora: AGORA.toISOString(), parte: { sessaoId: sessaoB, parte: n, totalPartes: 4 } });
        if (!conv.ok) throw new Error(conv.mensagem);
        const env = validarEnvelope(conv.envelope, {});
        if (!env.ok) throw new Error(env.erros[0]?.mensagem);
        const g = await comTenant(pool, B.tenantId, (db) =>
          gravarLote(db as never, tx as never, {
            tenantId: B.tenantId,
            conector: cb,
            env: env.envelope,
            chave: chaveDaParte({ chaveBase: `${P}-manual`, sessaoId: sessaoB, parte: n, totalPartes: 4 }),
            hashConteudo: sha256Hex(csv),
            recebidas: 5000,
            versaoConector: null,
            bytes: csv.length,
            agora: AGORA,
            stagingExtra: { origem: 'arquivo', linhas_arquivo: conv.linhasArquivo },
            log,
          }),
        );
        if (g.tipo !== 'aceito') throw new Error('lote manual não aceito');
        await aplicar(B.tenantId, g.lote.lote_id, cb.id);
      }
      const pb = await progresso(B.tenantId, sessaoB);
      expect(pb).toMatchObject({ situacao: 'completa', partes_aplicadas: 4, contagens: pa.contagens, erros_total: pa.erros_total });

      const ra = await registros(A.tenantId, `${P}-big-%`);
      const rb = await registros(B.tenantId, `${P}-big-%`);
      expect(ra).toHaveLength(19_996);
      expect(ra.map((r) => [r.external_id, r.hash, r.payload])).toEqual(rb.map((r) => [r.external_id, r.hash, r.payload]));
      expect(nomes('integracao.lote.recebido@1').filter((e) => e.payload.conector_id === ca.identificador)).toHaveLength(4);
    },
    TIMEOUT_GRANDE,
  );

  // ---------------------------------------------------------------------------------------------------------- RN-INT-12

  it('RN-INT-12: reenviar uma parte (mesma chave base, mesmo conteúdo) = repetido, mesmo lote_id, nenhum lote nem lote.recebido novo — também com a sessão fechada; conteúdo diferente = 409', async () => {
    const c = await novoConector(A.tenantId);
    const sessao = randomUUID();
    const base = `${P}-rep-${randomUUID().slice(0, 8)}`;
    const csv1 = csvTransp('rep', idsDe(1, 3));
    const csv2 = csvTransp('rep', idsDe(4, 6));
    eventos = [];
    const p1 = await enviarParte({ conector: c.identificador, base, sessao, parte: 1, total: 2, conteudo: csv1 });
    const p2 = await enviarParte({ conector: c.identificador, base, sessao, parte: 2, total: 2, conteudo: csv2 });
    expect(p1.repetido).toBeUndefined();
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(2);
    expect(nomes('integracao.lote.recebido@1')).toHaveLength(2);

    const eco = await enviarParte({ conector: c.identificador, base, sessao, parte: 1, total: 2, conteudo: `${BOM}${csv1.replace(/\n/g, '\r\n')}` });
    expect(eco).toMatchObject({ lote_id: p1.lote_id, repetido: true, recebidos: 3, sessao: { id: sessao, parte: 1, total_partes: 2 } });
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(2);
    expect(nomes('integracao.lote.recebido@1')).toHaveLength(2);

    const outro = await falha(enviarParte({ conector: c.identificador, base, sessao, parte: 1, total: 2, conteudo: csvTransp('rep', idsDe(1, 4)) }));
    expect(outro).toMatchObject({ status: 409, codigo: 'chave_idempotencia_reutilizada' });
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(2);

    // sessão fechada (as duas partes aplicadas): o reenvio da parte continua sendo repetição, não erro de sessão fechada
    await aplicar(A.tenantId, p1.lote_id, c.id);
    await aplicar(A.tenantId, p2.lote_id, c.id);
    expect((await progresso(A.tenantId, sessao)).situacao).toBe('completa');
    expect(await enviarParte({ conector: c.identificador, base, sessao, parte: 2, total: 2, conteudo: csv2 })).toMatchObject({ lote_id: p2.lote_id, repetido: true });
    expect(nomes('integracao.lote.recebido@1')).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------------------------------------- parte faltando e prazo

  it('RN-INT-06: carga completa com a parte 3 nunca enviada (1, 2 e 4 aplicadas) NÃO inativa nada; progresso aberta com partes_faltando [3]; depois do TTL a consulta dá expirada e o envio tardio da parte 3 é 422 sessao_expirada', async () => {
    const c = await novoConector(A.tenantId);
    await cargaBase(c, 'exp', idsDe(1, 12));
    const sessao = randomUUID();
    const base = `${P}-exp-${randomUUID().slice(0, 8)}`;
    const partes = [idsDe(1, 3), idsDe(4, 6), idsDe(7, 9)]; // 10..12 ficam de fora da carga (25%, abaixo do limite de 30%)
    const envios = [1, 2, 4].map((n, i) => ({ n, csv: csvTransp('exp', partes[i]!) }));
    const lotes: string[] = [];
    for (const e of envios) lotes.push((await enviarParte({ conector: c.identificador, base, sessao, parte: e.n, total: 4, conteudo: e.csv })).lote_id);
    for (const l of lotes) await aplicar(A.tenantId, l, c.id);

    const ativos = async () => (await registros(A.tenantId, `${P}-exp-%`)).filter((r) => r.deleted_at === null).length;
    expect(await ativos()).toBe(12);
    const p = await progresso(A.tenantId, sessao);
    expect(p).toMatchObject({ situacao: 'aberta', total_partes: 4, partes_recebidas: 3, partes_aplicadas: 3, partes_faltando: [3] });
    expect(p.aviso?.codigo).toBe('partes_faltando');
    expect(p.inativacao).toBeUndefined();
    expect(await situacaoGravada(c.id, sessao)).toBe('aberta');

    // depois do prazo: a consulta diz expirada (sem gravar); o envio tardio fecha a sessão como expirada e é recusado
    const tarde = await progresso(A.tenantId, sessao, DEPOIS_DO_TTL);
    expect(tarde.situacao).toBe('expirada');
    expect(tarde.aviso?.codigo).toBe('sessao_expirada');
    expect(await situacaoGravada(c.id, sessao)).toBe('aberta');
    const atrasada = await falha(enviarParte({ conector: c.identificador, base, sessao, parte: 3, total: 4, conteudo: csvTransp('exp', idsDe(10, 12)), agora: DEPOIS_DO_TTL }));
    expect(atrasada).toMatchObject({ status: 422, codigo: 'sessao_expirada' });
    expect(atrasada.message).toMatch(/parte 3/);
    expect(atrasada.message).toMatch(/Nada foi inativado/);
    expect(await situacaoGravada(c.id, sessao)).toBe('expirada');
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(3);
    // mesmo sem o relógio adiantado a sessão já marcada como expirada continua recusando
    expect(await falha(enviarParte({ conector: c.identificador, base, sessao, parte: 3, total: 4, conteudo: csvTransp('exp', idsDe(10, 12)) }))).toMatchObject({ status: 422, codigo: 'sessao_expirada' });
    expect(await ativos()).toBe(12);
    expect((await progresso(A.tenantId, sessao)).situacao).toBe('expirada');
  });

  // ---------------------------------------------------------------------------------------------------------- inativação

  it('RN-INT-06: carga completa em 2 partes sem alguns ids — depois da parte 1 nada é inativado; depois da parte 2 (a última) os ausentes são inativados (abaixo de 30%)', async () => {
    const c = await novoConector(A.tenantId);
    await cargaBase(c, 'ina', idsDe(1, 10));
    const sessao = randomUUID();
    const base = `${P}-ina-${randomUUID().slice(0, 8)}`;
    const p1 = await enviarParte({ conector: c.identificador, base, sessao, parte: 1, total: 2, conteudo: csvTransp('ina', idsDe(1, 4)) });
    const p2 = await enviarParte({ conector: c.identificador, base, sessao, parte: 2, total: 2, conteudo: csvTransp('ina', idsDe(5, 8)) });
    const vivos = async () => (await registros(A.tenantId, `${P}-ina-%`)).filter((r) => r.deleted_at === null).map((r) => r.external_id.slice(-5));

    await aplicar(A.tenantId, p1.lote_id, c.id);
    expect(await vivos()).toHaveLength(10);
    expect(await progresso(A.tenantId, sessao)).toMatchObject({ situacao: 'aberta', partes_aplicadas: 1, partes_faltando: [] });

    await aplicar(A.tenantId, p2.lote_id, c.id);
    expect(await vivos()).toEqual(idsDe(1, 8));
    const fim = await progresso(A.tenantId, sessao);
    expect(fim).toMatchObject({ situacao: 'completa', partes_aplicadas: 2, inativacao: { situacao: 'aplicada', candidatos: 2 } });
    expect(await situacaoGravada(c.id, sessao)).toBe('completa');
    expect(nomes('integracao.transportadora.atualizado@1').filter((e) => e.payload.acao === 'inativado').map((e) => String(e.payload.external_id).slice(-5))).toEqual(expect.arrayContaining(['00009', '00010']));
  });

  // ---------------------------------------------------------------------------------------------------------- recusas

  it('RN-INT-06/RN-INT-12: partes inconsistentes — campos incompletos, parte fora da faixa, outra chave base (409), total divergente, outra entidade e sessão já fechada: 422 em português, nenhum lote criado', async () => {
    const c = await novoConector(A.tenantId);
    const sessao = randomUUID();
    const base = `${P}-inc-${randomUUID().slice(0, 8)}`;
    const csv = csvTransp('inc', idsDe(1, 2));
    await enviarParte({ conector: c.identificador, base, sessao, parte: 1, total: 3, conteudo: csv });
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(1);

    const corpo = corpoParte({ conector: c.identificador, base, sessao, parte: 2, total: 3, conteudo: csvTransp('inc', idsDe(3, 4)) });
    const tentar = (extra: Record<string, unknown>, tirar: string[] = []) => {
      const x: Record<string, unknown> = { ...corpo, ...extra };
      for (const k of tirar) delete x[k];
      return falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, x)));
    };
    expect(await tentar({}, ['total_partes'])).toMatchObject({ status: 422, codigo: 'partes_incompletas' });
    expect(await tentar({ parte: 4 })).toMatchObject({ status: 422, codigo: 'parte_invalida' });
    expect(await tentar({ total_partes: 1001 })).toMatchObject({ status: 422, codigo: 'total_partes_invalido' });
    expect(await tentar({ chave_idempotencia: `${P}-outra-chave-${randomUUID().slice(0, 8)}` })).toMatchObject({ status: 409, codigo: 'sessao_de_outra_chave' });
    expect(await tentar({ total_partes: 4 })).toMatchObject({ status: 422, codigo: 'total_partes_divergente' });
    const outraEntidade = await tentar({ entidade: 'catalogo_no', conteudo: `external_id;codigo;nome;nivel\n${P}-inc-n1;C1;Raiz;1\n` });
    expect(outraEntidade).toMatchObject({ status: 422, codigo: 'sessao_de_outra_entidade' });
    expect(outraEntidade.message.length).toBeGreaterThan(20);
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(1);

    // sessão já fechada (situação gravada) e a parte nova não existia: 422 sessao_fechada
    await admin.query("update integracao.sessao_carga set situacao = 'completa', fechada_em = now() where conector_id = $1 and sessao_uuid = $2", [c.id, sessao]);
    expect(await tentar({})).toMatchObject({ status: 422, codigo: 'sessao_fechada' });
    expect(await lotesDaSessao(A.tenantId, sessao)).toBe(1);
  });

  // ---------------------------------------------------------------------------------------------------------- delta em partes

  it('RF-INT-03: delta em partes não cria sessao_carga (agrupa só pela chave da parte); progresso completa quando as duas partes são aplicadas', async () => {
    const c = await novoConector(A.tenantId);
    const sessao = randomUUID();
    const base = `${P}-dl-${randomUUID().slice(0, 8)}`;
    const p1 = await enviarParte({ conector: c.identificador, base, sessao, parte: 1, total: 2, modo: 'delta', conteudo: csvTransp('dl', idsDe(1, 2)) });
    const p2 = await enviarParte({ conector: c.identificador, base, sessao, parte: 2, total: 2, modo: 'delta', conteudo: csvTransp('dl', idsDe(3, 4)) });
    expect(await situacaoGravada(c.id, sessao)).toBeUndefined();
    expect(await progresso(A.tenantId, sessao)).toMatchObject({ modo: 'delta', situacao: 'aberta', partes_faltando: [] });
    await aplicar(A.tenantId, p1.lote_id, c.id, 'transportadora', 'delta');
    await aplicar(A.tenantId, p2.lote_id, c.id, 'transportadora', 'delta');
    expect(await progresso(A.tenantId, sessao)).toMatchObject({ modo: 'delta', situacao: 'completa', partes_aplicadas: 2, contagens: { novas: 4 } });
    expect((await registros(A.tenantId, `${P}-dl-%`)).filter((r) => r.ativo)).toHaveLength(4);
  });

  // ---------------------------------------------------------------------------------------------------------- multi-tenant

  it('multi-tenant: o progresso da sessão do tenant A pedido pelo B é 404 SESSAO_NAO_ENCONTRADA; sessão inexistente também; B com o mesmo sessao_id tem a sua própria sessão', async () => {
    const ca = await novoConector(A.tenantId);
    const cb = await novoConector(B.tenantId);
    const sessao = randomUUID();
    const base = `${P}-mt-${randomUUID().slice(0, 8)}`;
    await enviarParte({ conector: ca.identificador, base, sessao, parte: 1, total: 2, conteudo: csvTransp('mt', idsDe(1, 2)) });

    const e1 = await falha(Promise.resolve(rotaProgressoSessaoArquivo.executar(ctxRota(B.tenantId, undefined, { params: { sessao_id: sessao } }))));
    expect(e1).toMatchObject({ status: 404, codigo: 'SESSAO_NAO_ENCONTRADA' });
    await expect(Promise.resolve(rotaProgressoSessaoArquivo.executar(ctxRota(B.tenantId, undefined, { params: { sessao_id: randomUUID() } })))).rejects.toBeInstanceOf(ErroNaoEncontrado);

    // o B manda uma parte com o mesmo sessao_id: sessão própria, sem enxergar a do A
    await enviarParte({ tenantId: B.tenantId, conector: cb.identificador, base, sessao, parte: 1, total: 3, conteudo: csvTransp('mt', idsDe(1, 1)) });
    expect(await progresso(B.tenantId, sessao)).toMatchObject({ total_partes: 3, partes_recebidas: 1, partes_faltando: [2, 3] });
    expect(await progresso(A.tenantId, sessao)).toMatchObject({ total_partes: 2, partes_recebidas: 1, partes_faltando: [2] });
  });

  it('RN-INT-12: o hash de cada parte inclui sessão, número e total (partes iguais em posições diferentes não colidem)', () => {
    const e = { entidade: 'transportadora', modo: 'completo', texto: 'external_id;nome\nX;Y\n' };
    const h = (parte: number) => hashConteudoArquivo({ ...e, parte: { sessaoId: randomUUID(), parte, totalPartes: 3 } });
    expect(h(1)).not.toBe(h(2));
  });
});
