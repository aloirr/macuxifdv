import { describe, expect, it } from 'vitest';
import { atualizacaoDoSinal } from './conector-versao';

const OK = { resultado: 'atualizado', versao_de: '1.2.1', versao_para: '1.3.0', em: '2026-11-09T03:00:00.000Z', mensagem: 'Conector atualizado e respondendo na versão nova.' };

describe('T-0100: resultado da atualização automática no sinal de vida (campo opcional)', () => {
  it('T-0100: lê a atualização do sinal_resumo quando o Conector informou', () => {
    expect(atualizacaoDoSinal({ fila: [], entidades: [], atualizacao: OK })).toEqual(OK);
  });

  it('T-0100: Conector antigo (sem o campo), nulo ou fora do formato = null, sem derrubar a listagem do monitor', () => {
    for (const v of [null, undefined, 'x', [], {}, { atualizacao: null }, { atualizacao: { resultado: 'explodiu' } }, { atualizacao: { ...OK, mensagem: '' } }]) {
      expect(atualizacaoDoSinal(v)).toBeNull();
    }
  });
});
