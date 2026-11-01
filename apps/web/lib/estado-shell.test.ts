import { describe, expect, it } from 'vitest';
import { estadoDoConteudo } from './estado-shell';

const base = { erroMe: false, perfilUsaWeb: true, modulos: { isError: false, data: ['core', 'vendedor'] as string[] | undefined } };

describe('T-0030 D-B30: miolo do BKO só monta com os módulos efetivos carregados (RN-CORE-01/03)', () => {
  it('módulos ainda carregando (F5 em /pedidos com rede lenta) → carregando, nunca a visão só com o Core', () => {
    expect(estadoDoConteudo({ ...base, modulos: { isError: false, data: undefined } })).toBe('carregando_modulos');
  });

  it('módulos carregados → pronto', () => {
    expect(estadoDoConteudo(base)).toBe('pronto');
  });

  it('erro de /me/modulos → erro (com tentar de novo), não 404', () => {
    expect(estadoDoConteudo({ ...base, modulos: { isError: true, data: undefined } })).toBe('erro_modulos');
  });

  it('perfil de app (vendedor/promotor) e erro do /me da demonstração vêm antes', () => {
    expect(estadoDoConteudo({ ...base, perfilUsaWeb: false, modulos: { isError: false, data: undefined } })).toBe('perfil_fora_do_bko');
    expect(estadoDoConteudo({ ...base, erroMe: true })).toBe('erro_me');
  });
});
