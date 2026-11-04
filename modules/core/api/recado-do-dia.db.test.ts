/**
 * T-0073 × Postgres real (fixture dois-tenants, RLS): recado do dia (RN-CORE-26). Exige a migração 0021
 * (`core.notificacao.recado_do_dia` e `recado_do_dia_por`, banco-dados). Pula só sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { type AcessoBanco, type ClienteBanco, type ContextoBase, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificacaoSyncSchema } from '../contracts';
import { dataLocal } from '../domain';
import { provedoresDeNotificacao, rotasDeNotificacoes } from './notificacoes';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const id = (n: number) => `0e900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FUSO = 'America/Manaus';

describe.skipIf(semBanco())('Core T-0073 × Postgres: recado do dia (migração 0021)', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  let agora = new Date();
  const usuario = (uid: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id: uid, tenant_id: tenant, perfil });
  const supervisor = usuario(U.supervisor, 'supervisor');
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);

  function ctx(u: UsuarioAutenticado): ContextoBase {
    return {
      usuario: u,
      requestId: 'req-recado-dia',
      agora: () => agora,
      fuso: () => FUSO,
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const rota = (metodo: string, caminho: string): RotaModulo => rotasDeNotificacoes.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const enviar = (u: UsuarioAutenticado, n: number) => chamar('POST', 'notificacoes', u, { corpo: { id: id(n), usuario_ids: [U.vendedor1], titulo: `Recado ${n}`, corpo: 'Foco no dia' } });
  const marcar = (u: UsuarioAutenticado, n: number) => chamar('PUT', 'notificacoes/envios/:envioId/recado-do-dia', u, { params: { envioId: id(n) } });
  const desmarcar = (u: UsuarioAutenticado, n: number) => chamar('DELETE', 'notificacoes/envios/:envioId/recado-do-dia', u, { params: { envioId: id(n) } });
  const puxar = (u: UsuarioAutenticado) => provedoresDeNotificacao.find((p) => p.entidade.nome === 'notificacao')!.puxar!(ctx(u), { desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    agora = new Date();
  });
  afterAll(async () => {
    if (pool) await comTenant(pool, A.tenantId, (c) => c.query('delete from core.notificacao where envio_id::text like $1', ['0e900000-%']));
    await pool?.end();
  });

  it('RN-CORE-26: supervisor marca o envio; o pull do vendedor traz recado_do_dia de hoje, autor_nome e autor_perfil; marcar de novo é idempotente', async () => {
    await enviar(supervisor, 1);
    const hoje = dataLocal(agora, FUSO);
    expect(await marcar(supervisor, 1)).toEqual({ envio_id: id(1), dia: hoje, marcadas: 1, desmarcadas_outras: 0 });
    expect(await marcar(supervisor, 1)).toMatchObject({ marcadas: 1, desmarcadas_outras: 0 });
    const linha = (await puxar(vendedor1)).map((l) => NotificacaoSyncSchema.parse(l)).find((l) => l.titulo === 'Recado 1')!;
    expect(linha).toMatchObject({ recado_do_dia: hoje, autor_perfil: 'supervisor' });
    expect(typeof linha.autor_nome).toBe('string');
  });

  it('RN-CORE-26: um recado do dia por pessoa por dia: marcar outro envio desmarca o anterior na mesma transação', async () => {
    await enviar(supervisor, 2);
    expect(await marcar(supervisor, 2)).toMatchObject({ marcadas: 1, desmarcadas_outras: 1 });
    const marcados = (await puxar(vendedor1)).map((l) => NotificacaoSyncSchema.parse(l)).filter((l) => l.recado_do_dia);
    expect(marcados.map((l) => l.titulo)).toEqual(['Recado 2']);
  });

  it('RN-CORE-26: desmarcar tira o recado do dia (idempotente); vendedor não marca (a rota exige a ação) e o outro tenant responde 404', async () => {
    expect(await desmarcar(supervisor, 2)).toEqual({ envio_id: id(2), desmarcadas: 1 });
    expect(await desmarcar(supervisor, 2)).toEqual({ envio_id: id(2), desmarcadas: 0 });
    expect(rota('PUT', 'notificacoes/envios/:envioId/recado-do-dia').acao).toBe('notificacao.recado_do_dia');
    await expect(marcar(vendedorB, 1)).rejects.toMatchObject({ codigo: 'RECADO_NAO_ENCONTRADO' });
  });

  it('RN-CORE-26: recado criado há mais de 30 dias é 422 RN-CORE-26', async () => {
    await enviar(supervisor, 3);
    await comTenant(pool, A.tenantId, (c) => c.query("update core.notificacao set created_at = now() - interval '31 days' where envio_id = $1", [id(3)]));
    await expect(marcar(supervisor, 3)).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-26' });
  });
});
