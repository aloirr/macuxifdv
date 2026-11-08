import { describe, expect, it } from 'vitest';
import { renderizarEmail } from '@macuxi/platform-sdk';
import { decodificarPartes, destinatario, dadosAcesso, ID_ENVIO, INSTANTE } from './apoio-teste';
import { base64EmLinhas, codificarCabecalho, dataRfc5322, formatarEndereco, montarMime, prepararData } from './mime';

describe('MIME (RFC 5322/2045/2047)', () => {
  const r = renderizarEmail('acesso_inicial', { ...destinatario, nome: 'Joaquina Conceição' }, dadosAcesso);
  const msg = {
    idEnvio: ID_ENVIO,
    modelo: 'acesso_inicial' as const,
    de: { email: 'nao-responda@macuxifdv.com.br', nome: 'Macuxi' },
    para: { email: destinatario.email, nome: 'Joaquina Conceição' },
    ...r,
  };

  it('cabeçalhos: From, To com nome em RFC 2047, Subject, Date UTC, Message-ID com idEnvio', () => {
    const { bruto, messageId } = montarMime(msg, { agora: INSTANTE });
    const cab = bruto.split('\r\n\r\n')[0]!;
    expect(cab).toContain('From: "Macuxi" <nao-responda@macuxifdv.com.br>');
    expect(cab).toContain(`To: =?UTF-8?B?${Buffer.from('Joaquina Conceição').toString('base64')}?= <joaquina.teste@exemplo.com.br>`);
    expect(cab).toContain('Subject: Seu acesso ao Macuxi');
    expect(cab).toContain('Date: Sat, 07 Nov 2026 12:00:00 +0000');
    expect(messageId).toBe(`<${ID_ENVIO}@macuxifdv.com.br>`);
    expect(cab).toContain(`Message-ID: ${messageId}`);
    expect(cab).toContain('MIME-Version: 1.0');
    expect(cab).toMatch(/Content-Type: multipart\/alternative; boundary="=_macuxi_[0-9a-f]+"/);
    // tudo com CRLF, nenhuma linha com LF solto
    expect(bruto.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('partes texto e HTML em UTF-8/base64 com linhas de até 76', () => {
    const { bruto } = montarMime(msg, { agora: INSTANTE });
    expect(bruto).toContain('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64');
    expect(bruto).toContain('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64');
    const corpo = bruto.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    for (const l of corpo.split('\r\n')) expect(l.length).toBeLessThanOrEqual(76);
    const partes = decodificarPartes(bruto);
    expect(partes.texto).toBe(r.texto);
    expect(partes.html).toBe(r.html);
    expect(bruto.trimEnd().endsWith('--')).toBe(true);
  });

  it('Subject não-ASCII em encoded-words de até 75 caracteres, sem partir caractere', () => {
    const assunto = 'Ação ' + 'ç'.repeat(60);
    const cod = codificarCabecalho(assunto);
    const palavras = cod.split('\r\n ');
    expect(palavras.length).toBeGreaterThan(1);
    for (const p of palavras) {
      expect(p.length).toBeLessThanOrEqual(75);
      expect(p).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decod = palavras.map((p) => Buffer.from(p.slice(10, -2), 'base64').toString('utf8')).join('');
    expect(decod).toBe(assunto);
    expect(codificarCabecalho('Sua nova senha')).toBe('Sua nova senha');
  });

  it('endereço: aspas escapadas, sem nome, sem CR/LF', () => {
    expect(formatarEndereco({ email: 'a@b.com', nome: 'Zé "Bom" \\ Ok' }).startsWith('=?UTF-8?B?')).toBe(true);
    expect(formatarEndereco({ email: 'a@b.com', nome: 'Joe "Bom"' })).toBe('"Joe \\"Bom\\"" <a@b.com>');
    expect(formatarEndereco({ email: 'a@b.com' })).toBe('<a@b.com>');
    expect(formatarEndereco({ email: 'a@b.com', nome: 'X\r\nBcc: c@d.com' })).not.toMatch(/[\r\n]/);
  });

  it('base64 em linhas de 76 e data RFC 5322', () => {
    const b = base64EmLinhas('x'.repeat(200));
    expect(b.split('\r\n').filter(Boolean).every((l) => l.length <= 76)).toBe(true);
    expect(dataRfc5322(new Date('2026-01-04T03:05:09Z'))).toBe('Sun, 04 Jan 2026 03:05:09 +0000');
  });

  it('DATA: dot-stuffing e CRLF', () => {
    expect(prepararData('a\n.b\r\n..c\nd')).toBe('a\r\n..b\r\n...c\r\nd\r\n');
    expect(prepararData('.inicio')).toBe('..inicio\r\n');
  });
});
