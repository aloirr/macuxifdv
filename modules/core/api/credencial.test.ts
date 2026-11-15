import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CredencialConferirEntradaSchema, CredencialConferirSaidaSchema } from '../contracts';
import { hashSenha } from './seguranca';
import { consultaCredencialConferir } from './credencial';

const U = '0ea00000-0000-4000-8000-0000000000a1';
const SENHA = 'Senha-Do-Admin-123';
const agora = new Date('2026-11-15T12:00:00Z');

async function conferir(linha: Record<string, unknown> | null, senha: string, sqls: Array<{ sql: string; params: unknown[] }> = []) {
  const db: ClienteBanco = { query: async (sql, params) => { sqls.push({ sql, params: (params ?? []) as unknown[] }); return { rows: linha ? [linha] : [], rowCount: linha ? 1 : 0 } as never; } };
  const r = await consultaCredencialConferir.executar(CredencialConferirEntradaSchema.parse({ usuario_id: U, senha }), { db, agora: () => agora } as unknown as ContextoConsulta);
  return CredencialConferirSaidaSchema.parse(r).resultado;
}

describe('RN-INT-16 e RN-CORE-15: core.credencial_conferir@1', () => {
  it('RN-INT-16: senha certa de usuário ativo = ok; errada = incorreta; usa o hash argon2id do login', async () => {
    const senha_hash = await hashSenha(SENHA);
    const linha = { senha_hash, ativo: true, bloqueado_em: null, bloqueio_ate: null, deleted_at: null };
    const sqls: Array<{ sql: string; params: unknown[] }> = [];
    expect(await conferir(linha, SENHA, sqls)).toBe('ok');
    expect(await conferir(linha, 'outra-senha')).toBe('incorreta');
    expect(sqls[0]!.sql).toMatch(/from core\.usuario/);
    expect(sqls[0]!.params).toEqual([U]);
    expect(JSON.stringify(sqls)).not.toContain(SENHA);
  });
  it('RN-CORE-15: usuário inexistente ou sem senha = incorreta', async () => {
    expect(await conferir(null, SENHA)).toBe('incorreta');
    expect(await conferir({ senha_hash: null, ativo: true, bloqueado_em: null, bloqueio_ate: null, deleted_at: null }, SENHA)).toBe('incorreta');
  });
  it('RN-CORE-15: inativo, excluído ou bloqueado com a senha certa = bloqueado', async () => {
    const senha_hash = await hashSenha(SENHA);
    const base = { senha_hash, ativo: true, bloqueado_em: null, bloqueio_ate: null, deleted_at: null };
    expect(await conferir({ ...base, ativo: false }, SENHA)).toBe('bloqueado');
    expect(await conferir({ ...base, deleted_at: agora }, SENHA)).toBe('bloqueado');
    expect(await conferir({ ...base, bloqueado_em: agora }, SENHA)).toBe('bloqueado');
  });
  it('RN-INT-16: usuário inexistente e senha incorreta gastam uma conferência argon2 cada (tempo comparável)', async () => {
    const senha_hash = await hashSenha(SENHA);
    const t = async (linha: Record<string, unknown> | null) => { const i = performance.now(); await conferir(linha, 'errada'); return performance.now() - i; };
    await t(null); // aquece o hash falso
    const sem = await t(null);
    const errada = await t({ senha_hash, ativo: true, bloqueado_em: null, bloqueio_ate: null, deleted_at: null });
    expect(sem).toBeGreaterThan(errada * 0.4);
    expect(sem).toBeLessThan(errada * 2.5);
  });
  it('RN-INT-16: a entrada recusa campo extra e usuário que não é uuid', () => {
    expect(() => CredencialConferirEntradaSchema.parse({ usuario_id: 'x', senha: 'a' })).toThrow();
    expect(() => CredencialConferirEntradaSchema.parse({ usuario_id: U, senha: 'a', tenant_id: 't' })).toThrow();
  });
});
