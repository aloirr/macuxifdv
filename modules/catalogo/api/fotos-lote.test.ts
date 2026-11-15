/**
 * RN-CAT-14: rotas do lote de fotos (`/v1/catalogo/fotos-lote`) com banco falso. A licença do módulo, o 403 por perfil e o RLS
 * entre tenants são do `createApp` e do Postgres (CI: `fotos-lote.db.test.ts`); aqui: a ação de cada rota no manifesto,
 * os tetos, a idempotência e o formato das respostas.
 */
import { ErroHttpModulo, LIMITES_ZIP_TETO, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { FotoLoteCriadoSchema, FotoLoteLimitesSchema, FotoLoteItensSaida, FotoLoteSchema, ROTAS_CATALOGO } from '../contracts';
import { manifest } from '../manifest';
import { MOTIVOS_FOTO_LOTE_BANCO, MOTIVOS_FOTO_LOTE_ITEM_BANCO, SITUACOES_FOTO_LOTE_BANCO, SITUACOES_FOTO_LOTE_ITEM_BANCO } from '../db/nuvem';
import { MotivoItem, MotivoLote, SituacaoItem, SituacaoLote } from '../contracts';
import { criarRotasFotosLote } from './fotos-lote';

const TENANT = '0ca00000-0000-4000-8000-0000000000a1';
const USUARIO = '0ca00000-0000-4000-8000-0000000000f1';
const LOTE = '0ca00000-0000-4000-8000-0000000000d1';
const ARQ = '0ca00000-0000-4000-8000-0000000000e1';
const rotas = criarRotasFotosLote();
const rota = (metodo: string, caminho: string): RotaModulo => rotas.find((r) => r.metodo === metodo && r.caminho === caminho)!;

interface Estado {
  lote: Record<string, unknown> | null;
  ativos?: number;
  arquivoRecebido?: boolean;
  itens?: Record<string, unknown>[];
  duplicaArquivo?: boolean;
}
function contexto(e: Estado, o: { corpo?: unknown; params?: unknown; query?: unknown } = {}) {
  const eventos: string[] = [];
  const registrados: unknown[] = [];
  const auditorias: unknown[] = [];
  const sqls: string[] = [];
  const db = {
    query: vi.fn(async (sql: string, v: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      sqls.push(s);
      if (s.startsWith('select pg_advisory_xact_lock(')) return { rows: [{}], rowCount: 1 };
      if (s.startsWith('select id, enviado_por') && s.includes('from catalogo.foto_lote where id')) return { rows: e.lote ? [e.lote] : [], rowCount: e.lote ? 1 : 0 };
      if (s.startsWith('select id, enviado_por')) return { rows: e.lote ? [e.lote] : [], rowCount: 1 };
      if (s.startsWith('select count(*)::int as n from catalogo.foto_lote where situacao')) return { rows: [{ n: e.ativos ?? 0 }], rowCount: 1 };
      if (s.startsWith('insert into catalogo.foto_lote')) {
        if (e.duplicaArquivo) throw Object.assign(new Error('dup'), { code: '23505' });
        e.lote = { id: v[0], enviado_por: v[1], arquivo_id: v[2], nome_arquivo: v[3], tamanho_bytes: String(v[4]), sha256: null, situacao: 'aguardando_envio', motivo: null, duplicado_de: null, total: null, concluido_em: null, created_at: new Date('2026-11-15T12:00:00Z') };
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('update catalogo.foto_lote set situacao')) { if (e.lote) e.lote.situacao = 'enfileirado'; return { rows: [], rowCount: 1 }; }
      if (s.startsWith('select lote_id, situacao, count(*)')) return { rows: [{ lote_id: LOTE, situacao: 'ligado', n: 3 }, { lote_id: LOTE, situacao: 'ambiguo', n: 1 }], rowCount: 2 };
      if (s.includes('from catalogo.foto_lote_item')) {
        const lim = v.length > 1 ? Number(v.at(-1)) : Infinity;
        return { rows: (e.itens ?? []).slice(0, lim), rowCount: 0 };
      }
      if (s.includes('from catalogo.foto_lote where deleted_at is null and situacao <> ')) return { rows: e.lote ? [e.lote] : [], rowCount: 1 };
      throw new Error(`SQL não previsto: ${s.slice(0, 90)}`);
    }),
  };
  const tx = {
    publicar: vi.fn(async (def: { nome: string }) => { eventos.push(def.nome); return {}; }),
    registrarArquivo: vi.fn(async (a: unknown) => { registrados.push(a); return { criado: true }; }),
    infoArquivo: vi.fn(async () => (e.arquivoRecebido ? { id: ARQ, tipo: 'application/zip', situacao: 'recebido', tamanho_bytes: 1 } : { id: ARQ, tipo: 'application/zip', situacao: 'aguardando', tamanho_bytes: null })),
    auditar: vi.fn(async (a: unknown) => { auditorias.push(a); }),
  };
  const ctx = {
    usuario: { id: USUARIO, tenant_id: TENANT, perfil: 'analista' },
    corpo: o.corpo,
    params: o.params,
    query: o.query,
    parametros: () => ({}),
    agora: () => new Date('2026-11-15T16:00:00.000Z'),
    comTenant: async (fn: (db: unknown, tx: unknown) => Promise<unknown>) => fn(db, tx),
  };
  return { ctx, eventos, registrados, auditorias, sqls, db };
}

const loteExistente = (situacao: string) => ({ id: LOTE, enviado_por: USUARIO, arquivo_id: ARQ, nome_arquivo: 'fotos.zip', tamanho_bytes: '52428800', sha256: null, situacao, motivo: null, duplicado_de: null, total: 4, concluido_em: null, created_at: '2026-11-15T12:00:00Z' });
const corpoCriar = { id: LOTE, arquivo_id: ARQ, nome_arquivo: 'fotos.zip', tamanho_bytes: 50 * 1024 * 1024 };
const exec = (r: RotaModulo, ctx: unknown) => r.executar(ctx as never);

describe('RN-CAT-14: permissão das rotas do lote', () => {
  it('RN-CAT-14: as 7 rotas exigem produto.enriquecer, que é só do analista e do admin', () => {
    expect(rotas).toHaveLength(7);
    for (const r of rotas) expect(r.acao, `${r.metodo} ${r.caminho}`).toBe('produto.enriquecer');
    expect([...manifest.acoes['produto.enriquecer']!.perfis].sort()).toEqual(['admin', 'analista']);
  });
  it('RN-CAT-14: caminhos das rotas = ROTAS_CATALOGO e o CSV sai como text/csv com nome sem dado pessoal', () => {
    const csv = rota('GET', ROTAS_CATALOGO.fotoLoteRelatorio);
    expect(csv.tipoConteudo).toBe('text/csv; charset=utf-8');
    const nome = csv.nomeArquivo as (e: { params: unknown; corpo: unknown; query: unknown }) => string;
    expect(nome({ params: { id: LOTE }, corpo: null, query: null })).toBe('fotos-lote-0ca00000.csv');
    expect(rota('POST', ROTAS_CATALOGO.fotosLote).status).toBe(201);
  });
});

describe('RN-CAT-14: limites efetivos do tenant para a tela', () => {
  it('RN-CAT-14: sem parâmetro a rota devolve os tetos da plataforma; com parâmetro menor, o do tenant', async () => {
    const c = contexto({ lote: null });
    const teto = FotoLoteLimitesSchema.parse(await exec(rota('GET', ROTAS_CATALOGO.fotoLoteLimites), c.ctx));
    expect(teto).toEqual({ bytes_zip_max: LIMITES_ZIP_TETO.bytesZipMax, arquivos_max: LIMITES_ZIP_TETO.arquivosMax, bytes_foto_max: LIMITES_ZIP_TETO.bytesEntradaMax });
    const menor = { ...c.ctx, parametros: () => ({ foto_lote_zip_max: 200 * 1024 * 1024, foto_lote_arquivos_max: 5000, foto_lote_foto_max: 10 ** 9 }) };
    expect(await exec(rota('GET', 'fotos-lote/limites'), menor)).toEqual({ bytes_zip_max: 200 * 1024 * 1024, arquivos_max: 5000, bytes_foto_max: LIMITES_ZIP_TETO.bytesEntradaMax });
    expect(c.db.query).not.toHaveBeenCalled();
  });
});

describe('RN-CAT-14: criar o lote', () => {
  it('RN-CAT-14: ZIP acima de 500 MB é 422 RN-CAT-14 (zip_grande) antes de qualquer gravação', async () => {
    const c = contexto({ lote: null }, { corpo: { ...corpoCriar, tamanho_bytes: LIMITES_ZIP_TETO.bytesZipMax + 1 } });
    await expect(exec(rota('POST', 'fotos-lote'), c.ctx)).rejects.toMatchObject({ status: 422, codigo: 'RN-CAT-14', detalhes: { motivo: 'zip_grande' } });
    expect(c.db.query).not.toHaveBeenCalled();
  });
  it('RN-CAT-14: ZIP de exatamente 500 MB cria o lote, registra o arquivo application/zip e devolve o plano de envio em partes de 8 MiB', async () => {
    const c = contexto({ lote: null }, { corpo: { ...corpoCriar, tamanho_bytes: LIMITES_ZIP_TETO.bytesZipMax } });
    const r = FotoLoteCriadoSchema.parse(await exec(rota('POST', 'fotos-lote'), c.ctx));
    expect(r.lote).toMatchObject({ id: LOTE, situacao: 'aguardando_envio', tamanho_bytes: LIMITES_ZIP_TETO.bytesZipMax });
    expect(r.envio).toEqual({ arquivo_id: ARQ, parte_bytes: 8 * 1024 * 1024, partes: 63 });
    expect(c.registrados).toEqual([{ id: ARQ, finalidade: 'foto_lote', entidade: 'foto_lote', entidade_id: LOTE, tipo: 'application/zip', cliente_id: null }]);
    expect(c.auditorias).toHaveLength(1);
  });
  it('RN-CAT-14: o mesmo id de novo devolve o lote que já existe, sem criar nem registrar de novo', async () => {
    const c3 = contexto({ lote: loteExistente('enfileirado') }, { corpo: corpoCriar });
    const r = FotoLoteCriadoSchema.parse(await exec(rota('POST', 'fotos-lote'), c3.ctx));
    expect(r.lote.id).toBe(LOTE);
    expect(r.envio).toBeNull();
    expect(c3.registrados).toEqual([]);
    expect(c3.sqls.some((s) => s.startsWith('insert into catalogo.foto_lote'))).toBe(false);
  });
  it('RN-CAT-14: a trava do tenant (pg_advisory_xact_lock) é pedida antes de ler o lote e de contar os em andamento', async () => {
    const c = contexto({ lote: null }, { corpo: corpoCriar });
    await exec(rota('POST', 'fotos-lote'), c.ctx);
    const trava = c.sqls.findIndex((s) => s.startsWith('select pg_advisory_xact_lock('));
    const leitura = c.sqls.findIndex((s) => s.includes('from catalogo.foto_lote where id'));
    const contagem = c.sqls.findIndex((s) => s.startsWith('select count(*)::int as n from catalogo.foto_lote where situacao'));
    expect(trava).toBe(0);
    expect(trava).toBeLessThan(leitura);
    expect(leitura).toBeLessThan(contagem);
    expect(c.db.query.mock.calls[trava]![1]).toEqual([TENANT]);
  });
  it('RN-CAT-14: o mesmo id com outro arquivo ou outro tamanho é 409 LOTE_DIVERGENTE, sem devolver o lote', async () => {
    const outroArquivo = contexto({ lote: loteExistente('aguardando_envio') }, { corpo: { ...corpoCriar, arquivo_id: LOTE } });
    await expect(exec(rota('POST', 'fotos-lote'), outroArquivo.ctx)).rejects.toMatchObject({ status: 409, codigo: 'LOTE_DIVERGENTE' });
    const outroTamanho = contexto({ lote: loteExistente('aguardando_envio') }, { corpo: { ...corpoCriar, tamanho_bytes: corpoCriar.tamanho_bytes + 1 } });
    await expect(exec(rota('POST', 'fotos-lote'), outroTamanho.ctx)).rejects.toMatchObject({ status: 409, codigo: 'LOTE_DIVERGENTE' });
  });
  it('RN-CAT-14: com 2 lotes em andamento o terceiro é 409 LOTE_EM_ANDAMENTO', async () => {
    const c = contexto({ lote: null, ativos: 2 }, { corpo: corpoCriar });
    await expect(exec(rota('POST', 'fotos-lote'), c.ctx)).rejects.toMatchObject({ status: 409, codigo: 'LOTE_EM_ANDAMENTO' });
    expect(c.registrados).toEqual([]);
  });
  it('RN-CAT-14: arquivo já usado por outro lote é 409 ID_EM_USO em português', async () => {
    const c = contexto({ lote: null, duplicaArquivo: true }, { corpo: corpoCriar });
    const e = await exec(rota('POST', 'fotos-lote'), c.ctx).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroHttpModulo);
    expect(e).toMatchObject({ status: 409, codigo: 'ID_EM_USO' });
  });
  it('RN-CAT-14: corpo com campo a mais ou nome vazio é recusado pelo contrato', () => {
    expect(rota('POST', 'fotos-lote').corpo!.safeParse({ ...corpoCriar, extra: 1 }).success).toBe(false);
    expect(rota('POST', 'fotos-lote').corpo!.safeParse({ ...corpoCriar, nome_arquivo: '  ' }).success).toBe(false);
  });
});


describe('RN-CAT-14: enfileirar', () => {
  it('RN-CAT-14: com o ZIP recebido enfileira, publica catalogo.foto_lote.enfileirado@1 uma vez e audita', async () => {
    const c = contexto({ lote: loteExistente('aguardando_envio'), arquivoRecebido: true }, { params: { id: LOTE } });
    const r = FotoLoteSchema.parse(await exec(rota('POST', 'fotos-lote/:id/enfileirar'), c.ctx));
    expect(r.situacao).toBe('enfileirado');
    expect(c.eventos).toEqual(['catalogo.foto_lote.enfileirado@1']);
    expect(r.totais).toMatchObject({ ligado: 3, ambiguo: 1, pendente: 0 });
    expect(c.auditorias).toHaveLength(1);
  });
  it('RN-CAT-14: envio incompleto é 409 ENVIO_INCOMPLETO e nada é publicado', async () => {
    const c = contexto({ lote: loteExistente('aguardando_envio'), arquivoRecebido: false }, { params: { id: LOTE } });
    await expect(exec(rota('POST', 'fotos-lote/:id/enfileirar'), c.ctx)).rejects.toMatchObject({ status: 409, codigo: 'ENVIO_INCOMPLETO' });
    expect(c.eventos).toEqual([]);
  });
  it('RN-CAT-14: lote já enfileirado ou adiante responde 200 sem publicar de novo', async () => {
    const c = contexto({ lote: loteExistente('processando'), arquivoRecebido: true }, { params: { id: LOTE } });
    const r = await exec(rota('POST', 'fotos-lote/:id/enfileirar'), c.ctx);
    expect((r as { situacao: string }).situacao).toBe('processando');
    expect(c.eventos).toEqual([]);
  });
  it('RN-CAT-14: lote inexistente (ou de outro tenant, que o RLS esconde) é 404 LOTE_NAO_ENCONTRADO', async () => {
    const c = contexto({ lote: null }, { params: { id: LOTE } });
    await expect(exec(rota('POST', 'fotos-lote/:id/enfileirar'), c.ctx)).rejects.toMatchObject({ status: 404, codigo: 'LOTE_NAO_ENCONTRADO' });
  });
});

describe('RN-CAT-14: consultar, itens e relatório', () => {
  const item = (indice: number, o: Record<string, unknown> = {}) => ({ indice, caminho: `f${indice}.jpg`, situacao: 'ligado', motivo: null, tipo_detectado: 'image/jpeg', codigo: `F${indice}`, ordem: 1, produto_id: ARQ, produto_codigo: `F${indice}`, codigos_candidatos: null, ...o });
  it('RN-CAT-14: itens paginam por índice: devolve o limite e o cursor do próximo; sem mais itens o cursor é nulo', async () => {
    const itens = [item(0), item(1), item(2)];
    const c = contexto({ lote: loteExistente('concluido'), itens }, { params: { id: LOTE }, query: { apos: -1, limite: 2 } });
    const r = FotoLoteItensSaida.parse(await exec(rota('GET', 'fotos-lote/:id/itens'), c.ctx));
    expect(r.itens.map((i) => i.indice)).toEqual([0, 1]);
    expect(r.proximo).toBe(1);
    const c2 = contexto({ lote: loteExistente('concluido'), itens: [item(2)] }, { params: { id: LOTE }, query: { apos: 1, limite: 2 } });
    expect(FotoLoteItensSaida.parse(await exec(rota('GET', 'fotos-lote/:id/itens'), c2.ctx))).toMatchObject({ itens: [{ indice: 2, arquivo: 'f2.jpg' }], proximo: null });
  });
  it('RN-CAT-14: o filtro por situação vai como parâmetro da consulta e a query valida a lista fechada', async () => {
    const c = contexto({ lote: loteExistente('concluido'), itens: [] }, { params: { id: LOTE }, query: { situacao: ['sem_produto', 'ambiguo'], apos: -1, limite: 100 } });
    await exec(rota('GET', 'fotos-lote/:id/itens'), c.ctx);
    const chamada = c.db.query.mock.calls.find((x) => String(x[0]).includes('from catalogo.foto_lote_item'))!;
    expect(chamada[1]).toEqual([LOTE, -1, ['sem_produto', 'ambiguo'], 101]);
    const q = rota('GET', 'fotos-lote/:id/itens').query!;
    expect(q.safeParse({ situacao: 'inventada' }).success).toBe(false);
    expect(q.safeParse({ limite: '500' }).success).toBe(false);
    expect(q.parse({})).toEqual({ apos: -1, limite: 100 });
  });
  it('RN-CAT-14: o CSV do relatório neutraliza = + - @ no início da célula e traz uma linha por arquivo', async () => {
    const itens = [item(0, { caminho: '=cmd|x.jpg', codigo: '+1' }), item(1, { caminho: '@x.jpg', situacao: 'ambiguo', produto_codigo: null, ordem: null, codigos_candidatos: ['-A', 'B'] }), item(2, { caminho: 'ok.jpg', situacao: 'recusado', motivo: 'foto_grande', produto_codigo: null, ordem: null })];
    const c = contexto({ lote: loteExistente('concluido'), itens }, { params: { id: LOTE } });
    const csv = (await exec(rota('GET', 'fotos-lote/:id/relatorio.csv'), c.ctx)) as string;
    expect(csv).toContain(`"'=cmd|x.jpg"`);
    expect(csv).toContain(`"'+1"`);
    expect(csv).toContain(`"'@x.jpg"`);
    expect(csv).toContain('"Serve para -A e B"');
    expect(csv.trim().split('\r\n')).toHaveLength(4);
    expect(csv).toContain('"Foto acima de 8 MB"');
  });
  it('RN-CAT-14: lote inexistente nos itens e no relatório é 404', async () => {
    for (const r of [rota('GET', 'fotos-lote/:id/itens'), rota('GET', 'fotos-lote/:id/relatorio.csv'), rota('GET', 'fotos-lote/:id')]) {
      const c = contexto({ lote: null }, { params: { id: LOTE }, query: { apos: -1, limite: 10 } });
      await expect(exec(r, c.ctx)).rejects.toMatchObject({ status: 404 });
    }
  });
  it('RN-CAT-14: a lista traz os lotes mais recentes com os totais e esconde duplicados e envios abandonados há mais de 24 h', async () => {
    const c = contexto({ lote: loteExistente('concluido') });
    const r = (await exec(rota('GET', 'fotos-lote'), c.ctx)) as { lotes: { id: string; totais: { ligado: number } }[] };
    expect(r.lotes).toHaveLength(1);
    expect(r.lotes[0]!.totais.ligado).toBe(3);
    const sql = c.sqls.find((s) => s.includes("situacao <> 'duplicado'"))!;
    expect(sql).toContain("not (situacao = 'aguardando_envio' and created_at < now() - make_interval");
    expect(sql).toContain('order by created_at desc');
  });
});

describe('RN-CAT-14: contrato = CHECKs da migração 0080', () => {
  it('RN-CAT-14: situações e motivos do lote e do item são exatamente as listas do banco', () => {
    expect([...SituacaoLote.options]).toEqual([...SITUACOES_FOTO_LOTE_BANCO]);
    expect([...MotivoLote.options]).toEqual([...MOTIVOS_FOTO_LOTE_BANCO]);
    expect([...SituacaoItem.options]).toEqual([...SITUACOES_FOTO_LOTE_ITEM_BANCO]);
    expect([...MotivoItem.options]).toEqual([...MOTIVOS_FOTO_LOTE_ITEM_BANCO]);
  });
});
