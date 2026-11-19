import { afterEach, describe, expect, it } from 'vitest';

import { definirAbrirArquivo, podeAbrirFormato } from './abrir-arquivo';
import { acaoDoDocumento } from './ficha-v2';

afterEach(() => definirAbrirArquivo(null));

describe('RN-CORE-38: formatos que o shell abre (PDF fica para a v1.0.16)', () => {
  it('RN-CORE-38: sem registro, PDF não abre e imagem abre', () => {
    expect(podeAbrirFormato('pdf')).toBe(false);
    expect(podeAbrirFormato('PDF')).toBe(false);
    expect(podeAbrirFormato('jpg')).toBe(true);
    expect(podeAbrirFormato(null)).toBe(true);
  });
  it('RN-CORE-38: registro sem formatos informados considera só imagem', () => {
    definirAbrirArquivo(() => undefined);
    expect(podeAbrirFormato('pdf')).toBe(false);
    expect(podeAbrirFormato('png')).toBe(true);
  });
  it('RN-CORE-38: com formatos imagem e pdf, os dois abrem', () => {
    definirAbrirArquivo(() => undefined, { formatos: ['imagem', 'pdf'] });
    expect(podeAbrirFormato('pdf')).toBe(true);
    expect(podeAbrirFormato('jpg')).toBe(true);
  });
  it('RN-CORE-38: a linha do documento PDF aparece sem a ação; a imagem abre; o bloqueado mostra o cadeado', () => {
    expect(acaoDoDocumento({ formato: 'pdf', acesso: 'abrir' })).toBe('nenhuma');
    expect(acaoDoDocumento({ formato: 'jpg', acesso: 'abrir' })).toBe('abrir');
    expect(acaoDoDocumento({ formato: 'pdf', acesso: 'bloqueado' })).toBe('cadeado');
    definirAbrirArquivo(() => undefined, { formatos: ['imagem', 'pdf'] });
    expect(acaoDoDocumento({ formato: 'pdf', acesso: 'abrir' })).toBe('abrir');
  });
});
