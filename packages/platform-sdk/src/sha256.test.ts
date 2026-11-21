import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('SHA-256 puro da plataforma (vetores do NIST; RN-INT-02 e RN-CORE-77)', () => {
  it('RN-INT-02: string vazia', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('RN-INT-02: "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('RN-INT-02: mensagem de 448 bits (padding em dois blocos)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('RN-INT-02: UTF-8 e mensagem longa (1.000 "a")', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    expect(sha256Hex('Café ☕')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('RN-INT-02: UTF-8 de vários bytes (acentos, símbolo e emoji) (vetores fixos)', () => {
    const vetores: Array<[string, string]> = [
      ['Café ☕', '0c3eecb944c2e450fd5306f55518b2c6bc0bd710732cf11c2baf282f95d594d4'],
      ['ação — título «ç»', '684da7be49ba132f28d760c325c8c6b3a9f5422de13ce19bf6ce336705194034'],
      ['日本語 🚀', '2eda23e777ab3214a7e7354613ac6cbf775d6b41f985949a21cec88e78124d20'],
    ];
    for (const [t, hex] of vetores) expect(sha256Hex(t)).toBe(hex);
  });
});
