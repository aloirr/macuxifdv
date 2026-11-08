import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHAVES_PUBLICAS_PACOTE, conferirPacote, sha256Hex } from '../../src/atualizacao';
import { anunciar, assinar, bytesDoPacote, chavesEd25519, chavesRsa } from './suporte';

const bytes = bytesDoPacote({ 'conector.mjs': 'versao=1.3.0' });

describe('T-0116: conferência do pacote (SHA-256 + assinatura com chave pública embutida)', () => {
  it('Ed25519: assinatura válida passa e informa a chave usada', () => {
    const k = chavesEd25519();
    expect(conferirPacote(bytes, anunciar(bytes, k.privada), { teste: k.publicaPem })).toEqual({
      ok: true,
      chaveId: 'teste',
    });
  });

  it('RSA 3072 + SHA-256 (esquema do pacote da v1, §7.4) também é aceito', () => {
    const k = chavesRsa(3072);
    expect(conferirPacote(bytes, anunciar(bytes, k.privada), { teste: k.publicaPem }).ok).toBe(true);
  });

  it('assinatura de outra chave (pacote forjado com SHA-256 correto) é recusada', () => {
    const certa = chavesEd25519();
    const intrusa = chavesEd25519();
    const r = conferirPacote(bytes, anunciar(bytes, intrusa.privada), { teste: certa.publicaPem });
    expect(r).toEqual({ ok: false, motivo: 'assinatura_invalida' });
  });

  it('pacote adulterado depois de assinado: o SHA-256 não confere', () => {
    const k = chavesEd25519();
    const pacote = anunciar(bytes, k.privada);
    const adulterado = bytesDoPacote({ 'conector.mjs': 'versao=1.3.0', 'extra.js': 'malicioso' });
    expect(conferirPacote(adulterado, pacote, { teste: k.publicaPem })).toEqual({
      ok: false,
      motivo: 'sha256_diferente',
    });
  });

  it('pacote adulterado com o SHA-256 recalculado: a assinatura não confere', () => {
    const k = chavesEd25519();
    const adulterado = bytesDoPacote({ 'conector.mjs': 'versao=9.9.9' });
    const pacote = { ...anunciar(bytes, k.privada), sha256: sha256Hex(adulterado) };
    expect(conferirPacote(adulterado, pacote, { teste: k.publicaPem })).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
  });

  it('sem assinatura, assinatura que não é base64 ou chave desconhecida: recusa (falha fechada)', () => {
    const k = chavesEd25519();
    const base = anunciar(bytes, k.privada);
    const chaves = { teste: k.publicaPem };
    expect(conferirPacote(bytes, { ...base, assinatura: null }, chaves)).toEqual({
      ok: false,
      motivo: 'assinatura_ausente',
    });
    expect(conferirPacote(bytes, { ...base, assinatura: 'não é base64!' }, chaves)).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
    expect(conferirPacote(bytes, { ...base, chave_publica_id: 'outra' }, chaves)).toEqual({
      ok: false,
      motivo: 'chave_desconhecida',
    });
    expect(conferirPacote(bytes, { ...base, chave_publica_id: 'toString' }, chaves)).toEqual({
      ok: false,
      motivo: 'chave_desconhecida',
    });
    expect(conferirPacote(bytes, base, {})).toEqual({ ok: false, motivo: 'chave_desconhecida' });
  });

  it('sem id da chave: usa a única embutida; com duas, exige o id', () => {
    const k = chavesEd25519();
    const outra = chavesEd25519();
    const pacote = { ...anunciar(bytes, k.privada), chave_publica_id: null };
    expect(conferirPacote(bytes, pacote, { a: k.publicaPem }).ok).toBe(true);
    expect(conferirPacote(bytes, pacote, { a: k.publicaPem, b: outra.publicaPem })).toEqual({
      ok: false,
      motivo: 'chave_desconhecida',
    });
  });

  it('chave fraca ou de outro tipo (RSA 2048, EC, chave privada, lixo) é recusada como inválida', () => {
    const rsa2048 = chavesRsa(2048);
    expect(conferirPacote(bytes, anunciar(bytes, rsa2048.privada), { teste: rsa2048.publicaPem })).toEqual({
      ok: false,
      motivo: 'chave_invalida',
    });
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pemEc = ec.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(
      conferirPacote(
        bytes,
        { ...anunciar(bytes, chavesEd25519().privada), assinatura: assinar(bytes, ec.privateKey) },
        { teste: pemEc },
      ),
    ).toEqual({
      ok: false,
      motivo: 'chave_invalida',
    });
    const k = chavesEd25519();
    const pemPrivado = k.privada.export({ type: 'pkcs8', format: 'pem' }).toString();
    // createPublicKey deriva a pública de uma privada: aceitar isso esconderia um segredo embutido por engano
    expect(conferirPacote(bytes, anunciar(bytes, k.privada), { teste: pemPrivado }).ok).toBe(false);
    expect(conferirPacote(bytes, anunciar(bytes, k.privada), { teste: 'lixo' })).toEqual({
      ok: false,
      motivo: 'chave_invalida',
    });
  });

  it('o código só embute chave PÚBLICA: nenhuma chave privada em src/atualizacao e as embutidas são públicas', () => {
    const pasta = join(__dirname, '../../src/atualizacao');
    for (const nome of readdirSync(pasta))
      expect(readFileSync(join(pasta, nome), 'utf8')).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    for (const pem of Object.values(CHAVES_PUBLICAS_PACOTE))
      expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });
});
