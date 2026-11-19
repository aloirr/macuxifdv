/** T-0186 (RD-2356): os formatos que o visor abre e o tipo pelos bytes. */
import { describe, expect, it } from 'vitest';

import { ehImagem, FORMATOS_DO_VISOR, semFormato, tipoDosBytes, uriDaImagem } from './visualizar-arquivo';

describe('visualizar-arquivo', () => {
  it('o visor abre só JPEG e PNG: FORMATOS_DO_VISOR = jpg, jpeg, png', () => {
    expect(FORMATOS_DO_VISOR).toEqual(['jpg', 'jpeg', 'png']);
    expect(Object.isFrozen(FORMATOS_DO_VISOR)).toBe(true);
    expect(['jpg', 'JPEG', 'png', 'image/png'].map(ehImagem)).toEqual([true, true, true, true]);
    expect(['webp', 'image/webp', 'heic', ' pdf', 'application/pdf', null, undefined, ''].map(ehImagem)).toEqual([false, false, false, false, false, false, false, false]);
    expect([null, undefined, ' '].map(semFormato)).toEqual([true, true, true]);
    expect(semFormato('pdf')).toBe(false);
  });

  it('tipo pela assinatura dos bytes; PDF não abre', () => {
    expect(tipoDosBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(tipoDosBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(tipoDosBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(tipoDosBytes(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toBeNull();
    expect(tipoDosBytes(new Uint8Array())).toBeNull();
    expect(uriDaImagem('png', new Uint8Array([1, 2, 3]))).toBe('data:image/png;base64,AQID');
  });
});
