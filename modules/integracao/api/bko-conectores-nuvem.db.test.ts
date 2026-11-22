/**
 * Credencial de API (`integracao.conector` com `tipo = 'nuvem'`) × Postgres real: criar mostra a chave uma vez só (RN-INT-10),
 * listar com `?tipo=` filtra, a listagem nunca traz chave nem hash, o isolamento por empresa (RLS + tenant_id) vale na listagem
 * e no PATCH (404), revogar desativa e revoga a chave, e a topologia (RN-INT-13) devolve 409 `topologia_conflitante`.
 * A permissão (`conector.gerenciar` só do admin; 403 de perfil e `MODULO_INATIVO`) é da plataforma e fica no manifesto + rota.
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConectorCriar, ConectoresQuery, type ConectorCriado, type ConectorResumo } from '../contracts';
import manifest from '../manifest';
import { criarRotasConectores } from './bko-conectores';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const P = `nuv${randomUUID().slice(0, 6)}`;
const PEPPER = 'pepper-de-teste-com-mais-de-trinta-e-dois-bytes-ok';

const rotas = criarRotasConectores({ pepper: () => PEPPER });
const rota = (metodo: string, caminho: string) => rotas.find((r) => r.metodo === metodo && r.caminho === caminho)!;

describe('RN-INT-10: permissão e declaração das rotas da credencial de API', () => {
  it('só o admin cria e revoga (conector.gerenciar); listar é do admin e do analista (monitor.ver); o portal do cliente é aceito', () => {
    expect(rota('POST', 'conectores').acao).toBe('conector.gerenciar');
    expect(rota('PATCH', 'conectores/:id').acao).toBe('conector.gerenciar');
    expect(rota('GET', 'conectores').acao).toBe('monitor.ver');
    expect(manifest.acoes['conector.gerenciar']?.perfis).toEqual(['admin']);
    expect(manifest.acoes['monitor.ver']?.perfis).toEqual(['admin', 'analista']);
    for (const r of rotas) expect(r.superAdmin).toBe('aceita');
    expect(manifest.depende).toContain('core');
  });

  it('RN-INT-10: a listagem declara o filtro tipo na query', () => {
    expect(rota('GET', 'conectores').query).toBe(ConectoresQuery);
  });
});

describe.skipIf(semBanco())('Credencial de API (tipo nuvem) × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;

  const ctx = (tenantId: string, extra: Record<string, unknown> = {}) =>
    ({
      usuario: { id: tenantId === A.tenantId ? A.usuarios.admin : B.usuarios.admin, tenant_id: tenantId, perfil: 'admin' },
      parametros: () => ({}),
      agora: () => new Date('2026-11-22T10:00:00Z'),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, { auditar: async () => undefined })),
      ...extra,
    }) as never;
  const criar = (tenantId: string, corpo: Record<string, unknown>) => rota('POST', 'conectores').executar(ctx(tenantId, { corpo: ConectorCriar.parse(corpo) })) as Promise<ConectorCriado>;
  const listar = async (tenantId: string, tipo?: 'nuvem' | 'conector') => ((await rota('GET', 'conectores').executar(ctx(tenantId, { query: tipo ? { tipo } : {} }))) as { itens: ConectorResumo[] }).itens;
  const revogar = (tenantId: string, id: string) => rota('PATCH', 'conectores/:id').executar(ctx(tenantId, { params: { id }, corpo: { ativo: false } })) as Promise<ConectorResumo>;

  let apiA: ConectorCriado;
  let apiB: ConectorCriado;
  const desativados: string[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    // a fixture já traz Conectores ativos cobrindo as entidades (RN-INT-13): desativa-os só durante o arquivo e restaura no fim
    const { rows: semeados } = await admin.query<{ id: string }>('update integracao.conector set ativo = false where tenant_id = any($1) and ativo and deleted_at is null returning id', [[A.tenantId, B.tenantId]]);
    desativados.push(...semeados.map((r) => r.id));
    apiA = await criar(A.tenantId, { conector_id: `${P}-api-a`, nome: 'ERP por API A', tipo: 'nuvem', recebe_pedidos: false, entidades: ['cliente'] });
    apiB = await criar(B.tenantId, { conector_id: `${P}-api-b`, nome: 'ERP por API B', tipo: 'nuvem', recebe_pedidos: false, entidades: ['cliente'] });
    await criar(A.tenantId, { conector_id: `${P}-inst-a`, nome: 'Instalado A', tipo: 'conector', recebe_pedidos: false, entidades: ['produto'] });
  });
  afterAll(async () => {
    if (admin) {
      await admin.query('update integracao.conector set ativo = true where id = any($1)', [desativados]);
      await admin.query('delete from integracao.credencial where conector_id in (select id from integracao.conector where identificador like $1)', [`${P}%`]);
      await admin.query('delete from integracao.conector where identificador like $1', [`${P}%`]);
    }
    await admin?.end();
    await pool?.end();
  });

  it('RN-INT-10: criar com tipo nuvem devolve a chave em claro UMA vez; a listagem nunca traz a chave nem o hash, só o prefixo', async () => {
    expect(apiA.conector.tipo).toBe('nuvem');
    expect(apiA.chave.chave.startsWith('mxc_')).toBe(true);
    const { rows } = await admin.query<{ hash_chave: string }>('select hash_chave from integracao.credencial where conector_id = $1', [apiA.conector.id]);
    const lista = JSON.stringify(await listar(A.tenantId));
    expect(lista).not.toContain(apiA.chave.chave);
    expect(lista).not.toContain(rows[0]!.hash_chave);
    expect(lista).not.toContain('hash_chave');
    expect(lista).toContain(apiA.chave.prefixo);
  });

  it('RN-INT-10: ?tipo=nuvem traz só as credenciais de API; ?tipo=conector só os instalados; sem filtro, todos', async () => {
    const meus = async (tipo?: 'nuvem' | 'conector') => (await listar(A.tenantId, tipo)).map((c) => c.conector_id).filter((i) => i.startsWith(P)).sort();
    expect((await listar(A.tenantId, 'nuvem')).every((c) => c.tipo === 'nuvem')).toBe(true);
    expect((await listar(A.tenantId, 'conector')).every((c) => c.tipo === 'conector')).toBe(true);
    expect(await meus('nuvem')).toEqual([`${P}-api-a`]);
    expect(await meus('conector')).toEqual([`${P}-inst-a`]);
    expect(await meus()).toEqual([`${P}-api-a`, `${P}-inst-a`]);
  });

  it('RN-INT-10: a credencial de API ativa tem saúde ok (sem sinal de vida) mesmo sem nunca ter chamado', async () => {
    const [c] = await listar(A.tenantId, 'nuvem');
    expect(c?.ultimo_sinal_em).toBeNull();
    expect(c?.saude).toBe('ok');
  });

  it('multi-tenant: a listagem de uma empresa nunca traz credencial de outra', async () => {
    const a = (await listar(A.tenantId, 'nuvem')).map((c) => c.id);
    const b = (await listar(B.tenantId, 'nuvem')).map((c) => c.id);
    expect(a).toContain(apiA.conector.id);
    expect(a).not.toContain(apiB.conector.id);
    expect(b).toContain(apiB.conector.id);
    expect(b).not.toContain(apiA.conector.id);
  });

  it('multi-tenant: PATCH no id de outra empresa = 404 CONECTOR_NAO_ENCONTRADO e a credencial segue ativa', async () => {
    await expect(revogar(A.tenantId, apiB.conector.id)).rejects.toMatchObject({ status: 404, codigo: 'CONECTOR_NAO_ENCONTRADO' });
    expect((await listar(B.tenantId, 'nuvem')).find((c) => c.id === apiB.conector.id)?.ativo).toBe(true);
  });

  it('RN-INT-13: a credencial de API que repete entidade de outro Conector ativo = 409 topologia_conflitante', async () => {
    await expect(criar(A.tenantId, { conector_id: `${P}-api-a2`, nome: 'Repete', tipo: 'nuvem', recebe_pedidos: false, entidades: ['cliente'] })).rejects.toMatchObject({ status: 409, codigo: 'topologia_conflitante' });
  });

  it('RN-INT-10: revogar (ativo:false) desativa a credencial, revoga a chave e a saúde vira desativado', async () => {
    const r = await revogar(A.tenantId, apiA.conector.id);
    expect(r.ativo).toBe(false);
    expect(r.saude).toBe('desativado');
    expect(r.chave).toBeNull();
    const { rows } = await admin.query<{ revogada_em: Date | null }>('select revogada_em from integracao.credencial where conector_id = $1', [apiA.conector.id]);
    expect(rows.every((x) => x.revogada_em !== null)).toBe(true);
  });
});
