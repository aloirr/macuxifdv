import { describe, expect, it } from 'vitest';
import { AVISO_APARELHO_LIMPO, CODIGO_DISPOSITIVO_BLOQUEADO } from '../../contracts';
import { ehAparelhoBloqueado, tratarAparelhoBloqueado } from './aparelho-bloqueado';
import { mensagemDeErroDeLogin } from './login';

function acoes() {
  const chamadas: string[] = [];
  return {
    chamadas,
    apagarDadosLocais: async () => void chamadas.push('apagar'),
    encerrarSessao: async () => void chamadas.push('sessao'),
    avisar: (m: string) => void chamadas.push(`aviso:${m}`),
    irParaLogin: () => void chamadas.push('login'),
  };
}

describe('RN-CORE-15: aparelho bloqueado no app', () => {
  it('RN-CORE-15: 423 DISPOSITIVO_BLOQUEADO apaga dados e fila, encerra a sessão, avisa e volta ao login (nessa ordem)', async () => {
    const a = acoes();
    expect(await tratarAparelhoBloqueado({ status: 423, code: CODIGO_DISPOSITIVO_BLOQUEADO }, a)).toBe(true);
    expect(a.chamadas).toEqual(['apagar', 'sessao', `aviso:${AVISO_APARELHO_LIMPO}`, 'login']);
  });

  it('RN-CORE-15: reconhece o código nos dois formatos de erro (API `codigo` e HttpError do app `code`)', () => {
    expect(ehAparelhoBloqueado({ codigo: CODIGO_DISPOSITIVO_BLOQUEADO })).toBe(true);
    expect(ehAparelhoBloqueado({ code: CODIGO_DISPOSITIVO_BLOQUEADO })).toBe(true);
  });

  it('RN-CORE-15: usuário bloqueado (USUARIO_BLOQUEADO), sessão expirada e falta de rede NÃO apagam nada', async () => {
    for (const e of [{ codigo: 'USUARIO_BLOQUEADO', status: 423 }, { codigo: 'SESSAO_INVALIDA', status: 401 }, new Error('Sem conexão'), null, undefined]) {
      const a = acoes();
      expect(await tratarAparelhoBloqueado(e, a)).toBe(false);
      expect(a.chamadas).toEqual([]);
    }
  });

  it('RN-CORE-15: se a limpeza falhar, o erro sobe e o aviso de "dados apagados" não aparece', async () => {
    const a = { ...acoes(), apagarDadosLocais: async () => Promise.reject(new Error('disco cheio')) };
    await expect(tratarAparelhoBloqueado({ codigo: CODIGO_DISPOSITIVO_BLOQUEADO }, a)).rejects.toThrow('disco cheio');
    expect(a.chamadas).toEqual([]);
  });

  it('RN-CORE-15: o login mostra a mensagem do aparelho bloqueado, em português e com a ação seguinte', () => {
    const m = mensagemDeErroDeLogin({ codigo: CODIGO_DISPOSITIVO_BLOQUEADO });
    expect(m).toMatch(/aparelho/i);
    expect(m).toMatch(/administrador/i);
  });
});
