/**
 * Carga por arquivo (RF-INT-03) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): o handler REAL de `POST cargas-arquivo`
 * grava o lote pelo mesmo caminho do Hub e o consumidor A7 REAL o aplica. Cobre RN-INT-01 (só linhas inválidas = concluído com
 * erros), RN-INT-06 (inválido nunca é inativado; inativação em massa espera confirmação), RN-INT-12 (chave obrigatória, repetição,
 * 409), RN-INT-13 (Conector tipo arquivo e dono da entidade), erros com o número da linha do arquivo, limites, ação de perfil,
 * multi-tenant e ausência de dado pessoal em log/auditoria. A licença do módulo e o 403 por perfil são da plataforma (apps/api);
 * aqui o handler também confere o perfil (defesa em profundidade). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroHttpModulo, ErroNaoEncontrado, type ContextoConsumo, type DefinicaoEvento, type Perfil } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ErrosLoteResposta, LoteResultado, type CargaArquivoAceita } from '../contracts';
import manifest from '../manifest';
import { aplicarLote } from './aplicar-lote';
import { rotaCargaArquivo, rotaErrosLote, rotaLote } from './bko-carga-arquivo';
import { rotaDecidirInativacao } from './bko-inativacao';
import { moduloApi } from './index';
import { consultarLote } from './rotas-lotes';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/** Prefixo dos external_id e das chaves deste arquivo: a limpeza só toca o que ele criou. */
const P = `T0032ARQ${randomUUID().slice(0, 6)}`;
const ID_ARQ_A = `${P}-arq-a`;
const ID_ARQ_B = `${P}-arq-b`;
const BOM = String.fromCharCode(0xfeff);
const SEGREDO = 'SEGREDO-PESSOAL-DA-LINHA';
const AGORA = new Date();
let seq = 0;
const chaveNova = () => `${P}-chave-${String(++seq).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;

interface Capturado {
  nome: string;
  payload: Record<string, unknown>;
}

describe('RF-INT-03: ligação no manifesto e no moduloApi', () => {
  it('as 4 rotas do BKO da carga por arquivo estão no moduloApi, com a ação do manifesto (admin e analista) e a leitura (lote, erros e progresso das partes) em monitor.ver', () => {
    const rotas = moduloApi.rotas ?? [];
    const post = rotas.find((r) => r.metodo === 'POST' && r.caminho === 'cargas-arquivo');
    expect(post?.acao).toBe('carga.arquivo');
    expect(manifest.acoes['carga.arquivo']?.perfis).toEqual(['admin', 'analista']);
    expect(rotas.find((r) => r.metodo === 'GET' && r.caminho === 'lotes/:id')?.acao).toBe('monitor.ver');
    expect(rotas.find((r) => r.metodo === 'GET' && r.caminho === 'lotes/:id/erros')?.acao).toBe('monitor.ver');
    expect(rotas.find((r) => r.metodo === 'GET' && r.caminho === 'cargas-arquivo/sessoes/:sessao_id')?.acao).toBe('monitor.ver');
  });
});

describe.skipIf(semBanco())('Carga por arquivo × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let eventos: Capturado[] = [];
  let auditorias: unknown[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let conectorA = '';
  let conectorB = '';

  const quem = (tenantId: string, perfil: Perfil = 'admin') => ({ id: tenantId === A.tenantId ? A.usuarios.admin : B.usuarios.admin, tenant_id: tenantId, perfil });
  const tx = {
    publicar: async (def: DefinicaoEvento, payload: unknown) => {
      eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
      return {} as never;
    },
    auditar: async (r: unknown) => {
      auditorias.push(r);
    },
  };
  const ctxRota = (tenantId: string, perfil: Perfil, corpo: unknown, extra: Record<string, unknown> = {}) =>
    ({
      usuario: quem(tenantId, perfil),
      corpo,
      query: {},
      params: {},
      parametros: () => ({}),
      agora: () => AGORA,
      log,
      comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, tx)),
      ...extra,
    }) as never;

  /** CSV de transportadora (entidade sem dependência): cada item é [id, nome, documento?]. */
  const csvTransp = (linhas: [string, string, string?][], sep = ';') =>
    ['external_id', 'nome', 'documento'].join(sep) + '\n' + linhas.map(([id, nome, doc]) => [`${P}-${id}`, nome, doc ?? ''].join(sep)).join('\n') + '\n';

  const enviar = async (tenantId: string, corpo: Record<string, unknown>, perfil: Perfil = 'admin'): Promise<CargaArquivoAceita> =>
    (await rotaCargaArquivo.executar(ctxRota(tenantId, perfil, { entidade: 'transportadora', modo: 'delta', chave_idempotencia: chaveNova(), ...corpo }))) as CargaArquivoAceita;
  const falha = async (promessa: Promise<unknown>): Promise<ErroHttpModulo> => {
    try {
      await promessa;
    } catch (e) {
      if (e instanceof ErroHttpModulo) return e;
      throw e;
    }
    throw new Error('esperado erro do módulo');
  };

  /** Aplica o lote como o despachante da outbox faria (consumidor A7 real). */
  const aplicar = async (tenantId: string, loteId: string, conector: string, entidade = 'transportadora', modo = 'delta') => {
    // lotes que outros testes só enviaram (sem aplicar) segurariam a fila da mesma entidade: aqui a ordem do worker não é o assunto
    await admin.query("update integracao.lote set status = 'concluido' where conector_id = any($1) and status = 'recebido' and id <> $2", [[conectorA, conectorB], loteId]);
    return comTenant(pool, tenantId, (db) =>
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
  };
  const resultado = async (tenantId: string, loteId: string) =>
    LoteResultado.parse(await rotaLote.executar(ctxRota(tenantId, 'admin', undefined, { params: { id: loteId }, query: { limite_erros: 1000 } })));
  const errosDe = async (tenantId: string, loteId: string, query: Record<string, unknown> = {}) =>
    ErrosLoteResposta.parse(await rotaErrosLote.executar(ctxRota(tenantId, 'admin', undefined, { params: { id: loteId }, query: { pagina: 1, por_pagina: 100, ...query } })));
  const ativos = (tenantId: string, entidade = 'transportadora') =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ external_id: string; ativo: boolean; deleted_at: Date | null }>('select external_id, ativo, deleted_at from integracao.registro_atual where entidade = $1 and external_id like $2 order by external_id', [entidade, `${P}%`])).rows);
  /** CSV de catalogo_no (entidade usada nas cargas completas, isolada das transportadoras): [id, nivel]. */
  const csvNo = (linhas: [string, string][]) => ['external_id;codigo;nome;nivel', ...linhas.map(([id, nivel]) => `${P}-${id};${id};Nó ${id};${nivel}`)].join('\n') + '\n';
  const nomes = (nome: string) => eventos.filter((e) => e.nome === nome);
  const contarLotes = (tenantId: string) =>
    comTenant(pool, tenantId, async (db) => Number((await db.query<{ n: string }>('select count(*)::text as n from integracao.lote where chave_idempotencia like $1', [`${P}%`])).rows[0]?.n));

  async function limpar() {
    const ids = [conectorA, conectorB].filter(Boolean);
    if (ids.length === 0) return;
    await admin.query('delete from integracao.inativacao_auditoria where conector_id = any($1)', [ids]);
    await admin.query('delete from integracao.pendencia_inativacao where conector_id = any($1)', [ids]);
    await admin.query('delete from integracao.lote_linha_erro where lote_id in (select id from integracao.lote where conector_id = any($1))', [ids]);
    await admin.query('delete from integracao.lote_staging where lote_id in (select id from integracao.lote where conector_id = any($1))', [ids]);
    await admin.query('delete from integracao.lote where conector_id = any($1)', [ids]);
    await admin.query('delete from integracao.sessao_carga_recebido where sessao_id in (select id from integracao.sessao_carga where conector_id = any($1))', [ids]);
    await admin.query('delete from integracao.sessao_carga where conector_id = any($1)', [ids]);
    await admin.query('delete from integracao.registro_atual where conector_id = any($1)', [ids]);
    await admin.query('delete from integracao.cursor_entidade where conector_id = any($1)', [ids]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    // um Conector tipo arquivo por tenant; só recebe 'transportadora' e 'catalogo_no' (as 8 entidades de ERP ficam com o Conector do ERP da fixture)
    const ins = async (tenantId: string, identificador: string) =>
      (
        await admin.query<{ id: string }>(
          "insert into integracao.conector (tenant_id, identificador, nome, tipo, recebe_pedidos, entidades) values ($1, $2, 'Planilhas', 'arquivo', false, array['transportadora', 'catalogo_no']) returning id",
          [tenantId, identificador],
        )
      ).rows[0]!.id;
    conectorA = await ins(A.tenantId, ID_ARQ_A);
    conectorB = await ins(B.tenantId, ID_ARQ_B);
  });
  afterAll(async () => {
    if (admin) {
      await limpar();
      await admin.query('delete from integracao.conector where id = any($1)', [[conectorA, conectorB].filter(Boolean)]);
    }
    await admin?.end();
    await pool?.end();
  });

  // ---------------------------------------------------------------------------------------------------------- caminho feliz

  it('RF-INT-03: CSV delta (separador ";", com BOM) vira lote do Conector arquivo, é aplicado pelo mesmo A7 e publica integracao.transportadora.atualizado@1 por linha', async () => {
    eventos = [];
    auditorias = [];
    const r = await enviar(A.tenantId, { conteudo: `${BOM}${csvTransp([['1', 'Rápido Norte'], ['2', 'Boa Vista Cargas'], ['3', 'Amazônia Log']])}` });
    expect(r).toMatchObject({ status: 'recebido', entidade: 'transportadora', modo: 'delta', recebidos: 3, conector_id: ID_ARQ_A, linhas_lidas: 3, linhas_invalidas_leitura: 0 });
    expect(r.consulta).toBe(`/v1/integracao/lotes/${r.lote_id}`);
    expect(r.repetido).toBeUndefined();
    expect(nomes('integracao.lote.recebido@1')).toHaveLength(1);
    expect(nomes('integracao.lote.recebido@1')[0]?.payload).toMatchObject({ lote_id: r.lote_id, conector_id: ID_ARQ_A, entidade: 'transportadora', recebidas: 3 });
    expect(auditorias).toHaveLength(1);

    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A);
    const res = await resultado(A.tenantId, r.lote_id);
    expect(res).toMatchObject({ status: 'concluido', contagens: { recebidas: 3, novas: 3, com_erro: 0 } });
    expect((await ativos(A.tenantId)).map((x) => x.external_id)).toEqual([`${P}-1`, `${P}-2`, `${P}-3`]);
    expect(nomes('integracao.transportadora.atualizado@1')).toHaveLength(3);
    // o lote pertence ao Conector arquivo
    const dono = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ conector_id: string }>('select conector_id from integracao.lote where id = $1', [r.lote_id])).rows[0]?.conector_id);
    expect(dono).toBe(conectorA);
  });

  it('RF-INT-03: separador "," e CRLF também valem; reenviar o mesmo cadastro com outra chave dá "inalteradas" (hash do registro, RN-INT-02) e não republica', async () => {
    eventos = [];
    const csv = csvTransp([['1', 'Rápido Norte'], ['2', 'Boa Vista Cargas']], ',').replace(/\n/g, '\r\n');
    const r = await enviar(A.tenantId, { conteudo: csv });
    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A);
    expect(await resultado(A.tenantId, r.lote_id)).toMatchObject({ status: 'concluido', contagens: { recebidas: 2, novas: 0, atualizadas: 0, inalteradas: 2 } });
    expect(nomes('integracao.transportadora.atualizado@1')).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------------------------------------- erros por linha

  it('RN-INT-03/RF-INT-03: linha inválida no Hub (nome vazio, documento mal formado) não trava o lote: concluido_com_erros e cada erro diz "Linha N do arquivo", sem repetir o valor digitado', async () => {
    eventos = [];
    const r = await enviar(A.tenantId, { conteudo: csvTransp([['4', 'Boa Carga'], ['5', ''], ['6', 'Docs', '123.456.789-00'], ['7', 'Ok Logística']]) });
    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A);
    const res = await resultado(A.tenantId, r.lote_id);
    expect(res).toMatchObject({ status: 'concluido_com_erros', contagens: { recebidas: 4, novas: 2, com_erro: 2 } });
    const erros = await errosDe(A.tenantId, r.lote_id);
    expect(erros.total).toBe(2);
    // cabeçalho = linha 1; a linha de dados 5 (índice 1) é a linha 3 do arquivo; a 6 é a linha 4
    expect(erros.itens.map((e) => [e.indice, e.external_id, e.mensagem.split(':')[0]])).toEqual([
      [1, `${P}-5`, 'Linha 3 do arquivo'],
      [2, `${P}-6`, 'Linha 4 do arquivo'],
    ]);
    expect(erros.itens.every((e) => e.mensagem.length > 20 && !e.mensagem.includes('123.456'))).toBe(true);
    // filtro por código e paginação da gaveta
    expect((await errosDe(A.tenantId, r.lote_id, { codigo: 'campo_obrigatorio' })).itens).toHaveLength(1);
    expect((await errosDe(A.tenantId, r.lote_id, { por_pagina: 1, pagina: 2 })).itens.map((e) => e.indice)).toEqual([2]);
    expect(nomes('integracao.transportadora.atualizado@1').map((e) => e.payload.external_id)).toEqual([`${P}-4`, `${P}-7`]);
  });

  it('RN-INT-01/P-1: arquivo em que TODAS as linhas têm valor que não converte é aceito e termina concluido_com_erros, com origem conector e a linha do arquivo', async () => {
    eventos = [];
    const csv = ['external_id;codigo;nome;nivel', `${P}-n1;C1;Raiz;abc`, `${P}-n2;C2;Filha;x1`].join('\n');
    const r = await enviar(A.tenantId, { entidade: 'catalogo_no', conteudo: csv });
    expect(r).toMatchObject({ recebidos: 2, linhas_lidas: 2, linhas_invalidas_leitura: 2 });
    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A, 'catalogo_no');
    expect(await resultado(A.tenantId, r.lote_id)).toMatchObject({ status: 'concluido_com_erros', contagens: { recebidas: 2, com_erro: 2, novas: 0 } });
    const erros = await errosDe(A.tenantId, r.lote_id);
    expect(erros.itens.map((e) => [e.origem, e.external_id, e.codigo, e.campo, e.mensagem.slice(0, 22)])).toEqual([
      ['conector', `${P}-n1`, 'tipo_invalido', 'nivel', 'Linha 2 do arquivo: o '],
      ['conector', `${P}-n2`, 'tipo_invalido', 'nivel', 'Linha 3 do arquivo: o '],
    ]);
    expect(nomes('integracao.catalogo_no.atualizado@1')).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------------------------------------- RN-INT-06

  it('RN-INT-06: carga completa por arquivo — o que sumiu é inativado; o registro que veio inválido NUNCA é inativado', async () => {
    eventos = [];
    const ids = Array.from({ length: 10 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
    const primeira = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'completo', conteudo: csvNo(ids.map((id): [string, string] => [id, '1'])) });
    await aplicar(A.tenantId, primeira.lote_id, ID_ARQ_A, 'catalogo_no', 'completo');
    expect((await ativos(A.tenantId, 'catalogo_no')).filter((x) => x.deleted_at === null)).toHaveLength(10);

    // 2ª carga completa: C01..C08 válidos, C09 inválido (nível fora da faixa), C10 ausente -> só C10 é inativado (10% <= 30%)
    const segunda = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'completo', conteudo: csvNo([...ids.slice(0, 8).map((id): [string, string] => [id, '1']), ['C09', '9']]) });
    await aplicar(A.tenantId, segunda.lote_id, ID_ARQ_A, 'catalogo_no', 'completo');
    const res = await resultado(A.tenantId, segunda.lote_id);
    expect(res).toMatchObject({ status: 'concluido_com_erros', inativadas: 1, inativacao: { situacao: 'aplicada' } });
    const reg = await ativos(A.tenantId, 'catalogo_no');
    expect(reg.find((x) => x.external_id === `${P}-C10`)?.deleted_at).not.toBeNull();
    expect(reg.find((x) => x.external_id === `${P}-C09`)?.deleted_at).toBeNull();
    expect(reg.find((x) => x.external_id === `${P}-C01`)?.deleted_at).toBeNull();
    const inativados = nomes('integracao.catalogo_no.atualizado@1').filter((e) => e.payload.acao === 'inativado');
    expect(inativados.map((e) => e.payload.external_id)).toEqual([`${P}-C10`]);
    // o erro da linha inválida diz a linha do arquivo (cabeçalho = 1; C09 é a 9ª linha de dados = linha 10)
    expect((await errosDe(A.tenantId, segunda.lote_id)).itens.map((e) => [e.external_id, e.mensagem.split(':')[0]])).toEqual([[`${P}-C09`, 'Linha 10 do arquivo']]);
  });

  it('RN-INT-06: carga completa que inativaria demais espera confirmação de admin/analista (pendência) e só inativa depois de confirmada; o analista confirma', async () => {
    eventos = [];
    const b = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'delta', conteudo: csvNo(['D1', 'D2', 'D3', 'D4', 'D5'].map((id): [string, string] => [id, '1'])) });
    await aplicar(A.tenantId, b.lote_id, ID_ARQ_A, 'catalogo_no', 'delta');
    // arquivo completo com só D1: dos ativos (C01..C09 e D1..D5) mais de 30% sairia
    const so1 = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'completo', conteudo: csvNo([['D1', '1']]) });
    await aplicar(A.tenantId, so1.lote_id, ID_ARQ_A, 'catalogo_no', 'completo');
    const res = await resultado(A.tenantId, so1.lote_id);
    expect(res.inativacao).toMatchObject({ situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao' });
    expect(res.inativadas).toBe(0);
    const d = async (id: string) => (await ativos(A.tenantId, 'catalogo_no')).find((x) => x.external_id === `${P}-${id}`)?.deleted_at;
    expect(await d('D2')).toBeNull();

    const pend = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ id: string; estado: string }>('select id, estado from integracao.pendencia_inativacao where lote_id = $1', [so1.lote_id])).rows[0]);
    expect(pend?.estado).toBe('aguardando');
    // confirmação: perfil sem permissão não passa; o analista confirma
    const negado = await falha(rotaDecidirInativacao.executar(ctxRota(A.tenantId, 'supervisor', { acao: 'confirmar' }, { params: { id: pend!.id } })));
    expect(negado.status).toBe(403);
    const ok = (await rotaDecidirInativacao.executar(ctxRota(A.tenantId, 'analista', { acao: 'confirmar' }, { params: { id: pend!.id } }))) as { inativadas: number };
    expect(ok.inativadas).toBeGreaterThanOrEqual(4);
    expect(await d('D2')).not.toBeNull();
    expect(await d('D1')).toBeNull();
  });

  it('RN-INT-06 (revisão final): linha com colunas a mais NÃO pega o external_id deslocado — external_id nulo, e a carga completa não inativa nada (calcularInativacao recusa por linhas_sem_external_id)', async () => {
    eventos = [];
    const cab = 'nome;external_id;codigo;nivel';
    const ids = Array.from({ length: 10 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);
    const linha = (id: string) => `Nó ${id};${P}-${id};${id};1`;
    const inicial = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'delta', conteudo: [cab, ...ids.map(linha)].join('\n') + '\n' });
    await aplicar(A.tenantId, inicial.lote_id, ID_ARQ_A, 'catalogo_no', 'delta');
    // E09 vem com o ";" no nome sem aspas: as células andam uma casa e o "external_id" lido seria "E09" (outro pedaço do texto)
    const deslocada = `Nó; E09;${P}-E09;E09;1`;
    const r = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'completo', conteudo: [cab, ...ids.slice(0, 8).map(linha), deslocada].join('\n') + '\n' });
    expect(r).toMatchObject({ recebidos: 9, linhas_lidas: 9, linhas_invalidas_leitura: 1 });
    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A, 'catalogo_no', 'completo');
    const erros = (await errosDe(A.tenantId, r.lote_id)).itens;
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatchObject({ origem: 'conector', external_id: null, codigo: 'registro_invalido' });
    expect(erros[0]?.mensagem).toMatch(/^Linha 10 do arquivo:/);
    expect(await resultado(A.tenantId, r.lote_id)).toMatchObject({ inativadas: 0, inativacao: { situacao: 'nao_aplicavel' } });
    const reg = await ativos(A.tenantId, 'catalogo_no');
    for (const id of ['E09', 'E10']) expect(reg.find((x) => x.external_id === `${P}-${id}`)?.deleted_at, id).toBeNull();
    expect(nomes('integracao.catalogo_no.atualizado@1').filter((e) => e.payload.acao === 'inativado')).toHaveLength(0);
  });

  it('RN-INT-06 (revisão final): linha com tipo que não converte (tipo_invalido) em carga completa preserva o external_id: conta como vista e NÃO é inativada; só o ausente sai', async () => {
    eventos = [];
    const ids = Array.from({ length: 8 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);
    const r = await enviar(A.tenantId, { entidade: 'catalogo_no', modo: 'completo', conteudo: csvNo([...ids.map((id): [string, string] => [id, '1']), ['E09', 'abc']]) });
    expect(r).toMatchObject({ recebidos: 9, linhas_lidas: 9, linhas_invalidas_leitura: 1 });
    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A, 'catalogo_no', 'completo');
    const erros = (await errosDe(A.tenantId, r.lote_id)).itens;
    expect(erros.map((e) => [e.origem, e.external_id, e.codigo, e.campo])).toEqual([['conector', `${P}-E09`, 'tipo_invalido', 'nivel']]);
    const res = await resultado(A.tenantId, r.lote_id);
    expect(res).toMatchObject({ status: 'concluido_com_erros', inativacao: { situacao: 'aplicada' } });
    const reg = await ativos(A.tenantId, 'catalogo_no');
    expect(reg.find((x) => x.external_id === `${P}-E09`)?.deleted_at).toBeNull();
    expect(reg.find((x) => x.external_id === `${P}-E10`)?.deleted_at).not.toBeNull();
    expect(nomes('integracao.catalogo_no.atualizado@1').filter((e) => e.payload.acao === 'inativado').map((e) => e.payload.external_id)).not.toContain(`${P}-E09`);
  });

  // ---------------------------------------------------------------------------------------------------------- RN-INT-12

  it('RN-INT-12: chave obrigatória e válida — sem chave, curta ou com espaço: 422 chave_idempotencia_invalida (nenhum lote criado)', async () => {
    const antes = await contarLotes(A.tenantId);
    for (const chave of [undefined, '', 'curta', 'tem espaco na chave aqui 123']) {
      const e = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'transportadora', conteudo: csvTransp([['k1', 'K']]), ...(chave === undefined ? {} : { chave_idempotencia: chave }) })));
      expect(e).toMatchObject({ status: 422, codigo: 'chave_idempotencia_invalida' });
      expect(e.message).toMatch(/chave/);
    }
    expect(await contarLotes(A.tenantId)).toBe(antes);
  });

  it('RN-INT-12: mesma chave + mesmo conteúdo repete a resposta (mesmo lote_id, repetido, sem novo evento nem novo lote — também com BOM/CRLF); conteúdo diferente = 409', async () => {
    eventos = [];
    const chave = chaveNova();
    const csv = csvTransp([['i1', 'Idem Um'], ['i2', 'Idem Dois']]);
    const a = await enviar(A.tenantId, { chave_idempotencia: chave, conteudo: csv });
    const antes = await contarLotes(A.tenantId);
    const b = await enviar(A.tenantId, { chave_idempotencia: chave, conteudo: `${BOM}${csv.replace(/\n/g, '\r\n')}` });
    expect(b).toMatchObject({ lote_id: a.lote_id, repetido: true, recebidos: 2, status: 'recebido' });
    expect(await contarLotes(A.tenantId)).toBe(antes);
    expect(nomes('integracao.lote.recebido@1')).toHaveLength(1);
    const c = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'transportadora', modo: 'delta', chave_idempotencia: chave, conteudo: csvTransp([['i1', 'Idem Um'], ['i3', 'Outro']]) })));
    expect(c).toMatchObject({ status: 409, codigo: 'chave_idempotencia_reutilizada' });
    expect(await contarLotes(A.tenantId)).toBe(antes);
  });

  it('RN-INT-12: dois envios simultâneos da mesma chave geram UM lote só', async () => {
    const chave = chaveNova();
    const csv = csvTransp([['p1', 'Paralelo Um']]);
    const [x, y] = await Promise.all([enviar(A.tenantId, { chave_idempotencia: chave, conteudo: csv }), enviar(A.tenantId, { chave_idempotencia: chave, conteudo: csv })]);
    expect(x.lote_id).toBe(y.lote_id);
    expect([x.repetido, y.repetido].filter(Boolean)).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------------------------------------- RN-INT-13

  it('RN-INT-13: entidade que o Conector do ERP já recebe (vendedor, cliente…) é recusada dizendo quem a recebe; sem Conector arquivo para a entidade, manda cadastrar um', async () => {
    const dono = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'vendedor', chave_idempotencia: chaveNova(), conteudo: 'external_id;nome\nV1;Ana\n' })));
    expect(dono).toMatchObject({ status: 422, codigo: 'entidade_de_outro_conector' });
    expect(dono.message).toMatch(new RegExp(A.integracao.identificador));
    const sem = await falha(rotaCargaArquivo.executar(ctxRota(B.tenantId, 'admin', { entidade: 'titulo', chave_idempotencia: chaveNova(), conteudo: 'external_id;cliente_external_id;numero;vencimento;valor_cents;saldo_cents;situacao\nT1;C1;1;2026-12-01;100;100;aberto\n' })));
    expect(sem).toMatchObject({ status: 422, codigo: 'sem_conector_arquivo' });
    expect(sem.message).toMatch(/Integração ERP > Conectores/);
  });

  it('RN-INT-13: o lote do arquivo é do Conector arquivo — o Conector do ERP do mesmo tenant não o enxerga pelo Hub (404)', async () => {
    const r = await enviar(A.tenantId, { conteudo: csvTransp([['h1', 'Hub Um']]) });
    let status = 0;
    try {
      await consultarLote({
        tenantId: A.tenantId,
        conector: { id: A.integracao.conector, identificador: A.integracao.identificador },
        params: { id: r.lote_id },
        query: { limite_erros: 10 },
        comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, A.tenantId, (db) => fn(db, tx)),
      } as never);
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(404);
  });

  // ---------------------------------------------------------------------------------------------------------- perfil, validação, limites

  it('RF-INT-03: perfis fora de admin/analista recebem 403 PERFIL_SEM_ACESSO (defesa do handler) e nada é criado; analista e admin enviam', async () => {
    const antes = await contarLotes(A.tenantId);
    for (const perfil of ['supervisor', 'vendedor', 'gerente', 'promotor', 'assistente'] as const) {
      const e = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, perfil, { entidade: 'transportadora', chave_idempotencia: chaveNova(), conteudo: csvTransp([['x1', 'X']]) })));
      expect(e).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
    expect(await contarLotes(A.tenantId)).toBe(antes);
    await enviar(A.tenantId, { conteudo: csvTransp([['pa', 'Analista Envia']]) }, 'analista');
    await enviar(A.tenantId, { conteudo: csvTransp([['pb', 'Admin Envia']]) }, 'admin');
  });

  it('RF-INT-03: entidade/modo inválidos, cabeçalho fora do contrato, coluna obrigatória ausente e arquivo só com cabeçalho: 422 em português, sem lote', async () => {
    const antes = await contarLotes(A.tenantId);
    const casos: [Record<string, unknown>, string][] = [
      [{ entidade: 'pedido' }, 'entidade_desconhecida'],
      [{ modo: 'parcial' }, 'modo_invalido'],
      [{ conteudo: 'external_id;nom\nT1;X\n' }, 'colunas_desconhecidas'],
      [{ conteudo: 'external_id;documento\nT1;12345678000199\n' }, 'colunas_obrigatorias_ausentes'],
      [{ conteudo: 'external_id;nome\n' }, 'lote_vazio'],
      [{ conteudo: 'external_id;nome\nT1;"aberta\n' }, 'csv_invalido'],
    ];
    for (const [extra, codigo] of casos) {
      const e = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'transportadora', chave_idempotencia: chaveNova(), conteudo: csvTransp([['v1', 'V']]), ...extra })));
      expect(e, codigo).toMatchObject({ status: 422, codigo });
      expect(e.message.length).toBeGreaterThan(20);
    }
    expect(await contarLotes(A.tenantId)).toBe(antes);
  });

  it('RF-INT-03: limites do lote — linhas acima do limite do tenant e bytes acima do limite: recusados (detalhes.limite) sem criar lote', async () => {
    const antes = await contarLotes(A.tenantId);
    const linhas = csvTransp([['l1', 'L1'], ['l2', 'L2'], ['l3', 'L3']]);
    const muitas = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'transportadora', chave_idempotencia: chaveNova(), conteudo: linhas }, { parametros: () => ({ limiteRegistrosLote: 2 }) })));
    expect(muitas).toMatchObject({ status: 422, codigo: 'acima_do_limite', detalhes: { limite: true } });
    expect(muitas.message).toMatch(/3 linhas.*2/);
    const enorme = csvTransp(Array.from({ length: 30 }, (_, i): [string, string] => [`g${i}`, 'N'.repeat(60)]));
    const grande = await falha(rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'transportadora', chave_idempotencia: chaveNova(), conteudo: enorme }, { parametros: () => ({ limiteCorpoLoteBytes: 1024 }) })));
    expect(grande).toMatchObject({ status: 422, codigo: 'corpo_grande', detalhes: { limite: true } });
    expect(await contarLotes(A.tenantId)).toBe(antes);
    // exatamente no limite de linhas passa
    const noLimite = await rotaCargaArquivo.executar(ctxRota(A.tenantId, 'admin', { entidade: 'transportadora', chave_idempotencia: chaveNova(), conteudo: linhas }, { parametros: () => ({ limiteRegistrosLote: 3 }) }));
    expect((noLimite as CargaArquivoAceita).recebidos).toBe(3);
  });

  it('RF-INT-03: nada do conteúdo do arquivo (valores digitados) vai para log nem para a auditoria', async () => {
    auditorias = [];
    log.info.mockClear();
    log.warn.mockClear();
    log.error.mockClear();
    const r = await enviar(A.tenantId, { conteudo: csvTransp([['s1', SEGREDO, '12345678000199']]) });
    await aplicar(A.tenantId, r.lote_id, ID_ARQ_A);
    const vistos = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls, auditorias]);
    expect(vistos).not.toContain(SEGREDO);
    expect(vistos).not.toContain('12345678000199');
  });

  // ---------------------------------------------------------------------------------------------------------- multi-tenant

  it('multi-tenant: o tenant B não vê nem afeta o lote do A (404 no resultado e nos erros), não usa o Conector de A e a mesma chave em B é outro lote', async () => {
    const chave = chaveNova();
    const csv = csvTransp([['m1', 'Multi Um']]);
    const a = await enviar(A.tenantId, { chave_idempotencia: chave, conteudo: csv });
    await aplicar(A.tenantId, a.lote_id, ID_ARQ_A);

    const r1 = await falha(Promise.resolve(rotaLote.executar(ctxRota(B.tenantId, 'admin', undefined, { params: { id: a.lote_id }, query: { limite_erros: 10 } }))));
    expect(r1).toBeInstanceOf(ErroNaoEncontrado);
    const r2 = await falha(Promise.resolve(rotaErrosLote.executar(ctxRota(B.tenantId, 'admin', undefined, { params: { id: a.lote_id }, query: { pagina: 1, por_pagina: 10 } }))));
    expect(r2).toBeInstanceOf(ErroNaoEncontrado);
    // B escolhendo o Conector arquivo de A pelo identificador: não existe para B
    const e3 = await falha(rotaCargaArquivo.executar(ctxRota(B.tenantId, 'admin', { entidade: 'transportadora', chave_idempotencia: chaveNova(), conector_id: ID_ARQ_A, conteudo: csv })));
    expect(e3).toMatchObject({ status: 404, codigo: 'CONECTOR_NAO_ENCONTRADO' });

    // mesma chave em B (mesmo conteúdo): lote próprio, no Conector de B, sem repetir o de A
    const b = await enviar(B.tenantId, { chave_idempotencia: chave, conteudo: csv });
    expect(b.lote_id).not.toBe(a.lote_id);
    expect(b).toMatchObject({ conector_id: ID_ARQ_B });
    expect(b.repetido).toBeUndefined();
    await aplicar(B.tenantId, b.lote_id, ID_ARQ_B);
    expect((await ativos(B.tenantId)).map((x) => x.external_id)).toEqual([`${P}-m1`]);
    expect(await resultado(B.tenantId, b.lote_id)).toMatchObject({ status: 'concluido' });
    // A continua só com o seu
    const doA = await resultado(A.tenantId, a.lote_id);
    expect(doA.contagens.recebidas).toBe(1);
  });
});
