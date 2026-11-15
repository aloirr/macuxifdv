/** T-0176 (RN-CORE-39; ADR 0056): o BKO reconhece o 403 `USUARIO_SEM_FILIAL` e abre a "Escolha a sua filial". */
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it, vi } from 'vitest';

import { estadoDoConteudo } from './estado-shell';
import { aoSemFilial, AVISO_SEM_FILIAL, avisarSeSemFilial, ehUsuarioSemFilial } from './sem-filial';

describe('403 USUARIO_SEM_FILIAL no BKO', () => {
  it('reconhece só o 403 com o código', () => {
    expect(ehUsuarioSemFilial(new ApiRequestError(403, 'USUARIO_SEM_FILIAL', 'x'))).toBe(true);
    expect(ehUsuarioSemFilial(new ApiRequestError(403, 'PERFIL_SEM_BKO', 'x'))).toBe(false);
    expect(ehUsuarioSemFilial(new ApiRequestError(500, 'USUARIO_SEM_FILIAL', 'x'))).toBe(false);
    expect(ehUsuarioSemFilial(undefined)).toBe(false);
  });

  it('uma consulta ou gravação com o 403 avisa o shell; outro erro, não', () => {
    const ouvinte = vi.fn();
    const cancelar = aoSemFilial(ouvinte);
    expect(avisarSeSemFilial(new ApiRequestError(403, 'MODULO_INATIVO', 'x'))).toBe(false);
    expect(ouvinte).not.toHaveBeenCalled();
    expect(avisarSeSemFilial(new ApiRequestError(403, 'USUARIO_SEM_FILIAL', 'x'))).toBe(true);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    cancelar();
    avisarSeSemFilial(new ApiRequestError(403, 'USUARIO_SEM_FILIAL', 'x'));
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it('o miolo vira o aviso, no lugar do erro genérico dos módulos', () => {
    const modulos = { isError: true, data: undefined };
    expect(estadoDoConteudo({ erroMe: false, perfilUsaWeb: true, modulos })).toBe('erro_modulos');
    expect(estadoDoConteudo({ erroMe: false, perfilUsaWeb: true, modulos, semFilial: true })).toBe('sem_filial');
    expect(estadoDoConteudo({ erroMe: false, perfilUsaWeb: true, modulos: { isError: false, data: ['core'] }, semFilial: true })).toBe('sem_filial');
  });

  it('o texto aprovado da tela 13', () => {
    expect(AVISO_SEM_FILIAL).toBe('Sua conta está sem filial de cadastro. Peça ao administrador da empresa para informar a filial.');
  });
});
