import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { UsuarioItemSchema } from '../contracts';
import { manifest } from '../manifest';
import { rotasDeUsuarios } from './usuarios';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = { id: '0b000000-0000-4000-8000-0000000000ad', tenant_id: TENANT, perfil: 'admin' as const, modulos: ['core' as const] };
const ALVO = '0b000000-0000-4000-8000-000000000001';
const EQUIPE = '0c000000-0000-4000-8000-000000000001';
const SENHA = 'Senha@Forte123';

type Resposta = [RegExp, unknown[] | (() => unknown[])];
/** Banco falso: responde por trecho do SQL (primeira regra que casa) e guarda tudo o que foi executado. */
function fakeDb(respostas: Resposta[] = [], falhaNoInsert?: { code: string; constraint: string }) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      if (falhaNoInsert && /insert into core.usuario/.test(sql)) throw Object.assign(new Error('duplicate key'), falhaNoInsert);
      const r = respostas.find(([re]) => re.test(sql));
      const rows = ((typeof r?.[1] === 'function' ? r[1]() : r?.[1]) ?? []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}

function contexto(db: ClienteBanco, extra: { usuario?: typeof ADMIN; visiveis?: ReadonlySet<string> | 'tenant' } = {}) {
  const tx = { publicar: async () => ({}) } as unknown as TransacaoTenant;
  return {
    usuario: extra.usuario ?? ADMIN,
    requestId: 'req',
    agora: () => new Date('2026-11-03T12:00:00Z'),
    fuso: () => 'America/Manaus',
    comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx),
    usuariosVisiveis: async () => extra.visiveis ?? 'tenant',
    log: { info() {}, warn() {}, error() {} },
  } as unknown as ContextoBase;
}

const rota = (metodo: string, caminho: string): RotaModulo => rotasDeUsuarios.find((r) => r.metodo === metodo && r.caminho === caminho)!;
const executar = (r: RotaModulo, ctx: ContextoBase, extra: Record<string, unknown>) =>
  r.executar({ ...ctx, corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never);

const linhaItem = (o: Record<string, unknown> = {}) => ({
  id: ALVO, nome: 'Vera', nome_curto: null, email: 'vera@x.com', perfil: 'vendedor', equipe_id: null, equipe_nome: null, ativo: true, external_id: null, ultimo_login_em: null, ...o,
});
const bruto = (o: Record<string, unknown> = {}) => ({ id: ALVO, nome: 'Vera', nome_curto: null, email: 'vera@x.com', perfil: 'vendedor', equipe_id: null, ativo: true, external_id: null, ...o });
const aud = (c: Array<{ sql: string; valores: readonly unknown[] }>) => c.filter((x) => /insert into plataforma.auditoria/.test(x.sql));
const jsonDaAuditoria = (c: Array<{ sql: string; valores: readonly unknown[] }>) => aud(c).map((x) => JSON.stringify(x.valores)).join('|');

describe('RF-CORE-02: permissões das rotas de usuários (T-0067)', () => {
  const permissoes = criarPermissoes([manifest]);
  it('RF-CORE-02: só o admin cria, edita, desativa e define senha (403 para os demais perfis)', () => {
    for (const perfil of PERFIS.filter((p) => p !== 'admin')) {
      expect(verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, 'usuario.gerir').ok, perfil).toBe(false);
    }
    expect(verificarAcao(ADMIN, permissoes, 'usuario.gerir').ok).toBe(true);
    for (const r of rotasDeUsuarios.filter((x) => x.metodo !== 'GET')) expect(r.acao, `${r.metodo} ${r.caminho}`).toBe('usuario.gerir');
  });
  it('RN-CORE-04: a leitura é de supervisor, gerente e admin; vendedor, promotor, analista e assistente recebem 403', () => {
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, 'usuario.ver').ok);
    expect(quem).toEqual(['supervisor', 'gerente', 'admin']);
    for (const r of rotasDeUsuarios.filter((x) => x.metodo === 'GET')) expect(r.acao).toBe('usuario.ver');
  });
  it('RF-CORE-02: não existe rota de remoção (nunca apaga usuário)', () => {
    expect(rotasDeUsuarios.some((r) => r.metodo === 'DELETE')).toBe(false);
  });
});

describe('RF-CORE-02: criar usuário', () => {
  const corpo = { nome: 'Nova Pessoa', email: 'Nova@Exemplo.com.br', perfil: 'vendedor', equipe_id: EQUIPE, external_id: 'V-100', senha: SENHA };
  const respostas: Resposta[] = [
    [/select 1 from core.equipe where id/, [{ '?column?': 1 }]],
    [/insert into core.usuario/, [{ id: ALVO }]],
    [/from core.usuario u left join/, [linhaItem({ equipe_id: EQUIPE, equipe_nome: 'Equipe 1', external_id: 'V-100' })]],
  ];

  it('RF-CORE-01: grava hash argon2id (nunca a senha), e-mail em minúsculas e audita sem senha, hash, nome nem e-mail (RN-AUD-01)', async () => {
    const { db, chamadas } = fakeDb(respostas);
    const r = UsuarioItemSchema.parse(await executar(rota('POST', 'usuarios'), contexto(db), { corpo }));
    expect(r.id).toBe(ALVO);
    const ins = chamadas.find((c) => /insert into core.usuario/.test(c.sql))!;
    expect(ins.valores).toContain('nova@exemplo.com.br');
    const hash = ins.valores.find((v) => typeof v === 'string' && v.startsWith('$argon2id$'));
    expect(hash).toBeTruthy();
    expect(ins.valores).not.toContain(SENHA);
    const a = jsonDaAuditoria(chamadas);
    expect(aud(chamadas)).toHaveLength(1);
    expect(a).toContain('usuario.criar');
    expect(a).toContain('senha_definida');
    for (const proibido of [SENHA, '$argon2id', 'Nova Pessoa', 'exemplo.com.br']) expect(a).not.toContain(proibido);
  });

  it('RF-CORE-02: e-mail já usado no tenant responde 409 USUARIO_EMAIL_DUPLICADO e não grava nem audita', async () => {
    const { db, chamadas } = fakeDb([[/lower\(email\) = \$1/, [{ '?column?': 1 }]], ...respostas]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
    expect(chamadas.some((c) => /insert into/.test(c.sql))).toBe(false);
  });

  it('RF-CORE-02: external_id já usado responde 409 USUARIO_EXTERNAL_ID_DUPLICADO', async () => {
    const { db } = fakeDb([[/external_id = \$1/, [{ '?column?': 1 }]], ...respostas]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EXTERNAL_ID_DUPLICADO' });
  });

  it('RF-CORE-02: corrida entre duas gravações (índice único do banco) também vira 409 legível', async () => {
    const a = fakeDb(respostas, { code: '23505', constraint: 'usuario_email_uk' });
    await expect(executar(rota('POST', 'usuarios'), contexto(a.db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
    const b = fakeDb(respostas, { code: '23505', constraint: 'usuario_external_uk' });
    await expect(executar(rota('POST', 'usuarios'), contexto(b.db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EXTERNAL_ID_DUPLICADO' });
  });

  it('RF-CORE-01: senha fraca e dados inválidos são 422 antes de tocar o banco', async () => {
    const { db, chamadas } = fakeDb(respostas);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, senha: 'curta' } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_SENHA_FRACA' });
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, email: 'sem-arroba' } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_DADOS_INVALIDOS' });
    expect(chamadas).toEqual([]);
  });

  it('RF-CORE-02: equipe inexistente ou inativa é 422 EQUIPE_INVALIDA', async () => {
    const { db } = fakeDb([]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo })).rejects.toMatchObject({ status: 422, codigo: 'EQUIPE_INVALIDA' });
  });

  it('RF-CORE-02: o contrato recusa campo desconhecido e perfil fora do enum', () => {
    const r = rota('POST', 'usuarios');
    expect(() => r.corpo!.parse({ ...corpo, superior_id: ALVO })).toThrow();
    expect(() => r.corpo!.parse({ ...corpo, perfil: 'dono' })).toThrow();
    expect(r.corpo!.parse({ ...corpo, perfil: 'assistente' })).toBeTruthy();
  });
});

describe('RF-CORE-02: editar usuário', () => {
  it('RN-AUD-01: audita só o que mudou, sem nome e e-mail em claro', async () => {
    const { db, chamadas } = fakeDb([
      [/for update/, [bruto()]],
      [/from core.usuario u left join/, [linhaItem({ nome: 'Vera Lúcia', perfil: 'supervisor' })]],
    ]);
    await executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { nome: 'Vera Lúcia', perfil: 'supervisor' } });
    expect(chamadas.some((c) => /update core.usuario set nome/.test(c.sql))).toBe(true);
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('usuario.editar');
    expect(a).toContain('supervisor');
    expect(a).not.toContain('Vera');
    expect(a).not.toContain('vera@x.com');
  });

  it('RN-AUD-01: edição sem mudança não grava nem audita', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [bruto()]], [/from core.usuario u left join/, [linhaItem()]]]);
    await executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { nome: 'Vera' } });
    expect(chamadas.some((c) => /update core.usuario/.test(c.sql))).toBe(false);
    expect(aud(chamadas)).toHaveLength(0);
  });

  it('RF-CORE-02: e-mail de outro usuário do tenant é 409', async () => {
    const { db } = fakeDb([[/lower\(email\) = \$1/, [{ '?column?': 1 }]], [/for update/, [bruto()]]]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { email: 'outro@x.com' } })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
  });

  it('RN-CORE-05: usuário inexistente (ou de outro tenant, que o RLS esconde) responde 404', async () => {
    const { db } = fakeDb([]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { nome: 'X' } })).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
  });

  it('RF-CORE-02: o último admin ativo não pode ser rebaixado', async () => {
    const { db } = fakeDb([[/perfil = 'admin' and ativo/, [{ id: ALVO }]], [/for update/, [bruto({ perfil: 'admin' })]]]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { perfil: 'gerente' } })).rejects.toMatchObject({ status: 422, codigo: 'ULTIMO_ADMIN' });
  });
});

describe('RF-CORE-01/02: desativar e ativar', () => {
  const admins = (n: number): Resposta => [/perfil = 'admin' and ativo/, () => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }))];

  it('RF-CORE-01: desativar não apaga (sem delete/deleted_at), revoga sessões, limpa o push e audita', async () => {
    const { db, chamadas } = fakeDb([admins(2), [/for update/, [bruto()]], [/from core.usuario u left join/, [linhaItem({ ativo: false })]]]);
    const r = UsuarioItemSchema.parse(await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(db), { params: { id: ALVO }, corpo: { ativo: false } }));
    expect(r.ativo).toBe(false);
    expect(chamadas.some((c) => /update core.usuario set ativo = \$2/.test(c.sql) && c.valores[1] === false)).toBe(true);
    expect(chamadas.some((c) => /update core.sessao set revogado_em/.test(c.sql) && c.valores[0] === ALVO)).toBe(true);
    expect(chamadas.some((c) => /core.dispositivo set push_token = null/.test(c.sql))).toBe(true);
    expect(chamadas.some((c) => /delete from|set deleted_at/.test(c.sql))).toBe(false);
    expect(jsonDaAuditoria(chamadas)).toContain('usuario.desativar');
  });

  it('RF-CORE-01: reativar audita usuario.ativar e não mexe nas sessões', async () => {
    const { db, chamadas } = fakeDb([admins(2), [/for update/, [bruto({ ativo: false })]], [/from core.usuario u left join/, [linhaItem()]]]);
    await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(db), { params: { id: ALVO }, corpo: { ativo: true } });
    expect(jsonDaAuditoria(chamadas)).toContain('usuario.ativar');
    expect(chamadas.some((c) => /core.sessao/.test(c.sql))).toBe(false);
  });

  it('RF-CORE-02: repetir o mesmo estado é idempotente (sem auditoria)', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [bruto({ ativo: false })]], [/from core.usuario u left join/, [linhaItem({ ativo: false })]]]);
    await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(db), { params: { id: ALVO }, corpo: { ativo: false } });
    expect(aud(chamadas)).toHaveLength(0);
  });

  it('RF-CORE-02: o admin não desativa o próprio usuário (422) e o último admin ativo não é desativado', async () => {
    const proprio = fakeDb([admins(3), [/for update/, [bruto({ id: ADMIN.id, perfil: 'admin' })]]]);
    await expect(executar(rota('PUT', 'usuarios/:id/ativo'), contexto(proprio.db), { params: { id: ADMIN.id }, corpo: { ativo: false } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_AUTODESATIVACAO' });
    const ultimo = fakeDb([admins(1), [/for update/, [bruto({ perfil: 'admin' })]]]);
    await expect(executar(rota('PUT', 'usuarios/:id/ativo'), contexto(ultimo.db), { params: { id: ALVO }, corpo: { ativo: false } })).rejects.toMatchObject({ status: 422, codigo: 'ULTIMO_ADMIN' });
  });
});

describe('RF-CORE-01: redefinir senha', () => {
  it('RN-AUD-01: grava o hash, zera falhas, revoga sessões e audita só "senha alterada" (nunca senha nem hash)', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [bruto()]]]);
    const r = await executar(rota('PUT', 'usuarios/:id/senha'), contexto(db), { params: { id: ALVO }, corpo: { senha: SENHA } });
    expect(r).toEqual({ ok: true });
    const upd = chamadas.find((c) => /update core.usuario set senha_hash/.test(c.sql))!;
    expect(String(upd.valores[1])).toMatch(/^\$argon2id\$/);
    expect(chamadas.some((c) => /update core.sessao set revogado_em/.test(c.sql))).toBe(true);
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('usuario.senha_redefinir');
    expect(a).toContain('senha_alterada');
    expect(a).not.toContain(SENHA);
    expect(a).not.toContain('argon2');
    expect(JSON.stringify(r)).not.toContain('argon2');
  });

  it('RF-CORE-01: senha fraca é 422 e não grava', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [bruto()]]]);
    await expect(executar(rota('PUT', 'usuarios/:id/senha'), contexto(db), { params: { id: ALVO }, corpo: { senha: 'abc' } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_SENHA_FRACA' });
    expect(chamadas.some((c) => /update core.usuario/.test(c.sql))).toBe(false);
  });
});

describe('RN-CORE-04: lista recortada pelo escopo', () => {
  const SUP = '0b000000-0000-4000-8000-0000000000a5';
  const GER = '0b000000-0000-4000-8000-0000000000a6';

  it('RN-CORE-04: supervisor só consulta os ids do seu escopo e não vê o superior fora dele', async () => {
    const { db, chamadas } = fakeDb([
      [/from core.usuario u left join/, [linhaItem({ equipe_id: EQUIPE, equipe_nome: 'Equipe 1' })]],
      [/from core.equipe where deleted_at is null and ativo/, [{ id: EQUIPE, equipe_pai_id: null, responsavel_id: GER }]],
    ]);
    const ctx = contexto(db, { usuario: { ...ADMIN, id: SUP, perfil: 'supervisor' as never }, visiveis: new Set([SUP, ALVO]) });
    const r = (await executar(rota('GET', 'usuarios'), ctx, { query: {} })) as { itens: Array<{ superior_id: string | null }> };
    const sql = chamadas.find((c) => /from core.usuario u left join/.test(c.sql))!;
    expect(sql.sql).toContain('u.id = any($1::uuid[])');
    expect(sql.valores[0]).toEqual([SUP, ALVO]);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]!.superior_id).toBeNull();
  });

  it('RN-CORE-04: admin vê o tenant (sem filtro de ids) e o superior derivado da equipe', async () => {
    const { db, chamadas } = fakeDb([
      [/from core.usuario u left join/, [linhaItem({ equipe_id: EQUIPE, equipe_nome: 'Equipe 1' })]],
      [/from core.equipe where deleted_at is null and ativo/, [{ id: EQUIPE, equipe_pai_id: null, responsavel_id: GER }]],
      [/select id, nome from core.usuario where id = any/, [{ id: GER, nome: 'Gabi Gerente' }]],
    ]);
    const r = (await executar(rota('GET', 'usuarios'), contexto(db), { query: { q: 'ver_a', perfil: 'vendedor', ativo: 'true' } })) as { itens: Array<{ superior_id: string; superior_nome: string }> };
    const sql = chamadas.find((c) => /from core.usuario u left join/.test(c.sql))!;
    expect(sql.sql).not.toContain('any($1::uuid[])');
    expect(sql.valores).toContain('%ver\\_a%');
    expect(r.itens[0]).toMatchObject({ superior_id: GER, superior_nome: 'Gabi Gerente' });
  });
});
