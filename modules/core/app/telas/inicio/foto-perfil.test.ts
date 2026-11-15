import { describe, expect, it } from 'vitest';

import type { AvatarGravado } from '../../../domain/frase-avatar/avatar';
import { fotoDoPerfil } from './foto-perfil';

const U = '11111111-1111-4111-8111-111111111111';
const ARQ = '22222222-2222-4222-8222-222222222222';
const linha = (o: Partial<AvatarGravado>): AvatarGravado => ({ id: '33333333-3333-4333-8333-333333333333', usuario_id: U, tipo: 'foto', avatar_codigo: null, arquivo_id: ARQ, alterado_em: '2026-11-10T10:00:00.000Z', ...o });
const resolve = (id: string): string => `file:///fotos/${id}.jpg`;

describe('RN-CORE-42: foto do perfil no cabeçalho do Início', () => {
  it('com foto viva do usuário e o arquivo no aparelho: devolve a URI', async () => {
    expect(await fotoDoPerfil([linha({})], U, resolve)).toBe(`file:///fotos/${ARQ}.jpg`);
  });

  it('sem linha, com iniciais, removida, de outro usuário, sem resolvedor ou arquivo ainda não baixado: null (iniciais)', async () => {
    expect(await fotoDoPerfil([], U, resolve)).toBeNull();
    expect(await fotoDoPerfil(null, U, resolve)).toBeNull();
    expect(await fotoDoPerfil([linha({ tipo: 'iniciais', arquivo_id: null })], U, resolve)).toBeNull();
    expect(await fotoDoPerfil([linha({ deleted_at: '2026-11-11T00:00:00.000Z' })], U, resolve)).toBeNull();
    expect(await fotoDoPerfil([linha({ usuario_id: '44444444-4444-4444-8444-444444444444' })], U, resolve)).toBeNull();
    expect(await fotoDoPerfil([linha({})], U, null)).toBeNull();
    expect(await fotoDoPerfil([linha({})], U, () => null)).toBeNull();
    expect(await fotoDoPerfil([linha({})], U, () => Promise.reject(new Error('sem sinal')))).toBeNull();
  });

  it('a troca mais recente vale (avatar do app depois da foto = iniciais)', async () => {
    const troca = linha({ id: '55555555-5555-4555-8555-555555555555', tipo: 'avatar', avatar_codigo: 'm1', arquivo_id: null, alterado_em: '2026-11-12T10:00:00.000Z' });
    expect(await fotoDoPerfil([linha({}), troca], U, resolve)).toBeNull();
  });
});
