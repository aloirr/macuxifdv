import type { PedidoPull } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { BYTES_MAX_MINIATURA_ARQUIVO, LADO_MINIATURA_ARQUIVO_PX, caminhoMiniaturaArquivo } from '@macuxi/platform-sdk';
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarUrlMiniatura, definirFotoPrincipal, removerFotoPrincipal, SQL_MINIATURA_DO_CONTEUDO, SQL_TOCAR_CONTEUDO_PELA_MIDIA, tocarConteudoPelaMidia } from './miniatura';
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

describe('T-0097 (c): quem grava a foto principal toca o conteúdo na mesma transação', () => {
  it('T-0097: definirFotoPrincipal aposenta a anterior, insere a nova e toca o conteúdo, nessa ordem e no mesmo cliente', async () => {
    const db = { query: vi.fn(async () => ({})) };
    await definirFotoPrincipal(db, 't1', 'p1', { id: 'm1', arquivoId: 'a1' });
    const sqls = db.query.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(sqls[0]).toMatch(/^update catalogo\.produto_midia set deleted_at/);
    expect(sqls[1]).toMatch(/^insert into catalogo\.produto_midia/);
    expect(sqls[2]).toBe(SQL_TOCAR_CONTEUDO_PELA_MIDIA);
    expect(sqls).toHaveLength(3);
  });
  it('T-0097: removerFotoPrincipal aposenta e toca o conteúdo', async () => {
    const db = { query: vi.fn(async () => ({})) };
    await removerFotoPrincipal(db, 't1', 'p1');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect((db.query.mock.calls[1] as unknown as [string])[0]).toBe(SQL_TOCAR_CONTEUDO_PELA_MIDIA);
  });
  it('T-0097: sem arquivo nem url a foto principal é recusada antes de qualquer escrita', async () => {
    const db = { query: vi.fn(async () => ({})) };
    await expect(definirFotoPrincipal(db, 't1', 'p1', { id: 'm1' })).rejects.toThrow(/arquivo ou o endereço/);
    expect(db.query).not.toHaveBeenCalled();
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
