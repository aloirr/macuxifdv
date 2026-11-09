/**
 * Miniatura no pull de produto_conteudo × Postgres real (T-0097): produto com foto principal recebe miniatura válida no
 * contrato; sem foto, null; foto de outro tenant não vaza; foto removida some; `tocarConteudoPelaMidia` avança o cursor.
 * Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, LinhaSync, PedidoPull } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdutoConteudoSyncSchema } from '../contracts';
import { tocarConteudoPelaMidia } from './miniatura';
import { provedoresSyncCatalogo } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0ca00000-0000-4000-8000-${String(970000 + n).padStart(12, '0')}`;
const P_FOTO = id(1);
const P_SEM = id(2);
const P_REM = id(3);
const P_B = id(4);
const C_FOTO = id(11);
const C_SEM = id(12);
const C_REM = id(13);
const C_B = id(14);
const M_FOTO = id(21);
const M_REM = id(22);
const M_B = id(23);
const ARQ = id(31);
const IDS = [C_FOTO, C_SEM, C_REM, C_B, M_FOTO, M_REM, M_B];

describe.skipIf(semBanco())('Catálogo × Postgres: miniatura no pull de produto_conteudo (T-0097)', () => {
  let pool: pg.Pool;
  const ctx = (tenant: string): ContextoBase =>
    ({
      usuario: { perfil: 'vendedor', tenant_id: tenant },
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, tenant, (c) => fn(c)),
      carteira: async () => 'tenant',
      parametros: () => ({}),
    }) as unknown as ContextoBase;
  const pedido = { ate: '2099-01-01T00:00:00.000Z', desde: null, limite: 1000 } as unknown as PedidoPull;
  const puxar = (tenant: string) => provedoresSyncCatalogo.find((x) => x.entidade.nome === 'produto_conteudo')!.puxar!(ctx(tenant), pedido) as Promise<LinhaSync[]>;
  const miniaturaDe = async (tenant: string, conteudo: string) => ((await puxar(tenant)).find((l) => l.id === conteudo) as unknown as { miniatura: unknown } | undefined)?.miniatura;

  async function limpar() {
    for (const t of [A.tenantId, B.tenantId]) {
      await comTenant(pool, t, async (c) => {
        await c.query('delete from catalogo.produto_midia where id = any($1::uuid[])', [IDS]);
        await c.query('delete from catalogo.produto_conteudo where id = any($1::uuid[])', [IDS]);
      });
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    await limpar();
    await comTenant(pool, A.tenantId, async (c) => {
      for (const [cid, pid] of [[C_FOTO, P_FOTO], [C_SEM, P_SEM], [C_REM, P_REM]] as const) {
        await c.query('insert into catalogo.produto_conteudo (id, tenant_id, produto_id, descricao) values ($1, $2, $3, $4)', [cid, A.tenantId, pid, 'T97']);
      }
      await c.query("insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, arquivo_id, principal) values ($1, $2, $3, 'foto', $4, true)", [M_FOTO, A.tenantId, P_FOTO, ARQ]);
      await c.query("insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, url, principal) values ($1, $2, $3, 'foto', 'https://cdn.exemplo.com/a.jpg', true)", [M_REM, A.tenantId, P_REM]);
    });
    await comTenant(pool, B.tenantId, async (c) => {
      await c.query('insert into catalogo.produto_conteudo (id, tenant_id, produto_id) values ($1, $2, $3)', [C_B, B.tenantId, P_B]);
      await c.query("insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, arquivo_id, principal) values ($1, $2, $3, 'foto', $4, true)", [M_B, B.tenantId, P_B, id(32)]);
    });
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  it('T-0097: produto com foto principal recebe miniatura válida no contrato', async () => {
    const linhas = await puxar(A.tenantId);
    for (const l of linhas) ProdutoConteudoSyncSchema.parse(l);
    const m = (await miniaturaDe(A.tenantId, C_FOTO)) as { arquivo_id: string; url: string; largura: number; bytes_max: number; versao: string };
    expect(m).toMatchObject({ arquivo_id: ARQ, url: `/v1/arquivos/${ARQ}/miniatura`, largura: 320, altura: 320, bytes_max: 30720 });
    expect(m.versao.length).toBeGreaterThan(0);
    expect(ProdutoConteudoSyncSchema.parse(linhas.find((l) => l.id === C_FOTO)).miniatura).toEqual(m);
  });

  it('T-0097: URL externa da mídia é preservada', async () => {
    expect(await miniaturaDe(A.tenantId, C_REM)).toMatchObject({ arquivo_id: null, url: 'https://cdn.exemplo.com/a.jpg' });
  });

  it('T-0097: produto sem foto recebe null', async () => {
    expect(await miniaturaDe(A.tenantId, C_SEM)).toBeNull();
  });

  it('T-0097: foto de outro tenant não vaza', async () => {
    const a = await puxar(A.tenantId);
    expect(a.map((l) => l.id)).not.toContain(C_B);
    expect(JSON.stringify(a)).not.toContain(id(32));
    expect(await miniaturaDe(B.tenantId, C_B)).toMatchObject({ arquivo_id: id(32) });
  });

  it('T-0097: foto removida some e tocarConteudoPelaMidia avança o cursor do conteúdo', async () => {
    const antes = (await puxar(A.tenantId)).find((l) => l.id === C_FOTO)!.updated_at;
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query('update catalogo.produto_midia set deleted_at = $2 where id = $1', [M_FOTO, '2026-11-07T12:00:00Z']); // hora-fixa-ok: instante fixo da remoção
      await tocarConteudoPelaMidia(c, A.tenantId, P_FOTO);
    });
    const depois = (await puxar(A.tenantId)).find((l) => l.id === C_FOTO)!;
    expect(depois.updated_at > antes).toBe(true);
    expect((depois as unknown as { miniatura: unknown }).miniatura).toBeNull();
    expect((depois as unknown as { descricao: string }).descricao).toBe('T97');
  });
});
