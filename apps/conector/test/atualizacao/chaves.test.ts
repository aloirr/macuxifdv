import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHAVES_PUBLICAS_PACOTE, conferirPacote } from '../../src/atualizacao';
import { anunciar, bytesDoPacote, chavesRsa } from './suporte';

const bytes = bytesDoPacote({ 'conector.mjs': 'versao=1.3.0' });

describe('T-0116: chave pública de produção embutida (macuxi-2026)', () => {
  it('a chave macuxi-2026 carrega como RSA de 3072 bits ou mais', () => {
    const k = createPublicKey(CHAVES_PUBLICAS_PACOTE['macuxi-2026']!);
    expect(k.asymmetricKeyType).toBe('rsa');
    expect(k.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(3072);
  });

  it('com um par de teste RSA 3072: aceita a assinatura certa e recusa a adulterada e a de outra chave', () => {
    const k = chavesRsa(3072);
    const outra = chavesRsa(3072);
    const chaves = { teste: k.publicaPem };
    expect(conferirPacote(bytes, anunciar(bytes, k.privada), chaves).ok).toBe(true);
    const adulterado = bytesDoPacote({ 'conector.mjs': 'malicioso' });
    expect(conferirPacote(adulterado, anunciar(bytes, k.privada), chaves)).toEqual({ ok: false, motivo: 'sha256_diferente' });
    expect(conferirPacote(bytes, anunciar(bytes, outra.privada), chaves)).toEqual({ ok: false, motivo: 'assinatura_invalida' });
  });

  it('pacote assinado por par de teste mas anunciado como macuxi-2026 é recusado (assinatura_invalida)', () => {
    const k = chavesRsa(3072);
    const pacote = anunciar(bytes, k.privada, { chave_publica_id: 'macuxi-2026' });
    expect(conferirPacote(bytes, pacote, CHAVES_PUBLICAS_PACOTE)).toEqual({ ok: false, motivo: 'assinatura_invalida' });
  });

  it('id desconhecido continua recusado (falha fechada)', () => {
    const k = chavesRsa(3072);
    const r = conferirPacote(bytes, anunciar(bytes, k.privada, { chave_publica_id: 'nao-existe' }), CHAVES_PUBLICAS_PACOTE);
    expect(r.ok).toBe(false);
  });
});
