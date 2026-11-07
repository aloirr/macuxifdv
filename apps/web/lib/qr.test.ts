/** T-0087: codificador de QR do cadastro do TOTP (lib/qr.ts), conferido contra vetores conhecidos da ISO/IEC 18004. */
import { describe, expect, it } from 'vitest';

import {
  bitsDeFormato,
  bitsDeVersao,
  capacidadeEmBytes,
  caminhoSvgDoQr,
  codewordsDaMensagem,
  divisorReedSolomon,
  gerarQr,
  intercalarComCorrecao,
  posicoesDeAlinhamento,
  restoReedSolomon,
  versaoParaBytes,
} from './qr';

const OTPAUTH = 'otpauth://totp/Macuxi%20FDV:alexandre%40macuxifdv.com.br?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Macuxi%20FDV&digits=6&period=30';

describe('Reed-Solomon e tabelas (nível M)', () => {
  it('vetor do "HELLO WORLD" 1-M: 10 codewords de correção', () => {
    const dados = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(restoReedSolomon(dados, divisorReedSolomon(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('capacidade em bytes das versões 1 a 10 bate com a tabela da norma', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacidadeEmBytes)).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
    expect(versaoParaBytes(14)).toBe(1);
    expect(versaoParaBytes(15)).toBe(2);
    expect(versaoParaBytes(214)).toBeNull();
  });
  it('bits de formato e de versão', () => {
    expect(bitsDeFormato(0)).toBe(0b101010000010010); // M, máscara 0
    expect(bitsDeFormato(0, 1)).toBe(0b111011111000100); // L, máscara 0
    expect(bitsDeVersao(7)).toBe(0x07c94);
    expect(bitsDeVersao(10)).toBe(0x0a4d3);
  });
  it('centros dos alinhamentos', () => {
    expect(posicoesDeAlinhamento(1)).toEqual([]);
    expect(posicoesDeAlinhamento(2)).toEqual([6, 18]);
    expect(posicoesDeAlinhamento(7)).toEqual([6, 22, 38]);
    expect(posicoesDeAlinhamento(10)).toEqual([6, 28, 50]);
  });
  it('mensagem: modo byte, contador, preenchimento 0xEC/0x11 até a capacidade', () => {
    const c = codewordsDaMensagem(new TextEncoder().encode('ab'), 1);
    expect(c).toHaveLength(16);
    expect(c.slice(0, 4)).toEqual([0x40, 0x26, 0x16, 0x20]);
    expect(c.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
    expect(intercalarComCorrecao(c, 1)).toHaveLength(26);
  });
});

describe('gerarQr', () => {
  it('URI do TOTP cabe numa versão pequena e tem os três localizadores', () => {
    const qr = gerarQr(OTPAUTH);
    expect(qr.versao).toBeGreaterThanOrEqual(7);
    expect(qr.versao).toBeLessThanOrEqual(VERSAO_LIMITE);
    expect(qr.tamanho).toBe(qr.versao * 4 + 17);
    const t = qr.tamanho;
    const linha0 = qr.modulos[0] as boolean[];
    // localizador: 7 escuros, separador claro
    expect(linha0.slice(0, 8)).toEqual([true, true, true, true, true, true, true, false]);
    expect(linha0.slice(t - 8)).toEqual([false, true, true, true, true, true, true, true]);
    expect((qr.modulos[t - 1] as boolean[]).slice(0, 7).every(Boolean)).toBe(true);
    // módulo escuro fixo
    expect((qr.modulos[t - 8] as boolean[])[8]).toBe(true);
  });
  it('bits de formato gravados nas duas cópias, com a máscara escolhida', () => {
    const qr = gerarQr(OTPAUTH);
    const t = qr.tamanho;
    const m = qr.modulos;
    const esperado = bitsDeFormato(qr.mascara);
    let copia1 = 0;
    for (let i = 0; i <= 5; i++) copia1 |= Number((m[i] as boolean[])[8]) << i;
    copia1 |= Number((m[7] as boolean[])[8]) << 6;
    copia1 |= Number((m[8] as boolean[])[8]) << 7;
    copia1 |= Number((m[8] as boolean[])[7]) << 8;
    for (let i = 9; i < 15; i++) copia1 |= Number((m[8] as boolean[])[14 - i]) << i;
    let copia2 = 0;
    for (let i = 0; i < 8; i++) copia2 |= Number((m[8] as boolean[])[t - 1 - i]) << i;
    for (let i = 8; i < 15; i++) copia2 |= Number((m[t - 15 + i] as boolean[])[8]) << i;
    expect(copia1).toBe(esperado);
    expect(copia2).toBe(esperado);
  });
  it('mesma entrada = mesma matriz; máscara fixa é respeitada', () => {
    expect(gerarQr(OTPAUTH).modulos).toEqual(gerarQr(OTPAUTH).modulos);
    expect(gerarQr('abc', { mascara: 3 }).mascara).toBe(3);
  });
  it('texto acima de 213 bytes é recusado', () => {
    expect(() => gerarQr('x'.repeat(214))).toThrow(/grande demais/);
  });
  it('SVG: um quadrado por módulo escuro, com a margem', () => {
    const qr = gerarQr('a');
    const d = caminhoSvgDoQr(qr, 4);
    const escuros = qr.modulos.reduce((a, l) => a + l.filter(Boolean).length, 0);
    expect(d.match(/M/g)).toHaveLength(escuros);
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});

const VERSAO_LIMITE = 10;
