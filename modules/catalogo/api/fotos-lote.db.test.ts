/**
 * T-0174 × Postgres real (fixture dois-tenants, RLS): fotos dos produtos em lote por ZIP (RN-CAT-14, ADR 0058).
 * Cobre o isolamento entre tenants nas rotas e nas tabelas, os únicos do banco (ZIP repetido, mesmo arquivo, ordem repetida no
 * lote), o ponta a ponta com um ZIP pequeno (rotas criar/enfileirar + trabalho `processar_foto_lote` + relatório) e o pull de
 * `produto_conteudo` com a miniatura da ordem 1. O armazenamento e o leitor de ZIP são da plataforma (`apps/api`): aqui o ZIP
 * é montado em memória e as fotos passam pela mesma conferência de assinatura. Cada caso roda numa transação desfeita no fim.
 * Pula sem Postgres (no CI, `MACUXI_PG_EXIGIR=1` transforma o pulo em falha).
 */
import { createHash } from 'node:crypto';
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import {
  detectarTipoImagem,
  type ContextoBase,
  type ContextoRota,
  type ContextoTrabalho,
  type EntradaZip,
  type LinhaSync,
  type PedidoPull,
  type RotaModulo,
  type TipoImagem,
  type ZipAberto,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProdutoConteudoSyncSchema, type FotoLote, type FotoLoteItensSaida } from '../contracts';
import { criarRotasFotosLote } from './fotos-lote';
import { provedoresSyncCatalogo } from './sync';
import { trabalhoProcessarFotoLote } from './trabalho-fotos-lote';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0ca00000-0000-4000-8000-${String(174000 + n).padStart(12, '0')}`;
const LOTE1 = id(1);
const LOTE2 = id(2);
const LOTE3 = id(3);
const ZIP1 = id(11);
const ZIP2 = id(12);
const ZIP3 = id(13);
const P_A1 = id(21);
const P_B2 = id(22);
const P_AB1 = id(23);
const P_AB2 = id(24);
const AGORA = new Date('2026-11-15T12:00:00Z');

interface Produto {
  id: string;
  sku: string;
  ean: string | null;
  ativo: boolean;
}
const PRODUTOS: Produto[] = [
  { id: P_A1, sku: 'A1', ean: null, ativo: true },
  { id: P_B2, sku: 'B2', ean: '7891234567895', ativo: true },
  { id: P_AB1, sku: 'AB', ean: null, ativo: true },
  { id: P_AB2, sku: 'ab', ean: null, ativo: true },
];

/** Bytes com a assinatura de cada formato; `semente` muda o conteúdo (e o SHA-256). */
const jpeg = (semente: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, semente, semente, semente]);
const png = (semente: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, semente, semente]);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

interface ArquivoDoZip {
  caminho: string;
  bytes?: Buffer;
  pasta?: boolean;
}

/** O ZIP do ponta a ponta: 12 entradas, 10 consideradas (a pasta e o `__MACOSX` são ignorados). */
const ZIP_PEQUENO: ArquivoDoZip[] = [
  { caminho: 'fotos/', pasta: true }, // 0 ignorada
  { caminho: 'fotos/A1.jpg', bytes: jpeg(1) }, // 1 ligada A1 ordem 1
  { caminho: 'A1_2.jpg', bytes: jpeg(2) }, // 2 ligada A1 ordem 2
  { caminho: 'a1_3.jpg', bytes: jpeg(3) }, // 3 ligada A1 ordem 3 (sem diferenciar maiúsculas)
  { caminho: 'A1_4.jpg', bytes: jpeg(1) }, // 4 repetida: mesma imagem do A1.jpg
  { caminho: '7891234567895.png', bytes: png(5) }, // 5 ligada B2 ordem 1 (pelo EAN)
  { caminho: 'B2_1.jpg', bytes: jpeg(6) }, // 6 recusada: B2 ordem 1 já ocupada neste ZIP
  { caminho: 'Ab.jpg', bytes: jpeg(7) }, // 7 ambígua: AB e ab
  { caminho: 'ZZ9.jpg', bytes: jpeg(8) }, // 8 sem produto
  { caminho: 'A1_5.png', bytes: Buffer.from('isto não é uma imagem') }, // 9 recusada: o conteúdo não é PNG (o tipo é lido ao ligar ao produto)
  { caminho: '../fuga.jpg', bytes: jpeg(9) }, // 10 recusada: caminho inválido
  { caminho: '__MACOSX/._A1.jpg', bytes: jpeg(10) }, // 11 ignorada
];

function montarZip(arquivos: readonly ArquivoDoZip[]): ZipAberto {
  const entradas: EntradaZip[] = arquivos.map((a, indice) => {
    const n = a.bytes?.length ?? 0;
    return { indice, caminho: a.caminho, pasta: a.pasta === true, metodo: 8, criptografada: false, compactado: n, descompactado: n, crc32: 0 };
  });
  const todos = Buffer.concat(arquivos.map((a) => a.bytes ?? Buffer.alloc(0)));
  const nomes = arquivos.map((a) => a.caminho).join('|');
  return {
    sha256: sha(Buffer.concat([todos, Buffer.from(nomes)])),
    tamanho_bytes: todos.length,
    entradas,
    ler: async (indice, op) => {
      const bytes = arquivos[indice]?.bytes;
      if (!bytes) return { ok: false, motivo: 'arquivo_vazio', tipo_detectado: null };
      const tipo = detectarTipoImagem(bytes);
      if (!tipo || !op.tipos.includes(tipo)) return { ok: false, motivo: 'tipo_nao_aceito', tipo_detectado: tipo };
      return { ok: true, bytes, sha256: sha(bytes), tipo, largura: 10, altura: 10 };
    },
    fechar: async () => undefined,
  };
}

describe.skipIf(semBanco())('Catálogo T-0174 × Postgres: fotos em lote por ZIP', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await pool.end();
  });

  interface Teste {
    c: pg.PoolClient;
    eventos: Array<{ nome: string; payload: Record<string, unknown> }>;
    /** Muda o tenant da mesma transação (a RLS passa a valer para o outro). */
    como(tenant: string): Promise<void>;
    chamar<T = unknown>(metodo: string, caminho: string, e?: { corpo?: unknown; params?: unknown; query?: unknown }): Promise<T>;
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
    /** Roda um SQL que deve falhar sem derrubar a transação; devolve o código do erro do Postgres. */
    falha(sql: string, v?: unknown[]): Promise<string | undefined>;
    /** Roda o trabalho do lote até o fim, como o worker (uma fatia por chamada). */
    processar(lote: string, arquivoId: string, zip: ZipAberto): Promise<void>;
    registrados: string[];
  }

  async function emTransacao(tenant: string, fn: (t: Teste) => Promise<void>): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, tenant);
      let atual = tenant;
      const eventos: Teste['eventos'] = [];
      const registrados: string[] = [];
      const tx = {
        publicar: vi.fn(async (def: { nome: string }, payload: Record<string, unknown>) => {
          eventos.push({ nome: def.nome, payload });
          return {};
        }),
        auditar: vi.fn(async () => undefined),
        consultar: vi.fn(async (_def: unknown, e: { codigos: string[] }) => ({
          produtos: PRODUTOS.filter((p) => e.codigos.some((k) => k === p.sku || k.toLowerCase() === p.sku.toLowerCase() || k === p.ean)),
        })),
        registrarArquivo: vi.fn(async (a: { id: string }) => {
          registrados.push(a.id);
          return { criado: true };
        }),
        // o PUT das partes e o concluir são da plataforma: o ZIP do teste já está "recebido"
        infoArquivo: vi.fn(async (arquivoId: string) => ({ id: arquivoId, tipo: 'application/zip', situacao: 'recebido', tamanho_bytes: 1000, entidade: 'foto_lote', entidade_id: id(0), enviado_por: A.usuarios.analista })),
      };
      const rotas = criarRotasFotosLote();
      const chamar: Teste['chamar'] = async <T,>(metodo: string, caminho: string, e: { corpo?: unknown; params?: unknown; query?: unknown } = {}): Promise<T> => {
        const rota = rotas.find((r) => r.metodo === metodo && r.caminho === caminho) as RotaModulo;
        const ctx = {
          usuario: { id: A.usuarios.analista, tenant_id: atual, perfil: 'analista', modulos: ['core', 'catalogo'] },
          agora: () => AGORA,
          fuso: () => 'America/Manaus',
          parametros: () => ({}),
          comTenant: async (fn2: (db: unknown, tx2: unknown) => Promise<unknown>) => fn2(c, tx),
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
          corpo: rota.corpo ? rota.corpo.parse(e.corpo) : {},
          query: rota.query ? rota.query.parse(e.query ?? {}) : {},
          params: rota.params ? rota.params.parse(e.params ?? {}) : {},
        } as unknown as ContextoRota;
        return (await rota.executar(ctx as never)) as T;
      };
      const processar: Teste['processar'] = async (lote, arquivoId, zip) => {
        const ctx: ContextoTrabalho = {
          tenantId: atual,
          alvoId: lote,
          fatia: 0,
          tentativa: 0,
          emTransacao: async (fn2) => fn2({ db: c as never, publicar: tx.publicar as never, consultar: tx.consultar as never, registrarArquivo: tx.registrarArquivo as never, infoArquivo: tx.infoArquivo as never }),
          arquivos: {
            abrirZip: async (aid) => (aid === arquivoId ? { ok: true, zip } : { ok: false, motivo: 'zip_invalido' }),
            guardarImagem: async (e) => ({ ok: true, recebido: { sha256: sha(e.bytes), tamanho_bytes: e.bytes.length, largura_px: 10, altura_px: 10, tipo: e.tipo as TipoImagem, chave: `teste/${e.id}` } }),
            descartar: async () => undefined,
          },
          deveParar: () => false,
          parametros: () => ({}),
          fuso: () => 'America/Manaus',
          agora: () => AGORA,
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
        };
        for (let fatia = 0; fatia < 20; fatia++) {
          if ((await trabalhoProcessarFotoLote.executarFatia(lote, { ...ctx, fatia })) === 'concluido') return;
        }
        throw new Error('o trabalho não terminou em 20 fatias');
      };
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      const falha = async (sql: string, v: unknown[] = []) => {
        await c.query('savepoint esperado');
        try {
          await c.query(sql, v);
          await c.query('release savepoint esperado');
          return undefined;
        } catch (erro) {
          await c.query('rollback to savepoint esperado');
          return (erro as { code?: string }).code;
        }
      };
      await fn({
        c,
        eventos,
        registrados,
        como: async (t) => {
          atual = t;
          await definirTenant(c, t);
        },
        chamar,
        q,
        falha,
        processar,
      });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  }

  const criarLote = (t: Teste, lote: string, arquivo: string, nome = 'fotos.zip') =>
    t.chamar<{ lote: FotoLote; envio: { arquivo_id: string; partes: number } | null }>('POST', 'fotos-lote', { corpo: { id: lote, arquivo_id: arquivo, nome_arquivo: nome, tamanho_bytes: 1000 } });
  const enviar = async (t: Teste, lote: string, arquivo: string, nome?: string) => {
    await criarLote(t, lote, arquivo, nome);
    await t.chamar('POST', 'fotos-lote/:id/enfileirar', { params: { id: lote } });
  };

  it('RN-CAT-14: criar registra o lote e o ZIP do dono; repetir o mesmo id devolve o mesmo lote; enfileirar publica o evento uma vez', async () => {
    await emTransacao(A.tenantId, async (t) => {
      const r = await criarLote(t, LOTE1, ZIP1);
      expect(r.lote).toMatchObject({ id: LOTE1, situacao: 'aguardando_envio', nome_arquivo: 'fotos.zip', total: null });
      expect(r.envio).toMatchObject({ arquivo_id: ZIP1, partes: 1 });
      expect(t.registrados).toEqual([ZIP1]);
      expect((await criarLote(t, LOTE1, ZIP1)).lote.id).toBe(LOTE1);
      expect(await t.q('select 1 from catalogo.foto_lote where id = $1', [LOTE1])).toHaveLength(1);

      expect((await t.chamar<FotoLote>('POST', 'fotos-lote/:id/enfileirar', { params: { id: LOTE1 } })).situacao).toBe('enfileirado');
      expect((await t.chamar<FotoLote>('POST', 'fotos-lote/:id/enfileirar', { params: { id: LOTE1 } })).situacao).toBe('enfileirado');
      expect(t.eventos.filter((e) => e.nome === 'catalogo.foto_lote.enfileirado@1')).toHaveLength(1);
    });
  });

  it('RN-CAT-14: com dois lotes em processamento o terceiro é 409 LOTE_EM_ANDAMENTO', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await enviar(t, LOTE1, ZIP1);
      await enviar(t, LOTE2, ZIP2);
      await expect(criarLote(t, LOTE3, ZIP3)).rejects.toMatchObject({ status: 409, codigo: 'LOTE_EM_ANDAMENTO' });
    });
  });

  it('RN-CAT-14: dois POST simultâneos com o mesmo id (reenvio do BKO): os dois devolvem o mesmo lote, sem ID_EM_USO (trava por tenant)', async () => {
    const LOTE = id(33);
    const tentar = async (lote: string, arquivo: string) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await definirTenant(c, A.tenantId);
        const rota = criarRotasFotosLote().find((r) => r.metodo === 'POST' && r.caminho === 'fotos-lote') as RotaModulo;
        const tx = { publicar: vi.fn(), auditar: vi.fn(async () => undefined), registrarArquivo: vi.fn(async () => ({ criado: true })) };
        const ctx = {
          usuario: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista', modulos: ['core', 'catalogo'] },
          agora: () => AGORA,
          parametros: () => ({}),
          comTenant: async (fn: (db: unknown, tx2: unknown) => Promise<unknown>) => fn(c, tx),
          corpo: { id: lote, arquivo_id: arquivo, nome_arquivo: 'fotos.zip', tamanho_bytes: 1000 },
        } as unknown as ContextoRota;
        const r = await rota.executar(ctx as never);
        await c.query('commit');
        return r;
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    };
    try {
      // sem a trava, os dois não acham o lote, os dois gravam e o segundo cai no único do id (409 ID_EM_USO)
      const r = await Promise.allSettled([tentar(LOTE, id(34)), tentar(LOTE, id(34))]);
      expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
      const lotes = r.map((x) => (x as PromiseFulfilledResult<{ lote: FotoLote }>).value.lote.id);
      expect(lotes).toEqual([LOTE, LOTE]);
    } finally {
      const limpeza = await pool.connect();
      try {
        await limpeza.query('begin');
        await definirTenant(limpeza, A.tenantId);
        // hora-fixa-ok: limpeza do teste, o instante nunca é comparado
        await limpeza.query(`update catalogo.foto_lote set deleted_at = now() where id = $1::uuid`, [LOTE]);
        await limpeza.query('commit');
      } finally {
        limpeza.release();
      }
    }
  });

  it('RN-CAT-14: o mesmo id com outro arquivo ou tamanho é 409 LOTE_DIVERGENTE', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await criarLote(t, LOTE1, ZIP1);
      await expect(criarLote(t, LOTE1, ZIP2)).rejects.toMatchObject({ status: 409, codigo: 'LOTE_DIVERGENTE' });
    });
  });

  it('RN-CAT-14: RLS: o tenant B não vê, não lê, não baixa nem enfileira o lote do tenant A, e a lista de cada um traz só os seus', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await enviar(t, LOTE1, ZIP1);
      await t.q(`insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, situacao, arquivo_id, midia_id) values (plataforma.tenant_atual(), $1, 0, 'A1.jpg', 'pendente', $2, $3)`, [LOTE1, id(31), id(32)]);
      expect((await t.chamar<{ lotes: FotoLote[] }>('GET', 'fotos-lote')).lotes.map((l) => l.id)).toContain(LOTE1);

      await t.como(B.tenantId);
      expect((await t.chamar<{ lotes: FotoLote[] }>('GET', 'fotos-lote')).lotes.map((l) => l.id)).not.toContain(LOTE1);
      for (const [metodo, caminho] of [['GET', 'fotos-lote/:id'], ['GET', 'fotos-lote/:id/itens'], ['GET', 'fotos-lote/:id/relatorio.csv'], ['POST', 'fotos-lote/:id/enfileirar']] as const) {
        await expect(t.chamar(metodo, caminho, { params: { id: LOTE1 } }), `${metodo} ${caminho}`).rejects.toMatchObject({ status: 404, codigo: 'LOTE_NAO_ENCONTRADO' });
      }
      expect(await t.q('select 1 from catalogo.foto_lote where id = $1', [LOTE1])).toHaveLength(0);
      expect(await t.q('select 1 from catalogo.foto_lote_item where lote_id = $1', [LOTE1])).toHaveLength(0);
      // o tenant B também não grava com o id do A
      expect(await t.falha(`insert into catalogo.foto_lote (id, tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes) values ($1, $2, $3, $4, 'x.zip', 10)`, [id(40), A.tenantId, A.usuarios.analista, id(41)])).toBe('42501');
      expect(await t.falha(`insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, arquivo_id, midia_id) values ($1, $2, 1, 'x.jpg', $3, $4)`, [B.tenantId, LOTE1, id(42), id(43)])).toBe('23503');
      expect((await t.q('update catalogo.foto_lote set nome_arquivo = $1 where id = $2 returning id', ['invadido.zip', LOTE1])).length).toBe(0);

      await t.como(A.tenantId);
      expect((await t.chamar<FotoLote>('GET', 'fotos-lote/:id', { params: { id: LOTE1 } })).nome_arquivo).toBe('fotos.zip');
    });
  });

  it('RN-CAT-14: únicos do banco: mesmo ZIP vivo, mesmo arquivo e mesma ordem do produto no lote', async () => {
    await emTransacao(A.tenantId, async (t) => {
      const lote = (lid: string, arq: string, hash: string | null, situacao = 'aguardando_envio', dup: string | null = null) =>
        t.q(
          `insert into catalogo.foto_lote (id, tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes, sha256, situacao, duplicado_de, concluido_em)
           values ($1, plataforma.tenant_atual(), $2, $3, 'x.zip', 10, $4, $5, $6, case when $5 in ('duplicado', 'concluido') then $7::timestamptz end)`,
          [lid, A.usuarios.analista, arq, hash, situacao, dup, AGORA.toISOString()],
        );
      const h = 'a'.repeat(64);
      await lote(LOTE1, ZIP1, h);
      // dois lotes vivos com o mesmo SHA-256: o segundo é barrado; como "duplicado" (já apontando para o primeiro) é permitido
      expect(await t.falha(`insert into catalogo.foto_lote (id, tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes, sha256) values ($1, plataforma.tenant_atual(), $2, $3, 'y.zip', 10, $4)`, [LOTE2, A.usuarios.analista, ZIP2, h])).toBe('23505');
      await lote(LOTE2, ZIP2, h, 'duplicado', LOTE1);
      // o mesmo arquivo do ZIP não serve a dois lotes
      expect(await t.falha(`insert into catalogo.foto_lote (id, tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes) values ($1, plataforma.tenant_atual(), $2, $3, 'z.zip', 10)`, [LOTE3, A.usuarios.analista, ZIP1])).toBe('23505');

      const item = (indice: number, situacao: string, ordem: number | null, arquivo: string, midia: string) =>
        `insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, situacao, produto_id, produto_codigo, ordem, arquivo_id, midia_id)
         values (plataforma.tenant_atual(), '${LOTE1}', ${indice}, 'f${indice}.jpg', '${situacao}', ${ordem ? `'${P_A1}'` : 'null'}, ${ordem ? "'A1'" : 'null'}, ${ordem ?? 'null'}, '${arquivo}', '${midia}')`;
      await t.q(item(1, 'ligado', 1, id(51), id(52)));
      // outra foto "ligada" na mesma ordem do mesmo produto no mesmo lote: barrada; como "repetida" passa
      expect(await t.falha(item(2, 'ligado', 1, id(53), id(54)))).toBe('23505');
      expect(await t.falha(item(2, 'repetido', 1, id(53), id(54)))).toBeUndefined();
      // o mesmo índice do lote não repete
      expect(await t.falha(item(1, 'sem_produto', null, id(55), id(56)))).toBe('23505');
    });
  });

  it('RN-CAT-14: ponta a ponta: o ZIP vira lote, itens e fotos dos produtos; o relatório, o filtro por duas situações e o CSV batem', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await enviar(t, LOTE1, ZIP1);
      await t.processar(LOTE1, ZIP1, montarZip(ZIP_PEQUENO));

      const lote = await t.chamar<FotoLote>('GET', 'fotos-lote/:id', { params: { id: LOTE1 } });
      expect(lote).toMatchObject({ situacao: 'concluido', total: 10, totais: { pendente: 0, ligado: 4, sem_produto: 1, ambiguo: 1, recusado: 3, repetido: 1 } });

      const itens = (await t.chamar<FotoLoteItensSaida>('GET', 'fotos-lote/:id/itens', { params: { id: LOTE1 } })).itens;
      const por = (arquivo: string) => itens.find((i) => i.arquivo === arquivo)!;
      expect(por('fotos/A1.jpg')).toMatchObject({ situacao: 'ligado', produto_codigo: 'A1', ordem: 1, tipo_detectado: 'image/jpeg' });
      expect(por('A1_2.jpg')).toMatchObject({ situacao: 'ligado', produto_codigo: 'A1', ordem: 2 });
      expect(por('a1_3.jpg')).toMatchObject({ situacao: 'ligado', produto_codigo: 'A1', ordem: 3 });
      expect(por('A1_4.jpg')).toMatchObject({ situacao: 'repetido', produto_codigo: 'A1', ordem: 4 });
      expect(por('7891234567895.png')).toMatchObject({ situacao: 'ligado', produto_codigo: 'B2', ordem: 1, tipo_detectado: 'image/png' });
      expect(por('B2_1.jpg')).toMatchObject({ situacao: 'recusado', motivo: 'ordem_repetida_no_lote' });
      expect(por('Ab.jpg')).toMatchObject({ situacao: 'ambiguo', produto_id: null, codigos_candidatos: ['AB', 'ab'] });
      expect(por('ZZ9.jpg')).toMatchObject({ situacao: 'sem_produto', produto_id: null });
      expect(por('A1_5.png')).toMatchObject({ situacao: 'recusado', motivo: 'tipo_nao_aceito' });
      expect(por('../fuga.jpg')).toMatchObject({ situacao: 'recusado', motivo: 'caminho_invalido' });
      expect(itens.map((i) => i.arquivo)).not.toContain('fotos/');
      expect(itens.map((i) => i.arquivo)).not.toContain('__MACOSX/._A1.jpg');

      // o filtro do cartão "Sem produto ou ambíguas" e a paginação por índice
      const pendencias = await t.chamar<FotoLoteItensSaida>('GET', 'fotos-lote/:id/itens', { params: { id: LOTE1 }, query: { situacao: 'sem_produto,ambiguo' } });
      expect(pendencias.itens.map((i) => i.arquivo).sort()).toEqual(['Ab.jpg', 'ZZ9.jpg']);
      const pagina = await t.chamar<FotoLoteItensSaida>('GET', 'fotos-lote/:id/itens', { params: { id: LOTE1 }, query: { limite: 4 } });
      expect(pagina.itens).toHaveLength(4);
      expect(pagina.proximo).toBe(pagina.itens[3]!.indice);
      const resto = await t.chamar<FotoLoteItensSaida>('GET', 'fotos-lote/:id/itens', { params: { id: LOTE1 }, query: { apos: pagina.proximo, limite: 100 } });
      expect(resto.itens).toHaveLength(6);
      expect(resto.proximo).toBeNull();

      // as fotos dos produtos: A1 nas ordens 1 a 3 (a repetida não grava), B2 só com a do EAN (a recusada voltou atrás)
      const vivas = await t.q<{ produto_id: string; ordem: number; arquivo_id: string }>('select produto_id, ordem, arquivo_id from catalogo.produto_midia where produto_id = any($1::uuid[]) and deleted_at is null order by produto_id, ordem', [[P_A1, P_B2, P_AB1, P_AB2]]);
      expect(vivas.map((m) => `${m.produto_id === P_A1 ? 'A1' : 'B2'}:${m.ordem}`)).toEqual(['A1:1', 'A1:2', 'A1:3', 'B2:1']);
      expect((await t.q<{ n: number }>('select count(*)::int as n from catalogo.produto_midia where produto_id = $1', [P_B2]))[0]!.n).toBe(1);
      const arquivoDoEan = (await t.q<{ arquivo_id: string }>('select arquivo_id from catalogo.foto_lote_item where lote_id = $1 and caminho = $2', [LOTE1, '7891234567895.png']))[0]!.arquivo_id;
      expect(vivas.find((m) => m.produto_id === P_B2)!.arquivo_id).toBe(arquivoDoEan);

      const fim = t.eventos.filter((e) => e.nome === 'catalogo.foto_lote.concluido@1');
      expect(fim).toHaveLength(1);
      expect(fim[0]!.payload).toMatchObject({ lote_id: LOTE1, situacao: 'concluido', totais: { ligado: 4, sem_produto: 1, ambiguo: 1, recusado: 3, repetido: 1 } });

      const csv = await t.chamar<string>('GET', 'fotos-lote/:id/relatorio.csv', { params: { id: LOTE1 } });
      const linhas = csv.slice(1).trim().split('\r\n');
      expect(linhas[0]).toBe('"Arquivo";"Situação";"Motivo";"Código no nome";"Produto";"Ordem"');
      expect(linhas).toHaveLength(11);
      expect(csv).toContain('"Ab.jpg";"Ambígua";"Serve para AB e ab"');
      expect(csv).toContain('"B2_1.jpg";"Recusada";"Outra foto do ZIP tem a mesma ordem"');
      expect(csv).toContain('"../fuga.jpg";"Recusada";"Caminho inválido no ZIP"');
    });
  });

  it('RN-CAT-14: o mesmo ZIP enviado de novo vira "duplicado" do primeiro, sem gravar foto e fora da lista; o processamento repetido não duplica nada', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await enviar(t, LOTE1, ZIP1);
      await t.processar(LOTE1, ZIP1, montarZip(ZIP_PEQUENO));
      const fotos = (await t.q<{ n: number }>('select count(*)::int as n from catalogo.produto_midia where produto_id = $1', [P_A1]))[0]!.n;

      await enviar(t, LOTE2, ZIP2, 'de-novo.zip');
      await t.processar(LOTE2, ZIP2, montarZip(ZIP_PEQUENO));
      const segundo = await t.chamar<FotoLote>('GET', 'fotos-lote/:id', { params: { id: LOTE2 } });
      expect(segundo).toMatchObject({ situacao: 'duplicado', duplicado_de: LOTE1, total: null });
      expect((await t.q<{ n: number }>('select count(*)::int as n from catalogo.foto_lote_item where lote_id = $1', [LOTE2]))[0]!.n).toBe(0);
      expect((await t.q<{ n: number }>('select count(*)::int as n from catalogo.produto_midia where produto_id = $1', [P_A1]))[0]!.n).toBe(fotos);
      expect((await t.chamar<{ lotes: FotoLote[] }>('GET', 'fotos-lote')).lotes.map((l) => l.id)).toEqual(expect.arrayContaining([LOTE1]));
      expect((await t.chamar<{ lotes: FotoLote[] }>('GET', 'fotos-lote')).lotes.map((l) => l.id)).not.toContain(LOTE2);
      const fim = t.eventos.filter((e) => e.nome === 'catalogo.foto_lote.concluido@1' && e.payload.lote_id === LOTE2);
      expect(fim[0]!.payload).toMatchObject({ situacao: 'duplicado', duplicado_de: LOTE1 });

      // rodar o trabalho de novo no lote já encerrado não muda nada
      await t.processar(LOTE1, ZIP1, montarZip(ZIP_PEQUENO));
      expect((await t.q<{ n: number }>('select count(*)::int as n from catalogo.foto_lote_item where lote_id = $1', [LOTE1]))[0]!.n).toBe(10);
    });
  });

  it('RN-CAT-14: foto de ZIP novo com a mesma imagem de uma foto viva do produto sai como repetida, em outra ordem também', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await enviar(t, LOTE1, ZIP1);
      await t.processar(LOTE1, ZIP1, montarZip([{ caminho: 'A1.jpg', bytes: jpeg(1) }]));
      await enviar(t, LOTE2, ZIP2);
      await t.processar(LOTE2, ZIP2, montarZip([{ caminho: 'A1_5.jpg', bytes: jpeg(1) }, { caminho: 'A1_2.jpg', bytes: jpeg(2) }]));
      const itens = (await t.chamar<FotoLoteItensSaida>('GET', 'fotos-lote/:id/itens', { params: { id: LOTE2 } })).itens;
      expect(itens.map((i) => [i.arquivo, i.situacao])).toEqual([['A1_5.jpg', 'repetido'], ['A1_2.jpg', 'ligado']]);
      expect((await t.q<{ n: number }>('select count(*)::int as n from catalogo.produto_midia where produto_id = $1 and deleted_at is null', [P_A1]))[0]!.n).toBe(2);
    });
  });

  it('RN-CAT-14: o pull de produto_conteudo traz a miniatura da ordem 1 do lote e só do tenant dono', async () => {
    await emTransacao(A.tenantId, async (t) => {
      await enviar(t, LOTE1, ZIP1);
      await t.processar(LOTE1, ZIP1, montarZip(ZIP_PEQUENO));
      const ordem1 = (await t.q<{ arquivo_id: string }>('select arquivo_id from catalogo.produto_midia where produto_id = $1 and ordem = 1 and deleted_at is null', [P_A1]))[0]!.arquivo_id;

      const ctx = (tenant: string): ContextoBase =>
        ({
          usuario: { perfil: 'vendedor', tenant_id: tenant },
          comTenant: async (fn: (db: pg.ClientBase) => Promise<unknown>) => fn(t.c),
          carteira: async () => 'tenant',
          parametros: () => ({}),
        }) as unknown as ContextoBase;
      const pedido = { ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 1000 } as unknown as PedidoPull;
      const puxar = async () => (await provedoresSyncCatalogo.find((x) => x.entidade.nome === 'produto_conteudo')!.puxar!(ctx(A.tenantId), pedido)) as LinhaSync[];

      const linhas = await puxar();
      for (const l of linhas) ProdutoConteudoSyncSchema.parse(l);
      const a1 = linhas.find((l) => (l as unknown as { produto_id: string }).produto_id === P_A1) as unknown as { miniatura: { arquivo_id: string; url: string; largura: number } | null };
      expect(a1.miniatura).toMatchObject({ arquivo_id: ordem1, url: `/v1/arquivos/${ordem1}/miniatura`, largura: 320 });
      const b2 = linhas.find((l) => (l as unknown as { produto_id: string }).produto_id === P_B2) as unknown as { miniatura: { arquivo_id: string } | null };
      expect(b2.miniatura?.arquivo_id).toBeTruthy();

      // o tenant B não recebe o conteúdo dos produtos do A
      await t.como(B.tenantId);
      const doB = (await puxar()).map((l) => (l as unknown as { produto_id: string }).produto_id);
      expect(doB).not.toContain(P_A1);
      expect(doB).not.toContain(P_B2);
    });
  });
});
