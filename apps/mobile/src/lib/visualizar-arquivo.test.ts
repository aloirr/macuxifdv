/** T-0186 (RD-2356): o tipo pelo formato e pelos bytes, e a rota do visualizador de arquivos da ficha. */
import { describe, expect, it } from 'vitest';

import { ehImagem, pedidoDaRotaArquivo, rotaDoArquivo, tipoDosBytes, uriDaImagem } from './visualizar-arquivo';

const ID = '0B9F6C3E-6A7D-4C1E-9F0A-2B3C4D5E6F70';

describe('visualizar-arquivo', () => {
  it('formato de imagem vai ao visor de foto; pdf e desconhecido, não', () => {
    expect(['jpg', 'JPEG', 'png', 'image/webp'].map(ehImagem)).toEqual([true, true, true, true]);
    expect([' pdf', 'application/pdf', null, undefined, ''].map(ehImagem)).toEqual([false, false, false, false, false]);
  });

  it('tipo pela assinatura dos bytes', () => {
    expect(tipoDosBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('pdf');
    expect(tipoDosBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(tipoDosBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(tipoDosBytes(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toBeNull();
    expect(uriDaImagem('png', new Uint8Array([1, 2, 3]))).toBe('data:image/png;base64,AQID');
  });

  it('rota de ida e volta: arquivo em minúsculas, título e subtítulo; inválido = null', () => {
    const r = rotaDoArquivo({ arquivo_id: ID, titulo: 'NF 12345', subtitulo: 'Emitida em 08/11/2026' });
    expect(r).toEqual({ pathname: '/arquivo', params: { arquivo: ID.toLowerCase(), titulo: 'NF 12345', subtitulo: 'Emitida em 08/11/2026' } });
    expect(pedidoDaRotaArquivo(r.params)).toEqual({ arquivo_id: ID.toLowerCase(), titulo: 'NF 12345', subtitulo: 'Emitida em 08/11/2026' });
    expect(pedidoDaRotaArquivo({ arquivo: 'x', titulo: 'a' })).toBeNull();
    expect(() => rotaDoArquivo({ arquivo_id: 'x', titulo: 'a' })).toThrow();
  });
});
