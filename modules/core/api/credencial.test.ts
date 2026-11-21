import { catalogoDePermissoes, matrizDeFabrica, type ClienteBanco, type ContextoConsulta, type Manifesto } from '@macuxi/platform-sdk';
import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CredencialConferirEntradaSchema, CredencialConferirSaidaSchema, UsuariosComAcaoEntradaSchema } from '../contracts';
import { hashSenha } from './seguranca';
import { consultaCredencialConferir, consultaUsuariosComAcao } from './credencial';

// O argon2 de verdade, com espião: conta as conferências e os parâmetros de cada uma.
vi.mock('node:crypto', async (original) => {
  const real = await original<typeof import('node:crypto')>();
  return { ...real, argon2: vi.fn((real as unknown as { argon2: (...a: unknown[]) => void }).argon2) };
});
type ChamadaArgon2 = [string, { memory: number; passes: number; parallelism: number; tagLength: number }, unknown];
const argon2 = (crypto as unknown as { argon2: { mock: { calls: ChamadaArgon2[] }; mockClear: () => void } }).argon2;

const U = '0ea00000-0000-4000-8000-0000000000a1';
const SENHA = 'Senha-Do-Admin-123';
const agora = new Date('2026-11-15T12:00:00Z');

const T = '0ea00000-0000-4000-8000-0000000000b1';
const ACAO = { modulo: 'integracao', acao: 'lote.reprocessar' };
// manifesto mínimo do Hub: a fábrica concede lote.reprocessar a admin e analista (a matriz completa vem do contexto da API)
const MANIFESTO = { id: 'integracao', acoes: { 'lote.reprocessar': { perfis: ['admin', 'analista'] } } } as unknown as Manifesto;
const permissoes = { catalogo: catalogoDePermissoes([MANIFESTO]), matriz: matrizDeFabrica([MANIFESTO]) };
const PERFIL_FAB = (base: string, sobreposicoes: unknown[] = []) => ({ codigo: base, base, fabrica: true, sobreposicoes });
const LINHA = { ativo: true, bloqueado_em: null, bloqueio_ate: null, excluido: false, perfil: 'admin' };

/** Banco falso: a 1ª consulta é o usuário; a que chama `perfis_do_usuario` devolve `perfis` (vazio = usuário antigo, cai na fábrica do principal). */
async function conferir(linha: Record<string, unknown> | null, senha: string, sqls: Array<{ sql: string; params: unknown[] }> = [], perfis: unknown[] = [], acao = ACAO) {
  const db: ClienteBanco = {
    query: async (sql, params) => {
      sqls.push({ sql, params: (params ?? []) as unknown[] });
      if (/perfis_do_usuario/.test(sql)) return { rows: perfis, rowCount: perfis.length } as never;
      return { rows: linha ? [linha] : [], rowCount: linha ? 1 : 0 } as never;
    },
  };
  const ctx = { db, agora: () => agora, usuario: { id: 'x', tenant_id: T }, permissoes } as unknown as ContextoConsulta;
  const r = await consultaCredencialConferir.executar(CredencialConferirEntradaSchema.parse({ usuario_id: U, senha, acao }), ctx);
  return CredencialConferirSaidaSchema.parse(r).resultado;
}

describe('RN-INT-16 e RN-CORE-15: core.credencial_conferir@1', () => {
  it('RN-INT-16: senha certa de usuário ativo = ok; errada = incorreta; usa o hash argon2id do login', async () => {
    const senha_hash = await hashSenha(SENHA);
    const linha = { senha_hash, ...LINHA };
    const sqls: Array<{ sql: string; params: unknown[] }> = [];
    expect(await conferir(linha, SENHA, sqls)).toBe('ok');
    expect(await conferir(linha, 'outra-senha')).toBe('incorreta');
    expect(sqls[0]!.sql).toMatch(/from core\.usuario/);
    expect(sqls[0]!.params).toEqual([U, T]); // tenant explícito além da RLS
    expect(sqls[0]!.sql).toMatch(/tenant_id = \$2/);
    expect(JSON.stringify(sqls)).not.toContain(SENHA);
  });
  it('RN-CORE-15: usuário inexistente ou sem senha = incorreta', async () => {
    expect(await conferir(null, SENHA)).toBe('incorreta');
    expect(await conferir({ senha_hash: null, ...LINHA }, SENHA)).toBe('incorreta');
  });
  it('RN-CORE-15: inativo, excluído ou bloqueado com a senha certa = bloqueado', async () => {
    const senha_hash = await hashSenha(SENHA);
    const base = { senha_hash, ...LINHA };
    expect(await conferir({ ...base, ativo: false }, SENHA)).toBe('bloqueado');
    expect(await conferir({ ...base, excluido: true }, SENHA)).toBe('bloqueado');
    expect(await conferir({ ...base, bloqueado_em: agora }, SENHA)).toBe('bloqueado');
  });
  it('RN-INT-16: usuário inexistente e senha incorreta gastam uma conferência argon2 cada (tempo comparável)', async () => {
    const senha_hash = await hashSenha(SENHA);
    const custo = async (linha: Record<string, unknown> | null) => {
      argon2.mockClear();
      await conferir(linha, 'errada');
      return argon2.mock.calls.map(([alg, p]) => ({ alg, memory: p.memory, passes: p.passes, parallelism: p.parallelism, tagLength: p.tagLength }));
    };
    await custo(null); // aquece o hash falso (gerado uma vez por processo)
    const sem = await custo(null);
    const errada = await custo({ senha_hash, ...LINHA });
    const semSenha = await custo({ senha_hash: null, ...LINHA });
    expect(errada).toEqual([{ alg: 'argon2id', memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 }]);
    expect(sem).toEqual(errada);
    expect(semSenha).toEqual(errada);
  });
  it('RN-INT-16: a entrada recusa campo extra, usuário que não é uuid e ausência da ação', () => {
    expect(() => CredencialConferirEntradaSchema.parse({ usuario_id: 'x', senha: 'a', acao: ACAO })).toThrow();
    expect(() => CredencialConferirEntradaSchema.parse({ usuario_id: U, senha: 'a', acao: ACAO, tenant_id: 't' })).toThrow();
    expect(() => CredencialConferirEntradaSchema.parse({ usuario_id: U, senha: 'a' })).toThrow();
  });
});

describe('RN-INT-16 e RN-CORE-35: permissão efetiva na credencial', () => {
  const comSenha = async (perfil: string) => ({ senha_hash: await hashSenha(SENHA), ...LINHA, perfil });
  it('RN-CORE-35: perfil de fábrica com a ação (admin, analista) = ok; sem a ação (vendedor) = sem_permissao', async () => {
    expect(await conferir(await comSenha('admin'), SENHA, [], [PERFIL_FAB('admin')])).toBe('ok');
    expect(await conferir(await comSenha('analista'), SENHA, [], [PERFIL_FAB('analista')])).toBe('ok');
    expect(await conferir(await comSenha('vendedor'), SENHA, [], [PERFIL_FAB('vendedor')])).toBe('sem_permissao');
  });
  it('RN-CORE-35: perfil personalizado de base analista SEM a ação (sobreposição) = sem_permissao, mesmo com senha certa', async () => {
    const perfis = [{ codigo: 'analista_leitura', base: 'analista', fabrica: false, sobreposicoes: [{ chave: 'lote.reprocessar', concedida: false }] }];
    expect(await conferir(await comSenha('analista'), SENHA, [], perfis)).toBe('sem_permissao');
  });
  it('RN-CORE-35: perfil personalizado de base supervisor COM a ação concedida = ok', async () => {
    const perfis = [{ codigo: 'sup_lotes', base: 'supervisor', fabrica: false, sobreposicoes: [{ chave: 'lote.reprocessar', concedida: true }] }];
    expect(await conferir(await comSenha('supervisor'), SENHA, [], perfis)).toBe('ok');
  });
  it('RN-CORE-35: multiperfil vale pela união (um dos perfis com a ação basta)', async () => {
    expect(await conferir(await comSenha('vendedor'), SENHA, [], [PERFIL_FAB('vendedor'), PERFIL_FAB('analista')])).toBe('ok');
  });
  it('RN-INT-16: usuário inexistente também consulta os perfis (mesmo caminho) e dá incorreta', async () => {
    const sqls: Array<{ sql: string; params: unknown[] }> = [];
    expect(await conferir(null, SENHA, sqls)).toBe('incorreta');
    expect(sqls.some((q) => /perfis_do_usuario/.test(q.sql))).toBe(true);
  });
  it('RN-INT-16: sem a matriz de fábrica dos módulos no contexto, falha fechada (sem_permissao), nunca ok', async () => {
    const db: ClienteBanco = { query: async (sql) => ({ rows: /perfis_do_usuario/.test(sql) ? [PERFIL_FAB('admin')] : [await comSenha('admin')], rowCount: 1 }) as never };
    const r = await consultaCredencialConferir.executar(CredencialConferirEntradaSchema.parse({ usuario_id: U, senha: SENHA, acao: ACAO }), { db, agora: () => agora, usuario: { id: 'x', tenant_id: T } } as unknown as ContextoConsulta);
    expect(r.resultado).toBe('sem_permissao');
  });
});

describe('RN-INT-16 e RN-CORE-35: core.usuarios_com_acao@1', () => {
  const linha = (id: string, nome: string, perfil: string, p: ReturnType<typeof PERFIL_FAB>, extra: Record<string, unknown> = {}) => ({ id, nome, perfil, ativo: true, bloqueado_em: null, bloqueio_ate: null, codigo: p.codigo, base: p.base, fabrica: p.fabrica, sobreposicoes: p.sobreposicoes, ...extra });
  const A1 = '0ea00000-0000-4000-8000-0000000000c1';
  const A2 = '0ea00000-0000-4000-8000-0000000000c2';
  const A3 = '0ea00000-0000-4000-8000-0000000000c3';
  const A4 = '0ea00000-0000-4000-8000-0000000000c4';
  async function listar(rows: unknown[], sqls: Array<{ sql: string; params: unknown[] }> = []) {
    const db: ClienteBanco = { query: async (sql, params) => { sqls.push({ sql, params: (params ?? []) as unknown[] }); return { rows, rowCount: rows.length } as never; } };
    const r = await consultaUsuariosComAcao.executar(UsuariosComAcaoEntradaSchema.parse(ACAO), { db, agora: () => agora, usuario: { id: 'x', tenant_id: T }, permissoes } as unknown as ContextoConsulta);
    return r.usuarios;
  }
  it('RN-CORE-35: lista só quem tem a ação na permissão efetiva (fábrica, concedida e negada), ativo e liberado, só id e nome', async () => {
    const sqls: Array<{ sql: string; params: unknown[] }> = [];
    const r = await listar(
      [
        linha(A1, 'Ana', 'admin', PERFIL_FAB('admin')),
        linha(A2, 'Bia', 'analista', { codigo: 'analista_leitura', base: 'analista', fabrica: false, sobreposicoes: [{ chave: 'lote.reprocessar', concedida: false }] }),
        linha(A3, 'Caio', 'supervisor', { codigo: 'sup_lotes', base: 'supervisor', fabrica: false, sobreposicoes: [{ chave: 'lote.reprocessar', concedida: true }] }),
        linha(A4, 'Duda', 'analista', PERFIL_FAB('analista'), { bloqueado_em: agora }),
      ],
      sqls,
    );
    expect(r).toEqual([{ id: A1, nome: 'Ana' }, { id: A3, nome: 'Caio' }]);
    expect(sqls[0]!.params).toEqual([T]);
    expect(sqls[0]!.sql).toMatch(/u\.ativo/);
    expect(sqls[0]!.sql).not.toMatch(/email|senha/);
  });
  it('RN-CORE-35: usuário sem nenhuma linha de perfil cai na fábrica do principal', async () => {
    const sem = { id: A1, nome: 'Ana', perfil: 'analista', ativo: true, bloqueado_em: null, bloqueio_ate: null, codigo: null, base: null, fabrica: null, sobreposicoes: null };
    expect(await listar([sem])).toEqual([{ id: A1, nome: 'Ana' }]);
  });
});
