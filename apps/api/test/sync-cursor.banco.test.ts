/**
 * T-0199 × Postgres real: o cursor do pull segue a ordem da SQL dos provedores, `(updated_at, id)` em microssegundos.
 * Com o `compararCursor` em milissegundos, a página reordenava as linhas da mesma milissegundo pelo id, o cursor saía de
 * outra linha e o pull pulava linhas. Usa o provedor real de `condicao_pagamento` (vendedor) e o miolo real da rota
 * (`paginaDoPull`), com o laço do motor (próximo cursor ou o da última linha). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { apiVendedor } from '@macuxi/vendedor/api';
import { codificarCursor, decodificarCursor, type CursorSync, TAMANHO_PAGINA_SYNC, type ContextoBase, type LinhaSync, type ProvedorSync } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp, type BancoApp } from '../src/banco';
import { paginaDoPull } from '../src/sync';

const A = DOIS_TENANTS.A.tenantId;

describe.skipIf(semBanco())('cursor do pull em microssegundos × Postgres (T-0199)', () => {
  let poolApp: pg.Pool;
  let app: BancoApp;
  let prov: ProvedorSync;
  let ctx: ContextoBase;
  const gravados: string[] = [];

  /** Linhas de condição de pagamento do tenant A no ano 2000, antes de toda a fixture (o horizonte do teste as isola). */
  const gravar = async (linhas: { id: string; ts: string }[]) => {
    gravados.push(...linhas.map((l) => l.id));
    await app.comTenant(A, (db) =>
      db.query(
        `insert into vendedor.condicao_pagamento (id, tenant_id, codigo, descricao, updated_at)
         select id, $1, 't0199-' || id, 'T-0199', ts from unnest($2::uuid[], $3::timestamptz[]) as x(id, ts)`,
        [A, linhas.map((l) => l.id), linhas.map((l) => l.ts)],
      ),
    );
  };

  /** Rota /v1/sync/pull (paginaDoPull) + laço do motor, até o próximo cursor nulo. */
  const puxarTudo = async (ate: string) => {
    const recebidos: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const desde: CursorSync | null = cursor ? decodificarCursor(cursor) : null;
      const linhas: LinhaSync[] = await prov.puxar!(ctx, { desde, ate, limite: TAMANHO_PAGINA_SYNC + 1 });
      const pagina: { itens: LinhaSync[]; proximo: string | null } = paginaDoPull(linhas, desde, ate);
      const { itens, proximo } = pagina;
      recebidos.push(...itens.map((l) => l.id));
      const ultimo: LinhaSync | undefined = itens[itens.length - 1];
      cursor = proximo ?? (ultimo ? codificarCursor(ultimo) : cursor);
      if (!proximo) break;
    }
    return recebidos;
  };

  beforeAll(() => {
    poolApp = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    app = criarBancoApp(poolApp);
    prov = apiVendedor.sync!.find((p) => p.entidade.nome === 'condicao_pagamento')!;
    // o provedor de condicao_pagamento só usa o `db` da transação
    const comTenant: ContextoBase['comTenant'] = (fn) => app.comTenant(A, (db) => fn(db, {} as never));
    ctx = { comTenant } as Partial<ContextoBase> as ContextoBase;
  });
  afterEach(async () => {
    const ids = gravados.splice(0);
    await app.comTenant(A, (db) => db.query('delete from vendedor.condicao_pagamento where id = any($1::uuid[])', [ids]));
  });
  afterAll(async () => {
    await poolApp?.end();
  });

  it('C1: B (.123456, id ffff…) na posição 1000 e A (.123789, id 0000…) na 1001 da SQL: as duas vêm, sem repetição', async () => {
    const antes = Array.from({ length: TAMANHO_PAGINA_SYNC - 1 }, (_, i) => ({
      id: randomUUID(),
      ts: new Date(Date.UTC(2000, 0, 1, 10, 0, 0) + i).toISOString(),
    }));
    const B = `ffffffff-ffff-4fff-bfff-${randomUUID().slice(-12)}`;
    const Aid = `00000000-0000-4000-8000-${randomUUID().slice(-12)}`;
    await gravar([...antes, { id: B, ts: '2000-01-01T11:00:00.123456Z' }, { id: Aid, ts: '2000-01-01T11:00:00.123789Z' }]);

    const recebidos = await puxarTudo('2000-01-02T00:00:00.000Z');
    expect(recebidos).toContain(B);
    expect(recebidos).toContain(Aid);
    expect(recebidos).toHaveLength(TAMANHO_PAGINA_SYNC + 1);
    expect(new Set(recebidos).size).toBe(recebidos.length);
  });

  it('C2 curto: 1500 linhas em 1,5 ms, uma por µs, com o id na ordem inversa do instante: todas vêm, sem repetição', async () => {
    const base = Date.UTC(2000, 0, 3, 10, 0, 0);
    const linhas = Array.from({ length: 1500 }, (_, i) => {
      const us = i;
      const ms = new Date(base + Math.floor(us / 1000)).toISOString().replace('Z', '');
      return { id: `c2c2c2c2-0000-4000-8000-${(1499 - i).toString(16).padStart(12, '0')}`, ts: `${ms}${String(us % 1000).padStart(3, '0')}Z` };
    });
    await gravar(linhas);

    const recebidos = await puxarTudo('2000-01-04T00:00:00.000Z');
    expect(recebidos.filter((id) => !linhas.some((l) => l.id === id))).toEqual([]);
    expect(new Set(recebidos).size).toBe(recebidos.length);
    expect(recebidos).toHaveLength(linhas.length);
  });
});
