/**
 * `POST /v1/integracao/conectores/:id/chave` × Postgres real (RN-INT-10): chave nova para Conector ativo já existente. A atual vira
 * `anterior` (convivência), a nova autentica, Conector inativo é recusado, outra empresa não enxerga o Conector (404) e a auditoria
 * nunca leva a chave. Só chaves geradas no próprio teste (pepper fictício). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChaveNovaConector } from '../contracts';
import { manifest } from '../manifest';
import { criarRotasConectores } from './bko-conectores';
import { hashDaChave } from './chave';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const PEPPER = 'pepper-ficticio-so-de-teste-0123456789abcdef';
const P = `v1021chv${randomUUID().slice(0, 6)}`;
const AGORA = new Date('2099-06-01T12:00:00Z');

describe.skipIf(semBanco())('Chave nova do Conector × Postgres (RN-INT-10)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let conectorId = '';
  let inativoId = '';
  const auditorias: unknown[] = [];
  const logs: unknown[] = [];
  const rota = criarRotasConectores({ pepper: () => PEPPER }).find((r) => r.metodo === 'POST' && r.caminho === 'conectores/:id/chave')!;

  const chamar = (tenantId: string, id: string, corpo: unknown = undefined, perfil = 'admin') =>
    rota.executar({
      usuario: { id: tenantId === A.tenantId ? A.usuarios.admin : B.usuarios.admin, tenant_id: tenantId, perfil },
      params: { id },
      corpo,
      parametros: () => ({}),
      agora: () => AGORA,
      log: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a) },
      comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, { auditar: async (r: unknown) => void auditorias.push(r) })),
    } as never) as Promise<ChaveNovaConector>;

  const autentica = async (chave: string) => (await admin.query('select papel, anterior_valida_ate, revogada_em from integracao.autenticar_chave($1)', [hashDaChave(PEPPER, chave)])).rows[0];
  const semente = async (id: string, ident: string, ativo: boolean, chave: string) => {
    await admin.query("insert into integracao.conector (id, tenant_id, identificador, nome, tipo, recebe_pedidos, entidades, ativo) values ($1, $2, $3, 'Chave', 'conector', false, array['cliente'], $4)", [id, A.tenantId, ident, ativo]);
    await admin.query("insert into integracao.credencial (tenant_id, conector_id, prefixo, hash_chave, papel) values ($1, $2, 'mxc_semE', $3, 'atual')", [A.tenantId, id, hashDaChave(PEPPER, chave)]);
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    conectorId = randomUUID();
    inativoId = randomUUID();
    await semente(conectorId, `${P}-a`, true, 'chave-velha-de-teste');
    await semente(inativoId, `${P}-i`, false, 'chave-inativo-de-teste');
  });
  afterAll(async () => {
    if (admin) {
      await admin.query('delete from integracao.credencial where conector_id = any($1)', [[conectorId, inativoId]]);
      await admin.query('delete from integracao.conector where id = any($1)', [[conectorId, inativoId]]);
    }
    await admin?.end();
    await pool?.end();
  });

  it('RN-INT-10: o admin do tenant B não troca a chave do Conector do tenant A (404) e nada muda', async () => {
    await expect(chamar(B.tenantId, conectorId)).rejects.toMatchObject({ status: 404 });
    expect((await admin.query('select count(*)::int as n from integracao.credencial where conector_id = $1', [conectorId])).rows[0].n).toBe(1);
  });

  it('RN-INT-10: Conector inativo é recusado com 409 e não ganha chave', async () => {
    await expect(chamar(A.tenantId, inativoId)).rejects.toMatchObject({ status: 409, codigo: 'conector_inativo' });
    expect((await admin.query('select count(*)::int as n from integracao.credencial where conector_id = $1', [inativoId])).rows[0].n).toBe(1);
  });

  it('RN-INT-10: perfil não-admin é recusado pela ação conector.gerenciar (só admin)', async () => {
    const perfis = (manifest as { acoes?: Record<string, { perfis: string[] }> }).acoes?.[rota.acao as string]?.perfis;
    expect(rota.acao).toBe('conector.gerenciar');
    expect(perfis).toEqual(['admin']);
  });

  it('RN-INT-10: gera chave nova, a anterior segue válida por 24 h (padrão), a nova autentica e a auditoria não leva a chave', async () => {
    const r = await chamar(A.tenantId, conectorId);
    expect(r).toMatchObject({ conector_id: `${P}-a`, escopo: 'integracao.v1', anterior_valida_ate: '2099-06-02T12:00:00.000Z', criada_em: AGORA.toISOString() });
    expect(r.chave.length).toBeGreaterThanOrEqual(32);
    expect(r.prefixo).toBe(r.chave.slice(0, 8));
    expect(await autentica(r.chave)).toMatchObject({ papel: 'atual', revogada_em: null });
    expect(await autentica('chave-velha-de-teste')).toMatchObject({ papel: 'anterior', revogada_em: null });
    expect((await autentica('chave-velha-de-teste')).anterior_valida_ate.toISOString()).toBe('2099-06-02T12:00:00.000Z');
    const texto = JSON.stringify([auditorias, logs]);
    expect(texto).not.toContain(r.chave);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'conector.chave_gerar', depois: { prefixo: r.prefixo } });
  });

  it('RN-INT-10: nova troca dentro da convivência revoga a anterior antiga (no máximo duas válidas); convivência 0 revoga na hora', async () => {
    const r = await chamar(A.tenantId, conectorId, { convivencia_min: 0 });
    expect(r.anterior_valida_ate ?? null).toBeNull();
    expect((await autentica('chave-velha-de-teste')).revogada_em).not.toBeNull();
    const validas = (await admin.query('select count(*)::int as n from integracao.credencial where conector_id = $1 and revogada_em is null', [conectorId])).rows[0].n;
    expect(validas).toBe(1);
    expect(await autentica(r.chave)).toMatchObject({ papel: 'atual' });
  });
});
