/**
 * T-0170 × Postgres real (fixture dois-tenants, RLS): foto ou avatar do usuário (RN-CORE-42; desenho `inicio-frase-avatar-pedidos.md`
 * §2.2 e §2.3). Push do aparelho (só a própria conta, idempotente, a última troca vence pelo `alterado_em`, relógio adiantado, foto
 * com arquivo aguardando) e rota do BKO (escopo de `usuariosVisiveis`). Pull com o escopo de usuários visíveis. Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, UsuarioAutenticado } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsuarioAvatarSyncSchema } from '../contracts/avatar';
import { A, AmbienteBanco, B, idDe, U } from './apoio-teste-t0170';
import { rotasDeAvatar } from './avatar';
import { provedoresSyncT0170 } from './sync-t0170';

const FAIXA = '0e800000';
const id = idDe(FAIXA);
const dia = (n: number) => `2026-03-${String(n).padStart(2, '0')}T10:00:00.000Z`;

describe.skipIf(semBanco())('Core T-0170 × Postgres: foto ou avatar', () => {
  const amb = new AmbienteBanco();
  const admin = amb.usuario(U.admin, 'admin');
  const gerente = amb.usuario(U.gerente, 'gerente');
  const supervisor = amb.usuario(U.supervisor, 'supervisor');
  const vendedor1 = amb.usuario(U.vendedor1, 'vendedor');
  const vendedor2 = amb.usuario(U.vendedor2, 'vendedor');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
  const troca = (n: number, usuario: string, alterado_em: string, extra: Record<string, unknown> = {}) => ({ id: id(n), usuario_id: usuario, tipo: 'avatar', avatar_codigo: 'm1', arquivo_id: null, alterado_em, ...extra });
  const enviar = (u: UsuarioAutenticado, t: Record<string, unknown>) => amb.receber(provedoresSyncT0170, 'usuario_avatar', u, [{ id: t.id as string, operacao: 'criar', payload: t } as unknown as ItemPush]);
  const linhas = (u: UsuarioAutenticado) => amb.puxar(provedoresSyncT0170, 'usuario_avatar', u) as Promise<Array<Record<string, any>>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const vivaDe = async (uid: string) => amb.noTenant(A.tenantId, async (db) => (await db.query<{ id: string; tipo: string; avatar_codigo: string | null; arquivo_id: string | null; alterado_em: string; epoch: number }>('select id, tipo, avatar_codigo, arquivo_id, alterado_em::text, extract(epoch from alterado_em)::float8 as epoch from core.usuario_avatar where usuario_id = $1 and deleted_at is null', [uid])).rows);
  const limpar = async () => {
    await amb.limpar(`delete from plataforma.arquivo where id::text like '${FAIXA}-%'`);
    await amb.limpar(`delete from core.usuario_avatar where id::text like '${FAIXA}-%'`);
  };

  beforeAll(async () => {
    await amb.abrir();
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await amb.fechar();
  });

  it('RN-CORE-42: o vendedor escolhe um avatar; vira a única viva, o pull leva a linha (schema válido) e reenviar o mesmo id não muda nada', async () => {
    expect(await enviar(vendedor1, troca(1, U.vendedor1, dia(1)))).toEqual([{ id: id(1), status: 'aceito' }]);
    const viva = await vivaDe(U.vendedor1);
    expect(viva).toHaveLength(1);
    expect(viva[0]).toMatchObject({ id: id(1), tipo: 'avatar', avatar_codigo: 'm1' });
    const meu = (await linhas(vendedor1)).find((l) => l.id === id(1))!;
    expect(UsuarioAvatarSyncSchema.parse(meu)).toMatchObject({ usuario_id: U.vendedor1, alterado_por: U.vendedor1, deleted_at: null });
    expect(await enviar(vendedor1, troca(1, U.vendedor1, dia(1)))).toEqual([{ id: id(1), status: 'aceito' }]);
    expect(await vivaDe(U.vendedor1)).toHaveLength(1);
  });

  it('a última troca vence: a nova apaga logicamente a anterior (que o pull manda como removida); troca mais antiga que a viva é gravada já apagada', async () => {
    await enviar(vendedor1, troca(2, U.vendedor1, dia(5), { avatar_codigo: 'f2' }));
    expect((await vivaDe(U.vendedor1)).map((v) => [v.id, v.avatar_codigo])).toEqual([[id(2), 'f2']]);
    const pull = await linhas(vendedor1);
    expect(pull.find((l) => l.id === id(1))).toMatchObject({ deleted_at: expect.any(String) });
    // offline: a troca de dia 3 chega depois da de dia 5
    expect(await enviar(vendedor1, troca(3, U.vendedor1, dia(3), { avatar_codigo: 'f3' }))).toEqual([{ id: id(3), status: 'aceito' }]);
    expect((await vivaDe(U.vendedor1)).map((v) => v.id)).toEqual([id(2)]);
    expect((await linhas(vendedor1)).find((l) => l.id === id(3))).toMatchObject({ deleted_at: expect.any(String) });
  });

  it('voltar às iniciais é uma troca (tipo iniciais, sem código nem arquivo) e a viva passa a ser ela', async () => {
    await enviar(vendedor1, troca(4, U.vendedor1, dia(6), { tipo: 'iniciais', avatar_codigo: null }));
    expect((await vivaDe(U.vendedor1)).map((v) => [v.id, v.tipo])).toEqual([[id(4), 'iniciais']]);
  });

  it('relógio do aparelho mais de 24 h adiantado: grava com o horário do servidor', async () => {
    const futuro = new Date(Date.now() + 5 * 86_400_000).toISOString(); // hora-fixa-ok: relógio adiantado de propósito
    await enviar(vendedor1, troca(5, U.vendedor1, futuro, { avatar_codigo: 'm3' }));
    const v = (await vivaDe(U.vendedor1))[0]!;
    expect(v.id).toBe(id(5));
    expect(v.epoch * 1000 < Date.now() + 3_600_000).toBe(true); // hora-fixa-ok: comparação com o relógio real
  });

  it('foto: registra o arquivo (finalidade avatar, aguardando) e, ao trocar, apaga a linha e o arquivo anteriores', async () => {
    await enviar(vendedor2, troca(6, U.vendedor2, dia(10), { tipo: 'foto', avatar_codigo: null, arquivo_id: id(700) }));
    const arq = await amb.noTenant(A.tenantId, async (db) => (await db.query<{ finalidade: string; situacao: string; entidade: string; entidade_id: string; cliente_id: string | null; deleted_at: string | null }>('select finalidade, situacao, entidade, entidade_id, cliente_id, deleted_at from plataforma.arquivo where id = $1', [id(700)])).rows);
    expect(arq).toEqual([{ finalidade: 'avatar', situacao: 'aguardando', entidade: 'usuario_avatar', entidade_id: id(6), cliente_id: null, deleted_at: null }]);
    await enviar(vendedor2, troca(7, U.vendedor2, dia(11), { avatar_codigo: 'f1' }));
    const depois = await amb.noTenant(A.tenantId, async (db) => (await db.query<{ deleted_at: string | null }>('select deleted_at from plataforma.arquivo where id = $1', [id(700)])).rows[0]!);
    expect(depois.deleted_at).not.toBeNull();
    expect((await vivaDe(U.vendedor2)).map((v) => v.id)).toEqual([id(7)]);
  });

  it('só a própria conta: trocar a de outro usuário é FORA_DO_ESCOPO; o mesmo id de troca de outro usuário é ID_EM_USO; comando incompleto é PAYLOAD_INVALIDO', async () => {
    expect((await enviar(vendedor1, troca(8, U.vendedor2, dia(12))))[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DO_ESCOPO' });
    expect((await enviar(vendedor2, troca(5, U.vendedor2, dia(12))))[0]).toMatchObject({ status: 'rejeitado', codigo: 'ID_EM_USO' });
    expect((await enviar(vendedor1, { id: id(9), usuario_id: U.vendedor1, tipo: 'foto', avatar_codigo: null, arquivo_id: null, alterado_em: dia(12) }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
    const nada = await amb.noTenant(A.tenantId, async (db) => Number((await db.query('select count(*) as n from core.usuario_avatar where id = any($1::uuid[])', [[id(8), id(9)]])).rows[0]!.n));
    expect(nada).toBe(0);
  });

  it('pull por usuários visíveis: o vendedor recebe só a dele; o supervisor, a da equipe (e a que a fixture já tem); o tenant B nunca recebe as do A', async () => {
    const doVendedor = await linhas(vendedor1);
    expect(doVendedor.every((l) => l.usuario_id === U.vendedor1)).toBe(true);
    const doSupervisor = await linhas(supervisor);
    expect(doSupervisor.some((l) => l.usuario_id === U.vendedor1)).toBe(true);
    expect(doSupervisor.some((l) => l.usuario_id === U.vendedor2)).toBe(false);
    expect(doSupervisor.some((l) => l.usuario_id === U.supervisor)).toBe(true);
    const doGerente = await linhas(gerente);
    expect(doGerente.some((l) => l.usuario_id === U.vendedor2)).toBe(true);
    expect((await linhas(adminB)).some((l) => String(l.id).startsWith(FAIXA))).toBe(false);
  });

  it('BKO: o admin troca a de qualquer usuário; o gerente só da equipe dele; o supervisor fora da equipe e o tenant B recebem 404; corpo e página precisam do mesmo usuário', async () => {
    const r = await amb.chamar(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar', admin, { params: { id: U.vendedor2 }, corpo: troca(20, U.vendedor2, dia(20), { avatar_codigo: 'f3' }) });
    expect(r).toMatchObject({ id: id(20), usuario_id: U.vendedor2, resultado: 'aplicada' });
    expect((await vivaDe(U.vendedor2)).map((v) => [v.id, v.avatar_codigo])).toEqual([[id(20), 'f3']]);
    const viva = (await linhas(gerente)).find((l) => l.id === id(20))!;
    expect(viva.alterado_por).toBe(U.admin);
    expect(await amb.chamar(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar', gerente, { params: { id: U.vendedor2 }, corpo: troca(21, U.vendedor2, dia(21)) })).toMatchObject({ resultado: 'aplicada' });
    await expect(amb.chamar(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar', supervisor, { params: { id: U.vendedor2 }, corpo: troca(22, U.vendedor2, dia(22)) })).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
    await expect(amb.chamar(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar', adminB, { params: { id: U.vendedor2 }, corpo: troca(23, U.vendedor2, dia(23)) })).rejects.toMatchObject({ status: 404 });
    await expect(amb.chamar(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar', admin, { params: { id: U.vendedor1 }, corpo: troca(24, U.vendedor2, dia(24)) })).rejects.toMatchObject({ status: 422, codigo: 'AVATAR_USUARIO_DIFERENTE' });
    expect(await amb.chamar(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar', gerente, { params: { id: U.vendedor2 }, corpo: troca(21, U.vendedor2, dia(21)) })).toMatchObject({ resultado: 'ja_existia' });
    const rota = amb.rota(rotasDeAvatar, 'PUT', 'usuarios/:id/avatar');
    expect(rota).toMatchObject({ acao: 'usuario_avatar.trocar_outro', superficie: 'bko' });
  });

  it('sem dado pessoal em log: só ids', () => {
    const texto = amb.linhasDeLog.join('\n');
    expect(texto).not.toMatch(/Vendedor|Gerente|@exemplo|\.jpg/);
  });
});
