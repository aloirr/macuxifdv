/**
 * RF-CORE-02 / R-20261120-101755 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): a busca de clientes
 * palavra por palavra em SQL, sem acento e sem caixa.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClienteListaQuerySchema } from '../contracts';
import { rotasDeClientes } from './clientes';

const A = DOIS_TENANTS.A;
const FAIXA = '0e5b0000-0000-4000-8000-0000000000';
const id = (n: number) => `${FAIXA}${String(n).padStart(2, '0')}`;

/** Massa própria (ids da faixa), apagada no fim; a busca sempre leva uma palavra exclusiva da massa para não depender do resto da fixture. */
const MASSA = [
  { id: id(1), razao_social: 'JOÃO', nome_fantasia: null, external_id: '0103', documento: '12345678000190', cidade: 'Zzcidade' },
  { id: id(2), razao_social: 'Quimera Ltda', nome_fantasia: 'Atacado Norte', external_id: 'Q-77', documento: '98765432000110', cidade: 'Zzcidade' },
  { id: id(3), razao_social: 'Zzoutro Comércio', nome_fantasia: 'Maçã Verde', external_id: '0104', documento: '11111111000111', cidade: 'Zzcidade' },
] as const;

describe.skipIf(semBanco())('Core RF-CORE-02 × Postgres: busca de clientes palavra por palavra, sem acento e sem caixa', () => {
  let pool: pg.Pool;
  const gerente: UsuarioAutenticado = { id: A.usuarios.gerente, tenant_id: A.tenantId, perfil: 'gerente' };

  const buscar = async (q: string): Promise<string[]> => {
    const r = rotasDeClientes.find((x) => x.metodo === 'GET' && x.caminho === 'clientes')!;
    const ctx = {
      usuario: gerente,
      requestId: 'req-clientes-busca',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, A.tenantId, (c) => fn(c)),
      carteira: async () => 'tenant',
    } as unknown as ContextoBase;
    const query = ClienteListaQuerySchema.parse({ q, limite: 50 });
    const resp = (await r.executar({ ...ctx, corpo: {}, query, params: {} } as never)) as { itens: { id: string }[] };
    return resp.itens.map((i) => i.id).filter((x) => x.startsWith(FAIXA));
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    await comTenant(pool, A.tenantId, async (c) => {
      for (const m of MASSA) {
        await c.query(
          `insert into core.cliente (id, tenant_id, documento, razao_social, nome_fantasia, cidade, uf, ativo, external_id)
           values ($1, $2, $3, $4, $5, $6, 'AM', true, $7)`,
          [m.id, A.tenantId, m.documento, m.razao_social, m.nome_fantasia, m.cidade, m.external_id],
        );
      }
    });
  });
  afterAll(async () => {
    await comTenant(pool, A.tenantId, (c) => c.query('delete from core.cliente where id::text like $1', [`${FAIXA}%`]));
    await pool.end();
  });

  it('RF-CORE-02: "JOAO 0103" acha a razão "JOÃO" de código 0103 (maiúscula acentuada, sem depender da collation)', async () => {
    expect(await buscar('JOAO 0103')).toEqual([id(1)]);
  });
  it('RF-CORE-02: "maca verde" acha a fantasia "Maçã Verde" (acento minúsculo)', async () => {
    expect(await buscar('maca verde')).toEqual([id(3)]);
  });
  it('RF-CORE-02: "JOAO 9999" não acha (todas as palavras precisam casar)', async () => {
    expect(await buscar('JOAO 9999')).toEqual([]);
  });
  it('RF-CORE-02: "quimera atacado" acha com uma palavra na razão e a outra na fantasia', async () => {
    expect(await buscar('quimera atacado')).toEqual([id(2)]);
  });
  it('RF-CORE-02: a cidade não casa', async () => {
    expect(await buscar('zzcidade')).toEqual([]);
  });
  it('RF-CORE-02: CNPJ por palavra, com e sem máscara; menos de 3 dígitos não busca documento', async () => {
    expect(await buscar('joao 12.345')).toEqual([id(1)]);
    expect(await buscar('joao 12345')).toEqual([id(1)]);
    expect(await buscar('joao 98')).toEqual([]);
  });
  it('RF-CORE-02: "Q-77 atacado" acha pelo código e pela fantasia', async () => {
    expect(await buscar('Q-77 atacado')).toEqual([id(2)]);
  });
});
