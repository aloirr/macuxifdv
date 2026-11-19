/**
 * T-0147 (RN-CORE-38): visualizador da foto do PDV — leitura da rota (a ida está em visor-foto.test.ts), ordem das fontes (local sem sinal; nuvem só com
 * sinal, "Sem internet") e o base64 da imagem em memória (`data:` URI).
 */
import { describe, expect, it } from 'vitest';

import { bytesParaBase64, fonteDaFoto, pedidoDaRota, TEXTO_FOTO_INDISPONIVEL, TEXTO_SEM_SINAL_FOTO } from './foto-pdv';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';

describe('rota do visualizador', () => {
  it('arquivo que não é UUID: a rota não abre (vira nome de arquivo e caminho da API)', () => {
    expect(pedidoDaRota({ arquivo: '../segredo' })).toBeNull();
    expect(pedidoDaRota({})).toBeNull();
    expect(pedidoDaRota({ arquivo: [ID, 'x'] })).toEqual({ arquivo_id: ID });
  });
});

describe('fonteDaFoto', () => {
  it('foto deste aparelho abre mesmo sem sinal', () => {
    expect(fonteDaFoto('file:///fotos/x.jpg', false, true)).toEqual({ tipo: 'local', uri: 'file:///fotos/x.jpg' });
  });

  it('sem o arquivo local: nuvem com sinal; sem sinal, a mensagem da imagem aprovada', () => {
    expect(fonteDaFoto(null, true, true)).toEqual({ tipo: 'nuvem' });
    expect(fonteDaFoto(null, false, true)).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_SINAL_FOTO });
    expect(TEXTO_SEM_SINAL_FOTO).toBe('Sem internet');
  });

  it('sem fonte da nuvem (navegador, sem sessão): não abre', () => {
    expect(fonteDaFoto(null, true, false)).toEqual({ tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL });
  });
});

describe('imagem em memória', () => {
  it('base64 igual ao do Node, inclusive nos blocos e no preenchimento', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 12_287, 12_288, 12_289, 40_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(bytesParaBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
