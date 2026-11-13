import { describe, expect, it } from 'vitest';
import { UsuarioAvatarPushSchema, UsuarioAvatarSyncSchema } from './avatar';

const id = (n: number) => `0a100000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('RN-CORE-42: contrato da foto ou avatar', () => {
  it('RN-CORE-42: avatar ⇔ código; foto ⇔ arquivo; iniciais sem nenhum', () => {
    const t = { id: id(1), usuario_id: id(2), alterado_em: '2026-11-13T12:00:00.000Z' };
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'avatar', avatar_codigo: 'm1', arquivo_id: null }).success).toBe(true);
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'foto', avatar_codigo: null, arquivo_id: id(3) }).success).toBe(true);
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'iniciais', avatar_codigo: null, arquivo_id: null }).success).toBe(true);
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'avatar', avatar_codigo: null, arquivo_id: null }).success).toBe(false);
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'foto', avatar_codigo: 'm1', arquivo_id: id(3) }).success).toBe(false);
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'iniciais', avatar_codigo: null, arquivo_id: id(3) }).success).toBe(false);
    expect(UsuarioAvatarPushSchema.safeParse({ ...t, tipo: 'avatar', avatar_codigo: 'x9', arquivo_id: null }).success).toBe(false);
  });
  it('RN-CORE-42: a linha do pull leva quem trocou e aceita o horário do banco', () => {
    const l = {
      id: id(1),
      usuario_id: id(2),
      tipo: 'avatar',
      avatar_codigo: 'f3',
      arquivo_id: null,
      alterado_em: '2026-11-13 12:00:00.123456+00',
      alterado_por: id(4),
      updated_at: '2026-11-13 12:00:00.123456+00',
      deleted_at: null,
      external_id: null,
    };
    expect(UsuarioAvatarSyncSchema.safeParse(l).success).toBe(true);
    expect(UsuarioAvatarSyncSchema.safeParse({ ...l, alterado_por: undefined }).success).toBe(false);
  });
});
