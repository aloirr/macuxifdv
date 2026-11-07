import type { PedidoPull } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../contracts';
import { SQL_MINIATURA_DO_CONTEUDO, SQL_TOCAR_CONTEUDO_PELA_MIDIA, tocarConteudoPelaMidia } from './miniatura';
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
    expect(sql).toContain("coalesce(m.url, '/v1/arquivos/' || m.arquivo_id::text)");
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
