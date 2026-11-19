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

  it('RN-CORE-13: o menu "Trajeto do dia" do BKO e do manifesto pede só `trajeto.ver_equipe`; vendedor e promotor não o veem', async () => {
    const { moduloWeb } = await import('../index');
    const pagina = moduloWeb.paginas!.find((p) => p.navegacao === 'Trajeto do dia')!;
    expect(pagina.acao).toBe('trajeto.ver_equipe');
    expect(pagina.perfis).toBeUndefined();
    expect(manifest.apps.web?.menus).toContain('Trajeto do dia');
    expect(manifest.apps.gestao?.abas).not.toContain('Trajeto do dia');
    for (const perfil of ['vendedor', 'promotor'] as const) expect(pode(perfil)).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain('ver_proprio');
  });
});
