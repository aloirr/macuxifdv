import { describe, expect, it } from 'vitest';
import { manifest as manifestCore } from '@macuxi/core/manifest';
import { criarPermissoes, type Perfil } from '@macuxi/platform-sdk';
import { ACAO_VER_TRAJETO } from '../../contracts';
import manifest from '../../manifest';

describe('trajeto do dia no BKO: a decisão é da permissão `core.trajeto.ver_equipe`, não de uma lista de perfis', () => {
  const motor = criarPermissoes([manifestCore, manifest]);
  const pode = (perfil: Perfil) =>
    motor.pode(ACAO_VER_TRAJETO, { perfil, modulosAtivos: ['core', 'gestor'] });

  it('RN-CORE-37: a ação é do Core, existe no motor e vale de fábrica só para supervisor, gerente e admin', () => {
    expect(motor.conhece(ACAO_VER_TRAJETO)).toBe(true);
    for (const perfil of ['supervisor', 'gerente', 'admin'] as const) expect(pode(perfil)).toBe(true);
    for (const perfil of ['vendedor', 'promotor', 'analista', 'assistente'] as const)
      expect(pode(perfil)).toBe(false);
  });
});
