/**
 * RN-CORE-04 / T-0168 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): `GET clientes/:id/carteira` do Gestão.
 * Quem atende o cliente vem do servidor; escopo de carteira e outro tenant recusam. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, type AcessoBanco, type ClienteBanco, type ContextoBase, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarteiraClienteRespostaSchema } from '../contracts';
import { carteiraDoUsuario } from './carteira';
import { rotasDeCarteiraDoCliente } from './carteira-cliente';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;

describe.skipIf(semBanco())('Core RN-CORE-04 × Postgres: carteira do cliente na ficha do Gestão', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const chamar = (u: UsuarioAutenticado, id: string) => {
    const r = rotasDeCarteiraDoCliente[0]!;
    const ctx = {
      usuario: u,
      requestId: 'req-carteira-cliente',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c)),
      carteira: () => carteiraDoUsuario(u, acesso),
    } as unknown as ContextoBase;
    return r.executar({ ...ctx, corpo: {}, query: {}, params: r.params!.parse({ id }) } as never) as Promise<unknown>;
  };

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    acesso = { comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)), semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco) };
  });
  afterAll(async () => {
    await pool.end();
  });

  it('RN-CORE-04: o gerente vê vendedor-1 e promotor na carteira de c1, com o cabeçalho "Pessoa"', async () => {
    const r = CarteiraClienteRespostaSchema.parse(await chamar(usuario(U.gerente, 'gerente'), C.c1));
    expect(r.itens.map((i) => i.usuario_id).sort()).toEqual([U.vendedor1, U.promotor].sort());
    expect(r.rotulo_coluna).toBe('Pessoa');
  });
  it('RN-CORE-04: o supervisor da equipe 1 não vê o cliente c2 (fora do escopo): 404', async () => {
    await expect(chamar(usuario(U.supervisor, 'supervisor'), C.c2)).rejects.toBeInstanceOf(ErroNaoEncontrado);
  });
  it('RN-CORE-05: o admin de outro tenant não vê o cliente do tenant A (RLS: lista vazia, sem vazar vínculo)', async () => {
    const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);
    expect(CarteiraClienteRespostaSchema.parse(await chamar(adminB, C.c1)).itens).toEqual([]);
  });
});
