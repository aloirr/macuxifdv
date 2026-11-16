import type { PedidoPull } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { BYTES_MAX_MINIATURA_ARQUIVO, LADO_MINIATURA_ARQUIVO_PX, caminhoMiniaturaArquivo } from '@macuxi/platform-sdk';
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  montarUrlMiniatura,
  definirFotoPrincipal,
  definirFotosProduto,
  removerFotoPrincipal,
  SQL_APOSENTAR_FOTO_DA_ORDEM,
  SQL_APOSENTAR_FOTOS_DAS_ORDENS,
  SQL_FOTO_VIVA_COM_HASH,
  SQL_INSERIR_FOTO,
  SQL_MINIATURA_DO_CONTEUDO,
  SQL_TOCAR_CONTEUDO_PELA_MIDIA,
  tocarConteudoPelaMidia,
  type TransacaoFotos,
} from './miniatura';
import { sqlPullPreco } from './sync';

const pedido = { ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 10 } as unknown as PedidoPull;

describe('T-0097: SQL da miniatura no pull de produto_conteudo', () => {
  it('T-0097: o pull de produto_conteudo traz a coluna miniatura da foto principal viva, do mesmo tenant e produto', () => {
    const { sql } = sqlPullPreco('produto_conteudo', pedido, null);
    expect(sql).toContain(SQL_MINIATURA_DO_CONTEUDO);
    expect(sql).toMatch(/from catalogo\.produto_midia m/);
    expect(sql).toMatch(/m\.tenant_id = catalogo\.produto_conteudo\.tenant_id/);
    expect(sql).toMatch(/m\.produto_id = catalogo\.produto_conteudo\.produto_id/);
    expect(sql).toMatch(/m\.principal and m\.tipo = 'foto' and m\.deleted_at is null/);
    expect(sql).toContain("coalesce(m.url, '/v1/arquivos/' || m.arquivo_id::text || '/miniatura')");
    expect(sql).toContain(`'largura', ${LADO_MAX_MINIATURA_PX}`);
    expect(sql).toContain(`'bytes_max', ${BYTES_MAX_MINIATURA}`);
    expect(sql).toContain('as miniatura');
  });
  it('T-0097: as outras entidades do pull não ganham miniatura nem leem produto_midia', () => {
    expect(sqlPullPreco('estoque_saldo', pedido, null).sql).not.toContain('produto_midia');
  });
  it('T-0097: tocarConteudoPelaMidia faz upsert pelo índice único vivo e só avança updated_at', async () => {
    expect(SQL_TOCAR_CONTEUDO_PELA_MIDIA).toContain('on conflict (tenant_id, produto_id) where deleted_at is null');
    expect(SQL_TOCAR_CONTEUDO_PELA_MIDIA).toMatch(/do update set updated_at = /);
    expect(SQL_TOCAR_CONTEUDO_PELA_MIDIA).not.toMatch(/descricao|faq|campanha/);
    const db = { query: vi.fn(async () => ({})) };
    await tocarConteudoPelaMidia(db, 't1', 'p1');
    expect(db.query).toHaveBeenCalledWith(SQL_TOCAR_CONTEUDO_PELA_MIDIA, ['t1', 'p1']);
  });
});

const M1 = '0ca00000-0000-4000-8000-000000000011';
const M2 = '0ca00000-0000-4000-8000-000000000012';
const OLD = '0ca00000-0000-4000-8000-000000000013';
const T1 = '0ca00000-0000-4000-8000-0000000000a1';
const PR = '0ca00000-0000-4000-8000-0000000000b1';
const A1 = '0ca00000-0000-4000-8000-0000000000c1';
const LOTE = '0ca00000-0000-4000-8000-0000000000d1';
const HASH = 'a'.repeat(64);

/** Banco falso por padrão de SQL: `aposentadas` (ordem → id já viva), `hashVivo` (id da foto viva com o hash) e `falhaInsert` (erro do insert). */
function fake(o: { aposentadas?: Record<number, string>; hashVivo?: string; falhaInsert?: { code: string; constraint: string } } = {}) {
  const sqls: string[] = [];
  const eventos: { nome: string; payload: Record<string, unknown> }[] = [];
  const db = {
    query: vi.fn(async (sql: string, valores?: unknown[]) => {
      sqls.push(sql);
      if (/^select id from catalogo\.produto_midia/.test(sql)) return { rows: o.hashVivo ? [{ id: o.hashVivo }] : [] };
      if (/^update catalogo\.produto_midia set deleted_at/.test(sql) && /ordem = \$3::int and/.test(sql)) {
        const id = o.aposentadas?.[(valores as number[])[2]!];
        return { rows: id ? [{ id }] : [] };
      }
      if (/^update catalogo\.produto_midia set deleted_at/.test(sql)) return { rows: ((valores as unknown[])[2] as number[]).map((ordem) => ({ id: OLD, ordem })) };
      if (/^insert into catalogo\.produto_midia/.test(sql) && o.falhaInsert) throw Object.assign(new Error('dup'), o.falhaInsert);
      return { rows: [] };
    }),
  };
  const publicar = vi.fn(async (def: { nome: string }, payload: Record<string, unknown>) => {
    eventos.push({ nome: def.nome, payload });
    return {};
  });
  return { db, sqls, eventos, t: { db, publicar: publicar as unknown as TransacaoFotos['publicar'] } };
}

describe('T-0097 (c) e RN-CAT-14: quem grava a foto toca o conteúdo na mesma transação', () => {
  it('RN-CAT-14: definirFotosProduto aposenta a viva da ordem, insere a nova e toca o conteúdo, nessa ordem e no mesmo cliente', async () => {
    const f = fake();
    await definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 1, arquivoId: A1 }], { tipo: 'ficha' });
    expect(f.sqls[0]).toBe('savepoint foto_produto');
    expect(f.sqls[1]).toBe(SQL_APOSENTAR_FOTO_DA_ORDEM);
    expect(f.sqls[2]).toBe(SQL_INSERIR_FOTO);
    expect(f.sqls[3]).toBe('release savepoint foto_produto');
    expect(f.sqls[4]).toBe(SQL_TOCAR_CONTEUDO_PELA_MIDIA);
    expect(f.sqls).toHaveLength(5);
  });
  it('RN-CAT-14: a foto de ordem 1 é a principal; as outras ficam gravadas com a ordem e sem principal', async () => {
    const f = fake();
    const r = await definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 1, arquivoId: A1 }, { id: M2, ordem: 2, arquivoId: A1 }], { tipo: 'lote', loteId: LOTE });
    expect(r.map((x) => [x.ordem, x.resultado])).toEqual([[1, 'ligada'], [2, 'ligada']]);
    const inserts = f.db.query.mock.calls.filter((c) => c[0] === SQL_INSERIR_FOTO).map((c) => c[1] as unknown[]);
    expect(inserts.map((v) => [v[6], v[7]])).toEqual([[1, true], [2, false]]);
    expect(f.eventos.filter((e) => e.nome === 'catalogo.foto.definida@1').map((e) => [e.payload.ordem, e.payload.principal, e.payload.origem, e.payload.lote_id])).toEqual([[1, true, 'lote', LOTE], [2, false, 'lote', LOTE]]);
    expect(f.sqls.filter((s) => s === SQL_TOCAR_CONTEUDO_PELA_MIDIA)).toHaveLength(1);
  });
  it('RN-CAT-14: foto nova na mesma ordem substitui a anterior e publica foto.removida (substituida) antes de foto.definida', async () => {
    const f = fake({ aposentadas: { 1: OLD } });
    const r = await definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 1, arquivoId: A1 }], { tipo: 'ficha' });
    expect(r[0]).toMatchObject({ resultado: 'ligada', midiaId: M1, substituiuMidiaId: OLD });
    expect(f.eventos.map((e) => e.nome)).toEqual(['catalogo.foto.removida@1', 'catalogo.foto.definida@1']);
    expect(f.eventos[0]!.payload).toMatchObject({ midia_id: OLD, motivo: 'substituida', ordem: 1 });
    expect(f.eventos[1]!.payload).toMatchObject({ midia_id: M1, substituiu_midia_id: OLD, origem: 'ficha', lote_id: null });
  });
  it('RN-CAT-14: mesma imagem (hash) já viva no produto = repetida: nada é gravado, publicado nem tocado', async () => {
    const f = fake({ hashVivo: OLD });
    const r = await definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 3, arquivoId: A1, hashConteudo: HASH }], { tipo: 'lote', loteId: LOTE });
    expect(r).toEqual([{ ordem: 3, resultado: 'repetida', midiaId: OLD, substituiuMidiaId: null }]);
    expect(f.sqls).toEqual([SQL_FOTO_VIVA_COM_HASH]);
    expect(f.eventos).toEqual([]);
  });
  it('RN-CAT-14: violação 23505 do único de hash (corrida entre lotes) desfaz só aquela foto e vira repetida', async () => {
    const f = fake({ falhaInsert: { code: '23505', constraint: 'produto_midia_hash_uk' } });
    const r = await definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 1, arquivoId: A1, hashConteudo: HASH }], { tipo: 'lote', loteId: LOTE });
    expect(r[0]!.resultado).toBe('repetida');
    expect(f.sqls).toContain('rollback to savepoint foto_produto');
    expect(f.eventos).toEqual([]);
    expect(f.sqls).not.toContain(SQL_TOCAR_CONTEUDO_PELA_MIDIA);
  });
  it('RN-CAT-14: outra violação (a ordem viva é única) desfaz o savepoint e sobe para o chamador decidir', async () => {
    const f = fake({ falhaInsert: { code: '23505', constraint: 'produto_midia_ordem_foto_uk' } });
    await expect(definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 2, arquivoId: A1 }], { tipo: 'lote', loteId: LOTE })).rejects.toMatchObject({ constraint: 'produto_midia_ordem_foto_uk' });
    expect(f.sqls).toContain('rollback to savepoint foto_produto');
  });
  it('RN-CAT-14: foto sem arquivo nem endereço ou com ordem menor que 1 é recusada antes de qualquer escrita', async () => {
    const f = fake();
    await expect(definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 1 }], { tipo: 'ficha' })).rejects.toThrow(/arquivo ou o endereço/);
    await expect(definirFotosProduto(f.t, T1, PR, [{ id: M1, ordem: 0, arquivoId: A1 }], { tipo: 'ficha' })).rejects.toThrow(/ordem/);
    expect(f.db.query).not.toHaveBeenCalled();
  });
  it('T-0097: definirFotoPrincipal (ficha) delega à função única na ordem 1', async () => {
    const f = fake();
    await definirFotoPrincipal(f.t, T1, PR, { id: M1, arquivoId: A1 });
    expect(f.sqls).toContain(SQL_INSERIR_FOTO);
    expect(f.sqls.at(-1)).toBe(SQL_TOCAR_CONTEUDO_PELA_MIDIA);
    expect(f.eventos[0]).toMatchObject({ nome: 'catalogo.foto.definida@1', payload: { ordem: 1, principal: true, origem: 'ficha' } });
  });
  it('T-0097: removerFotoPrincipal aposenta a ordem 1, publica foto.removida e toca o conteúdo', async () => {
    const f = fake();
    await removerFotoPrincipal(f.t, T1, PR);
    expect(f.sqls[0]).toBe(SQL_APOSENTAR_FOTOS_DAS_ORDENS);
    expect(f.sqls.at(-1)).toBe(SQL_TOCAR_CONTEUDO_PELA_MIDIA);
    expect(f.eventos[0]).toMatchObject({ nome: 'catalogo.foto.removida@1', payload: { motivo: 'removida', ordem: 1 } });
  });
  it('T-0097: sem arquivo nem url a foto principal é recusada antes de qualquer escrita', async () => {
    const f = fake();
    await expect(definirFotoPrincipal(f.t, T1, PR, { id: M1 })).rejects.toThrow(/arquivo ou o endereço/);
    expect(f.db.query).not.toHaveBeenCalled();
  });
  it('T-0097: nenhum outro código da API escreve em produto_midia sem passar por miniatura.ts', () => {
    const dir = __dirname;
    const culpados = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'miniatura.ts')
      .filter((f) => /(insert\s+into|update|delete\s+from)\s+catalogo\.produto_midia/i.test(readFileSync(join(dir, f), 'utf8')));
    expect(culpados).toEqual([]);
  });
});

describe('T-0097 b: url da miniatura aponta para a rota reduzida', () => {
  const id = '0ca00000-0000-4000-8000-000000000003';
  it('arquivo da plataforma vira /v1/arquivos/<id>/miniatura, igual ao caminho do SDK', () => {
    expect(montarUrlMiniatura(id, null)).toBe(`/v1/arquivos/${id}/miniatura`);
    expect(montarUrlMiniatura(id, null)).toBe(caminhoMiniaturaArquivo(id));
  });
  it('url externa https continua igual e sem foto devolve nulo', () => {
    expect(montarUrlMiniatura(id, 'https://cdn.exemplo.com/a.jpg')).toBe('https://cdn.exemplo.com/a.jpg');
    expect(montarUrlMiniatura(null, null)).toBeNull();
  });
  it('os tetos do contrato são os da rota do SDK', () => {
    expect(LADO_MAX_MINIATURA_PX).toBe(LADO_MINIATURA_ARQUIVO_PX);
    expect(BYTES_MAX_MINIATURA).toBe(BYTES_MAX_MINIATURA_ARQUIVO);
  });
});
