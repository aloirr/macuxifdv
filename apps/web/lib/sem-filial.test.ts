/** T-0176 (RN-CORE-39; ADR 0056): o BKO reconhece o 403 `USUARIO_SEM_FILIAL` e abre a "Escolha a sua filial". */
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it, vi } from 'vitest';

import { estadoDoConteudo } from './estado-shell';
import { aoSemFilial, avisarSeSemFilial } from './sem-filial';

describe('403 USUARIO_SEM_FILIAL no BKO', () => {
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

});
