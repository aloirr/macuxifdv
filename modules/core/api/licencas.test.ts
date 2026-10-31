import { criarPermissoes, ErroRegraNegocio, verificarAcao, type ClienteBanco, type ContextoBase, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { carteiraDoUsuario } from './carteira';
import { rotasDeLicencas, lerEstadoDeLicencas } from './licencas';
import { moduloApi } from './index';
import { TABELAS_SYNC, sqlDoPull, provedoresSyncCore } from './sync';
import { LicencasEstadoSchema } from '../contracts';

const ADMIN = { id: '0b000000-0000-4000-8000-0000000000ad', tenant_id: '0a000000-0000-4000-8000-0000000000aa', perfil: 'admin' as const, modulos: ['core' as const] };
const USUARIO = '0b000000-0000-4000-8000-000000000001';

/** Banco falso: responde por trecho do SQL e guarda tudo o que foi executado. */
function fakeDb(respostas: Array<[RegExp, unknown[]]> = []) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      const r = respostas.find(([re]) => re.test(sql));
      const rows = (r?.[1] ?? []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}

function contexto(db: ClienteBanco, eventos: Array<{ nome: string; payload: unknown }> = []) {
  const tx = {
    publicar: async (def: { nome: string }, payload: unknown) => {
      eventos.push({ nome: def.nome, payload });
      return {} as never;
    },
  } as unknown as TransacaoTenant;
  return {
    usuario: ADMIN,
    requestId: 'req',
    agora: () => new Date('2026-10-31T12:00:00Z'),
    comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx),
    carteira: async () => 'tenant',
    log: { info() {}, warn() {}, error() {} },
  } as unknown as ContextoBase;
}

const rota = (metodo: string, caminho: string): RotaModulo => rotasDeLicencas.find((r) => r.metodo === metodo && r.caminho === caminho)!;
const executar = (r: RotaModulo, ctx: ContextoBase, extra: Record<string, unknown>) => r.executar({ ...ctx, corpo: {}, query: {}, params: {}, ...extra } as never);

describe('RF-CORE-02: administração de licenças (tenant → perfil → usuário)', () => {
  it('RN-CORE-01: o core não desliga em nenhum dos três níveis (422 antes de tocar o banco)', async () => {
    const { db, chamadas } = fakeDb();
    const ctx = contexto(db);
    for (const [caminho, params] of [
      ['licencas/tenant/:modulo', { modulo: 'core' }],
      ['licencas/perfis/:perfil/:modulo', { perfil: 'vendedor', modulo: 'core' }],
      ['licencas/usuarios/:id/:modulo', { id: USUARIO, modulo: 'core' }],
    ] as const) {
      await expect(executar(rota('PUT', caminho), ctx, { params, corpo: { ativo: false } })).rejects.toMatchObject({ codigo: 'RN-CORE-01' });
    }
    expect(chamadas).toEqual([]);
  });

  it('RN-CORE-01: desativar módulo do tenant grava, audita e publica core.usuario.modulos_alterados@1 na mesma transação', async () => {
    const { db, chamadas } = fakeDb([[/select ativo from plataforma.tenant_modulo/, [{ ativo: true }]]]);
    const eventos: Array<{ nome: string; payload: unknown }> = [];
    const r = await executar(rota('PUT', 'licencas/tenant/:modulo'), contexto(db, eventos), { params: { modulo: 'promotor' }, corpo: { ativo: false } });
    expect(r).toEqual({ nivel: 'tenant', modulo: 'promotor', ativo: false });
    expect(eventos).toEqual([{ nome: 'core.usuario.modulos_alterados@1', payload: { nivel: 'tenant', modulo: 'promotor', ativo: false, perfil: null, usuario_id: null } }]);
    expect(chamadas.some((c) => /insert into plataforma.tenant_modulo/.test(c.sql))).toBe(true);
    expect(chamadas.some((c) => /insert into plataforma.auditoria/.test(c.sql))).toBe(true);
  });

  it('RN-AUD-01: reaplicar o mesmo estado audita mas não publica evento', async () => {
    const { db } = fakeDb([[/select ativo from plataforma.tenant_modulo/, [{ ativo: false }]]]);
    const eventos: Array<{ nome: string; payload: unknown }> = [];
    await executar(rota('PUT', 'licencas/tenant/:modulo'), contexto(db, eventos), { params: { modulo: 'promotor' }, corpo: { ativo: false } });
    expect(eventos).toEqual([]);
  });

  it('RN-CORE-01: exceção do usuário só REMOVE — ativo=false insere "remover"; ativo=true apaga a exceção', async () => {
    const um = [[/from core.usuario where id/, [{ id: USUARIO }]]] as Array<[RegExp, unknown[]]>;
    const r1 = fakeDb(um);
    await executar(rota('PUT', 'licencas/usuarios/:id/:modulo'), contexto(r1.db), { params: { id: USUARIO, modulo: 'vendedor' }, corpo: { ativo: false } });
    const ins = r1.chamadas.find((c) => /insert into plataforma.usuario_modulo/.test(c.sql))!;
    expect(ins.sql).toContain("'remover'");
    const r2 = fakeDb([...um, [/from plataforma.usuario_modulo where usuario_id/, [{ '?column?': 1 }]]]);
    await executar(rota('PUT', 'licencas/usuarios/:id/:modulo'), contexto(r2.db), { params: { id: USUARIO, modulo: 'vendedor' }, corpo: { ativo: true } });
    expect(r2.chamadas.some((c) => /update plataforma.usuario_modulo set deleted_at/.test(c.sql))).toBe(true);
    expect(r2.chamadas.some((c) => /insert into plataforma.usuario_modulo/.test(c.sql))).toBe(false);
  });

  it('RN-CORE-05: usuário inexistente (ou de outro tenant, que o RLS esconde) responde 404', async () => {
    const { db } = fakeDb();
    await expect(
      executar(rota('PUT', 'licencas/usuarios/:id/:modulo'), contexto(db), { params: { id: USUARIO, modulo: 'vendedor' }, corpo: { ativo: false } }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_NAO_ENCONTRADO', status: 404 });
  });

  it('RF-CORE-02: GET licencas devolve tenant, perfis e exceções no contrato (core sempre ativo)', async () => {
    const { db } = fakeDb([
      [/from plataforma.tenant_modulo/, [{ modulo: 'vendedor', ativo: true }, { modulo: 'promotor', ativo: false }, { modulo: 'teste', ativo: true }]],
      [/from plataforma.perfil_modulo/, [{ perfil: 'vendedor', modulo: 'vendedor' }, { perfil: 'vendedor', modulo: 'core' }]],
      [/from core.usuario/, [{ id: USUARIO, nome: 'Vera', email: 'v@x.com', perfil: 'vendedor' }]],
      [/from plataforma.usuario_modulo/, [{ usuario_id: USUARIO, modulo: 'vendedor' }]],
    ]);
    const estado = LicencasEstadoSchema.parse(await lerEstadoDeLicencas(db, { vendedor: ['core', 'catalogo'] }));
    expect(estado.tenant).toMatchObject({ core: true, vendedor: true, promotor: false, catalogo: false });
    expect(estado.perfis.vendedor).toEqual(['vendedor', 'core']);
    expect(estado.usuarios[0]).toMatchObject({ removidos: ['vendedor'] });
    expect(estado.dependencias).toEqual({ vendedor: ['core', 'catalogo'] });
  });

  it('matriz §2: só admin gerencia licenças (ação do manifesto) e todas as rotas de escrita usam a ação', () => {
    const permissoes = criarPermissoes([manifest]);
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente'] as const) {
      const r = verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, 'modulo.gerir_licencas');
      expect(r.ok, perfil).toBe(false);
    }
    expect(verificarAcao(ADMIN, permissoes, 'modulo.gerir_licencas').ok).toBe(true);
    for (const r of rotasDeLicencas.filter((x) => x.metodo !== 'GET')) expect(r.acao).toBe('modulo.gerir_licencas');
    expect(rotasDeLicencas.find((x) => x.metodo === 'GET')?.perfis).toEqual(['admin']);
  });

  it('o erro de regra do core é ErroRegraNegocio (422 na API)', async () => {
    const { db } = fakeDb();
    await expect(executar(rota('PUT', 'licencas/tenant/:modulo'), contexto(db), { params: { modulo: 'core' }, corpo: { ativo: false } })).rejects.toBeInstanceOf(ErroRegraNegocio);
  });
});

describe('RN-CORE-04: carteira por perfil', () => {
  const dados = (perfil: 'vendedor' | 'supervisor' | 'gerente' | 'analista') => ({ id: USUARIO, tenant_id: ADMIN.tenant_id, perfil });
  const banco = (respostas: Array<[RegExp, unknown[]]>) => {
    const f = fakeDb(respostas);
    return { f, acesso: { comTenant: async (_t: string, fn: (db: ClienteBanco) => Promise<unknown>) => fn(f.db), semTenant: async (fn: (db: ClienteBanco) => Promise<unknown>) => fn(f.db) } as never };
  };

  it('RN-CORE-04: analista/assistente/admin veem o tenant sem consultar o banco', async () => {
    const { f, acesso } = banco([]);
    expect(await carteiraDoUsuario(dados('analista'), acesso)).toBe('tenant');
    expect(f.chamadas).toEqual([]);
  });

  it('RN-CORE-04: vendedor vê só a própria carteira (1 consulta)', async () => {
    const { f, acesso } = banco([[/where c.usuario_id = \$1/, [{ cliente_id: 'c1' }, { cliente_id: 'c2' }]]]);
    const r = await carteiraDoUsuario(dados('vendedor'), acesso);
    expect([...(r as Set<string>)].sort()).toEqual(['c1', 'c2']);
    expect(f.chamadas).toHaveLength(1);
  });

  it('RN-CORE-04: supervisor soma a equipe; gerente soma também as equipes abaixo', async () => {
    const respostas: Array<[RegExp, unknown[]]> = [
      [/eq.nivel = 0/, [{ cliente_id: 'eq1' }]],
      [/eq.nivel > 0/, [{ cliente_id: 'ab1' }]],
      [/where c.usuario_id = \$1/, [{ cliente_id: 'meu' }]],
    ];
    const sup = banco(respostas);
    expect([...((await carteiraDoUsuario(dados('supervisor'), sup.acesso)) as Set<string>)].sort()).toEqual(['eq1', 'meu']);
    const ger = banco(respostas);
    expect([...((await carteiraDoUsuario(dados('gerente'), ger.acesso)) as Set<string>)].sort()).toEqual(['ab1', 'eq1', 'meu']);
  });
});

describe('T-0004 §5: provedores de pull do Core', () => {
  const pedido = { desde: { updated_at: '2026-10-31T10:00:00.123456Z', id: '0c000000-0000-4000-8000-000000000001' }, ate: '2026-10-31T11:59:58.000Z', limite: 1001 };

  it('registra cliente, carteira e produto, só pull, todos no sync do manifesto', () => {
    expect(provedoresSyncCore.map((p) => p.entidade.nome).sort()).toEqual(['carteira', 'cliente', 'produto']);
    for (const p of provedoresSyncCore) {
      expect(p.entidade.direcao).toBe('pull');
      expect(manifest.sync).toContain(p.entidade.nome);
    }
    expect(moduloApi.sync).toHaveLength(3);
  });

  it('pull usa horizonte, cursor (updated_at, id), ordem, limite e microssegundos', () => {
    const { sql, valores } = sqlDoPull(TABELAS_SYNC.produto, pedido, 'tenant');
    expect(sql).toMatch(/updated_at < \$1::timestamptz/);
    expect(sql).toMatch(/\(updated_at, id\) > \(\$2::timestamptz, \$3::uuid\)/);
    expect(sql).toMatch(/order by updated_at, id\s+limit \$4/);
    expect(sql).toContain('HH24:MI:SS.US');
    expect(sql).not.toMatch(/deleted_at is null/); // removidos incluídos
    expect(valores).toEqual([pedido.ate, pedido.desde.updated_at, pedido.desde.id, 1001]);
  });

  it('RN-CORE-04: cliente e carteira filtram pela carteira do usuário; tenant inteiro e produto não filtram', () => {
    const vis = new Set(['c1', 'c2']);
    const c = sqlDoPull(TABELAS_SYNC.cliente, pedido, vis);
    expect(c.sql).toMatch(/and id = any\(\$5::uuid\[\]\)/);
    expect(c.valores[4]).toEqual(['c1', 'c2']);
    expect(sqlDoPull(TABELAS_SYNC.carteira, pedido, vis).sql).toMatch(/and cliente_id = any\(\$5::uuid\[\]\)/);
    expect(sqlDoPull(TABELAS_SYNC.cliente, pedido, 'tenant').sql).not.toMatch(/any\(/);
    expect(sqlDoPull(TABELAS_SYNC.produto, pedido, vis).sql).not.toMatch(/any\(/);
  });

  it('RN-CORE-04: carteira vazia devolve zero linhas (filtro com conjunto vazio, nunca "tudo")', () => {
    const r = sqlDoPull(TABELAS_SYNC.cliente, pedido, new Set());
    expect(r.sql).toMatch(/any\(\$5::uuid\[\]\)/);
    expect(r.valores[4]).toEqual([]);
  });
});
