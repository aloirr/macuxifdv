/** T-0186 (v1.0.16): visor de PDF — formato, rota, assinatura, temporário, fonte sem cache e "Sem internet". */
import { describe, expect, it } from 'vitest';

import { TEXTO_FOTO_INDISPONIVEL, TEXTO_SEM_SINAL_FOTO } from './foto-pdv';
import { bloqueioDoPdf, bytesDoPdfAceitos, ehFormatoPdf, ehPdf, fonteDoPdf, nomePdfTemporario, pedidoDoVisorPdf, rotaDoVisorPdf } from './visor-pdf';

const ID = '0B9F6C3E-6A7D-4C1E-9F0A-2B3C4D5E6F70';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe('visor de PDF (puro)', () => {
  it('formato: pdf, .PDF e application/pdf são PDF; imagem, ausente e docx não', () => {
    for (const f of ['pdf', ' .PDF ', 'application/pdf']) expect(ehFormatoPdf(f)).toBe(true);
    for (const f of ['jpg', 'image/png', 'docx', '', null, undefined]) expect(ehFormatoPdf(f)).toBe(false);
  });

  it('assinatura: só %PDF passa; JPEG e vazio não', () => {
    expect(ehPdf(PDF)).toBe(true);
    expect(ehPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(bytesDoPdfAceitos(PDF)).toBe(true);
    expect(bytesDoPdfAceitos(new Uint8Array([0x25, 0x50]))).toBe(false);
    expect(bytesDoPdfAceitos(null)).toBe(false);
  });

  it('rota /pdf com o arquivo em minúsculas, o título e o subtítulo; arquivo inválido lança', () => {
    expect(rotaDoVisorPdf({ arquivo_id: ID, titulo: 'NF 123' })).toEqual({ pathname: '/pdf', params: { arquivo: ID.toLowerCase(), titulo: 'NF 123' } });
    expect(() => rotaDoVisorPdf({ arquivo_id: '../x' })).toThrow();
    expect(pedidoDoVisorPdf({ arquivo: ID, titulo: 'NF 123' })).toEqual({ arquivo_id: ID.toLowerCase(), titulo: 'NF 123' });
    expect(pedidoDoVisorPdf({ arquivo: 'x' })).toBeNull();
  });

  it('temporário com nome seguro e fonte sem o cache da biblioteca', () => {
    expect(nomePdfTemporario(ID, 'm1x/../2')).toBe(`${ID.toLowerCase()}-m1x2.pdf`);
    expect(nomePdfTemporario(ID, '')).toBe(`${ID.toLowerCase()}-0.pdf`);
    expect(fonteDoPdf('file:///cache/visor-pdf/a.pdf')).toEqual({ uri: 'file:///cache/visor-pdf/a.pdf', cache: false });
  });

  it('sem sinal: "Sem internet" (não há cópia no aparelho); sem a API: indisponível; com sinal: baixa', () => {
    expect(bloqueioDoPdf(false, true)).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_SINAL_FOTO });
    expect(bloqueioDoPdf(true, false)).toEqual({ tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL });
    expect(bloqueioDoPdf(true, true)).toBeNull();
  });
});
