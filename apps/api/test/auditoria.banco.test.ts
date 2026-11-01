/**
 * T-0030 D-B29 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): `GET /v1/auditoria` só devolve linhas do
 * tenant do token (RN-AUD-01), dos módulos efetivos (RN-CORE-01), dos autores visíveis ao gerente pelo serviço do Core
 * (RN-CORE-04) e com o nome do autor vindo de `core.cadastro_resumo@1` (ADR 0012). Paginação por cursor.
 * Cada execução usa uma `entidade` própria (base compartilhada com outros testes).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ModuloId, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp } from '../src/banco';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const quem: Record<string, UsuarioAutenticado> = {
  analistaA: { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' },
  gerenteA: { id: A.usuarios.gerente, tenant_id: A.tenantId, perfil: 'gerente' },
  adminB: { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' },
};
const autenticar = async (h: Readonly<Record<string, string | undefined>>) => quem[h['x-teste-usuario'] ?? ''] ?? null;
const licencas = async () => ({
  ativosNoTenant: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  doPerfil: ['core', 'catalogo', 'vendedor'] as ModuloId[],
  removidosDoUsuario: [] as ModuloId[],
  parametros: {},
});

interface Item {
  id: string;
  modulo: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  ocorrido_em: string;
}

describe.skipIf(semBanco())('GET /v1/auditoria × Postgres (T-0030 D-B29)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let app: ReturnType<typeof createApp>;
  const ENT = `teste_aud_${randomUUID().slice(0, 8)}`;
  const id = { analista: randomUUID(), vendedor: randomUUID(), sistema: randomUUID(), promotor: randomUUID(), b: randomUUID() };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    const ins = (i: string, t: string, u: string | null, modulo: string, quando: string) =>
      admin.query(
        `insert into plataforma.auditoria (id, tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, ocorrido_em)
         values ($1, $2, $3, $4, 'teste.editar', $5, null, null, '{"status":"approved"}'::jsonb, $6)`,
        [i, t, u, modulo, ENT, quando],
      );
    await ins(id.analista, A.tenantId, A.usuarios.analista, 'core', '2026-11-01T12:00:04.000Z');
    await ins(id.vendedor, A.tenantId, A.usuarios.vendedor1, 'vendedor', '2026-11-01T12:00:03.000Z');
    await ins(id.sistema, A.tenantId, null, 'core', '2026-11-01T12:00:02.000Z');
    // módulo não efetivo para ninguém aqui (licencas acima): nunca aparece
    await ins(id.promotor, A.tenantId, A.usuarios.promotor, 'promotor', '2026-11-01T12:00:01.000Z');
    await ins(id.b, B.tenantId, B.usuarios.admin, 'core', '2026-11-01T12:00:05.000Z');
    app = createApp({ banco: criarBancoApp(pool), autenticar, licencas });
  });
  afterAll(async () => {
    await app?.close();
    await admin?.end();
    await pool?.end();
  });

  const ler = async (u: string, qs = '') => {
    const r = await app.inject({ method: 'GET', url: `/v1/auditoria?entidade=${ENT}${qs}`, headers: { 'x-teste-usuario': u } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { itens: Item[]; proximo_cursor: string | null };
  };

  it('analista: só o tenant dele (RLS) e só módulos efetivos, mais recentes primeiro, com o nome do Core', async () => {
    const r = await ler('analistaA');
    expect(r.itens.map((i) => i.id)).toEqual([id.analista, id.vendedor, id.sistema]);
    expect(r.itens[0]).toMatchObject({ usuario_id: A.usuarios.analista, usuario_nome: 'Analista Alfa', modulo: 'core', ocorrido_em: '2026-11-01T12:00:04.000Z' });
    expect(r.itens[1]!.usuario_nome).toBe('Vendedor Um');
    expect(r.itens[2]!.usuario_nome).toBeNull();
    expect(r.proximo_cursor).toBeNull();
  });

  it('outro tenant não vê as linhas de A', async () => {
    expect((await ler('adminB')).itens.map((i) => i.id)).toEqual([id.b]);
  });

  it('RN-CORE-04: gerente vê só o que a equipe dele fez (sem linhas do sistema nem de fora)', async () => {
    expect((await ler('gerenteA')).itens.map((i) => i.id)).toEqual([id.vendedor]);
  });

  it('filtro por módulo e paginação por cursor', async () => {
    expect((await ler('analistaA', '&modulo=vendedor')).itens.map((i) => i.id)).toEqual([id.vendedor]);
    const p1 = await ler('analistaA', '&limite=2');
    expect(p1.itens.map((i) => i.id)).toEqual([id.analista, id.vendedor]);
    expect(p1.proximo_cursor).not.toBeNull();
    const p2 = await ler('analistaA', `&limite=2&cursor=${encodeURIComponent(p1.proximo_cursor!)}`);
    expect(p2.itens.map((i) => i.id)).toEqual([id.sistema]);
    expect(p2.proximo_cursor).toBeNull();
  });
});
