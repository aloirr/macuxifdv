/**
 * T-0019 × Postgres real (fixture dois-tenants, RLS): caixa de notificações (RF-CORE-09). Envio com escopo por
 * `usuariosVisiveis` (RN-CORE-04), idempotência pelo `id` do envio, pull só do próprio usuário, leitura pelo aparelho
 * (`notificacao_leitura`), isolamento entre tenants (RN-CORE-05) e evento sem título/corpo. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, type AcessoBanco, type ClienteBanco, type ContextoBase, type ItemPush, type LinhaSync, type PedidoPull, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificacaoSyncSchema } from '../contracts';
import { provedoresDeNotificacao, rotasDeNotificacoes } from './notificacoes';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const id = (n: number) => `0e400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const titulos = (l: LinhaSync[]) => l.map((x) => (x as unknown as { titulo: string }).titulo);

describe.skipIf(semBanco())('Core T-0019 × Postgres: central de notificações', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const eventos: Array<{ nome: string; payload: Record<string, unknown> }> = [];
  const usuario = (uid: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id: uid, tenant_id: tenant, perfil });
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const vendedor2 = usuario(U.vendedor2, 'vendedor');
  const supervisor = usuario(U.supervisor, 'supervisor');
  const gerente = usuario(U.gerente, 'gerente');
  const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);

  function ctx(u: UsuarioAutenticado): ContextoBase {
    const tx = {
      publicar: async (def: { nome: string }, payload: Record<string, unknown>) => {
        eventos.push({ nome: def.nome, payload });
        return {};
      },
    };
    return {
      usuario: u,
      requestId: 'req-teste',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, tx)),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const rota = (metodo: string, caminho: string): RotaModulo => rotasDeNotificacoes.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  const prov = (n: string) => provedoresDeNotificacao.find((p) => p.entidade.nome === n)!;
  const puxar = (u: UsuarioAutenticado): Promise<LinhaSync[]> => prov('notificacao').puxar!(ctx(u), pedido());
  const enviar = (u: UsuarioAutenticado, n: number, extra: Record<string, unknown> = {}) =>
    chamar('POST', 'notificacoes', u, { corpo: { id: id(n), usuario_ids: [U.vendedor1], titulo: 'Reunião', corpo: 'Hoje às 9h', ...extra } });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
  });
  afterAll(async () => {
    if (pool) await comTenant(pool, A.tenantId, (c) => c.query('delete from core.notificacao where envio_id::text like $1', ['0e400000-%']));
    await pool?.end();
  });

  it('supervisor envia à equipe: o vendedor recebe no pull (schema válido), reenvio com o mesmo id não duplica e o evento não leva título nem corpo', async () => {
    expect(await enviar(supervisor, 1)).toEqual({ criadas: 1, ja_existentes: 0 });
    expect(await enviar(supervisor, 1)).toEqual({ criadas: 0, ja_existentes: 1 });
    const linhas = await puxar(vendedor1);
    for (const l of linhas) NotificacaoSyncSchema.parse(l);
    const minha = linhas.filter((l) => (l as unknown as { titulo: string }).titulo === 'Reunião');
    expect(minha).toHaveLength(1);
    expect(minha[0]).toMatchObject({ usuario_id: U.vendedor1, tipo: 'recado', origem_modulo: 'core', autor_id: U.supervisor, lida_em: null });
    const ev = eventos.filter((e) => e.nome === 'core.notificacao.criada@1');
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0]!.payload).sort()).toEqual(['notificacao_id', 'prioridade', 'tipo', 'usuario_id']);
  });

  it('escopo por usuário: outro vendedor do mesmo tenant não recebe; tenant B nunca recebe (RLS); quem tem equipe só recebe as próprias', async () => {
    await enviar(supervisor, 2, { titulo: 'Só do vendedor-1' });
    expect(titulos(await puxar(vendedor2))).not.toContain('Só do vendedor-1');
    expect(titulos(await puxar(vendedorB))).not.toContain('Só do vendedor-1');
    expect(titulos(await puxar(supervisor))).not.toContain('Só do vendedor-1');
    expect(titulos(await puxar(gerente))).not.toContain('Só do vendedor-1');
  });

  it('supervisor não envia para usuário de outra equipe nem do tenant B (403 FORA_DO_ESCOPO) e nada é gravado', async () => {
    await expect(enviar(supervisor, 3, { usuario_ids: [U.vendedor2] })).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
    await expect(enviar(supervisor, 4, { usuario_ids: [B.usuarios.vendedor] })).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
    const n = await comTenant(pool, A.tenantId, async (c) => Number((await c.query('select count(*) as n from core.notificacao where envio_id = any($1::uuid[])', [[id(3), id(4)]])).rows[0].n));
    expect(n).toBe(0);
  });

  it('gerente envia para a equipe inteira (equipe_id) abaixo dele', async () => {
    const equipe = await comTenant(pool, A.tenantId, async (c) => (await c.query<{ equipe_id: string }>('select equipe_id from core.usuario where id = $1', [U.vendedor1])).rows[0]!.equipe_id);
    const r = await chamar('POST', 'notificacoes', gerente, { corpo: { id: id(5), equipe_id: equipe, titulo: 'Equipe', corpo: 'Campanha nova', prioridade: 'alta' } });
    expect(r.criadas).toBeGreaterThanOrEqual(1);
    expect(titulos(await puxar(vendedor1))).toContain('Equipe');
  });

  it('leitura: o aparelho envia notificacao_leitura, a primeira hora vale e notificação de outro usuário é rejeitada', async () => {
    const minha = (await puxar(vendedor1)).find((l) => (l as unknown as { titulo: string }).titulo === 'Reunião')!;
    const item = (n: number, notificacaoId: string, lidaEm: string): ItemPush => ({ id: id(n), operacao: 'criar', payload: { id: id(n), notificacao_id: notificacaoId, lida_em: lidaEm } }) as unknown as ItemPush;
    const receber = (u: UsuarioAutenticado, itens: ItemPush[]) => prov('notificacao_leitura').receber!(ctx(u), itens);
    expect(await receber(vendedor1, [item(10, minha.id, '2030-01-01T10:00:00.000Z')])).toEqual([{ id: id(10), status: 'aceito' }]);
    expect(await receber(vendedor1, [item(11, minha.id, '2030-01-02T10:00:00.000Z')])).toEqual([{ id: id(11), status: 'aceito' }]);
    const lida = (await puxar(vendedor1)).find((l) => l.id === minha.id) as unknown as { lida_em: string };
    expect(lida.lida_em.startsWith('2030-01-01T10:00:00')).toBe(true);
    const outro = await receber(vendedor2, [item(12, minha.id, '2030-01-03T10:00:00.000Z')]);
    expect(outro[0]).toMatchObject({ status: 'rejeitado', codigo: 'NOTIFICACAO_NAO_ENCONTRADA' });
  });

  it('BKO: lista só as próprias, marca lida (404 para a de outro usuário) e grava o token de push só do próprio aparelho', async () => {
    const lista = await chamar('GET', 'notificacoes', vendedor1, { query: { nao_lidas: 'true' } });
    expect(lista.itens.length).toBeGreaterThan(0);
    expect(lista.itens.every((n: { usuario_id: string; lida_em: unknown }) => n.usuario_id === U.vendedor1 && n.lida_em === null)).toBe(true);
    const alvo = lista.itens[0];
    await expect(chamar('POST', 'notificacoes/:id/lida', vendedor2, { params: { id: alvo.id } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    expect(await chamar('POST', 'notificacoes/:id/lida', vendedor1, { params: { id: alvo.id } })).toEqual({ id: alvo.id, lida: true });
    const token = { dispositivo_id: A.dispositivos.vendedor1, token: 'ExponentPushToken[abc]', plataforma: 'android' };
    expect(await chamar('PUT', 'dispositivos/atual/push', vendedor1, { corpo: token })).toEqual({ ok: true });
    await expect(chamar('PUT', 'dispositivos/atual/push', vendedor2, { corpo: token })).rejects.toBeInstanceOf(ErroNaoEncontrado);
  });
  it('T-0016 §5.5: remetente e quem tem escopo veem lida/não lida por destinatário; outros e o tenant B não veem nada', async () => {
    await enviar(supervisor, 20, { titulo: 'Visível ao remetente' });
    const lista = (u: UsuarioAutenticado) => chamar('GET', 'notificacoes/enviadas', u).then((r) => r.itens as Array<{ titulo: string; destinatario_id: string; lida_em: string | null }>);
    const doSup = (await lista(supervisor)).find((i) => i.titulo === 'Visível ao remetente')!;
    expect(doSup).toMatchObject({ destinatario_id: U.vendedor1, lida_em: null });
    const alvo = (await puxar(vendedor1)).find((l) => (l as unknown as { titulo: string }).titulo === 'Visível ao remetente')!;
    await prov('notificacao_leitura').receber!(ctx(vendedor1), [{ id: id(21), operacao: 'criar', payload: { id: id(21), notificacao_id: alvo.id, lida_em: '2030-02-01T10:00:00.000Z' } } as unknown as ItemPush]);
    expect((await lista(supervisor)).find((i) => i.titulo === 'Visível ao remetente')!.lida_em).toBe('2030-02-01T10:00:00.000000Z');
    // gerente tem escopo sobre o vendedor1 (equipe abaixo): vê, mesmo sem ser o autor
    expect((await lista(gerente)).some((i) => i.titulo === 'Visível ao remetente')).toBe(true);
    // supervisor sem escopo sobre vendedor2: o recado do gerente a ele não aparece para o supervisor, mas aparece para o gerente
    await chamar('POST', 'notificacoes', gerente, { corpo: { id: id(22), usuario_ids: [U.vendedor2], titulo: 'Só gerente e escopo', corpo: 'x' } });
    expect((await lista(supervisor)).some((i) => i.titulo === 'Só gerente e escopo')).toBe(false);
    expect((await lista(gerente)).some((i) => i.titulo === 'Só gerente e escopo')).toBe(true);
    expect(rota('GET', 'notificacoes/enviadas').acao).toBe('notificacao.enviar');
    // tenant B: nada do tenant A (RLS)
    const gerenteB = usuario(B.usuarios.admin, 'admin', B.tenantId);
    expect((await lista(gerenteB)).some((i) => i.titulo === 'Visível ao remetente')).toBe(false);
  });
});
