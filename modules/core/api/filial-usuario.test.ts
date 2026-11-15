/** T-0176 / RN-CORE-39: filial do usuário na API (banco falso; o Postgres real está em filial-usuario.db.test.ts). */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { CONSULTA_FILIAIS_DO_USUARIO, CriarUsuarioRequestSchema, EditarUsuarioRequestSchema, SessaoRespostaSchema, UsuarioSyncSchema } from '../contracts';
import { aplicarFilialDoErp, comGuardaDeFilial, conferirFiliaisDoUsuario, exigirQuemEditaFilial, filiaisDoUsuario, gravarFiliaisDoUsuario, usuarioSemFilial } from './filiais-usuario';
import { rotasDeFilialDoProprioUsuario } from './filiais-usuario-rotas';

const U = '0b000000-0000-4000-8000-000000000001';
const F1 = '0f000000-0000-4000-8000-000000000001';
const F2 = '0f000000-0000-4000-8000-000000000002';

type Resp = [RegExp, unknown[] | ((v: readonly unknown[]) => unknown[])];
function fakeDb(respostas: Resp[] = [], falha?: { re: RegExp; erro: object }) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      if (falha?.re.test(sql)) throw Object.assign(new Error('falha'), falha.erro);
      const r = respostas.find(([re]) => re.test(sql));
      const rows = ((typeof r?.[1] === 'function' ? r[1](valores) : r?.[1]) ?? []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}
const escritas = (c: Array<{ sql: string }>) => c.filter((x) => /^\s*(insert|update)/i.test(x.sql));

const SEL_USUARIO = /from core\.usuario where/;
const SEL_VENDA = /from core\.usuario_filial where usuario_id = any/;

describe('RN-CORE-39: API revalida a filial do usuário', () => {
  it('RN-CORE-39: sem filial de cadastro dá 422 em qualquer perfil', async () => {
    const { db } = fakeDb();
    await expect(conferirFiliaisDoUsuario(db, { cadastro: null, venda: [F1] })).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_CADASTRO_OBRIGATORIA' });
    await expect(conferirFiliaisDoUsuario(db, { cadastro: undefined, venda: [] })).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_CADASTRO_OBRIGATORIA', message: 'Escolha a filial de cadastro.' });
  });
  it('RN-CORE-39: a de cadastro entra na lista de venda quando falta (venda vazia vira só a de cadastro)', async () => {
    const { db } = fakeDb([[/from core\.filial/, [{ id: F1 }, { id: F2 }]]]);
    await expect(conferirFiliaisDoUsuario(db, { cadastro: F1, venda: [] })).resolves.toEqual({ cadastro: F1, venda: [F1] });
    await expect(conferirFiliaisDoUsuario(db, { cadastro: F1, venda: [F2] })).resolves.toEqual({ cadastro: F1, venda: [F1, F2] });
  });
  it('RN-CORE-39: filial inexistente, excluída ou de outro tenant (a RLS não a devolve) dá 422, no cadastro ou na venda', async () => {
    const { db } = fakeDb([[/from core\.filial/, [{ id: F1 }]]]);
    await expect(conferirFiliaisDoUsuario(db, { cadastro: F1, venda: [F2] })).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_INVALIDA', detalhes: { campo: 'filial_venda_ids' } });
    await expect(conferirFiliaisDoUsuario(db, { cadastro: F2, venda: [] })).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_INVALIDA', detalhes: { campo: 'filial_cadastro_id' } });
  });
  it('RN-CORE-39: só admin e analista editam a filial; os demais perfis recebem 403', () => {
    expect(() => exigirQuemEditaFilial('admin')).not.toThrow();
    expect(() => exigirQuemEditaFilial('analista')).not.toThrow();
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente']) expect(() => exigirQuemEditaFilial(p), p).toThrow(expect.objectContaining({ status: 403, codigo: 'USUARIO_FILIAL_SEM_PERMISSAO' }));
  });
  it('RN-CORE-39: gravar põe a de cadastro na coluna e na venda, tira as que saíram, e a mesma entrada não grava nada', async () => {
    const lido: Resp[] = [[SEL_USUARIO, [{ id: U, filial_cadastro_id: F1 }]], [SEL_VENDA, [{ usuario_id: U, filial_id: F1 }]]];
    const { db, chamadas } = fakeDb(lido);
    expect(await gravarFiliaisDoUsuario(db, U, F2, [F1])).toBe(true);
    expect(chamadas.some((c) => /update core\.usuario set filial_cadastro_id/.test(c.sql) && c.valores[1] === F2)).toBe(true);
    expect(chamadas.some((c) => /insert into core\.usuario_filial/.test(c.sql) && c.valores[1] === F2)).toBe(true);
    expect(chamadas.some((c) => /set constraints usuario_filial_inclui_cadastro immediate/.test(c.sql))).toBe(true);
    const igual = fakeDb(lido);
    expect(await gravarFiliaisDoUsuario(igual.db, U, F1, [F1])).toBe(false);
    expect(escritas(igual.chamadas)).toEqual([]);
  });
  it('RN-CORE-39: o 23514 usuario_filial_inclui_cadastro do banco vira 422', async () => {
    const { db } = fakeDb([], { re: /set constraints/, erro: { code: '23514', constraint: 'usuario_filial_inclui_cadastro' } });
    await expect(gravarFiliaisDoUsuario(db, U, F1, [F1])).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_VENDA_SEM_CADASTRO' });
  });
  it('RN-CORE-39: qualquer perfil sem filial de cadastro está bloqueado; com cadastro, não', async () => {
    expect(await usuarioSemFilial(fakeDb([[SEL_USUARIO, [{ filial_cadastro_id: null }]]]).db, U)).toBe(true);
    expect(await usuarioSemFilial(fakeDb([[SEL_USUARIO, [{ filial_cadastro_id: F1 }]]]).db, U)).toBe(false);
  });
  it('RN-CORE-39: filiaisDoUsuario devolve cadastro, venda e sem_filial', async () => {
    const f = fakeDb([[SEL_USUARIO, [{ id: U, filial_cadastro_id: F1 }]], [SEL_VENDA, [{ usuario_id: U, filial_id: F1 }, { usuario_id: U, filial_id: F2 }]]]);
    expect(await filiaisDoUsuario(f.db, U)).toEqual({ filial_cadastro_id: F1, filial_venda_ids: [F1, F2], sem_filial: false });
    expect(await filiaisDoUsuario(fakeDb().db, U)).toEqual({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true });
  });
  it('RN-CORE-39: core.filiais_do_usuario@1 devolve { filial_cadastro_id, filial_venda_ids, sem_filial }', () => {
    expect(CONSULTA_FILIAIS_DO_USUARIO.saida.parse({ filial_cadastro_id: F1, filial_venda_ids: [F1, F2], sem_filial: false })).toEqual({ filial_cadastro_id: F1, filial_venda_ids: [F1, F2], sem_filial: false });
    expect(CONSULTA_FILIAIS_DO_USUARIO.saida.parse({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true }).sem_filial).toBe(true);
  });
});

type CtxFalso = Parameters<ReturnType<typeof comGuardaDeFilial>[number]['executar']>[0];
const ctxDeRota = (db: ClienteBanco, perfil: string, corpo?: unknown) =>
  ({ usuario: { id: U, perfil, tenant_id: 't' }, requestId: 'r', corpo, comTenant: async (fn: (d: ClienteBanco) => unknown) => fn(db) }) as unknown as CtxFalso;

describe('RN-CORE-39: bloqueio USUARIO_SEM_FILIAL e destravamento do admin', () => {
  const rota = (metodo: 'GET' | 'PUT', caminho: string) => ({ metodo, caminho, carteira: 'nao_se_aplica' as const, executar: vi.fn(async () => 'ok') });
  it.each(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'])('RN-CORE-39: %s sem filial recebe 403 USUARIO_SEM_FILIAL numa rota de dados', async (perfil) => {
    const r = rota('GET', 'clientes');
    const [g] = comGuardaDeFilial([r as never]);
    await expect(g!.executar(ctxDeRota(fakeDb([[SEL_USUARIO, [{ filial_cadastro_id: null }]]]).db, perfil))).rejects.toMatchObject({ status: 403, codigo: 'USUARIO_SEM_FILIAL' });
    expect(r.executar).not.toHaveBeenCalled();
  });
  it('RN-CORE-39: com filial de cadastro a rota segue', async () => {
    const r = rota('GET', 'clientes');
    const [g] = comGuardaDeFilial([r as never]);
    await expect(g!.executar(ctxDeRota(fakeDb([[SEL_USUARIO, [{ filial_cadastro_id: F1 }]]]).db, 'vendedor'))).resolves.toBe('ok');
  });
  it('RN-CORE-39: eu/filial-cadastro é a única rota que não passa pela guarda', () => {
    const r = rota('PUT', 'eu/filial-cadastro');
    expect(comGuardaDeFilial([r as never])[0]).toBe(r);
  });
  const put = rotasDeFilialDoProprioUsuario.find((r) => r.metodo === 'PUT')!;
  const sem = (): Resp[] => [[SEL_USUARIO, [{ id: U, filial_cadastro_id: null }]], [/from core\.filial where id/, [{ id: F1 }]]];
  it('RN-CORE-39: admin ou analista sem filial se destrava informando a PRÓPRIA filial (entra na lista de venda e é auditado)', async () => {
    for (const perfil of ['admin', 'analista']) {
      let cadastro: string | null = null;
      const { db, chamadas } = fakeDb([
        [SEL_USUARIO, () => [{ id: U, filial_cadastro_id: cadastro }]],
        [/from core\.filial where id/, [{ id: F1 }]],
        [/update core\.usuario set filial_cadastro_id/, (v) => { cadastro = v[1] as string; return []; }],
      ]);
      await put.executar(ctxDeRota(db, perfil, { filial_cadastro_id: F1 }));
      expect(cadastro, perfil).toBe(F1);
      expect(chamadas.some((c) => /insert into core\.usuario_filial/.test(c.sql) && c.valores[1] === F1)).toBe(true);
      expect(chamadas.some((c) => /insert into plataforma\.auditoria/.test(c.sql) && c.valores[1] === 'usuario.filial_cadastro_propria')).toBe(true);
    }
  });
  it('RN-CORE-39: os demais perfis esperam o admin (403 USUARIO_FILIAL_SEM_PERMISSAO) e nada é gravado', async () => {
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente']) {
      const { db, chamadas } = fakeDb(sem());
      await expect(put.executar(ctxDeRota(db, perfil, { filial_cadastro_id: F1 }))).rejects.toMatchObject({ status: 403, codigo: 'USUARIO_FILIAL_SEM_PERMISSAO' });
      expect(escritas(chamadas)).toEqual([]);
    }
  });
  it('RN-CORE-39: quem já tem filial leva 409 (a troca é do cadastro de usuários) e filial de outro tenant leva 422', async () => {
    await expect(put.executar(ctxDeRota(fakeDb([[SEL_USUARIO, [{ id: U, filial_cadastro_id: F2 }]]]).db, 'admin', { filial_cadastro_id: F1 }))).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_FILIAL_JA_INFORMADA' });
    await expect(put.executar(ctxDeRota(fakeDb([[SEL_USUARIO, [{ id: U, filial_cadastro_id: null }]]]).db, 'admin', { filial_cadastro_id: F1 }))).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_INVALIDA' });
  });
  it('RN-CORE-39: o GET lista as filiais só para quem pode informar e está sem filial', async () => {
    const get = rotasDeFilialDoProprioUsuario.find((r) => r.metodo === 'GET')!;
    const resp: Resp[] = [[SEL_USUARIO, [{ id: U, filial_cadastro_id: null }]], [/from core\.filial where deleted_at/, [{ id: F1, codigo: '0001', nome: 'Matriz' }]]];
    expect(await get.executar(ctxDeRota(fakeDb(resp).db, 'admin'))).toMatchObject({ sem_filial: true, pode_informar: true, filiais: [{ id: F1 }] });
    expect(await get.executar(ctxDeRota(fakeDb(resp).db, 'vendedor'))).toMatchObject({ sem_filial: true, pode_informar: false, filiais: [] });
  });
});

describe('RN-CORE-39: carga do ERP (filial_external_id do vendedor)', () => {
  const ctxDe = (respostas: Resp[]) => {
    const f = fakeDb(respostas);
    const warn = vi.fn();
    return { ...f, warn, ctx: { db: f.db, log: { warn } } };
  };
  const estadoAtual: Resp[] = [[SEL_USUARIO, [{ id: U, filial_cadastro_id: F1 }]], [SEL_VENDA, [{ usuario_id: U, filial_id: F1 }]]];
  it('RN-CORE-39: filial_external_id ausente, nulo ou vazio não altera', async () => {
    for (const v of [undefined, null, '', '  ']) {
      const { ctx, chamadas } = ctxDe([]);
      expect(await aplicarFilialDoErp(ctx, U, 'V1', v)).toBe('inalterada');
      expect(chamadas).toEqual([]);
    }
  });
  it('RN-CORE-39: presente vira a filial de CADASTRO e entra na lista de venda (as outras de venda ficam)', async () => {
    const { ctx, chamadas } = ctxDe([[/from core\.filial where external_id/, [{ id: F2 }]], ...estadoAtual]);
    expect(await aplicarFilialDoErp(ctx, U, 'V1', 'FIL-2')).toBe('gravada');
    expect(chamadas.some((c) => /update core\.usuario set filial_cadastro_id/.test(c.sql) && c.valores[1] === F2)).toBe(true);
    expect(chamadas.some((c) => /insert into core\.usuario_filial/.test(c.sql) && c.valores[1] === F2)).toBe(true);
    expect(chamadas.some((c) => /update core\.usuario_filial set deleted_at/.test(c.sql))).toBe(false);
  });
  it('RN-CORE-39: filial inexistente deixa o vendedor sem filial (bloqueado) e registra FILIAL_INEXISTENTE sem dado pessoal', async () => {
    const { ctx, chamadas, warn } = ctxDe([]);
    expect(await aplicarFilialDoErp(ctx, U, 'V1', 'FIL-X')).toBe('filial_inexistente');
    expect(chamadas.some((c) => /update core\.usuario set filial_cadastro_id = null/.test(c.sql))).toBe(true);
    expect(chamadas.some((c) => /insert into core\.usuario_filial/.test(c.sql))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toEqual({ erro: 'FILIAL_INEXISTENTE', external_id: 'V1', filial_external_id: 'FIL-X' });
  });
  it('RN-CORE-39: reentrega da mesma filial não grava de novo', async () => {
    const { ctx, chamadas } = ctxDe([[/from core\.filial where external_id/, [{ id: F1 }]], ...estadoAtual]);
    expect(await aplicarFilialDoErp(ctx, U, 'V1', 'FIL-1')).toBe('inalterada');
    expect(escritas(chamadas)).toEqual([]);
  });
});

describe('T-0176: contrato aditivo', () => {
  it('RN-CORE-39: filial de cadastro e de venda são opcionais em criar e editar; o sync e a sessão aceitam linha antiga e nova', () => {
    const base = { nome: 'Ana', email: 'ana@x.com', perfis: ['vendedor'], senha: 'x' };
    expect(CriarUsuarioRequestSchema.parse(base).filial_cadastro_id).toBeUndefined();
    expect(CriarUsuarioRequestSchema.parse({ ...base, filial_cadastro_id: F1, filial_venda_ids: [F1, F2] }).filial_venda_ids).toEqual([F1, F2]);
    expect(EditarUsuarioRequestSchema.parse({}).filial_venda_ids).toBeUndefined();
    expect(() => EditarUsuarioRequestSchema.parse({ filial_venda_ids: ['nao-uuid'] })).toThrow();
    expect(() => EditarUsuarioRequestSchema.parse({ filial_ids: [F1] })).toThrow();
    const linha = { id: U, updated_at: '2026-11-15T10:00:00.000Z', deleted_at: null, external_id: null };
    expect(UsuarioSyncSchema.parse(linha).filial_cadastro_id).toBeUndefined();
    expect(UsuarioSyncSchema.parse({ ...linha, filial_cadastro_id: F1, filial_venda_ids: [F1, F2], sem_filial: false })).toMatchObject({ filial_cadastro_id: F1, filial_venda_ids: [F1, F2], sem_filial: false });
    expect(UsuarioSyncSchema.parse({ ...linha, filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true }).sem_filial).toBe(true);
    expect(() => UsuarioSyncSchema.parse({ ...linha, filial_venda_ids: ['nao-uuid'] })).toThrow();
    for (const campo of ['filial_cadastro_id', 'filial_venda_ids', 'sem_filial'] as const) expect(SessaoRespostaSchema.shape.usuario.shape[campo].isOptional()).toBe(true);
  });
});
