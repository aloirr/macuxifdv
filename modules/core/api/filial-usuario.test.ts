/** T-0176 / RN-CORE-39: filial do usuário na API (banco falso; o Postgres real está em filial-usuario.db.test.ts). */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { CriarUsuarioRequestSchema, EditarUsuarioRequestSchema, SessaoRespostaSchema, UsuarioSyncSchema } from '../contracts';
import { aplicarFilialDoErp, conferirFiliaisDoUsuario, exigirQuemEditaFilial, gravarFiliaisDoUsuario, vendedorSemFilial } from './filiais-usuario';

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

describe('RN-CORE-39: API revalida a filial do usuário', () => {
  it('RN-CORE-39: vendedor sem filial dá 422 com "Escolha a filial do vendedor."', async () => {
    const { db } = fakeDb();
    await expect(conferirFiliaisDoUsuario(db, 'vendedor', [])).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_QUANTIDADE', message: 'Escolha a filial do vendedor.' });
  });
  it('RN-CORE-39: supervisor, promotor e gerente sem filial dão 422 com "Escolha ao menos uma filial."', async () => {
    const { db } = fakeDb();
    for (const cargo of ['supervisor', 'promotor', 'gerente'] as const) await expect(conferirFiliaisDoUsuario(db, cargo, [])).rejects.toMatchObject({ message: 'Escolha ao menos uma filial.' });
  });
  it('RN-CORE-39: filial inexistente, excluída ou de outro tenant (a RLS não a devolve) dá 422', async () => {
    const { db } = fakeDb([[/from core\.filial/, [{ id: F1 }]]]);
    await expect(conferirFiliaisDoUsuario(db, 'supervisor', [F1, F2])).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_INVALIDA' });
    await expect(conferirFiliaisDoUsuario(db, 'supervisor', [F1])).resolves.toEqual([F1]);
  });
  it('RN-CORE-39: admin e analista aceitam 0 filiais', async () => {
    const { db } = fakeDb();
    await expect(conferirFiliaisDoUsuario(db, 'administrativo', [])).resolves.toEqual([]);
  });
  it('RN-CORE-39: só admin e analista editam a filial; os demais perfis recebem 403', () => {
    expect(() => exigirQuemEditaFilial('admin')).not.toThrow();
    expect(() => exigirQuemEditaFilial('analista')).not.toThrow();
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente']) expect(() => exigirQuemEditaFilial(p), p).toThrow(expect.objectContaining({ status: 403, codigo: 'USUARIO_FILIAL_SEM_PERMISSAO' }));
  });
  it('RN-CORE-39: gravar troca a filial do vendedor (tira a antiga, põe a nova) e a mesma lista não grava nada', async () => {
    const { db, chamadas } = fakeDb([[/select filial_id from core\.usuario_filial/, [{ filial_id: F1 }]]]);
    expect(await gravarFiliaisDoUsuario(db, U, [F2])).toBe(true);
    expect(chamadas.some((c) => /update core\.usuario_filial set deleted_at/.test(c.sql))).toBe(true);
    expect(chamadas.some((c) => /insert into core\.usuario_filial/.test(c.sql) && c.valores[1] === F2)).toBe(true);
    const igual = fakeDb([[/select filial_id from core\.usuario_filial/, [{ filial_id: F1 }]]]);
    expect(await gravarFiliaisDoUsuario(igual.db, U, [F1])).toBe(false);
    expect(escritas(igual.chamadas)).toEqual([]);
  });
  it('RN-CORE-39: o erro 23514 usuario_filial_vendedor_uma do banco vira 422', async () => {
    const { db } = fakeDb([], { re: /set constraints/, erro: { code: '23514', constraint: 'usuario_filial_vendedor_uma' } });
    await expect(gravarFiliaisDoUsuario(db, U, [F1, F2])).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_QUANTIDADE' });
  });
  it('RN-CORE-39: vendedor (cargo) sem filial viva está bloqueado; com filial ou de outro cargo, não', async () => {
    expect(await vendedorSemFilial(fakeDb([[/v_usuario_hierarquia/, [{ cargo: 'vendedor' }]]]).db, U)).toBe(true);
    expect(await vendedorSemFilial(fakeDb([[/v_usuario_hierarquia/, [{ cargo: 'vendedor' }]], [/from core\.usuario_filial/, [{ filial_id: F1 }]]]).db, U)).toBe(false);
    expect(await vendedorSemFilial(fakeDb([[/v_usuario_hierarquia/, [{ cargo: 'supervisor' }]]]).db, U)).toBe(false);
  });
});

describe('RN-CORE-39: carga do ERP (filial_external_id do vendedor)', () => {
  const ctxDe = (respostas: Resp[]) => {
    const f = fakeDb([[/v_usuario_hierarquia/, [{ cargo: 'vendedor' }]], ...respostas]);
    const warn = vi.fn();
    return { ...f, warn, ctx: { db: f.db, log: { warn } } };
  };
  it('RN-CORE-39: filial_external_id ausente, nulo ou vazio não altera', async () => {
    for (const v of [undefined, null, '', '  ']) {
      const { ctx, chamadas } = ctxDe([]);
      expect(await aplicarFilialDoErp(ctx, U, 'V1', v)).toBe('inalterada');
      expect(chamadas).toEqual([]);
    }
  });
  it('RN-CORE-39: presente grava a filial achada pelo external_id e troca a anterior', async () => {
    const { ctx, chamadas } = ctxDe([[/from core\.filial where external_id/, [{ id: F2 }]], [/select filial_id from core\.usuario_filial/, [{ filial_id: F1 }]]]);
    expect(await aplicarFilialDoErp(ctx, U, 'V1', 'FIL-2')).toBe('gravada');
    expect(chamadas.some((c) => /update core\.usuario_filial set deleted_at/.test(c.sql))).toBe(true);
    expect(chamadas.some((c) => /insert into core\.usuario_filial/.test(c.sql) && c.valores[1] === F2)).toBe(true);
  });
  it('RN-CORE-39: filial inexistente não grava e registra o erro sem dado pessoal', async () => {
    const { ctx, chamadas, warn } = ctxDe([]);
    expect(await aplicarFilialDoErp(ctx, U, 'V1', 'FIL-X')).toBe('filial_inexistente');
    expect(escritas(chamadas)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).toBe(JSON.stringify([[{ external_id: 'V1', filial_external_id: 'FIL-X' }, 'filial do vendedor não encontrada: não gravada, o vendedor segue sem filial']]));
  });
  it('RN-CORE-39: reentrega da mesma filial não grava de novo', async () => {
    const { ctx, chamadas } = ctxDe([[/from core\.filial where external_id/, [{ id: F1 }]], [/select filial_id from core\.usuario_filial/, [{ filial_id: F1 }]]]);
    expect(await aplicarFilialDoErp(ctx, U, 'V1', 'FIL-1')).toBe('inalterada');
    expect(escritas(chamadas)).toEqual([]);
  });
  it('RN-CORE-39: usuário que não é vendedor pelo cargo não recebe filial da carga', async () => {
    const f = fakeDb([[/v_usuario_hierarquia/, [{ cargo: 'promotor' }]]]);
    expect(await aplicarFilialDoErp({ db: f.db, log: { warn: vi.fn() } }, U, 'V1', 'FIL-1')).toBe('ignorada');
  });
});

describe('T-0176: contrato aditivo', () => {
  it('RN-CORE-39: filial_ids é opcional em criar e editar; o sync e a sessão aceitam linha antiga e nova', () => {
    const base = { nome: 'Ana', email: 'ana@x.com', perfis: ['vendedor'], senha: 'x' };
    expect(CriarUsuarioRequestSchema.parse(base).filial_ids).toBeUndefined();
    expect(CriarUsuarioRequestSchema.parse({ ...base, filial_ids: [F1] }).filial_ids).toEqual([F1]);
    expect(EditarUsuarioRequestSchema.parse({}).filial_ids).toBeUndefined();
    expect(() => EditarUsuarioRequestSchema.parse({ filial_ids: ['nao-uuid'] })).toThrow();
    const linha = { id: U, updated_at: '2026-11-15T10:00:00.000Z', deleted_at: null, external_id: null };
    expect(UsuarioSyncSchema.parse(linha).filial_id).toBeUndefined();
    expect(UsuarioSyncSchema.parse({ ...linha, filial_id: F1, sem_filial: false })).toMatchObject({ filial_id: F1, sem_filial: false });
    expect(UsuarioSyncSchema.parse({ ...linha, filial_id: null, sem_filial: true }).sem_filial).toBe(true);
    expect(SessaoRespostaSchema.shape.usuario.shape.sem_filial.isOptional()).toBe(true);
    expect(SessaoRespostaSchema.shape.usuario.shape.filial_ids.isOptional()).toBe(true);
    expect(UsuarioSyncSchema.parse({ ...linha, filial_id: F1, filial_ids: [F1, F2] }).filial_ids).toEqual([F1, F2]);
    expect(() => UsuarioSyncSchema.parse({ ...linha, filial_ids: ['nao-uuid'] })).toThrow();
  });
});
