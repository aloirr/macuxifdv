/**
 * Foto ou avatar (RN-CORE-42; T-0170) sem banco: o `receber` do push e `aplicarTrocaNoBanco` com um banco falso — as saídas da regra
 * do domain (substituir, superada, já existia, fora do escopo) viram os comandos certos no banco. O comportamento sobre dados reais
 * está em `avatar.db.test.ts`.
 */
import { ErroHttpModulo, type ClienteBanco, type ContextoBase, type ItemPush, type NovoArquivo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { UsuarioAvatarPush } from '../contracts/avatar';
import { aplicarTrocaNoBanco, receberAvatares, rotasDeAvatar } from './avatar';

const U1 = '0e200000-0000-4000-8000-000000000001';
const U2 = '0e200000-0000-4000-8000-000000000002';
const T1 = '0e200000-0000-4000-8000-0000000000a1';
const T2 = '0e200000-0000-4000-8000-0000000000a2';
const ARQ = '0e200000-0000-4000-8000-0000000000f1';
const AGORA = new Date('2026-11-13T15:00:00.000Z');

interface Viva {
  id: string;
  usuario_id: string;
  tipo: string;
  avatar_codigo: string | null;
  arquivo_id: string | null;
  alterado_em: string;
}
function banco(o: { viva?: Viva | null; dono?: string | null; usuarioExiste?: boolean } = {}) {
  const sqls: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const arquivos: Array<Record<string, unknown>> = [];
  const db = {
    query: async (sql: string, valores: readonly unknown[] = []) => {
      sqls.push({ sql, valores });
      if (/select usuario_id from core\.usuario_avatar where id/.test(sql)) return { rows: o.dono ? [{ usuario_id: o.dono }] : [], rowCount: o.dono ? 1 : 0 };
      if (/select 1 from core\.usuario where/.test(sql)) return { rows: o.usuarioExiste === false ? [] : [{}], rowCount: o.usuarioExiste === false ? 0 : 1 };
      if (/from core\.usuario_avatar where usuario_id/.test(sql)) return { rows: o.viva ? [o.viva] : [], rowCount: o.viva ? 1 : 0 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as ClienteBanco;
  const tx = { registrarArquivo: async (a: NovoArquivo) => (arquivos.push({ ...a }), { criado: true }) };
  return { db, tx, sqls, arquivos };
}
const troca = (extra: Partial<UsuarioAvatarPush> = {}): UsuarioAvatarPush => ({ id: T1, usuario_id: U1, tipo: 'avatar', avatar_codigo: 'm1', arquivo_id: null, alterado_em: '2026-11-13T14:00:00.000Z', ...extra });
const contexto = (pode = false, usuario = U1) => ({ usuario_id: usuario, pode_trocar_outro: pode, agora: AGORA });
const viva = (extra: Partial<Viva> = {}): Viva => ({ id: T2, usuario_id: U1, tipo: 'avatar', avatar_codigo: 'f1', arquivo_id: null, alterado_em: '2026-11-12T10:00:00.000Z', ...extra });
const escritas = (b: ReturnType<typeof banco>) => b.sqls.filter((x) => /^\s*(update|insert)/i.test(x.sql));

describe('aplicarTrocaNoBanco (RN-CORE-42)', () => {
  it('sem escolha anterior: grava a viva (sem apagar nada) e responde aplicada', async () => {
    const b = banco();
    expect(await aplicarTrocaNoBanco(b.db, b.tx, troca(), contexto())).toBe('aplicada');
    const e = escritas(b);
    expect(e).toHaveLength(1);
    expect(e[0]!.sql).toMatch(/^\s*insert into core\.usuario_avatar/);
    expect(e[0]!.valores).toEqual([T1, U1, 'avatar', 'm1', null, '2026-11-13T14:00:00.000Z', U1, false]);
  });

  it('troca mais nova: apaga a viva e, sendo foto, o arquivo dela; depois grava a nova', async () => {
    const b = banco({ viva: viva({ tipo: 'foto', avatar_codigo: null, arquivo_id: ARQ }) });
    expect(await aplicarTrocaNoBanco(b.db, b.tx, troca(), contexto())).toBe('aplicada');
    const e = escritas(b).map((x) => x.sql.replace(/\s+/g, ' ').trim());
    expect(e[0]).toMatch(/^update core\.usuario_avatar set deleted_at = now\(\) where id = \$1/);
    expect(e[1]).toMatch(/^update plataforma\.arquivo set deleted_at = now\(\)/);
    expect(e[2]).toMatch(/^insert into core\.usuario_avatar/);
    expect(escritas(b)[1]!.valores).toEqual([ARQ]);
  });

  it('troca mais antiga que a viva: grava já apagada (último parâmetro) e não mexe na viva', async () => {
    const b = banco({ viva: viva({ alterado_em: '2026-11-13T14:30:00.000Z' }) });
    expect(await aplicarTrocaNoBanco(b.db, b.tx, troca(), contexto())).toBe('superada');
    expect(escritas(b)).toHaveLength(1);
    expect(escritas(b)[0]!.valores[7]).toBe(true);
  });

  it('o mesmo id já gravado do mesmo usuário: ja_existia, sem escrever; de outro usuário: 409 ID_EM_USO', async () => {
    const b = banco({ dono: U1 });
    expect(await aplicarTrocaNoBanco(b.db, b.tx, troca(), contexto())).toBe('ja_existia');
    expect(escritas(b)).toHaveLength(0);
    const o = banco({ dono: U2 });
    await expect(aplicarTrocaNoBanco(o.db, o.tx, troca(), contexto())).rejects.toMatchObject({ status: 409, codigo: 'ID_EM_USO' });
  });

  it('só a própria conta (403 FORA_DO_ESCOPO); com a ação do BKO vale para outro usuário; usuário inexistente é 404', async () => {
    const b = banco();
    await expect(aplicarTrocaNoBanco(b.db, b.tx, troca({ usuario_id: U2 }), contexto())).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
    expect(escritas(b)).toHaveLength(0);
    expect(await aplicarTrocaNoBanco(b.db, b.tx, troca({ usuario_id: U2 }), contexto(true))).toBe('aplicada');
    const n = banco({ usuarioExiste: false });
    await expect(aplicarTrocaNoBanco(n.db, n.tx, troca(), contexto())).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
  });

  it('foto: registra o arquivo (finalidade avatar, sem cliente) depois de gravar a linha', async () => {
    const b = banco();
    await aplicarTrocaNoBanco(b.db, b.tx, troca({ tipo: 'foto', avatar_codigo: null, arquivo_id: ARQ }), contexto());
    expect(b.arquivos).toEqual([{ id: ARQ, finalidade: 'avatar', entidade: 'usuario_avatar', entidade_id: T1, cliente_id: null, tipo: 'image/jpeg' }]);
  });

  it('relógio do aparelho 5 dias adiantado: grava o horário do servidor', async () => {
    const b = banco();
    await aplicarTrocaNoBanco(b.db, b.tx, troca({ alterado_em: '2026-11-18T10:00:00.000Z' }), contexto());
    expect(escritas(b)[0]!.valores[5]).toBe(AGORA.toISOString());
  });
});

describe('receberAvatares (push usuario_avatar)', () => {
  const ctxDe = (b: ReturnType<typeof banco>, usuario = U1) =>
    ({ usuario: { id: usuario }, agora: () => AGORA, comTenant: (fn: (db: ClienteBanco, tx: unknown) => Promise<unknown>) => fn(b.db, b.tx) }) as unknown as ContextoBase;
  const item = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}): ItemPush => ({ id: (payload.id as string) ?? T1, operacao: 'criar', payload, ...extra }) as unknown as ItemPush;

  it('aceita a troca do próprio usuário; rejeita (sem derrubar o lote) a de outro, a incompleta, a de id divergente e a remoção', async () => {
    const b = banco();
    const r = await receberAvatares(ctxDe(b), [
      item(troca()),
      item(troca({ id: T2, usuario_id: U2 })),
      item({ ...troca({ id: '0e200000-0000-4000-8000-0000000000a3' }), tipo: 'foto' }),
      item(troca(), { id: '0e200000-0000-4000-8000-0000000000a4' }),
      item(troca(), { operacao: 'remover' }),
    ]);
    expect(r.map((x) => (x.status === 'rejeitado' ? x.codigo : x.status))).toEqual(['aceito', 'FORA_DO_ESCOPO', 'PAYLOAD_INVALIDO', 'PAYLOAD_INVALIDO', 'OPERACAO_NAO_SUPORTADA']);
  });

  it('erro de servidor (5xx) não vira rejeição: sobe para a plataforma repetir', async () => {
    const b = banco();
    const ctx = { ...ctxDe(b), comTenant: async () => { throw new ErroHttpModulo(503, 'INDISPONIVEL', 'x'); } } as unknown as ContextoBase;
    await expect(receberAvatares(ctx, [item(troca())])).rejects.toMatchObject({ status: 503 });
  });
});

describe('rota do BKO', () => {
  it('PUT usuarios/:id/avatar: ação usuario_avatar.trocar_outro, só BKO, corpo do contrato (foto exige arquivo; avatar exige código)', () => {
    const r = rotasDeAvatar[0]!;
    expect(r).toMatchObject({ metodo: 'PUT', caminho: 'usuarios/:id/avatar', acao: 'usuario_avatar.trocar_outro', superficie: 'bko', carteira: 'nao_se_aplica' });
    expect(r.corpo!.safeParse(troca()).success).toBe(true);
    expect(r.corpo!.safeParse(troca({ tipo: 'foto', avatar_codigo: null })).success).toBe(false);
    expect(r.corpo!.safeParse(troca({ avatar_codigo: null })).success).toBe(false);
    expect(r.corpo!.safeParse(troca({ avatar_codigo: 'x9' as never })).success).toBe(false);
    expect(r.corpo!.safeParse(troca({ tipo: 'iniciais', avatar_codigo: null })).success).toBe(true);
  });
});
