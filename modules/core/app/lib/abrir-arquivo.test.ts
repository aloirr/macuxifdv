import { afterEach, describe, expect, it } from 'vitest';

import { definirAbrirArquivo, normalizarFormato, podeAbrirFormato } from './abrir-arquivo';
import { acaoDoDocumento } from './ficha-v2';

afterEach(() => definirAbrirArquivo(null));

describe('RN-CORE-38: formatos que o shell abre (PDF fica para a v1.0.16)', () => {
  it('RN-CORE-38: sem registro, abre só JPEG e PNG, em qualquer caixa, com ponto ou como MIME', () => {
    for (const f of ['jpg', 'JPEG', 'png', '.PNG', 'JPG', ' Png ', 'image/jpeg', 'image/png', 'IMAGE/PNG']) {
      expect(podeAbrirFormato(f), f).toBe(true);
    }
  });
  it('RN-CORE-38: pdf, docx, nulo, vazio e desconhecido ficam sem a ação', () => {
    for (const f of ['pdf', 'PDF', 'docx', 'VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT', null, undefined, '', 'gif', 'image/gif']) {
      expect(podeAbrirFormato(f), String(f)).toBe(false);
    }
  });
  it('RN-CORE-38: normalizarFormato reduz extensão, ponto e MIME ao nome curto', () => {
    expect(normalizarFormato('.PNG')).toBe('png');
    expect(normalizarFormato('image/jpeg')).toBe('jpeg');
    expect(normalizarFormato('application/pdf')).toBe('pdf');
    expect(normalizarFormato(null)).toBe('');
  });
  it('RN-CORE-38: registro sem formatos informados considera só imagem', () => {
    definirAbrirArquivo(() => undefined);
    expect(podeAbrirFormato('pdf')).toBe(false);
    expect(podeAbrirFormato('png')).toBe(true);
  });
  it('RN-CORE-38: com formatos imagem e pdf, o pdf abre e o docx continua sem a ação', () => {
    definirAbrirArquivo(() => undefined, { formatos: ['imagem', 'pdf'] });
    expect(podeAbrirFormato('pdf')).toBe(true);
    expect(podeAbrirFormato('application/pdf')).toBe(true);
    expect(podeAbrirFormato('jpg')).toBe(true);
    expect(podeAbrirFormato('docx')).toBe(false);
    expect(podeAbrirFormato('gif')).toBe(false);
  });
  it('RN-CORE-38: a linha do documento PDF aparece sem a ação; a imagem abre; o bloqueado mostra o cadeado', () => {
    expect(acaoDoDocumento({ formato: 'pdf', acesso: 'abrir' })).toBe('nenhuma');
    expect(acaoDoDocumento({ formato: 'jpg', acesso: 'abrir' })).toBe('abrir');
    expect(acaoDoDocumento({ formato: 'pdf', acesso: 'bloqueado' })).toBe('cadeado');
    definirAbrirArquivo(() => undefined, { formatos: ['imagem', 'pdf'] });
    expect(acaoDoDocumento({ formato: 'pdf', acesso: 'abrir' })).toBe('abrir');
  });
});
