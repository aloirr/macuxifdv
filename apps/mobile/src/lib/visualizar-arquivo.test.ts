/** T-0186 (RD-2356): o tipo pelos bytes e a imagem em memória. */
import { describe, expect, it } from 'vitest';

import { tipoDosBytes, uriDaImagem } from './visualizar-arquivo';

describe('visualizar-arquivo', () => {
  it('tipo pela assinatura dos bytes; PDF não abre', () => {
    expect(tipoDosBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(tipoDosBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(tipoDosBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(tipoDosBytes(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toBeNull();
    expect(tipoDosBytes(new Uint8Array())).toBeNull();
    expect(uriDaImagem('png', new Uint8Array([1, 2, 3]))).toBe('data:image/png;base64,AQID');
  });
});
