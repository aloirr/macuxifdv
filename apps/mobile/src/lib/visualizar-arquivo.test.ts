/** T-0186 (RD-2356): o tipo pelo formato e pelos bytes, e a rota do visualizador de arquivos da ficha. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as lib from './visualizar-arquivo';
import { ehImagem, FORMATOS_DO_VISOR, pedidoDaRotaArquivo, rotaDoArquivo, semFormato, tipoDosBytes, uriDaImagem } from './visualizar-arquivo';

const ID = '0B9F6C3E-6A7D-4C1E-9F0A-2B3C4D5E6F70';

describe('visualizar-arquivo', () => {
  it('o visor abre só imagem: FORMATOS_DO_VISOR = jpg, jpeg, png, webp, heic (o PDF fica para a v1.0.16)', () => {
    expect(FORMATOS_DO_VISOR).toEqual(['jpg', 'jpeg', 'png', 'webp', 'heic']);
    expect(Object.isFrozen(FORMATOS_DO_VISOR)).toBe(true);
    expect(['jpg', 'JPEG', 'png', 'image/webp', 'heic'].map(ehImagem)).toEqual([true, true, true, true, true]);
    expect([' pdf', 'application/pdf', null, undefined, ''].map(ehImagem)).toEqual([false, false, false, false, false]);
    expect([null, undefined, ' '].map(semFormato)).toEqual([true, true, true]);
    expect(semFormato('pdf')).toBe(false);
  });

  it('o texto do PDF não existe mais', () => {
    expect(Object.values(lib).some((v) => typeof v === 'string' && /pdf/i.test(v))).toBe(false);
    expect('TEXTO_PDF_SEM_VISOR' in lib).toBe(false);
    const raiz = fileURLToPath(new URL('..', import.meta.url));
    const fontes = (readdirSync(raiz, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(fontes.length).toBeGreaterThan(0);
    expect(fontes.filter((f) => readFileSync(join(raiz, f), 'utf8').includes('ainda não abre PDF'))).toEqual([]);
    expect(fontes.some((f) => /visor-pdf/.test(f))).toBe(false);
  });

  it('tipo pela assinatura dos bytes; PDF não abre', () => {
    expect(tipoDosBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
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
